begin;
alter table public.registrations drop constraint registrations_visit_check;
alter table public.registrations add constraint registrations_visit_check check (
  visit in ('21', '22', 'both') or (visit = 'demo' and quantity = 1)
);
alter table public.registrations alter column amount_paise set expression as (
  case when checkout_test or visit = 'demo' then 100
       else quantity * case when visit = 'both' then 40000 else 20000 end end
);

-- A demo must not reserve the mobile number needed for a real booking.
create or replace function public.reserve_festival_mobile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.registrations where id = new.registration_id and visit = 'demo') then
    return new;
  end if;
  insert into public.festival_registered_mobiles (mobile) values (new.mobile)
  on conflict do nothing;
  if not found then
    raise sqlstate 'PT409' using message = 'Mobile already registered', detail = new.position::text;
  end if;
  return new;
end;
$$;

create or replace function public.release_festival_mobile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.festival_registered_mobiles where mobile = old.mobile for update;
  delete from public.festival_registered_mobiles
  where mobile = old.mobile and not exists (
    select 1 from public.registration_participants p
    join public.registrations r on r.id = p.registration_id
    where p.mobile = old.mobile and r.visit <> 'demo'
  );
  return old;
end;
$$;
commit;
