begin;
create table public.festival_payments (
 registration_id text primary key references public.registrations(id),
 provider text not null check(provider='easebuzz'),
 transaction_id text not null unique,
 amount_paise integer not null check(amount_paise>0),
 currency text not null check(currency='INR'),
 verified_at timestamptz not null,
 revoked_at timestamptz
);
create table public.festival_tickets (
 id uuid primary key default gen_random_uuid(),
 registration_id text not null,
 position integer not null,
 revoked_at timestamptz,
 unique(registration_id,position),
 foreign key(registration_id,position) references public.registration_participants(registration_id,position)
);
create table public.festival_admissions (
 ticket_id uuid not null references public.festival_tickets(id),
 event_date date not null,
 staff_id uuid not null,
 admitted_at timestamptz not null default now(),
 primary key(ticket_id,event_date)
);
alter table public.festival_payments enable row level security;
alter table public.festival_tickets enable row level security;
alter table public.festival_admissions enable row level security;
revoke all on public.festival_payments,public.festival_tickets,public.festival_admissions from public,anon,authenticated;
grant select,insert,update on public.festival_payments,public.festival_tickets to service_role;
grant select,insert on public.festival_admissions to service_role;

-- Called only after a future gateway adapter validates the callback AND reconciles
-- success with Easebuzz. No HTTP endpoint exposes this operation to visitors.
create function public.fulfill_festival_payment(p_registration text,p_transaction text,p_amount integer)
returns void language plpgsql security definer set search_path=public as $$
declare r registrations; p festival_payments;
begin
 select * into r from registrations where id=p_registration for update;
 if not found or r.amount_paise<>p_amount or length(p_transaction)<1 then raise exception 'Payment mismatch'; end if;
 select * into p from festival_payments where registration_id=r.id;
 if found and (p.transaction_id<>p_transaction or p.revoked_at is not null) then raise exception 'Payment conflict'; end if;
 insert into festival_payments values(r.id,'easebuzz',p_transaction,p_amount,'INR',now(),null) on conflict(registration_id) do nothing;
 update registrations set status='paid' where id=r.id;
 insert into festival_tickets(registration_id,position) select r.id,position from registration_participants where registration_id=r.id on conflict do nothing;
end $$;

create function public.inspect_festival_ticket(p_ticket uuid,p_staff uuid,p_admit boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t festival_tickets; r registrations; person registration_participants; previous festival_admissions;
 day date := (now() at time zone 'Asia/Kolkata')::date; outcome text;
begin
 select * into t from festival_tickets where id=p_ticket for update;
 if not found then return jsonb_build_object('status','unknown'); end if;
 select * into r from registrations where id=t.registration_id;
 if t.revoked_at is not null or not exists(select 1 from festival_payments where registration_id=r.id and revoked_at is null and amount_paise=r.amount_paise) or r.status<>'paid' then return jsonb_build_object('status','invalid_or_revoked'); end if;
 select * into person from registration_participants where registration_id=r.id and position=t.position;
 if day not in ('2026-11-21'::date,'2026-11-22'::date) or (r.visit<>'both' and r.visit<>to_char(day,'DD')) then outcome:='wrong_day';
 else
  select * into previous from festival_admissions where ticket_id=t.id and event_date=day;
  if found then outcome:='already_used';
  elsif p_admit then
   insert into festival_admissions values(t.id,day,p_staff,now()) returning * into previous;
   outcome:='admitted';
  else outcome:='valid'; end if;
 end if;
 return jsonb_build_object('status',outcome,'ticket_id',t.id,'name',person.first_name||' '||person.last_name,'visit',r.visit,'admitted_at',previous.admitted_at,'food_eligible',person.date_of_birth>(day-interval '16 years')::date);
end $$;
revoke all on function public.fulfill_festival_payment(text,text,integer),public.inspect_festival_ticket(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.fulfill_festival_payment(text,text,integer),public.inspect_festival_ticket(uuid,uuid,boolean) to service_role;
commit;
