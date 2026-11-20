# Performance verification

Apply migrations 202611190014 through 202611190016 in staging. Enable the shared attendance snapshot with FESTIVAL_ATTENDANCE_TTL_SECONDS=5. Zero or unset uses the original attendance RPC. Set FESTIVAL_PERFORMANCE_LOG_PERCENT=100 during a controlled test, then lower the sample rate. Its default is zero.

The festival_request_timing log records HTTP status, route duration and request counts and durations for PostgREST, Supabase Auth and Easebuzz. Parallel dependency times can overlap. These counts measure HTTP calls. For internal SQL duration, configure statement statistics and slow-query logging on the staging database.

Reverting the application commits restores the previous handlers and UI. For a database rollback, restore the function bodies from migrations 011 and 012 with a new migration. Disable the TTL before removing the attendance cache.

## Load scenarios

    k6 run load-tests/performance.js

Use a disposable loopback fixture or staging tunnel with synthetic data. BASE_URL defaults to http://127.0.0.1:3001. Set VUS per scenario, DURATION and a fresh numeric MOBILE_OFFSET for each run. VISIT defaults to 22. ADMIN_TOKEN enables directory and attendance requests. GATE_TOKEN and GATE_QR exercise duplicate scans of a paid ticket on its valid event date. Use a fresh ticket to observe the first admission. CALLBACK_TXN exercises form returns and requires a paid synthetic transaction or payment simulator. BASELINE=1 includes day totals in the directory request. Export k6 JSON to compare each operation separately.

## Results

Seven warm PGlite measurements per operation at 10,000 synthetic bookings.

| Operation | Before median | After median |
|---|---:|---:|
| Directory request issued by the UI | 28.7 ms | 4.7 ms |
| Directory without totals in both revisions | 2.1 ms | 4.7 ms |
| Selective name search | 28.5 ms | 12.9 ms |
| Attendance with warm snapshot | 16.2 ms | 0.2 ms |
| Operations report | 20.2 ms | 19.6 ms |

Browser first-row times ranged from 125 to 283 ms before and 131 to 266 ms after across four samples per revision. The after run verified lazy reports, search debounce, clear and attendance rendering.

The after-only mixed run submitted 90 concurrent local HTTP requests and returned zero HTTP errors. The burst rate was 304 requests/s. One of 30 concurrent scans admitted the participant and 29 reported already used.

| After-only local endpoint | p50 | p95 | p99 |
|---|---:|---:|---:|
| Registration | 202 ms | 215 ms | 216 ms |
| Admin list and attendance | 243 ms | 252 ms | 254 ms |
| Gate admission and repeat scans | 278 ms | 284 ms | 284 ms |

The gate missed the 100 ms target in this burst. The fixture uses embedded PostgreSQL and simulated authentication. k6 is unavailable locally, and the payment scenario requires a simulator or authorized sandbox. Sustained staged before-and-after results are pending.

## Payment recovery worker

Apply migration 202611190017 and set the server-only CRON_SECRET in production. The Vercel production deployment schedules GET /api/payment-recovery once daily at 01:00 UTC (06:30 IST). Vercel sends the secret in the Authorization header. Run the worker against the simulated gateway first. Set FESTIVAL_PAYMENT_RECOVERY_BATCH (default and maximum 16) to match the merchant lookup quota. The worker claims attempts from PostgreSQL, so an interrupted browser session does not prevent later recovery. A lease expires after two minutes if a worker stops mid-run.

For immediate recovery, staff can open a pending booking in the participant directory and select **Verify Easebuzz payment**. The server looks up the saved checkout with Easebuzz and uses the same fulfillment function as the browser return and scheduled worker.

After validating that the scheduler runs regularly, optionally set FESTIVAL_ASYNC_PAYMENT_RETURN=true. The hosted browser return then records a reconciliation signal before issuing the existing 303 redirect. The customer can still use the existing verification action for immediate status. Browser payload status and amounts are ignored. Only Easebuzz's transaction lookup and the payment-fulfillment SQL function can settle the booking.

Review worker verification errors and unresolved pending rows where recovery_exhausted_at is set. These rows have completed 24 attempts. Compare with the provider record before any manual action. To roll back asynchronous returns, unset FESTIVAL_ASYNC_PAYMENT_RETURN. Disabling the scheduler stops background checks. Existing checkout and manual verification remain available.

## Ticket PDF worker

Apply migration 202611190018. Schedule authenticated GET /api/ticket-artifacts using the same server-side CRON_SECRET as payment recovery. Set FESTIVAL_TICKET_ARTIFACTS=true in staging. FESTIVAL_TICKET_ARTIFACT_BATCH controls jobs per invocation (default 2, range 1 through 4).

Successful payment, ticket revocation and participant edits enqueue or refresh a booking artifact. The worker uses the same PDF renderer as the customer download endpoint. It stores up to 1.5 MB of PDF data per booking in a service-only database table. Failures retry up to six times and set exhausted_at for review. Previously paid bookings and oversized files can still download on demand. Review database storage usage and agree a retention period for the PDF copies, which contain participant data. Existing customer access and admin permissions are checked before every download.

If the PDF layout or included assets change, increment FESTIVAL_TICKET_TEMPLATE_VERSION so older artifacts are bypassed. To roll back, unset FESTIVAL_TICKET_ARTIFACTS and stop its schedule. The customer download endpoint falls back to the on-demand renderer whenever a current artifact is unavailable.

## Staging rollout order

1. Confirm the staging Supabase and Vercel projects and set up a payment simulator or approved Easebuzz sandbox. Use synthetic bookings.
2. Apply migrations 014 through 018 in order, skipping migrations already recorded as applied.
3. Deploy the corresponding commits. Configure server-only CRON_SECRET and a scheduler that supports the required frequency. Start with each worker independently. Set FESTIVAL_ATTENDANCE_TTL_SECONDS=5 and FESTIVAL_TICKET_ARTIFACTS=true for staging.
4. Verify payment after a closed checkout, duplicate returns, automatic download, download after an edit, revoked ticket denial, and two gates scanning the same ticket. Once payment recovery runs reliably, enable FESTIVAL_ASYNC_PAYMENT_RETURN=true.
5. Run the sustained k6 tests and compare route timings, queue age, database load and error rates. Do not use real payment traffic for load tests.
6. Confirm event capacity, reservation duration and late-payment policy before implementing capacity enforcement. Confirm the merchant's webhook signing and retry rules and the approved sender before enabling dedicated webhooks or email.

## Single-festival deployment on Vercel Hobby

For the expected 600 to 700 entries, deploy pending migrations through 019. Keep FESTIVAL_ASYNC_PAYMENT_RETURN and FESTIVAL_TICKET_ARTIFACTS unset if running without a frequent scheduler. The existing synchronous payment and PDF flows then remain the default. The booking status and paid PDF endpoint use one database request per action with the optional artifact cache disabled. Admin sign-in loads the first directory page in the same authorized request. The admin attendance snapshot remains optional and can be enabled with FESTIVAL_ATTENDANCE_TTL_SECONDS=5.

Smoke-test admin sign-in, search by name and registration ID, participant edits, spot registration, customer and staff PDF downloads, and duplicate scans. An expected attendance of 600 to 700 does not configure a hard cap.
