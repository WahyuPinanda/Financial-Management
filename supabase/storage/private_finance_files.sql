-- Apply to Supabase after the application migrations. These buckets are private.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cash-flow-receipts','cash-flow-receipts',false,5242880,array['image/jpeg','image/png','application/pdf']),
  ('cash-flow-exports','cash-flow-exports',false,2097152,array['text/csv'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy finance_receipt_upload on storage.objects for insert to authenticated with check(
  bucket_id='cash-flow-receipts' and split_part(name,'/',1)=(select auth.uid())::text and exists(
    select 1 from public.finance_receipts r where r.user_id=(select auth.uid()) and r.object_path=name and r.uploaded_at is null));
create policy finance_receipt_download on storage.objects for select to authenticated using(
  bucket_id='cash-flow-receipts' and split_part(name,'/',1)=(select auth.uid())::text);
create policy finance_export_upload on storage.objects for insert to authenticated with check(
  bucket_id='cash-flow-exports' and split_part(name,'/',1)=(select auth.uid())::text and exists(
    select 1 from public.finance_export_jobs j where j.user_id=(select auth.uid()) and j.id::text=split_part(name,'/',2)
      and j.status='processing' and j.lease_until>now()));
create policy finance_export_download on storage.objects for select to authenticated using(
  bucket_id='cash-flow-exports' and split_part(name,'/',1)=(select auth.uid())::text and exists(
    select 1 from public.finance_export_jobs j where j.user_id=(select auth.uid()) and j.id::text=split_part(name,'/',2) and j.expires_at>now()));
-- No overwrite/delete policy: receipt bytes and export parts cannot be replaced by the app.
commit;
