# Demo and verification guide

I demonstrate the connected conversation and private approval journey, while keeping financial execution on test funds. Workflow animations can explain architecture, but they are not evidence of provider calls.

## Start here

The [hosted web companion](https://paywella-ai.onrender.com) provides the WhatsApp shortcut. Full workspace and approval pages need a private account/session link. There is no shared public PIN and no judge backdoor.

Meta test-number restrictions may require a recipient to be approved before they can message the number. If that blocks remote review, use the local setup in [SETUP.md](SETUP.md) to inspect forms, approval, ledger and receipts with fictional data. Model requests still need the reviewer’s configured API access. A recording should show the connected route without implying unrestricted judge access.

## Walkthrough

1. **Account:** Open the private setup link from WhatsApp or local seed, set up the test account and select a four-digit transaction PIN. Set the reply language in settings or simply speak a supported language. Never enter that PIN in chat.
2. **Compound instruction:** Send a text or voice note: “Send 2,000 naira to account 0123456789 at OPay, save 3,000 for Laptop and save 2,000 for Rent.” These are fictional test details, not a live bank destination.
3. **Clarify and edit:** Try omitting the bank, then answer “OPay.” All three tasks should remain. Change only Rent to 1,500 and verify the transfer and Laptop task are unchanged.
4. **Approve:** Open the private review, inspect all recipients, amounts and fees, and enter the PIN once. The page should move to processing and show per-task outcomes, rather than ask for another approval.
5. **Receipts:** Inspect the grouped web receipts, exported receipt and WhatsApp delivery. A queued or accepted notification is not proof of handset delivery.
6. **Notebook:** Use an authorized organizer account and a fictional notebook image. Inspect extracted names and amounts, match each member and review the import. Confirm that a cash record creates a liability rather than a funded balance.
7. **Member:** Preview an invitation’s terms, accept privately and inspect dated contributions and payout details. Check that fees and net payout are disclosed.
8. **Language:** Change between supported languages in the conversation without visiting settings. Bare amounts or account digits should preserve the previous language.

For the three-minute video, prioritize one clear compound instruction, private approval, actual outcomes and a reviewed notebook import. Identify the actual inference provider/model used in the recording. Do not describe Gemini testing footage as a Llama run, simulated settlement as a live bank transfer or voice notes as live calls.

## Failure checks

| Check | Expected result |
| --- | --- |
| Wrong PIN | No approval; useful retry state and bounded attempts. |
| Edit, then approve an old review | Stale revision is rejected; no debit from the old version. |
| Repeat the approval | Existing outcome; no second payment. |
| Missing bank or malformed account | Focused clarification, retained task details, no guessed digits. |
| Insufficient funds | No unfunded execution; reserved amounts are not counted as free cash. |
| Pending provider result | Pending state and reconciliation of the original reference. |
| Mixed task outcomes | Individual receipts/outcomes, no claim that every task succeeded. |
| Interrupted organizer upload acknowledgement | Check application state before attempting another submission. |
| Unreadable image or unclear speech | Clarification; no fabricated extraction or movement. |
| Notification failure | The settled payment remains settled and its private receipt remains available. |

## Evidence already checked

At commit `8c93a3e`, the application passed 84 offline tests, the build, CI’s PostgreSQL check and the public-source scan. Hosted checks verified the served asset versions, database health, WhatsApp configuration and rejection of anonymous workspace access. Live Gemini checks covered Pidgin → Yoruba → Igbo → Hausa → English without financial movement. These checks do not certify all language quality, Meta-provider behavior or real banking readiness.

CI’s current result is available in the repository’s Actions tab. Re-run model and handset checks after any provider/configuration change.

## Final submission checks

- Exercise Meta reasoning and image inference with the intended submission credentials and sufficient quota. The last verified hosted profile used Gemini.
- Confirm a complete hosted WhatsApp voice-note → private review → PIN → web/WhatsApp receipt journey under that final profile.
- Check the final notebook/member journey and judge access without a maintainer’s browser session.
- Make the submitted repository public and verify it while signed out. Public source does not expose a private session or grant test-number access.
- Attach an accessible three-minute demo video and list every actual contributor in the submission.
- Check the organizer’s current rules and submission deadline directly; configuration checks are not an eligibility decision.

The README and code are inspectable without credentials once the repository is public. Financial demonstration remains on sandbox rails.
