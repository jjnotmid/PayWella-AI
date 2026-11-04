# PayWella AI

Conversational payments, savings and individual Ajo collection records, with private review before money moves.

Node.js 24, TypeScript, React and PostgreSQL. Local development uses SQLite; hosted deployments require a dedicated PostgreSQL database. Financial adapters use a sandbox ledger and do not send real payments.

## What works

- WhatsApp text, voice-note and payment-image ingestion through a signed, deduplicated inbox.
- Direct account-opening buttons, a localized account-ready message with full test funding details, one service list, private settings links and current available/reserved balance controls. These controls do not reset an unfinished conversation or consume a model call; free-form requests still use the model and MCP.
- A contextual agent using actual MCP tool discovery and calls. It can read owned balances, goals, recipients, activity, settings and Ajo records, then prepare up to five tasks together.
- Bank and PayWella transfers, airtime, data, prepaid electricity, savings creation/deposit/withdrawal, and individual Ajo cash/funding/payout records using sandbox financial adapters.
- Bounded daily/weekly savings instructions use explicit recurring consent and the transaction PIN. Reviews show the per-run amount, dates and maximum total; changes need a new approval, while cancelling only stops future runs. Scheduled transfers produce normal private activity/receipts and skip unfunded or offline missed runs rather than making catch-up debits.
- An editable private review, one four-digit PIN approval, aggregate balance reservations, bounded parallel workers and durable pending-payment reconciliation.
- WhatsApp reviews include each amount, full bank recipient, fees and expiry. Independent read-only MCP calls overlap; mutations and dependent operations preserve their required order.
- Grounded purchase-affordability arithmetic uses fresh available funds and a customer-specified buffer. Receipt-support tools distinguish settled payments from WhatsApp notification acceptance or confirmed delivery, without exposing another customer's records.
- Handwritten-ledger candidates with explicit member matching and human review. Recording collected cash creates an organizer liability, never a bank-funded balance.
- Ajo contributions cover the oldest unpaid dates, including partial days and advance days within the agreed cycle. Reviews and receipts preserve the exact allocation; replacing collected cash does not count those days twice.
- Ajo invitations have a private rules/fee preview, expiry, rotation and revocation. Membership requires the saver's explicit private acceptance; MCP can prepare that review but cannot accept for them. Represented cash savers require a declared consent record and are never silently linked to another customer's account.
- Cycle fees can be none, one daily contribution or an explicitly fixed amount. The agreed fee is disclosed before joining and taken once from the first payout into the organizer's own wallet. Reviews and receipts separate principal, fee and net; concurrent stale fee reviews fail safely.
- Automatic grouped receipts, recipient copies of internal payments, PNG/PDF receipts, PDF statements and saved bank recipients.
- A responsive web companion with light, dark and device appearance settings.

Provider adapters and offline contract tests are implemented. Model account access, speech/vision quality, WhatsApp delivery and hosted operation must be verified with this project’s separate credentials before a connected demonstration is claimed.

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

The planner supports `AI_PROVIDER=groq` with `GROQ_API_KEY` and `GROQ_MODEL=llama-3.3-70b-versatile`. Groq must actually grant that model to the account: its Llama 3.3 70B and Llama 3.1 8B models are currently enterprise-only. A valid API key alone does not establish access. Run `npm run check:model -- --exercise` to test account availability and a real model → MCP → private approval → sandbox execution journey with fictional data in a disposable in-memory store. The result is saved under ignored `private/`, without keys or raw customer content.

The selected planner is Cloudflare-hosted Meta Llama 3.3 70B. Use `AI_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Run `npm run check:model -- --cloudflare --exercise`. Workers AI’s free allocation is quota limited; no automatic paid upgrade or hidden provider fallback is performed.

The reasoning model is text-only. Images use `IMAGE_PROVIDER=cloudflare` and `CLOUDFLARE_VISION_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct`. Meta vision extracts notebook/account candidates and interprets receipts, screenshots, documents and ordinary photos. A picture of a receipt never credits funds or proves a payment settled. Only reviewed ledger/account operations can change balances.

Speech uses `MEDIA_PROVIDER=gemini` with `GEMINI_AUDIO_MODEL=gemini-3.5-transcribe`. When `INTRON_STT_ENABLED=true` and an Intron key is present, the bounded Gemini and Intron recognizers run together and the first valid verbatim transcript is used. Audio has no payment tools. Speech is not approval. The event runtime keeps its own database, app and WhatsApp credentials. Reusing the owner's speech API keys was explicitly authorized; those keys remain server-side and share their original provider quotas.

Groq speech and vision adapters remain optional, explicitly selected alternatives. They are not the selected image or speech providers. The Meta contribution in the selected configuration is the Llama planner and Llama vision model.

The optional Meta Model API adapters remain available with `AI_PROVIDER=meta`, `MEDIA_PROVIDER=meta` and `MODEL_API_KEY`. They use Muse Spark for planning/vision and Muse Voice Transcribe for speech. Gemini remains an explicitly selected testing adapter. The Docker runtime includes FFmpeg for bounded WAV conversion. No provider is silently replaced by a scripted parser. API keys stay on the server.

`SAM_LEDGER_CROP=true` optionally isolates a notebook page through SAM 3.1 before a second vision pass. Zero/multiple matches or a failed crop retain the original candidate review; the interface never reports an image as segmented unless a crop was actually applied. Enable this only after testing the model access and representative notebook photos.

Use a separate WhatsApp app, test number, webhook and database. Never point this service at another environment's data or callback. PostgreSQL verifies the Supabase certificate with the public CA under `certs/`; certificate verification must remain enabled.

## Deployment and checks

The Node service serves the built web app and API from one origin. `render.yaml` describes this service; it does not provision a database or enable WhatsApp by itself. Set `PUBLIC_ORIGIN` to its HTTPS origin, with no path. Set `WHATSAPP_PUBLIC_NUMBER` to the business number with country code, distinct from `WHATSAPP_PHONE_NUMBER_ID`.

```sh
npm run build
npm test
npm run doctor -- --integration
npm run doctor -- --submission
```

The last two commands check configuration, not real provider success or full submission eligibility. Submission configuration accepts a Meta Model API planner or a Meta generative model selected through Groq/Cloudflare, with separately configured speech and image adapters. Also run `check:model -- --exercise` for the selected provider, test the hosted WhatsApp journey, record the required video and verify public submission links. Prompt Guard is not a generative planner. Keep the repository private while preparing it, then ensure the submitted repository and video can actually be opened by judges.

`npm run check:postgres` additionally tests concurrent approval, immutable and balanced journals, RLS, revisions and statements. It requires `PG_TEST_URL` pointing to a disposable loopback PostgreSQL server's `/postgres` database, creates a uniquely named test database, and drops only that database. GitHub CI supplies its own PostgreSQL service.

Individuals can apply for organizer access with address evidence; registered businesses additionally provide CAC details and evidence. Evidence is encrypted and excluded from the model, workspace responses and public assets. A pending application does not enable organizer tools. An operator can inspect evidence locally using `npm run organizer:review -- --application <id> --inspect`, then use the same command with `--approve --reason <reason>` or `--reject --reason <reason>`. This is product access review, not completed bank KYC. Private inspection exports stay under ignored `private/organizer-reviews/`.

Hosted test organizer access is also an operator action: after an account is opened, `npm run organizer -- --phone <country-code-and-number>` grants access only in the dedicated database marked as PayWella AI. This is test provisioning, not regulatory approval or a self-service permission bypass.

## Execution boundaries

Private plans expire after five minutes. One four-digit PIN approval covers the reviewed revision. The model can read and prepare through MCP; it has no payment-execution tool.

An accepted request is not a completed payment. Provider uncertainty retains the reservation and reconciles the existing reference. Independent tasks can complete separately; receipts describe settled tasks only. Editing invalidates the earlier review. Notifications run independently and cannot turn a settled task into a PIN error.

WhatsApp API acceptance is recorded separately from sent, delivered, read and failed webhook statuses. Signed status callbacks cannot move funds, create customer accounts or roll a read confirmation back to sent. Confirmed rate-limit rejections and receipt-upload failures use bounded backoff; an ambiguous message-send outcome is not automatically repeated. A notification job marked done means Meta acknowledged submission, not proof that a handset received it. Receipts remain available privately even when notification delivery is blocked or unconfirmed.

WhatsApp service, settings, account-opening and review copy is provided in English, Pidgin, Yoruba, Igbo and Hausa. Native-speaker review and full web-copy localization remain release checks. Oversized interactive reviews fall back to a complete text review with its private link instead of silently truncating the authorization URL.

An Ajo cycle has an agreed first date, payout date and member-specific daily amount, bounded to one year in this release. Amounts beyond the remaining cycle are rejected rather than becoming undisclosed fees or an automatic new cycle. Concurrent contributions that change a reviewed date allocation require a fresh review. Older member records without dated contribution evidence remain blocked from new dated collections until their history is reconciled; existing funded balances are not rewritten. Older invitations need an explicit organizer refresh before new agreements. Existing memberships are not cancelled by revoking an invitation.

Capability links are exchanged for HttpOnly, SameSite cookies and removed from the address bar. Web mutations require the configured origin. Owner access is enforced below the model. Conversation, reply, progress and extracted-media state is encrypted and expires after 24 hours; financial evidence remains separate. No raw downloaded image/audio is persisted. Supabase public tables have RLS enabled and anonymous/authenticated browser-role grants revoked; database credentials belong only on the server.

## Scope

This repository contains the WhatsApp and web implementation. Native mobile, crypto, foreign accounts, cards, lending and yield products are outside this build. WhatsApp live calling is not enabled or implemented here; a voice-note demonstration does not demonstrate calling. External-agent OAuth/MCP access is also outside this release.

The bank and bill catalogue contains explicit test fixtures. No Wema partnership, provider pricing, production KYC approval, guaranteed yield or live bank account is implied.

## Event contributions

The implementation is recorded in the repository's dated commits: contextual MCP orchestration, media adapters, reviewed notebook import, approval/revision security, the sandbox ledger and workers, and the responsive web journeys. The supplied PayWella logo and licensed fonts are documented in [ASSETS.md](ASSETS.md). Demonstrations must distinguish actual connected model calls from offline test fixtures.

Current implementation and deployment checks are described by executable tests and `npm run doctor`. Missing credentials are reported explicitly. Internal product, fundraising, registration and planning documents are not distributed here.
