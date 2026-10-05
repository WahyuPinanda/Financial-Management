begin;
-- Additional expenses are separate cash outflows; allocations are not reversed.
alter table public.cash_expenses drop constraint cash_expenses_category_check;
alter table public.cash_expenses add constraint cash_expenses_category_check
  check (category in ('garden','other','savings','investment','savings_expense','investment_expense'));
create or replace function public.save_financial_record(p_kind text, p_fields jsonb, p_request_key uuid,
  p_id uuid default null, p_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare payload jsonb; previous public.financial_requests; result jsonb;
  s public.spks; e public.harvest_expenses; c public.cash_expenses; h public.harvests;
  inserted integer; published timestamptz;
begin
  if auth.uid() is null or p_request_key is null then raise exception 'Sesi atau kunci permintaan tidak valid.' using errcode='42501'; end if;
  if p_kind not in ('harvest','spk','harvest_expense','garden','other','savings','investment','savings_expense','investment_expense') then raise exception 'Kategori tidak valid.' using errcode='22023'; end if;
  if p_id is not null and (p_version is null or p_version < 1 or p_kind='harvest') then raise exception 'Versi data wajib diisi.' using errcode='22023'; end if;
  payload := jsonb_build_object('kind',p_kind,'fields',p_fields,'id',p_id,'version',p_version);
  insert into public.financial_requests(user_id,request_key,payload) values(auth.uid(),p_request_key,payload) on conflict do nothing;
  get diagnostics inserted = ROW_COUNT;
  if inserted=0 then
    select * into previous from public.financial_requests where user_id=auth.uid() and request_key=p_request_key for update;
    if previous.payload is distinct from payload then raise exception 'Kunci permintaan telah dipakai. Muat ulang data sebelum menyimpan.' using errcode='40001'; end if;
    return previous.response;
  end if;
  published := case when (p_fields->>'publish')::boolean then clock_timestamp() else null end;
  if p_kind='harvest' then
    insert into public.harvests(name,harvest_date,user_id) values(p_fields->>'name',(p_fields->>'harvest_date')::date,auth.uid()) returning * into h;
    result := to_jsonb(h) || jsonb_build_object('spks','[]'::jsonb,'expenses','[]'::jsonb);
  elsif p_kind='spk' then
    s := jsonb_populate_record(null::public.spks,p_fields);
    if p_id is null then
      insert into public.spks(user_id,harvest_id,company_name,delivery_date,bunch_count,first_weight,second_weight,deduction_kg,price_per_kg,published_at)
      values(auth.uid(),s.harvest_id,s.company_name,s.delivery_date,s.bunch_count,s.first_weight,s.second_weight,s.deduction_kg,s.price_per_kg,published) returning * into s;
    else
      update public.spks set company_name=s.company_name,delivery_date=s.delivery_date,bunch_count=s.bunch_count,first_weight=s.first_weight,
        second_weight=s.second_weight,deduction_kg=s.deduction_kg,price_per_kg=s.price_per_kg,published_at=coalesce(published_at,published)
        where id=p_id and user_id=auth.uid() and version=p_version returning * into s;
    end if;
    result := to_jsonb(s);
  elsif p_kind='harvest_expense' then
    e := jsonb_populate_record(null::public.harvest_expenses,p_fields);
    if p_id is null then
      insert into public.harvest_expenses(user_id,harvest_id,first_weight,second_weight,wage_per_kg,driver_cost,published_at)
      values(auth.uid(),e.harvest_id,e.first_weight,e.second_weight,e.wage_per_kg,e.driver_cost,published) returning * into e;
    else
      update public.harvest_expenses set first_weight=e.first_weight,second_weight=e.second_weight,wage_per_kg=e.wage_per_kg,
        driver_cost=e.driver_cost,published_at=coalesce(published_at,published) where id=p_id and user_id=auth.uid() and version=p_version returning * into e;
    end if;
    result := to_jsonb(e);
  else
    c := jsonb_populate_record(null::public.cash_expenses,p_fields);
    if p_id is null then
      insert into public.cash_expenses(user_id,category,expense_date,items,published_at)
      values(auth.uid(),p_kind,c.expense_date,c.items,published) returning * into c;
    else
      update public.cash_expenses set expense_date=c.expense_date,items=c.items,published_at=coalesce(published_at,published)
      where id=p_id and user_id=auth.uid() and category=p_kind and version=p_version returning * into c;
    end if;
    result := to_jsonb(c);
  end if;
  if result is null or result->>'id' is null then
    raise exception 'Data sudah berubah atau tidak tersedia. Tutup formulir dan muat ulang sebelum mengedit.' using errcode='40001';
  end if;
  update public.financial_requests set response=result where user_id=auth.uid() and request_key=p_request_key;
  return result;
end; $$;
drop function public.workspace_snapshot(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid);
-- One STABLE statement: totals, analysis and paged records share one MVCC snapshot.
-- Financial values leave PostgreSQL as decimal text, avoiding large-number rounding in JS.
create function public.workspace_snapshot(
  p_view text default 'dashboard', p_month text default 'all', p_year integer default 2026,
  p_period text default 'month', p_search text default '', p_harvest_id uuid default null,
  p_harvest_after uuid default null, p_spk_after uuid default null,
  p_expense_after uuid default null, p_cash_after uuid default null, p_allocation_expense_after uuid default null
) returns jsonb language sql stable set search_path = '' as $$
with
  settings as (select (now() at time zone 'Asia/Makassar')::date as today),
  hs as materialized (select * from public.harvests where user_id=auth.uid()),
  ss as materialized (select * from public.spks where user_id=auth.uid()),
  es as materialized (select e.id,e.harvest_id,e.total_expense,e.published_at,e.created_at, h.harvest_date from public.harvest_expenses e join hs h on h.id=e.harvest_id where e.user_id=auth.uid()),
  cs as materialized (select id,category,expense_date,total_expense,published_at,created_at from public.cash_expenses where user_id=auth.uid()),
  events as materialized (
    select delivery_date as day,'income'::text as kind,total_income as amount from ss where published_at is not null
    union all select harvest_date,'harvest',total_expense from es where published_at is not null
    union all select expense_date,category,total_expense from cs where published_at is not null
  ),
  selected_events as (select * from events where p_month='all' or to_char(day,'YYYY-MM')=p_month),
  money as (select coalesce(sum(amount) filter(where kind='income'),0) as income,
    coalesce(sum(amount) filter(where kind<>'income'),0) as expenses,
    count(*) filter(where kind<>'income') as expense_count from selected_events),
  stats as (select coalesce(sum(net_weight),0) as net,coalesce(sum(gross_weight),0) as gross,
    coalesce(sum(deduction_kg),0) as deduction,coalesce(sum(bunch_count),0) as bunches,count(*) as count from ss
    where published_at is not null and (p_month='all' or to_char(delivery_date,'YYYY-MM')=p_month)),
  filtered_hs as materialized (select h.* from hs h where
    (p_month='all' or to_char(h.harvest_date,'YYYY-MM')=p_month or exists(select 1 from ss where harvest_id=h.id and to_char(delivery_date,'YYYY-MM')=p_month))
    and (p_search='' or strpos(lower(h.name),lower(p_search))>0 or exists(select 1 from ss where harvest_id=h.id and strpos(lower(company_name),lower(p_search))>0))),
  h_page as (select * from filtered_hs where p_harvest_after is null or (created_at,id)<(select created_at,id from hs where id=p_harvest_after)
    order by created_at desc,id desc limit 21),
  active as (select * from filtered_hs order by (id=p_harvest_id) desc nulls last,created_at desc,id desc limit 1),
  s_page as (select * from ss where harvest_id=(select id from active) and
    (p_spk_after is null or (created_at,id)<(select created_at,id from ss where id=p_spk_after)) order by created_at desc,id desc limit 21),
  e_page as (select * from public.harvest_expenses where user_id=auth.uid() and harvest_id=(select id from active) and
    (p_expense_after is null or (created_at,id)<(select created_at,id from es where id=p_expense_after)) order by created_at desc,id desc limit 21),
  filtered_cs as (select * from cs where category=p_view and (p_month='all' or to_char(expense_date,'YYYY-MM')=p_month)),
  c_page as (select * from public.cash_expenses where user_id=auth.uid() and category=p_view and (p_month='all' or to_char(expense_date,'YYYY-MM')=p_month) and
    (p_cash_after is null or (created_at,id)<(select created_at,id from cs where id=p_cash_after))
    order by created_at desc,id desc limit 21),
  filtered_extra as (select * from cs where category=case p_view when 'savings' then 'savings_expense' when 'investment' then 'investment_expense' end
    and (p_month='all' or to_char(expense_date,'YYYY-MM')=p_month)),
  extra_page as (select * from public.cash_expenses where user_id=auth.uid()
    and category=case p_view when 'savings' then 'savings_expense' when 'investment' then 'investment_expense' end
    and (p_month='all' or to_char(expense_date,'YYYY-MM')=p_month)
    and (p_allocation_expense_after is null or (created_at,id)<(select created_at,id from cs where id=p_allocation_expense_after))
    order by created_at desc,id desc limit 21),
  active_stats as (select coalesce(sum(total_income),0) income,coalesce(sum(net_weight),0) net,coalesce(sum(gross_weight),0) gross,
    coalesce(sum(deduction_kg),0) deduction,coalesce(sum(bunch_count),0) bunches,count(*) count from ss
    where harvest_id=(select id from active) and published_at is not null),
  active_costs as (select coalesce(sum(total_expense),0) expenses,count(*) expense_count from es
    where harvest_id=(select id from active) and published_at is not null),
  chart as (select h.id,h.name,h.harvest_date,coalesce((select sum(total_income) from ss where harvest_id=h.id and published_at is not null
    and (p_month='all' or to_char(delivery_date,'YYYY-MM')=p_month)),0)::text as total from filtered_hs h order by harvest_date desc,id desc limit 6),
  buckets as materialized (select date_trunc(case when p_period='year' then 'year' else 'month' end,day)::date as start,
    coalesce(sum(amount) filter(where kind='income'),0) as income,
    coalesce(sum(amount) filter(where kind='harvest'),0) as harvest,
    coalesce(sum(amount) filter(where kind='garden'),0) as garden,
    coalesce(sum(amount) filter(where kind='other'),0) as other,
    coalesce(sum(amount) filter(where kind='savings'),0) as savings,
    coalesce(sum(amount) filter(where kind='investment'),0) as investment,
    coalesce(sum(amount) filter(where kind='savings_expense'),0) as savings_expenses,
    coalesce(sum(amount) filter(where kind='investment_expense'),0) as investment_expenses,
    sum(case when kind='income' then amount else -amount end) as net from events group by 1),
  periods as (
    select make_date(p_year,m,1) as start from generate_series(1,
      case when p_year=extract(year from (select today from settings)) then extract(month from (select today from settings))::int else 12 end) m where p_period='month'
    union all select make_date(y,1,1) from generate_series(greatest(1900,p_year-9,
      least(p_year,coalesce((select min(extract(year from day))::int from events),p_year))),p_year) y where p_period='year'
  ),
  analysis as (select p.start,coalesce(b.income,0) as income,coalesce(b.harvest,0) as harvest,
    coalesce(b.garden,0) as garden,coalesce(b.other,0) as other,coalesce(b.savings,0) as savings,
    coalesce(b.investment,0) as investment,coalesce(b.savings_expenses,0) as savings_expenses,coalesce(b.investment_expenses,0) as investment_expenses,coalesce(b.net,0) as net,coalesce(prev.net,0) as previous,
    coalesce((select sum(net) from buckets where start<p.start),0) as opening
    from periods p left join buckets b on b.start=p.start left join buckets prev on prev.start=
      (p.start-case when p_period='year' then interval '1 year' else interval '1 month' end)::date)
select jsonb_build_object(
  'server_time',now(),'page_size',20,
  'totals',jsonb_build_object('income',money.income::text,'expenses',money.expenses::text,'netIncome',(money.income-money.expenses)::text,
    'expenseCount',money.expense_count,'net',stats.net,'gross',stats.gross,'deduction',stats.deduction,'bunches',stats.bunches,'count',stats.count,
    'deductionPercent',case when stats.gross=0 then 0 else stats.deduction/stats.gross*100 end),
  'categoryTotals',(select jsonb_build_object(
    'harvest',coalesce(sum(amount) filter(where kind='harvest'),0)::text,
    'garden',coalesce(sum(amount) filter(where kind='garden'),0)::text,
    'other',coalesce(sum(amount) filter(where kind='other'),0)::text,
    'savings',coalesce(sum(amount) filter(where kind='savings'),0)::text,
    'investment',coalesce(sum(amount) filter(where kind='investment'),0)::text,
    'savings_expense',coalesce(sum(amount) filter(where kind='savings_expense'),0)::text,
    'investment_expense',coalesce(sum(amount) filter(where kind='investment_expense'),0)::text) from selected_events),
  'allTimeCash',coalesce((select sum(case when kind='income' then amount else -amount end) from events),0)::text,
  'harvestCount',(select count(*) from filtered_hs),
  'draftCount',(select count(*) from ss where published_at is null and (p_month='all' or to_char(delivery_date,'YYYY-MM')=p_month)),
  'months',coalesce((select jsonb_agg(period_key order by period_key desc) from (
    select distinct to_char(harvest_date,'YYYY-MM') as period_key from hs union select distinct to_char(delivery_date,'YYYY-MM') from ss
    union select distinct to_char(expense_date,'YYYY-MM') from cs) months),'[]'::jsonb),
  'years',coalesce((select jsonb_agg(calendar_year order by calendar_year desc) from (
    select distinct extract(year from day)::int as calendar_year from events union select extract(year from today)::int from settings union select p_year) years),'[]'::jsonb),
  'chart',coalesce((select jsonb_agg(to_jsonb(chart)) from chart),'[]'::jsonb),
  'harvests',coalesce((select jsonb_agg(to_jsonb(row) || jsonb_build_object('spks','[]'::jsonb,'expenses','[]'::jsonb)) from (select * from h_page limit 20) row),'[]'::jsonb),
  'activeHarvest',(select to_jsonb(active) || jsonb_build_object(
    'spks',coalesce((select jsonb_agg(to_jsonb(row)) from (select * from s_page limit 20) row),'[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(row)-'harvest_date') from (select * from e_page limit 20) row),'[]'::jsonb)) from active),
  'activeTotals',jsonb_build_object('income',active_stats.income::text,'expenses',active_costs.expenses::text,
    'netIncome',(active_stats.income-active_costs.expenses)::text,'expenseCount',active_costs.expense_count,
    'count',active_stats.count,'net',active_stats.net,'gross',active_stats.gross,'deduction',active_stats.deduction,'bunches',active_stats.bunches,
    'deductionPercent',case when active_stats.gross=0 then 0 else active_stats.deduction/active_stats.gross*100 end),
  'cashExpenses',coalesce((select jsonb_agg(to_jsonb(row)) from (select * from c_page limit 20) row),'[]'::jsonb),
  'allocationExpenses',coalesce((select jsonb_agg(to_jsonb(row)) from (select * from extra_page limit 20) row),'[]'::jsonb),
  'allocationExpenseTotal',coalesce((select sum(total_expense) from filtered_extra where published_at is not null),0)::text,
  'categoryTotal',coalesce((select sum(total_expense) from filtered_cs where published_at is not null),0)::text,
  'pages',jsonb_build_object(
    'harvest',jsonb_build_object('hasNext',(select count(*) from h_page)>20,'count',(select count(*) from filtered_hs)),
    'spk',jsonb_build_object('hasNext',(select count(*) from s_page)>20,'count',(select count(*) from ss where harvest_id=(select id from active))),
    'expense',jsonb_build_object('hasNext',(select count(*) from e_page)>20,'count',(select count(*) from es where harvest_id=(select id from active))),
    'allocationExpense',jsonb_build_object('hasNext',(select count(*) from extra_page)>20,'count',(select count(*) from filtered_extra)),
    'cash',jsonb_build_object('hasNext',(select count(*) from c_page)>20,'count',(select count(*) from filtered_cs))),
  'hasEvents',exists(select 1 from events),
  'analysis',coalesce((select jsonb_agg(jsonb_build_object(
    'key',to_char(start,case when p_period='year' then 'YYYY' else 'YYYY-MM' end),
    'income',income::text,'expenses',(harvest+garden+other+savings+investment+savings_expenses+investment_expenses)::text,'harvestExpenses',harvest::text,
    'gardenExpenses',garden::text,'otherExpenses',other::text,'savingsAllocations',savings::text,'investmentAllocations',investment::text,
    'savingsExpenses',savings_expenses::text,'investmentExpenses',investment_expenses::text,
    'net',net::text,'previousNet',previous::text,'openingCash',opening::text,'closingCash',(opening+net)::text,
    'growthPercent',case when previous=0 then null else ((net-previous)/abs(previous)*100)::double precision end,
    'partial',start=date_trunc(case when p_period='year' then 'year' else 'month' end,(select today from settings))::date) order by start) from analysis),'[]'::jsonb)
) from money,stats,active_stats,active_costs;
$$;
revoke all on function public.workspace_snapshot(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.workspace_snapshot(text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;
commit;
