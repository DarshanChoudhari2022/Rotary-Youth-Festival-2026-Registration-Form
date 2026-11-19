begin;
create or replace function public.festival_admin_overview()
returns jsonb language sql stable security definer set search_path = '' as $$
  with bookings as materialized (
    select r.id, r.visit, coalesce(pay.amount_paise, 0) as collected,
      count(p.position) as people,
      count(t.id) filter (where pay.registration_id is not null and t.revoked_at is null) as paid,
      count(p.position) filter (where p.date_of_birth > date '2010-11-21') as youth21,
      count(p.position) filter (where p.date_of_birth > date '2010-11-22') as youth22,
      count(t.id) filter (where pay.registration_id is not null and t.revoked_at is null
        and p.date_of_birth > date '2010-11-21') as paid_youth21,
      count(t.id) filter (where pay.registration_id is not null and t.revoked_at is null
        and p.date_of_birth > date '2010-11-22') as paid_youth22
    from public.registrations r
    left join public.festival_payments pay on pay.registration_id = r.id and r.status = 'paid'
      and pay.amount_paise = r.amount_paise and pay.revoked_at is null
    left join public.registration_participants p on p.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    where not r.checkout_test and r.visit in ('21','22','both')
    group by r.id, r.visit, pay.amount_paise
  ), days as (
    select d.day, count(b.id) as registrations,
      coalesce(sum(b.people),0) as participants, coalesce(sum(b.paid),0) as paid,
      coalesce(sum(case when d.visit='21' then youth21 else youth22 end),0) as under_16,
      coalesce(sum(case when d.visit='21' then paid_youth21 else paid_youth22 end),0) as paid_under_16,
      coalesce(sum(case when b.visit='both' then b.collected / 2 else b.collected end),0) as collected
    from (values (date '2026-11-21','21'), (date '2026-11-22','22')) d(day,visit)
    left join bookings b on b.visit in (d.visit,'both')
    group by d.day
  )
  select jsonb_build_object('days',(select jsonb_agg(days order by day) from days),
    'received',(select coalesce(sum(amount_paise),0) from public.festival_payments where revoked_at is null),
    'directoryParticipants',(select count(*) from public.registration_participants),
    'participants',coalesce(sum(people),0), 'tickets',coalesce(sum(paid),0),
    'under16',coalesce(sum(case when visit='22' then youth22 else youth21 end),0))
  from bookings
$$;
revoke all on function public.festival_admin_overview() from public, anon, authenticated;
grant execute on function public.festival_admin_overview() to service_role;
commit;
