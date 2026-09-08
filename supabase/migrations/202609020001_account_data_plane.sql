create extension if not exists pgcrypto with schema extensions;

create schema if not exists kineo_private;
revoke all on schema kineo_private from public, anon, authenticated;
grant usage on schema kineo_private to service_role;

create table kineo_private.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'deleting')),
  history_epoch bigint not null default 1 check (history_epoch >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table kineo_private.device_installations (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  app_version text not null check (length(app_version) > 0),
  platform_version text not null check (length(platform_version) > 0),
  sync_cursor bigint,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (account_id, id)
);

create table kineo_private.legal_acceptances (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  document_kind text not null check (document_kind in ('termsOfService', 'privacyPolicy')),
  document_version text not null check (length(document_version) > 0),
  locale text not null check (length(locale) > 0),
  accepted_at timestamptz not null,
  primary key (account_id, document_kind, document_version)
);

create table kineo_private.user_profiles (
  account_id uuid primary key references kineo_private.accounts(id) on delete cascade,
  version bigint not null default 1 check (version >= 1),
  onboarding_completed_at timestamptz,
  adult_acknowledged boolean not null default false,
  safety_boundary_version text,
  safety_acknowledged_at timestamptz,
  primary_area text check (primary_area in ('neck', 'upperMidBack', 'lowerBack')),
  secondary_area text check (secondary_area in ('neck', 'upperMidBack', 'lowerBack')),
  weekly_goal_days smallint not null default 3 check (weekly_goal_days between 1 and 7),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (secondary_area is null or secondary_area <> primary_area)
);

create table kineo_private.reminder_settings (
  account_id uuid primary key references kineo_private.accounts(id) on delete cascade,
  version bigint not null default 1 check (version >= 1),
  enabled boolean not null default false,
  window_start_minutes smallint check (window_start_minutes between 0 and 1439),
  window_end_minutes smallint check (window_end_minutes between 1 and 1440),
  time_zone_id text,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    not enabled or (
      window_start_minutes is not null and
      window_end_minutes is not null and
      window_end_minutes > window_start_minutes
    )
  )
);

create table kineo_private.check_ins (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  installation_id uuid not null,
  history_epoch bigint not null check (history_epoch >= 1),
  status text not null check (status in ('completed', 'blocked')),
  purpose text not null check (purpose in ('normal', 'attentionCorrection')),
  primary_area text not null check (primary_area in ('neck', 'upperMidBack', 'lowerBack')),
  secondary_area text check (secondary_area in ('neck', 'upperMidBack', 'lowerBack')),
  submitted_at timestamptz not null,
  local_day date not null,
  time_zone_id text not null,
  calendar_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, id),
  foreign key (account_id, installation_id)
    references kineo_private.device_installations(account_id, id),
  check (secondary_area is null or secondary_area <> primary_area)
);

create table kineo_private.check_in_entries (
  account_id uuid not null,
  id uuid not null,
  check_in_id uuid not null,
  area text not null check (area in ('neck', 'upperMidBack', 'lowerBack')),
  role text not null check (role in ('primary', 'secondary')),
  change_report text not null check (change_report in ('better', 'similar', 'worse')),
  movement_comfort text not null check (movement_comfort in ('limited', 'okay', 'good')),
  conditional_safety_answer text check (conditional_safety_answer in ('no', 'yes', 'notSure')),
  submitted_at timestamptz not null,
  primary key (account_id, id),
  unique (account_id, check_in_id, area),
  foreign key (account_id, check_in_id)
    references kineo_private.check_ins(account_id, id) on delete cascade,
  check (
    ((change_report = 'worse' or movement_comfort = 'limited') and conditional_safety_answer is not null) or
    ((change_report <> 'worse' and movement_comfort <> 'limited') and conditional_safety_answer is null)
  )
);

create table kineo_private.attention_states (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  area text not null check (area in ('neck', 'upperMidBack', 'lowerBack')),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null,
  primary key (account_id, area)
);

create table kineo_private.safety_events (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  area text not null check (area in ('neck', 'upperMidBack', 'lowerBack')),
  kind text not null check (kind in (
    'attentionEntered', 'attentionClearedReturnedToUsual',
    'attentionClearedCorrection', 'attentionReaffirmed',
    'attentionReaffirmedCorrection'
  )),
  source_check_in_entry_id uuid,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  primary key (account_id, id),
  foreign key (account_id, source_check_in_entry_id)
    references kineo_private.check_in_entries(account_id, id)
    on delete set null (source_check_in_entry_id)
);

create table kineo_private.pause_today_events (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  check_in_id uuid not null,
  chosen_at timestamptz not null,
  local_day date not null,
  primary key (account_id, id),
  unique (account_id, check_in_id),
  foreign key (account_id, check_in_id)
    references kineo_private.check_ins(account_id, id) on delete cascade
);

create table kineo_private.selection_decisions (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  check_in_id uuid not null,
  revision integer not null check (revision >= 1),
  rules_version text not null,
  catalog_version text not null,
  outcome text not null check (outcome in ('selected', 'contentUnavailable')),
  recommended_level text not null check (recommended_level in ('gentle', 'balanced', 'active')),
  selected_level text not null check (selected_level in ('gentle', 'balanced', 'active')),
  delivered_level text check (delivered_level in ('gentle', 'balanced', 'active')),
  duration_variant text not null check (duration_variant in ('quick', 'standard')),
  decision_payload jsonb not null check (jsonb_typeof(decision_payload) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, id),
  unique (account_id, check_in_id, revision),
  foreign key (account_id, check_in_id)
    references kineo_private.check_ins(account_id, id) on delete cascade
);

create table kineo_private.decision_area_inputs (
  account_id uuid not null,
  decision_id uuid not null,
  area text not null check (area in ('neck', 'upperMidBack', 'lowerBack')),
  role text not null check (role in ('primary', 'secondary')),
  input_payload jsonb not null check (jsonb_typeof(input_payload) = 'object'),
  primary key (account_id, decision_id, area),
  foreign key (account_id, decision_id)
    references kineo_private.selection_decisions(account_id, id) on delete cascade
);

create table kineo_private.decision_reason_records (
  account_id uuid not null,
  decision_id uuid not null,
  kind text not null check (kind in ('selection', 'presented')),
  position smallint not null check (position in (0, 1)),
  reason_code text not null check (length(reason_code) > 0),
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  primary key (account_id, decision_id, kind, position),
  foreign key (account_id, decision_id)
    references kineo_private.selection_decisions(account_id, id) on delete cascade
);

create table kineo_private.routine_sessions (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  decision_id uuid not null,
  check_in_id uuid not null,
  owner_installation_id uuid not null,
  version bigint not null default 1 check (version >= 1),
  status text not null check (status in (
    'prepared', 'inProgress', 'paused', 'completed',
    'stopped', 'safetyStopped', 'abandoned'
  )),
  routine_snapshot jsonb not null check (jsonb_typeof(routine_snapshot) = 'object'),
  snapshot_checksum text not null check (snapshot_checksum ~ '^[0-9a-f]{64}$'),
  current_step_index integer not null default 0 check (current_step_index >= 0),
  step_elapsed_ms bigint not null default 0 check (step_elapsed_ms >= 0),
  started_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  primary key (account_id, id),
  unique (account_id, decision_id),
  foreign key (account_id, decision_id)
    references kineo_private.selection_decisions(account_id, id),
  foreign key (account_id, check_in_id)
    references kineo_private.check_ins(account_id, id),
  foreign key (account_id, owner_installation_id)
    references kineo_private.device_installations(account_id, id),
  check (
    (status in ('completed', 'stopped', 'safetyStopped', 'abandoned') and ended_at is not null) or
    (status in ('prepared', 'inProgress', 'paused') and ended_at is null)
  )
);

create unique index one_unfinished_routine_per_account
  on kineo_private.routine_sessions(account_id)
  where status in ('prepared', 'inProgress', 'paused');

create table kineo_private.routine_events (
  account_id uuid not null,
  id uuid not null,
  routine_session_id uuid not null,
  sequence_number integer not null check (sequence_number >= 1),
  kind text not null,
  event_payload jsonb not null check (jsonb_typeof(event_payload) = 'object'),
  occurred_at timestamptz not null,
  primary key (account_id, id),
  unique (account_id, routine_session_id, sequence_number),
  foreign key (account_id, routine_session_id)
    references kineo_private.routine_sessions(account_id, id) on delete cascade
);

create table kineo_private.feedback_submissions (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  id uuid not null,
  routine_session_id uuid not null,
  submitted_at timestamptz not null,
  primary key (account_id, id),
  unique (account_id, routine_session_id),
  foreign key (account_id, routine_session_id)
    references kineo_private.routine_sessions(account_id, id) on delete cascade
);

create table kineo_private.area_feedback (
  account_id uuid not null,
  id uuid not null,
  feedback_submission_id uuid not null,
  area text not null check (area in ('neck', 'upperMidBack', 'lowerBack')),
  response text not null check (response in ('better', 'same', 'worse')),
  submitted_at timestamptz not null,
  primary key (account_id, id),
  unique (account_id, feedback_submission_id, area),
  foreign key (account_id, feedback_submission_id)
    references kineo_private.feedback_submissions(account_id, id) on delete cascade
);

create table kineo_private.mutation_receipts (
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  mutation_id uuid not null,
  installation_id uuid not null,
  history_epoch bigint not null,
  command_kind text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  applied_at timestamptz not null default clock_timestamp(),
  primary key (account_id, mutation_id),
  foreign key (account_id, installation_id)
    references kineo_private.device_installations(account_id, id)
);

create table kineo_private.account_changes (
  sequence bigint generated always as identity primary key,
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  entity_kind text not null,
  entity_id text not null,
  operation text not null check (operation in ('upsert', 'delete', 'reset')),
  payload jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index account_changes_feed
  on kineo_private.account_changes(account_id, sequence);

create table kineo_private.export_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kineo_private.accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'expired', 'consumed')),
  download_token_hash text,
  object_key text,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table kineo_private.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references kineo_private.accounts(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'revokingAccess', 'deletingData', 'deletingAuth', 'complete', 'failed')),
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts', 'device_installations', 'legal_acceptances', 'user_profiles',
    'reminder_settings', 'check_ins', 'check_in_entries', 'attention_states',
    'safety_events', 'pause_today_events', 'selection_decisions',
    'decision_area_inputs', 'decision_reason_records', 'routine_sessions',
    'routine_events', 'feedback_submissions', 'area_feedback',
    'mutation_receipts', 'account_changes', 'export_jobs', 'deletion_jobs'
  ]
  loop
    execute format('alter table kineo_private.%I enable row level security', table_name);
    execute format('alter table kineo_private.%I force row level security', table_name);
    execute format('revoke all on kineo_private.%I from public, anon, authenticated', table_name);
  end loop;
end
$$;

create or replace function kineo_private.current_account_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
begin
  if account_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  return account_id;
end;
$$;

create or replace function kineo_private.create_account_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into kineo_private.accounts(id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger create_kineo_account_after_auth_user
after insert on auth.users
for each row execute function kineo_private.create_account_for_auth_user();

create or replace function public.kineo_bootstrap(
  p_installation_id uuid,
  p_app_version text,
  p_platform_version text,
  p_after_sequence bigint default null,
  p_page_size integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_account uuid := kineo_private.current_account_id();
  account_row kineo_private.accounts%rowtype;
  changes jsonb;
  bounded_page_size integer := least(greatest(p_page_size, 1), 500);
begin
  select * into strict account_row
  from kineo_private.accounts
  where id = current_account;

  insert into kineo_private.device_installations(
    account_id, id, app_version, platform_version
  ) values (
    current_account, p_installation_id, p_app_version, p_platform_version
  )
  on conflict (account_id, id) do update
  set app_version = excluded.app_version,
      platform_version = excluded.platform_version,
      updated_at = clock_timestamp()
  where kineo_private.device_installations.revoked_at is null;

  if not found then
    raise exception using errcode = '28000', message = 'installation_revoked';
  end if;

  select coalesce(jsonb_agg(to_jsonb(feed) order by feed.sequence), '[]'::jsonb)
  into changes
  from (
    select sequence, entity_kind, entity_id, operation, payload
    from kineo_private.account_changes
    where account_id = account_row.id
      and sequence > coalesce(p_after_sequence, 0)
    order by sequence
    limit bounded_page_size
  ) feed;

  return jsonb_build_object(
    'accountStatus', account_row.status,
    'historyEpoch', account_row.history_epoch,
    'changes', changes,
    'nextSequence', (
      select max((value->>'sequence')::bigint) from jsonb_array_elements(changes)
    ),
    'hasMore', jsonb_array_length(changes) = bounded_page_size
  );
end;
$$;

create or replace function public.kineo_reset_history(
  p_installation_id uuid,
  p_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_account uuid := kineo_private.current_account_id();
  next_epoch bigint;
  prior_result jsonb;
begin
  select result into prior_result
  from kineo_private.mutation_receipts as receipts
  where receipts.account_id = current_account
    and receipts.mutation_id = p_mutation_id;
  if prior_result is not null then
    return prior_result;
  end if;

  if not exists (
    select 1 from kineo_private.device_installations as installations
    where installations.account_id = current_account
      and installations.id = p_installation_id
      and installations.revoked_at is null
  ) then
    raise exception using errcode = '28000', message = 'installation_revoked';
  end if;

  update kineo_private.accounts
  set history_epoch = history_epoch + 1,
      updated_at = clock_timestamp()
  where id = current_account and status = 'active'
  returning history_epoch into next_epoch;
  if next_epoch is null then
    raise exception using errcode = '55000', message = 'account_deleting';
  end if;

  delete from kineo_private.area_feedback where account_id = current_account;
  delete from kineo_private.feedback_submissions where account_id = current_account;
  delete from kineo_private.routine_events where account_id = current_account;
  delete from kineo_private.routine_sessions where account_id = current_account;
  delete from kineo_private.decision_reason_records where account_id = current_account;
  delete from kineo_private.decision_area_inputs where account_id = current_account;
  delete from kineo_private.selection_decisions where account_id = current_account;
  delete from kineo_private.pause_today_events where account_id = current_account;
  delete from kineo_private.safety_events where account_id = current_account;
  delete from kineo_private.check_in_entries where account_id = current_account;
  delete from kineo_private.check_ins where account_id = current_account;

  insert into kineo_private.account_changes(
    account_id, entity_kind, entity_id, operation, payload
  ) values (
    current_account, 'history', current_account::text, 'reset',
    jsonb_build_object('historyEpoch', next_epoch)
  );

  prior_result := jsonb_build_object('kind', 'applied', 'historyEpoch', next_epoch);
  insert into kineo_private.mutation_receipts(
    account_id, mutation_id, installation_id, history_epoch, command_kind, result
  ) values (
    current_account, p_mutation_id, p_installation_id, next_epoch, 'resetHistory', prior_result
  );
  return prior_result;
end;
$$;

create or replace function public.kineo_request_export()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_account uuid := kineo_private.current_account_id();
  job_id uuid;
begin
  if not exists (
    select 1 from kineo_private.accounts
    where id = current_account and status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'account_unavailable';
  end if;
  insert into kineo_private.export_jobs(account_id)
  values (current_account)
  returning id into job_id;
  return jsonb_build_object('jobId', job_id, 'status', 'pending');
end;
$$;

create or replace function public.kineo_begin_deletion()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_account uuid := kineo_private.current_account_id();
  job_id uuid;
begin
  update kineo_private.accounts
  set status = 'deleting', updated_at = clock_timestamp()
  where id = current_account;
  update kineo_private.device_installations
  set revoked_at = coalesce(revoked_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where account_id = current_account;
  insert into kineo_private.deletion_jobs(account_id, status)
  values (current_account, 'revokingAccess')
  on conflict (account_id) do update
  set updated_at = clock_timestamp()
  returning id into job_id;
  return jsonb_build_object('jobId', job_id, 'status', 'revokingAccess');
end;
$$;

create or replace function public.kineo_deletion_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('jobId', id, 'status', status)
  from kineo_private.deletion_jobs
  where account_id = kineo_private.current_account_id()
$$;

revoke all on function public.kineo_bootstrap(uuid, text, text, bigint, integer) from public, anon;
revoke all on function public.kineo_reset_history(uuid, uuid) from public, anon;
revoke all on function public.kineo_request_export() from public, anon;
revoke all on function public.kineo_begin_deletion() from public, anon;
revoke all on function public.kineo_deletion_status() from public, anon;
grant execute on function public.kineo_bootstrap(uuid, text, text, bigint, integer) to authenticated;
grant execute on function public.kineo_reset_history(uuid, uuid) to authenticated;
grant execute on function public.kineo_request_export() to authenticated;
grant execute on function public.kineo_begin_deletion() to authenticated;
grant execute on function public.kineo_deletion_status() to authenticated;
