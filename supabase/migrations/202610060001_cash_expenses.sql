begin;

-- Validate JSON line items and calculate NUMERIC totals in PostgreSQL itself.
create function public.cash_items_valid(items jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; amount numeric;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) not between 1 and 50 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'description') is distinct from 'string'
      or length(btrim(item->>'description')) not between 1 and 160
      or jsonb_typeof(item->'amount') is distinct from 'number'
      or (select count(*) from jsonb_object_keys(item)) <> 2 then return false; end if;
    amount := (item->>'amount')::numeric;
    if amount < 0 or amount > 1000000000000 or amount <> round(amount, 2) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end; $$;

create function public.cash_items_total(items jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce(sum((value->>'amount')::numeric), 0) from jsonb_array_elements(items)
$$;

create table public.cash_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  category text not null check (category in ('garden', 'other')),
  expense_date date not null check (expense_date between '1900-01-01' and '9999-12-31'),
  items jsonb not null check (public.cash_items_valid(items)),
  total_expense numeric(16,2) generated always as (public.cash_items_total(items)) stored
    check (total_expense > 0 and total_expense <= 1000000000000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cash_expenses_owner_date_idx on public.cash_expenses(user_id, expense_date, id);
create index cash_expenses_owner_category_idx on public.cash_expenses(user_id, category);

create function public.guard_cash_expense_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    if NEW.published_at is not null then NEW.published_at := NEW.created_at; end if;
  else
    if OLD.published_at is not null and clock_timestamp() >= OLD.published_at + interval '7 days' then
      raise exception 'Pengeluaran terkunci: batas edit 7 hari telah berakhir.' using errcode = 'P0001';
    end if;
    if NEW.id is distinct from OLD.id or NEW.user_id is distinct from OLD.user_id
      or NEW.category is distinct from OLD.category or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Identitas dan kategori pengeluaran tidak dapat diubah.' using errcode = 'P0001';
    end if;
    if OLD.published_at is not null and NEW.published_at is distinct from OLD.published_at then
      raise exception 'Waktu publikasi pengeluaran tidak dapat diubah.' using errcode = 'P0001';
    end if;
    if OLD.published_at is null and NEW.published_at is not null then NEW.published_at := clock_timestamp(); end if;
    NEW.updated_at := clock_timestamp();
  end if;
  return NEW;
end; $$;
create trigger guard_cash_expense_write before insert or update on public.cash_expenses
for each row execute function public.guard_cash_expense_write();
alter table public.cash_expenses enable row level security;
create policy cash_select_owner on public.cash_expenses for select to authenticated using ((select auth.uid()) = user_id);
create policy cash_insert_owner on public.cash_expenses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy cash_update_owner on public.cash_expenses for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.cash_expenses from public, anon, authenticated;
grant select, insert, update on public.cash_expenses to authenticated;
revoke all on function public.guard_cash_expense_write() from public, anon, authenticated;
revoke all on function public.cash_items_valid(jsonb), public.cash_items_total(jsonb) from public, anon;
grant execute on function public.cash_items_valid(jsonb), public.cash_items_total(jsonb) to authenticated;
commit;
