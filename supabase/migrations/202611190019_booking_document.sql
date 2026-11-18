begin;
create function public.festival_booking_document(p_booking text, p_download boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'booking', jsonb_build_object('id', r.id, 'visit', r.visit, 'quantity', r.quantity,
      'amount_paise', r.amount_paise, 'status', r.status, 'checkout_test', r.checkout_test),
    'payment', case when pay.registration_id is not null then
      jsonb_build_object('amount_paise', pay.amount_paise, 'transaction_id', pay.transaction_id, 'verified_at', pay.verified_at)
    end,
    'tickets', case when p_download and r.status = 'paid' and pay.amount_paise = r.amount_paise then
      (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'position', t.position,
        'revoked_at', t.revoked_at) order by t.position), '[]'::jsonb)
        from public.festival_tickets t where t.registration_id = r.id)
    end,
    'people', case when p_download and r.status = 'paid' and pay.amount_paise = r.amount_paise then
      (select coalesce(jsonb_agg(jsonb_build_object('position', p.position, 'first_name', p.first_name,
        'last_name', p.last_name, 'mobile', p.mobile, 'email', p.email, 'date_of_birth', p.date_of_birth,
        'organization', p.organization, 'city', p.city) order by p.position), '[]'::jsonb)
        from public.registration_participants p where p.registration_id = r.id)
    end
  )
  from public.registrations r left join public.festival_payments pay
    on pay.registration_id = r.id and pay.revoked_at is null
  where r.id = p_booking
$$;
revoke all on function public.festival_booking_document(text, boolean) from public, anon, authenticated;
grant execute on function public.festival_booking_document(text, boolean) to service_role;
commit;
