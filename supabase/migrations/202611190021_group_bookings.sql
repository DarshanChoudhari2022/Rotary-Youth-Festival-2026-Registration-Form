begin;
alter table public.registrations
  drop constraint registrations_quantity_check,
  add constraint registrations_quantity_check check (quantity >= 1);
alter table public.registration_participants
  drop constraint registration_participants_position_check,
  add constraint registration_participants_position_check check (position >= 1);
commit;
