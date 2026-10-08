begin;

-- SQLSTATE 40001 is reserved for engine serialization failures. PostgREST can
-- retry it indefinitely; stale versions and reused keys cannot succeed on retry.
-- P0001 is already mapped to HTTP 409 by the deployed Node API.
-- Update installed bodies instead of rewriting historical migrations. Retain
-- function identities, ownership, security settings and existing EXECUTE grants.
do $migration$
declare
  routine record;
  definition text;
begin
  for routine in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in (
        'finance_activate',
        'finance_command_without_mfa',
        'save_financial_record_without_mfa',
        'productivity_command',
        'guard_allocated_cost',
        'finance_prepare_receipt_without_mfa',
        'finance_create_export_without_mfa',
        'finance_advance_export_without_mfa',
        'finance_finish_export_without_mfa'
      )
      and p.prosrc ~* 'errcode\s*=\s*''40001'''
  loop
    definition := pg_get_functiondef(routine.oid);
    definition := regexp_replace(
      definition,
      '(errcode\s*=\s*)''40001''',
      '\1''P0001''',
      'gi'
    );
    execute definition;
  end loop;
end;
$migration$;

commit;
