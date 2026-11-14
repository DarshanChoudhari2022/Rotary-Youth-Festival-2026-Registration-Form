begin;

lock table public.registration_participants in share row exclusive mode;

-- Preserve historical entries while reserving every number already in use.
create table public.festival_registered_mobiles (
  mobile text primary key
);
alter table public.festival_registered_mobiles enable row level security;
revoke all on public.festival_registered_mobiles from public, anon, authenticated;
insert into public.festival_registered_mobiles (mobile)
select distinct mobile from public.registration_participants;

create function public.reserve_festival_mobile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.festival_registered_mobiles (mobile) values (new.mobile)
  on conflict do nothing;
  if not found then
    raise sqlstate 'PT409' using message = 'Mobile already registered', detail = new.position::text;
  end if;
  return new;
end;
$$;

create trigger reserve_festival_mobile before insert on public.registration_participants
for each row execute function public.reserve_festival_mobile();

create function public.release_festival_mobile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.festival_registered_mobiles where mobile = old.mobile for update;
  delete from public.festival_registered_mobiles
  where mobile = old.mobile and not exists (
    select 1 from public.registration_participants where mobile = old.mobile
  );
  return old;
end;
$$;

create trigger reserve_updated_festival_mobile before update of mobile on public.registration_participants
for each row when (old.mobile is distinct from new.mobile)
execute function public.reserve_festival_mobile();

create trigger release_festival_mobile after delete on public.registration_participants
for each row execute function public.release_festival_mobile();

create trigger release_updated_festival_mobile after update of mobile on public.registration_participants
for each row when (old.mobile is distinct from new.mobile)
execute function public.release_festival_mobile();

revoke all on function public.reserve_festival_mobile(), public.release_festival_mobile()
from public, anon, authenticated;
commit;
