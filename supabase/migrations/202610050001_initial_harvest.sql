-- PostgreSQL / Supabase. Auth users are managed by Supabase Auth.
begin;

create table public.harvests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 120),
  harvest_date date not null check (harvest_date >= date '1900-01-01'),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.spks (
  id uuid primary key default gen_random_uuid(),
  harvest_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id),
  company_name text not null check (length(trim(company_name)) between 1 and 160),
  delivery_date date not null check (delivery_date >= date '1900-01-01'),
  bunch_count integer not null check (bunch_count between 1 and 1000000000),
  first_weight numeric(12,2) not null check (first_weight > 0 and first_weight <= 1000000),
  second_weight numeric(12,2) not null check (second_weight >= 0 and second_weight < first_weight),
  deduction_kg numeric(12,2) not null check (deduction_kg >= 0 and deduction_kg <= first_weight - second_weight),
  price_per_kg numeric(12,2) not null check (price_per_kg > 0 and price_per_kg <= 1000000),
  gross_weight numeric(12,2) generated always as (first_weight - second_weight) stored,
  net_weight numeric(12,2) generated always as (first_weight - second_weight - deduction_kg) stored,
  deduction_percent numeric(5,2) generated always as (round(deduction_kg / nullif(first_weight - second_weight, 0) * 100, 2)) stored,
  total_income numeric(22,2) generated always as (round((first_weight - second_weight - deduction_kg) * price_per_kg, 2)) stored,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spks_harvest_owner_fk foreign key (harvest_id, user_id) references public.harvests(id, user_id)
);

create index harvests_owner_date_idx on public.harvests(user_id, harvest_date desc);
create index spks_owner_harvest_idx on public.spks(user_id, harvest_id);

create function public.guard_spk_write() returns trigger
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
      raise exception 'SPK terkunci: batas edit 7 hari telah berakhir.' using errcode = 'P0001';
    end if;
    if NEW.id is distinct from OLD.id or NEW.user_id is distinct from OLD.user_id
      or NEW.harvest_id is distinct from OLD.harvest_id or NEW.created_at is distinct from OLD.created_at then
      raise exception 'Identitas dan kelompok SPK tidak dapat diubah.' using errcode = 'P0001';
    end if;
    if OLD.published_at is not null and NEW.published_at is distinct from OLD.published_at then
      raise exception 'Waktu publikasi SPK tidak dapat diubah.' using errcode = 'P0001';
    end if;
    if OLD.published_at is null and NEW.published_at is not null then
      NEW.published_at := clock_timestamp();
    end if;
    NEW.updated_at := clock_timestamp();
  end if;
  return NEW;
end;
$$;

create trigger guard_spk_write before insert or update on public.spks
for each row execute function public.guard_spk_write();

alter table public.harvests enable row level security;
alter table public.spks enable row level security;

create policy harvests_select_owner on public.harvests for select to authenticated using ((select auth.uid()) = user_id);
create policy harvests_insert_owner on public.harvests for insert to authenticated with check ((select auth.uid()) = user_id);
create policy spks_select_owner on public.spks for select to authenticated using ((select auth.uid()) = user_id);
create policy spks_insert_owner on public.spks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy spks_update_owner on public.spks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- No delete or harvest update permissions, so locked SPKs cannot be bypassed.
revoke all on public.harvests, public.spks from anon, authenticated;
grant select, insert on public.harvests to authenticated;
grant select, insert, update on public.spks to authenticated;
revoke all on function public.guard_spk_write() from public, anon, authenticated;

commit;
