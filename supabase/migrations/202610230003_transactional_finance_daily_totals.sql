begin;

-- Private, derived data. Journal events and movements remain authoritative.
create table public.finance_daily_totals (
  user_id uuid not null references auth.users(id),
  event_date date not null,
  account_id uuid not null,
  kind text not null,
  flow_type text not null,
  category text not null,
  amount numeric(30,2) not null default 0,
  cash_delta numeric(30,2) not null default 0,
  negative_cash_delta numeric(30,2) not null default 0 check(negative_cash_delta<=0),
  positive_cash_delta numeric(30,2) not null default 0 check(positive_cash_delta>=0),
  primary key(user_id,event_date,account_id,kind,flow_type,category),
  foreign key(account_id,user_id) references public.finance_accounts(id,user_id),
  check(cash_delta=negative_cash_delta+positive_cash_delta)
);
alter table public.finance_daily_totals enable row level security;
revoke all on public.finance_daily_totals from public,anon,authenticated;

-- Statement triggers also keep bulk imports bounded: one upsert per daily group,
-- rather than one upsert per journal row. Normal writes already lock the owner.
create function public.finance_accumulate_event_totals() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.finance_daily_totals(user_id,event_date,account_id,kind,flow_type,category,amount)
  select user_id,event_date,account_id,kind,flow_type,category,sum(amount)
  from inserted_events group by user_id,event_date,account_id,kind,flow_type,category
  on conflict(user_id,event_date,account_id,kind,flow_type,category)
  do update set amount=public.finance_daily_totals.amount+excluded.amount;
  return null;
end $$;

create function public.finance_accumulate_movement_totals() returns trigger
language plpgsql security definer set search_path='' as $$
declare complete boolean; previous_nestloop text;
begin
  -- Transition tables have no column statistics. On a large import an estimated
  -- tiny CTE can otherwise choose quadratic nested loops against the new rows.
  -- Keep indexed nested loops for normal, small transaction writes.
  if (select count(*) from inserted_movements)>1000 then
    previous_nestloop:=current_setting('enable_nestloop');
    perform set_config('enable_nestloop','off',true);
  end if;
  -- Observe all legs of a multi-row transfer together. Grouping negative movement
  -- legs separately would incorrectly count an internal cash/bank transfer as cost.
  execute $rollup$
  with incoming as materialized (
    select m.event_id,m.user_id,sum(m.delta) as delta from inserted_movements m
    join public.finance_accounts a on a.id=m.account_id and a.user_id=m.user_id
    where a.kind in ('cash','bank') group by m.event_id,m.user_id
  ), current_cash as materialized (
    select m.event_id,sum(m.delta) as delta from public.finance_movements m
    join incoming i on i.event_id=m.event_id and i.user_id=m.user_id
    join public.finance_accounts a on a.id=m.account_id and a.user_id=m.user_id
    where a.kind in ('cash','bank') group by m.event_id
  ), changes as materialized (
    select e.user_id,e.event_date,e.account_id,e.kind,e.flow_type,e.category,
      sum(i.delta) as delta,
      sum(least(c.delta,0)-least(c.delta-i.delta,0)) as negative,
      sum(greatest(c.delta,0)-greatest(c.delta-i.delta,0)) as positive
    from incoming i join current_cash c on c.event_id=i.event_id
    join public.finance_events e on e.id=i.event_id and e.user_id=i.user_id
    group by e.user_id,e.event_date,e.account_id,e.kind,e.flow_type,e.category
  ), updated as (
    update public.finance_daily_totals d set
      cash_delta=d.cash_delta+c.delta,
      negative_cash_delta=d.negative_cash_delta+c.negative,
      positive_cash_delta=d.positive_cash_delta+c.positive
    from changes c where (d.user_id,d.event_date,d.account_id,d.kind,d.flow_type,d.category)=
      (c.user_id,c.event_date,c.account_id,c.kind,c.flow_type,c.category)
    returning 1
  ) select (select count(*) from changes)=(select count(*) from updated)
  $rollup$ into complete;
  if previous_nestloop is not null then perform set_config('enable_nestloop',previous_nestloop,true); end if;
  if not complete then raise exception 'Ringkasan jurnal belum konsisten.' using errcode='23514'; end if;
  return null;
exception when others then
  if previous_nestloop is not null then perform set_config('enable_nestloop',previous_nestloop,true); end if;
  raise;
end $$;
revoke all on function public.finance_accumulate_event_totals(),public.finance_accumulate_movement_totals()
  from public,anon,authenticated;

-- Trigger DDL holds the write locks until commit, so the backfill has no gap
-- where a concurrently committed event could be missed or counted twice.
create trigger accumulate_finance_event_totals after insert on public.finance_events
  referencing new table as inserted_events for each statement
  execute function public.finance_accumulate_event_totals();
create trigger accumulate_finance_movement_totals after insert on public.finance_movements
  referencing new table as inserted_movements for each statement
  execute function public.finance_accumulate_movement_totals();

with cash as (
  select m.event_id,sum(m.delta) as delta from public.finance_movements m
  join public.finance_accounts a on a.id=m.account_id and a.user_id=m.user_id
  where a.kind in ('cash','bank') group by m.event_id
)
insert into public.finance_daily_totals(user_id,event_date,account_id,kind,flow_type,category,
  amount,cash_delta,negative_cash_delta,positive_cash_delta)
select e.user_id,e.event_date,e.account_id,e.kind,e.flow_type,e.category,sum(e.amount),
  sum(coalesce(c.delta,0)),sum(least(coalesce(c.delta,0),0)),sum(greatest(coalesce(c.delta,0),0))
from public.finance_events e left join cash c on c.event_id=e.id
group by e.user_id,e.event_date,e.account_id,e.kind,e.flow_type,e.category;

do $migration$
declare definition text; old_events text; new_events text; routine record;
begin
  definition:=replace(pg_catalog.pg_get_functiondef('public.finance_snapshot_without_mfa(text,integer,text,bigint,bigint)'::regprocedure),chr(13),'');
  old_events:=$old$  cash_moves as materialized(select m.event_id,sum(m.delta) as delta from public.finance_movements m join accounts a on a.id=m.account_id
    where m.user_id=(select auth.uid()) and a.kind in ('cash','bank') group by m.event_id),
  events as materialized(select e.event_date,e.kind,e.flow_type,e.category,sum(e.amount) as amount,e.account_id,sum(coalesce(m.delta,0)) as cash_delta
    from public.finance_events e left join cash_moves m on m.event_id=e.id where e.user_id=(select auth.uid())
    group by e.event_date,e.kind,e.flow_type,e.category,e.account_id,sign(coalesce(m.delta,0))),$old$;
  new_events:=$new$  events as materialized(select d.event_date,d.kind,d.flow_type,d.category,v.amount,d.account_id,v.cash_delta
    from public.finance_daily_totals d cross join lateral (
      values(d.amount,0::numeric),(0::numeric,d.negative_cash_delta),(0::numeric,d.positive_cash_delta)
    ) v(amount,cash_delta) where d.user_id=(select auth.uid())),$new$;
  if position(old_events in definition)=0 then raise exception 'Unexpected financial snapshot definition.'; end if;
  execute replace(definition,old_events,new_events);
  for routine in select p.oid from pg_catalog.pg_proc p
    where p.pronamespace='public'::regnamespace and p.prokind='f'
      and p.proname in('workspace_snapshot_without_mfa','productivity_snapshot')
  loop
    definition:=pg_catalog.pg_get_functiondef(routine.oid);
    -- These read paths need dates and aggregated category amounts only.
    execute replace(definition,'from public.finance_events where user_id=',
      'from public.finance_daily_totals where user_id=');
  end loop;
end
$migration$;
commit;
