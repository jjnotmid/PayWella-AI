# Security model

I treat financial authorization as application logic, independent of the reasoning model. These are implemented controls, not a claim of a completed external security audit or production banking certification.

## Implemented controls

- **Private authority:** MCP can read and prepare owned tasks, but cannot execute payments. A four-digit transaction PIN authorizes the reviewed revision. Speech and a conversational “yes” are not authorization.
- **Scoped links:** Random 256-bit capability tokens are stored as hashes, expire after five minutes and exchange once for a purpose-scoped session. Tokens are removed from the address bar after exchange. These are stateful opaque capabilities, not JWTs.
- **PIN storage:** Salted scrypt-derived PIN hashes and constant-time comparison. Five failed attempts trigger a 15-minute lock. The PIN never belongs in a model prompt or WhatsApp message.
- **Browser boundary:** HttpOnly, SameSite=Strict cookies, Secure cookies on HTTPS, exact-origin checks for mutations, no-store responses, no-referrer policy, CSP and frame restrictions.
- **Webhook boundary:** Raw-body signature verification, intended account/phone matching and duplicate-message handling before processing.
- **Money integrity:** Integer kobo, balanced append-only journals, aggregate reservations, revision/digest checks and idempotent execution references. Provider uncertainty reconciles rather than resubmits.
- **Data access:** Owner checks below the model. PostgreSQL RLS is enabled and public/browser-role grants are revoked. Database credentials stay on the server; this is not a browser-to-Supabase data architecture.
- **Sensitive state:** Conversation, reply, extracted-media and progress state is encrypted with 24-hour expiry. Raw downloaded audio/images are not persisted. Financial records remain separate. Organizer evidence is encrypted, excluded from model context and only inspected through explicit operator commands.
- **Operational isolation:** Tests use disposable stores. Seed refuses hosted databases. The PostgreSQL check only accepts loopback and creates its own test database. A schema identity guard rejects an unrelated existing database.

## Threats and limits

| Threat | Control and remaining boundary |
| --- | --- |
| Prompt injection or invented tool calls | Untrusted input, strict tool schemas, ownership checks and no model execution tool. Model quality still needs live evaluation. |
| Stolen private link | Short expiry, single exchange, scoped session and a separate transaction PIN. Protect the receiving device and session as well. |
| Repeated clicks or stale approval | Revision/digest checks, locking and idempotent outcomes. Do not interpret a slow response as a reason to create a second payment. |
| Provider timeout | Preserve the reference and reservation, reconcile outcome, expose pending status. Sandbox behavior is not proof of real-provider semantics. |
| Exposed secrets | Ignored local/secret files, Docker exclusions and repository/history scans. Pattern matching cannot prove the absence of every possible secret. |
| Compromised deployment | Server credentials and application encryption keys are privileged. RLS does not protect against a compromised privileged backend. |

Rate limiting in the HTTP service is process-local; a distributed deployment needs a shared limiter and provider-specific abuse controls. The prototype uses a four-digit PIN and restricted test identities, not production-grade customer identity verification. Real rails require bank-approved onboarding, monitoring, operational controls and an independent review.

## Reporting and handling

Report a suspected vulnerability privately to the repository maintainer. Do not include real PINs, access tokens, private links, evidence files or customer information in public issues. If a credential is exposed, rotate it at the provider and assess affected access; deleting the visible string alone does not revoke it.

The repository intentionally excludes deployment secrets and internal business documents. Third-party asset notices remain in [ASSETS.md](ASSETS.md).
