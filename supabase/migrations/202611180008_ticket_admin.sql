begin;
create table public.festival_admin_audit (
  id bigint generated always as identity primary key,
  actor uuid not null,
  action text not null check (action in ('edit', 'revoke')),
  target text not null,
  happened_at timestamptz not null default now()
);
alter table public.festival_admin_audit enable row level security;
revoke all on public.festival_admin_audit from public, anon, authenticated;

create function public.festival_admin_dashboard(p_page integer, p_find text)
returns jsonb language sql security definer set search_path = '' as $$
  with days(day, visit) as (
    values (date '2026-11-21', '21'), (date '2026-11-22', '22')
  ), stats as (
    select d.day,
      count(distinct r.id) as registrations,
      count(*) filter (where r.id is not null) as participants,
      count(*) filter (where p.date_of_birth > (d.day - interval '16 years')::date) as under_16,
      count(*) filter (where r.status = 'paid' and t.id is not null and t.revoked_at is null and pay.registration_id is not null) as paid,
      count(*) filter (where r.status = 'paid' and t.id is not null and t.revoked_at is null
        and pay.registration_id is not null and p.date_of_birth > (d.day - interval '16 years')::date) as paid_under_16
    from days d
    left join public.registrations r on r.visit in (d.visit, 'both') and not r.checkout_test
    left join public.registration_participants p on p.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    left join public.festival_payments pay on pay.registration_id = r.id
      and pay.revoked_at is null and pay.amount_paise = r.amount_paise
    group by d.day
  ), matches as (
    select r.id as booking_id, r.visit, r.checkout_test, r.status, r.amount_paise, r.created_at,
      p.position, p.first_name, p.last_name, p.organization, p.city,
      t.id as ticket_id, t.revoked_at,
      case when r.visit in ('21', 'both') and not r.checkout_test then p.date_of_birth > date '2010-11-21' end as under_16_day_one,
      case when r.visit in ('22', 'both') and not r.checkout_test then p.date_of_birth > date '2010-11-22' end as under_16_day_two
    from public.registrations r
    join public.registration_participants p on p.registration_id = r.id
    left join public.festival_tickets t on t.registration_id = p.registration_id and t.position = p.position
    where p_find = '' or r.id = p_find or t.id::text = lower(p_find)
    order by r.created_at desc, r.id, p.position
    limit 26 offset (greatest(p_page, 0)::bigint * 25)
  )
  select jsonb_build_object('days', (select jsonb_agg(stats order by day) from stats),
    'participants', coalesce((select jsonb_agg(matches order by created_at desc, booking_id, position) from matches), '[]'::jsonb))
$$;

create function public.festival_admin_edit(p_actor uuid, p_booking text, p_position integer,
  p_first text, p_last text, p_organization text, p_city text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.registration_participants
    set first_name = p_first, last_name = p_last, organization = p_organization, city = p_city
    where registration_id = p_booking and position = p_position;
  if not found then return false; end if;
  insert into public.festival_admin_audit(actor, action, target) values(p_actor, 'edit', p_booking || ':' || p_position);
  return true;
end $$;

create function public.festival_admin_revoke(p_actor uuid, p_ticket uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.festival_tickets set revoked_at = now() where id = p_ticket and revoked_at is null;
  if not found then return false; end if;
  insert into public.festival_admin_audit(actor, action, target) values(p_actor, 'revoke', p_ticket::text);
  return true;
end $$;

revoke all on function public.festival_admin_dashboard(integer,text),
  public.festival_admin_edit(uuid,text,integer,text,text,text,text), public.festival_admin_revoke(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.festival_admin_dashboard(integer,text),
  public.festival_admin_edit(uuid,text,integer,text,text,text,text), public.festival_admin_revoke(uuid,uuid)
  to service_role;
commit;
