# The Assistant runs on the server, under a per-Account encrypted key

The Assistant turns a sentence ("trenta euro all'Esselunga con la carta") into Draft Transactions through an LLM, a paid external dependency that needs a provider key. We run the whole agent — prompt, tool loop, tools bound to the Account's service layer — in the backend behind one stateless endpoint, with each Account storing its own key (the Assistant Key), encrypted at rest with AES-GCM under a server secret, write-only through the API. Clients are thin chat screens that carry the transcript; the web app and the Android app get the same Assistant from the same endpoint. The model call is the only seam: tests replace "given messages and tools, return the next assistant message" with a scripted fake and run the loop, the tools and the Draft writes for real against the test database. Behind the seam sit two adapters: Anthropic native, and one OpenAI-compatible adapter parameterized by a base URL from a fixed provider table (OpenRouter, Google Gemini). The Account's Assistant Settings choose the provider, the key and the model; adding a provider that speaks the OpenAI shape is one table row, never a user-entered URL.

## Considered Options

- **Agent in the browser, key in the browser** (local storage, like the session token) — rejected: a provider key spends money until revoked and never expires on its own, so it is worse to lose than a session token; and a key that lives on one device gives no Assistant on the next one. The first design was client-side; the key moved it.
- **Agent in the browser, key proxied by the server** — rejected once the key was on the server anyway: with the backend making the model call, running the loop there too costs nothing more and spares the Android app a second implementation of the agent.
- **One operator key with per-Account quotas** — rejected: it puts every user's cost and transcripts on the operator and needs quota logic; per-Account keys keep cost and privacy with each user. Without a key an Account simply has no Assistant, as the app has no map search without a Google key (ADR-0004).
- **On-device models** (browser Prompt API, WebLLM) — rejected: experimental, desktop-only in practice, hundreds of megabytes on a phone, weak at Italian.
- **Hand-written parsing of amounts, dates and names** — rejected: brittle in two languages; the LLM is the point.
- **One provider, one hardcoded model** — the first cut; rejected once the owner wanted their OpenRouter and Gemini keys and the free models behind them. The app vets only that a model can call tools; acceptance runs on the reference model (Claude Opus 5.5), and a weaker model's misreadings are the user's choice, not a bug.
- **A user-entered base URL** ("any OpenAI-compatible endpoint") — rejected: the server would send requests, with the user's key, to any host the user names, including machines inside its own network. Providers are a fixed table in code.
- **A wider toolbox** (ledger reads, Transaction writes, answering "how much did I spend") — rejected: the Assistant is given only Wallet, Category and Recurring names and writes only Draft Transactions, so a misheard sentence or a hostile name in the prompt can at worst produce a Draft nobody approves. Voice queries are a different product.
- **Names fetched through tools** — the first cut, three list tools the model called before every Draft; rejected after the prototype met Gemini's free tier (5 requests per minute per model): a turn cost 3-4 requests and the second turn was refused. The server already holds the names, so it injects them into the system prompt each turn and the toolbox is the four Draft tools; a simple turn is two requests. Same information reaches the provider either way.

## Consequences

- The Account gains an encrypted key column and a settings endpoint that sets, replaces and removes it and reports only "configured" plus the last characters. The key is excluded from Backup, Export and logs; a Backup restored elsewhere brings no key.
- The server secret for the key joins the JWT secret in the environment; losing it makes every stored key unreadable and every Account re-enters theirs.
- The operator, with database access and that secret, can decrypt the keys. For a self-hosted app that operator is the owner.
- On a provider 429 or 503 the server waits the delay the provider announces and retries once while it fits the turn budget; otherwise the reply says to try again in N seconds. No retry storm.
- Per-Account bounds live server-side (turns per hour, tool steps per turn, seconds per turn) so a leaked session token cannot burn a key quickly.
- The conversation is stored nowhere: the client sends the transcript each turn and the server derives from it which Drafts belong to the open conversation; the update and discard tools accept only those ids.
- A provider rejection of the key surfaces as one message pointing at Settings; there is no retry.
