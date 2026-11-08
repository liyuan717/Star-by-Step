-- Preserve bootstrap owner permissions for installations created before the
-- first complete Supabase reset. No client receives this role.
grant energy_api to postgres;
grant create on schema public, private to energy_api;
