begin;
create or replace function public.festival_counter_register_visit(
  p_request uuid, p_staff uuid, p_name text, p_mobile text, p_email text,
  p_dob date, p_school text, p_mode text, p_reference text, p_visit text
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
  if p_visit is not null and (p_visit not in ('21','22','both') or p_mode <> 'cash') then
    raise sqlstate 'PT422' using message = 'Select a festival visit and collect cash for an advance ticket.';
  end if;
  if ((p_visit is not null and day >= date '2026-11-21') or (p_visit is null and day not in (date '2026-11-21', date '2026-11-22')))
     and not exists (select 1 from public.registrations where request_id = p_request) then
    raise sqlstate 'PT422' using message = 'Booking dates have changed. Reopen Add Participant to see available options.';
  end if;
  insert into public.registrations(request_id, visit, quantity, guardian_consent, discounted_quantity, consent_version)
  values(p_request, coalesce(p_visit, to_char(day, 'DD')), 1, false, case when p_dob >= date '2010-11-01' then 1 else 0 end, case when p_visit is null then 'counter-2026' else 'counter-advance-2026' end)
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
    if p_visit is null then
      insert into public.festival_admissions(ticket_id, event_date, staff_id) values(ticket, day, p_staff);
    end if;
  else
    select * into booking from public.registrations where request_id = p_request;
    select * into payment from public.festival_payments where registration_id = booking.id;
    select * into person from public.registration_participants where registration_id = booking.id and position = 1;
    if (booking.consent_version = 'counter-advance-2026') <> (p_visit is not null)
       or (p_visit is not null and booking.visit <> p_visit) or payment.collected_by is distinct from p_staff or payment.transaction_id is distinct from payment_ref
       or btrim(person.first_name || ' ' || person.last_name) is distinct from p_name
       or person.mobile is distinct from p_mobile or person.email is distinct from p_email
       or person.date_of_birth is distinct from p_dob or person.organization is distinct from p_school then
      raise sqlstate 'PT409' using message = 'This submission reference has already been used.';
    end if;
    select id into ticket from public.festival_tickets where registration_id = booking.id and position = 1;
  end if;
  return jsonb_build_object('booking_id', booking.id, 'ticket_id', ticket, 'amount_paise', booking.amount_paise,
    'food_coupon_eligible', booking.discounted_quantity = 1, 'admitted_at',
    (select admitted_at from public.festival_admissions where ticket_id = ticket and event_date = day));
end $$;

revoke all on function public.festival_counter_register_visit(uuid,uuid,text,text,text,date,text,text,text,text) from public, anon, authenticated;
grant execute on function public.festival_counter_register_visit(uuid,uuid,text,text,text,date,text,text,text,text) to service_role;

create or replace function public.festival_counter_register(
  p_request uuid, p_staff uuid, p_name text, p_mobile text, p_email text,
  p_dob date, p_school text, p_mode text, p_reference text
) returns jsonb language sql security definer set search_path = '' as $$
  select public.festival_counter_register_visit(p_request,p_staff,p_name,p_mobile,p_email,p_dob,p_school,p_mode,p_reference,null)
$$;
commit;
