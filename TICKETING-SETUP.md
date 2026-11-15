# Ticketing setup and launch checks

## Implemented
- Event details at `/`; registration at `/register.html`.
- Signed, seven-day booking access issued when saving a registration. Registration ID alone cannot download tickets.
- Database payment fulfillment rejects wrong amounts, creates one stable ticket per participant and handles repeated matching fulfillment idempotently.
- Server-generated PDF bundle: payment acknowledgement plus individual participant ticket pages with unique signed QR codes. Re-download preserves each ticket identity.
- Thank-you page checks database payment status, attempts download on verified payment, and retains a manual download button.
- Staff scanner at `/scanner.html`: Supabase login, server-verified user and explicit UUID allowlist, inspect before admission, atomic one-admission-per-ticket-per-day record.
- Paid status alone is insufficient: matching non-revoked verified payment is also required. Revoked tickets are rejected.
- Production build copies only public site assets; server files, migrations and environment files are excluded.

## Vercel environment
Keep existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` server-only.
Add `TICKET_SIGNING_SECRET`: at least 64 random characters, generated with Node `crypto.randomBytes(32).toString('hex')`. Use the same value locally and in Production. Keep it stable: changing it invalidates issued QR codes and booking links.
Add `SUPABASE_PUBLISHABLE_KEY`: your Supabase publishable key for staff sign-in.
Add `SCANNER_STAFF_IDS`: comma-separated Supabase Auth user UUIDs explicitly authorised by the organiser. Create individual staff accounts in Supabase Auth; do not use shared passwords. Without this value, nobody can verify tickets.
Redeploy after configuring variables. Never put the secret key or signing secret in client JavaScript.

## Still required before paid launch
1. Integrate Easebuzz test credentials and hosted checkout. The current payment endpoint deliberately returns 503 even if credentials are added.
2. Implement hash validation and server-to-server reconciliation of merchant, transaction, amount, currency and final success before invoking `fulfill_festival_payment`. Never invoke fulfillment from a browser response. Test failed/pending/cancelled/late/duplicate callbacks and concurrent fulfillment.
3. Add immutable payment-attempt records and recovery/reconciliation. No cross-device booking recovery or payment callbacks are implemented in this release. Existing bookings without a signed access token require support; do not re-register using a duplicate phone number.
4. Assign gate staff and test real staff login, phones, HTTPS camera permissions, connectivity and simultaneous scans. Camera support depends on BarcodeDetector availability; a hardware QR reader or decoded-text input is provided as fallback.
5. Confirm food-coupon quantities and daily rules before enabling redemption. This release does not issue or redeem food coupons.
6. Confirm receipt issuer/tax details. The PDF is a payment acknowledgement, not a GST invoice.
7. Provide an organiser-supervised outage and re-entry process. Current policy is online-only and one entry each selected day. No override UI is provided.
8. Test downloads using actual participant names. The bundled OFL-licensed Noto Sans Devanagari font supports Latin and Devanagari; additional scripts need suitable font fallbacks before launch.
9. Add shared abuse/rate controls at the hosting/WAF layer before opening paid checkout.

A QR cannot prevent a screenshot being copied. The gate must check identity; the database prevents a second admission. Never treat the visual appearance of a ticket as proof of payment.

## Verification
`npm test` runs isolated PostgreSQL-compatible database tests, signature tests and mocked API PDF/unpaid-download tests. No live payment is made. `npm run build` creates the public deployment folder.
Staff authentication follows the Supabase server user verification API: https://supabase.com/docs/reference/javascript/auth-getuser
