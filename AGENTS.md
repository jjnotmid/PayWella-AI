# Repository conventions

- Use Node.js 24 and TypeScript, with the committed dependency lockfile.
- Keep credentials, customer data and internal business documents out of source control and public assets. Use a dedicated application database.
- Preserve actual contribution dates and third-party attribution. Do not rewrite history or imply that an unverified provider call succeeded.
- Keep model and financial integrations behind adapters. Models may inspect owned data and prepare tasks; private approval and financial execution stay deterministic.
- Use integer kobo, balanced append-only postings, revision checks and idempotent execution. Cash collection records must not create funded balances.
- Explain consequential security, ordering or recovery constraints in comments. Avoid commentary that restates the code.
- Run isolated offline checks without deployment secrets. Use disposable local PostgreSQL databases for database verification.
- Keep internal PRDs and operational records outside this repository.
