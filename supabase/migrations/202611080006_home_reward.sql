alter function public.get_home_context() set schema private;
revoke all on function private.get_home_context() from public, anon, authenticated;
create function public.get_home_context() returns jsonb language sql security definer set search_path='' as $$
 select private.get_home_context() || jsonb_build_object('next_reward',(
  select to_jsonb(r) from public.rewards r where r.user_id=auth.uid() and r.status='active'
  order by greatest(r.energy_cost-(select energy_balance from public.wallets where user_id=auth.uid()),0),r.energy_cost,r.created_at,r.id limit 1
 ))
$$;
alter function public.get_home_context() owner to energy_api;
revoke all on function public.get_home_context() from public,anon;
grant execute on function public.get_home_context() to authenticated;
