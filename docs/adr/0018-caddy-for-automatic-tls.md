# Caddy replaces nginx in the frontend image for automatic TLS

The frontend image used to serve the SPA with nginx over plain HTTP (port 80): browsers flagged the site "Not secure" and the login travelled unencrypted. The image now serves with Caddy — it terminates TLS with Let's Encrypt certificates it obtains and renews itself, redirects HTTP to HTTPS, and keeps the single-origin contract unchanged (`/api/*` proxied to the backend with the prefix stripped, unknown paths falling back to `index.html`). The site address comes from a per-environment `DOMAIN` variable (prod: `budjetame.de, www.budjetame.de` with `www` redirecting to the apex; dev/stage: their subdomains), so one image serves all three environments. The CD health check probes `https://<domain>/api/health`, and the provisioning security list opens ingress TCP 22, 80 and 443 (the existing prod security list was updated with `scripts/oci_api.py sl-add-https`).

## Considered Options

- **Keep nginx + a certbot sidecar container** — rejected: certificate issuance, webroot challenges, a shared volume, and a renewal/reload mechanism are several moving parts that must keep working forever, for no benefit over Caddy.
- **certbot on the VM host** — rejected: it adds host-level state (packages, cron) to VMs whose whole model is "only ever touched by docker compose".
- **Cloudflare-proxied DNS or Tunnel** — rejected: a third party between the user and their financial data, for a single-user app that already has a login gate.

A future reader should not "fix" the frontend image back to nginx — the swap is what makes TLS automatic.
