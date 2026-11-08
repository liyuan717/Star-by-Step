create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
do $$ begin if not exists(select 1 from pg_catalog.pg_roles where rolname='energy_api') then create role energy_api nologin bypassrls; end if; end $$;
grant usage on schema public, private, auth to energy_api;
-- Supabase's migration role is not a PostgreSQL superuser. Ownership transfer
-- requires membership and CREATE on the destination schemas.
grant energy_api to postgres;
grant create on schema public, private to energy_api;
grant execute on function auth.uid() to energy_api;

create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null default '' check(length(nickname)<=40), timezone text not null default 'UTC',
 focus_category text not null default 'other' check(focus_category in ('study','exercise','work','skill','life','other')),
 avatar_path text, onboarded_at timestamptz, deletion_requested_at timestamptz,
 version int not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.goals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 title text not null check(length(trim(title)) between 1 and 80), description text not null default '' check(length(description)<=2000),
 category text not null check(category in ('study','exercise','work','skill','life','other')),
 status text not null default 'active' check(status in ('active','paused','completed','archived')),
 deadline date, target_count int not null default 10 check(target_count between 1 and 10000), is_primary bool not null default false,
 completed_at timestamptz, version int not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id)
);
create unique index one_primary_goal on public.goals(user_id) where is_primary and status<>'archived';
create table public.tasks (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, goal_id uuid,
 title text not null check(length(trim(title)) between 1 and 80), description text not null default '' check(length(description)<=2000),
 category text not null check(category in ('study','exercise','work','skill','life','other')),
 difficulty text not null default 'normal' check(difficulty in ('micro','easy','normal','medium','hard','milestone','ultimate')),
 energy_reward int not null check(energy_reward between 1 and 300), recurrence text not null check(recurrence in ('once','daily','weekly')),
 start_date date not null, end_date date, due_date date, estimated_minutes int check(estimated_minutes between 1 and 480),
 status text not null default 'active' check(status in ('active','paused','archived')), system_key text,
 version int not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,id), foreign key(user_id,goal_id) references public.goals(user_id,id),
 check(end_date is null or end_date>=start_date), check(due_date is null or (recurrence='once' and due_date>=start_date))
);
create unique index task_system_once on public.tasks(user_id,system_key) where system_key is not null;
create table public.wallets (
 user_id uuid primary key references public.profiles on delete cascade,
 energy_balance bigint not null default 0 check(energy_balance between 0 and 9000000000000),
 lifetime_earned bigint not null default 0 check(lifetime_earned between 0 and 9000000000000),
 lifetime_spent bigint not null default 0 check(lifetime_spent between 0 and 9000000000000),
 check(energy_balance=lifetime_earned-lifetime_spent)
);
create table public.user_worlds (
 user_id uuid primary key references public.profiles on delete cascade, world_name text not null default '起源星' check(length(trim(world_name)) between 1 and 40),
 planet_key text not null default 'origin' check(planet_key='origin'), total_world_xp bigint not null default 0 check(total_world_xp between 0 and 9000000000000),
 world_level int not null default 1 check(world_level between 1 and 10)
);
create table public.task_completions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, task_id uuid not null,
 period_key text not null, completed_at timestamptz not null, local_date date not null, timezone_snapshot text not null,
 task_title_snapshot text not null, category_snapshot text not null, goal_id_snapshot uuid, goal_title_snapshot text,
 energy_awarded int not null check(energy_awarded between 1 and 300), xp_awarded int not null check(xp_awarded=energy_awarded),
 actual_minutes int not null check(actual_minutes between 0 and 480), task_version int not null, rule_version int not null,
 unique(task_id,period_key), unique(user_id,id), foreign key(user_id,task_id) references public.tasks(user_id,id),
 foreign key(user_id,goal_id_snapshot) references public.goals(user_id,id)
);
create table public.rewards (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 title text not null check(length(trim(title)) between 1 and 80), description text not null default '' check(length(description)<=2000), image_path text,
 energy_cost int not null check(energy_cost between 1 and 1000000), status text not null default 'active' check(status in ('active','archived')),
 version int not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,id)
);
create table public.virtual_catalog (
 key text primary key, title text not null, description text not null, energy_cost int not null check(energy_cost>0),
 slot text not null check(slot in ('beacon','garden','sky')), asset_key text not null unique, active bool not null default true,
 version int not null default 1 check(version>0), unique(key,slot)
);
create table public.redemptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 real_reward_id uuid, virtual_key text references public.virtual_catalog, title_snapshot text not null, description_snapshot text not null,
 image_path_snapshot text, energy_spent int not null check(energy_spent>0), source_version int not null,
 status text not null check(status in ('redeemed','enjoyed','delivered')), redeemed_at timestamptz not null, local_date date not null, enjoyed_at timestamptz,
 unique(user_id,id), unique(user_id,id,virtual_key), foreign key(user_id,real_reward_id) references public.rewards(user_id,id),
 check((real_reward_id is not null and virtual_key is null and status in ('redeemed','enjoyed')) or (real_reward_id is null and virtual_key is not null and status='delivered'))
);
create unique index virtual_owned_once on public.redemptions(user_id,virtual_key) where virtual_key is not null;
create table public.energy_transactions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 amount bigint not null check(amount<>0), type text not null check(type in ('task','redemption')), completion_id uuid, redemption_id uuid,
 balance_after bigint not null check(balance_after between 0 and 9000000000000), created_at timestamptz not null,
 foreign key(user_id,completion_id) references public.task_completions(user_id,id), foreign key(user_id,redemption_id) references public.redemptions(user_id,id),
 check((type='task' and amount>0 and completion_id is not null and redemption_id is null) or (type='redemption' and amount<0 and redemption_id is not null and completion_id is null))
);
create unique index one_task_ledger on public.energy_transactions(completion_id) where completion_id is not null;
create unique index one_redemption_ledger on public.energy_transactions(redemption_id) where redemption_id is not null;
create table public.world_levels (level int primary key, min_xp bigint not null unique, version int not null default 1);
create table public.building_levels (
 building_key text not null, level int not null check(level between 1 and 3), min_xp bigint not null,
 min_study_minutes int not null default 0, min_life_count int not null default 0, min_exercise_count int not null default 0,
 asset_key text not null, grid_i int not null, grid_j int not null, primary key(building_key,level)
);
create table public.world_buildings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.user_worlds on delete cascade,
 building_key text not null, level int not null, unlocked_at timestamptz not null, upgraded_at timestamptz not null,
 unique(user_id,building_key), foreign key(building_key,level) references public.building_levels(building_key,level)
);
create table public.user_inventory (
 user_id uuid not null references public.profiles on delete cascade, virtual_key text not null, slot text not null,
 acquired_redemption_id uuid not null unique, equipped bool not null default false, acquired_at timestamptz not null,
 primary key(user_id,virtual_key), foreign key(virtual_key,slot) references public.virtual_catalog(key,slot),
 foreign key(user_id,acquired_redemption_id,virtual_key) references public.redemptions(user_id,id,virtual_key)
);
create unique index one_equipped_slot on public.user_inventory(user_id,slot) where equipped;
create table public.achievements (key text primary key, title text not null, description text not null, metric_key text not null, threshold int not null check(threshold>0), asset_key text not null, active bool not null default true);
create table public.user_achievements (user_id uuid not null references public.profiles on delete cascade, achievement_key text not null references public.achievements, unlocked_at timestamptz not null, primary key(user_id,achievement_key));
create table public.timeline_events (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, event_key text not null, kind text not null check(kind in ('world_created','task_completed','level_up','building_level','achievement','redemption')), payload jsonb not null default '{}', created_at timestamptz not null, unique(user_id,event_key));
create table private.rpc_requests (user_id uuid not null references public.profiles on delete cascade, request_id uuid not null, operation text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null, primary key(user_id,request_id));
create table private.daily_usage (user_id uuid not null references public.profiles on delete cascade, local_date date not null, completion_count int not null check(completion_count>=0), energy_earned int not null check(energy_earned>=0), primary key(user_id,local_date));
create table private.economy_rules (version int primary key, active bool not null, max_task_energy int not null, max_daily_count int not null, max_daily_energy int not null, safe_total bigint not null check(safe_total<=9000000000000));
create unique index one_active_rule on private.economy_rules(active) where active;

do $$ declare t text; begin
 foreach t in array array['profiles','goals','tasks','wallets','user_worlds','task_completions','rewards','redemptions','energy_transactions','world_buildings','user_inventory','user_achievements','timeline_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  execute format('create index on public.%I(user_id)',t);
 end loop;
 foreach t in array array['virtual_catalog','world_levels','building_levels','achievements'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy catalog_read on public.%I for select to authenticated using (true)',t);
 end loop;
end $$;
create index on public.tasks(user_id,status);
create index on public.tasks(user_id,goal_id);
create index on public.task_completions(user_id,local_date);
create index on public.task_completions(user_id,goal_id_snapshot);
create index on public.task_completions(user_id,category_snapshot);
create index on public.task_completions(user_id,completed_at desc,id desc);
create index on public.redemptions(user_id,redeemed_at desc,id desc);
create index on public.energy_transactions(user_id,created_at desc,id desc);
create index on public.timeline_events(user_id,created_at desc,id desc);
create index on public.goals(user_id,created_at desc,id desc);
create index on public.tasks(user_id,created_at desc,id desc);
create index on public.rewards(user_id,created_at desc,id desc);
grant all on all tables in schema public, private to energy_api;
