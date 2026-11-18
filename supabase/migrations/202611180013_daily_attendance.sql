begin;
create function public.festival_daily_attendance()
returns jsonb language sql stable security definer set search_path = '' as $$
  with event_days(day, visit) as (
    values (date '2026-11-21', '21'), (date '2026-11-22', '22')
  ), attendance as (
    select d.day, count(p.registration_id) as registered, count(a.ticket_id) as checked_in
    from event_days d
    left join public.registrations r on r.visit in (d.visit, 'both') and not r.checkout_test
    left join public.registration_participants p on p.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    left join public.festival_admissions a on a.ticket_id = t.id and a.event_date = d.day
    group by d.day
  )
  select jsonb_agg(jsonb_build_object(
    'day', day, 'registered', registered, 'checked_in', checked_in,
    'not_checked_in', registered - checked_in,
    'percentage', coalesce(round(100.0 * checked_in / nullif(registered, 0), 1), 0)
  ) order by day) from attendance
$$;
revoke all on function public.festival_daily_attendance() from public, anon, authenticated;
grant execute on function public.festival_daily_attendance() to service_role;
commit;
