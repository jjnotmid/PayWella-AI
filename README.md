# PayWella AI

**An MCP-powered financial agent for payments, savings and Ajo, through WhatsApp text, voice notes and photos.**

I’m building PayWella AI for people who already coordinate money on WhatsApp: Ajo organizers keeping paper records, members tracking contributions, and everyday users paying bills or supporting family. One conversation can become several tasks, with one private review and transaction PIN before execution.

[Open the web companion](https://paywella-ai.onrender.com) · [Set up locally](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Demo walkthrough](docs/DEMO.md) · [Security](SECURITY.md)

## Access for reviewers

**The website is public, but the connected WhatsApp demo currently uses a restricted Meta test number.** Only approved recipient numbers can use that number. A message from an unapproved number may not reach this application, so opening the WhatsApp link does not guarantee access to the conversation.

The web companion also requires a private account or approval session. It does not currently offer public self-service test accounts. Opening the landing page is not enough to enter an authenticated workspace, and I do not publish a shared account, PIN or session link.

Please use the demo video supplied with the submission to inspect the connected WhatsApp journey, and [the walkthrough](docs/DEMO.md) to follow its steps. For independent hands-on review, [the local setup](docs/SETUP.md) creates an isolated account with fictional funds and a PIN you choose. Forms, approval, ledger and receipts can be tested without API keys; natural-language, image and voice requests require your own configured model access. This is a local reproduction route, not unrestricted access to the hosted WhatsApp number. All financial execution uses simulated funds.

## What you can do

| Journey | Implementation |
| --- | --- |
| Give several instructions | Prepare up to five payments, savings or Ajo tasks together; preserve details through clarification and edits. |
| Pay and save | Bank transfers, PayWella transfers, airtime, data, prepaid electricity and named savings goals. Financial execution uses a sandbox ledger. |
| Manage Ajo | Organizer books, member invitations and consent, dated contributions, cash records, cash replacement and reviewed payouts. |
| Photograph a notebook | Extract candidate names and amounts, match members and review the import. A photo does not prove funds arrived. |
| Send account details as a picture | Extract account candidates for confirmation before preparing a transfer. Receipts and screenshots are interpreted as evidence, not payment authorization. |
| Change language naturally | English, Nigerian Pidgin, Yoruba, Igbo and Hausa. The current utterance guides the response; bare digits retain the conversation’s language. |
| Review and approve | Edit the batch, inspect recipients and fees, then authorize the exact revision with a four-digit transaction PIN. |
| Follow the outcome | Per-task pending, failed and completed states, grouped receipts, PNG/PDF exports and statements. |
| Automate savings | Explicitly approved daily or weekly instructions with bounded dates; insufficient-funds and offline missed runs are skipped. |

## How it works

```mermaid
flowchart LR
    U[WhatsApp or web] --> I[Signed inbox or private session]
    I --> M[Speech and image adapters]
    I --> A[Conversational agent]
    M --> A
    A <--> MCP[Owner-scoped MCP tools]
    MCP --> P[Validated task plan]
    P --> R[Private review and four-digit PIN]
    R --> W[Durable workers and balance reservations]
    W --> L[Sandbox rail and double-entry ledger]
    L --> O[Web receipts and WhatsApp delivery]
```

I use the MCP SDK for tool discovery and invocation inside the server. The agent can inspect owned data and prepare tasks, but the tool registry contains no payment-execution tool. Independent work overlaps; tasks sharing a dependency retain their order. A single approval does not mean a batch is all-or-nothing: each task has its own recorded outcome.

## Models and runtime

**Built with Llama in the Meta configuration.** Meta model terms and attribution are recorded in [NOTICE.md](NOTICE.md); they are separate from the licence for my application code.

| Layer | Meta configuration | Testing configuration |
| --- | --- | --- |
| Reasoning and MCP planning | Meta Llama 3.3 70B on Cloudflare Workers AI | Gemini adapter |
| Image interpretation | Meta Llama 4 Scout on Workers AI | Gemini image adapter |
| Voice-note transcription | Gemini dedicated transcription; optional Intron backup | Same speech adapters |
| Application | Node.js 24, TypeScript, React, PostgreSQL on Supabase, Docker on Render | SQLite for local development |

The hosted build was last verified using the Gemini testing profile. The Meta profile is implemented, but the final submission must be exercised with Meta inference active. A configured model name or a passing offline test is not evidence that a live model call succeeded. Optional adapters are documented in [Setup](docs/SETUP.md).

## Run locally

Use Node.js 24. Install FFmpeg if you want to test voice notes.

```sh
npm ci
cp .env.example .env.local
```

Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, then save it as `APP_SECRET` in `.env.local`. Leave `DATABASE_URL` blank for local SQLite.

```sh
npm run doctor
npm run build
npm run seed -- --organizer
npm start
```

Open the private link printed by `seed`, complete account setup and choose your own four-digit PIN. Links expire after five minutes; rerun `seed` for another link. The local account starts with ₦500,000 of test funds. Forms, review, ledger and receipts work without an AI key; conversational requests need a configured provider. The seed command refuses hosted databases.

## Check the implementation

```sh
npm run build
npm test
npm run check:public
```

The latest application verification passed 84 offline tests and CI’s PostgreSQL checks. Coverage includes compound requests, clarification memory, revisions, duplicate approval, concurrent ledger changes, pending recovery, Ajo consent/allocation, schedules, delivery and language metadata. [The workflow](.github/workflows/ci.yml) runs these checks on pushes and pull requests. Offline tests use isolated fixtures and do not consume provider credits.

See [the demo guide](docs/DEMO.md) for connected-model checks, a repeatable walkthrough and the remaining submission gates.

## Repository map

- [`src/ai/`](src/ai/) contains orchestration, MCP tools, language and media adapters.
- [`src/core.ts`](src/core.ts), [`src/ledger.ts`](src/ledger.ts) and [`src/worker.ts`](src/worker.ts) own planning, execution and background work.
- [`src/server.ts`](src/server.ts) serves the private API, web app and WhatsApp webhook.
- [`web/`](web/) contains the responsive companion, review, organizer application and notebook-import interfaces.
- [`tests/`](tests/) and [`scripts/`](scripts/) contain isolated checks and operator commands.

## Build scope

This repository contains WhatsApp messaging and the web companion. Financial rails and service catalogues are simulated; it does not move real bank money or establish a banking partnership. Native mobile, live WhatsApp calls, crypto, cards, foreign accounts, lending and yield products are outside this release. Public ChatGPT/Claude MCP access is also outside this release.

My event contribution map is in [CONTRIBUTIONS.md](docs/CONTRIBUTIONS.md). Assets and third-party licences are recorded in [ASSETS.md](ASSETS.md). Commit dates remain intact. Internal product, company, registration and fundraising documents are excluded from this repository.

## Licence

I release the original application source code in this repository under the [MIT License](LICENSE). The PayWella name and logo are excluded from that grant; third-party libraries, fonts and model services retain their respective terms. See [ASSETS.md](ASSETS.md).
