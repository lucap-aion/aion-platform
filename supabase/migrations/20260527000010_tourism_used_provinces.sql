-- Provinces that at least one shop maps to, via shops.city -> comune_province.
-- Used by tourism-ingest to skip provinces with no policies, keeping the
-- ISTAT fetch under the Edge Function's 150s walltime.

create or replace function public.tourism_used_provinces()
returns table (area_code text, province text, region text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  return query
    select distinct cp.area_code, cp.province, cp.region
    from public.comune_province cp
    where exists (
      select 1 from public.shops s
      where public.tourism_norm(s.city) = cp.comune_norm
    );
end;
$$;

-- Caller authentication is handled by the Edge Function (service-role bypass
-- or admin JWT); the RPC stays callable by service_role only.
revoke all on function public.tourism_used_provinces() from public;
grant execute on function public.tourism_used_provinces() to service_role;
