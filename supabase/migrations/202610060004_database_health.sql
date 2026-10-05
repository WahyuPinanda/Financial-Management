-- Connectivity probe exposes no financial or account information.
create or replace function public.database_healthcheck()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select jsonb_build_object('ok',true,'checked_at',statement_timestamp()) $$;
revoke all on function public.database_healthcheck() from public;
grant execute on function public.database_healthcheck() to anon, authenticated;
