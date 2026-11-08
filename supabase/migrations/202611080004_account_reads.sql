create function public.get_growth_metrics() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('study_minutes',coalesce(sum(actual_minutes) filter(where category_snapshot='study'),0),'life_count',count(*) filter(where category_snapshot='life'),'exercise_count',count(*) filter(where category_snapshot='exercise'),'completion_count',count(*)) from public.task_completions where user_id=auth.uid()
$$;
revoke all on function public.get_growth_metrics() from public,anon;
grant execute on function public.get_growth_metrics() to authenticated;
-- Service-only: Edge verifies JWT and password before passing verified identity.
create function public.lock_account_deletion(p_verified_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=p_verified_user for update;
 update public.profiles set deletion_requested_at=coalesce(deletion_requested_at,clock_timestamp()) where user_id=p_verified_user;
end $$;
alter function public.lock_account_deletion(uuid) owner to energy_api;
revoke all on function public.lock_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.lock_account_deletion(uuid) to service_role;

-- Bounded export: each static branch applies an indexed UUID cursor before aggregation.
create or replace function public.export_my_data(p_entity text,p_cursor uuid default null,p_limit int default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; u uuid:=auth.uid(); begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_limit is null or p_limit not between 1 and 100 or p_entity not in ('profiles','goals','tasks','task_completions','energy_transactions','rewards','redemptions','timeline_events','world_buildings','user_worlds','wallets','user_inventory','user_achievements') then raise exception 'VALIDATION_ERROR'; end if;
 select coalesce(jsonb_agg(data order by id),'[]') into rows from (
  select * from (
   (select id,to_jsonb(t) data from public.goals t where p_entity='goals' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.tasks t where p_entity='tasks' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.task_completions t where p_entity='task_completions' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.energy_transactions t where p_entity='energy_transactions' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.rewards t where p_entity='rewards' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.redemptions t where p_entity='redemptions' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.timeline_events t where p_entity='timeline_events' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   (select id,to_jsonb(t) from public.world_buildings t where p_entity='world_buildings' and user_id=u and (p_cursor is null or id>p_cursor) order by id limit p_limit+1) union all
   select user_id,to_jsonb(t) from public.user_worlds t where p_entity='user_worlds' and user_id=u union all
   select user_id,to_jsonb(t) from public.wallets t where p_entity='wallets' and user_id=u union all
   select user_id,to_jsonb(t) from public.profiles t where p_entity='profiles' and user_id=u
  ) all_rows order by id limit p_limit+1
 ) page;
 if p_entity='user_inventory' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from public.user_inventory t where user_id=u; end if;
 if p_entity='user_achievements' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from public.user_achievements t where user_id=u; end if;
 return jsonb_build_object('schema_version',1,'entity',p_entity,'rows',(select coalesce(jsonb_agg(v),'[]') from (select v from jsonb_array_elements(rows) v limit p_limit) x),'next_cursor',case when jsonb_array_length(rows)>p_limit then rows->(p_limit-1)->>'id' end);
end $$;
