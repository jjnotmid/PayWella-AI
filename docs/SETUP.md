# Setup and operation

## Local development

I use Node.js 24 and npm’s committed lockfile. React and the API run from the same origin after `npm run build`; `npm run dev` starts the Node service and does not start a separate Vite development server.

1. Run `npm ci` and copy `.env.example` to `.env.local`.
2. Generate a random secret of at least 32 characters and save it as `APP_SECRET`.
3. Keep `PUBLIC_ORIGIN=http://localhost:4317`, `PORT=4317` and `NODE_ENV=development`.
4. Leave `DATABASE_URL` blank. Local state is created under ignored `.data/`.
5. Run `npm run doctor`, `npm run build`, `npm run seed -- --organizer`, then `npm start`.
6. Open the printed private link. Account setup asks for a name and a four-digit transaction PIN. Reply language can be changed in settings or through the conversation. Use fictional details and test funds.

The link can be exchanged once and expires after five minutes. Rerunning `seed` issues another link without clearing the account. Omit `--organizer` to inspect the ordinary user’s journey. The seed command refuses production mode or a configured PostgreSQL URL.

For voice, install FFmpeg and ensure `ffmpeg -version` works. The Docker image already includes it. Rebuild after frontend changes.

## AI profiles

These variables select real adapters, not scripted responses. Supply credentials only through ignored local files or the hosting provider’s secret store.

### Meta reasoning and vision

```dotenv
AI_PROVIDER=cloudflare
IMAGE_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=<32-character account ID>
CLOUDFLARE_API_TOKEN=<Workers AI token>
CLOUDFLARE_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast
CLOUDFLARE_VISION_MODEL=@cf/meta/llama-4-scout-17b-16e-instruct
MEDIA_PROVIDER=gemini
GEMINI_API_KEY=<speech API key>
GEMINI_AUDIO_MODEL=gemini-3.5-transcribe
```

Provider availability and quotas depend on the account. Verify access rather than assuming a key grants a model. `npm run check:model -- --cloudflare --exercise` makes real inference calls, then uses a disposable in-memory financial store to test three-task preparation, approval and settlement. Its redacted report is written to ignored `private/`.

### Gemini development and testing

```dotenv
AI_PROVIDER=gemini
IMAGE_PROVIDER=gemini
MEDIA_PROVIDER=gemini
GEMINI_API_KEY=<API key>
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_MEDIA_MODEL=gemini-3.5-flash-lite
GEMINI_MEDIA_FALLBACK_MODEL=gemini-3.6-flash
GEMINI_AUDIO_MODEL=gemini-3.5-transcribe
AI_FALLBACK_PROVIDER=
```

This is the last verified hosted testing configuration. It is not Meta inference. The Gemini adapter attaches validated reply-language metadata to responses; that metadata is removed before financial arguments reach MCP.

With `INTRON_STT_ENABLED=true` and `INTRON_API_KEY` set, both speech recognizers start together. The automatic Gemini transcript is preferred so a previous language hint cannot override newly spoken speech; Intron is the regional backup if the primary recognizer fails. Speech output never authorizes a payment.

### Explicit fallback and optional adapters

When Cloudflare is primary, `AI_FALLBACK_PROVIDER=gemini` and a Gemini key enable fallback for eligible inference-availability errors. The wrapper never retries payment execution. Disable that variable when measuring an exclusively Meta run, and inspect the reported provider. Image fallback is configured separately through the image adapter and the optional Gemini image fallback model.

Groq reasoning, speech and vision adapters are available when explicitly selected and granted by the account. Configure `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_SPEECH_MODEL` and, for images, `GROQ_VISION_MODEL`. Do not assume that Groq grants Llama access or that every Groq model is a Meta model.

Meta Model API adapters use `MODEL_API_KEY`, `AI_PROVIDER=meta` and the configured Meta model IDs. Optional `SAM_LEDGER_CROP=true` requires the Meta media path and actual model access. It attempts notebook isolation before a second vision pass. No crop, multiple matches or a failed crop retain the original candidate review; segmentation is not claimed unless applied.

## Hosted service

The Docker image serves the web build, API and worker loop from one origin. `render.yaml` is a deployment template; it does not create a database, provision a WhatsApp number or configure an existing deployment’s secret file.

- Set `NODE_ENV=production`, a stable `APP_SECRET`, `DATABASE_URL` and the public HTTPS `PUBLIC_ORIGIN` with no path.
- For Supabase, use a dedicated database and `DATABASE_SSL_CA=certs/supabase-root-2021.crt`. Keep certificate verification enabled.
- An existing non-PayWella-AI schema is rejected before schema changes. Startup creates the application’s tables; there is no separate migration CLI in this release.
- Configure credentials as server-side environment variables or a Render secret file named `paywella-ai.env`. The container reads `/etc/secrets/paywella-ai.env` if present.
- Configure the health check at `/health`. Provider keys being present does not prove the provider is reachable.
- Keep one stable public origin for cookies, private links and origin validation. Changing it requires checking the complete approval journey.

Free hosting can sleep and inference can be rate limited. This build does not promise instant cold starts, unlimited usage or zero downtime. Durable jobs recover application work; they do not bypass provider availability.

## WhatsApp

Configure these server-side values for the app and number receiving this build’s messages:

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Verify the raw webhook body’s signature. |
| `WHATSAPP_VERIFY_TOKEN` | Answer the webhook verification challenge. |
| `WHATSAPP_ACCESS_TOKEN` | Send messages and download permitted media. |
| `WHATSAPP_PHONE_NUMBER_ID` | Match incoming events and send from the intended number. |
| `WHATSAPP_BUSINESS_ID` | Match the webhook entry’s WhatsApp Business Account ID. |
| `WHATSAPP_PUBLIC_NUMBER` | Public phone number, including country code, digits only, for the web shortcut. |
| `WHATSAPP_GRAPH_VERSION` | Optional API version override in `vN.N` format. |

Set the callback to `https://<service-origin>/webhooks/whatsapp` and subscribe the intended app/number to messages and delivery statuses. Verify the callback and an actual handset exchange. Test-number restrictions can prevent judges from messaging unless their number is approved through Meta; a public website does not remove those restrictions.

This release accepts Nigerian sender numbers. Voice notes are supported; live WhatsApp calls are not implemented. Never put a PIN in a message or voice note. The private approval page is the only transaction-PIN input.

## Organizer access

An individual applies with address evidence. A registered business additionally provides CAC details and evidence. Product-access review does not certify bank KYC. A pending application cannot use organizer tools.

```sh
npm run organizer:review -- --application <id> --inspect
npm run organizer:review -- --application <id> --approve --reason '<review reason>'
```

Inspection exports remain under ignored `private/organizer-reviews/`. Use `--reject` instead of `--approve` to reject with a reason. `npm run organizer -- --phone <country-code-and-number>` is explicit test provisioning for the dedicated database, not a self-service approval bypass.

## Verification commands

| Command | What it establishes |
| --- | --- |
| `npm run build` | Type checking and production frontend compilation. |
| `npm test` | Isolated offline contracts and journeys; no deployment secrets inherited. |
| `npm run check:public` | Known credential patterns and private document paths in the working tree and available Git history. |
| `npm run doctor -- --integration` | Presence and validity of integration configuration. No live success claim. |
| `npm run doctor -- --submission` | Meta-model selection and required submission configuration. No eligibility or connectivity guarantee. |
| `npm run check:agent` | Real configured-model clarification, revision and cancellation checks using an in-memory financial store. Consumes inference quota. |
| `npm run check:model -- --cloudflare --exercise` | Real Cloudflare inference plus isolated preparation, approval and settlement. |
| `npm run check:postgres` | PostgreSQL-specific concurrency, RLS and journal checks in a disposable local database. |

For the last command, `PG_TEST_URL` must identify a loopback PostgreSQL server’s `/postgres` database. The script creates and drops its own uniquely named database. CI provides PostgreSQL 17; never use a customer database for tests.
