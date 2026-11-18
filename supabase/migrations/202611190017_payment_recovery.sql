begin;
alter table public.festival_payment_attempts
  add column next_check_at timestamptz,
  add column check_count integer not null default 0,
  add column recovery_lease uuid,
  add column recovery_exhausted_at timestamptz;

alter table public.festival_payment_attempts
  alter column next_check_at set default (now() + interval '2 minutes');

update public.festival_payment_attempts a
set next_check_at = now() + interval '2 minutes'
from public.registrations r
where r.id = a.registration_id and r.status = 'pending'
  and a.created_at >= now() - interval '24 hours';

create index festival_payment_attempts_due
  on public.festival_payment_attempts (next_check_at, registration_id)
  where next_check_at is not null;

create function public.festival_claim_payments(p_limit integer)
returns table (registration_id text, txnid text, amount_paise integer, lease uuid)
language sql security definer set search_path = '' as $$
  with due as (
    select a.registration_id, r.amount_paise
    from public.festival_payment_attempts a
    join public.registrations r on r.id = a.registration_id
    where a.next_check_at <= statement_timestamp() and r.status = 'pending'
    order by a.next_check_at, a.registration_id
    limit greatest(1, least(coalesce(p_limit, 1), 16))
    for update of a skip locked
  )
  update public.festival_payment_attempts a
  set recovery_lease = gen_random_uuid(),
      next_check_at = statement_timestamp() + interval '2 minutes'
  from due
  where a.registration_id = due.registration_id
  returning a.registration_id, a.txnid, due.amount_paise, a.recovery_lease
$$;

create function public.festival_finish_payment_check(p_booking text, p_lease uuid, p_verified boolean)
returns void language sql security definer set search_path = '' as $$
  update public.festival_payment_attempts a
  set check_count = a.check_count + 1,
      recovery_lease = null,
      recovery_exhausted_at = case when not p_verified and a.check_count >= 23 then statement_timestamp() end,
      next_check_at = case
        when p_verified or a.check_count >= 23 then null
        else statement_timestamp() + make_interval(mins => least(60, 2 << least(a.check_count, 5)))
      end
  where a.registration_id = p_booking and a.recovery_lease = p_lease
$$;

create function public.festival_signal_payment(p_txnid text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.festival_payment_attempts a
  set next_check_at = statement_timestamp()
  from public.registrations r
  where a.txnid = p_txnid and r.id = a.registration_id and r.status = 'pending'
    and a.recovery_lease is null and a.recovery_exhausted_at is null
    and (a.next_check_at is null or a.next_check_at > statement_timestamp());
  return exists(select 1 from public.festival_payment_attempts where txnid = p_txnid);
end;
$$;

revoke all on function public.festival_signal_payment(text) from public, anon, authenticated;
grant execute on function public.festival_signal_payment(text) to service_role;

revoke all on function public.festival_claim_payments(integer),
  public.festival_finish_payment_check(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.festival_claim_payments(integer),
  public.festival_finish_payment_check(text, uuid, boolean) to service_role;
commit;
