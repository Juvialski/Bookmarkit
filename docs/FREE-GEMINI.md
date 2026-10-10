# Permanently free Gemini

Gemini is optional. OCR, normal book lookup, source ratings, Goodreads links and the offline catalog remain available when it is disabled or unavailable. Never enable Cloud Billing, trials, paid models, paid grounding or automatic upgrades.

## One-time setup

Use the existing Supabase project `xxijxuekfsxuzhnujqem`. Backend changes require no APK rebuild. A project owner or an authorized setup agent performs this once:

1. Select an existing Google project with **no linked billing account** and inspect its actual free model quotas in AI Studio. Reuse its server-side Gemini key.
2. Save `GEMINI_API_KEY`, `GEMINI_PROJECT_ID` and `GEMINI_PROJECT_NUMBER` as Supabase Edge Function secrets. Ordinary text defaults to `gemini-3.5-flash-lite`; `GEMINI_TEXT_MODEL=gemini-3.1-flash-lite` is also supported. Set `GEMINI_GROUNDING_MODEL=gemini-2.5-flash-lite` only after confirming this project's access to free Search grounding; otherwise omit it.
3. Configure the automatic read-only verifier, then set `GEMINI_ENABLED=true`. No recurring timestamps, daily attestations or roster JSON are needed.

The simple setup caps each model/task at five attempts per Pacific day, spaces attempts by at least 15 seconds, and counts failures. Google enforces the actual project quota, including usage by other apps; local limits do not claim to measure that usage.

## Automatic billing safety

An API key does not prove Cloud Billing is disabled. Google's billing lookup requires OAuth and `resourcemanager.projects.get`. The verifier binds the textual project ID to its number, checks `billingEnabled=false` with no linked billing account, verifies the Gemini key's owning project and non-purged key resource, and checks the model's generation capability. Billing is checked again after the durable quota reservation, immediately before generation.

The setup agent can create a dedicated `bookmarkit-free-verifier` service account with a project-scoped custom role containing **only**:

- `resourcemanager.projects.get`
- `apikeys.keys.lookup`

Enable only the non-billing management APIs needed for these read-only checks: Cloud Resource Manager, Cloud Billing API and API Keys API. Enabling a read-only management API is not linking a billing account. If Google requires billing or denies verification, stop and keep Gemini disabled.

Save the verifier's JSON credential directly as `GOOGLE_VERIFIER_SERVICE_ACCOUNT_JSON` in Supabase. The backend automatically exchanges signed assertions for short-lived tokens using read-only OAuth scopes. It has no billing-change permission. The setup agent handles IAM and JSON; the app user has no daily task. A short-lived `GOOGLE_VERIFIER_ACCESS_TOKEN` remains available for diagnostics, but it is unsuitable for ongoing activation because it expires.

Every generation requires current successful checks. Revocation, permission loss, unavailable models and verification outages fail closed. A check cannot prevent a project owner changing billing between the final check and Google's receipt of the generation request. Owners must preserve the unlinked state; this is **not a guarantee of permanent zero spending if billing is externally changed**. The backend intentionally refuses any observed linked/billable or unverifiable project.

## Multiple independently authorized projects

Advanced operators may still use `GEMINI_FREE_PROJECTS_JSON`, which takes precedence over individual project secrets. Entries retain `id`, `number`, `authorized:true`, `billingEnabled:false`, `keys`, and `models` with `id`, `grounding`, `freeEligible:true`, `dailyLimit`, `freeRpd` and `externalUsage`. Limits must be positive integers, at most 20 local attempts/day and no greater than configured free capacity minus reserved external usage. `verifiedAt` is no longer needed. Live checks, not a timestamp, decide whether generation is allowed.

Keys in one project share quota; only the primary key is used. Duplicate IDs/numbers and keys are rejected. Independently authorized projects may provide local capacity before generation, but a provider restriction never triggers key/project/model rotation.

## Failures and book sources

A 429 returns immediately to existing book sources and opens a durable global one-hour circuit. HTTP 400/401/403/404 opens a one-day circuit for invalid keys, unsupported grounding or unavailable models. An in-instance circuit also blocks requests if saving the cooldown fails. Verification and quota-store failures make no generation request. Generation has a six-second deadline; checks have two/three-second deadlines.

Normal structured lookup stays first: Supabase, Open Library, Google Books, configured Hardcover and offline SQLite. Gemini is a transient aid through the existing optional Search action; the backend text route normalizes recognized title/author/ISBN text without Search tools. This change does not add an automatic mobile OCR text request or new settings screens.

Generated text never becomes an authoritative rating, series classification or catalog record. Grounded answers require Google's Search entry point, sources and grounding supports. The existing mobile WebView presents the returned attribution and links. Responses are not persisted; only usage counters are stored. Images and raw OCR stay on-device.

## Secret handling and deployment

Never place Gemini keys, verifier credentials or service-role keys in `EXPO_PUBLIC_` variables, mobile code, APKs, logs, screenshots or commits. Preserve unrelated Supabase secrets. Temporary downloaded verifier credentials must be protected and removed after saving them.

Deploy `supabase/functions/book-search/` to the existing function. Its helper modules must match `server/src/`; an automated test checks parity. Verify the existing `gemini_project_usage`, `gemini_circuit`, `reserve_free_gemini`, `cooldown_free_gemini` and `record_free_gemini` objects rather than recreating them. No database migration is required by this simplification.

## Official references checked 2026-10-10

- [Pricing](https://ai.google.dev/gemini-api/docs/pricing): 2.5 Flash-Lite free Search grounding is listed up to 500 RPD shared with Flash; 3.1 and 3.5 Flash-Lite Search grounding is not available on the API free tier.
- [Actual project limits and Pacific reset](https://ai.google.dev/gemini-api/docs/rate-limits)
- [2.5 Flash-Lite access](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
- [Billing verification and permission](https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo)
- [Key ownership and purged keys](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/keys/lookupKey)
- [Grounding terms](https://ai.google.dev/gemini-api/terms)

Published pricing is not proof of a particular project's eligibility. Verify the actual unbilled project and model access before activation.

## Activation evidence: 2026-10-10

Configured existing Google project `gen-lang-client-0535130105` (number `1058356562207`) and existing Supabase project. Live OAuth checks returned HTTP 200 for project identity, unlinked billing and key ownership. Model metadata checks succeeded for `gemini-3.5-flash-lite` and `gemini-2.5-flash-lite`. AI Studio showed free quotas of 500 RPD for 3.5/3.1 Flash-Lite text and 20 RPD for 2.5 Flash-Lite generation.

Exactly two generation attempts were reserved: one 3.5 text request recorded 35 provider tokens, and one 2.5 grounded request was rejected. The text result was discarded by the previous RPC empty-body parsing bug; that bug is now fixed and regression-tested. A corrected hosted text response has **not** been verified because the grounded rejection opened the existing global safety circuit until **2026-10-11 07:46:02 UTC (15:46:02 Asia/Manila)**. The cooldown was preserved; no model/key/project rotation or restriction bypass occurred.

`GEMINI_ENABLED=true` and the 3.5 text model are configured, but the existing circuit temporarily prevents generation. `GEMINI_GROUNDING_MODEL` is empty after the rejected live probe. The mobile availability endpoint correctly returns `disabled` for grounded Search. Free Google Search is **not working** for this setup. Published 2.5 documentation limits access for new projects; the exact provider error was not retained, so that restriction is a possible explanation, not a confirmed diagnosis. No billing was enabled to access provider logs.

The existing quota tables/RPCs were verified, with RLS and service-role-only permissions. The central catalog still contains 25,265 works. Live normal multi-source lookup resolved Warbreaker by Brandon Sanderson with an attributed Open Library rating and unknown series status. No mobile code, catalog data or APK was changed. The temporary credential files were protected and emptied after setup; no plaintext credential material remains in those files.

The GitHub monthly refresh secret exists and was supplied to the latest run. Run `38033708104` failed during catalog upload with HTTP 500; the workflow cannot yet be called operationally verified. No complete catalog refresh was rerun for this setup.

## Maintenance verification: 2026-10-10

The private `book-search` verification task checks the current unlinked billing state, numeric project binding, key ownership, and model metadata without reserving quota or generating content. It requires service-role authorization, validated by the existing service-only circuit table when the caller's valid service JWT differs from the function's injected JWT. Anonymous callers cannot use it. It does not prove provider generation or Search eligibility.

Run `python scripts/verify_gemini.py` using existing authenticated Supabase CLI access. Credentials are captured in process memory and never printed. Hosted verification confirmed billing disabled, existing key ownership, and 3.5 Flash-Lite model availability; grounding returned `disabled`. Usage remained one text attempt/35 tokens and one grounded attempt/zero tokens. The original circuit remains active until `2026-10-11T07:46:02.860232Z`.

After October 11, 2026 at 3:46:03 PM Philippine time, an authorized operator can run `python scripts/verify_gemini.py --live-text`. It rechecks billing/key/model configuration and the hosted circuit, then permits at most one 3.5 text request and reports usage afterward. It refuses an active cooldown or enabled grounding and has no automatic generation retry. Do not repeat a failed provider request or enable billing. No corrected live text response was attempted during this maintenance run.
