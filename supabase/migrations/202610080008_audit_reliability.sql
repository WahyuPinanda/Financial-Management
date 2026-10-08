begin;
-- Keep routine details out of every dashboard refresh.
create or replace function public.productivity_snapshot(p_harvest_ids uuid[] default '{}') returns jsonb
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
    'templates','[]'::jsonb,'templateCount',(select count(*) from public.transaction_templates where user_id=auth.uid()),
    'reminderTemplates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'active',t.active,'next_date',t.next_date) order by t.next_date,t.id) from public.transaction_templates t where user_id=auth.uid() and t.active and t.next_date<=(now() at time zone 'Asia/Makassar')::date),'[]'),
    'reminderBudgets',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'category',b.category,'amount',b.amount::text,'spent',coalesce(c.amount,0)::text)) from public.finance_budgets b left join month_costs c using(category) where b.user_id=auth.uid() and b.month=date_trunc('month',now() at time zone 'Asia/Makassar')::date),'[]'),
    'profits',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'harvest_date',harvest_date,'income',income::text,'netWeight',net_weight::text,'harvestCost',harvest_cost::text,'gardenCost',garden_cost::text,'totalCost',(harvest_cost+garden_cost)::text,'profit',(income-harvest_cost-garden_cost)::text,
      'costPerKg',case when net_weight>0 then round((harvest_cost+garden_cost)/net_weight,2)::text else null end,
      'marginPercent',case when income>0 then round((income-harvest_cost-garden_cost)/income*100,2) else null end) order by harvest_date desc,id desc) from profits),'[]')
  ) into result;
  return result;
end $$;
revoke all on function public.productivity_snapshot(uuid[]) from public,anon;
grant execute on function public.productivity_snapshot(uuid[]) to authenticated;

create function public.transaction_template_page(p_search text default '',p_before uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.finance_require_mfa();
  if p_search is null or length(p_search)>120 then raise exception 'Pencarian tidak valid.' using errcode='22023'; end if;
  with rows as (
    select t.* from public.transaction_templates t where t.user_id=auth.uid()
    and (p_search='' or position(lower(p_search) in lower(t.name))>0)
    and (p_before is null or (t.created_at,t.id)<(select created_at,id from public.transaction_templates where id=p_before and user_id=auth.uid()))
    order by t.created_at desc,t.id desc limit 21
  ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(t) order by created_at desc,id desc) from (select * from rows limit 20) t),'[]'),
    'hasNext',(select count(*) from rows)>20,'total',(select count(*) from public.transaction_templates where user_id=auth.uid())) into result;
  return result;
end $$;
revoke all on function public.transaction_template_page(text,uuid) from public,anon;
grant execute on function public.transaction_template_page(text,uuid) to authenticated;

-- Future records may be drafts; published records represent money already moved,
-- even before the owner activates the account ledger.
create function public.guard_published_day() returns trigger
language plpgsql security definer set search_path='' as $$
declare day date;
begin
  if new.published_at is not null then
    if TG_TABLE_NAME='spks' then day:=new.delivery_date;
    elsif TG_TABLE_NAME='cash_expenses' then day:=new.expense_date;
    else select harvest_date into day from public.harvests where id=new.harvest_id and user_id=new.user_id;
    end if;
    if day>(clock_timestamp() at time zone 'Asia/Makassar')::date then
      raise exception 'Tanggal publikasi transaksi tidak boleh di masa depan. Simpan sebagai draft.' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_published_day() from public,anon,authenticated;
create trigger guard_published_day before insert or update on public.spks for each row execute function public.guard_published_day();
create trigger guard_published_day before insert or update on public.cash_expenses for each row execute function public.guard_published_day();
create trigger guard_published_day before insert or update on public.harvest_expenses for each row execute function public.guard_published_day();

-- Evaluate the financial snapshot once per request; SQL inlining otherwise repeats
-- the full ledger aggregation for each accessed JSON property.
create or replace function public.finance_snapshot_without_mfa(p_month text default 'all',p_year integer default 2026,p_period text default 'month',p_before bigint default null,p_audit_before bigint default null)
returns jsonb language sql stable security definer set search_path='' as $$
with accounts as materialized(select * from public.finance_accounts where user_id=auth.uid()),
  cash_moves as materialized(select m.event_id,sum(m.delta) as delta from public.finance_movements m join accounts a on a.id=m.account_id
    where m.user_id=auth.uid() and a.kind in ('cash','bank') group by m.event_id),
  events as materialized(select e.event_date,e.kind,e.flow_type,e.category,e.amount,e.account_id,coalesce(m.delta,0) as cash_delta
    from public.finance_events e left join cash_moves m on m.event_id=e.id where e.user_id=auth.uid()),
  selected as(select * from events where p_month='all' or to_char(event_date,'YYYY-MM')=p_month),
  actual_costs as(select category,coalesce(sum(amount),0) as amount from selected where flow_type='expense' group by category),
  budget_costs as(select category,coalesce(sum(amount),0) as amount from events where flow_type='expense' and to_char(event_date,'YYYY-MM')=case when p_month='all' then to_char(now() at time zone 'Asia/Makassar','YYYY-MM') else p_month end group by category),
  journal as(select e.id,e.seq,e.user_id,e.event_date,e.kind,e.flow_type,e.category,e.description,e.amount,e.account_id,
    e.destination_id,e.source_kind,e.source_id,e.source_version,e.reverses_id,e.created_at,
    coalesce((select sum(m.delta) from public.finance_movements m join accounts a on a.id=m.account_id
      where m.event_id=e.id and a.kind in ('cash','bank')),0) as cash_delta
    from public.finance_events e where e.user_id=auth.uid() and (p_before is null or e.seq<p_before)
    and (p_month='all' or (e.event_date>=to_date(p_month||'-01','YYYY-MM-DD') and e.event_date<(to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month')::date))
    order by e.seq desc limit 21),
  audit as(select * from public.financial_audit where user_id=auth.uid() and (p_audit_before is null or seq<p_audit_before) order by seq desc limit 21),
  buckets as materialized(select date_trunc(case when p_period='year' then 'year' else 'month' end,event_date)::date as start,
    coalesce(sum(amount) filter(where flow_type='income'),0) as income,
    coalesce(sum(amount) filter(where category='other_income'),0) as other_income,
    coalesce(sum(amount) filter(where category='harvest'),0) as harvest,
    coalesce(sum(amount) filter(where category='garden'),0) as garden,
    coalesce(sum(amount) filter(where category='other'),0) as other,
    coalesce(sum(amount) filter(where category='savings'),0) as savings,
    coalesce(sum(amount) filter(where category='investment'),0) as investment,
    coalesce(sum(amount) filter(where category='savings_expense'),0) as savings_expenses,
    coalesce(sum(amount) filter(where category='investment_expense'),0) as investment_expenses,
    coalesce(sum(cash_delta) filter(where kind='transfer'),0) as transfer_net,
    coalesce(sum(cash_delta) filter(where flow_type='correction'),0) as corrections,
    coalesce(sum(cash_delta) filter(where flow_type='opening'),0) as opening,
    coalesce(sum(cash_delta) filter(where flow_type<>'opening'),0) as net,
    coalesce(sum(case when kind<>'transfer' and cash_delta<0 and flow_type in ('expense','transfer') then -cash_delta else 0 end),0)
      -coalesce(sum(case when kind='reversal' and cash_delta>0 and flow_type in ('expense','transfer') then cash_delta else 0 end),0) as expenses
    from events group by 1),
  periods as(select make_date(p_year,m,1) as start from generate_series(1,case when p_year=extract(year from now() at time zone 'Asia/Makassar')
    then extract(month from now() at time zone 'Asia/Makassar')::int else 12 end) m where p_period='month'
    union all select make_date(y,1,1) from generate_series(greatest(1900,p_year-9,least(p_year,coalesce((select min(extract(year from event_date))::int from events),p_year))),p_year) y where p_period='year'),
  analysis as(select p.start as period_start,b.*,coalesce(prev.net,0) as previous,
    coalesce((select sum(net+opening) from buckets where start<p.start),0)+coalesce(b.opening,0) as opening_cash
    from periods p left join buckets b on b.start=p.start left join buckets prev on prev.start=(p.start-case when p_period='year' then interval '1 year' else interval '1 month' end)::date),
  source_projection as(select
    coalesce(sum(case when category in ('income','other_income') then amount when category in ('savings_expense','investment_expense') then 0 else -amount end),0) as available,
    coalesce(sum(case when category in ('income','other_income') then amount when category in ('savings','investment') then 0 else -amount end),0) as total,
    coalesce(sum(case category when 'savings' then amount when 'savings_expense' then -amount else 0 end),0) as savings,
    coalesce(sum(case category when 'investment' then amount when 'investment_expense' then -amount else 0 end),0) as investment,
    coalesce(min(day),(now() at time zone 'Asia/Makassar')::date) as first_day
    from public.finance_source_records where user_id=auth.uid() and not coalesce((select enabled from public.finance_controls where user_id=auth.uid()),false))
select jsonb_build_object(
  'enabled',coalesce((select enabled from public.finance_controls where user_id=auth.uid()),false),
  'revision',coalesce((select revision from public.finance_controls where user_id=auth.uid()),1),
  'activationPreview',jsonb_build_object('availableCash',source_projection.available::text,'totalFunds',source_projection.total::text,
    'savings',source_projection.savings::text,'investment',source_projection.investment::text,'openingDate',source_projection.first_day),
  'availableCash',coalesce((select sum(balance) from accounts where kind in ('cash','bank')),0)::text,
  'totalFunds',coalesce((select sum(balance) from accounts),0)::text,
  'savingsBalance',coalesce((select sum(balance) from accounts where kind='savings'),0)::text,
  'investmentBalance',coalesce((select sum(balance) from accounts where kind='investment'),0)::text,
  'periodIncome',coalesce((select sum(amount) from selected where flow_type='income'),0)::text,
  'periodOutflow',(coalesce((select sum(-cash_delta) from selected where cash_delta<0 and flow_type in ('expense','transfer')),0)
    -coalesce((select sum(cash_delta) from selected where kind='reversal' and cash_delta>0 and flow_type in ('expense','transfer')),0))::text,
  'periodCashFlow',coalesce((select sum(cash_delta) from selected where flow_type<>'opening'),0)::text,
  'accounts',coalesce((select jsonb_agg(to_jsonb(a)-'balance'||jsonb_build_object('balance',a.balance::text) order by a.created_at,a.id) from accounts a),'[]'),
  'goals',coalesce((select jsonb_agg(to_jsonb(g)-'target'||jsonb_build_object('target',g.target::text,'balance',a.balance::text,
    'remaining',greatest(g.target-a.balance,0)::text,'progress',round(greatest(a.balance,0)/g.target*100,2),'accountName',a.name,
    'kind',a.kind,'spent',coalesce((select sum(e.amount) from events e where e.account_id=a.id and e.flow_type='expense'),0)::text) order by g.due_date,g.id)
    from public.finance_goals g join accounts a on a.id=g.account_id where g.user_id=auth.uid()),'[]'),
  'budgets',coalesce((select jsonb_agg(to_jsonb(b)-'amount'||jsonb_build_object('amount',b.amount::text,'spent',coalesce(c.amount,0)::text,
    'remaining',(b.amount-coalesce(c.amount,0))::text,'percent',round(coalesce(c.amount,0)/b.amount*100,2)) order by b.category)
    from public.finance_budgets b left join budget_costs c on c.category=b.category where b.user_id=auth.uid()
    and to_char(b.month,'YYYY-MM')=case when p_month='all' then to_char(now() at time zone 'Asia/Makassar','YYYY-MM') else p_month end),'[]'),
  'costs',coalesce((select jsonb_agg(jsonb_build_object('category',category,'amount',amount::text) order by category) from actual_costs),'[]'),
  'journal',coalesce((select jsonb_agg(to_jsonb(e)-'amount'-'seq'-'cash_delta'-'metadata'||jsonb_build_object('seq',e.seq::text,'amount',e.amount::text,'cashDelta',e.cash_delta::text,
    'movements',(select jsonb_agg(jsonb_build_object('account',a.name,'delta',m.delta::text)) from public.finance_movements m join accounts a on a.id=m.account_id where m.event_id=e.id)) order by e.seq desc)
    from (select * from journal limit 20) e),'[]'),
  'journalHasNext',(select count(*) from journal)>20,
  'audit',coalesce((select jsonb_agg(to_jsonb(a)-'seq'||jsonb_build_object('seq',a.seq::text,'before_data',public.finance_audit_payload(a.before_data),'after_data',public.finance_audit_payload(a.after_data)) order by a.seq desc) from (select * from audit limit 20) a),'[]'),
  'auditHasNext',(select count(*) from audit)>20,
  'reconciliations',coalesce((select jsonb_agg(to_jsonb(r)-'expected'-'actual'-'difference'||jsonb_build_object('expected',r.expected::text,'actual',r.actual::text,'difference',r.difference::text,'accountName',a.name))
    from (select * from public.finance_reconciliations where user_id=auth.uid() order by created_at desc,id desc limit 20) r join accounts a on a.id=r.account_id),'[]'),
  'analysis',coalesce((select jsonb_agg(jsonb_build_object('key',to_char(period_start,case when p_period='year' then 'YYYY' else 'YYYY-MM' end),
    'income',coalesce(income,0)::text,'otherIncome',coalesce(other_income,0)::text,'expenses',coalesce(expenses,0)::text,
    'harvestExpenses',coalesce(harvest,0)::text,'gardenExpenses',coalesce(garden,0)::text,'otherExpenses',coalesce(other,0)::text,
    'savingsAllocations',coalesce(savings,0)::text,'investmentAllocations',coalesce(investment,0)::text,
    'savingsExpenses',coalesce(savings_expenses,0)::text,'investmentExpenses',coalesce(investment_expenses,0)::text,
    'transferNet',coalesce(transfer_net,0)::text,'corrections',coalesce(corrections,0)::text,'net',coalesce(net,0)::text,
    'previousNet',previous::text,'openingCash',opening_cash::text,'closingCash',(opening_cash+coalesce(net,0))::text,
    'growthPercent',case when previous=0 then null else round((coalesce(net,0)-previous)/abs(previous)*100,4) end,
    'partial',to_char(period_start,case when p_period='year' then 'YYYY' else 'YYYY-MM' end)=to_char(now() at time zone 'Asia/Makassar',case when p_period='year' then 'YYYY' else 'YYYY-MM' end)) order by period_start) from analysis),'[]')
) from source_projection;
$$;
revoke all on function public.finance_snapshot_without_mfa(text,integer,text,bigint,bigint) from public,anon,authenticated;
create or replace function public.workspace_snapshot_without_mfa(
  p_view text default 'dashboard',p_month text default 'all',p_year integer default 2026,p_period text default 'month',
  p_search text default '',p_harvest_id uuid default null,p_harvest_after uuid default null,p_spk_after uuid default null,
  p_expense_after uuid default null,p_cash_after uuid default null,p_allocation_expense_after uuid default null
) returns jsonb language sql stable security definer set search_path='' as $$
with s as materialized(select public.workspace_snapshot_legacy(p_view,p_month,p_year,p_period,p_search,p_harvest_id,p_harvest_after,p_spk_after,p_expense_after,p_cash_after,p_allocation_expense_after) as data),
  f as materialized(select public.finance_snapshot(p_month,p_year,p_period) as data)
select s.data||jsonb_build_object('finance',f.data)||case when (f.data->>'enabled')::boolean then jsonb_build_object(
  'months',coalesce((select jsonb_agg(period_month order by period_month desc) from (select distinct to_char(event_date,'YYYY-MM') as period_month from public.finance_events where user_id=auth.uid()) dates),'[]'),
  'years',coalesce((select jsonb_agg(period_year order by period_year desc) from (select distinct extract(year from event_date)::int as period_year from public.finance_events where user_id=auth.uid()) dates),'[]'),
  'allTimeCash',f.data->>'availableCash','analysis',f.data->'analysis','hasEvents',exists(select 1 from public.finance_events where user_id=auth.uid()),
  'totals',s.data->'totals'||jsonb_build_object('income',f.data->>'periodIncome','expenses',f.data->>'periodOutflow','netIncome',f.data->>'periodCashFlow')) else '{}'::jsonb end from s,f;
$$;
revoke all on function public.workspace_snapshot_without_mfa(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
create index templates_owner_cursor on public.transaction_templates(user_id,created_at desc,id desc);
commit;
