begin;
select no_plan();

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000011');
insert into auth.sessions(id, user_id) values (
  '70000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011'
);
select public.kineo_bootstrap_for_account(
  '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000011', 'test', 'test'
);
create temporary table deletion_fixture as select public.kineo_begin_deletion_for_account(
  '10000000-0000-4000-8000-000000000011', repeat('a', 64)
) as job;

select is((select status from kineo_private.accounts where id = '10000000-0000-4000-8000-000000000011'),
  'active', 'lost preparation response does not disable the account');
select is((select count(*) from auth.sessions where user_id = '10000000-0000-4000-8000-000000000011'),
  1::bigint, 'preparation does not revoke sessions before recovery is saved');
select throws_ok($$select public.kineo_commit_deletion(
  (select (job->>'jobId')::uuid from deletion_fixture), repeat('b', 64)
)$$, '28000', 'deletion_unavailable', 'wrong recovery token cannot commit deletion');
select lives_ok($$select public.kineo_commit_deletion(
  (select (job->>'jobId')::uuid from deletion_fixture), repeat('a', 64)
)$$, 'saved capability commits deletion');
select is((select count(*) from auth.sessions where user_id = '10000000-0000-4000-8000-000000000011'),
  0::bigint, 'Auth sessions are revoked before domain removal');
select is((select status from kineo_private.accounts where id = '10000000-0000-4000-8000-000000000011'),
  'deleting', 'domain data remains present behind the deleting gate until removal');
select ok((select revoked_at is not null from kineo_private.device_installations
  where account_id = '10000000-0000-4000-8000-000000000011'), 'installations are revoked before domain removal');
select lives_ok($$select public.kineo_delete_domain_for_account(
  '10000000-0000-4000-8000-000000000011', (select (job->>'jobId')::uuid from deletion_fixture)
)$$, 'domain deletion succeeds after revocation');
select lives_ok($$select public.kineo_commit_deletion(
  (select (job->>'jobId')::uuid from deletion_fixture), repeat('a', 64)
)$$, 'recovery is idempotent after domain removal');
delete from auth.users where id = '10000000-0000-4000-8000-000000000011';
select public.kineo_complete_deletion((select (job->>'jobId')::uuid from deletion_fixture), repeat('a', 64));
select is(public.kineo_deletion_job_by_token((select (job->>'jobId')::uuid from deletion_fixture), repeat('a', 64))->>'status',
  'complete', 'lost completion response can be recovered without Auth identity');
select * from finish();
rollback;
