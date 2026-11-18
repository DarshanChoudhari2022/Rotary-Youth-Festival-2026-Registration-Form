begin;
create or replace function public.inspect_festival_ticket(p_ticket uuid,p_staff uuid,p_admit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ticket record; prior public.festival_admissions;
  day date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  outcome text := 'valid';
begin
  -- Serialize admission of one ticket. Inspect-only callers take no row lock.
  if p_admit then
    perform 1 from public.festival_tickets where id = p_ticket for update;
    if not found then return jsonb_build_object('status', 'unknown'); end if;
  end if;
  select t.id, t.revoked_at, r.checkout_test, r.visit, r.status,
    p.first_name, p.last_name, p.date_of_birth,
    pay.amount_paise = r.amount_paise as paid_amount_matches
  into ticket
  from public.festival_tickets t
  join public.registrations r on r.id = t.registration_id
  join public.registration_participants p on p.registration_id = t.registration_id and p.position = t.position
  left join public.festival_payments pay on pay.registration_id = r.id and pay.revoked_at is null
  where t.id = p_ticket;
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  if ticket.checkout_test or ticket.visit = 'demo' then return jsonb_build_object('status', 'test_ticket'); end if;
  if ticket.revoked_at is not null or ticket.status <> 'paid' or ticket.paid_amount_matches is not true then
    return jsonb_build_object('status', 'invalid_or_revoked');
  end if;
  if day not in (date '2026-11-21', date '2026-11-22') or (ticket.visit <> 'both' and ticket.visit <> to_char(day, 'DD')) then
    outcome := 'wrong_day';
  else
    select * into prior from public.festival_admissions where ticket_id = ticket.id and event_date = day;
    if found then outcome := 'already_used';
    elsif p_admit then
      insert into public.festival_admissions(ticket_id, event_date, staff_id) values(ticket.id, day, p_staff) returning * into prior;
      outcome := 'admitted';
    end if;
  end if;
  return jsonb_build_object('status', outcome, 'ticket_id', ticket.id, 'name', btrim(ticket.first_name || ' ' || ticket.last_name),
    'visit', ticket.visit, 'admitted_at', prior.admitted_at, 'staff_id', prior.staff_id, 'staff_name',
    (select name from public.festival_staff where id = prior.staff_id),
    'food_eligible', coalesce(ticket.date_of_birth >= date '2010-11-01', false));
end $$;

commit;
