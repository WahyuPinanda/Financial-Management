-- Apply after private_finance_files.sql and the MFA application migration.
-- Protect direct access as well as requests passing through the API.
begin;
create policy cash_flow_storage_mfa on storage.objects as restrictive for all to authenticated
using (bucket_id not in ('cash-flow-receipts','cash-flow-exports') or (select public.finance_access_allowed()))
with check (bucket_id not in ('cash-flow-receipts','cash-flow-exports') or (select public.finance_access_allowed()));
commit;
