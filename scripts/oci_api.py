#!/usr/bin/env python3
"""Minimal Oracle Cloud Infrastructure API client — pure Python, runs on Termux.

The official oci-cli cannot install on Android/Termux: its dependencies
(crc32c, cryptography) have no Android wheels and their C/Rust sources do not
compile with Termux's clang. This client ports the official oci-python-sdk
signer (oci/signer.py + oci/_vendor/httpsig_cffi, UPL 1.0 / Apache 2.0) on top
of the pure-Python `rsa` package, which installs cleanly.

It reads the standard ~/.oci/config ([DEFAULT] section) — the same file the
official CLI uses — so the credentials are portable to a real machine later.

Each subcommand prints exactly the value the wizard needs (an OCID or an IP)
on stdout; progress and errors go to stderr.

Usage:
    scripts/oci_api.py selftest                       # RSA round-trip, no network
    scripts/oci_api.py ad-list                        # first availability domain
    scripts/oci_api.py image-list                     # Ubuntu 24.04 aarch64 image OCID
    scripts/oci_api.py vcn-create                     # VCN OCID
    scripts/oci_api.py igw-create <vcn>               # internet gateway OCID
    scripts/oci_api.py rt-create <vcn> <igw>          # route table OCID (0.0.0.0/0 -> igw)
    scripts/oci_api.py sl-create <vcn>                # security list OCID (ingress 22, 80)
    scripts/oci_api.py subnet-create <vcn> <rt> <sl>  # subnet OCID (10.0.0.0/24)
    scripts/oci_api.py instance-launch <subnet> <ad> <image> <ssh-pubkey-file>
    scripts/oci_api.py instance-wait <instance>       # poll until RUNNING
    scripts/oci_api.py instance-public-ip <instance>  # public IP
    scripts/oci_api.py --dry-run <command> ...        # print the signed request, don't send
"""

import argparse
import base64
import email.utils
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import rsa  # pure-Python RSA — the only third-party dependency

CONFIG_PATH = os.path.expanduser("~/.oci/config")

# The header set the oci-python-sdk signs, in exactly this order
# (Signer.generic_headers + Signer.body_headers).
GENERIC_HEADERS = ["date", "(request-target)", "host"]
BODY_HEADERS = ["content-length", "content-type", "x-content-sha256"]

# Shape / size for the Always Free Ampere A1 instance.
SHAPE = "VM.Standard.A1.Flex"
OCPUS = 4
MEMORY_GB = 24
VCN_CIDR = "10.0.0.0/16"
SUBNET_CIDR = "10.0.0.0/24"


def load_config() -> dict:
    """Parse the [DEFAULT] section of ~/.oci/config (same format as oci-cli)."""
    if not os.path.exists(CONFIG_PATH):
        sys.exit(f"error: {CONFIG_PATH} not found — run scripts/oracle-provision.sh first")
    cfg: dict = {}
    with open(CONFIG_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("["):
                continue
            key, _, value = line.partition("=")
            cfg[key.strip()] = value.strip()
    for required in ("tenancy", "user", "fingerprint", "key_file", "region"):
        if required not in cfg:
            sys.exit(f"error: ~/.oci/config missing '{required}'")
    return cfg


def pkcs8_to_pkcs1(pem_bytes: bytes) -> bytes:
    """Unwrap a PKCS#8 PEM ('BEGIN PRIVATE KEY') into the PKCS#1 PEM the
    pure-Python rsa package parses. The PKCS#1 DER is the OCTET STRING inside
    the outer SEQUENCE: SEQUENCE { INTEGER 0, SEQUENCE {OID, NULL}, OCTET
    STRING { PKCS#1 } }. OpenSSL >= 3.0 genrsa emits PKCS#8 by default."""
    body = re.sub(r"-----[^-]+-----|\s", "", pem_bytes.decode("ascii"))
    der = base64.b64decode(body)

    def read_tlv(data: bytes, pos: int) -> tuple[int, bytes, int, int]:
        """Return (tag, value, value_start, value_end)."""
        tag = data[pos]
        pos += 1
        length = data[pos]
        pos += 1
        if length & 0x80:  # long-form length
            n = length & 0x7F
            length = int.from_bytes(data[pos:pos + n], "big")
            pos += n
        return tag, data[pos:pos + length], pos, pos + length

    _, _, pos, _ = read_tlv(der, 0)  # SEQUENCE (outer) → pos = its contents
    for _ in range(2):               # INTEGER 0 (version), SEQUENCE (algorithm)
        _, _, _, pos = read_tlv(der, pos)
    tag, inner, _, _ = read_tlv(der, pos)  # OCTET STRING = PKCS#1 DER
    if tag != 0x04:
        raise ValueError("unexpected PKCS#8 layout")
    return (b"-----BEGIN RSA PRIVATE KEY-----\n"
            + base64.encodebytes(inner)
            + b"-----END RSA PRIVATE KEY-----\n")


def load_private_key(path: str):
    path = os.path.expanduser(path)
    with open(path, "rb") as f:
        pem = f.read().strip()
    try:
        return rsa.PrivateKey.load_pkcs1(pem)
    except (ValueError, TypeError):
        # OpenSSL 3.x genrsa emits PKCS#8 — unwrap it and retry.
        try:
            return rsa.PrivateKey.load_pkcs1(pkcs8_to_pkcs1(pem))
        except (ValueError, TypeError) as e:
            sys.exit(f"error: cannot load private key {path}: {e}")


def sign_signing_string(signing_string: str, private_key) -> str:
    """RSA PKCS#1 v1.5 + SHA-256 (httpsig's rsa-sha256), base64-encoded."""
    signature = rsa.sign(signing_string.encode("ascii"), private_key, "SHA-256")
    return base64.b64encode(signature).decode("ascii")


def build_request(cfg: dict, private_key, method: str, path: str,
                  params: dict | None = None, body: dict | None = None) -> tuple[str, dict, bytes | None]:
    """Return (url, headers, body_bytes) with the OCI Signature header applied.

    Mirrors oci-python-sdk's signer exactly: the signing string is
    'name: value' lines joined with '\\n' (no trailing newline), in the header
    order above; 'host' is the URL's netloc; body requests add
    content-length / content-type / x-content-sha256.
    """
    region = cfg["region"]
    query = urllib.parse.urlencode(params) if params else ""
    url = f"https://iaas.{region}.oraclecloud.com{path}"
    if query:
        url += "?" + query
    netloc = urllib.parse.urlparse(url).netloc

    headers = {
        "date": email.utils.formatdate(usegmt=True),
        "host": netloc,
    }
    body_bytes = None
    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        headers["content-length"] = str(len(body_bytes))
        headers["content-type"] = "application/json"
        digest = base64.b64encode(hashlib.sha256(body_bytes).digest()).decode("ascii")
        headers["x-content-sha256"] = digest

    signed_headers = GENERIC_HEADERS + (BODY_HEADERS if body is not None else [])
    target = f"{method.lower()} {path}" + (f"?{query}" if query else "")
    lines = []
    for h in signed_headers:
        if h == "(request-target)":
            lines.append(f"(request-target): {target}")
        else:
            lines.append(f"{h}: {headers[h]}")
    signing_string = "\n".join(lines)

    signature = sign_signing_string(signing_string, private_key)
    key_id = f"{cfg['tenancy']}/{cfg['user']}/{cfg['fingerprint']}"
    headers["authorization"] = (
        f'Signature algorithm="rsa-sha256",headers="{" ".join(signed_headers)}",'
        f'keyId="{key_id}",signature="{signature}",version="1"'
    )
    return url, headers, body_bytes


def call(cfg: dict, private_key, method: str, path: str, *, params: dict | None = None,
         body: dict | None = None, dry_run: bool = False) -> dict:
    url, headers, body_bytes = build_request(cfg, private_key, method, path, params, body)
    if dry_run:
        print(f"DRY RUN — not sent:\n{method} {url}\nheaders:\n" +
              "\n".join(f"  {k}: {v}" for k, v in sorted(headers.items())) +
              (f"\nbody:\n{body_bytes.decode()}" if body_bytes else ""))
        return {}
    req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(detail)
            code = parsed.get("code", "?")
            message = parsed.get("message", detail)
        except ValueError:
            code, message = e.code, detail[:300]
        sys.exit(f"error: OCI {e.code} ({code}) — {message}\n"
                 f"  hint: 401 = key/fingerprint/OCID mismatch, 404 = wrong tenancy OCID, "
                 f"400 = request rejected")


def first_ad(cfg: dict, private_key, dry_run: bool = False) -> str:
    data = call(cfg, private_key, "GET", f"/20160918/availabilityDomains/{cfg['tenancy']}",
                dry_run=dry_run)
    if dry_run:
        return ""
    if not data:
        sys.exit("error: no availability domains returned")
    print(data[0]["name"])


def best_image(cfg: dict, private_key, dry_run: bool = False) -> str:
    params = {
        "compartmentId": cfg["tenancy"],
        "architecture": "ARM64",
        "operatingSystem": "Canonical Ubuntu",
        "operatingSystemVersion": "24.04",
        "shape": SHAPE,
        "lifecycleState": "AVAILABLE",
    }
    data = call(cfg, private_key, "GET", "/20160918/images", params=params, dry_run=dry_run)
    if dry_run:
        return ""
    images = [i for i in data if "24.04" in i.get("displayName", "")]
    if not images:
        sys.exit(f"error: no Ubuntu 24.04 aarch64 image found (got {len(data)} images)")
    images.sort(key=lambda i: i.get("timeCreated", ""), reverse=True)
    print(images[0]["id"])


def create(cfg: dict, private_key, path: str, body: dict, dry_run: bool = False) -> str:
    data = call(cfg, private_key, "POST", path, body=body, dry_run=dry_run)
    if dry_run:
        return ""
    print(data["id"])


def instance_launch(cfg: dict, private_key, subnet: str, ad: str, image: str,
                    ssh_key_file: str, dry_run: bool = False) -> str:
    with open(ssh_key_file) as f:
        pubkey = f.read().strip()
    body = {
        "availabilityDomain": ad,
        "compartmentId": cfg["tenancy"],
        "shape": SHAPE,
        "ocpus": OCPUS,
        "memoryInGBs": MEMORY_GB,
        "displayName": "budjetame",
        "sourceDetails": {"sourceType": "image", "imageId": image},
        "subnetId": subnet,
        "metadata": {"ssh_authorized_keys": pubkey},
    }
    data = call(cfg, private_key, "POST", "/20160918/instances", body=body, dry_run=dry_run)
    if dry_run:
        return ""
    print(data["id"])


def instance_wait(cfg: dict, private_key, instance: str, dry_run: bool = False) -> None:
    deadline = time.time() + 600
    while time.time() < deadline:
        data = call(cfg, private_key, "GET", f"/20160918/instances/{instance}", dry_run=dry_run)
        if dry_run:
            return
        state = data.get("lifecycleState", "?")
        print(f"  instance state: {state}", file=sys.stderr)
        if state == "RUNNING":
            return
        time.sleep(15)
    sys.exit("error: instance did not reach RUNNING within 10 minutes")


def instance_public_ip(cfg: dict, private_key, instance: str, dry_run: bool = False) -> str:
    data = call(cfg, private_key, "GET", f"/20160918/instances/{instance}/vnics", dry_run=dry_run)
    if dry_run:
        return ""
    items = data.get("data") or data  # vnics response is {"data": [...]} in some SDKs; API returns a list
    if isinstance(items, dict):
        items = items.get("items", [])
    for vnic in items:
        ip = vnic.get("publicIp")
        if ip:
            print(ip)
            return
    sys.exit("error: instance has no public IP yet")


def selftest() -> None:
    """RSA round-trip with a throwaway key — proves the crypto chain without a network."""
    pub, priv = rsa.newkeys(2048)
    msg = "date: Tue, 01 Jan 2030 00:00:00 GMT\n(request-target): get /20160918/instances\nhost: iaas.example.oraclecloud.com"
    sig = sign_signing_string(msg, priv)
    try:
        rsa.verify(msg.encode("ascii"), base64.b64decode(sig), pub)
    except rsa.VerificationError:
        sys.exit("selftest FAILED: signature did not verify")
    print("selftest OK — RSA-SHA256 signing chain works")


def main() -> None:
    parser = argparse.ArgumentParser(description="Minimal OCI API client (pure Python)")
    parser.add_argument("--dry-run", action="store_true", help="print the signed request without sending")
    parser.add_argument("command", help=argparse.SUPPRESS)
    parser.add_argument("args", nargs="*", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.command == "selftest":
        selftest()
        return

    cfg = load_config()
    private_key = load_private_key(cfg["key_file"])

    if args.command == "ad-list":
        first_ad(cfg, private_key, args.dry_run)
    elif args.command == "image-list":
        best_image(cfg, private_key, args.dry_run)
    elif args.command == "vcn-create":
        create(cfg, private_key, "/20160918/vcns",
               {"compartmentId": cfg["tenancy"], "cidrBlock": VCN_CIDR,
                "displayName": "budjetame-vcn"}, args.dry_run)
    elif args.command == "igw-create":
        create(cfg, private_key, "/20160918/internetGateways",
               {"compartmentId": cfg["tenancy"], "vcnId": args.args[0],
                "isEnabled": True, "displayName": "budjetame-igw"}, args.dry_run)
    elif args.command == "rt-create":
        create(cfg, private_key, "/20160918/routeTables",
               {"compartmentId": cfg["tenancy"], "vcnId": args.args[0],
                "displayName": "budjetame-rt",
                "routeRules": [{"destination": "0.0.0.0/0", "destinationType": "CIDR_BLOCK",
                                "networkEntityId": args.args[1]}]}, args.dry_run)
    elif args.command == "sl-create":
        create(cfg, private_key, "/20160918/securityLists",
               {"compartmentId": cfg["tenancy"], "vcnId": args.args[0],
                "displayName": "budjetame-sl",
                "ingressSecurityRules": [
                    {"protocol": "6", "source": "0.0.0.0/0",
                     "tcpOptions": {"destinationPortRange": {"min": 22, "max": 22}}},
                    {"protocol": "6", "source": "0.0.0.0/0",
                     "tcpOptions": {"destinationPortRange": {"min": 80, "max": 80}}},
                ],
                "egressSecurityRules": [{"protocol": "all", "destination": "0.0.0.0/0"}]},
               args.dry_run)
    elif args.command == "subnet-create":
        create(cfg, private_key, "/20160918/subnets",
               {"compartmentId": cfg["tenancy"], "vcnId": args.args[0],
                "cidrBlock": SUBNET_CIDR, "routeTableId": args.args[1],
                "securityListIds": [args.args[2]], "displayName": "budjetame-subnet"},
               args.dry_run)
    elif args.command == "instance-launch":
        instance_launch(cfg, private_key, args.args[0], args.args[1], args.args[2],
                        args.args[3], args.dry_run)
    elif args.command == "instance-wait":
        instance_wait(cfg, private_key, args.args[0], args.dry_run)
    elif args.command == "instance-public-ip":
        instance_public_ip(cfg, private_key, args.args[0], args.dry_run)
    else:
        sys.exit(f"error: unknown command '{args.command}'")


if __name__ == "__main__":
    main()
