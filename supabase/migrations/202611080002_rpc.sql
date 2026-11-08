create function private.period_key(r text, d date) returns text language sql immutable set search_path='' as $$
 select case r when 'once' then 'once' when 'daily' then 'D:'||d::text when 'weekly' then 'W:'||(d-(extract(isodow from d)::int-1))::text end
$$;
create function private.sync_growth(u uuid, ts timestamptz) returns jsonb language plpgsql set search_path='' as $$
declare w public.user_worlds; b record; a record; n int; s bigint; lc int; ec int; streak int; rc int; oldlevel int; nb jsonb:='[]'; na jsonb:='[]';
begin
 select * into w from public.user_worlds where user_id=u for update;
 select count(*),coalesce(sum(actual_minutes) filter(where category_snapshot='study'),0),count(*) filter(where category_snapshot='life'),count(*) filter(where category_snapshot='exercise') into n,s,lc,ec from public.task_completions where user_id=u;
 select coalesce(max(c),0) into streak from (select count(*) c from (select d,d-row_number() over(order by d)::int g from (select distinct local_date d from public.task_completions where user_id=u) q) x group by g) y;
 select count(*) into rc from public.redemptions where user_id=u;
 oldlevel:=w.world_level;
 select greatest(oldlevel,coalesce(max(level),1)) into w.world_level from public.world_levels where min_xp<=w.total_world_xp;
 update public.user_worlds set world_level=w.world_level where user_id=u;
 for i in oldlevel+1..w.world_level loop
  insert into public.timeline_events(user_id,event_key,kind,payload,created_at) values(u,'level:'||i,'level_up',jsonb_build_object('level',i),ts) on conflict do nothing;
 end loop;
 for b in select distinct on (building_key) * from public.building_levels where min_xp<=w.total_world_xp and min_study_minutes<=s and min_life_count<=lc and min_exercise_count<=ec order by building_key,level desc loop
  select coalesce(max(level),0) into oldlevel from public.world_buildings where user_id=u and building_key=b.building_key;
  if b.level>oldlevel then
   insert into public.world_buildings(user_id,building_key,level,unlocked_at,upgraded_at) values(u,b.building_key,b.level,ts,ts)
    on conflict(user_id,building_key) do update set level=excluded.level,upgraded_at=excluded.upgraded_at;
   for i in oldlevel+1..b.level loop
    insert into public.timeline_events(user_id,event_key,kind,payload,created_at) values(u,'building:'||b.building_key||':'||i,'building_level',jsonb_build_object('building_key',b.building_key,'level',i),ts) on conflict do nothing;
   end loop;
   nb:=nb||jsonb_build_array(jsonb_build_object('key',b.building_key,'level',b.level));
  end if;
 end loop;
 for a in select * from public.achievements where active and threshold<=case metric_key when 'count' then n when 'study' then s when 'streak' then streak when 'redemptions' then rc else 0 end loop
  insert into public.user_achievements values(u,a.key,ts) on conflict do nothing;
  if found then
   insert into public.timeline_events(user_id,event_key,kind,payload,created_at) values(u,'achievement:'||a.key,'achievement',jsonb_build_object('title',a.title),ts) on conflict do nothing;
   na:=na||jsonb_build_array(a.key);
  end if;
 end loop;
 return jsonb_build_object('new_buildings',nb,'new_achievements',na);
end $$;

create function private.run(op text, rid uuid, p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); pr public.profiles; req private.rpc_requests; t public.tasks; g public.goals; rw public.rewards; vc public.virtual_catalog;
 w public.wallets; wo public.user_worlds; rules private.economy_rules; du private.daily_usage; ts timestamptz; d date; pk text;
 entity uuid; price int; ver int; ttl text; descr text; img text; st text; oldst text; result jsonb; growth jsonb; vkey text; gid uuid; actual int;
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if rid is null or p is null or jsonb_typeof(p)<>'object' then raise exception 'VALIDATION_ERROR'; end if;
 insert into public.profiles(user_id) values(u) on conflict do nothing;
 select * into pr from public.profiles where user_id=u for update;
 if pr.deletion_requested_at is not null then raise exception 'ACCOUNT_DELETING'; end if;
 select * into req from private.rpc_requests where user_id=u and request_id=rid;
 if found then
  if req.operation<>op or req.payload<>p then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return req.result;
 end if;
 ts:=clock_timestamp(); d:=(ts at time zone pr.timezone)::date;
 if op<>'finish_onboarding' and pr.onboarded_at is null then raise exception 'VALIDATION_ERROR'; end if;
 entity:=nullif(p->>'id','')::uuid;
 if op='finish_onboarding' then
  if pr.onboarded_at is null then
   if not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'timezone') or length(trim(p->>'nickname')) not between 1 and 40 then raise exception 'VALIDATION_ERROR'; end if;
   update public.profiles set nickname=trim(p->>'nickname'),timezone=p->>'timezone',focus_category=coalesce(p->>'focus_category','other'),onboarded_at=ts,updated_at=ts,version=version+1 where user_id=u;
   insert into public.wallets(user_id) values(u); insert into public.user_worlds(user_id) values(u);
   insert into public.world_buildings(user_id,building_key,level,unlocked_at,upgraded_at) values(u,'base',1,ts,ts);
   insert into public.timeline_events(user_id,event_key,kind,created_at) values(u,'world_created','world_created',ts);
   if coalesce((p->>'create_starter')::bool,false) then
    insert into public.tasks(user_id,title,category,energy_reward,recurrence,start_date,system_key) values(u,'写下第一个行动','life',10,'once',(ts at time zone (p->>'timezone'))::date,'starter');
   end if;
  end if;
  result:=jsonb_build_object('user_id',u);
 elsif op='upsert_goal' then
  if entity is not null then
   select * into g from public.goals where id=entity and user_id=u for update;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   if g.version is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
   if g.status in ('archived','completed') then raise exception 'GOAL_INACTIVE'; end if;
  end if;
  if coalesce((p->>'is_primary')::bool,false) then update public.goals set is_primary=false,version=version+1,updated_at=ts where user_id=u and is_primary and id is distinct from entity; end if;
  if entity is null then
   insert into public.goals(user_id,title,description,category,target_count,deadline,is_primary) values(u,trim(p->>'title'),coalesce(p->>'description',''),coalesce(p->>'category','other'),coalesce((p->>'target_count')::int,10),nullif(p->>'deadline','')::date,coalesce((p->>'is_primary')::bool,false)) returning id into entity;
  else
   update public.goals set title=trim(p->>'title'),description=coalesce(p->>'description',''),category=p->>'category',target_count=(p->>'target_count')::int,deadline=nullif(p->>'deadline','')::date,is_primary=coalesce((p->>'is_primary')::bool,false),version=version+1,updated_at=ts where id=entity;
  end if;
  result:=jsonb_build_object('id',entity);
 elsif op='upsert_task' then
  if entity is not null then
   select * into t from public.tasks where id=entity and user_id=u for update;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   if t.version is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
   if t.status='archived' then raise exception 'TASK_INACTIVE'; end if;
   if p->>'recurrence' is distinct from t.recurrence then raise exception 'VALIDATION_ERROR'; end if;
  end if;
  gid:=nullif(p->>'goal_id','')::uuid;
  if gid is not null and not exists(select 1 from public.goals where id=gid and user_id=u and status='active') then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  if entity is null then
   insert into public.tasks(user_id,goal_id,title,description,category,difficulty,energy_reward,recurrence,start_date,end_date,due_date,estimated_minutes)
   values(u,gid,trim(p->>'title'),coalesce(p->>'description',''),coalesce(p->>'category','other'),coalesce(p->>'difficulty','normal'),(p->>'energy_reward')::int,coalesce(p->>'recurrence','once'),coalesce(nullif(p->>'start_date','')::date,d),nullif(p->>'end_date','')::date,nullif(p->>'due_date','')::date,nullif(p->>'estimated_minutes','')::int) returning id into entity;
  else
   update public.tasks set goal_id=gid,title=trim(p->>'title'),description=coalesce(p->>'description',''),category=p->>'category',difficulty=coalesce(p->>'difficulty','normal'),energy_reward=(p->>'energy_reward')::int,start_date=(p->>'start_date')::date,end_date=nullif(p->>'end_date','')::date,due_date=nullif(p->>'due_date','')::date,estimated_minutes=nullif(p->>'estimated_minutes','')::int,version=version+1,updated_at=ts where id=entity;
  end if;
  result:=jsonb_build_object('id',entity);
 elsif op in ('set_task_status','set_goal_status') then
  st:=p->>'next_status';
  if op='set_task_status' then
   select status,version into oldst,ver from public.tasks where id=entity and user_id=u for update;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   if ver is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
   if not ((oldst='active' and st in ('paused','archived')) or (oldst='paused' and st in ('active','archived'))) then raise exception 'TASK_INACTIVE'; end if;
   update public.tasks set status=st,version=version+1,updated_at=ts where id=entity;
  else
   select status,version into oldst,ver from public.goals where id=entity and user_id=u for update;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   if ver is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
   if not ((oldst='active' and st in ('paused','completed','archived')) or (oldst='paused' and st in ('active','archived')) or (oldst='completed' and st='archived')) then raise exception 'GOAL_INACTIVE'; end if;
   update public.goals set status=st,completed_at=case when st='completed' then ts else completed_at end,version=version+1,updated_at=ts where id=entity;
  end if;
  result:=jsonb_build_object('id',entity,'status',st);
 elsif op='complete_task' then
  if p ? 'confirmed_local_date' and (p->>'confirmed_local_date')::date is distinct from d then raise exception 'PERIOD_CHANGED'; end if;
  select * into t from public.tasks where id=(p->>'task_id')::uuid and user_id=u for update;
  if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  if t.status<>'active' then raise exception 'TASK_INACTIVE'; end if;
  if t.version is distinct from (p->>'expected_task_version')::int then raise exception 'VERSION_CONFLICT'; end if;
  if t.goal_id is not null then
   select * into g from public.goals where id=t.goal_id and user_id=u;
   if g.status<>'active' then raise exception 'GOAL_INACTIVE'; end if;
  end if;
  if d<t.start_date or (t.end_date is not null and d>t.end_date) then raise exception 'OUTSIDE_ACTIVE_DATES'; end if;
  actual:=(p->>'actual_minutes')::int;
  if actual is null or actual not between 0 and 480 then raise exception 'VALIDATION_ERROR'; end if;
  pk:=private.period_key(t.recurrence,d);
  if exists(select 1 from public.task_completions where task_id=t.id and period_key=pk) then raise exception 'ALREADY_COMPLETED'; end if;
  select * into rules from private.economy_rules where active;
  if not found then raise exception 'SERVER_ERROR'; end if;
  select * into du from private.daily_usage where user_id=u and local_date=d;
  if coalesce(du.completion_count,0)+1>rules.max_daily_count or coalesce(du.energy_earned,0)+t.energy_reward>rules.max_daily_energy or t.energy_reward>rules.max_task_energy then raise exception 'DAILY_LIMIT_REACHED'; end if;
  select * into w from public.wallets where user_id=u for update;
  select * into wo from public.user_worlds where user_id=u for update;
  if w.lifetime_earned+t.energy_reward>rules.safe_total or wo.total_world_xp+t.energy_reward>rules.safe_total then raise exception 'VALUE_LIMIT_REACHED'; end if;
  entity:=gen_random_uuid();
  insert into public.task_completions values(entity,u,t.id,pk,ts,d,pr.timezone,t.title,t.category,t.goal_id,g.title,t.energy_reward,t.energy_reward,actual,t.version,rules.version);
  insert into private.daily_usage values(u,d,1,t.energy_reward) on conflict(user_id,local_date) do update set completion_count=private.daily_usage.completion_count+1,energy_earned=private.daily_usage.energy_earned+excluded.energy_earned;
  update public.wallets set energy_balance=energy_balance+t.energy_reward,lifetime_earned=lifetime_earned+t.energy_reward where user_id=u returning * into w;
  update public.user_worlds set total_world_xp=total_world_xp+t.energy_reward where user_id=u;
  insert into public.energy_transactions(user_id,amount,type,completion_id,balance_after,created_at) values(u,t.energy_reward,'task',entity,w.energy_balance,ts);
  growth:=private.sync_growth(u,ts);
  select * into wo from public.user_worlds where user_id=u;
  insert into public.timeline_events(user_id,event_key,kind,payload,created_at) values(u,'task:'||entity,'task_completed',jsonb_build_object('title',t.title,'energy',t.energy_reward),ts);
  result:=jsonb_build_object('completion_id',entity,'period_key',pk,'energy_awarded',t.energy_reward,'xp_awarded',t.energy_reward,'balance_after',w.energy_balance,'total_world_xp',wo.total_world_xp,'world_level',wo.world_level)||growth;
 elsif op='upsert_real_reward' then
  img:=nullif(p->>'image_path','');
  if img is not null and (img not like u::text||'/rewards/%' or img like '%..%') then raise exception 'VALIDATION_ERROR'; end if;
  if entity is null then
   insert into public.rewards(user_id,title,description,image_path,energy_cost) values(u,trim(p->>'title'),coalesce(p->>'description',''),img,(p->>'energy_cost')::int) returning id into entity;
  else
   select * into rw from public.rewards where user_id=u and id=entity for update;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   if rw.version is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
   if rw.status<>'active' then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   update public.rewards set title=trim(p->>'title'),description=coalesce(p->>'description',''),image_path=img,energy_cost=(p->>'energy_cost')::int,version=version+1,updated_at=ts where id=entity;
  end if;
  result:=jsonb_build_object('id',entity);
 elsif op='archive_reward' then
  select * into rw from public.rewards where user_id=u and id=entity for update;
  if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  if rw.version is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
  update public.rewards set status='archived',version=version+1,updated_at=ts where id=entity;
  result:=jsonb_build_object('id',entity);
 elsif op='redeem_reward' then
  gid:=nullif(p->>'real_reward_id','')::uuid; vkey:=nullif(p->>'virtual_key','');
  if (gid is null)=(vkey is null) then raise exception 'VALIDATION_ERROR'; end if;
  if gid is not null then
   select * into rw from public.rewards where user_id=u and id=gid and status='active' for update;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   price:=rw.energy_cost; ver:=rw.version; ttl:=rw.title; descr:=rw.description; img:=rw.image_path;
  else
   select * into vc from public.virtual_catalog where key=vkey and active for share;
   if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
   if exists(select 1 from public.user_inventory where user_id=u and virtual_key=vkey) then raise exception 'ALREADY_OWNED'; end if;
   price:=vc.energy_cost; ver:=vc.version; ttl:=vc.title; descr:=vc.description;
  end if;
  if ver is distinct from (p->>'expected_source_version')::int or price is distinct from (p->>'expected_cost')::int then raise exception 'PRICE_CHANGED'; end if;
  update public.wallets set energy_balance=energy_balance-price,lifetime_spent=lifetime_spent+price where user_id=u and energy_balance>=price returning * into w;
  if not found then raise exception 'INSUFFICIENT_ENERGY'; end if;
  entity:=gen_random_uuid();
  insert into public.redemptions values(entity,u,gid,vkey,ttl,descr,img,price,ver,case when gid is null then 'delivered' else 'redeemed' end,ts,d,null);
  insert into public.energy_transactions(user_id,amount,type,redemption_id,balance_after,created_at) values(u,-price,'redemption',entity,w.energy_balance,ts);
  if vkey is not null then insert into public.user_inventory values(u,vkey,vc.slot,entity,false,ts); end if;
  insert into public.timeline_events(user_id,event_key,kind,payload,created_at) values(u,'redemption:'||entity,'redemption',jsonb_build_object('title',ttl,'energy',price),ts);
  growth:=private.sync_growth(u,ts);
  result:=jsonb_build_object('redemption_id',entity,'balance_after',w.energy_balance)||growth;
 elsif op='mark_reward_enjoyed' then
  update public.redemptions set status='enjoyed',enjoyed_at=coalesce(enjoyed_at,ts) where user_id=u and id=(p->>'redemption_id')::uuid and real_reward_id is not null returning id into entity;
  if not found then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  result:=jsonb_build_object('id',entity,'status','enjoyed');
 elsif op='equip_decoration' then
  vkey:=p->>'virtual_key'; select slot into st from public.user_inventory where user_id=u and virtual_key=vkey;
  if not found then raise exception 'NOT_OWNED'; end if;
  if (p->>'equipped')::bool then update public.user_inventory set equipped=false where user_id=u and slot=st; end if;
  update public.user_inventory set equipped=(p->>'equipped')::bool where user_id=u and virtual_key=vkey;
  result:=jsonb_build_object('virtual_key',vkey);
 elsif op='sync_world' then result:=private.sync_growth(u,ts);
 elsif op='update_profile' then
  if pr.version is distinct from (p->>'expected_version')::int then raise exception 'VERSION_CONFLICT'; end if;
  img:=nullif(p->>'avatar_path','');
  if img is not null and (img not like u::text||'/avatars/%' or img like '%..%') then raise exception 'VALIDATION_ERROR'; end if;
  if p ? 'nickname' and length(trim(p->>'nickname')) not between 1 and 40 then raise exception 'VALIDATION_ERROR'; end if;
  update public.profiles set nickname=coalesce(trim(p->>'nickname'),nickname),avatar_path=case when p ? 'avatar_path' then img else avatar_path end,version=version+1,updated_at=ts where user_id=u;
  if p ? 'world_name' then update public.user_worlds set world_name=trim(p->>'world_name') where user_id=u; end if;
  result:=jsonb_build_object('user_id',u);
 else raise exception 'VALIDATION_ERROR';
 end if;
 result:=jsonb_build_object('ok',true,'data',result);
 insert into private.rpc_requests values(u,rid,op,p,result,ts);
 return result;
exception
 when raise_exception then
  if sqlerrm in ('PERIOD_CHANGED','AUTH_REQUIRED','ACCOUNT_DELETING','VALIDATION_ERROR','IDEMPOTENCY_CONFLICT','NOT_FOUND_OR_FORBIDDEN','VERSION_CONFLICT','GOAL_INACTIVE','TASK_INACTIVE','OUTSIDE_ACTIVE_DATES','ALREADY_COMPLETED','DAILY_LIMIT_REACHED','VALUE_LIMIT_REACHED','ALREADY_OWNED','PRICE_CHANGED','INSUFFICIENT_ENERGY','NOT_OWNED') then
   return jsonb_build_object('ok',false,'code',sqlerrm,'message',sqlerrm,'retryable',false);
  end if;
  raise exception 'SERVER_ERROR';
 when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','输入不符合约束','retryable',false);
 when others then raise exception using message='SERVER_ERROR',errcode='P0001';
end $$;
alter function private.run(text,uuid,jsonb) owner to energy_api;
alter function private.sync_growth(uuid,timestamptz) owner to energy_api;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.period_key(text,date) to energy_api;
do $$ declare op text; begin
 foreach op in array array['finish_onboarding','upsert_goal','upsert_task','set_task_status','set_goal_status','complete_task','upsert_real_reward','archive_reward','redeem_reward','mark_reward_enjoyed','equip_decoration','sync_world','update_profile'] loop
  execute format('create function public.%I(p_request_id uuid,p_payload jsonb default ''{}'') returns jsonb language sql security definer set search_path='''' as %L',op,format('select private.run(%L,p_request_id,p_payload)',op));
  execute format('alter function public.%I(uuid,jsonb) owner to energy_api',op);
  execute format('revoke all on function public.%I(uuid,jsonb) from public,anon',op);
  execute format('grant execute on function public.%I(uuid,jsonb) to authenticated',op);
 end loop;
end $$;

create function public.get_request_result(p_request_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('found',exists(select 1 from private.rpc_requests where user_id=auth.uid() and request_id=p_request_id),'result',(select result from private.rpc_requests where user_id=auth.uid() and request_id=p_request_id))
$$;
create function public.get_home_context() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); pr public.profiles; d date; ts timestamptz:=clock_timestamp();
begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into pr from public.profiles where user_id=u; d:=(ts at time zone coalesce(pr.timezone,'UTC'))::date;
 return jsonb_build_object('server_now',ts,'today',d,'timezone',pr.timezone,'profile',to_jsonb(pr),
 'wallet',(select to_jsonb(w) from public.wallets w where user_id=u),'world',(select to_jsonb(w) from public.user_worlds w where user_id=u),
 'usage',coalesce((select to_jsonb(x) from private.daily_usage x where user_id=u and local_date=d),'{}'),
 'rules',(select to_jsonb(r) from private.economy_rules r where active),
 'pending',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from public.tasks t where t.user_id=u and t.status='active' and t.start_date<=d and (t.end_date is null or t.end_date>=d) and (t.goal_id is null or exists(select 1 from public.goals g where g.id=t.goal_id and g.user_id=u and g.status='active')) and not exists(select 1 from public.task_completions c where c.task_id=t.id and c.period_key=private.period_key(t.recurrence,d))),'[]'));
end $$;
create function public.get_statistics(p_days int) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); d date; z text; begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_days not in (7,30) then raise exception 'VALIDATION_ERROR'; end if;
 select timezone into z from public.profiles where user_id=u; d:=(clock_timestamp() at time zone z)::date;
 return (select jsonb_agg(jsonb_build_object('date',day::date,'completions',(select count(*) from public.task_completions where user_id=u and local_date=day::date),'earned',coalesce((select sum(energy_awarded) from public.task_completions where user_id=u and local_date=day::date),0),'spent',coalesce((select sum(energy_spent) from public.redemptions where user_id=u and local_date=day::date),0),'study_minutes',coalesce((select sum(actual_minutes) from public.task_completions where user_id=u and local_date=day::date and category_snapshot='study'),0)) order by day) from generate_series(d-p_days+1,d,'1 day'::interval) day);
end $$;
-- Static branches only: clients cannot interpolate table names into SQL.
create function public.export_my_data(p_entity text,p_cursor uuid default null,p_limit int default 30) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; u uuid:=auth.uid(); begin
 if u is null then raise exception 'AUTH_REQUIRED'; end if;
 if p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
 select coalesce(jsonb_agg(data order by id),'[]') into rows from (
  select id,to_jsonb(t) data from public.goals t where p_entity='goals' and user_id=u union all
  select id,to_jsonb(t) from public.tasks t where p_entity='tasks' and user_id=u union all
  select id,to_jsonb(t) from public.task_completions t where p_entity='task_completions' and user_id=u union all
  select id,to_jsonb(t) from public.energy_transactions t where p_entity='energy_transactions' and user_id=u union all
  select id,to_jsonb(t) from public.rewards t where p_entity='rewards' and user_id=u union all
  select id,to_jsonb(t) from public.redemptions t where p_entity='redemptions' and user_id=u union all
  select id,to_jsonb(t) from public.timeline_events t where p_entity='timeline_events' and user_id=u union all
  select id,to_jsonb(t) from public.world_buildings t where p_entity='world_buildings' and user_id=u union all
  select user_id,to_jsonb(t) from public.user_worlds t where p_entity='user_worlds' and user_id=u union all
  select user_id,to_jsonb(t) from public.wallets t where p_entity='wallets' and user_id=u union all
  select user_id,to_jsonb(t) from public.profiles t where p_entity='profiles' and user_id=u
 ) q where p_cursor is null or id>p_cursor;
 -- Inventory and achievements use stable text keys and are bounded catalogs.
 if p_entity='user_inventory' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from public.user_inventory t where user_id=u; end if;
 if p_entity='user_achievements' then select coalesce(jsonb_agg(to_jsonb(t)),'[]') into rows from public.user_achievements t where user_id=u; end if;
 return jsonb_build_object('schema_version',1,'entity',p_entity,'rows',(select coalesce(jsonb_agg(v),'[]') from (select v from jsonb_array_elements(rows) v limit p_limit) x),'next_cursor',case when jsonb_array_length(rows)>p_limit then rows->(p_limit-1)->>'id' end);
end $$;
do $$ declare f text; begin
 foreach f in array array['get_request_result(uuid)','get_home_context()','get_statistics(integer)','export_my_data(text,uuid,integer)'] loop
  execute 'alter function public.'||f||' owner to energy_api';
  execute 'revoke all on function public.'||f||' from public,anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
end $$;
