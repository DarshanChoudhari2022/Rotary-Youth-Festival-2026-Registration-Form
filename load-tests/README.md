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

Apply migration 202611190017. Configure a scheduler to send GET /api/payment-recovery with Authorization: Bearer followed by the server-only CRON_SECRET. Run it against the simulated gateway first. Match schedule frequency and FESTIVAL_PAYMENT_RECOVERY_BATCH (default 4, maximum 16) to the merchant lookup quota and expected payment rate. The worker claims attempts from PostgreSQL, so an interrupted browser session does not prevent later recovery. A lease expires after two minutes if a worker stops mid-run.

After validating that the scheduler runs regularly, optionally set FESTIVAL_ASYNC_PAYMENT_RETURN=true. The hosted browser return then records a reconciliation signal before issuing the existing 303 redirect. The customer can still use the existing verification action for immediate status. Browser payload status and amounts are ignored. Only Easebuzz's transaction lookup and the payment-fulfillment SQL function can settle the booking.

Review worker verification errors and unresolved pending rows where recovery_exhausted_at is set. These rows have completed 24 attempts. Compare with the provider record before any manual action. To roll back asynchronous returns, unset FESTIVAL_ASYNC_PAYMENT_RETURN. Disabling the scheduler stops background checks. Existing checkout and manual verification remain available.
