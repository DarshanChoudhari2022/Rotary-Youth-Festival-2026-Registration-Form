begin;
create table public.festival_payment_attempts (
  registration_id text primary key references public.registrations(id),
  txnid text not null unique check (txnid ~ '^[a-f0-9]{24}$'),
  checkout_key text,
  created_at timestamptz not null default now()
);
alter table public.festival_payment_attempts enable row level security;
revoke all on public.festival_payment_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.festival_payment_attempts to service_role;
commit;
