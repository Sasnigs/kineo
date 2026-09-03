create or replace function public.kineo_prepare_export_for_account(
  p_account_id uuid,
  p_download_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
  payload jsonb;
begin
  if not exists (
    select 1 from kineo_private.accounts
    where id = p_account_id and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'account_unavailable';
  end if;

  payload := jsonb_build_object(
    'formatVersion', 'kineo-export-v1',
    'generatedAt', clock_timestamp(),
    'account', (
      select to_jsonb(account_row) - 'id'
      from kineo_private.accounts account_row
      where id = p_account_id
    ),
    'legalAcceptances', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.legal_acceptances row_value
      where account_id = p_account_id
    ),
    'profile', (
      select to_jsonb(row_value) - 'account_id'
      from kineo_private.user_profiles row_value
      where account_id = p_account_id
    ),
    'reminderSettings', (
      select to_jsonb(row_value) - 'account_id'
      from kineo_private.reminder_settings row_value
      where account_id = p_account_id
    ),
    'checkIns', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.check_ins row_value
      where account_id = p_account_id
    ),
    'checkInEntries', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.check_in_entries row_value
      where account_id = p_account_id
    ),
    'safetyEvents', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.safety_events row_value
      where account_id = p_account_id
    ),
    'routineSessions', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.routine_sessions row_value
      where account_id = p_account_id
    ),
    'routineEvents', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.routine_events row_value
      where account_id = p_account_id
    ),
    'feedback', (
      select coalesce(jsonb_agg(to_jsonb(row_value) - 'account_id'), '[]'::jsonb)
      from kineo_private.area_feedback row_value
      where account_id = p_account_id
    )
  );

  insert into kineo_private.export_jobs(
    account_id, status, download_token_hash, export_payload, expires_at
  ) values (
    p_account_id, 'ready', p_download_token_hash, payload, p_expires_at
  ) returning id into job_id;

  return jsonb_build_object(
    'jobId', job_id,
    'status', 'ready',
    'expiresAtMilliseconds',
      floor(extract(epoch from p_expires_at) * 1000)::bigint
  );
end;
$$;

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
  update kineo_private.export_jobs
  set status = 'consumed',
      consumed_at = clock_timestamp(),
      download_token_consumed_at = clock_timestamp(),
      export_payload = null,
      updated_at = clock_timestamp()
  where id = p_job_id
    and account_id = p_account_id
    and status = 'ready'
    and expires_at > clock_timestamp()
    and download_token_hash = p_download_token_hash
  returning export_payload into payload;

  if payload is null then
    raise exception using errcode = '28000', message = 'export_unavailable';
  end if;
  return payload;
end;
$$;

create or replace function public.kineo_begin_deletion_for_account(
  p_account_id uuid,
  p_resume_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_id uuid;
begin
  update kineo_private.accounts
  set status = 'deleting', updated_at = clock_timestamp()
  where id = p_account_id;
  if not found then
    raise exception using errcode = '28000', message = 'account_unavailable';
  end if;
  update kineo_private.device_installations
  set revoked_at = coalesce(revoked_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where account_id = p_account_id;
  insert into kineo_private.deletion_jobs(
    account_id, status, resume_token_hash
  ) values (
    p_account_id, 'revokingAccess', p_resume_token_hash
  )
  on conflict (account_id) do update
  set resume_token_hash = excluded.resume_token_hash,
      updated_at = clock_timestamp()
  returning id into job_id;
  return jsonb_build_object('jobId', job_id, 'status', 'revokingAccess');
end;
$$;

create or replace function public.kineo_deletion_job_by_token(
  p_job_id uuid,
  p_resume_token_hash text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'jobId', id,
    'accountId', account_id,
    'status', status
  )
  from kineo_private.deletion_jobs
  where id = p_job_id
    and resume_token_hash = p_resume_token_hash
$$;

create or replace function public.kineo_delete_domain_for_account(
  p_account_id uuid,
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update kineo_private.deletion_jobs
  set status = 'deletingData', updated_at = clock_timestamp()
  where id = p_job_id and account_id = p_account_id;
  if not found then
    raise exception using errcode = '28000', message = 'deletion_unavailable';
  end if;
  delete from kineo_private.accounts where id = p_account_id;
  update kineo_private.deletion_jobs
  set status = 'deletingAuth', updated_at = clock_timestamp()
  where id = p_job_id and account_id = p_account_id;
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
      resume_token_hash = null,
      updated_at = clock_timestamp()
  where id = p_job_id and resume_token_hash = p_resume_token_hash
$$;

revoke all on function public.kineo_prepare_export_for_account(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.kineo_consume_export_for_account(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.kineo_begin_deletion_for_account(uuid, text) from public, anon, authenticated;
revoke all on function public.kineo_deletion_job_by_token(uuid, text) from public, anon, authenticated;
revoke all on function public.kineo_delete_domain_for_account(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kineo_complete_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.kineo_prepare_export_for_account(uuid, text, timestamptz) to service_role;
grant execute on function public.kineo_consume_export_for_account(uuid, uuid, text) to service_role;
grant execute on function public.kineo_begin_deletion_for_account(uuid, text) to service_role;
grant execute on function public.kineo_deletion_job_by_token(uuid, text) to service_role;
grant execute on function public.kineo_delete_domain_for_account(uuid, uuid) to service_role;
grant execute on function public.kineo_complete_deletion(uuid, text) to service_role;
