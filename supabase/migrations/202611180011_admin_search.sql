begin;
create index if not exists festival_registrations_admin_recent on public.registrations (created_at desc, id);
create index if not exists festival_participants_admin_mobile on public.registration_participants (mobile);
create index if not exists festival_participants_admin_email on public.registration_participants (lower(email));

create or replace function public.festival_admin_dashboard(p_page integer, p_find text, p_include_days boolean)
returns jsonb language sql security definer set search_path = '' as $$
  with lookup as (
    select btrim(p_find) as term, regexp_replace(p_find, '[^0-9]', '', 'g') as digits
  ), days(day, visit) as (
    values (date '2026-11-21', '21'), (date '2026-11-22', '22')
  ), stats as (
    select d.day,
      count(distinct r.id) as registrations,
      count(*) filter (where r.id is not null) as participants,
      count(*) filter (where p.date_of_birth > (d.day - interval '16 years')::date) as under_16,
      count(*) filter (where r.status = 'paid' and t.id is not null and t.revoked_at is null and pay.registration_id is not null) as paid,
      count(*) filter (where r.status = 'paid' and t.id is not null and t.revoked_at is null
        and pay.registration_id is not null and p.date_of_birth > (d.day - interval '16 years')::date) as paid_under_16
    from days d
    left join public.registrations r on r.visit in (d.visit, 'both') and not r.checkout_test
    left join public.registration_participants p on p.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    left join public.festival_payments pay on pay.registration_id = r.id
      and pay.revoked_at is null and pay.amount_paise = r.amount_paise
    where p_include_days
    group by d.day
  ), matches as (
    select r.id as booking_id, r.visit, r.checkout_test, r.status, r.amount_paise, r.created_at,
      p.position, p.first_name, p.last_name, p.organization, p.city,
      t.id as ticket_id, t.revoked_at,
      (not r.checkout_test and r.visit <> 'demo' and p.date_of_birth >= date '2010-11-01') as food_coupon_eligible,
      case when r.visit in ('21', 'both') and not r.checkout_test then p.date_of_birth > date '2010-11-21' end as under_16_day_one,
      case when r.visit in ('22', 'both') and not r.checkout_test then p.date_of_birth > date '2010-11-22' end as under_16_day_two
    from public.registrations r
    join public.registration_participants p on p.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    cross join lookup s
    where s.term = ''
       or r.id = upper(s.term)
       or t.id = case when s.term ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then s.term::uuid end
       or lower(p.email) = lower(s.term)
       or (s.term ~ '^[0-9+ ().-]+$' and length(s.digits) in (10, 12)
         and p.mobile = '+91' || right(s.digits, 10)
         and (length(s.digits) = 10 or left(s.digits, 2) = '91'))
       or (length(s.term) >= 2 and strpos(lower(p.first_name || ' ' || p.last_name), lower(s.term)) > 0)
    order by r.created_at desc, r.id, p.position
    limit 26 offset (greatest(p_page, 0)::bigint * 25)
  )
  select jsonb_build_object('days', (select jsonb_agg(stats order by day) from stats),
    'participants', coalesce((select jsonb_agg(matches order by created_at desc, booking_id, position) from matches), '[]'::jsonb))
$$;
revoke all on function public.festival_admin_dashboard(integer, text, boolean) from public, anon, authenticated;
grant execute on function public.festival_admin_dashboard(integer, text, boolean) to service_role;

create or replace function public.festival_admin_dashboard(p_page integer, p_find text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.festival_admin_dashboard(p_page, p_find, true)
$$;
commit;
