begin;
-- Reserve overlapping mobile numbers in a consistent order across transactions.
-- Keep the submitted participant order in the stored position column.
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
  insert into public.registrations (request_id, visit, quantity, guardian_consent)
  values (p_request_id, p_visit, quantity, p_guardian_consent)
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
commit;
