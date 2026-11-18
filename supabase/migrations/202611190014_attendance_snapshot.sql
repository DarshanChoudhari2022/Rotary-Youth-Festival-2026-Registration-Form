begin;
create table public.festival_attendance_cache (
  singleton boolean primary key check (singleton),
  refreshed_at timestamptz not null,
  snapshot jsonb not null
);
alter table public.festival_attendance_cache enable row level security;
revoke all on public.festival_attendance_cache from public, anon, authenticated;

create function public.festival_attendance_snapshot(p_ttl_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cached public.festival_attendance_cache;
  fresh jsonb;
begin
  if coalesce(p_ttl_seconds, 0) <= 0 then
    return public.festival_daily_attendance();
  end if;
  select c.* into cached from public.festival_attendance_cache c where c.singleton;
  if cached.refreshed_at > clock_timestamp() - make_interval(secs => least(p_ttl_seconds, 60)) then
    return cached.snapshot;
  end if;
  if not pg_try_advisory_xact_lock(3131, 20261121) then
    return coalesce(cached.snapshot, public.festival_daily_attendance());
  end if;
  fresh := public.festival_daily_attendance();
  insert into public.festival_attendance_cache(singleton, refreshed_at, snapshot)
    values (true, statement_timestamp(), fresh)
    on conflict (singleton) do update
    set refreshed_at = excluded.refreshed_at, snapshot = excluded.snapshot;
  return fresh;
end;
$$;
revoke all on function public.festival_attendance_snapshot(integer) from public, anon, authenticated;
grant execute on function public.festival_attendance_snapshot(integer) to service_role;
commit;
