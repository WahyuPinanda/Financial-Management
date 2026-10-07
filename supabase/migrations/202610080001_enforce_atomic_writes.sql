begin;
-- All application writes must pass through the versioned, idempotent RPC.
-- RLS alone cannot stop an owner from bypassing If-Match through PostgREST.
revoke insert, update, delete on public.harvests, public.spks,
  public.harvest_expenses, public.cash_expenses from public, anon, authenticated;
commit;
