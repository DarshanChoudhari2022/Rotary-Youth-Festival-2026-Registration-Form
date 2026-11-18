begin;
create table public.festival_ticket_artifacts (
  registration_id text primary key references public.registrations(id) on delete cascade,
  next_run_at timestamptz,
  lease uuid,
  attempts integer not null default 0,
  exhausted_at timestamptz,
  fingerprint text,
  pdf_base64 text check (length(pdf_base64) <= 2000000)
);
alter table public.festival_ticket_artifacts enable row level security;
revoke all on public.festival_ticket_artifacts from public, anon, authenticated;
grant select on public.festival_ticket_artifacts to service_role;
create index festival_ticket_artifacts_due on public.festival_ticket_artifacts(next_run_at)
  where next_run_at is not null;

create function public.queue_festival_ticket_artifact()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  booking_id text;
begin
  if tg_table_name = 'registrations' then
    booking_id := new.id;
  else
    booking_id := new.registration_id;
  end if;
  insert into public.festival_ticket_artifacts(registration_id, next_run_at)
    select id, now() from public.registrations where id = booking_id and status = 'paid'
  on conflict (registration_id) do update set next_run_at = excluded.next_run_at,
    lease = null, attempts = 0, exhausted_at = null, fingerprint = null, pdf_base64 = null;
  return new;
end;
$$;
revoke all on function public.queue_festival_ticket_artifact() from public, anon, authenticated;

create trigger festival_ticket_artifact_paid after update of status on public.registrations
  for each row when (new.status = 'paid' and old.status is distinct from new.status)
  execute function public.queue_festival_ticket_artifact();
create trigger festival_ticket_artifact_edit after update on public.registration_participants
  for each row when (old is distinct from new) execute function public.queue_festival_ticket_artifact();
create trigger festival_ticket_artifact_revoked after update of revoked_at on public.festival_tickets
  for each row when (old.revoked_at is distinct from new.revoked_at) execute function public.queue_festival_ticket_artifact();

create function public.claim_festival_ticket_artifacts(p_limit integer)
returns table(registration_id text, lease uuid)
language sql security definer set search_path = '' as $$
  with due as (
    select a.registration_id from public.festival_ticket_artifacts a
    where a.next_run_at <= statement_timestamp()
    order by a.next_run_at, a.registration_id
    limit greatest(1, least(coalesce(p_limit, 1), 4))
    for update skip locked
  )
  update public.festival_ticket_artifacts a
  set lease = gen_random_uuid(), next_run_at = statement_timestamp() + interval '2 minutes'
  from due where a.registration_id = due.registration_id
  returning a.registration_id, a.lease
$$;

create function public.finish_festival_ticket_artifact(p_booking text, p_lease uuid, p_terminal boolean,
  p_fingerprint text, p_pdf text)
returns void language sql security definer set search_path = '' as $$
  update public.festival_ticket_artifacts a set
    attempts = a.attempts + 1, lease = null,
    fingerprint = p_fingerprint, pdf_base64 = p_pdf,
    exhausted_at = case when not p_terminal and a.attempts >= 5 then statement_timestamp() end,
    next_run_at = case when p_terminal or a.attempts >= 5 then null
      else statement_timestamp() + make_interval(mins => 1 << a.attempts) end
  where a.registration_id = p_booking and a.lease = p_lease
$$;
revoke all on function public.claim_festival_ticket_artifacts(integer),
  public.finish_festival_ticket_artifact(text, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_festival_ticket_artifacts(integer),
  public.finish_festival_ticket_artifact(text, uuid, boolean, text, text) to service_role;
commit;
