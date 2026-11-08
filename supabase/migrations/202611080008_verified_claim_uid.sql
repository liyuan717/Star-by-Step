-- The native Supabase auth schema grants USAGE only to its managed roles.
-- Read the same JWT claims as auth.uid(), without widening access to auth data.
create function private.uid() returns uuid language sql stable set search_path='' as $$
 select coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),
   nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
alter function private.uid() owner to energy_api;
revoke all on function private.uid() from public,anon,authenticated;
do $$ declare f record; definition text; begin
 for f in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef and p.proowner=(select oid from pg_catalog.pg_roles where rolname='energy_api') loop
  definition:=pg_catalog.pg_get_functiondef(f.oid);
  if position('auth.uid()' in definition)>0 then
   execute replace(definition,'auth.uid()','private.uid()');
  end if;
 end loop;
end $$;
