begin;

create table public.registrations (
  id text primary key default ('RYF26-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  request_id uuid not null unique,
  visit text not null check (visit in ('21', '22', 'both')),
  quantity integer not null check (quantity between 1 and 10),
  amount_paise integer generated always as (
    quantity * case when visit = 'both' then 40000 else 20000 end
  ) stored,
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  guardian_consent boolean not null,
  consent_version text not null default '2026-11-14',
  created_at timestamptz not null default now()
);

create table public.registration_participants (
  registration_id text not null references public.registrations(id) on delete cascade,
  position integer not null check (position between 1 and 10),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 100),
  mobile text not null check (mobile ~ '^[+]91[0-9]{10}$'),
  email text not null check (char_length(email) between 3 and 254),
  date_of_birth date not null,
  primary key (registration_id, position)
);

alter table public.registrations enable row level security;
alter table public.registration_participants enable row level security;
revoke all on public.registrations, public.registration_participants from public, anon, authenticated;
grant select, insert on public.registrations, public.registration_participants to service_role;

create function public.create_festival_registration(
  p_request_id uuid, p_visit text, p_participants jsonb, p_guardian_consent boolean
) returns table (registration_id text, amount_paise integer, status text)
language plpgsql
set search_path = ''
as $$
declare
  booking public.registrations%rowtype;
  quantity integer := jsonb_array_length(p_participants);
begin
  insert into public.registrations (request_id, visit, quantity, guardian_consent)
  values (p_request_id, p_visit, quantity, p_guardian_consent)
  on conflict (request_id) do nothing
  returning * into booking;

  if found then
    insert into public.registration_participants (
      registration_id, position, first_name, last_name, mobile, email, date_of_birth
    )
    select booking.id, position, person->>'first', person->>'last',
      person->>'mobile', person->>'email', (person->>'dob')::date
    from jsonb_array_elements(p_participants) with ordinality as people(person, position);
  else
    select * into strict booking from public.registrations r where r.request_id = p_request_id;
    if booking.visit is distinct from p_visit
      or booking.guardian_consent is distinct from p_guardian_consent
      or p_participants is distinct from (
        select jsonb_agg(jsonb_build_object(
          'first', p.first_name, 'last', p.last_name, 'mobile', p.mobile,
          'email', p.email, 'dob', to_char(p.date_of_birth, 'YYYY-MM-DD')
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

revoke all on function public.create_festival_registration(uuid, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.create_festival_registration(uuid, text, jsonb, boolean)
  to service_role;

commit;
