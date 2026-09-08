-- Export all personal product records, never Auth credential/token columns.
create or replace function public.kineo_prepare_export_for_account(
  p_account_id uuid, p_download_token_hash text, p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job_id uuid;
  payload jsonb;
  records jsonb;
  mapping record;
  maximum_export_lifetime constant interval := interval '15 minutes';
begin
  perform 1 from kineo_private.accounts where id = p_account_id and status = 'active' for update;
  if not found then raise exception using errcode = '55000', message = 'account_unavailable'; end if;
  if p_download_token_hash !~ '^[0-9a-f]{64}$' or p_download_token_hash is null or
    p_expires_at is null or p_expires_at <= clock_timestamp() or
    p_expires_at > clock_timestamp() + maximum_export_lifetime
  then raise exception using errcode = '22023', message = 'invalid_export'; end if;
  payload := jsonb_build_object(
    'formatVersion', 'kineo-export-v1', 'generatedAt', clock_timestamp(),
    'account', (select to_jsonb(value) from kineo_private.accounts value where id = p_account_id),
    'identity', (select jsonb_build_object('id', id, 'email', email, 'createdAt', created_at,
      'lastSignInAt', last_sign_in_at, 'providers', (select coalesce(jsonb_agg(jsonb_build_object(
        'provider', provider, 'createdAt', created_at, 'lastSignInAt', last_sign_in_at)), '[]'::jsonb)
        from auth.identities where user_id = p_account_id)) from auth.users where id = p_account_id),
    'profile', (select to_jsonb(value) - 'account_id' from kineo_private.user_profiles value where account_id = p_account_id),
    'reminderSettings', (select to_jsonb(value) - 'account_id' from kineo_private.reminder_settings value where account_id = p_account_id)
  );
  -- Identifiers come only from this fixed allowlist, never request data.
  for mapping in select * from (values
    ('deviceInstallations', 'device_installations'), ('legalAcceptances', 'legal_acceptances'),
    ('checkIns', 'check_ins'), ('checkInEntries', 'check_in_entries'),
    ('attentionStates', 'attention_states'), ('safetyEvents', 'safety_events'),
    ('pauseTodayEvents', 'pause_today_events'), ('selectionDecisions', 'selection_decisions'),
    ('decisionAreaInputs', 'decision_area_inputs'), ('decisionReasonRecords', 'decision_reason_records'),
    ('routineSessions', 'routine_sessions'), ('routineEvents', 'routine_events'),
    ('feedbackSubmissions', 'feedback_submissions'), ('feedback', 'area_feedback')
  ) as allowed(export_key, table_name) loop
    execute format('select coalesce(jsonb_agg(to_jsonb(value) - ''account_id''), ''[]''::jsonb) from kineo_private.%I value where account_id = $1', mapping.table_name)
      into records using p_account_id;
    payload := payload || jsonb_build_object(mapping.export_key, records);
  end loop;
  insert into kineo_private.export_jobs(account_id, status, download_token_hash, export_payload, expires_at)
    values (p_account_id, 'ready', p_download_token_hash, payload, p_expires_at) returning id into job_id;
  return jsonb_build_object('jobId', job_id, 'status', 'ready',
    'expiresAtMilliseconds', floor(extract(epoch from p_expires_at) * 1000)::bigint);
end;
$$;
revoke all on function public.kineo_prepare_export_for_account(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.kineo_prepare_export_for_account(uuid, text, timestamptz) to service_role;

create function kineo_private.expire_export_payloads()
returns void language sql security definer set search_path = '' as $$
  update kineo_private.export_jobs set export_payload = null, download_token_hash = null,
    status = case when status in ('ready', 'pending') then 'expired' else status end,
    updated_at = clock_timestamp()
  where expires_at <= clock_timestamp() and (export_payload is not null or download_token_hash is not null)
$$;
revoke all on function kineo_private.expire_export_payloads() from public, anon, authenticated, service_role;

-- Authorization expires exactly at expires_at. The private archive is erased
-- within the following minute even if the account never opens the app again.
create extension if not exists pg_cron;
select cron.schedule('kineo-expire-exports', '* * * * *', 'select kineo_private.expire_export_payloads()');

create or replace function kineo_private.retain_reset_account_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_kind = 'history' and new.operation = 'reset' then
    new.payload := new.payload || jsonb_build_object('attentionStates',
      (select coalesce(jsonb_agg(jsonb_build_object('area', area,
        'updatedAtMilliseconds', floor(extract(epoch from updated_at) * 1000)::bigint) order by area), '[]'::jsonb)
        from kineo_private.attention_states where account_id = new.account_id));
  end if;
  return new;
end;
$$;
drop trigger if exists retain_reset_account_state on kineo_private.account_changes;
create trigger retain_reset_account_state before insert on kineo_private.account_changes
for each row execute function kineo_private.retain_reset_account_state();
