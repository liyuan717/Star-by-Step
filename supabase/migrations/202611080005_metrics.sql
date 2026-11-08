create or replace function public.get_growth_metrics() returns jsonb language sql security invoker set search_path='' as $$
 with days as (select distinct local_date d from public.task_completions where user_id=auth.uid()),
 islands as (select d,d-row_number() over(order by d)::int g from days),
 streaks as (select count(*) n,max(d) last_day from islands group by g),
 today as (select (clock_timestamp() at time zone timezone)::date d from public.profiles where user_id=auth.uid())
 select jsonb_build_object('study_minutes',coalesce(sum(actual_minutes) filter(where category_snapshot='study'),0),
 'life_count',count(*) filter(where category_snapshot='life'),'exercise_count',count(*) filter(where category_snapshot='exercise'),
 'completion_count',count(*),'longest_streak',coalesce((select max(n) from streaks),0),
 'current_streak',coalesce((select max(n) from streaks,today where last_day between today.d-1 and today.d),0))
 from public.task_completions where user_id=auth.uid()
$$;
