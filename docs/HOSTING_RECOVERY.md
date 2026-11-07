# Hosting recovery

I prepared this operational fix on November 7, 2026 after Render suspended the workspace for exhausting its shared outbound-bandwidth allowance. The submitted application is still available at commit `b9403fa`; recovery work lives on `fix/request-driven-hosting`. This document does not change the hackathon contribution dates or claim the recovery work was built before submission.

## Why the original deployment consumed bandwidth

The original Node process called multiple PostgreSQL job-claim transactions every 300 milliseconds, including when no work was waiting. Render counts service-initiated public-network traffic, including requests to an external Supabase database. The replacement checks which job kinds are runnable before claiming anything and runs background work when a signed WhatsApp webhook or authenticated application request arrives.

## Vercel deployment

The React build is served as static assets. `/api/*`, `/webhooks/whatsapp` and `/health` use the Node.js 24 function in `api/index.ts`. The existing dedicated Supabase database and application encryption secret are retained. Secrets are configured only in the project's server-side environment; `.vercelignore` excludes local credentials, internal documents and private data.

The function registers processing through `waitUntil`, with a bounded drain and existing PostgreSQL leases and idempotency protections. It does not create intervals or run schema migrations on cold starts. The database identity is checked before use, certificate verification stays enabled, and `attachDatabasePool` releases idle PostgreSQL connections when Vercel suspends an instance. FFmpeg is bundled for voice-note decoding.

Static fingerprinted JavaScript and CSS can be cached for one year. Public brand images and fonts can be cached; authenticated API responses, authorization pages and receipts retain `no-store`. The worker is never started by a public static-asset request or an unsigned webhook.

## Recovery and limits

New requests wake processing immediately. A daily authenticated `/internal/recover` job performs cleanup and recovers durable work when there has been no other traffic. Set a random server-side `CRON_SECRET`; the endpoint rejects requests without it. Hobby cron timing is approximate, so daily savings may run after the nominal 09:00 Lagos time. This is not a substitute for production scheduling with a precise delivery guarantee.

A short retry can finish within the same invocation. Work delayed beyond its budget, or interrupted by platform termination, remains in PostgreSQL for a later request or recovery sweep. Provider outcomes that are uncertain are not automatically resubmitted. Existing approval, balance reservations, dependency ordering and receipt rules remain authoritative.

The Docker/Render entry point uses immediate request wakeups plus a one-minute recovery sweep. Vercel has no continuous sweep. Free hosting, database and AI quotas still apply. This personal hackathon deployment does not establish that Vercel Hobby can host the commercial service indefinitely.

Sources: [Render outbound bandwidth](https://render.com/docs/outbound-bandwidth), [Vercel background tasks and database pools](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package), [Hobby plan](https://vercel.com/docs/plans/hobby), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Verification

`tests/hosting.test.ts` checks that idle work stops making database requests, drafts stay unapproved until the correct PIN is entered, concurrent wakeups cannot debit twice, short retries run, distant retries stay durable, unsigned webhooks cannot wake work, successful signed requests and approvals wake the worker, and private responses stay uncached.
