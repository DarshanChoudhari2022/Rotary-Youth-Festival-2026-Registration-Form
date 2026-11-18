begin;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$
declare
  trgm_schema text;
begin
  select n.nspname into strict trgm_schema from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists festival_participants_admin_name on public.registration_participants using gin (lower(first_name || '' '' || last_name) %I.gin_trgm_ops)', trgm_schema);
end;
$$;

create or replace function public.festival_admin_dashboard(p_page integer, p_find text, p_include_days boolean)
returns jsonb language sql security definer set search_path = '' as $$
  with lookup as (
    select btrim(p_find) as term, regexp_replace(p_find, '[^0-9]', '', 'g') as digits
  ), candidates as materialized (
    select p.registration_id, p.position from public.registration_participants p
    cross join lookup s where s.term <> '' and p.registration_id = upper(s.term)
    union
    select t.registration_id, t.position from public.festival_tickets t
    cross join lookup s where t.id = case when s.term ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then s.term::uuid end
    union
    select p.registration_id, p.position from public.registration_participants p
    cross join lookup s where s.term <> '' and lower(p.email) = lower(s.term)
    union
    select p.registration_id, p.position from public.registration_participants p
    cross join lookup s where s.term ~ '^[0-9+ ().-]+$' and length(s.digits) in (10,12)
      and (length(s.digits) = 10 or left(s.digits, 2) = '91') and p.mobile = '+91' || right(s.digits, 10)
    union
    select p.registration_id, p.position from public.registration_participants p
    cross join lookup s where length(s.term) >= 2
      and lower(p.first_name || ' ' || p.last_name) like '%' ||
        replace(replace(replace(lower(s.term), '!', '!!'), '%', '!%'), '_', '!_') || '%' escape '!'
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
  ), page_keys as (
    (select r.id, p.position
      from public.registrations r
      join public.registration_participants p on p.registration_id = r.id
      where (select term from lookup) = ''
      order by r.created_at desc, r.id, p.position
      limit 26 offset (greatest(p_page, 0)::bigint * 25))
    union all
    (select r.id, c.position
      from candidates c join public.registrations r on r.id = c.registration_id
      order by r.created_at desc, r.id, c.position
      limit 26 offset (greatest(p_page, 0)::bigint * 25))
  ), matches as (
    select r.id as booking_id, r.visit, r.checkout_test, r.status, r.amount_paise, r.created_at,
      p.position, p.first_name, p.last_name, p.organization, p.city,
      t.id as ticket_id, t.revoked_at,
      (not r.checkout_test and r.visit <> 'demo' and p.date_of_birth >= date '2010-11-01') as food_coupon_eligible,
      case when r.visit in ('21', 'both') and not r.checkout_test then p.date_of_birth > date '2010-11-21' end as under_16_day_one,
      case when r.visit in ('22', 'both') and not r.checkout_test then p.date_of_birth > date '2010-11-22' end as under_16_day_two
    from page_keys k
    join public.registrations r on r.id = k.id
    join public.registration_participants p on p.registration_id = k.id and p.position = k.position
    left join public.festival_tickets t on t.registration_id = k.id and t.position = k.position
  )
  select jsonb_build_object('days', (select jsonb_agg(stats order by day) from stats),
    'participants', coalesce((select jsonb_agg(matches order by created_at desc, booking_id, position) from matches), '[]'::jsonb))
$$;
commit;
