-- A generated client is a client, and should say so.
--
-- generate_brand_demo_data has always inserted its clients with role NULL,
-- while a real one carries 'customer' — Roberto Coin's 339 do. Nothing ever
-- meant anything by that NULL: the rows are visible, they have registered_at,
-- they are clients in every other respect. It is an omission in one INSERT that
-- has been copied forward ever since.
--
-- It has cost three separate bugs in one day:
--   • is_brand_staff read "role is not 'customer'", so forty generated clients
--     of every demo brand qualified as STAFF and could read the boutique's
--     notes about them (20260915000003).
--   • visit-note looked for clients with role = 'customer' and matched nobody,
--     in exactly the accounts a demo runs in.
--   • the Customers page counts its segment chips from an RPC that allows NULL
--     and lists rows with .eq('role','customer'), so Prada showed "320" above
--     a table saying "No customers found".
--
-- Ten places in the client filter on role = 'customer' and two on
-- "role is null or role = 'customer'". Rather than pick the losing side of that
-- argument in ten files, the data is made to agree with the majority and with
-- the one live brand, and both generators are fixed so it stops recurring.

update public.profiles
   set role = 'customer'
 where role is null
   and brand_id is not null;

-- ── The base generator ───────────────────────────────────────────────────────
-- Only the one INSERT changes; everything else in the function is as it was.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc
   where proname = 'generate_brand_demo_data'
     and pronargs = 4
   limit 1;
  if v_src is null then
    raise notice 'generate_brand_demo_data not found — nothing to patch';
    return;
  end if;
  if position('p_brand_id, null, ''active''' in v_src) = 0 then
    raise notice 'generate_brand_demo_data no longer writes a null role — leaving it alone';
    return;
  end if;
  v_src := replace(v_src, 'p_brand_id, null, ''active''', 'p_brand_id, ''customer'', ''active''');
  execute format(
    'create or replace function public.generate_brand_demo_data(
       p_brand_id bigint, p_customers integer default 40, p_policies integer default 60,
       p_avg_ticket numeric default null)
     returns jsonb language plpgsql security definer set search_path = public as %L',
    v_src);
end $$;
