begin;

-- Keep historical weights and amounts. Only subsequent writes use manual weight.
alter table public.harvest_expenses
  alter column overall_weight drop expression,
  alter column overall_weight set not null,
  add constraint harvest_expenses_manual_weight_check
    check (overall_weight > 0 and overall_weight <= 1000000
      and overall_weight <= first_weight - second_weight),
  alter column labor_cost set expression as (round(overall_weight * wage_per_kg, 2)),
  alter column total_expense set expression as (round(overall_weight * wage_per_kg, 2) + driver_cost);

-- Older clients may omit the new input on INSERT during rollout. Never replace
-- an existing manual weight on UPDATE when such a client omits the field.
create function public.fill_legacy_harvest_expense_weight() returns trigger
language plpgsql set search_path = '' as $$
begin
  if NEW.overall_weight is null then
    NEW.overall_weight := NEW.first_weight - NEW.second_weight;
  end if;
  return NEW;
end;
$$;
revoke all on function public.fill_legacy_harvest_expense_weight() from public, anon, authenticated;
create trigger fill_legacy_harvest_expense_weight before insert on public.harvest_expenses
for each row execute function public.fill_legacy_harvest_expense_weight();

-- Replace the private implementation; the public MFA gate and RPC grants remain.
create or replace function public.save_financial_record_without_mfa(
  p_kind text, p_fields jsonb, p_request_key uuid,
  p_id uuid default null, p_version integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  payload jsonb; previous public.financial_requests; result jsonb;
  s public.spks; e public.harvest_expenses; c public.cash_expenses; h public.harvests;
  inserted integer; published timestamptz; manual_weight numeric;
begin
  perform public.finance_lock_owner();
  if auth.uid() is null or p_request_key is null then
    raise exception 'Sesi atau kunci permintaan tidak valid.' using errcode='42501';
  end if;
  if p_kind not in ('harvest','spk','harvest_expense','garden','other','savings','investment','savings_expense','investment_expense','other_income') then
    raise exception 'Kategori tidak valid.' using errcode='22023';
  end if;
  if p_id is not null and (p_version is null or p_version < 1 or p_kind='harvest') then
    raise exception 'Versi data wajib diisi.' using errcode='22023';
  end if;
  if p_kind='harvest_expense' and p_fields ? 'overall_weight' then
    if jsonb_typeof(p_fields->'overall_weight') is distinct from 'number' then
      raise exception 'Total Overall Weight wajib berupa angka.' using errcode='22023';
    end if;
    manual_weight := (p_fields->>'overall_weight')::numeric;
    if manual_weight <= 0 or manual_weight > 1000000 or manual_weight <> round(manual_weight,2) then
      raise exception 'Total Overall Weight harus positif, maksimal 1.000.000 kg dan 2 angka desimal.' using errcode='22023';
    end if;
  end if;
  payload := jsonb_build_object('kind',p_kind,'fields',p_fields,'id',p_id,'version',p_version);
  insert into public.financial_requests(user_id,request_key,payload)
    values(auth.uid(),p_request_key,payload) on conflict do nothing;
  get diagnostics inserted = ROW_COUNT;
  if inserted=0 then
    select * into previous from public.financial_requests
      where user_id=auth.uid() and request_key=p_request_key for update;
    if previous.payload is distinct from payload then
      raise exception 'Kunci permintaan telah dipakai. Muat ulang data sebelum menyimpan.' using errcode='P0001';
    end if;
    return previous.response;
  end if;
  published := case when (p_fields->>'publish')::boolean then clock_timestamp() else null end;
  if p_kind='harvest' then
    insert into public.harvests(name,harvest_date,user_id)
      values(p_fields->>'name',(p_fields->>'harvest_date')::date,auth.uid()) returning * into h;
    result := to_jsonb(h) || jsonb_build_object('spks','[]'::jsonb,'expenses','[]'::jsonb);
  elsif p_kind='spk' then
    s := jsonb_populate_record(null::public.spks,p_fields);
    if p_id is null then
      insert into public.spks(user_id,harvest_id,company_name,delivery_date,bunch_count,first_weight,second_weight,deduction_kg,price_per_kg,published_at,account_id)
        values(auth.uid(),s.harvest_id,s.company_name,s.delivery_date,s.bunch_count,s.first_weight,s.second_weight,s.deduction_kg,s.price_per_kg,published,s.account_id) returning * into s;
    else
      update public.spks set company_name=s.company_name,delivery_date=s.delivery_date,bunch_count=s.bunch_count,first_weight=s.first_weight,
        second_weight=s.second_weight,deduction_kg=s.deduction_kg,price_per_kg=s.price_per_kg,account_id=s.account_id,published_at=coalesce(published_at,published)
        where id=p_id and user_id=auth.uid() and version=p_version returning * into s;
    end if;
    result := to_jsonb(s);
  elsif p_kind='harvest_expense' then
    e := jsonb_populate_record(null::public.harvest_expenses,p_fields);
    if p_id is null then
      insert into public.harvest_expenses(user_id,harvest_id,first_weight,second_weight,overall_weight,wage_per_kg,driver_cost,published_at,account_id)
        values(auth.uid(),e.harvest_id,e.first_weight,e.second_weight,e.overall_weight,e.wage_per_kg,e.driver_cost,published,e.account_id) returning * into e;
    else
      update public.harvest_expenses set first_weight=e.first_weight,second_weight=e.second_weight,
        overall_weight=coalesce(e.overall_weight,overall_weight),wage_per_kg=e.wage_per_kg,
        driver_cost=e.driver_cost,account_id=e.account_id,published_at=coalesce(published_at,published)
        where id=p_id and user_id=auth.uid() and version=p_version returning * into e;
    end if;
    result := to_jsonb(e);
  else
    c := jsonb_populate_record(null::public.cash_expenses,p_fields);
    if p_id is null then
      insert into public.cash_expenses(user_id,category,expense_date,items,published_at,account_id,destination_account_id)
        values(auth.uid(),p_kind,c.expense_date,c.items,published,c.account_id,c.destination_account_id) returning * into c;
    else
      update public.cash_expenses set expense_date=c.expense_date,items=c.items,account_id=c.account_id,destination_account_id=c.destination_account_id,published_at=coalesce(published_at,published)
        where id=p_id and user_id=auth.uid() and category=p_kind and version=p_version returning * into c;
    end if;
    result := to_jsonb(c);
  end if;
  if result is null or result->>'id' is null then
    raise exception 'Data sudah berubah atau tidak tersedia. Tutup formulir dan muat ulang sebelum mengedit.' using errcode='P0001';
  end if;
  update public.financial_requests set response=result
    where user_id=auth.uid() and request_key=p_request_key;
  return result;
end;
$$;

commit;
