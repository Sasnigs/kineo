-- A single statement snapshot supplies the shared TypeScript reducer. The
-- mutation guard rechecks its feed version while holding the account lock.
alter table kineo_private.selection_decisions add column authority_version bigint;

create function public.kineo_selection_context_for_account(p_account_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'version', (select coalesce(max(sequence), 0) + 1 from kineo_private.account_changes where account_id = p_account_id),
    'secondaryArea', (select secondary_area from kineo_private.user_profiles where account_id = p_account_id),
    'attentionRequiredAreas', (select coalesce(jsonb_agg(area order by area), '[]'::jsonb)
      from kineo_private.attention_states where account_id = p_account_id),
    'orderedOutcomes', (select coalesce(jsonb_agg(jsonb_build_object(
        'area', feedback.area, 'routineStatus', sessions.status,
        'deliveredLevel', sessions.routine_snapshot->>'deliveredLevel',
        'response', feedback.response, 'wasIncludedInDeliveredRoutine', true
      ) order by submissions.submitted_at, submissions.id, feedback.area), '[]'::jsonb)
      from kineo_private.area_feedback feedback
      join kineo_private.feedback_submissions submissions on submissions.account_id = feedback.account_id
        and submissions.id = feedback.feedback_submission_id
      join kineo_private.routine_sessions sessions on sessions.account_id = submissions.account_id
        and sessions.id = submissions.routine_session_id
      where feedback.account_id = p_account_id
        and sessions.status in ('completed', 'stopped', 'safetyStopped', 'abandoned')
        and sessions.routine_snapshot->'includedAreas' ? feedback.area)
  )
$$;

alter function public.kineo_apply_mutation_for_account(uuid, uuid, uuid, bigint, jsonb) set schema kineo_private;
alter function kineo_private.kineo_apply_mutation_for_account(uuid, uuid, uuid, bigint, jsonb) rename to apply_mutation_v1;
revoke all on function kineo_private.apply_mutation_v1(uuid, uuid, uuid, bigint, jsonb) from service_role;

create function public.kineo_apply_mutation_for_account(
  p_account_id uuid, p_mutation_id uuid, p_installation_id uuid, p_history_epoch bigint, p_command jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  command jsonb := p_command;
  kind text := command->>'kind';
  current_version bigint;
  result jsonb;
  plan jsonb;
  check_in jsonb;
  stored_check_in jsonb;
  entry jsonb;
  transition jsonb;
  transitions jsonb := '[]'::jsonb;
  expected_kind text;
  expected_status text;
  attention kineo_private.attention_states%rowtype;
  authorized_version bigint;
  routine kineo_private.routine_sessions%rowtype;
  event jsonb;
  event_kind text;
  next_step integer;
  step_count integer;
  current_item jsonb;
  occurred_ms bigint;
  updated_ms bigint;
  terminal boolean;
  current_legal_version constant text := 'internal-prototype-2026-09-02';
  rejected jsonb := jsonb_build_object('mutationId', p_mutation_id, 'kind', 'rejected', 'code', 'invalidCommand');
begin
  perform 1 from kineo_private.accounts where id = p_account_id for update;
  -- Preserve receipt/epoch/device handling for retries and stale accounts before
  -- considering server calculation fields, which may differ on a safe retry.
  if exists(select 1 from kineo_private.mutation_receipts where account_id = p_account_id and mutation_id = p_mutation_id)
    or not exists(select 1 from kineo_private.accounts where id = p_account_id and status = 'active' and history_epoch = p_history_epoch)
    or not exists(select 1 from kineo_private.device_installations where account_id = p_account_id and id = p_installation_id and revoked_at is null)
  then
    return kineo_private.apply_mutation_v1(p_account_id, p_mutation_id, p_installation_id, p_history_epoch, command);
  end if;
  select coalesce(max(sequence), 0) + 1 into current_version
    from kineo_private.account_changes where account_id = p_account_id;
  if kind in ('submitCheckIn', 'startRoutine', 'applyAttentionTransition') then
    if command->>'authorityVersion' is null then return rejected; end if;
    if (command->>'authorityVersion')::bigint <> current_version then
      return jsonb_build_object('mutationId', p_mutation_id, 'kind', 'conflict', 'authoritativeVersion', current_version);
    end if;
  end if;

  if kind = 'submitCheckIn' then
    if not exists(select 1 from kineo_private.user_profiles where account_id = p_account_id
        and adult_acknowledged and onboarding_completed_at is not null
        and safety_boundary_version is not null and safety_acknowledged_at is not null) or
      exists(select 1 from unnest(array['termsOfService', 'privacyPolicy']) document_kind
        where not exists(select 1 from kineo_private.legal_acceptances acceptance
          where acceptance.account_id = p_account_id and acceptance.document_kind = document_kind
            and acceptance.document_version = current_legal_version))
    then return rejected; end if;
    check_in := command->'checkIn';
    -- Revisions may reuse a completed check-in, but may never rewrite its inputs.
    select payload into stored_check_in from kineo_private.account_changes
      where account_id = p_account_id and entity_kind = 'checkIn' and entity_id = check_in->>'id'
      order by sequence desc limit 1;
    if stored_check_in is not null and stored_check_in is distinct from check_in then return rejected; end if;
    if check_in->>'kind' = 'attentionCorrection' and (
      jsonb_array_length(check_in->'entries') <> 1 or
      check_in#>>'{correctionSource,area}' is distinct from check_in->>'primaryArea'
    ) then return rejected; end if;

    for entry in select value from jsonb_array_elements(check_in->'entries') loop
      if check_in->>'kind' = 'attentionCorrection' or entry->>'conditionalSafetyAnswer' in ('yes', 'notSure') then
        select value into transition from jsonb_array_elements(coalesce(command->'attentionTransitions', '[]'::jsonb))
          where value->>'sourceCheckInEntryId' = entry->>'id';
        if check_in->>'kind' = 'attentionCorrection' then
          select * into attention from kineo_private.attention_states where account_id = p_account_id and area = entry->>'area';
          if not found or transition->>'expectedAttentionUpdatedAtMilliseconds' is null or
            (transition->>'expectedAttentionUpdatedAtMilliseconds')::bigint is distinct from
              floor(extract(epoch from attention.updated_at) * 1000)::bigint
          then return rejected; end if;
          expected_kind := case when entry->>'conditionalSafetyAnswer' in ('yes', 'notSure')
            then 'attentionReaffirmedCorrection' else 'attentionClearedCorrection' end;
        else
          expected_kind := 'attentionEntered';
        end if;
        expected_status := case when expected_kind = 'attentionClearedCorrection' then 'normal' else 'attentionRequired' end;
        if transition is not null and (
          transition->>'area' is distinct from entry->>'area' or
          transition->>'kind' is distinct from expected_kind or transition->>'statusAfter' is distinct from expected_status
        ) then return rejected; end if;
        -- Omission of client safety events never omits the authoritative state.
        transition := jsonb_build_object(
          'id', coalesce(transition->>'id', gen_random_uuid()::text), 'area', entry->>'area',
          'kind', expected_kind, 'statusAfter', expected_status, 'sourceCheckInEntryId', entry->>'id',
          'occurredAtMilliseconds', check_in->'completedAtMilliseconds', 'dayContext', check_in->'dayContext'
        );
        transitions := transitions || jsonb_build_array(transition);
      end if;
    end loop;
    if jsonb_array_length(coalesce(command->'attentionTransitions', '[]'::jsonb)) > jsonb_array_length(transitions) then return rejected; end if;
    command := jsonb_set(command, '{attentionTransitions}', transitions);
    if check_in->>'kind' = 'attentionCorrection' or jsonb_array_length(transitions) > 0 or
      exists(select 1 from kineo_private.attention_states where account_id = p_account_id)
    then command := jsonb_set(command, '{authoritativePlan}', 'null'::jsonb); end if;
  elsif kind = 'applyAttentionTransition' then
    transition := command->'transition';
    select * into attention from kineo_private.attention_states where account_id = p_account_id and area = transition->>'area';
    if not found or transition->>'expectedAttentionUpdatedAtMilliseconds' is null or
      (transition->>'expectedAttentionUpdatedAtMilliseconds')::bigint is distinct from floor(extract(epoch from attention.updated_at) * 1000)::bigint
    then return rejected; end if;
    expected_kind := case when transition->>'returnAnswer' = 'yes' then 'attentionClearedReturnedToUsual' else 'attentionReaffirmed' end;
    expected_status := case when transition->>'returnAnswer' = 'yes' then 'normal' else 'attentionRequired' end;
    if transition->>'returnAnswer' is null or transition->>'returnAnswer' not in ('yes', 'no', 'notSure') or
      transition->>'kind' is distinct from expected_kind or transition->>'statusAfter' is distinct from expected_status or
      transition->>'sourceCheckInEntryId' is not null
    then return rejected; end if;
  elsif kind = 'startRoutine' then
    if exists(select 1 from kineo_private.attention_states where account_id = p_account_id) then return rejected; end if;
    select decision_payload, authority_version into plan, authorized_version from kineo_private.selection_decisions
      where account_id = p_account_id and id = (command->>'decisionId')::uuid;
    if plan is null or authorized_version is distinct from current_version or
      jsonb_typeof(plan->'snapshotTemplate') is distinct from 'object' or
      jsonb_typeof(plan->'canonicalDecision') is distinct from 'object'
    then return rejected; end if;
    if ((command#>>'{routine,snapshot,json}')::jsonb - 'sessionId' - 'compositionId' - 'createdAtMilliseconds')
      is distinct from ((plan->'snapshotTemplate') - 'sessionId' - 'compositionId' - 'createdAtMilliseconds') or
      ((command->'decision') - 'createdAtMilliseconds') is distinct from ((plan->'canonicalDecision') - 'createdAtMilliseconds') or
      command#>>'{routine,checkInId}' is distinct from plan->>'checkInId'
    then return rejected; end if;
  elsif kind = 'recordRoutineEvent' then
    event := command->'event';
    select * into routine from kineo_private.routine_sessions where account_id = p_account_id
      and id = (event->>'routineSessionId')::uuid;
    -- v1 returns the typed ownership/version disposition, without any writes.
    if not found or routine.owner_installation_id <> p_installation_id or
      routine.version <> (event->>'expectedVersion')::bigint
    then return kineo_private.apply_mutation_v1(p_account_id, p_mutation_id, p_installation_id, p_history_epoch, command); end if;
    event_kind := event->>'kind';
    expected_status := case event_kind
      when 'started' then case when routine.status = 'prepared' then 'inProgress' end
      when 'paused' then case when routine.status = 'inProgress' then 'paused' end
      when 'resumed' then case when routine.status = 'paused' then 'inProgress' end
      when 'stepCompleted' then case when routine.status = 'inProgress' then 'inProgress' end
      when 'skipped' then case when routine.status = 'inProgress' then 'inProgress' end
      when 'alternativeSelected' then case when routine.status in ('inProgress', 'paused') then routine.status end
      when 'completed' then case when routine.status in ('inProgress', 'paused') then 'completed' end
      when 'stopped' then case when routine.status in ('inProgress', 'paused') then 'stopped' end
      when 'safetyStopped' then case when routine.status in ('inProgress', 'paused') then 'safetyStopped' end
      when 'abandoned' then case when routine.status in ('prepared', 'inProgress', 'paused') then 'abandoned' end
    end;
    occurred_ms := (event->>'occurredAtMilliseconds')::bigint;
    updated_ms := (event->>'resultingUpdatedAtMilliseconds')::bigint;
    terminal := expected_status in ('completed', 'stopped', 'safetyStopped', 'abandoned');
    step_count := jsonb_array_length(routine.routine_snapshot->'items');
    next_step := routine.current_step_index + case when event_kind in ('stepCompleted', 'skipped') then 1 else 0 end;
    if expected_status is null or event->>'resultingStatus' is distinct from expected_status or
      (event->>'sequenceNumber')::bigint is distinct from routine.version or
      occurred_ms < floor(extract(epoch from routine.updated_at) * 1000)::bigint or updated_ms < occurred_ms or
      terminal is distinct from (event->>'resultingEndedAtMilliseconds' is not null) or
      (terminal and ((event->>'resultingEndedAtMilliseconds')::bigint < occurred_ms or
        (event->>'resultingEndedAtMilliseconds')::bigint > updated_ms)) or
      (event_kind = 'started' and (event->>'resultingStartedAtMilliseconds')::bigint is distinct from occurred_ms) or
      (event_kind <> 'started' and event->>'resultingStartedAtMilliseconds' is not null) or
      (event->>'resultingStepIndex')::integer is distinct from next_step or next_step > step_count or
      (event_kind = 'completed' and routine.current_step_index < step_count - 1) or
      (event_kind in ('stepCompleted', 'skipped') and (event->>'resultingStepElapsedMilliseconds')::bigint <> 0)
    then return rejected; end if;
    current_item := routine.routine_snapshot->'items'->routine.current_step_index;
    if event_kind in ('stepCompleted', 'skipped', 'alternativeSelected') then
      if current_item is null or event->>'stepId' is distinct from current_item->>'itemId' or
        event->>'moduleId' is distinct from current_item->>'sourceOwnerId'
      then return rejected; end if;
    elsif event->>'stepId' is not null or event->>'moduleId' is not null then return rejected; end if;
    if event_kind = 'alternativeSelected' then
      if not exists(select 1 from jsonb_array_elements(current_item->'availableAlternatives') alternative
        where alternative->>'movementId' = event->>'alternativeId') then return rejected; end if;
    elsif event->>'alternativeId' is not null then return rejected; end if;
    if event->>'localReason' is not null and (event_kind <> 'skipped' or
      event->>'localReason' not in ('uncomfortable', 'unclear', 'notEnoughSpace')) then return rejected; end if;
  elsif kind = 'submitFeedback' then
    select * into routine from kineo_private.routine_sessions where account_id = p_account_id
      and id = (command#>>'{submission,routineSessionId}')::uuid;
    if not found or routine.owner_installation_id <> p_installation_id or
      routine.status not in ('completed', 'stopped', 'safetyStopped') or routine.ended_at is null or
      (command#>>'{submission,submittedAtMilliseconds}')::bigint < floor(extract(epoch from routine.ended_at) * 1000)::bigint or
      exists(select 1 from jsonb_array_elements(command#>'{submission,responses}') response
        where not (routine.routine_snapshot->'includedAreas' ? (response->>'area')))
    then return rejected; end if;
  end if;

  result := kineo_private.apply_mutation_v1(p_account_id, p_mutation_id, p_installation_id, p_history_epoch, command);
  if result->>'kind' = 'applied' and kind = 'submitCheckIn' then
    -- v1 inserts correction events; the guarded correction also clears its state.
    for transition in select value from jsonb_array_elements(transitions) loop
      if transition->>'statusAfter' = 'normal' then
        delete from kineo_private.attention_states where account_id = p_account_id and area = transition->>'area';
      end if;
    end loop;
    update kineo_private.selection_decisions set authority_version = (
      select coalesce(max(sequence), 0) + 1 from kineo_private.account_changes where account_id = p_account_id
    ) where account_id = p_account_id and id = (command->>'decisionId')::uuid;
  end if;
  return result;
end;
$$;

revoke all on function public.kineo_selection_context_for_account(uuid) from public, anon, authenticated;
revoke all on function public.kineo_apply_mutation_for_account(uuid, uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.kineo_selection_context_for_account(uuid) to service_role;
grant execute on function public.kineo_apply_mutation_for_account(uuid, uuid, uuid, bigint, jsonb) to service_role;
