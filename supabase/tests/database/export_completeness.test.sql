begin;
select no_plan();
insert into auth.users(id, email) values ('10000000-0000-4000-8000-000000000031', 'export-fixture@example.test');
select public.kineo_bootstrap_for_account('10000000-0000-4000-8000-000000000031',
  '20000000-0000-4000-8000-000000000031', 'test', 'test');
create temporary table prepared_export as select public.kineo_prepare_export_for_account(
  '10000000-0000-4000-8000-000000000031', repeat('a', 64), clock_timestamp() + interval '15 minutes') as job;
create temporary table downloaded_export as select public.kineo_consume_export_for_account(
  '10000000-0000-4000-8000-000000000031', (job->>'jobId')::uuid, repeat('a', 64)) as payload
  from prepared_export;
select ok((select payload ?& array['identity', 'deviceInstallations', 'attentionStates', 'pauseTodayEvents',
  'selectionDecisions', 'decisionAreaInputs', 'decisionReasonRecords', 'feedbackSubmissions'] from downloaded_export),
  'structured export includes all personal domain records and account metadata');
select is((select payload#>>'{identity,email}' from downloaded_export), 'export-fixture@example.test',
  'the export identifies its owner without duplicating email in profile tables');
select ok(not (select payload->'identity' ?| array['encrypted_password', 'recovery_token', 'confirmation_token']
  from downloaded_export), 'credential material is never exported');
insert into kineo_private.export_jobs(account_id, status, export_payload, download_token_hash, expires_at)
  values ('10000000-0000-4000-8000-000000000031', 'ready', '{"fixture":"expired"}', repeat('b', 64), clock_timestamp() - interval '1 second');
select kineo_private.expire_export_payloads();
select is((select count(*) from kineo_private.export_jobs where account_id = '10000000-0000-4000-8000-000000000031'
  and expires_at <= clock_timestamp() and (export_payload is not null or download_token_hash is not null)),
  0::bigint, 'expired archives and their download hashes are removed');
select * from finish();
rollback;
