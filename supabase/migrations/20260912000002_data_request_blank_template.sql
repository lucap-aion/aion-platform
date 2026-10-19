-- ==============================|| THE DATA REQUEST WAS ANOTHER CLIENT'S FILE ||============================== --
-- The workbook registered as the `data_request` template is the one the FIRST house filled
-- in and sent back, and build-collateral only ever swapped three strings in it. Everything
-- else went out untouched, to every prospect:
--
--   * their segment revenues, units sold and average prices (Data!B9:C25, F9:G25)
--   * their COGS ratio per sub-category, and the sub-category names (Data!A29:G30)
--   * the volumes and revenues in each price band
--   * their answers on group payment structure and on their insurance broker
--     ("Payment from Chubb goes to the EU legal entity", "Yes AON, but not covering this
--     type of insurance")
--   * the Microsoft sensitivity labels their tenant stamped on the file — "Yellow Data -
--     EMEA", with the originating SiteId, in docProps/custom.xml
--
-- Nobody noticed because none of it is wrong-looking: the file is a plausible data request,
-- and the two cells anyone checks (legal entity, address) are the two that were swapped.
-- Confirmed on dev on 2026-09-12 by generating the workbook for another prospect and
-- reading the cells back out; the reader in build-collateral (`read_data_request`) then
-- extracted that house's two segments from it as if the prospect had declared them.
--
-- The fix is a blank template, produced by scripts/blank-data-request-template.py: same
-- questions, same structure, same formatting, same formulas, no answers. The three cells
-- that are filled per brand now hold TOKENS instead of the first house's details, so a
-- slot that stops matching after a revision of the workbook goes out as
-- "{{BRAND_LEGAL_NAME}}" — loud — instead of as another client's legal entity.
--
-- The original stays in the bucket. It is the only copy of what that house actually
-- declared, it is referenced by their own business case, and it is not deleted here.
-- It is simply no longer what AION sends out.

update public.deck_templates
   set storage_path = 'templates/AION_Data_Request_Pilot_Blank.xlsx',
       text_slots = jsonb_build_array(
         jsonb_build_object('find', '{{BRAND_LEGAL_NAME}}', 'replace_with', '{{BRAND_LEGAL_NAME}}',
                            'note', 'the entity the pilot is contracted with — brands.legal_name'),
         jsonb_build_object('find', '{{BRAND_ADDRESS}}', 'replace_with', '{{BRAND_ADDRESS}}',
                            'note', 'brands.registered_address, falling back to the composed HQ address'),
         jsonb_build_object('find', '{{BRAND_FOCUS}}', 'replace_with', '{{BRAND_FOCUS}}',
                            'note', 'brands.product_focus — which categories the pilot covers')
       )
 where key = 'data_request'
   -- Only a row still pointing at the filled original. A project that has already been
   -- corrected, or that registered its own workbook, is left alone.
   and storage_path = 'templates/AION_Data_Request_Pilot.xlsx';

-- A project built from these migrations alone has no row at all: 20260910000001 seeds one,
-- and this makes sure that seed names the blank workbook too.
insert into public.deck_templates (key, name, kind, storage_path, text_slots)
select 'data_request', 'AION data request (pilot)', 'data_request',
       'templates/AION_Data_Request_Pilot_Blank.xlsx',
       jsonb_build_array(
         jsonb_build_object('find', '{{BRAND_LEGAL_NAME}}', 'replace_with', '{{BRAND_LEGAL_NAME}}'),
         jsonb_build_object('find', '{{BRAND_ADDRESS}}', 'replace_with', '{{BRAND_ADDRESS}}'),
         jsonb_build_object('find', '{{BRAND_FOCUS}}', 'replace_with', '{{BRAND_FOCUS}}')
       )
on conflict (key) do nothing;
