# Easebuzz payments and participant tickets

Proposed implementation following the page split, 15 November 2026.

## Booking and payment

1. Save the booking and its participants atomically. Retain the registration ID for recovery.
2. Create a payment attempt with an immutable amount calculated on the server and a unique merchant transaction ID.
3. Send the participant to Easebuzz hosted checkout. Keep merchant keys and salt in server environment variables.
4. Verify the provider callback hash, transaction identifier, merchant and amount. Reconcile transaction status through Easebuzz's server API. Mark payment successful only after verification.
5. Process duplicate callbacks idempotently. Lock the booking during fulfillment so retries create exactly one ticket per participant.
6. Recover late success after a closed checkout using callbacks and reconciliation. Allow users to retrieve the existing booking through authenticated recovery, such as a verified contact channel.
7. Store failed, pending and successful attempts separately. A failed attempt must not downgrade a successful booking.

## Tickets and paid receipt

- Each participant gets a stable unique ticket ID and an independently generated cryptographically random 256-bit QR token.
- Keep a hash of the QR token for lookup. Store the original token encrypted if needed to re-render the same QR for authorized re-downloads.
- The QR contains an opaque token or scanner URL, with no participant name, date of birth or phone number.
- Generate PDFs on the server from verified database records. Provide individual tickets and one booking payment receipt containing amount, currency, transaction reference and verified payment time.
- Attempt the ticket download after the verified-success screen loads and always show a Download tickets button because browsers can block automatic downloads.
- Re-downloads return the same tickets. Payment refunds, revocations and reissues must update scanner validity.
- Use authenticated download authorization or short-lived signed download URLs. A registration ID alone must not authorize access.
- The payment receipt is a payment acknowledgement. Any GST invoice requires the organiser's confirmed legal entity and tax information.

## Gate and food-coupon verification

- Staff sign in to a restricted scanner page. General visitors receive no participant details from a scanned token.
- A read-only scan displays validity, participant name, ticket ID, permitted day and check-in status. Staff explicitly confirm admission.
- Compare the participant with suitable identification where required by the event entry policy. QR validity alone cannot establish the identity of the person holding a copied ticket.
- Record admission atomically with a unique database constraint on ticket ID and event date. Concurrent scans can admit the participant once.
- Show clear outcomes for valid admission, already used, wrong day, unpaid, revoked and unknown tickets. Include the previous admission time for authorised staff.
- A two-day pass permits one admission on each valid date. Re-entry requires an organiser-approved rule and an audited staff action.
- Track food redemption separately with an atomic uniqueness constraint. Calculate age eligibility for the visit date. The organiser must confirm coupon quantities and whether two-day passes receive a coupon on each day.
- Require online verification for the initial release. A network outage must show verification unavailable, with a documented supervisor process. Staff devices should have reliable mobile connectivity.
- Log staff identity, ticket, date, action and time for admissions, overrides and coupon redemptions.

## Tests before release

- Valid, failed, cancelled, pending and late-success payments.
- Incorrect callback hash, wrong amount and wrong transaction reference.
- Repeated callbacks and simultaneous fulfillment.
- One booking with ten participants producing ten distinct tickets.
- Authorized re-download and blocked unauthorized downloads.
- Forged, copied, revoked and wrong-day QR codes.
- Concurrent scans allowing only one admission and one coupon redemption.
- A birthday on the second event day changing food eligibility.
- Checkout closed after payment and successful booking recovery.
- Scanner and provider network outages.

## Inputs needed for implementation

Easebuzz test merchant key and salt, production site/callback configuration, gate staff access, approved ticket branding, organiser receipt details, food-coupon quantities, and the re-entry rule.

Current status: event and registration pages are separated. Payment fulfillment, PDF tickets, QR issuance, scanner login, redemption and recovery remain to be implemented and tested after gateway configuration is supplied.

Provider reference: https://github.com/easebuzz/paywitheasebuzz-php-lib

## Implementation update — 15 November 2026

The ticketing foundation is implemented: Supabase ticket/payment/admission tables, idempotent server-only fulfillment, signed QR codes, protected PDF bundles, verified status on the thank-you page, and an authenticated gate scanner. See TICKETING-SETUP.md for exact deployment configuration and remaining launch requirements. The earlier random-token proposal is implemented as a stable UUID plus domain-separated HMAC-SHA256 instead; no participant information appears in the QR.

Easebuzz initiation, callbacks and reconciliation remain deliberately disabled until integration and provider tests are completed. Food redemption and verified-contact cross-device recovery remain pending. No live payment or paid ticket has been created during testing.
