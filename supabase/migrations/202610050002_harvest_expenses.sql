-- Apply after 202610050001_initial_harvest.sql. Existing income records are unchanged.
begin;

create table public.harvest_expenses (
  id uuid primary key default gen_random_uuid(),
  harvest_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id),
  first_weight numeric(12,2) not null check (first_weight > 0 and first_weight <= 1000000),
  second_weight numeric(12,2) not null check (second_weight >= 0 and second_weight < first_weight),
  wage_per_kg numeric(12,2) not null check (wage_per_kg >= 0 and wage_per_kg <= 1000000),
  driver_cost numeric(16,2) not null check (driver_cost >= 0 and driver_cost <= 1000000000000),
  overall_weight numeric(12,2) generated always as (first_weight - second_weight) stored,
  labor_cost numeric(22,2) generated always as (round((first_weight - second_weight) * wage_per_kg, 2)) stored,
  total_expense numeric(22,2) generated always as (round((first_weight - second_weight) * wage_per_kg, 2) + driver_cost) stored,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_harvest_owner_fk foreign key (harvest_id, user_id) references public.harvests(id, user_id)
);

create index expenses_owner_harvest_idx on public.harvest_expenses(user_id, harvest_id);
create index expenses_owner_created_idx on public.harvest_expenses(user_id, created_at, id);

create function public.guard_harvest_expense_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    if NEW.published_at is not null then
      NEW.published_at := NEW.created_at;
    end if;
  else
    if OLD.published_at is not null and clock_timestamp() >= OLD.published_at + interval '7 days' then
      raise exception 'Pengeluaran terkunci: batas edit 7 hari telah berakhir.' using errcode = 'P0001';
    end if;
    if NEW.id is distinct from OLD.id or NEW.user_id is distinct from OLD.user_id
      or NEW.harvest_id is distinct from OLD.harvest_id or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Identitas dan kelompok pengeluaran tidak dapat diubah.' using errcode = 'P0001';
    end if;
    if OLD.published_at is not null and NEW.published_at is distinct from OLD.published_at then
      raise exception 'Waktu publikasi pengeluaran tidak dapat diubah.' using errcode = 'P0001';
    end if;
    if OLD.published_at is null and NEW.published_at is not null then
      NEW.published_at := clock_timestamp();
    end if;
    NEW.updated_at := clock_timestamp();
  end if;
  return NEW;
end;
$$;

create trigger guard_harvest_expense_write before insert or update on public.harvest_expenses
for each row execute function public.guard_harvest_expense_write();

alter table public.harvest_expenses enable row level security;
create policy expenses_select_owner on public.harvest_expenses for select to authenticated using ((select auth.uid()) = user_id);
create policy expenses_insert_owner on public.harvest_expenses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy expenses_update_owner on public.harvest_expenses for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.harvest_expenses from public, anon, authenticated;
grant select, insert, update on public.harvest_expenses to authenticated;
revoke all on function public.guard_harvest_expense_write() from public, anon, authenticated;

commit;
