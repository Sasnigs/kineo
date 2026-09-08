begin;
select no_plan();

-- Fixtures exist only inside this rolled-back test transaction.
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');

select lives_ok($$select public.kineo_bootstrap_for_account(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 'test', 'test'
)$$, 'bootstrap registers the fixture installation');

select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1,
  '{"kind":"acceptLegal","acceptance":{"documentKind":"privacyPolicy","documentVersion":"test","locale":"en-US","acceptedAtMilliseconds":1788300000000}}'
)->>'kind', 'applied', 'typed legal command applies');

select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 1,
  '{"kind":"acceptLegal","acceptance":{"documentKind":"privacyPolicy","documentVersion":"test","locale":"en-US","acceptedAtMilliseconds":1788300000000}}'
)->>'kind', 'duplicate', 'retry does not apply the command twice');

select is((select count(*) from kineo_private.account_changes
  where account_id = '10000000-0000-4000-8000-000000000001'),
  1::bigint, 'duplicate receipt produces no extra feed event');

select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001', 1,
  '{"kind":"resetHistory"}'
)->>'code', 'installationRevoked', 'another account cannot use this installation');

select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001', 1,
  '{"kind":"resetHistory"}'
)->>'kind', 'applied', 'reset is accepted at the current epoch');

select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000001', 1,
  '{"kind":"resetHistory"}'
)->>'code', 'staleHistoryEpoch', 'new old-epoch mutations cannot resurrect history');

select is(public.kineo_apply_mutation_for_account(
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001', 1,
  '{"kind":"resetHistory"}'
)->>'kind', 'duplicate', 'a lost reset response can be safely retried');

-- Export authorization and consumption run against the real transactional function.
create temporary table export_fixture as
select public.kineo_prepare_export_for_account(
  '10000000-0000-4000-8000-000000000001', repeat('a', 64),
  clock_timestamp() + interval '15 minutes'
) as job;

select throws_ok($$select public.kineo_consume_export_for_account(
  '10000000-0000-4000-8000-000000000002',
  (select (job->>'jobId')::uuid from export_fixture), repeat('a', 64)
)$$, '28000', 'export_unavailable', 'a different account cannot consume an export');

select is(public.kineo_consume_export_for_account(
  '10000000-0000-4000-8000-000000000001',
  (select (job->>'jobId')::uuid from export_fixture), repeat('a', 64)
)->>'formatVersion', 'kineo-export-v1', 'authorized export returns its payload before clearing it');

select throws_ok($$select public.kineo_consume_export_for_account(
  '10000000-0000-4000-8000-000000000001',
  (select (job->>'jobId')::uuid from export_fixture), repeat('a', 64)
)$$, '28000', 'export_unavailable', 'a consumed export cannot be downloaded twice');

select is((select export_payload from kineo_private.export_jobs
  where id = (select (job->>'jobId')::uuid from export_fixture)),
  null::jsonb, 'consumption removes the sensitive server payload');

-- Enumerate every product table: future tables must preserve the same boundary.
select ok(not has_table_privilege(client_role, relation.oid, privilege),
  format('%s cannot %s %s', client_role, privilege, relation.relname))
from pg_class relation
cross join unnest(array['anon', 'authenticated']) client_role
cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
where relation.relnamespace = 'kineo_private'::regnamespace
  and relation.relkind = 'r';

select ok(relation.relrowsecurity, format('RLS is enabled on %s', relation.relname))
from pg_class relation
where relation.relnamespace = 'kineo_private'::regnamespace
  and relation.relkind = 'r';

select ok(not has_function_privilege(client_role, routine.oid, 'EXECUTE'),
  format('%s cannot execute %s directly', client_role, routine.proname))
from pg_proc routine
cross join unnest(array['anon', 'authenticated']) client_role
where routine.pronamespace = 'public'::regnamespace
  and routine.proname like 'kineo_%';

select * from finish();
rollback;
