begin;
create or replace function public.save_financial_record(p_kind text, p_fields jsonb, p_request_key uuid,
  p_id uuid default null, p_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare payload jsonb; previous public.financial_requests; result jsonb;
  s public.spks; e public.harvest_expenses; c public.cash_expenses; h public.harvests;
  inserted integer; published timestamptz;
begin
  perform public.finance_lock_owner();
  if auth.uid() is null or p_request_key is null then raise exception 'Sesi atau kunci permintaan tidak valid.' using errcode='42501'; end if;
  if p_kind not in ('harvest','spk','harvest_expense','garden','other','savings','investment','savings_expense','investment_expense','other_income') then raise exception 'Kategori tidak valid.' using errcode='22023'; end if;
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
      insert into public.harvest_expenses(user_id,harvest_id,first_weight,second_weight,wage_per_kg,driver_cost,published_at,account_id)
      values(auth.uid(),e.harvest_id,e.first_weight,e.second_weight,e.wage_per_kg,e.driver_cost,published,e.account_id) returning * into e;
    else
      update public.harvest_expenses set first_weight=e.first_weight,second_weight=e.second_weight,wage_per_kg=e.wage_per_kg,
        driver_cost=e.driver_cost,account_id=e.account_id,published_at=coalesce(published_at,published) where id=p_id and user_id=auth.uid() and version=p_version returning * into e;
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
    raise exception 'Data sudah berubah atau tidak tersedia. Tutup formulir dan muat ulang sebelum mengedit.' using errcode='40001';
  end if;
  update public.financial_requests set response=result where user_id=auth.uid() and request_key=p_request_key;
  return result;
end; $$;

commit;
