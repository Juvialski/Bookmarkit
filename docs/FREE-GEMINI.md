# Permanently free Gemini

Gemini is optional and currently disabled. No credential is required for OCR, builds, tests, emulator acceptance, online book sources or offline books. Never enable billing, trial billing, paid features, paid grounding or automatic upgrades.

## Backend environment

Configure secrets on existing Supabase project `xxijxuekfsxuzhnujqem`. Backend secret changes do not require an APK rebuild.

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_ENABLED` | `false` | Enable only after verification |
| `GEMINI_FREE_PROJECTS_JSON` | `[]` | Authorized projects, grouped credentials and model attestations |
| `GOOGLE_VERIFIER_SERVICE_ACCOUNT_JSON` | absent | Read-only service account for billing and key ownership checks |
| `GOOGLE_VERIFIER_ACCESS_TOKEN` | absent | Alternative short-lived OAuth token; expiry fails closed |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put Google keys, verifier credentials or service-role keys into `EXPO_PUBLIC_` variables. The app's publishable key and anon JWT are intentionally public; RLS and grants deny writes.

Example roster, with placeholders only:

```json
[
  {
    "id": "your-authorized-project-id",
    "number": "123456789012",
    "authorized": true,
    "billingEnabled": false,
    "keys": ["REPLACE_WITH_SERVER_SECRET", "OPTIONAL_SAME_PROJECT_BACKUP"],
    "models": [
      {
        "id": "gemini-2.5-flash-lite",
        "grounding": true,
        "freeEligible": true,
        "verifiedAt": "REPLACE_WITH_CURRENT_UTC_ISO_TIMESTAMP",
        "freeRpd": 500,
        "externalUsage": 0,
        "dailyLimit": 10
      }
    ]
  }
]
```

For ordinary text only, use verified `gemini-3.1-flash-lite` or `gemini-3.5-flash-lite` entries with `grounding: false` and the actual current free RPD in AI Studio. These requests never include Search tools. The app currently uses deterministic text parsing; this optional backend text route adds no AI dependency to scanning.

Each independently authorized project has one entry. Duplicate IDs/numbers, reused keys across projects, enabled billing, invalid models, 3.x grounding, missing free eligibility, stale/future attestations and invalid limits are rejected. Multiple keys within one project share its quota. Only the first key is active; errors never rotate backup keys. An operator can replace a revoked primary key without gaining quota.

## Configuration

1. Preserve disabled Cloud Billing on every project. Verify model access and actual free allowance in AI Studio. Gemini 2.5 is currently restricted to previously active projects. Documentation alone does not prove your project has access.
2. Record external usage, including other apps and the shared 2.5 Flash/Flash-Lite grounding allowance. Refresh project/model attestations within 24 hours; expired entries stop working.
3. Give the verifier only `resourcemanager.projects.get` and `apikeys.keys.lookup` on the authorized projects. A narrow custom role can grant these. Do not grant billing modification permissions. If verification APIs cannot be used without enabling billing, keep Gemini disabled.
4. Set the secrets through Supabase Dashboard or a private env file passed to the Supabase CLI. Keep credentials outside the repository or in ignored local files. Do not print or commit them.
5. Set `GEMINI_ENABLED=true` only after the roster and verifier are configured. Runtime GET checks bind the project ID to its numeric project, then verify disabled billing, actual key ownership and supported model generation before each request. Missing permissions, unavailable models, expired tokens and outages fail closed.

API keys alone cannot establish billing status or free eligibility. This is why the read-only verifier and fresh project/model attestations are required. The application never modifies Google billing. Project owners must preserve the unbilled state; external billing changes are checked before subsequent generation.

## Quotas and failure behavior

`gemini_project_usage` stores project/model/task, Pacific quota day, attempts, tokens, last request and cooldown. It stores no credentials, queries, OCR or generated results. Reservations are atomic and count failures. Limits are at most 20 requests per project/model/task/day, at least 15 seconds apart, and never above the attested free allowance minus external usage. Google is authoritative for actual usage by all clients and access restrictions.

Identical concurrent queries share an in-flight promise within an Edge Function instance. Completed responses are discarded. Cross-instance requests share durable quota/pacing but do not share response promises.

A 429 immediately returns to free book sources and starts a durable one-hour global Gemini cooldown. Invalid, forbidden or unavailable generation models start a one-day global cooldown. No project, key or model rotation bypasses enforcement. Local exhausted capacity may select another independently authorized, verified free project before any generation request.

Generation has a six-second deadline. Verification calls have two/three-second deadlines, and the app gives optional search an overall 14-second deadline. Gemini never blocks OCR or normal identification. There is no paid allowlist, fallback or upgrade path.

## Ratings and presentation

There is no Goodreads scraping or numerical score extraction from generated text. Grounded search is a transient search aid. Main results use verified Open Library, Hardcover or Google Books ratings and show **Not rated** when none exists.

When configured, Search presents Google's returned Search entry point unchanged, together with grounded text and source links, in a native WebView modal. Grounded content is never added to the catalog. Mobile requests contain only recognized title or corrected title/author/ISBN text; images and raw OCR transcripts stay on-device.

## Official references checked 2026-10-10

- [Gemini 2.5 access and capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
- [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Pricing and grounding allowances](https://ai.google.dev/gemini-api/docs/pricing)
- [Project quotas and Pacific reset](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Billing verification](https://cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo)
- [Key ownership verification](https://cloud.google.com/api-keys/docs/reference/rest/v2/keys/lookupKey)
- [Grounding terms](https://ai.google.dev/gemini-api/terms)

Prices and eligibility can change. Zero spending remains mandatory: unverifiable free access stays disabled.
