begin;
alter table public.registrations add column checkout_test boolean not null default false;
alter table public.registrations add constraint checkout_test_single_participant
  check (not checkout_test or (quantity = 1 and visit = '21'));
create unique index one_private_checkout_test on public.registrations (checkout_test) where checkout_test;
alter table public.registrations alter column amount_paise set expression as (
  case when checkout_test then 100 else quantity * case when visit = 'both' then 40000 else 20000 end end
);
commit;
