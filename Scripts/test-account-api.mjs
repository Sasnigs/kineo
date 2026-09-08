import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

// Local-only integration qualification. Credentials stay in memory, and every
// test account is removed in finally. Never point this runner at a cloud project.
const cli = process.env.KINEO_SUPABASE_CLI;
const status = JSON.parse(execFileSync(cli ?? 'npx', [
  ...(cli ? [] : ['--yes', 'supabase@2.117.0']), 'status', '-o', 'json',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const api = status.API_URL;
const mail = status.MAILPIT_URL ?? status.INBUCKET_URL;
assert.equal(api, 'http://127.0.0.1:54321', 'Only the dedicated localhost API is permitted');
assert.equal(mail, 'http://127.0.0.1:54324', 'Only the dedicated localhost mailbox is permitted');
const createdAccounts = new Set();
const password = 'Kineo integration test passphrase';
const email = `integration-${randomUUID()}@example.test`;
const installationId = randomUUID();
const secondsPerMinute = 60;
const millisecondsPerSecond = 1_000;
const requestTimeoutMilliseconds = secondsPerMinute * millisecondsPerSecond;
const initialHistoryEpoch = 1;
const initialDecisionRevision = 1;
const maliciousDoseSeconds = 9_999;
const accountOnly = process.argv.includes('--account-only');

async function request(path, { token, body, method = 'POST', expectedStatus } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { apikey: status.ANON_KEY, 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
  if (expectedStatus !== undefined) assert.equal(response.status, expectedStatus, `${path} status`);
  return { status: response.status, body: await response.json() };
}

try {
  const signup = accountOnly
    ? await request('/auth/v1/admin/users', { token: status.SERVICE_ROLE_KEY,
        body: { email, password, email_confirm: true }, expectedStatus: 200 })
    : await request('/auth/v1/signup', { body: { email, password }, expectedStatus: 200 });
  assert.ok(signup.body.id, 'Signup creates a pending identity');
  createdAccounts.add(signup.body.id);
  assert.equal(signup.body.access_token, undefined, 'Unverified signup does not grant a session');
  if (!accountOnly) {
  const messages = await (await fetch(`${mail}/api/v1/messages`)).json();
  const message = messages.messages.find((entry) => entry.To?.some((to) => to.Address === email));
  assert.ok(message, 'Verification email reached the local mail service');
  const detail = await (await fetch(`${mail}/api/v1/message/${message.ID}`)).json();
  const link = (detail.HTML ?? detail.Text).match(/https?:[^\s"<>]*\/auth\/v1\/verify\?[^\s"<>]+/u)?.[0];
  assert.ok(link, 'Verification email contains the Auth verification link');
  const verification = new URL(link.replaceAll('&amp;', '&'));
  assert.equal(verification.origin, api, 'Verification stays on localhost');
  const verified = await request('/auth/v1/verify', {
    body: { token_hash: verification.searchParams.get('token'), type: 'signup' }, expectedStatus: 200,
  });
  assert.ok(verified.body.access_token, 'Verification grants an authenticated session');
  }
  const login = await request('/auth/v1/token?grant_type=password', {
    body: { email, password }, expectedStatus: 200,
  });
  const token = login.body.access_token;
  assert.ok(token, 'Verified email can log in');
  console.log(accountOnly ? 'PASS local account password login' : 'PASS verified signup, local verification email, and password login');

  await request('/functions/v1/bootstrap', {
    body: { installationId, appVersion: 'integration', platformVersion: 'integration' }, expectedStatus: 401,
  });
  const boot = await request('/functions/v1/bootstrap', {
    token, body: { installationId, appVersion: 'integration', platformVersion: 'integration' }, expectedStatus: 200,
  });
  assert.equal(boot.body.account.accountId, signup.body.id, 'Bootstrap uses the verified account identity');
  assert.equal(boot.body.account.status, 'active');
  console.log('PASS authenticated bootstrap and anonymous rejection');

  const synchronizedCommand = async (command) => {
    const mutationId = randomUUID();
    const response = await request('/functions/v1/sync', { token, expectedStatus: 200, body: {
      installationId, mutations: [{ mutationId, installationId, historyEpoch: initialHistoryEpoch,
        createdAtMilliseconds: Date.now(), command }],
    } });
    return response.body;
  };
  const timestamp = Date.now();
  const decisionId = randomUUID();
  const checkIn = {
    id: randomUUID(), status: 'completed', kind: 'normal', primaryArea: 'neck',
    startedAtMilliseconds: timestamp, completedAtMilliseconds: timestamp,
    dayContext: { localDay: new Date(timestamp).toISOString().slice(0, 'YYYY-MM-DD'.length), timeZoneId: 'UTC', calendarId: 'gregorian' },
    entries: [{ id: randomUUID(), area: 'neck', role: 'primary', changeReport: 'similar',
      movementComfort: 'okay', submittedAtMilliseconds: timestamp }],
  };
  const unconsented = await synchronizedCommand({ kind: 'submitCheckIn', checkIn,
    decisionId, decisionRevision: initialDecisionRevision, durationVariant: 'standard' });
  assert.equal(unconsented.dispositions[0].kind, 'rejected', 'New accounts cannot submit wellness data before agreement and adult onboarding');
  for (const documentKind of ['termsOfService', 'privacyPolicy']) {
    const accepted = await synchronizedCommand({ kind: 'acceptLegal', acceptance: {
      documentKind, documentVersion: 'internal-prototype-2026-09-02', locale: 'en-US', acceptedAtMilliseconds: timestamp,
    } });
    assert.equal(accepted.dispositions[0].kind, 'applied');
  }
  const profile = await synchronizedCommand({ kind: 'saveProfile', expectedVersion: 0, profile: {
    adultAcknowledged: true, primaryArea: 'neck', weeklyGoalDays: 3, telemetryChoice: 'notOffered',
    onboardingCompletedAtMilliseconds: timestamp, safetyBoundaryVersion: 'safety-v1', safetyAcknowledgedAtMilliseconds: timestamp,
    createdAtMilliseconds: timestamp, updatedAtMilliseconds: timestamp,
  } });
  assert.equal(profile.dispositions[0].kind, 'applied');
  const selected = await synchronizedCommand({ kind: 'submitCheckIn', checkIn,
    decisionId, decisionRevision: initialDecisionRevision, durationVariant: 'standard' });
  assert.equal(selected.dispositions[0].kind, 'applied');
  const plan = selected.changes.find((change) => change.entityKind === 'selectionDecision' && change.entityId === decisionId)?.payload;
  assert.equal(plan?.selectedLevel, 'balanced', 'A similar/okay first check-in selects balanced');
  assert.ok(plan.snapshotTemplate.items.some((item) => item.kind === 'movement'), 'Server supplies canonical exercise content');
  const sessionId = randomUUID();
  const snapshot = { ...plan.snapshotTemplate, sessionId, compositionId: randomUUID() };
  const startCommand = (content) => {
    const json = JSON.stringify(content);
    return { kind: 'startRoutine', decisionId, decision: plan.canonicalDecision,
      routine: { id: sessionId, decisionId, checkInId: checkIn.id, status: 'prepared',
        currentStepIndex: 0, stepElapsedMilliseconds: 0, updatedAtMilliseconds: timestamp,
        dayContext: checkIn.dayContext, snapshot: { json,
          checksum: createHash('sha256').update(json).digest('hex'), includedAreas: content.includedAreas } },
    };
  };
  const tampered = structuredClone(snapshot);
  tampered.items.find((item) => item.kind === 'movement').scheduledDose = { kind: 'timed', seconds: maliciousDoseSeconds };
  const refused = await synchronizedCommand(startCommand(tampered));
  assert.equal(refused.dispositions[0].kind, 'rejected', 'Recomputed client checksum cannot authorize a changed dose');
  const started = await synchronizedCommand(startCommand(snapshot));
  assert.equal(started.dispositions[0].kind, 'applied', 'Exact server content can start');
  console.log('PASS canonical server routine and tampered-dose rejection');

  const feedbackCommand = (area = 'neck') => ({ kind: 'submitFeedback', submission: {
    id: randomUUID(), routineSessionId: sessionId, submittedAtMilliseconds: timestamp,
    dayContext: checkIn.dayContext, responses: [{ id: randomUUID(), area, response: 'same' }],
  } });
  const prematureFeedback = await synchronizedCommand(feedbackCommand());
  assert.equal(prematureFeedback.dispositions[0].kind, 'rejected', 'Unfinished routines cannot supply progression feedback');
  const eventCommand = (kind, resultingStatus, version, extra = {}) => ({ kind: 'recordRoutineEvent', event: {
    id: randomUUID(), routineSessionId: sessionId, kind, resultingStatus,
    sequenceNumber: version, expectedVersion: version, occurredAtMilliseconds: timestamp,
    resultingStepIndex: 0, resultingStepElapsedMilliseconds: 0, resultingUpdatedAtMilliseconds: timestamp,
    ...extra,
  } });
  const initialRoutineVersion = 1;
  const invalidCompletion = await synchronizedCommand(eventCommand('completed', 'completed', initialRoutineVersion,
    { resultingEndedAtMilliseconds: timestamp }));
  assert.equal(invalidCompletion.dispositions[0].kind, 'rejected', 'Prepared routines cannot be completed');
  const playing = await synchronizedCommand(eventCommand('started', 'inProgress', initialRoutineVersion,
    { resultingStartedAtMilliseconds: timestamp }));
  assert.equal(playing.dispositions[0].kind, 'applied');
  const playingVersion = initialRoutineVersion + 1;
  const rewind = await synchronizedCommand(eventCommand('paused', 'paused', playingVersion,
    { sequenceNumber: initialRoutineVersion }));
  assert.equal(rewind.dispositions[0].kind, 'rejected', 'Routine event sequence cannot rewind');
  const stopped = await synchronizedCommand(eventCommand('stopped', 'stopped', playingVersion,
    { resultingEndedAtMilliseconds: timestamp }));
  assert.equal(stopped.dispositions[0].kind, 'applied');
  const excludedFeedback = await synchronizedCommand(feedbackCommand('lowerBack'));
  assert.equal(excludedFeedback.dispositions[0].kind, 'rejected', 'Feedback cannot invent an undelivered body area');
  const feedback = await synchronizedCommand(feedbackCommand());
  assert.equal(feedback.dispositions[0].kind, 'applied');
  console.log('PASS routine lifecycle, event sequence, and delivered-area feedback enforcement');

  const prepared = await request('/functions/v1/delete-account', { token, body: {}, expectedStatus: 202 });
  assert.equal(prepared.body.kind, 'pending');
  await request('/auth/v1/user', { token, method: 'GET', expectedStatus: 200 });
  const beforeCommit = await request('/functions/v1/bootstrap', {
    token, body: { installationId, appVersion: 'integration', platformVersion: 'integration' }, expectedStatus: 200,
  });
  assert.equal(beforeCommit.body.account.status, 'active', 'Preparation must remain non-destructive');
  const capability = { jobId: prepared.body.jobId, resumeToken: prepared.body.resumeToken };
  const deleted = await request('/functions/v1/deletion-status', { body: capability, expectedStatus: 200 });
  assert.equal(deleted.body.kind, 'complete');
  const repeated = await request('/functions/v1/deletion-status', { body: capability, expectedStatus: 200 });
  assert.equal(repeated.body.kind, 'complete', 'Completion survives a lost response and absent Auth identity');
  const denied = await request('/auth/v1/user', { token, method: 'GET' });
  assert.notEqual(denied.status, 200, 'Deleted identity no longer authorizes user access');
  createdAccounts.delete(signup.body.id);
  console.log('PASS two-phase deletion and unauthenticated capability recovery');
} finally {
  for (const accountId of createdAccounts) {
    const cleanup = await request(`/auth/v1/admin/users/${accountId}`, {
      token: status.SERVICE_ROLE_KEY, method: 'DELETE',
    });
    if (![200, 404].includes(cleanup.status)) throw new Error('Local integration account cleanup failed');
  }
}
