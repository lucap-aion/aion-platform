-- What the assistant consumes, per brand, per turn.
--
-- Giulio, 2026-11-09: price Digital Team as "included up to N tokens, then €500/month for
-- 10k tokens", and the same mechanism for storage. Nothing recorded a token until now, so no
-- price could be checked against what a brand actually uses, and no quota could be enforced.
-- One row per model per answered turn (the main model, and the small one that writes the
-- follow-up suggestions), written by the function with the service role.

create table if not exists public.assistant_usage (
  id                 bigserial primary key,
  created_at         timestamptz not null default now(),
  brand_id           bigint references public.brands(id) on delete cascade,
  profile_id         uuid,
  is_admin           boolean not null default false,
  chat_id            text,
  model              text not null,
  model_calls        int not null default 0,
  tool_calls         int not null default 0,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0
);
create index if not exists assistant_usage_brand_month_idx on public.assistant_usage (brand_id, created_at);

alter table public.assistant_usage enable row level security;
grant select on public.assistant_usage to authenticated;
grant all on public.assistant_usage to service_role;
grant usage, select on sequence public.assistant_usage_id_seq to service_role;

drop policy if exists "admin: read assistant_usage" on public.assistant_usage;
create policy "admin: read assistant_usage" on public.assistant_usage for select to authenticated
  using (public.get_my_role() = 'admin');

-- A month per brand, as a price would be read: questions asked, and tokens by kind. A
-- "question" is one answered turn of the main model. security_invoker so the table's own
-- policy (admins only) decides who sees it.
create or replace view public.assistant_usage_monthly with (security_invoker = true) as
select
  u.brand_id,
  b.name as brand_name,
  date_trunc('month', u.created_at at time zone 'Europe/Rome')::date as month,
  count(*) filter (where u.model not ilike '%haiku%')       as questions,
  sum(u.input_tokens)       as input_tokens,
  sum(u.output_tokens)      as output_tokens,
  sum(u.cache_read_tokens)  as cache_read_tokens,
  sum(u.cache_write_tokens) as cache_write_tokens,
  sum(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens) as total_tokens
from public.assistant_usage u
left join public.brands b on b.id = u.brand_id
group by 1, 2, 3;
grant select on public.assistant_usage_monthly to authenticated;
