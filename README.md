# PayWella AI

Conversational payments, savings and individual Ajo collection records, with private review before money moves.

Node.js 24, TypeScript, React and PostgreSQL. Local development uses SQLite; hosted deployments require a dedicated PostgreSQL database. Financial adapters use a sandbox ledger and do not send real payments.

## What works

- WhatsApp text, voice-note and payment-image ingestion through a signed, deduplicated inbox.
- A contextual agent using actual MCP tool discovery and calls. It can read owned balances, goals, recipients, activity, settings and Ajo records, then prepare up to five tasks together.
- Bank and PayWella transfers, airtime, data, prepaid electricity, savings creation/deposit/withdrawal, and individual Ajo cash/funding/payout records using sandbox financial adapters.
- An editable private review, one four-digit PIN approval, aggregate balance reservations, bounded parallel workers and durable pending-payment reconciliation.
- Handwritten-ledger candidates with explicit member matching and human review. Recording collected cash creates an organizer liability, never a bank-funded balance.
- Ajo contributions cover the oldest unpaid dates, including partial days and advance days within the agreed cycle. Reviews and receipts preserve the exact allocation; replacing collected cash does not count those days twice.
- Automatic grouped receipts, recipient copies of internal payments, PNG/PDF receipts, PDF statements and saved bank recipients.
- A responsive web companion with light, dark and device appearance settings.

Provider adapters and offline contract tests are implemented. Real Meta/Gemini recognition quality, WhatsApp delivery, account eligibility and hosted operation must be tested with separate credentials before a connected demonstration is claimed.

## Development

```sh
npm ci
cp .env.example .env.local
# Set a random APP_SECRET of at least 32 characters.
npm run doctor
npm run build
npm run seed
npm start
```

The local forms and sandbox ledger work without an AI key. `npm run seed -- --organizer` enables organizer access for the isolated local test account. No script resets another environment or seeds a hosted database.

Use an isolated Gemini key for temporary testing. When Meta access is activated, set `AI_PROVIDER=meta`, `MEDIA_PROVIDER=meta` and `MODEL_API_KEY`. The Meta adapters use Muse Spark for planning/vision and Muse Voice Transcribe for speech. The Docker runtime includes FFmpeg for the required WAV conversion. Neither provider is silently replaced by a scripted intent parser. API keys stay on the server.

`SAM_LEDGER_CROP=true` optionally isolates a notebook page through SAM 3.1 before a second vision pass. Zero/multiple matches or a failed crop retain the original candidate review; the interface never reports an image as segmented unless a crop was actually applied. Enable this only after testing the model access and representative notebook photos.

Use a separate WhatsApp app, test number, webhook and database. Never point this service at another environment's data or callback.

## Deployment and checks

The Node service serves the built web app and API from one origin. `render.yaml` describes this service; it does not provision a database or enable WhatsApp by itself. Set `PUBLIC_ORIGIN` to its HTTPS origin, with no path. Set `WHATSAPP_PUBLIC_NUMBER` to the business number with country code, distinct from `WHATSAPP_PHONE_NUMBER_ID`.

```sh
npm run build
npm test
npm run doctor -- --integration
npm run doctor -- --submission
```

The last two commands check configuration, not real provider success. Submission configuration requires the Meta planner and media adapter. Keep the repository private while preparing it, then ensure the submitted repository and video can actually be opened by judges.

`npm run check:postgres` additionally tests concurrent approval, immutable and balanced journals, RLS, revisions and statements. It requires `PG_TEST_URL` pointing to a disposable loopback PostgreSQL server's `/postgres` database, creates a uniquely named test database, and drops only that database. GitHub CI supplies its own PostgreSQL service.

Hosted organizer access is an operator action: after an account is opened, `npm run organizer -- --phone <country-code-and-number>` grants access only in the dedicated database marked as PayWella AI. This is test provisioning, not regulatory approval or a self-service permission bypass.

## Execution boundaries

Private plans expire after five minutes. One four-digit PIN approval covers the reviewed revision. The model can read and prepare through MCP; it has no payment-execution tool.

An accepted request is not a completed payment. Provider uncertainty retains the reservation and reconciles the existing reference. Independent tasks can complete separately; receipts describe settled tasks only. Editing invalidates the earlier review. Notifications run independently and cannot turn a settled task into a PIN error.

An Ajo cycle has an agreed first date, payout date and member-specific daily amount, bounded to one year in this release. Amounts beyond the remaining cycle are rejected rather than becoming undisclosed fees or an automatic new cycle. Concurrent contributions that change a reviewed date allocation require a fresh review. Older member records without dated contribution evidence remain blocked from new dated collections until their history is reconciled; existing funded balances are not rewritten. Cycle fee agreements and recurring savings schedules remain outside the implemented journeys.

Capability links are exchanged for HttpOnly, SameSite cookies and removed from the address bar. Web mutations require the configured origin. Owner access is enforced below the model. Conversation, reply, progress and extracted-media state is encrypted and expires after 24 hours; financial evidence remains separate. No raw downloaded image/audio is persisted. Supabase public tables have RLS enabled and anonymous/authenticated browser-role grants revoked; database credentials belong only on the server.

## Scope

This repository contains the WhatsApp and web implementation. Native mobile, crypto, foreign accounts, cards, lending and yield products are outside this build. WhatsApp live calling is not enabled or implemented here; a voice-note demonstration does not demonstrate calling. External-agent OAuth/MCP access is also outside this release.

The bank and bill catalogue contains explicit test fixtures. No Wema partnership, provider pricing, production KYC approval, guaranteed yield or live bank account is implied.

## Event contributions

The implementation is recorded in the repository's dated commits: contextual MCP orchestration, media adapters, reviewed notebook import, approval/revision security, the sandbox ledger and workers, and the responsive web journeys. The supplied PayWella logo and licensed fonts are documented in [ASSETS.md](ASSETS.md). Demonstrations must distinguish actual connected model calls from offline test fixtures.

Current implementation and deployment checks are described by executable tests and `npm run doctor`. Missing credentials are reported explicitly. Internal product, fundraising, registration and planning documents are not distributed here.
