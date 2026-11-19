begin;
create or replace function public.festival_operations_report()
returns jsonb language sql security definer set search_path = '' as $$
  with participants as (
    select coalesce(pay.provider, 'easebuzz') as provider, t.id as ticket,
      exists(select 1 from public.festival_admissions a where a.ticket_id = t.id) as checked_in
    from public.registrations r
    join public.registration_participants p on p.registration_id = r.id
    left join public.festival_payments pay on pay.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    where not r.checkout_test and r.visit <> 'demo'
  ), cash as (
    select coalesce(s.name, p.collected_by::text) as staff, sum(p.amount_paise) as amount_paise, count(*) as collections
    from public.festival_payments p left join public.festival_staff s on s.id = p.collected_by
    where p.provider = 'counter_cash' and p.revoked_at is null group by p.collected_by, s.name
  ), admissions as (
    select coalesce(s.name, a.staff_id::text) as staff, count(*) as count
    from public.festival_admissions a left join public.festival_staff s on s.id = a.staff_id
    group by a.staff_id, s.name
  )
  select jsonb_build_object(
    'registered', (select count(*) from participants),
    'checked_in', (select count(*) from participants where checked_in),
    'not_checked_in', (select count(*) from participants where not checked_in),
    'spot', (select count(*) from participants where provider <> 'easebuzz'),
    'online', (select count(*) from participants where provider = 'easebuzz'),
    'cash_paise', coalesce((select sum(amount_paise) from cash), 0),
    'cash_by_staff', coalesce((select jsonb_agg(cash order by staff) from cash), '[]'::jsonb),
    'checkins_by_staff', coalesce((select jsonb_agg(admissions order by staff) from admissions), '[]'::jsonb)
  )
$$;
commit;
