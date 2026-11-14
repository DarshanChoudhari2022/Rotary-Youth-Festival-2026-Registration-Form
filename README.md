# Naya Bharat 2047 registration

The form sends reviewed bookings to `POST /api/register` on Vercel. The endpoint validates the booking, and Supabase saves the registration and participant rows together. A saved registration remains pending until a future payment integration verifies payment.

## Connect Supabase and Vercel

1. In the reset Supabase project, open SQL Editor and run [the registration migration](supabase/migrations/202611140001_registrations.sql) once. It creates `registrations`, `registration_participants` and the function used by the server endpoint.
2. Import this repository into Vercel using the **Other** framework preset and the repository root. The application needs no build command.
3. Go to **Settings → Environment Variables**. Add `SUPABASE_URL` as **Config** and the new `SUPABASE_SECRET_KEY` as **Secret**. Select **Production** for the main deployment. Use a test Supabase project for Preview if needed.
4. Save and redeploy. The API uses the project URL and server secret. Keep the secret in Vercel.

## Verify a deployment

Submit a booking with sample details, choose **Save pending registration**, and copy the `RYF26-XXXXXXXX` ID shown in the review dialog. In Supabase Table Editor, verify that `registrations` has a matching pending row and that `registration_participants` contains one row per participant for that ID. Verify that `amount_paise` is 20000 per participant for either single day or 40000 per participant for both days.

## Participant context update

Run migration 202611140002_participant_context.sql after the initial migration. It adds optional organization and city fields and preserves retries for older payloads. This migration was applied to the connected project during development.

Run the local server with node dev-server.js. It reads credentials from the Git-ignored .env.local file.
