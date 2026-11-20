begin;
create table public.festival_birth_proofs (
  registration_id text not null,
  position integer not null,
  image bytea not null check (octet_length(image) between 5 and 256000),
  primary key (registration_id, position),
  foreign key (registration_id, position)
    references public.registration_participants(registration_id, position) on delete cascade
);
alter table public.festival_birth_proofs enable row level security;
revoke all on public.festival_birth_proofs from public, anon, authenticated;
grant select on public.festival_birth_proofs to service_role;

create function public.create_festival_registration_with_proof(
  p_request_id uuid, p_visit text, p_participants jsonb, p_guardian_consent boolean
) returns table (registration_id text, amount_paise integer, status text)
language plpgsql security definer set search_path = '' as $$
declare
  person jsonb;
  booking record;
  sanitized jsonb;
begin
  for person in select value from jsonb_array_elements(p_participants) loop
    if (person->>'dob')::date >= date '2024-01-01' then
      raise exception 'Date of birth must be before 2024';
    end if;
    if (person->>'dob')::date >= date '2010-11-01' and (
      nullif(person->>'birthProof', '') is null or length(person->>'birthProof') > 341336
    ) then
      raise exception 'A proof image is required for the youth offer';
    end if;
  end loop;

  select jsonb_agg(value - 'birthProof' order by ordinality) into sanitized
    from jsonb_array_elements(p_participants) with ordinality;
  select * into strict booking from public.create_festival_registration(
    p_request_id, p_visit, sanitized, p_guardian_consent
  );

  insert into public.festival_birth_proofs (registration_id, position, image)
    select booking.registration_id, ordinality, decode(value->>'birthProof', 'base64')
    from jsonb_array_elements(p_participants) with ordinality
    where (value->>'dob')::date >= date '2010-11-01'
    on conflict on constraint festival_birth_proofs_pkey do nothing;

  return query select booking.registration_id, booking.amount_paise, booking.status;
end;
$$;
revoke all on function public.create_festival_registration_with_proof(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.create_festival_registration_with_proof(uuid, text, jsonb, boolean) to service_role;
commit;
