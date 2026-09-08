begin;
select no_plan();
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000021');
select public.kineo_bootstrap_for_account('10000000-0000-4000-8000-000000000021',
  '20000000-0000-4000-8000-000000000021', 'test', 'test');
insert into kineo_private.user_profiles(account_id, adult_acknowledged, onboarding_completed_at,
  safety_boundary_version, safety_acknowledged_at)
values ('10000000-0000-4000-8000-000000000021', true, now(), 'safety-v1', now());
insert into kineo_private.legal_acceptances(account_id, document_kind, document_version, locale, accepted_at)
select '10000000-0000-4000-8000-000000000021', kind, 'internal-prototype-2026-09-02', 'en-US', now()
from unnest(array['termsOfService', 'privacyPolicy']) kind;
create temporary table command_fixture(command jsonb);
insert into command_fixture values ('{
  "kind":"submitCheckIn", "decisionId":"60000000-0000-4000-8000-000000000021",
  "decisionRevision":1, "durationVariant":"standard", "authoritativePlan":null,
  "checkIn":{
    "id":"40000000-0000-4000-8000-000000000021", "status":"completed", "kind":"normal",
    "primaryArea":"neck", "startedAtMilliseconds":1788300000000, "completedAtMilliseconds":1788300000001,
    "dayContext":{"localDay":"2026-09-01","timeZoneId":"UTC","calendarId":"gregorian"},
    "entries":[{"id":"50000000-0000-4000-8000-000000000021", "area":"neck", "role":"primary",
      "changeReport":"worse", "movementComfort":"limited", "conditionalSafetyAnswer":"notSure", "submittedAtMilliseconds":1788300000001}]
  }
}');
select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000021',
  '20000000-0000-4000-8000-000000000021', 1, (select command from command_fixture)
)->>'kind', 'rejected', 'commands without a server state version cannot bypass authority');
update command_fixture set command = command || '{"authorityVersion":1}'::jsonb;
select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000022',
  '20000000-0000-4000-8000-000000000021', 1, (select command from command_fixture)
)->>'kind', 'applied', 'check-in is accepted with a current server calculation');
select is((select count(*) from kineo_private.attention_states where account_id = '10000000-0000-4000-8000-000000000021'),
  1::bigint, 'omitting client transitions cannot omit authoritative attention');
select is((select count(*) from kineo_private.safety_events where account_id = '10000000-0000-4000-8000-000000000021'),
  1::bigint, 'server records the omitted safety event');
select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000023',
  '20000000-0000-4000-8000-000000000021', 1, (select command from command_fixture)
)->>'kind', 'conflict', 'intervening account changes invalidate a pre-transaction calculation');

update command_fixture set command = jsonb_build_object(
  'kind','applyAttentionTransition', 'authorityVersion',
    public.kineo_selection_context_for_account('10000000-0000-4000-8000-000000000021')->'version',
  'transition', jsonb_build_object('id','60000000-0000-4000-8000-000000000022', 'area','neck',
    'kind','attentionClearedCorrection', 'statusAfter','normal', 'returnAnswer','yes',
    'expectedAttentionUpdatedAtMilliseconds',1788300000001, 'occurredAtMilliseconds',1788300000002,
    'dayContext',jsonb_build_object('localDay','2026-09-01','timeZoneId','UTC','calendarId','gregorian'))
);
select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000024',
  '20000000-0000-4000-8000-000000000021', 1, (select command from command_fixture)
)->>'kind', 'rejected', 'a correction cannot clear attention without a fresh correction check-in');
update command_fixture set command = jsonb_set(command, '{transition,kind}', '"attentionClearedReturnedToUsual"');
select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000025',
  '20000000-0000-4000-8000-000000000021', 1, (select command from command_fixture)
)->>'kind', 'applied', 'a current returned-to-usual response clears attention');
select is((select count(*) from kineo_private.attention_states where account_id = '10000000-0000-4000-8000-000000000021'),
  0::bigint, 'the valid return path clears server state');
select * from finish();
rollback;
