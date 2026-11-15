# Ticketing implementation plan — 15 November 2026

Approved scope: preserve separate event/registration pages; prepare verified-payment-only PDF tickets and gate verification while Easebuzz remains disabled.

1. Add server signing and authorization helpers, migration for verified payments, stable participant tickets and atomic per-day admissions. Test forged/expired tokens, wrong amount, repeated fulfillment and repeated admission.
2. Add protected booking status/PDF endpoint and thank-you download controls. A browser cannot mark a booking paid. Produce a booking acknowledgement and a page per participant, preserving QR identity on re-download.
3. Add Supabase-authenticated staff scanner with an explicit server UUID allowlist. Inspect first, confirm admission separately, fail closed offline. No public participant lookup.
4. Add deployment allowlist, environment setup and operational documentation. Run local database and API tests, apply migration, verify local HTTP and commit changes.

Deferred until supplied: Easebuzz adapter with hash and server reconciliation tests; staff user assignment; confirmed food-coupon quantity; verified-contact recovery. Do not activate payments simply by adding credentials.

QR implementation refinement: stable UUID plus domain-separated HMAC-SHA256, rather than storing encrypted random QR secrets. The HMAC is deterministic and unguessable without the server key; it contains no PII. Keep the signing key stable and private.
