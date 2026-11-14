# Naya Bharat 2047 launch checklist

Updated 14 November 2026.

## Implemented and checked locally

- The homepage and eight policy pages have distinct titles, descriptions, canonical URLs, Open Graph and X card metadata. Canonicals use the stable public Vercel alias.
- The festival share card is a 1200 × 630 JPEG at `/assets/share.jpg`.
- `/robots.txt` links to `/sitemap.xml`, which lists the homepage and eight policy pages. The thank-you page carries a noindex directive and is omitted from the sitemap.
- Unknown routes and missing policy files return the custom 404 page with links to the homepage, registration, and support.
- The form and server check required participant details, Indian mobile format, email format, valid birth dates, participant limits, declarations, and guardian consent. Field errors identify the participant and focus the field for correction. Duplicate numbers in a booking must be corrected before saving.
- Supabase reserves each mobile across the festival, including single-day and both-day bookings. The migration was applied to the connected project. Simultaneous submissions with the same mobile produced one saved registration and one conflict, and the rejected booking left no partial registration. Retrying the same request returned the original registration ID.
- The booking review shows save failures and offers retry. A successful save opens the thank-you page with a registration ID, booking total and payment-pending status. That page reads the confirmation from the same tab's session storage. Participant details and the registration ID stay out of the URL. Direct visits display guidance for returning to registration.

## Production verification and remaining work

1. Check the homepage, policies, share image, robots, sitemap and missing-page response on the production alias. Preview the public link in WhatsApp and LinkedIn to check how their crawlers display it.
2. Confirm `SUPABASE_URL` and the current `SUPABASE_SECRET_KEY` are configured in Vercel. Apply all three migrations to any new Supabase environment. Rotate the database password and secret key previously shared in chat, then update the local and hosted configuration.
3. Submit a sample production booking. Verify the saved rows, duplicate mobile warning, and thank-you screen on desktop and mobile. Review participant data handling and retention with the organisers.
4. Configure sustained abuse protection for the public registration endpoint using a host firewall rule or a shared rate limiter. Mobile uniqueness protects existing records and does not limit submissions with new numbers.
5. Integrate Razorpay orders, signed payment verification, webhooks, and ticket confirmation after test credentials are available. Saved registrations currently remain pending.
6. Verify ownership in Search Console and submit the production sitemap. Analytics, if desired, requires a GA4 property and consent controls. The site currently loads no analytics tags.
