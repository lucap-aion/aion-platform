-- Capture the actual outcome of each Chubb upload/download attempt so the
-- admin home can surface success/failure without relying on email.
--
-- upload_status values:
--   'pending'        — file generated, not yet attempted
--   'success'        — SFTP upload (outbound) or download (inbound) succeeded
--   'failed'         — network operation failed; upload_error has the message
--   'not_applicable' — chat-generated artifact that never touches Chubb SFTP
--   'unknown'        — pre-migration rows where we can't tell

alter table public.reports
  add column if not exists upload_status   text     default 'pending',
  add column if not exists upload_error    text,
  add column if not exists upload_attempts integer  default 0,
  add column if not exists row_count       integer;

-- Backfill existing rows
update public.reports
   set upload_status = case
       when source = 'ai_chat'                                then 'not_applicable'
       when uploaded_to_chubb_at is not null                  then 'success'
       when uploaded_to_chubb is true                         then 'success'
       else 'unknown'
   end
 where upload_status = 'pending';

create index if not exists reports_status_brand_created_idx
  on public.reports (upload_status, brand_id, created_at desc);

comment on column public.reports.upload_status   is
  'pending | success | failed | not_applicable | unknown';
comment on column public.reports.upload_error    is
  'Error message from the SFTP attempt when upload_status = failed';
comment on column public.reports.upload_attempts is
  'How many times we tried the SFTP operation (0 if never attempted)';
comment on column public.reports.row_count       is
  'Number of data rows in the generated file (excluding the header).';
