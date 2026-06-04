-- Cover share tokens — customer generates an unguessable share URL for one
-- of their covers. Anyone with the link can see a read-only Passport view:
-- piece name + photo + composition + brand mark + cover dates + cert code.
-- Claim history is intentionally NOT exposed. Customer can revoke the
-- token at any time.

create table if not exists public.cover_share_tokens (
  token           uuid primary key default gen_random_uuid(),
  cover_id        bigint not null references public.policies(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete cascade,
  revoked         boolean not null default false,
  view_count      int not null default 0,
  last_viewed_at  timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists cover_share_tokens_cover_idx
  on public.cover_share_tokens (cover_id);
create index if not exists cover_share_tokens_owner_idx
  on public.cover_share_tokens (created_by);

alter table public.cover_share_tokens enable row level security;

grant select, insert, update, delete on public.cover_share_tokens to authenticated;
grant all on public.cover_share_tokens to service_role;

-- Customer owns tokens for their own covers.
drop policy if exists "cover_share_tokens: owner select" on public.cover_share_tokens;
create policy "cover_share_tokens: owner select"
  on public.cover_share_tokens for select to authenticated
  using (
    cover_id in (
      select id from public.policies where customer_id = public.get_my_profile_id()
    )
  );

drop policy if exists "cover_share_tokens: owner insert" on public.cover_share_tokens;
create policy "cover_share_tokens: owner insert"
  on public.cover_share_tokens for insert to authenticated
  with check (
    cover_id in (
      select id from public.policies where customer_id = public.get_my_profile_id()
    )
  );

drop policy if exists "cover_share_tokens: owner update" on public.cover_share_tokens;
create policy "cover_share_tokens: owner update"
  on public.cover_share_tokens for update to authenticated
  using (
    cover_id in (
      select id from public.policies where customer_id = public.get_my_profile_id()
    )
  )
  with check (
    cover_id in (
      select id from public.policies where customer_id = public.get_my_profile_id()
    )
  );

drop policy if exists "cover_share_tokens: owner delete" on public.cover_share_tokens;
create policy "cover_share_tokens: owner delete"
  on public.cover_share_tokens for delete to authenticated
  using (
    cover_id in (
      select id from public.policies where customer_id = public.get_my_profile_id()
    )
  );

-- Public read-only RPC. Anyone (including anon) with a valid token receives
-- a curated subset of the cover row — no claim history, no customer email,
-- no internal ids beyond the cert code (which is already on the printed
-- certificate). SECURITY DEFINER so it bypasses RLS in a controlled way,
-- but only ever returns rows where the token is valid + non-revoked.

create or replace function public.public_cover_share(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cover_id bigint;
  v_payload  jsonb;
begin
  select cover_id into v_cover_id
  from public.cover_share_tokens
  where token = p_token
    and revoked = false
  limit 1;

  if v_cover_id is null then
    return jsonb_build_object('error', 'invalid or revoked token');
  end if;

  select jsonb_build_object(
    'cover_id',         p.id,
    'cert_code',        'AION-' || lpad(p.id::text, 6, '0'),
    'start_date',       p.start_date,
    'expiration_date',  p.expiration_date,
    'status',           p.status,
    'selling_price',    p.selling_price,
    'customer_first_name', pr.first_name,
    'product', jsonb_build_object(
      'name',        cat.name,
      'picture',     cat.picture,
      'category',    cat.category,
      'collection',  cat.collection,
      'composition', cat.composition,
      'sku',         cat.sku
    ),
    'brand', jsonb_build_object(
      'name',      b.name,
      'logo_big',  b.logo_big,
      'logo_small', b.logo_small,
      'slug',      b.slug
    ),
    'shop', case when s.id is not null then
      jsonb_build_object('name', s.name, 'city', s.city, 'country', s.country)
      else null end
  ) into v_payload
  from public.policies p
  left join public.profiles  pr  on pr.id  = p.customer_id
  left join public.catalogues cat on cat.id = p.item_id
  left join public.brands     b   on b.id   = p.brand_id
  left join public.shops      s   on s.id   = p.shop_id
  where p.id = v_cover_id;

  -- Bump the view counter — best-effort, swallow errors so a bad write
  -- doesn't break a legitimate read.
  begin
    update public.cover_share_tokens
       set view_count    = view_count + 1,
           last_viewed_at = now()
     where token = p_token;
  exception when others then
    -- ignore
    null;
  end;

  return v_payload;
end;
$$;

revoke all on function public.public_cover_share(uuid) from public;
grant execute on function public.public_cover_share(uuid) to anon, authenticated;
