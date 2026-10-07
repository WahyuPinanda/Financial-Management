begin;

-- A verified factor makes AAL2 mandatory, including direct PostgREST calls.
create function public.finance_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    coalesce(auth.jwt()->>'aal','aal1')='aal2' or not exists(
      select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified'
    )
  );
$$;
revoke all on function public.finance_access_allowed() from public,anon;
grant execute on function public.finance_access_allowed() to authenticated;
create function public.finance_require_mfa() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.finance_access_allowed() then
    raise exception 'Verifikasi dua langkah diperlukan.' using errcode='42501';
  end if;
end $$;
revoke all on function public.finance_require_mfa() from public,anon,authenticated;

-- SECURITY DEFINER RPCs bypass table RLS, so guard every exposed financial RPC.
-- Keep the old bodies private, including defaults and volatility of each function.
do $$
declare f record; args text; body text; private_name text; call_args text;
begin
  for f in select p.*,pg_get_function_identity_arguments(p.oid) as identity_args,
    pg_get_function_arguments(p.oid) as arguments,pg_get_function_result(p.oid) as result_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'save_financial_record','workspace_snapshot','finance_snapshot','finance_command',
      'finance_prepare_receipt','finance_confirm_receipt','finance_create_export',
      'finance_claim_export','finance_export_batch','finance_advance_export',
      'finance_finish_export','finance_integrity'
    )
  loop
    private_name:=f.proname||'_without_mfa';
    select coalesce(string_agg(format('%I',v),','),'') into call_args from unnest(f.proargnames) as v;
    execute format('alter function public.%I(%s) rename to %I',f.proname,f.identity_args,private_name);
    execute format('revoke all on function public.%I(%s) from public,anon,authenticated',private_name,f.identity_args);
    body:='begin perform public.finance_require_mfa(); '||
      case when f.result_type='void' then 'perform ' else 'return ' end||
      format('public.%I(%s);',private_name,call_args)||' end';
    execute format('create function public.%I(%s) returns %s language plpgsql %s security definer set search_path='''' as %L',
      f.proname,f.arguments,f.result_type,case when f.provolatile='s' then 'stable' else 'volatile' end,body);
    execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
    execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_args);
  end loop;
  for f in select tablename from pg_tables where schemaname='public' and tablename in (
    'harvests','spks','harvest_expenses','cash_expenses','finance_controls','finance_accounts',
    'finance_events','finance_movements','financial_audit','finance_goals','finance_budgets',
    'finance_reconciliations','finance_receipts','finance_export_jobs','finance_export_parts'
  ) loop
    execute format('create policy finance_mfa_required on public.%I as restrictive for all to authenticated using ((select public.finance_access_allowed())) with check ((select public.finance_access_allowed()))',f.tablename);
  end loop;
end $$;
commit;
