begin;
alter table public.registration_participants alter column mobile drop not null;
drop trigger if exists reserve_festival_mobile on public.registration_participants;
drop trigger if exists reserve_updated_festival_mobile on public.registration_participants;
drop trigger if exists release_festival_mobile on public.registration_participants;
drop trigger if exists release_updated_festival_mobile on public.registration_participants;
commit;
