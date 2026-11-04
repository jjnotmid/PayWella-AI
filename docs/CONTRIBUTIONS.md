# Event contribution map

I use the repository’s original dated commits to show the implementation work and its progression. This map points reviewers to the relevant source and tests; it does not replace the event’s eligibility rules or claim that a model ran merely because an adapter exists.

| Work recorded in this repository | Where to inspect |
| --- | --- |
| Contextual multi-task planning, follow-up memory and grounded recipient candidates | `src/ai/agent.ts`, `src/ai/bank-grounding.ts`, `tests/agent.test.ts`, `tests/transfer-grounding.test.ts` |
| MCP discovery, owner-scoped tools, read concurrency and preparation boundary | `src/ai/mcp.ts`, `tests/agent.test.ts`, `tests/money-help.test.ts` |
| Meta-hosted Llama adapters and configurable media/inference adapters | `src/ai/cloudflare.ts`, `src/ai/cloudflare-vision.ts`, `src/ai/media.ts`, `tests/cloudflare.test.ts`, `tests/multimodal.test.ts` |
| Single-use approval capabilities, private sessions, revisions and one-PIN batch approval | `src/security.ts`, `src/server.ts`, `src/core.ts`, `tests/http.test.ts`, `tests/plan-state.test.ts` |
| Double-entry sandbox ledger, reservations and durable recovery | `src/ledger.ts`, `src/db.ts`, `src/worker.ts`, `tests/core.test.ts`, `scripts/postgres-check.ts` |
| Reviewed notebook import, organizer/member consent, dated collections and payout fees | `web/import-review.tsx`, `src/ajo-allocation.ts`, `src/ajo-terms.ts`, `tests/ajo-import.test.ts`, `tests/ajo-agreements.test.ts`, `tests/ajo-allocation.test.ts` |
| Bounded recurring savings and explicit standing consent | `src/savings-schedules.ts`, `tests/savings-schedules.test.ts` |
| WhatsApp ingestion, status tracking and independent receipt delivery | `src/whatsapp.ts`, `src/whatsapp-delivery.ts`, `tests/whatsapp-e2e.test.ts`, `tests/whatsapp-journeys.test.ts` |
| Responsive web journeys, appearance controls, receipts and exports | `web/`, `src/receipt-image.ts`, `src/receipts.ts`, `src/statements.ts` |

The repository’s first commit is dated October 27, 2026; subsequent commits record the implementation and integration work. Documentation improvements retain their actual commit dates. I do not rewrite timestamps or manufacture intermediate development history.

## Dependencies and supplied assets

The project uses the MCP SDK, React, Node.js, PostgreSQL, Zod, PDFKit, Resvg, Lucide and provider APIs. Package dependencies and versions are recorded in `package.json` and `package-lock.json`; their respective licences remain applicable. The supplied PayWella brand asset and bundled font licences are documented in [ASSETS.md](../ASSETS.md). These dependencies and assets are not presented as newly invented model architectures or third-party tooling.

Live inference and financial fixtures are separate. Tests use fictional identities and simulated provider outcomes. The demo must identify the actual model configuration and show only functionality genuinely implemented for the submitted entry. Internal company plans and unrelated projects are not part of this repository.
