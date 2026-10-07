begin;
create table public.finance_controls (
  user_id uuid primary key references auth.users(id), enabled boolean not null default false,
  revision integer not null default 1, activated_at timestamptz
);
create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null check(length(btrim(name)) between 1 and 80),
  kind text not null check(kind in ('cash','bank','savings','investment')),
  default_key text, balance numeric(30,2) not null default 0, version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(), unique(id,user_id), unique(user_id,default_key)
);
create table public.finance_events (
  id uuid primary key default gen_random_uuid(), seq bigint generated always as identity unique,
  user_id uuid not null references auth.users(id), event_date date not null check(event_date between '1900-01-01' and '9999-12-31'),
  kind text not null, flow_type text not null check(flow_type in ('income','expense','transfer','opening','correction')),
  category text not null, description text not null check(length(description) between 1 and 500), amount numeric(30,2) not null,
  account_id uuid not null, destination_id uuid, source_kind text, source_id uuid, source_version integer,
  reverses_id uuid references public.finance_events(id), metadata jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(), unique(id,user_id),
  foreign key(account_id,user_id) references public.finance_accounts(id,user_id),
  foreign key(destination_id,user_id) references public.finance_accounts(id,user_id),
  check((flow_type='transfer')=(destination_id is not null)), check(account_id is distinct from destination_id)
);
create table public.finance_movements (
  event_id uuid not null, user_id uuid not null, account_id uuid not null, delta numeric(30,2) not null,
  primary key(event_id,account_id), foreign key(event_id,user_id) references public.finance_events(id,user_id),
  foreign key(account_id,user_id) references public.finance_accounts(id,user_id)
);
create table public.finance_source_heads (
  user_id uuid not null, source_kind text not null, source_id uuid not null,
  event_id uuid references public.finance_events(id), primary key(user_id,source_kind,source_id)
);
create table public.finance_commands (
  user_id uuid not null references auth.users(id), request_key uuid not null, payload jsonb not null,
  response jsonb, created_at timestamptz not null default clock_timestamp(), primary key(user_id,request_key)
);
create table public.financial_audit (
  seq bigint generated always as identity primary key, user_id uuid not null references auth.users(id),
  entity text not null, record_id uuid not null, action text not null, before_data jsonb, after_data jsonb,
  reason text, created_at timestamptz not null default clock_timestamp()
);
create table public.finance_goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  account_id uuid not null unique, name text not null check(length(btrim(name)) between 1 and 120),
  target numeric(16,2) not null check(target>0 and target<=1000000000000),
  due_date date not null check(due_date between '1900-01-01' and '9999-12-31'), version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(), foreign key(account_id,user_id) references public.finance_accounts(id,user_id)
);
create table public.finance_budgets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  month date not null check(extract(day from month)=1),
  category text not null check(category in ('harvest','garden','other','savings_expense','investment_expense')),
  amount numeric(16,2) not null check(amount>0 and amount<=1000000000000), version integer not null default 1,
  unique(user_id,month,category), created_at timestamptz not null default clock_timestamp()
);
create table public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), account_id uuid not null,
  as_of date not null, expected numeric(30,2) not null, actual numeric(30,2) not null,
  difference numeric(30,2) generated always as(actual-expected) stored, note text not null,
  created_at timestamptz not null default clock_timestamp(), foreign key(account_id,user_id) references public.finance_accounts(id,user_id)
);
create index finance_events_owner_cursor on public.finance_events(user_id,seq desc);
create index finance_events_owner_date on public.finance_events(user_id,event_date,seq);
create index finance_movements_owner_account on public.finance_movements(user_id,account_id,event_id);
create index financial_audit_owner_cursor on public.financial_audit(user_id,seq desc);
create index finance_reconciliations_owner_date on public.finance_reconciliations(user_id,created_at desc,id);

alter table public.spks add column account_id uuid;
alter table public.harvest_expenses add column account_id uuid;
alter table public.cash_expenses add column account_id uuid;
alter table public.cash_expenses add column destination_account_id uuid;
alter table public.spks add foreign key(account_id,user_id) references public.finance_accounts(id,user_id);
alter table public.harvest_expenses add foreign key(account_id,user_id) references public.finance_accounts(id,user_id);
alter table public.cash_expenses add foreign key(account_id,user_id) references public.finance_accounts(id,user_id);
alter table public.cash_expenses add foreign key(destination_account_id,user_id) references public.finance_accounts(id,user_id);

do $$ declare t text; begin
  foreach t in array array['finance_controls','finance_accounts','finance_events','finance_movements','finance_commands',
    'financial_audit','finance_goals','finance_budgets','finance_reconciliations','finance_source_heads'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    if t not in ('finance_commands','finance_source_heads') then execute format('grant select on public.%I to authenticated',t); end if;
  end loop;
end $$;

create function public.finance_lock_owner() returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sesi tidak valid.' using errcode='42501'; end if;
  insert into public.finance_controls(user_id) values(auth.uid()) on conflict do nothing;
  perform 1 from public.finance_controls where user_id=auth.uid() for update;
end $$;

create function public.capture_financial_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' then
    insert into public.financial_audit(user_id,entity,record_id,action,after_data)
      select n.user_id,TG_TABLE_NAME,n.id,TG_OP,to_jsonb(n) from new_records n;
  else
    insert into public.financial_audit(user_id,entity,record_id,action,before_data,after_data)
      select n.user_id,TG_TABLE_NAME,n.id,TG_OP,to_jsonb(o),to_jsonb(n) from new_records n join old_records o using(id);
  end if;
  -- One revision update per owner and SQL statement, including bulk imports.
  update public.finance_controls set revision=revision+1 where user_id in (select distinct user_id from new_records);
  return null;
end $$;
do $$ declare t text;begin
  foreach t in array array['harvests','spks','harvest_expenses','cash_expenses','finance_goals','finance_budgets','finance_reconciliations'] loop
    execute format('create trigger capture_insert_audit after insert on public.%I referencing new table as new_records for each statement execute function public.capture_financial_audit()',t);
    if t not in ('harvests','finance_reconciliations') then
      execute format('create trigger capture_update_audit after update on public.%I referencing old table as old_records new table as new_records for each statement execute function public.capture_financial_audit()',t);
    end if;
  end loop;
end $$;

create function public.finance_post_event(p_day date,p_kind text,p_flow text,p_category text,p_description text,
  p_amount numeric,p_account uuid,p_destination uuid default null,p_source_kind text default null,p_source_id uuid default null,
  p_source_version integer default null,p_reverses uuid default null,p_metadata jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; debit numeric;
begin
  insert into public.finance_events(user_id,event_date,kind,flow_type,category,description,amount,account_id,destination_id,
    source_kind,source_id,source_version,reverses_id,metadata)
  values(auth.uid(),p_day,p_kind,p_flow,p_category,p_description,p_amount,p_account,p_destination,p_source_kind,p_source_id,
    p_source_version,p_reverses,p_metadata) returning id into result;
  debit := case when p_flow in ('expense','transfer') then -p_amount else p_amount end;
  insert into public.finance_movements values(result,auth.uid(),p_account,debit);
  update public.finance_accounts set balance=balance+debit where id=p_account and user_id=auth.uid();
  if p_destination is not null then
    insert into public.finance_movements values(result,auth.uid(),p_destination,p_amount);
    update public.finance_accounts set balance=balance+p_amount where id=p_destination and user_id=auth.uid();
  end if;
  return result;
end $$;

create view public.finance_source_records with(security_invoker=true) as
  select s.user_id,'spk'::text as source_kind,s.id,s.version,s.delivery_date as day,'income'::text as category,
    s.company_name as description,s.total_income as amount,s.account_id,null::uuid as destination_id,to_jsonb(s) as data
    from public.spks s where s.published_at is not null
  union all select e.user_id,'harvest_expense',e.id,e.version,h.harvest_date,'harvest',h.name,e.total_expense,e.account_id,null::uuid,to_jsonb(e)
    from public.harvest_expenses e join public.harvests h on h.id=e.harvest_id where e.published_at is not null
  union all select c.user_id,'cash',c.id,c.version,c.expense_date,c.category,c.items->0->>'description',c.total_expense,
    c.account_id,c.destination_account_id,to_jsonb(c) from public.cash_expenses c where c.published_at is not null;
revoke all on public.finance_source_records from public,anon,authenticated;

create function public.journal_financial_source() returns trigger language plpgsql security definer set search_path='' as $$
declare old_event public.finance_events; source_row record; result uuid; account uuid; destination uuid; flow text; expected_kind text;
begin
  if not coalesce((select enabled from public.finance_controls where user_id=NEW.user_id),false) then return NEW; end if;
  select e.* into old_event from public.finance_source_heads h join public.finance_events e on e.id=h.event_id
    where h.user_id=NEW.user_id and h.source_id=NEW.id and h.source_kind=case TG_TABLE_NAME when 'spks' then 'spk' when 'harvest_expenses' then 'harvest_expense' else 'cash' end;
  if old_event.id is not null then
    perform public.finance_post_event(old_event.event_date,'reversal',old_event.flow_type,old_event.category,'Pembalikan karena edit',
      -old_event.amount,old_event.account_id,old_event.destination_id,old_event.source_kind,old_event.source_id,old_event.source_version,old_event.id);
  end if;
  if NEW.published_at is null then return NEW; end if;
  select * into source_row from public.finance_source_records where user_id=NEW.user_id and id=NEW.id
    and source_kind=case TG_TABLE_NAME when 'spks' then 'spk' when 'harvest_expenses' then 'harvest_expense' else 'cash' end;
  if source_row.day > (clock_timestamp() at time zone 'Asia/Makassar')::date then
    raise exception 'Tanggal publikasi tidak boleh di masa depan. Simpan sebagai draft dahulu.' using errcode='22023';
  end if;
  expected_kind := case source_row.category when 'savings_expense' then 'savings' when 'investment_expense' then 'investment' else 'cash' end;
  account := coalesce(source_row.account_id,(select id from public.finance_accounts where user_id=NEW.user_id and default_key=expected_kind));
  if not exists(select 1 from public.finance_accounts where id=account and user_id=NEW.user_id and
    (kind=expected_kind or (expected_kind='cash' and kind='bank'))) then raise exception 'Rekening transaksi tidak sesuai.' using errcode='22023'; end if;
  if source_row.category in ('savings','investment') then
    flow := 'transfer';
    destination := coalesce(source_row.destination_id,(select id from public.finance_accounts where user_id=NEW.user_id and default_key=source_row.category));
    if not exists(select 1 from public.finance_accounts where id=destination and user_id=NEW.user_id and kind=source_row.category) then
      raise exception 'Rekening tujuan alokasi tidak sesuai.' using errcode='22023'; end if;
  else flow := case when source_row.category in ('income','other_income') then 'income' else 'expense' end; end if;
  if flow='transfer' and (select balance from public.finance_accounts where id=account)<source_row.amount then
    raise exception 'Saldo rekening asal belum mencukupi untuk alokasi.' using errcode='P0001';
  end if;
  if expected_kind in ('savings','investment') and (select balance from public.finance_accounts where id=account)<source_row.amount then
    raise exception 'Saldo rekening dana belum mencukupi.' using errcode='P0001';
  end if;
  result := public.finance_post_event(source_row.day,'source',flow,source_row.category,source_row.description,source_row.amount,
    account,destination,source_row.source_kind,source_row.id,source_row.version,null,jsonb_build_object('record',source_row.data));
  if exists(select 1 from public.finance_accounts where user_id=NEW.user_id and kind in ('savings','investment') and balance<0) then
    raise exception 'Alokasi telah digunakan. Koreksi ini akan membuat saldo dana negatif.' using errcode='P0001';
  end if;
  insert into public.finance_source_heads values(NEW.user_id,source_row.source_kind,NEW.id,result)
    on conflict(user_id,source_kind,source_id) do update set event_id=excluded.event_id;
  return NEW;
end $$;
create trigger journal_spk after insert or update on public.spks for each row execute function public.journal_financial_source();
create trigger journal_expense after insert or update on public.harvest_expenses for each row execute function public.journal_financial_source();
create trigger journal_cash after insert or update on public.cash_expenses for each row execute function public.journal_financial_source();

create function public.finance_activate(p_fields jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid; k text; opening numeric; day date; result jsonb;
begin
  if (select enabled from public.finance_controls where user_id=auth.uid()) then raise exception 'Rekening sudah aktif.' using errcode='40001'; end if;
  if (p_fields->>'expected_revision')::integer is distinct from (select revision from public.finance_controls where user_id=auth.uid()) then
    raise exception 'Data berubah. Muat ulang pratinjau aktivasi.' using errcode='40001'; end if;
  day := (p_fields->>'opening_date')::date;
  if day>(clock_timestamp() at time zone 'Asia/Makassar')::date or day>(select min(s.day) from public.finance_source_records s where s.user_id=auth.uid()) then
    raise exception 'Tanggal saldo awal harus sebelum atau sama dengan transaksi pertama.' using errcode='22023'; end if;
  foreach k in array array['cash','bank','savings','investment'] loop
    opening := (p_fields->'openings'->>k)::numeric;
    if opening is null or opening<0 or opening>1000000000000 or opening<>round(opening,2) then raise exception 'Saldo awal tidak valid.' using errcode='22023'; end if;
    insert into public.finance_accounts(user_id,name,kind,default_key) values(auth.uid(),case k when 'cash' then 'Cash utama' when 'bank' then 'Bank' when 'savings' then 'Tabungan' else 'Target Investasi' end,k,k) returning id into a;
    if opening<>0 then perform public.finance_post_event(day,'opening','opening','opening','Saldo awal',opening,a); end if;
  end loop;
  -- Set-based historical import; no mutation of the original publications.
  with imported as (
    insert into public.finance_events(user_id,event_date,kind,flow_type,category,description,amount,account_id,destination_id,source_kind,source_id,source_version,metadata)
    select s.user_id,s.day,'source',case when s.category in ('income','other_income') then 'income' when s.category in ('savings','investment') then 'transfer' else 'expense' end,
      s.category,s.description,s.amount,coalesce(s.account_id,a.id),case when s.category in ('savings','investment') then coalesce(s.destination_id,d.id) end,
      s.source_kind,s.id,s.version,jsonb_build_object('record',s.data,'imported',true)
    from public.finance_source_records s join public.finance_accounts a on a.user_id=s.user_id and a.default_key=case s.category when 'savings_expense' then 'savings' when 'investment_expense' then 'investment' else 'cash' end
    left join public.finance_accounts d on d.user_id=s.user_id and d.default_key=s.category
    where s.user_id=auth.uid() returning *
  ), heads as (
    insert into public.finance_source_heads select user_id,source_kind,source_id,id from imported returning event_id
  )
  insert into public.finance_movements
    select id,user_id,account_id,case when flow_type in ('expense','transfer') then -amount else amount end from imported
    union all select id,user_id,destination_id,amount from imported where destination_id is not null;
  update public.finance_accounts a set balance=coalesce((select sum(delta) from public.finance_movements where account_id=a.id),0) where user_id=auth.uid();
  if exists(select 1 from public.finance_accounts where user_id=auth.uid() and kind in ('savings','investment') and balance<0) then
    raise exception 'Saldo dana setelah impor negatif. Periksa transaksi dan saldo awal sebelum aktivasi.' using errcode='P0001'; end if;
  update public.finance_controls set enabled=true,activated_at=clock_timestamp(),revision=revision+1 where user_id=auth.uid();
  result := jsonb_build_object('enabled',true);
  insert into public.financial_audit(user_id,entity,record_id,action,after_data,reason) values(auth.uid(),'accounts',auth.uid(),'ACTIVATE',p_fields,'Aktivasi model rekening dan impor publikasi lama');
  return result;
end $$;

create function public.finance_command(p_kind text,p_fields jsonb,p_request_key uuid,p_id uuid default null,p_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb; prior public.finance_commands; inserted integer; result jsonb; account public.finance_accounts; destination public.finance_accounts;
  command_amount numeric; command_day date; command_id uuid; row_goal public.finance_goals; row_budget public.finance_budgets; source_row record;
begin
  perform public.finance_lock_owner();
  if p_request_key is null then raise exception 'Kunci permintaan wajib.' using errcode='22023'; end if;
  payload:=jsonb_build_object('kind',p_kind,'fields',p_fields,'id',p_id,'version',p_version);
  insert into public.finance_commands values(auth.uid(),p_request_key,payload,null,clock_timestamp()) on conflict do nothing;
  get diagnostics inserted=ROW_COUNT;
  if inserted=0 then
    select * into prior from public.finance_commands where user_id=auth.uid() and request_key=p_request_key for update;
    if prior.payload is distinct from payload then raise exception 'Kunci permintaan sudah digunakan untuk data berbeda.' using errcode='40001'; end if;
    return prior.response;
  end if;
  if p_kind='activate' then result:=public.finance_activate(p_fields);
  else
    if not (select enabled from public.finance_controls where user_id=auth.uid()) then raise exception 'Aktifkan rekening dahulu.' using errcode='P0001'; end if;
    if p_kind in ('account','transfer','correction','reconcile') then
      command_amount:=(p_fields->>'amount')::numeric; command_day:=(p_fields->>'date')::date;
      if command_day not between '1900-01-01' and (clock_timestamp() at time zone 'Asia/Makassar')::date then raise exception 'Tanggal tidak valid.' using errcode='22023'; end if;
      if command_amount is null or abs(command_amount)>1000000000000 or command_amount<>round(command_amount,2) then raise exception 'Nominal tidak valid.' using errcode='22023'; end if;
    end if;
    if p_kind='account' then
      if (select count(*) from public.finance_accounts where user_id=auth.uid())>=25 or command_amount<0 then raise exception 'Rekening maksimal 25; saldo awal tidak boleh negatif.' using errcode='22023'; end if;
      insert into public.finance_accounts(user_id,name,kind) values(auth.uid(),p_fields->>'name',p_fields->>'kind') returning * into account;
      if command_amount<>0 then perform public.finance_post_event(command_day,'opening','opening','opening','Saldo awal',command_amount,account.id); end if;
      result:=to_jsonb(account)-'balance'||jsonb_build_object('balance',command_amount::text);
    elsif p_kind in ('transfer','correction','reconcile') then
      select * into account from public.finance_accounts where user_id=auth.uid() and id=(p_fields->>'account_id')::uuid;
      if account.id is null then raise exception 'Rekening tidak ditemukan.' using errcode='42501'; end if;
      if p_kind='transfer' then
        select * into destination from public.finance_accounts where user_id=auth.uid() and id=(p_fields->>'destination_id')::uuid;
        if destination.id is null or destination.id=account.id or command_amount<=0 then raise exception 'Tujuan transfer tidak valid.' using errcode='22023'; end if;
        if account.balance<command_amount then raise exception 'Saldo rekening asal belum mencukupi.' using errcode='P0001'; end if;
        command_id:=public.finance_post_event(command_day,'transfer','transfer','transfer',p_fields->>'description',command_amount,account.id,destination.id);
        result:=jsonb_build_object('id',command_id);
      elsif p_kind='correction' then
        if account.kind in ('savings','investment') and account.balance+command_amount<0 then raise exception 'Dana rekening belum mencukupi untuk koreksi.' using errcode='P0001'; end if;
        if length(btrim(p_fields->>'reason')) not between 10 and 500 or command_amount=0 then raise exception 'Alasan koreksi minimal 10 karakter dan nominal tidak boleh nol.' using errcode='22023'; end if;
        if p_fields->>'source_id' is not null then
          select * into source_row from public.finance_source_records where user_id=auth.uid() and id=(p_fields->>'source_id')::uuid and source_kind=p_fields->>'source_kind';
          if source_row.id is null then raise exception 'Catatan asal tidak ditemukan.' using errcode='42501'; end if;
        end if;
        command_id:=public.finance_post_event(command_day,'correction','correction','correction',p_fields->>'reason',command_amount,account.id,null,
          p_fields->>'source_kind',(p_fields->>'source_id')::uuid,null,null,jsonb_build_object('reason',p_fields->>'reason'));
        result:=jsonb_build_object('id',command_id);
      else
        insert into public.finance_reconciliations as r(user_id,account_id,as_of,expected,actual,note)
        select auth.uid(),account.id,command_day,coalesce(sum(m.delta),0),command_amount,coalesce(p_fields->>'note','') from public.finance_movements m
          join public.finance_events e on e.id=m.event_id where m.account_id=account.id and e.event_date<=command_day returning r.id into command_id;
        result:=(select to_jsonb(r)-'expected'-'actual'-'difference'||jsonb_build_object('expected',r.expected::text,'actual',r.actual::text,'difference',r.difference::text) from public.finance_reconciliations r where r.id=command_id);
      end if;
    elsif p_kind='goal' then
      select * into account from public.finance_accounts where id=(p_fields->>'account_id')::uuid and user_id=auth.uid() and kind in ('savings','investment');
      if account.id is null then raise exception 'Target memerlukan rekening Tabungan atau Investasi.' using errcode='42501'; end if;
      if (p_fields->>'target')::numeric is null or (p_fields->>'target')::numeric<>round((p_fields->>'target')::numeric,2) then raise exception 'Target tidak valid.' using errcode='22023'; end if;
      if p_id is null then
        insert into public.finance_goals(user_id,account_id,name,target,due_date) values(auth.uid(),account.id,p_fields->>'name',(p_fields->>'target')::numeric,(p_fields->>'due_date')::date) returning * into row_goal;
      else
        update public.finance_goals set name=p_fields->>'name',target=(p_fields->>'target')::numeric,due_date=(p_fields->>'due_date')::date,version=version+1
        where id=p_id and user_id=auth.uid() and account_id=account.id and version=p_version returning * into row_goal;
        if row_goal.id is null then raise exception 'Target sudah berubah. Muat ulang.' using errcode='40001'; end if;
      end if;
      result:=to_jsonb(row_goal);
    elsif p_kind='budget' then
      if p_fields->>'month' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or p_fields->>'month'<'1900-01' or (p_fields->>'amount')::numeric is null or (p_fields->>'amount')::numeric<>round((p_fields->>'amount')::numeric,2) then raise exception 'Anggaran tidak valid.' using errcode='22023'; end if;
      if p_id is null then
        insert into public.finance_budgets(user_id,month,category,amount) values(auth.uid(),(p_fields->>'month'||'-01')::date,p_fields->>'category',(p_fields->>'amount')::numeric) returning * into row_budget;
      else
        update public.finance_budgets set amount=(p_fields->>'amount')::numeric,version=version+1 where id=p_id and user_id=auth.uid() and version=p_version
          and month=(p_fields->>'month'||'-01')::date and category=p_fields->>'category' returning * into row_budget;
        if row_budget.id is null then raise exception 'Anggaran sudah berubah. Muat ulang.' using errcode='40001'; end if;
      end if;
      result:=to_jsonb(row_budget);
    else raise exception 'Perintah tidak valid.' using errcode='22023'; end if;
    insert into public.financial_audit(user_id,entity,record_id,action,after_data,reason)
      values(auth.uid(),'finance_command',coalesce((result->>'id')::uuid,auth.uid()),upper(p_kind),payload,p_fields->>'reason');
    update public.finance_controls set revision=revision+1 where user_id=auth.uid();
  end if;
  update public.finance_commands set response=result where user_id=auth.uid() and request_key=p_request_key;
  return result;
end $$;
revoke all on function public.finance_lock_owner(),public.capture_financial_audit(),public.finance_post_event(date,text,text,text,text,numeric,uuid,uuid,text,uuid,integer,uuid,jsonb),
  public.journal_financial_source(),public.finance_activate(jsonb),public.finance_command(text,jsonb,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.finance_command(text,jsonb,uuid,uuid,integer) to authenticated;
commit;
