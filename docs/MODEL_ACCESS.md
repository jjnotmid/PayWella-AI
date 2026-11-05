# Model access and development constraints

I am Usifoh Joshua, an independent developer and a student at the University of Lagos. I built this entry with a limited personal budget. I am documenting the model-access difficulties I encountered so reviewers can distinguish the implemented integrations from the provider access I could verify.

## Direct Meta Model API

I attempted to activate direct Meta Model API access, but my card was not accepted during the account-verification process. I therefore could not complete activation and use that route for the final connected checks.

## Cloudflare-hosted Meta models

I integrated Meta Llama 3.3 70B for reasoning and Llama 4 Scout for image interpretation through Cloudflare Workers AI. Limited connected Llama reasoning checks succeeded, including asking for a missing bank and retaining a three-task instruction when the bank was supplied. Those checks do not establish that the complete final Meta-powered journey passed.

Further inference was blocked by an account-quota response. During checks on 5 November 2026 UTC:

- The dashboard and inference requests used the same account ID.
- The dashboard showed **0/10,000 Neurons used today** after the documented 00:00 UTC reset.
- A minimal request containing only “Reply OK.” with a two-token output limit still returned **HTTP 429, code 4006**, stating that the daily free allocation was exhausted.
- Both the OpenAI-compatible endpoint and the native Workers AI endpoint returned that quota error, independently of the PayWella planning code.
- I created a new Workers AI token. Token verification confirmed that it was active, but inference remained blocked.
- The available token did not authorize access to account usage analytics, so I could not independently inspect Cloudflare's internal usage counter.

The observed mismatch points to Cloudflare-side quota enforcement or reporting. The precise internal cause has **not** been confirmed by Cloudflare. Cloudflare's [pricing documentation](https://developers.cloudflare.com/workers-ai/platform/pricing/) specifies the daily reset; its [error reference](https://developers.cloudflare.com/workers-ai/platform/errors/) describes account-level allocation limits.

## Other access routes I checked

I checked my Groq account's available models and OpenRouter's live model catalogue. My Groq account did not expose a Meta generative reasoning model; its Meta entries were Prompt Guard safety classifiers. The Llama models available in OpenRouter's catalogue did not have free pricing at the time of the check. These were access and catalogue checks, not successful alternative deployments.

I did not have the funds to purchase additional credits or enterprise model access before the submission deadline. Availability here reflects the account entitlements and catalogues I checked during the event.

## Actual runtime and verification boundary

I kept the Gemini testing profile active so the application could continue to be tested. The Meta adapters remain in the submitted source, but a complete final Meta-powered end-to-end execution remained unverified at submission.

The implementation includes MCP tool discovery and invocation, owner-scoped planning, private revision-bound PIN approval, durable task processing, Ajo records and a sandbox ledger. Those application controls and their offline tests are separate from successful access to a hosted model. Financial execution uses fictional funds and simulated rails.

This note separates the implementation work, the connected checks I completed and the provider access that remained unavailable.
