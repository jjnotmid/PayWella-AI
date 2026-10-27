# PayWella AI

Conversational payments, savings and individual Ajo collection records, with private review before money moves.

Node.js 24, TypeScript, React and PostgreSQL. Local development uses SQLite; hosted deployments require PostgreSQL. Financial adapters use a sandbox ledger and do not send real payments.

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

Use an isolated Gemini key for temporary testing. Set `AI_PROVIDER=meta` and `MODEL_API_KEY` when Meta access is activated. Neither provider is silently replaced by a scripted intent parser. API keys stay on the server.

Use a separate WhatsApp app, test number, webhook and database. Never point this service at another environment's data or callback.

Private plans expire after five minutes. One four-digit PIN approval covers the reviewed revision. The model can read and prepare through MCP; it has no payment-execution tool.

Current implementation and deployment checks are described by executable tests and `npm run doctor`. Missing credentials are reported explicitly. Internal product, fundraising, registration and planning documents are not distributed here.
