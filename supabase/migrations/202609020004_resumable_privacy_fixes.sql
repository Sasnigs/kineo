-- Preserve deletion recovery independently of auth/account rows and atomically
-- return an export before its one-time payload is cleared.

-- Migration 002 already detached deletion jobs from account-row cascading.
alter table kineo_private.deletion_jobs
  add column completed_at timestamptz;

create or replace function public.kineo_consume_export_for_account(
  p_account_id uuid,
  p_job_id uuid,
  p_download_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  select export_payload into payload
  from kineo_private.export_jobs
  where id = p_job_id
    and account_id = p_account_id
    and status = 'ready'
    and expires_at > clock_timestamp()
    and download_token_hash = p_download_token_hash
  for update;

  if payload is null then
    raise exception using errcode = '28000', message = 'export_unavailable';
  end if;

  update kineo_private.export_jobs
  set status = 'consumed',
      consumed_at = clock_timestamp(),
      download_token_consumed_at = clock_timestamp(),
      export_payload = null,
      updated_at = clock_timestamp()
  where id = p_job_id;

  return payload;
end;
$$;

create or replace function public.kineo_complete_deletion(
  p_job_id uuid,
  p_resume_token_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update kineo_private.deletion_jobs
  set status = 'complete',
      completed_at = coalesce(completed_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where id = p_job_id and resume_token_hash = p_resume_token_hash
$$;

revoke all on function public.kineo_consume_export_for_account(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.kineo_complete_deletion(uuid, text)
  from public, anon, authenticated;
grant execute on function public.kineo_consume_export_for_account(uuid, uuid, text)
  to service_role;
grant execute on function public.kineo_complete_deletion(uuid, text)
  to service_role;
