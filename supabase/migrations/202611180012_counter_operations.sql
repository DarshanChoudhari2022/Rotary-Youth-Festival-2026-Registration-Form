begin;
create table public.festival_staff (
  id uuid primary key,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  email text not null,
  role text not null check (role in ('registration', 'gate', 'operations', 'disabled'))
);
alter table public.festival_staff enable row level security;
revoke all on public.festival_staff from public, anon, authenticated;
grant select, insert, update on public.festival_staff to service_role;

alter table public.registration_participants alter column email drop not null,
  alter column date_of_birth drop not null;
alter table public.registration_participants drop constraint registration_participants_last_name_check,
  add constraint registration_participants_last_name_check check (char_length(btrim(last_name)) <= 100);
alter table public.festival_payments drop constraint festival_payments_provider_check;
alter table public.festival_payments add column collected_by uuid,
  add constraint festival_payments_provider_check check (
    (provider = 'easebuzz' and collected_by is null)
    or (provider in ('counter_cash', 'counter_online') and collected_by is not null)
  );
revoke execute on function public.festival_admin_revoke(uuid, uuid) from service_role;

create function public.festival_counter_register(
  p_request uuid, p_staff uuid, p_name text, p_mobile text, p_email text,
  p_dob date, p_school text, p_mode text, p_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  day date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  booking public.registrations;
  person public.registration_participants;
  payment public.festival_payments;
  ticket uuid;
  provider_name text := case p_mode when 'cash' then 'counter_cash' else 'counter_online' end;
  payment_ref text := case p_mode when 'cash' then 'cash:' || p_request::text else 'counter-online:' || lower(p_reference) end;
begin
  if p_mode is null or p_mode not in ('cash', 'online')
     or (p_mode = 'online' and (p_reference is null or p_reference !~ '^[A-Za-z0-9_-]{6,80}$'))
     or (p_dob is not null and (p_dob > day or p_dob < date '0001-01-01')) then
    raise sqlstate 'PT422' using message = 'Check the counter payment and date of birth.';
  end if;
  if day not in (date '2026-11-21', date '2026-11-22')
     and not exists (select 1 from public.registrations where request_id = p_request) then
    raise sqlstate 'PT422' using message = 'Spot registration is available on the festival dates.';
  end if;
  insert into public.registrations(request_id, visit, quantity, guardian_consent, discounted_quantity, consent_version)
  values(p_request, to_char(day, 'DD'), 1, false, case when p_dob >= date '2010-11-01' then 1 else 0 end, 'counter-2026')
  on conflict (request_id) do nothing returning * into booking;
  if found then
    insert into public.registration_participants(registration_id, position, first_name, last_name, mobile, email, date_of_birth, organization)
    values(booking.id, 1, split_part(p_name, ' ', 1), btrim(substr(p_name, length(split_part(p_name, ' ', 1)) + 1)),
      p_mobile, p_email, p_dob, p_school);
    insert into public.festival_payments(registration_id, provider, transaction_id, amount_paise, currency, verified_at, collected_by)
    values(booking.id, provider_name, payment_ref, booking.amount_paise, 'INR', now(), p_staff)
    on conflict(transaction_id) do nothing returning * into payment;
    if not found then raise sqlstate 'PT409' using message = 'This online payment reference was already recorded.'; end if;
    update public.registrations set status = 'paid' where id = booking.id;
    insert into public.festival_tickets(registration_id, position) values(booking.id, 1) returning id into ticket;
    insert into public.festival_admissions(ticket_id, event_date, staff_id) values(ticket, day, p_staff);
  else
    select * into booking from public.registrations where request_id = p_request;
    select * into payment from public.festival_payments where registration_id = booking.id;
    select * into person from public.registration_participants where registration_id = booking.id and position = 1;
    if payment.collected_by is distinct from p_staff or payment.transaction_id is distinct from payment_ref
       or btrim(person.first_name || ' ' || person.last_name) is distinct from p_name
       or person.mobile is distinct from p_mobile or person.email is distinct from p_email
       or person.date_of_birth is distinct from p_dob or person.organization is distinct from p_school then
      raise sqlstate 'PT409' using message = 'This submission reference has already been used.';
    end if;
    select id into ticket from public.festival_tickets where registration_id = booking.id and position = 1;
  end if;
  return jsonb_build_object('booking_id', booking.id, 'ticket_id', ticket, 'amount_paise', booking.amount_paise,
    'food_coupon_eligible', booking.discounted_quantity = 1, 'admitted_at',
    (select admitted_at from public.festival_admissions where ticket_id = ticket));
end $$;

create or replace function public.inspect_festival_ticket(p_ticket uuid,p_staff uuid,p_admit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.festival_tickets; r public.registrations; person public.registration_participants; prior public.festival_admissions;
  day date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  outcome text := 'valid';
begin
  select * into t from public.festival_tickets where id = p_ticket for update;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  select * into r from public.registrations where id = t.registration_id;
  if r.checkout_test or r.visit = 'demo' then return jsonb_build_object('status', 'test_ticket'); end if;
  if t.revoked_at is not null or r.status <> 'paid' or not exists (
    select 1 from public.festival_payments where registration_id = r.id and revoked_at is null and amount_paise = r.amount_paise
  ) then return jsonb_build_object('status', 'invalid_or_revoked'); end if;
  select * into person from public.registration_participants where registration_id = r.id and position = t.position;
  if day not in (date '2026-11-21', date '2026-11-22') or (r.visit <> 'both' and r.visit <> to_char(day, 'DD')) then
    outcome := 'wrong_day';
  else
    select * into prior from public.festival_admissions where ticket_id = t.id and event_date = day;
    if found then outcome := 'already_used';
    elsif p_admit then
      insert into public.festival_admissions(ticket_id, event_date, staff_id) values(t.id, day, p_staff) returning * into prior;
      outcome := 'admitted';
    end if;
  end if;
  return jsonb_build_object('status', outcome, 'ticket_id', t.id, 'name', btrim(person.first_name || ' ' || person.last_name),
    'visit', r.visit, 'admitted_at', prior.admitted_at, 'staff_id', prior.staff_id, 'staff_name',
    (select name from public.festival_staff where id = prior.staff_id),
    'food_eligible', coalesce(person.date_of_birth >= date '2010-11-01', false));
end $$;

create function public.festival_operations_report()
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
    where p.provider = 'counter_cash' group by p.collected_by, s.name
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

revoke all on function public.festival_counter_register(uuid, uuid, text, text, text, date, text, text, text),
  public.festival_operations_report() from public, anon, authenticated;
grant execute on function public.festival_counter_register(uuid, uuid, text, text, text, date, text, text, text),
  public.festival_operations_report() to service_role;
commit;
