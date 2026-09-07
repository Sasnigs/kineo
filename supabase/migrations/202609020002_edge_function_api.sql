revoke execute on function public.kineo_bootstrap(uuid, text, text, bigint, integer) from authenticated;
revoke execute on function public.kineo_reset_history(uuid, uuid) from authenticated;
revoke execute on function public.kineo_request_export() from authenticated;
revoke execute on function public.kineo_begin_deletion() from authenticated;
revoke execute on function public.kineo_deletion_status() from authenticated;

alter table kineo_private.export_jobs
  add column export_payload jsonb,
  add column download_token_consumed_at timestamptz;

alter table kineo_private.deletion_jobs
  drop constraint deletion_jobs_account_id_fkey,
  add column resume_token_hash text;

create or replace function public.kineo_bootstrap_for_account(
  p_account_id uuid,
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
  account_row kineo_private.accounts%rowtype;
  changes jsonb;
  acceptances jsonb;
  bounded_page_size integer := least(greatest(p_page_size, 1), 500);
begin
  select * into strict account_row
  from kineo_private.accounts
  where id = p_account_id;

  insert into kineo_private.device_installations(
    account_id, id, app_version, platform_version
  ) values (
    p_account_id, p_installation_id, p_app_version, p_platform_version
  )
  on conflict (account_id, id) do update
  set app_version = excluded.app_version,
      platform_version = excluded.platform_version,
      updated_at = clock_timestamp()
  where kineo_private.device_installations.revoked_at is null;

  if not found then
    raise exception using errcode = '28000', message = 'installation_revoked';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'documentKind', document_kind,
    'documentVersion', document_version,
    'locale', locale,
    'acceptedAtMilliseconds',
      floor(extract(epoch from accepted_at) * 1000)::bigint
  ) order by document_kind, document_version), '[]'::jsonb)
  into acceptances
  from kineo_private.legal_acceptances
  where account_id = p_account_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cursor', sequence::text,
    'entityKind', entity_kind,
    'entityId', entity_id,
    'operation', operation,
    'payload', payload
  ) order by sequence), '[]'::jsonb)
  into changes
  from (
    select sequence, entity_kind, entity_id, operation, payload
    from kineo_private.account_changes
    where account_id = p_account_id
      and sequence > coalesce(p_after_sequence, 0)
    order by sequence
    limit bounded_page_size
  ) feed;

  return jsonb_build_object(
    'account', jsonb_build_object(
      'accountId', account_row.id,
      'status', account_row.status,
      'historyEpoch', account_row.history_epoch,
      'legalAcceptances', acceptances
    ),
    'changes', changes,
    'nextCursor', (
      select max((value->>'cursor')::bigint)::text
      from jsonb_array_elements(changes)
    ),
    'hasMore', jsonb_array_length(changes) = bounded_page_size
  );
exception
  when no_data_found then
    raise exception using errcode = '28000', message = 'account_unavailable';
end;
$$;

create or replace function public.kineo_active_history_for_account(
  p_account_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(area, qualifying_count), '{}'::jsonb)
  from (
    select feedback.area, count(*)::integer as qualifying_count
    from kineo_private.area_feedback feedback
    join kineo_private.feedback_submissions submissions
      on submissions.account_id = feedback.account_id
     and submissions.id = feedback.feedback_submission_id
    join kineo_private.routine_sessions sessions
      on sessions.account_id = submissions.account_id
     and sessions.id = submissions.routine_session_id
    where feedback.account_id = p_account_id
      and feedback.response in ('better', 'same')
      and sessions.status = 'completed'
      and sessions.routine_snapshot->>'selectedLevel' in ('gentle', 'balanced')
    group by feedback.area
  ) history
$$;

create or replace function public.kineo_apply_mutation_for_account(
  p_account_id uuid,
  p_mutation_id uuid,
  p_installation_id uuid,
  p_history_epoch bigint,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row kineo_private.accounts%rowtype;
  command_kind text := p_command->>'kind';
  check_in jsonb;
  plan jsonb;
  entry jsonb;
  submission jsonb;
  event_data jsonb;
  decision_data jsonb;
  receipt jsonb;
  current_version bigint;
  generated_session_id uuid;
  routine_snapshot jsonb;
  routine_snapshot_text text;
  routine_payload jsonb;
begin
  if jsonb_typeof(p_command) <> 'object' or command_kind is null then
    return jsonb_build_object(
      'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand'
    );
  end if;

  -- Serialize mutations, receipts and epoch changes for one account. A retry
  -- must observe the first transaction's receipt after acquiring this lock.
  select * into account_row
  from kineo_private.accounts
  where id = p_account_id
  for update;

  if not found or account_row.status <> 'active' then
    return jsonb_build_object(
      'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'accountDeleting'
    );
  end if;
  if not exists (
    select 1 from kineo_private.device_installations
    where account_id = p_account_id
      and id = p_installation_id
      and revoked_at is null
  ) then
    return jsonb_build_object(
      'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'installationRevoked'
    );
  end if;

  if exists (
    select 1 from kineo_private.mutation_receipts
    where account_id = p_account_id and mutation_id = p_mutation_id
  ) then
    return jsonb_build_object('mutationId', p_mutation_id, 'kind', 'duplicate');
  end if;
  if account_row.history_epoch <> p_history_epoch then
    return jsonb_build_object(
      'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'staleHistoryEpoch'
    );
  end if;

  case command_kind
    when 'acceptLegal' then
      insert into kineo_private.legal_acceptances(
        account_id, document_kind, document_version, locale, accepted_at
      ) values (
        p_account_id,
        p_command#>>'{acceptance,documentKind}',
        p_command#>>'{acceptance,documentVersion}',
        p_command#>>'{acceptance,locale}',
        to_timestamp((p_command#>>'{acceptance,acceptedAtMilliseconds}')::double precision / 1000)
      ) on conflict do nothing;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id,
        'legalAcceptance',
        concat(
          p_command#>>'{acceptance,documentKind}', ':',
          p_command#>>'{acceptance,documentVersion}'
        ),
        'upsert',
        p_command->'acceptance'
      );

    when 'saveProfile' then
      select version into current_version
      from kineo_private.user_profiles
      where account_id = p_account_id;
      if current_version is not null and
         current_version <> (p_command->>'expectedVersion')::bigint then
        return jsonb_build_object(
          'mutationId', p_mutation_id,
          'kind', 'conflict',
          'authoritativeVersion', current_version
        );
      end if;
      insert into kineo_private.user_profiles(
        account_id, version, onboarding_completed_at, adult_acknowledged,
        primary_area, secondary_area, safety_boundary_version,
        safety_acknowledged_at, routine_preference, weekly_goal_days,
        telemetry_choice, created_at, updated_at
      ) values (
        p_account_id,
        coalesce(current_version + 1, 1),
        case when p_command#>>'{profile,onboardingCompletedAtMilliseconds}' is null
          then null
          else to_timestamp(
            (p_command#>>'{profile,onboardingCompletedAtMilliseconds}')::double precision / 1000
          )
        end,
        coalesce((p_command#>>'{profile,adultAcknowledged}')::boolean, false),
        p_command#>>'{profile,primaryArea}',
        p_command#>>'{profile,secondaryArea}',
        p_command#>>'{profile,safetyBoundaryVersion}',
        case when p_command#>>'{profile,safetyAcknowledgedAtMilliseconds}' is null
          then null
          else to_timestamp(
            (p_command#>>'{profile,safetyAcknowledgedAtMilliseconds}')::double precision / 1000
          )
        end,
        p_command#>>'{profile,routinePreference}',
        (p_command#>>'{profile,weeklyGoalDays}')::smallint,
        p_command#>>'{profile,telemetryChoice}',
        to_timestamp((p_command#>>'{profile,createdAtMilliseconds}')::double precision / 1000),
        to_timestamp((p_command#>>'{profile,updatedAtMilliseconds}')::double precision / 1000)
      )
      on conflict (account_id) do update set
        version = excluded.version,
        onboarding_completed_at = excluded.onboarding_completed_at,
        adult_acknowledged = excluded.adult_acknowledged,
        primary_area = excluded.primary_area,
        secondary_area = excluded.secondary_area,
        safety_boundary_version = excluded.safety_boundary_version,
        safety_acknowledged_at = excluded.safety_acknowledged_at,
        routine_preference = excluded.routine_preference,
        weekly_goal_days = excluded.weekly_goal_days,
        telemetry_choice = excluded.telemetry_choice,
        updated_at = excluded.updated_at;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'profile', p_account_id::text, 'upsert',
        (p_command->'profile') || jsonb_build_object(
          'version', coalesce(current_version + 1, 1)
        )
      );
      if p_command->'reminderSettings' is not null then
        insert into kineo_private.reminder_settings(
          account_id, version, enabled, window_start_minutes,
          window_end_minutes, time_zone_id
        ) values (
          p_account_id,
          coalesce(current_version + 1, 1),
          coalesce((p_command#>>'{reminderSettings,enabled}')::boolean, false),
          (p_command#>>'{reminderSettings,window,startMinutes}')::smallint,
          (p_command#>>'{reminderSettings,window,endMinutes}')::smallint,
          p_command#>>'{reminderSettings,timeZoneId}'
        )
        on conflict (account_id) do update set
          version = excluded.version,
          enabled = excluded.enabled,
          window_start_minutes = excluded.window_start_minutes,
          window_end_minutes = excluded.window_end_minutes,
          time_zone_id = excluded.time_zone_id,
          updated_at = clock_timestamp();
        insert into kineo_private.account_changes(
          account_id, entity_kind, entity_id, operation, payload
        ) values (
          p_account_id, 'reminderSettings', p_account_id::text, 'upsert',
          p_command->'reminderSettings'
        );
      end if;

    when 'submitCheckIn' then
      check_in := p_command->'checkIn';
      plan := p_command->'authoritativePlan';
      insert into kineo_private.check_ins(
        account_id, id, installation_id, history_epoch, status, purpose,
        primary_area, secondary_area, submitted_at, local_day,
        time_zone_id, calendar_id
      ) values (
        p_account_id,
        (check_in->>'id')::uuid,
        p_installation_id,
        p_history_epoch,
        'completed',
        case when check_in->>'kind' = 'attentionCorrection'
          then 'attentionCorrection' else 'normal' end,
        check_in->>'primaryArea',
        check_in->>'secondaryArea',
        to_timestamp((check_in->>'completedAtMilliseconds')::double precision / 1000),
        (check_in#>>'{dayContext,localDay}')::date,
        check_in#>>'{dayContext,timeZoneId}',
        check_in#>>'{dayContext,calendarId}'
      ) on conflict (account_id, id) do nothing;
      for entry in select value from jsonb_array_elements(check_in->'entries')
      loop
        insert into kineo_private.check_in_entries(
          account_id, id, check_in_id, area, role, change_report,
          movement_comfort, conditional_safety_answer, submitted_at
        ) values (
          p_account_id,
          (entry->>'id')::uuid,
          (check_in->>'id')::uuid,
          entry->>'area',
          entry->>'role',
          entry->>'changeReport',
          entry->>'movementComfort',
          entry->>'conditionalSafetyAnswer',
          to_timestamp((entry->>'submittedAtMilliseconds')::double precision / 1000)
        ) on conflict (account_id, id) do nothing;
      end loop;
      -- Feed parents before children, including across page boundaries.
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'checkIn', check_in->>'id', 'upsert', check_in
      );
      for event_data in select value from jsonb_array_elements(
        coalesce(p_command->'attentionTransitions', '[]'::jsonb)
      )
      loop
        insert into kineo_private.safety_events(
          account_id, id, area, kind, source_check_in_entry_id,
          occurred_at, payload
        ) values (
          p_account_id,
          (event_data->>'id')::uuid,
          event_data->>'area',
          event_data->>'kind',
          (event_data->>'sourceCheckInEntryId')::uuid,
          to_timestamp((event_data->>'occurredAtMilliseconds')::double precision / 1000),
          event_data
        );
        if event_data->>'statusAfter' = 'attentionRequired' then
          insert into kineo_private.attention_states(account_id, area, updated_at)
          values (
            p_account_id,
            event_data->>'area',
            to_timestamp((event_data->>'occurredAtMilliseconds')::double precision / 1000)
          )
          on conflict (account_id, area) do update set
            version = kineo_private.attention_states.version + 1,
            updated_at = excluded.updated_at;
        end if;
        insert into kineo_private.account_changes(
          account_id, entity_kind, entity_id, operation, payload
        ) values (
          p_account_id, 'safetyEvent', event_data->>'id', 'upsert', event_data
        );
      end loop;
      if plan is not null and jsonb_typeof(plan) = 'object' then
        insert into kineo_private.selection_decisions(
          account_id, id, check_in_id, revision, rules_version,
          catalog_version, outcome, recommended_level, selected_level,
          delivered_level, duration_variant, decision_payload
        ) values (
          p_account_id,
          (plan->>'decisionId')::uuid,
          (check_in->>'id')::uuid,
          (plan->>'revision')::integer,
          plan->>'rulesVersion',
          plan->>'catalogVersion',
          'selected',
          plan->>'recommendedLevel',
          plan->>'selectedLevel',
          plan->>'deliveredLevel',
          plan->>'durationVariant',
          plan
        );
        insert into kineo_private.account_changes(
          account_id, entity_kind, entity_id, operation, payload
        ) values (
          p_account_id, 'selectionDecision', plan->>'decisionId', 'upsert', plan
        );
      end if;

    when 'applyAttentionTransition' then
      event_data := p_command->'transition';
      insert into kineo_private.safety_events(
        account_id, id, area, kind, source_check_in_entry_id,
        occurred_at, payload
      ) values (
        p_account_id,
        (event_data->>'id')::uuid,
        event_data->>'area',
        event_data->>'kind',
        (event_data->>'sourceCheckInEntryId')::uuid,
        to_timestamp((event_data->>'occurredAtMilliseconds')::double precision / 1000),
        event_data
      );
      if event_data->>'statusAfter' = 'attentionRequired' then
        insert into kineo_private.attention_states(account_id, area, updated_at)
        values (
          p_account_id,
          event_data->>'area',
          to_timestamp((event_data->>'occurredAtMilliseconds')::double precision / 1000)
        )
        on conflict (account_id, area) do update set
          version = kineo_private.attention_states.version + 1,
          updated_at = excluded.updated_at;
      else
        delete from kineo_private.attention_states
        where account_id = p_account_id and area = event_data->>'area';
      end if;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'safetyEvent', event_data->>'id', 'upsert', event_data
      );

    when 'recordPauseToday' then
      event_data := p_command->'event';
      insert into kineo_private.pause_today_events(
        account_id, id, check_in_id, chosen_at, local_day
      ) values (
        p_account_id,
        (event_data->>'id')::uuid,
        (event_data->>'checkInId')::uuid,
        to_timestamp((event_data->>'chosenAtMilliseconds')::double precision / 1000),
        (event_data#>>'{dayContext,localDay}')::date
      );
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'pauseToday', event_data->>'id', 'upsert', event_data
      );

    when 'startRoutine' then
      event_data := p_command->'routine';
      decision_data := p_command->'decision';
      routine_snapshot_text := event_data#>>'{snapshot,json}';
      routine_snapshot := routine_snapshot_text::jsonb;
      select decision_payload into plan
      from kineo_private.selection_decisions
      where account_id = p_account_id
        and id = (p_command->>'decisionId')::uuid;
      if plan is null then
        return jsonb_build_object(
          'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand'
        );
      end if;
      if jsonb_typeof(routine_snapshot) <> 'object' or
         encode(extensions.digest(routine_snapshot_text, 'sha256'), 'hex') <>
           event_data#>>'{snapshot,checksum}' or
         routine_snapshot->>'sessionId' <> event_data->>'id' or
         routine_snapshot->>'decisionId' <> p_command->>'decisionId' or
         routine_snapshot->>'catalogVersion' <> plan->>'catalogVersion' or
         routine_snapshot->>'rulesVersion' <> plan->>'rulesVersion' or
         routine_snapshot->>'selectedLevel' <> plan->>'selectedLevel' or
         routine_snapshot->>'deliveredLevel' <> plan->>'deliveredLevel' or
         routine_snapshot->>'duration' <> plan->>'durationVariant' or
         routine_snapshot->'includedAreas' <> plan->'includedAreas' or
         decision_data->>'id' <> plan->>'decisionId' or
         decision_data->>'checkInId' <> plan->>'checkInId' or
         decision_data->>'revision' <> plan->>'revision' or
         decision_data->>'rulesVersion' <> plan->>'rulesVersion' or
         decision_data->>'catalogVersionRequested' <> plan->>'catalogVersion' or
         decision_data->>'catalogVersionDelivered' <> plan->>'catalogVersion' or
         decision_data->>'recommendedLevel' <> plan->>'recommendedLevel' or
         decision_data->>'selectedLevel' <> plan->>'selectedLevel' or
         decision_data->>'deliveredLevel' <> plan->>'deliveredLevel' or
         decision_data->>'duration' <> plan->>'durationVariant' or
         decision_data->>'compositionFingerprint' <> routine_snapshot->>'fingerprint' then
        return jsonb_build_object(
          'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand'
        );
      end if;
      update kineo_private.selection_decisions
      set decision_payload = decision_data
      where account_id = p_account_id
        and id = (p_command->>'decisionId')::uuid;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'selectionDecision', p_command->>'decisionId',
        'upsert', decision_data
      );
      generated_session_id := (event_data->>'id')::uuid;
      insert into kineo_private.routine_sessions(
        account_id, id, decision_id, check_in_id, owner_installation_id,
        status, routine_snapshot, session_payload, snapshot_checksum, current_step_index,
        step_elapsed_ms, started_at, updated_at, ended_at
      ) select
        p_account_id,
        generated_session_id,
        id,
        check_in_id,
        p_installation_id,
        event_data->>'status',
        routine_snapshot,
        event_data,
        event_data#>>'{snapshot,checksum}',
        (event_data->>'currentStepIndex')::integer,
        (event_data->>'stepElapsedMilliseconds')::bigint,
        case when event_data->>'startedAtMilliseconds' is null then null
          else to_timestamp((event_data->>'startedAtMilliseconds')::double precision / 1000)
        end,
        to_timestamp((event_data->>'updatedAtMilliseconds')::double precision / 1000),
        case when event_data->>'endedAtMilliseconds' is null then null
          else to_timestamp((event_data->>'endedAtMilliseconds')::double precision / 1000)
        end
      from kineo_private.selection_decisions
      where account_id = p_account_id
        and id = (p_command->>'decisionId')::uuid;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) select
        p_account_id, 'routineSession', generated_session_id::text, 'upsert',
        jsonb_build_object(
          'id', generated_session_id,
          'decisionId', id,
          'checkInId', check_in_id,
          'ownerInstallationId', p_installation_id,
          'version', 1,
          'status', event_data->>'status',
          'routine', event_data
        )
      from kineo_private.selection_decisions
      where account_id = p_account_id
        and id = (p_command->>'decisionId')::uuid;

    when 'recordRoutineEvent' then
      event_data := p_command->'event';
      select version into current_version
      from kineo_private.routine_sessions
      where account_id = p_account_id
        and id = (event_data->>'routineSessionId')::uuid
        and owner_installation_id = p_installation_id;
      if current_version is null then
        return jsonb_build_object(
          'mutationId', p_mutation_id, 'kind', 'rejected',
          'code', 'routineOwnedByAnotherInstallation'
        );
      end if;
      if current_version <> (event_data->>'expectedVersion')::bigint then
        return jsonb_build_object(
          'mutationId', p_mutation_id, 'kind', 'conflict',
          'authoritativeVersion', current_version
        );
      end if;
      insert into kineo_private.routine_events(
        account_id, id, routine_session_id, sequence_number,
        kind, event_payload, occurred_at
      ) values (
        p_account_id,
        (event_data->>'id')::uuid,
        (event_data->>'routineSessionId')::uuid,
        (event_data->>'sequenceNumber')::integer,
        event_data->>'kind',
        event_data,
        to_timestamp((event_data->>'occurredAtMilliseconds')::double precision / 1000)
      );
      update kineo_private.routine_sessions
      set version = version + 1,
          status = event_data->>'resultingStatus',
          current_step_index = (event_data->>'resultingStepIndex')::integer,
          step_elapsed_ms = (event_data->>'resultingStepElapsedMilliseconds')::bigint,
          started_at = coalesce(
            started_at,
            case when event_data->>'resultingStartedAtMilliseconds' is null
              then null
              else to_timestamp(
                (event_data->>'resultingStartedAtMilliseconds')::double precision / 1000
              )
            end
          ),
          updated_at = to_timestamp(
            (event_data->>'resultingUpdatedAtMilliseconds')::double precision / 1000
          ),
          ended_at = case when event_data->>'resultingEndedAtMilliseconds' is null
            then null
            else to_timestamp(
              (event_data->>'resultingEndedAtMilliseconds')::double precision / 1000
            )
          end,
          session_payload = session_payload || jsonb_strip_nulls(jsonb_build_object(
            'status', event_data->>'resultingStatus',
            'currentStepIndex', (event_data->>'resultingStepIndex')::integer,
            'stepElapsedMilliseconds',
              (event_data->>'resultingStepElapsedMilliseconds')::bigint,
            'updatedAtMilliseconds',
              (event_data->>'resultingUpdatedAtMilliseconds')::bigint,
            'startedAtMilliseconds', coalesce(
              session_payload->'startedAtMilliseconds',
              event_data->'resultingStartedAtMilliseconds'
            ),
            'endedAtMilliseconds', event_data->'resultingEndedAtMilliseconds'
          ))
      where account_id = p_account_id
        and id = (event_data->>'routineSessionId')::uuid;
      select session_payload into routine_payload
      from kineo_private.routine_sessions
      where account_id = p_account_id
        and id = (event_data->>'routineSessionId')::uuid;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'routineEvent', event_data->>'id', 'upsert', event_data
      );
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'routineSession', event_data->>'routineSessionId', 'upsert',
        jsonb_build_object(
          'id', event_data->>'routineSessionId',
          'ownerInstallationId', p_installation_id,
          'routine', routine_payload
        )
      );

    when 'submitFeedback' then
      submission := p_command->'submission';
      insert into kineo_private.feedback_submissions(
        account_id, id, routine_session_id, submitted_at
      ) values (
        p_account_id,
        (submission->>'id')::uuid,
        (submission->>'routineSessionId')::uuid,
        to_timestamp((submission->>'submittedAtMilliseconds')::double precision / 1000)
      );
      for entry in select value from jsonb_array_elements(submission->'responses')
      loop
        insert into kineo_private.area_feedback(
          account_id, id, feedback_submission_id, area, response, submitted_at
        ) values (
          p_account_id,
          (entry->>'id')::uuid,
          (submission->>'id')::uuid,
          entry->>'area',
          entry->>'response',
          to_timestamp((submission->>'submittedAtMilliseconds')::double precision / 1000)
        );
      end loop;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'feedback', submission->>'id', 'upsert', submission
      );

    when 'resetHistory' then
      update kineo_private.accounts
      set history_epoch = history_epoch + 1,
          updated_at = clock_timestamp()
      where id = p_account_id
      returning * into account_row;
      delete from kineo_private.area_feedback where account_id = p_account_id;
      delete from kineo_private.feedback_submissions where account_id = p_account_id;
      delete from kineo_private.routine_events where account_id = p_account_id;
      delete from kineo_private.routine_sessions where account_id = p_account_id;
      delete from kineo_private.decision_reason_records where account_id = p_account_id;
      delete from kineo_private.decision_area_inputs where account_id = p_account_id;
      delete from kineo_private.selection_decisions where account_id = p_account_id;
      delete from kineo_private.pause_today_events where account_id = p_account_id;
      delete from kineo_private.safety_events where account_id = p_account_id;
      delete from kineo_private.check_in_entries where account_id = p_account_id;
      delete from kineo_private.check_ins where account_id = p_account_id;
      delete from kineo_private.account_changes where account_id = p_account_id;
      insert into kineo_private.account_changes(
        account_id, entity_kind, entity_id, operation, payload
      ) values (
        p_account_id, 'history', p_account_id::text, 'reset',
        jsonb_build_object('historyEpoch', account_row.history_epoch)
      );

    else
      return jsonb_build_object(
        'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand'
      );
  end case;

  receipt := jsonb_build_object(
    'mutationId', p_mutation_id, 'kind', 'applied'
  );
  insert into kineo_private.mutation_receipts(
    account_id, mutation_id, installation_id, history_epoch,
    command_kind, result
  ) values (
    p_account_id,
    p_mutation_id,
    p_installation_id,
    account_row.history_epoch,
    command_kind,
    receipt
  );
  return receipt;
exception
  when unique_violation then
    if command_kind = 'startRoutine' then
      return jsonb_build_object(
        'mutationId', p_mutation_id, 'kind', 'rejected',
        'code', 'routineOwnedByAnotherInstallation'
      );
    end if;
    return jsonb_build_object(
      'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand'
    );
  when check_violation or foreign_key_violation or invalid_text_representation or
       numeric_value_out_of_range or not_null_violation then
    return jsonb_build_object(
      'mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand'
    );
end;
$$;

create or replace function public.kineo_changes_for_account(
  p_account_id uuid,
  p_after_sequence bigint default null,
  p_page_size integer default 200
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounded as (
    select least(greatest(p_page_size, 1), 500) as page_size
  ), feed as (
    select sequence, entity_kind, entity_id, operation, payload
    from kineo_private.account_changes, bounded
    where account_id = p_account_id
      and sequence > coalesce(p_after_sequence, 0)
    order by sequence
    limit (select page_size from bounded)
  ), changes as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'cursor', sequence::text,
      'entityKind', entity_kind,
      'entityId', entity_id,
      'operation', operation,
      'payload', payload
    ) order by sequence), '[]'::jsonb) as value
    from feed
  )
  select jsonb_build_object(
    'accountStatus', accounts.status,
    'historyEpoch', accounts.history_epoch,
    'changes', changes.value,
    'nextCursor', (
      select max((item->>'cursor')::bigint)::text
      from jsonb_array_elements(changes.value) item
    ),
    'hasMore', jsonb_array_length(changes.value) =
      (select page_size from bounded)
  )
  from kineo_private.accounts accounts, changes
  where accounts.id = p_account_id
$$;

create or replace function public.kineo_revoke_installation_for_account(
  p_account_id uuid,
  p_installation_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update kineo_private.device_installations
  set revoked_at = coalesce(revoked_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where account_id = p_account_id and id = p_installation_id
$$;

revoke all on function public.kineo_bootstrap_for_account(uuid, uuid, text, text, bigint, integer) from public, anon, authenticated;
revoke all on function public.kineo_active_history_for_account(uuid) from public, anon, authenticated;
revoke all on function public.kineo_apply_mutation_for_account(uuid, uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.kineo_changes_for_account(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.kineo_revoke_installation_for_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kineo_bootstrap_for_account(uuid, uuid, text, text, bigint, integer) to service_role;
grant execute on function public.kineo_active_history_for_account(uuid) to service_role;
grant execute on function public.kineo_apply_mutation_for_account(uuid, uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.kineo_changes_for_account(uuid, bigint, integer) to service_role;
grant execute on function public.kineo_revoke_installation_for_account(uuid, uuid) to service_role;
