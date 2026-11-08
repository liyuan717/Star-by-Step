begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
select ok(not has_table_privilege('authenticated','public.wallets','UPDATE'),'wallet direct update denied');
select ok(not has_table_privilege('authenticated','public.task_completions','INSERT'),'completion direct insert denied');
select ok(not has_function_privilege('anon','public.complete_task(uuid,jsonb)','EXECUTE'),'anonymous complete denied');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'private schema denied');
select * from finish();
rollback;
