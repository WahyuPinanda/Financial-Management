begin;
create table public.finance_receipts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  source_kind text not null check(source_kind in ('spk','harvest_expense','cash','event')), source_id uuid not null,
  source_version integer, request_key uuid not null, filename text not null check(length(filename) between 1 and 120),
  mime text not null check(mime in ('image/jpeg','image/png','application/pdf')),
  bytes integer not null check(bytes>0 and bytes<=5242880), sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
  object_path text not null unique, uploaded_at timestamptz, created_at timestamptz not null default clock_timestamp(),unique(user_id,request_key)
);
create table public.finance_export_jobs (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  request_key uuid not null,from_date date not null,to_date date not null,
  cutoff_seq bigint not null,snapshot_time timestamptz not null default clock_timestamp(),
  status text not null default 'queued' check(status in ('queued','processing','completed','paused','failed')),
  cursor_seq bigint not null default 0,part_count integer not null default 0,row_count bigint not null default 0,
  bytes bigint not null default 0,lease_token uuid,lease_until timestamptz,last_error text,
  manifest jsonb not null,expires_at timestamptz not null default clock_timestamp()+interval '7 days',
  unique(user_id,request_key),check(from_date<=to_date),check(from_date>='1900-01-01' and to_date<='9999-12-31')
);
create table public.finance_export_parts (
  job_id uuid not null references public.finance_export_jobs(id),part integer not null,user_id uuid not null,
  path text not null,bytes integer not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
  start_seq bigint not null,end_seq bigint not null,rows integer not null,primary key(job_id,part)
);
create index receipts_source_owner on public.finance_receipts(user_id,source_kind,source_id,created_at);
create index exports_owner_date on public.finance_export_jobs(user_id,snapshot_time desc,id);
create index export_parts_owner on public.finance_export_parts(user_id,job_id,part);
do $$ declare t text;begin
  foreach t in array array['finance_receipts','finance_export_jobs','finance_export_parts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_read on public.%I for select to authenticated using((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
create function public.finance_guard_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Jurnal dan riwayat bersifat permanen.' using errcode='P0001'; end $$;
create trigger immutable_finance_events before update or delete on public.finance_events for each row execute function public.finance_guard_append_only();
create trigger immutable_finance_movements before update or delete on public.finance_movements for each row execute function public.finance_guard_append_only();
create trigger immutable_financial_audit before update or delete on public.financial_audit for each row execute function public.finance_guard_append_only();
create trigger immutable_reconciliations before update or delete on public.finance_reconciliations for each row execute function public.finance_guard_append_only();
create trigger immutable_export_parts before update or delete on public.finance_export_parts for each row execute function public.finance_guard_append_only();

create function public.finance_prepare_receipt(p_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.finance_receipts; source record; owned boolean; revision integer; record_id uuid; source_kind text;
begin
  perform public.finance_lock_owner();
  select * into r from public.finance_receipts where user_id=auth.uid() and request_key=(p_fields->>'request_key')::uuid;
  if r.id is not null then
    if r.source_kind<>p_fields->>'source_kind' or r.source_id<>(p_fields->>'source_id')::uuid or r.sha256<>p_fields->>'sha256' or r.bytes<>(p_fields->>'bytes')::int or r.mime<>p_fields->>'mime' or r.filename<>p_fields->>'filename' then raise exception 'Kunci unggahan telah dipakai.' using errcode='40001'; end if;
    return to_jsonb(r);
  end if;
  record_id:=(p_fields->>'source_id')::uuid;source_kind:=p_fields->>'source_kind';
  if source_kind='event' then owned:=exists(select 1 from public.finance_events where id=record_id and user_id=auth.uid());
  elsif source_kind='spk' then select version into revision from public.spks where id=record_id and user_id=auth.uid();owned:=found;
  elsif source_kind='harvest_expense' then select version into revision from public.harvest_expenses where id=record_id and user_id=auth.uid();owned:=found;
  elsif source_kind='cash' then select version into revision from public.cash_expenses where id=record_id and user_id=auth.uid();owned:=found;
  end if;
  if owned is distinct from true then raise exception 'Catatan tidak ditemukan.' using errcode='42501'; end if;
  if (select count(*) from public.finance_receipts r0 where r0.user_id=auth.uid() and r0.source_id=record_id and r0.source_kind=p_fields->>'source_kind'
    and (r0.uploaded_at is not null or r0.created_at>clock_timestamp()-interval '2 hours'))>=20 then raise exception 'Maksimal 20 bukti aktif per catatan.' using errcode='22023'; end if;
  r.id:=gen_random_uuid();
  insert into public.finance_receipts(id,user_id,source_kind,source_id,source_version,request_key,filename,mime,bytes,sha256,object_path)
  values(r.id,auth.uid(),source_kind,record_id,revision,(p_fields->>'request_key')::uuid,p_fields->>'filename',p_fields->>'mime',(p_fields->>'bytes')::int,p_fields->>'sha256',
    auth.uid()::text||'/'||r.id::text||case p_fields->>'mime' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end) returning * into r;
  return to_jsonb(r);
end $$;
create function public.finance_confirm_receipt(p_id uuid,p_sha256 text,p_bytes integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.finance_receipts;
begin
  perform public.finance_lock_owner();
  select * into r from public.finance_receipts where id=p_id and user_id=auth.uid() for update;
  if r.id is null or r.sha256<>p_sha256 or r.bytes<>p_bytes then raise exception 'Bukti tidak sesuai.' using errcode='22023'; end if;
  if r.uploaded_at is null then
    if (select count(*) from public.finance_receipts other where other.user_id=auth.uid() and other.source_kind=r.source_kind and other.source_id=r.source_id and other.uploaded_at is not null)>=20 then raise exception 'Maksimal 20 bukti per catatan.' using errcode='22023'; end if;
    update public.finance_receipts set uploaded_at=clock_timestamp() where id=p_id returning * into r;
    insert into public.financial_audit(user_id,entity,record_id,action,after_data) values(auth.uid(),'receipt',r.id,'ATTACH',to_jsonb(r));
  end if;
  return to_jsonb(r);
end $$;

create function public.finance_create_export(p_from date,p_to date,p_request_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_export_jobs; maximum_seq bigint; report jsonb;
begin
  perform public.finance_lock_owner();
  if not (select enabled from public.finance_controls where user_id=auth.uid()) then raise exception 'Aktifkan rekening dahulu.' using errcode='P0001'; end if;
  select * into j from public.finance_export_jobs where user_id=auth.uid() and request_key=p_request_key;
  if j.id is not null then
    if j.from_date<>p_from or j.to_date<>p_to then raise exception 'Kunci ekspor telah dipakai.' using errcode='40001'; end if;return to_jsonb(j)||jsonb_build_object('cutoff_seq',j.cutoff_seq::text,'cursor_seq',j.cursor_seq::text,'row_count',j.row_count::text,'bytes',j.bytes::text);
  end if;
  if (select count(*) from public.finance_export_jobs where user_id=auth.uid() and status in ('queued','processing','paused') and expires_at>clock_timestamp())>=3 then
    raise exception 'Maksimal tiga ekspor aktif. Tunggu hingga selesai.' using errcode='P0001'; end if;
  select coalesce(max(seq),0) into maximum_seq from public.finance_events where user_id=auth.uid();
  if (select count(*) from public.finance_events where user_id=auth.uid() and seq<=maximum_seq and event_date between p_from and p_to)>500000 then
    raise exception 'Maksimal 500.000 entri per ekspor. Gunakan rentang tanggal lebih pendek.' using errcode='22023'; end if;
  select jsonb_build_object('openingCash',coalesce(sum(m.delta) filter(where e.event_date<p_from),0)::text,
    'closingCash',coalesce(sum(m.delta) filter(where e.event_date<=p_to),0)::text,'currency','IDR','cutoff',maximum_seq::text) into report
    from public.finance_movements m join public.finance_events e on e.id=m.event_id join public.finance_accounts a on a.id=m.account_id
    where e.user_id=auth.uid() and e.seq<=maximum_seq and a.kind in ('cash','bank');
  insert into public.finance_export_jobs(user_id,request_key,from_date,to_date,cutoff_seq,manifest) values(auth.uid(),p_request_key,p_from,p_to,maximum_seq,report) returning * into j;
  return to_jsonb(j)||jsonb_build_object('cutoff_seq',j.cutoff_seq::text,'cursor_seq',j.cursor_seq::text,'row_count',j.row_count::text,'bytes',j.bytes::text);
end $$;
create function public.finance_claim_export(p_id uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_export_jobs;
begin
  update public.finance_export_jobs set status='processing',lease_token=p_lease,lease_until=clock_timestamp()+interval '60 seconds',last_error=null
  where id=p_id and user_id=auth.uid() and expires_at>clock_timestamp() and status in ('queued','paused','processing')
    and (lease_until is null or lease_until<clock_timestamp()) returning * into j;
  if j.id is null then return null; end if;
  return to_jsonb(j)||jsonb_build_object('cutoff_seq',j.cutoff_seq::text,'cursor_seq',j.cursor_seq::text,'row_count',j.row_count::text,'bytes',j.bytes::text);
end $$;
create function public.finance_export_batch(p_id uuid,p_lease uuid) returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(e)-'amount'-'seq'-'metadata'||jsonb_build_object('seq',e.seq::text,'amount',e.amount::text,
  'cashDelta',coalesce((select sum(m.delta) from public.finance_movements m join public.finance_accounts a on a.id=m.account_id where m.event_id=e.id and a.kind in ('cash','bank')),0)::text,
  'accountName',(select name from public.finance_accounts where id=e.account_id),
  'destinationName',(select name from public.finance_accounts where id=e.destination_id),
  'receiptIds',(select coalesce(string_agg(r.id::text,', '),'') from public.finance_receipts r where r.user_id=auth.uid() and r.source_id=case when e.kind in ('source','reversal') then e.source_id else e.id end
    and r.source_kind=case when e.kind in ('source','reversal') then e.source_kind else 'event' end
    and (r.source_kind='event' or r.source_version=e.source_version) and r.uploaded_at<=j.snapshot_time)) order by e.seq),'[]')
from public.finance_export_jobs j left join lateral(select * from public.finance_events where user_id=auth.uid() and seq>j.cursor_seq and seq<=j.cutoff_seq
  and event_date between j.from_date and j.to_date order by seq limit 200) e on true
where j.id=p_id and j.user_id=auth.uid() and j.lease_token=p_lease and j.lease_until>clock_timestamp() and e.id is not null;
$$;
create function public.finance_advance_export(p_id uuid,p_lease uuid,p_after bigint,p_end bigint,p_rows integer,p_bytes integer,p_hash text,p_path text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.finance_export_jobs; expected_rows integer; expected_end bigint;
begin
  select * into j from public.finance_export_jobs where id=p_id and user_id=auth.uid() and lease_token=p_lease and lease_until>clock_timestamp() for update;
  if j.id is null then raise exception 'Lease ekspor telah berakhir.' using errcode='40001'; end if;
  if j.cursor_seq<>p_after or p_end<=p_after or p_end>j.cutoff_seq or p_rows not between 1 and 200 or p_bytes<=0 or p_bytes>2097152
    or p_hash!~'^[a-f0-9]{64}$' or p_path<>auth.uid()::text||'/'||p_id::text||'/'||p_after::text||'.csv' then
    raise exception 'Bagian ekspor tidak valid.' using errcode='22023'; end if;
  select count(*),max(seq) into expected_rows,expected_end from (select seq from public.finance_events where user_id=auth.uid() and seq>j.cursor_seq and seq<=j.cutoff_seq and event_date between j.from_date and j.to_date order by seq limit 200) batch;
  if p_rows<>expected_rows or p_end is distinct from expected_end then raise exception 'Bagian ekspor melewatkan catatan.' using errcode='22023'; end if;
  if j.bytes+p_bytes>104857600 then raise exception 'Ekspor melebihi 100 MB. Pilih rentang lebih pendek.' using errcode='22023'; end if;
  insert into public.finance_export_parts values(j.id,j.part_count,auth.uid(),p_path,p_bytes,p_hash,p_after,p_end,p_rows);
  update public.finance_export_jobs set cursor_seq=p_end,part_count=part_count+1,row_count=row_count+p_rows,bytes=bytes+p_bytes,lease_until=clock_timestamp()+interval '60 seconds' where id=j.id returning * into j;
  return to_jsonb(j)||jsonb_build_object('cutoff_seq',j.cutoff_seq::text,'cursor_seq',j.cursor_seq::text,'row_count',j.row_count::text,'bytes',j.bytes::text);
end $$;
create function public.finance_finish_export(p_id uuid,p_lease uuid,p_complete boolean,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_complete and exists(select 1 from public.finance_export_jobs j join public.finance_events e on e.user_id=j.user_id
    and e.seq>j.cursor_seq and e.seq<=j.cutoff_seq and e.event_date between j.from_date and j.to_date
    where j.id=p_id and j.user_id=auth.uid()) then raise exception 'Ekspor belum lengkap.' using errcode='40001'; end if;
  update public.finance_export_jobs set status=case when p_complete then 'completed' when p_error is not null then 'paused' else 'queued' end,
    lease_token=null,lease_until=null,last_error=left(p_error,160)
    where id=p_id and user_id=auth.uid() and lease_token=p_lease and lease_until>clock_timestamp();
end $$;
create function public.finance_integrity() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('ok',not exists(select 1 from public.finance_accounts a where user_id=auth.uid() and balance<>coalesce((select sum(delta) from public.finance_movements where account_id=a.id),0)))
$$;
revoke all on function public.finance_guard_append_only(),public.finance_prepare_receipt(jsonb),public.finance_confirm_receipt(uuid,text,integer),
  public.finance_create_export(date,date,uuid),public.finance_claim_export(uuid,uuid),public.finance_export_batch(uuid,uuid),
  public.finance_advance_export(uuid,uuid,bigint,bigint,integer,integer,text,text),public.finance_finish_export(uuid,uuid,boolean,text),public.finance_integrity() from public,anon,authenticated;
grant execute on function public.finance_prepare_receipt(jsonb),public.finance_confirm_receipt(uuid,text,integer),public.finance_create_export(date,date,uuid),
  public.finance_claim_export(uuid,uuid),public.finance_export_batch(uuid,uuid),public.finance_advance_export(uuid,uuid,bigint,bigint,integer,integer,text,text),
  public.finance_finish_export(uuid,uuid,boolean,text),public.finance_integrity() to authenticated;
commit;
