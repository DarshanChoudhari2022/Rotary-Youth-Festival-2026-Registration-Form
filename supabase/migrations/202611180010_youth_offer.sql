begin;
-- Existing bookings retain their original amount. Only newly created bookings receive the offer.
alter table public.registrations
  add column discounted_quantity integer not null default 0
  check (discounted_quantity between 0 and quantity);

alter table public.registrations alter column amount_paise set expression as (
  case when checkout_test or visit = 'demo' then 100
       else (2 * quantity - discounted_quantity) * case when visit = 'both' then 20000 else 10000 end end
);

create or replace function public.create_festival_registration(
  p_request_id uuid, p_visit text, p_participants jsonb, p_guardian_consent boolean
) returns table (registration_id text, amount_paise integer, status text)
language plpgsql
set search_path = ''
as $$
declare
  booking public.registrations%rowtype;
  quantity integer := jsonb_array_length(p_participants);
begin
  select jsonb_agg(person || jsonb_build_object(
    'organization', coalesce(person->>'organization', ''),
    'city', coalesce(person->>'city', '')
  ) order by position) into p_participants
  from jsonb_array_elements(p_participants) with ordinality as people(person, position);
  if (statement_timestamp() at time zone 'Asia/Kolkata')::date = date '2026-11-22'
    and p_visit <> '22'
    and not exists (select 1 from public.registrations r where r.request_id = p_request_id)
  then
    raise sqlstate 'PT422' using message = 'Only 22 November tickets can be booked today.';
  end if;

  insert into public.registrations (request_id, visit, quantity, guardian_consent, discounted_quantity)
  values (p_request_id, p_visit, quantity, p_guardian_consent,
    (select count(*) from jsonb_array_elements(p_participants) as people(person)
      where p_visit <> 'demo' and (person->>'dob')::date >= date '2010-11-01'))
  on conflict (request_id) do nothing
  returning * into booking;

  if found then
    insert into public.registration_participants (
      registration_id, position, first_name, last_name, mobile, email, date_of_birth, organization, city
    )
    select booking.id, position, person->>'first', person->>'last',
      person->>'mobile', person->>'email', (person->>'dob')::date, coalesce(person->>'organization', ''), coalesce(person->>'city', '')
    from jsonb_array_elements(p_participants) with ordinality as people(person, position)
    order by person->>'mobile', position;
  else
    select * into strict booking from public.registrations r where r.request_id = p_request_id;
    if booking.visit is distinct from p_visit
      or booking.guardian_consent is distinct from p_guardian_consent
      or p_participants is distinct from (
        select jsonb_agg(jsonb_build_object(
          'first', p.first_name, 'last', p.last_name, 'mobile', p.mobile,
          'email', p.email, 'dob', to_char(p.date_of_birth, 'YYYY-MM-DD'), 'organization', p.organization, 'city', p.city
        ) order by p.position)
        from public.registration_participants p where p.registration_id = booking.id
      )
    then
      raise exception using errcode = 'PT409', message = 'Request ID already used';
    end if;
  end if;

  return query select booking.id, booking.amount_paise, booking.status;
end;
$$;

create or replace function public.festival_admin_dashboard(p_page integer, p_find text)
returns jsonb language sql security definer set search_path = '' as $$
  with days(day, visit) as (
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
    where p_find = '' or r.id = p_find or t.id::text = lower(p_find)
    order by r.created_at desc, r.id, p.position
    limit 26 offset (greatest(p_page, 0)::bigint * 25)
  )
  select jsonb_build_object('days', (select jsonb_agg(stats order by day) from stats),
    'participants', coalesce((select jsonb_agg(matches order by created_at desc, booking_id, position) from matches), '[]'::jsonb))
$$;

commit;
