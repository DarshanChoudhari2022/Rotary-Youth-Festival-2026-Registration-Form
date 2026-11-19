begin;
alter table public.festival_admissions add column wristband_tied_at timestamptz;

create function public.festival_gate_scan(p_ticket uuid, p_staff uuid, p_action text, p_day date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  result jsonb;
  admission public.festival_admissions;
begin
  if p_action not in ('admit','inspect','wristband') or p_action is null then
    raise exception 'Unknown gate action';
  end if;
  result := public.inspect_festival_ticket(p_ticket, p_staff, p_action = 'admit');
  if result->>'status' not in ('admitted','already_used') then return result; end if;
  if p_action = 'wristband' and p_day = today then
    update public.festival_admissions set wristband_tied_at = statement_timestamp()
      where ticket_id = p_ticket and event_date = today and staff_id = p_staff and wristband_tied_at is null;
  end if;
  select * into admission from public.festival_admissions where ticket_id = p_ticket and event_date = today;
  return result || jsonb_build_object('event_date', today, 'wristband_tied_at', admission.wristband_tied_at,
    'can_confirm_wristband', admission.staff_id = p_staff and admission.wristband_tied_at is null);
end $$;
revoke all on function public.festival_gate_scan(uuid,uuid,text,date) from public,anon,authenticated;
grant execute on function public.festival_gate_scan(uuid,uuid,text,date) to service_role;
commit;
