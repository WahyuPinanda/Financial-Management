begin;
alter table public.cash_expenses add constraint cash_expenses_id_owner_unique unique(id,user_id);
create table public.transaction_templates (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  name text not null check(length(btrim(name)) between 1 and 120),
  category text not null check(category in ('garden','other','other_income','savings','investment','savings_expense','investment_expense')),
  items jsonb not null check(public.cash_items_valid(items) and public.cash_items_total(items)>0 and public.cash_items_total(items)<=1000000000000),
  account_id uuid,destination_account_id uuid,
  frequency text not null check(frequency in ('weekly','monthly')),
  next_date date not null check(next_date between '1900-01-01' and '9999-11-30'),
  anchor_day integer not null check(anchor_day between 1 and 31),active boolean not null default true,
  version integer not null default 1,created_at timestamptz not null default clock_timestamp(),
  foreign key(account_id,user_id) references public.finance_accounts(id,user_id),
  foreign key(destination_account_id,user_id) references public.finance_accounts(id,user_id),unique(id,user_id)
);
create table public.template_occurrences (
  template_id uuid not null,user_id uuid not null,scheduled_date date not null,record_id uuid not null,
  primary key(template_id,scheduled_date),
  foreign key(template_id,user_id) references public.transaction_templates(id,user_id),
  foreign key(record_id,user_id) references public.cash_expenses(id,user_id)
);
create table public.harvest_cost_allocations (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  harvest_id uuid not null,cash_expense_id uuid not null,amount numeric(16,2) not null check(amount>=0 and amount<=1000000000000),
  version integer not null default 1,created_at timestamptz not null default clock_timestamp(),
  unique(harvest_id,cash_expense_id),
  foreign key(harvest_id,user_id) references public.harvests(id,user_id),
  foreign key(cash_expense_id,user_id) references public.cash_expenses(id,user_id)
);
create index templates_owner_due on public.transaction_templates(user_id,active,next_date,id);
create index allocations_cost on public.harvest_cost_allocations(user_id,cash_expense_id);
create index allocations_harvest on public.harvest_cost_allocations(user_id,harvest_id);
do $$ declare t text; begin
  foreach t in array array['transaction_templates','template_occurrences','harvest_cost_allocations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy select_owner on public.%I for select to authenticated using ((select auth.uid())=user_id and (select public.finance_access_allowed()))',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
create trigger audit_templates after insert on public.transaction_templates referencing new table as new_records for each statement execute function public.capture_financial_audit();
create trigger audit_templates_update after update on public.transaction_templates referencing old table as old_records new table as new_records for each statement execute function public.capture_financial_audit();
create trigger audit_allocations after insert on public.harvest_cost_allocations referencing new table as new_records for each statement execute function public.capture_financial_audit();
create trigger audit_allocations_update after update on public.harvest_cost_allocations referencing old table as old_records new table as new_records for each statement execute function public.capture_financial_audit();

create function public.guard_allocated_cost() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.cash_items_total(new.items) < coalesce((select sum(amount) from public.harvest_cost_allocations where cash_expense_id=old.id and user_id=old.user_id),0) then
    raise exception 'Kurangi alokasi biaya panen sebelum menurunkan nominal biaya kebun.' using errcode='40001';
  end if;
  return new;
end $$;
create trigger guard_allocated_cost before update on public.cash_expenses for each row execute function public.guard_allocated_cost();
revoke all on function public.guard_allocated_cost() from public,anon,authenticated;

create function public.productivity_command(p_kind text,p_fields jsonb,p_request_key uuid,p_id uuid default null,p_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; previous public.finance_commands; inserted integer; result jsonb;
  t public.transaction_templates; c public.cash_expenses; a public.harvest_cost_allocations; new_date date; day_limit integer;
begin
  perform public.finance_require_mfa(); perform public.finance_lock_owner();
  if p_request_key is null then raise exception 'Kunci permintaan wajib diisi.' using errcode='22023'; end if;
  payload:=jsonb_build_object('kind','productivity:'||p_kind,'fields',p_fields,'id',p_id,'version',p_version);
  insert into public.finance_commands(user_id,request_key,payload) values(auth.uid(),p_request_key,payload) on conflict do nothing;
  get diagnostics inserted=ROW_COUNT;
  if inserted=0 then
    select * into previous from public.finance_commands where user_id=auth.uid() and request_key=p_request_key;
    if previous.payload is distinct from payload then raise exception 'Kunci permintaan telah dipakai.' using errcode='40001'; end if;
    return previous.response;
  end if;
  if p_kind='template' then
    if p_id is null then
      if (select count(*) from public.transaction_templates where user_id=auth.uid())>=100 then raise exception 'Maksimal 100 template. Ubah template yang sudah ada.' using errcode='22023'; end if;
      insert into public.transaction_templates(user_id,name,category,items,account_id,destination_account_id,frequency,next_date,anchor_day,active)
      values(auth.uid(),p_fields->>'name',p_fields->>'category',p_fields->'items',(p_fields->>'account_id')::uuid,(p_fields->>'destination_account_id')::uuid,p_fields->>'frequency',(p_fields->>'next_date')::date,extract(day from (p_fields->>'next_date')::date),coalesce((p_fields->>'active')::boolean,true)) returning * into t;
    else
      update public.transaction_templates set name=p_fields->>'name',category=p_fields->>'category',items=p_fields->'items',account_id=(p_fields->>'account_id')::uuid,destination_account_id=(p_fields->>'destination_account_id')::uuid,
        frequency=p_fields->>'frequency',next_date=(p_fields->>'next_date')::date,
        anchor_day=case when next_date=(p_fields->>'next_date')::date then anchor_day else extract(day from (p_fields->>'next_date')::date) end,
        active=(p_fields->>'active')::boolean,version=version+1
      where id=p_id and user_id=auth.uid() and version=p_version returning * into t;
      if t.id is null then raise exception 'Template sudah berubah. Muat ulang.' using errcode='40001'; end if;
    end if;
    if t.account_id is not null and not exists(select 1 from public.finance_accounts where id=t.account_id and user_id=auth.uid() and
      kind=case t.category when 'savings_expense' then 'savings' when 'investment_expense' then 'investment' else kind end and
      (t.category in ('savings_expense','investment_expense') or kind in ('cash','bank'))) then raise exception 'Rekening template tidak sesuai kategori.' using errcode='22023'; end if;
    if t.category in ('savings','investment') then
      if t.destination_account_id is not null and not exists(select 1 from public.finance_accounts where id=t.destination_account_id and user_id=auth.uid() and kind=t.category) then raise exception 'Rekening tujuan tidak sesuai.' using errcode='22023'; end if;
    elsif t.destination_account_id is not null then raise exception 'Rekening tujuan hanya untuk alokasi.' using errcode='22023'; end if;
    result:=to_jsonb(t);
  elsif p_kind='apply_template' then
    select * into t from public.transaction_templates where id=p_id and user_id=auth.uid() and version=p_version and active for update;
    if t.id is null or t.next_date is distinct from (p_fields->>'scheduled_date')::date then raise exception 'Jadwal atau template sudah berubah. Muat ulang.' using errcode='40001'; end if;
    if t.next_date>(now() at time zone 'Asia/Makassar')::date then raise exception 'Jadwal template belum tiba.' using errcode='22023'; end if;
    result:=public.save_financial_record(t.category,p_fields->'transaction',gen_random_uuid());
    insert into public.template_occurrences values(t.id,auth.uid(),t.next_date,(result->>'id')::uuid);
    if t.frequency='weekly' then new_date:=t.next_date+7;
    else
      new_date:=(date_trunc('month',t.next_date)+interval '1 month')::date;
      day_limit:=extract(day from (new_date+interval '1 month'-interval '1 day'));
      new_date:=new_date+least(t.anchor_day,day_limit)-1;
    end if;
    update public.transaction_templates set next_date=new_date,version=version+1 where id=t.id;
  elsif p_kind='allocate_cost' then
    select * into c from public.cash_expenses where id=(p_fields->>'cash_expense_id')::uuid and user_id=auth.uid() and category='garden' and published_at is not null for update;
    if c.id is null or not exists(select 1 from public.harvests where id=(p_fields->>'harvest_id')::uuid and user_id=auth.uid()) then raise exception 'Biaya atau panen tidak tersedia.' using errcode='42501'; end if;
    if clock_timestamp()>=c.published_at+interval '7 days' then raise exception 'Alokasi biaya terkunci setelah tujuh hari publikasi.' using errcode='P0001'; end if;
    if jsonb_typeof(p_fields->'amount') is distinct from 'number' or (p_fields->>'amount')::numeric<>round((p_fields->>'amount')::numeric,2) or (p_fields->>'amount')::numeric<0 then raise exception 'Nominal alokasi tidak valid.' using errcode='22023'; end if;
    if (p_fields->>'amount')::numeric+coalesce((select sum(amount) from public.harvest_cost_allocations where cash_expense_id=c.id and harvest_id<>(p_fields->>'harvest_id')::uuid and user_id=auth.uid()),0)>c.total_expense then raise exception 'Alokasi melebihi biaya kebun yang dipublikasikan.' using errcode='40001'; end if;
    if p_id is null then
      insert into public.harvest_cost_allocations(user_id,harvest_id,cash_expense_id,amount) values(auth.uid(),(p_fields->>'harvest_id')::uuid,c.id,(p_fields->>'amount')::numeric) returning * into a;
    else
      update public.harvest_cost_allocations set amount=(p_fields->>'amount')::numeric,version=version+1
      where id=p_id and user_id=auth.uid() and version=p_version and cash_expense_id=c.id and harvest_id=(p_fields->>'harvest_id')::uuid returning * into a;
      if a.id is null then raise exception 'Alokasi sudah berubah. Muat ulang.' using errcode='40001'; end if;
    end if;
    result:=to_jsonb(a)||jsonb_build_object('amount',a.amount::text);
  else raise exception 'Perintah tidak valid.' using errcode='22023'; end if;
  insert into public.financial_audit(user_id,entity,record_id,action,after_data,reason) values(auth.uid(),'productivity_command',(result->>'id')::uuid,upper(p_kind),payload,p_fields->>'reason');
  update public.finance_commands set response=result where user_id=auth.uid() and request_key=p_request_key;
  return result;
end $$;
revoke all on function public.productivity_command(text,jsonb,uuid,uuid,integer) from public,anon;
grant execute on function public.productivity_command(text,jsonb,uuid,uuid,integer) to authenticated;

-- Bounded summaries supplement the existing atomic workspace snapshot.
create function public.productivity_snapshot(p_harvest_ids uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.finance_require_mfa();
  if cardinality(p_harvest_ids)>21 then raise exception 'Halaman terlalu besar.' using errcode='22023'; end if;
  with month_costs as (
    select category,sum(amount) as amount from public.finance_events where user_id=auth.uid() and flow_type='expense'
    and event_date>=date_trunc('month',now() at time zone 'Asia/Makassar')::date
    and event_date<(date_trunc('month',now() at time zone 'Asia/Makassar')+interval '1 month')::date group by category
  ), profits as (
    select h.id,h.name,h.harvest_date,
      coalesce(s.income,0) as income,coalesce(s.net_weight,0) as net_weight,
      coalesce((select sum(total_expense) from public.harvest_expenses where harvest_id=h.id and user_id=auth.uid() and published_at is not null),0) as harvest_cost,
      coalesce((select sum(amount) from public.harvest_cost_allocations where harvest_id=h.id and user_id=auth.uid()),0) as garden_cost
    from public.harvests h left join lateral (
      select sum(total_income) as income,sum(net_weight) as net_weight from public.spks where harvest_id=h.id and user_id=auth.uid() and published_at is not null
    ) s on true where h.user_id=auth.uid() and h.id=any(p_harvest_ids)
  ) select jsonb_build_object(
    'templates',coalesce((select jsonb_agg(to_jsonb(t) order by t.active desc,t.next_date,t.id) from public.transaction_templates t where user_id=auth.uid()),'[]'),
    'reminderBudgets',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'category',b.category,'amount',b.amount::text,'spent',coalesce(c.amount,0)::text)) from public.finance_budgets b left join month_costs c using(category) where b.user_id=auth.uid() and b.month=date_trunc('month',now() at time zone 'Asia/Makassar')::date),'[]'),
    'profits',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'harvest_date',harvest_date,'income',income::text,'netWeight',net_weight::text,'harvestCost',harvest_cost::text,'gardenCost',garden_cost::text,'totalCost',(harvest_cost+garden_cost)::text,'profit',(income-harvest_cost-garden_cost)::text,
      'costPerKg',case when net_weight>0 then round((harvest_cost+garden_cost)/net_weight,2)::text else null end,
      'marginPercent',case when income>0 then round((income-harvest_cost-garden_cost)/income*100,2) else null end) order by harvest_date desc,id desc) from profits),'[]')
  ) into result;
  return result;
end $$;
revoke all on function public.productivity_snapshot(uuid[]) from public,anon;
grant execute on function public.productivity_snapshot(uuid[]) to authenticated;

create function public.garden_cost_options(p_harvest_id uuid,p_search text default '',p_before uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.finance_require_mfa();
  if not exists(select 1 from public.harvests where id=p_harvest_id and user_id=auth.uid()) or length(p_search)>120 then raise exception 'Panen atau pencarian tidak valid.' using errcode='42501'; end if;
  with rows as (
    select c.*,coalesce(a.amount,0) as allocated,a.id as allocation_id,a.version as allocation_version,
      coalesce((select sum(amount) from public.harvest_cost_allocations where cash_expense_id=c.id and user_id=auth.uid()),0) as assigned
    from public.cash_expenses c left join public.harvest_cost_allocations a on a.cash_expense_id=c.id and a.harvest_id=p_harvest_id and a.user_id=auth.uid()
    where c.user_id=auth.uid() and c.category='garden' and c.published_at is not null
    and (c.published_at>clock_timestamp()-interval '7 days' or a.id is not null)
    and (p_search='' or position(lower(p_search) in lower(c.items::text))>0)
    and (p_before is null or (c.expense_date,c.id)<(select expense_date,id from public.cash_expenses where id=p_before and user_id=auth.uid()))
    order by c.expense_date desc,c.id desc limit 21
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'date',expense_date,'items',items,'amount',total_expense::text,'available',(total_expense-assigned+allocated)::text,
    'allocated',allocated::text,'allocationId',allocation_id,'version',allocation_version,'editable',clock_timestamp()<published_at+interval '7 days') order by expense_date desc,id desc) from (select * from rows limit 20) page),'[]'),'hasNext',(select count(*) from rows)>20) into result;
  return result;
end $$;
revoke all on function public.garden_cost_options(uuid,text,uuid) from public,anon;
grant execute on function public.garden_cost_options(uuid,text,uuid) to authenticated;

-- Preserve a single database snapshot for cash, templates, reminders and profit.
alter function public.workspace_snapshot(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) rename to workspace_snapshot_before_productivity;
revoke all on function public.workspace_snapshot_before_productivity(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) from authenticated;
create function public.workspace_snapshot(
  p_view text default 'dashboard',p_month text default 'all',p_year integer default 2026,p_period text default 'month',
  p_search text default '',p_harvest_id uuid default null,p_harvest_after uuid default null,p_spk_after uuid default null,
  p_expense_after uuid default null,p_cash_after uuid default null,p_allocation_expense_after uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
  with s as materialized (select public.workspace_snapshot_before_productivity(p_view,p_month,p_year,p_period,p_search,p_harvest_id,p_harvest_after,p_spk_after,p_expense_after,p_cash_after,p_allocation_expense_after) as data)
  select s.data||jsonb_build_object('productivity',public.productivity_snapshot(array(select distinct (v->>'id')::uuid from jsonb_array_elements(coalesce(s.data->'harvests','[]')||case when s.data->'activeHarvest'->>'id' is not null then jsonb_build_array(s.data->'activeHarvest') else '[]'::jsonb end) v))) from s;
$$;
revoke all on function public.workspace_snapshot(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.workspace_snapshot(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;
commit;
