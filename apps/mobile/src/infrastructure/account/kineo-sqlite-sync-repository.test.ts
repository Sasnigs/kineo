/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import { buildAuthoritativePlan } from '../../core/account/authoritative-plan';
import { KineoSyncModule } from '../../application/account/kineo-sync-module';
import { parseCheckInEntryId, parseCheckInId } from '../../core/domain/selection-domain';
import type { PendingMutation, SyncChange } from '../../core/account/sync-contract';
import { parseLocalDay, type CheckIn } from '../../core/persistence/persistence-domain';
import { encodeRoutineSnapshot, type RoutineSession } from '../../core/persistence/routine-persistence-domain';
import { migrateKineoDatabase } from '../persistence/kineo-schema';
import { KineoSqliteStore } from '../persistence/kineo-sqlite-store';
import { NodeSqliteTestDatabase } from '../persistence/testing/node-sqlite-test-database';
import { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';
import { AccountAwareKineoStore } from './account-aware-kineo-store';

const accountId = '10000000-0000-4000-8000-000000000001';
const otherAccountId = '10000000-0000-4000-8000-000000000002';
const installationId = '20000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;
const mutation: PendingMutation = {
  mutationId: '30000000-0000-4000-8000-000000000001',
  accountId,
  installationId,
  historyEpoch: 1,
  createdAtMilliseconds: nowMilliseconds,
  command: { kind: 'resetHistory' },
};
const checkInId = required(parseCheckInId('40000000-0000-4000-8000-000000000001'));
const entryId = required(parseCheckInEntryId('50000000-0000-4000-8000-000000000001'));
const safetyEventId = '60000000-0000-4000-8000-000000000001';
const otherInstallationId = '20000000-0000-4000-8000-000000000002';
const routineId = '70000000-0000-4000-8000-000000000001';
const decisionId = '80000000-0000-4000-8000-000000000001';
const startedEventId = '90000000-0000-4000-8000-000000000001';
const stoppedEventId = '90000000-0000-4000-8000-000000000002';
const stoppedAtMilliseconds = nowMilliseconds + 60_000;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) throw new Error('Invalid sync fixture.');
  return result.value;
}

function routineFixture() {
  const checkIn: CheckIn = {
    id: checkInId, status: 'completed', kind: 'normal', primaryArea: 'neck',
    startedAtMilliseconds: nowMilliseconds, completedAtMilliseconds: nowMilliseconds,
    dayContext: { localDay: required(parseLocalDay('2026-09-02')), timeZoneId: 'America/Chicago', calendarId: 'gregorian' },
    entries: [{ id: entryId, area: 'neck', role: 'primary', changeReport: 'similar',
      movementComfort: 'good', submittedAtMilliseconds: nowMilliseconds }],
  };
  const result = buildAuthoritativePlan({ checkIn, decisionId: decisionId as never,
    revision: 1, duration: 'quick', attentionRequiredAreas: [], orderedOutcomes: [],
    createdAtMilliseconds: nowMilliseconds });
  if (!result.ok || result.value.kind !== 'approved') throw new Error('Invalid routine fixture.');
  const decision = result.value.decision;
  const session: RoutineSession = {
    id: routineId as never, decisionId: decision.id, checkInId: checkIn.id,
    status: 'prepared', snapshot: encodeRoutineSnapshot({ ...result.value.snapshotTemplate,
      sessionId: routineId as never }), currentStepIndex: 0, stepElapsedMilliseconds: 0,
    updatedAtMilliseconds: nowMilliseconds, dayContext: checkIn.dayContext,
  };
  const started = { id: startedEventId, routineSessionId: routineId, sequenceNumber: 1,
    kind: 'started', occurredAtMilliseconds: nowMilliseconds, resultingStatus: 'inProgress',
    resultingStepIndex: 0, resultingStepElapsedMilliseconds: 0,
    resultingUpdatedAtMilliseconds: nowMilliseconds };
  const stopped = { id: stoppedEventId, routineSessionId: routineId, sequenceNumber: 2,
    kind: 'stopped', occurredAtMilliseconds: stoppedAtMilliseconds, resultingStatus: 'stopped',
    resultingStepIndex: 0, resultingStepElapsedMilliseconds: 0,
    resultingUpdatedAtMilliseconds: stoppedAtMilliseconds,
    resultingEndedAtMilliseconds: stoppedAtMilliseconds };
  return { checkIn, decision, session, started, stopped };
}

function change(cursor: string, entityKind: string, entityId: string, payload: unknown): SyncChange {
  return { cursor, entityKind, entityId, operation: 'upsert', payload };
}

async function hydrate(repository: KineoSqliteSyncRepository, changes: SyncChange[], hasMore = false) {
  return repository.applyBootstrapPage({
    account: { accountId, status: 'active', historyEpoch: 1, legalAcceptances: [] },
    changes, nextCursor: changes.at(-1)?.cursor, hasMore,
  });
}

function accountStore(database: NodeSqliteTestDatabase, repository: KineoSqliteSyncRepository,
  serverChanges: SyncChange[]) {
  const base = Object.assign(new KineoSqliteStore(database), {
    async deleteAllData() { return { ok: false as const, error: { code: 'deletionFailed' as const } }; },
  });
  const sync = new KineoSyncModule(accountId, installationId, {
    async bootstrap() { return { ok: false, error: { code: 'offline' } }; },
    async synchronize(request) {
      return { ok: true, value: { accountStatus: 'active', historyEpoch: 1,
        dispositions: request.mutations.map(({ mutationId }) => ({ mutationId, kind: 'applied' as const })),
        changes: serverChanges, nextCursor: serverChanges.at(-1)?.cursor, hasMore: false } };
    },
  }, repository);
  return new AccountAwareKineoStore(base, accountId, installationId, sync, repository,
    () => mutation.mutationId, () => nowMilliseconds, false,
    { async commit() { throw new Error('Online-authoritative commands do not write optimistically.'); } });
}

async function fixture() {
  const database = new NodeSqliteTestDatabase();
  await migrateKineoDatabase(database, nowMilliseconds);
  const repository = new KineoSqliteSyncRepository(
    database,
    accountId,
    installationId,
  );
  await repository.initialize(nowMilliseconds);
  return { database, repository };
}

describe('KineoSqliteSyncRepository', () => {
  it('hydrates minimum attention after reset and quarantines every pre-reset pending mutation', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    await repository.enqueue(mutation);
    const retainedAttention = [{ area: 'neck', updatedAtMilliseconds: nowMilliseconds }];
    expect(await repository.applyBootstrapPage({
      account: { accountId, status: 'active', historyEpoch: 2, legalAcceptances: [] },
      changes: [{ cursor: '10', entityKind: 'history', entityId: accountId, operation: 'reset',
        payload: { historyEpoch: 2, attentionStates: retainedAttention } }],
      nextCursor: '10', hasMore: false,
    })).toEqual({ ok: true, value: undefined });
    expect(await store.loadAttentionStates()).toEqual({ ok: true, value: retainedAttention });
    expect(await repository.pendingMutations()).toEqual({ ok: true, value: [] });
    expect(await repository.loadAccount()).toMatchObject({ ok: true, value: { historyEpoch: 2 } });
    const { checkIn } = routineFixture();
    expect(await hydrate(repository, [change('1', 'checkIn', checkInId, checkIn)]))
      .toEqual({ ok: false, error: { code: 'localPersistence' } });
    expect(await store.loadCheckIn(checkIn.id)).toEqual({ ok: true, value: undefined });
    await database.closeAsync();
  });

  it('rolls back reset when the retained attention snapshot is missing or malformed', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const { checkIn } = routineFixture();
    await hydrate(repository, [change('1', 'checkIn', checkInId, checkIn)]);
    for (const attentionStates of [undefined, [{ area: 'unknown', updatedAtMilliseconds: nowMilliseconds }]]) {
      expect(await repository.applyBootstrapPage({
        account: { accountId, status: 'active', historyEpoch: 2, legalAcceptances: [] },
        changes: [{ cursor: '2', entityKind: 'history', entityId: accountId, operation: 'reset',
          payload: { historyEpoch: 2, attentionStates } }], nextCursor: '2', hasMore: false,
      })).toEqual({ ok: false, error: { code: 'localPersistence' } });
    }
    expect(await store.loadCheckIn(checkIn.id)).toEqual({ ok: true, value: checkIn });
    expect(await repository.loadCursor()).toEqual({ ok: true, value: '1' });
    await database.closeAsync();
  });

  it('does not re-enter attention when an old safety event page is replayed', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const { checkIn } = routineFixture();
    const entered = change('2', 'safetyEvent', safetyEventId, { id: safetyEventId,
      area: 'neck', kind: 'attentionEntered', sourceCheckInEntryId: entryId,
      occurredAtMilliseconds: nowMilliseconds, dayContext: checkIn.dayContext, statusAfter: 'attentionRequired' });
    expect(await hydrate(repository, [change('1', 'checkIn', checkInId, checkIn), entered]))
      .toEqual({ ok: true, value: undefined });
    const returnedId = '60000000-0000-4000-8000-000000000002';
    expect(await hydrate(repository, [change('3', 'safetyEvent', returnedId, { id: returnedId,
      area: 'neck', kind: 'attentionClearedReturnedToUsual', returnAnswer: 'yes', occurredAtMilliseconds: stoppedAtMilliseconds,
      dayContext: checkIn.dayContext, statusAfter: 'normal' })]))
      .toEqual({ ok: true, value: undefined });
    expect(await hydrate(repository, [entered])).toEqual({ ok: true, value: undefined });
    expect(await store.loadAttentionStates()).toEqual({ ok: true, value: [] });
    await database.closeAsync();
  });

  it('uses the projected correction result without replaying a stale local safety transition', async () => {
    const { database, repository } = await fixture();
    const base = new KineoSqliteStore(database);
    const { checkIn: original } = routineFixture();
    const checkIn: CheckIn = { ...original, kind: 'attentionCorrection',
      correctionSource: { area: 'neck' } };
    const event = { id: safetyEventId, area: 'neck', kind: 'attentionClearedCorrection',
      sourceCheckInEntryId: entryId, occurredAtMilliseconds: nowMilliseconds,
      dayContext: checkIn.dayContext };
    const store = accountStore(database, repository, [
      change('1', 'checkIn', checkInId, checkIn),
      change('2', 'safetyEvent', safetyEventId, { ...event, statusAfter: 'normal' }),
    ]);
    // The server timestamp is authoritative and may normalize the supplied timestamp.
    expect(await store.completeCheckIn(checkIn, [{ event: { ...event,
      occurredAtMilliseconds: nowMilliseconds + 1 }, statusAfter: 'normal',
      expectedAttentionUpdatedAtMilliseconds: nowMilliseconds - 1 } as never]))
      .toEqual({ ok: true, value: undefined });
    expect(await base.loadCheckIn(checkIn.id)).toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(await base.loadSafetyEvent(safetyEventId as never)).toMatchObject({ ok: true,
      value: { occurredAtMilliseconds: nowMilliseconds } });
    expect(await base.loadAttentionStates()).toEqual({ ok: true, value: [] });
    await database.closeAsync();
  });

  it('creates a routine through the account store exactly once after server projection', async () => {
    const { database, repository } = await fixture();
    const { checkIn, decision, session } = routineFixture();
    expect(await hydrate(repository, [change('1', 'checkIn', checkInId, checkIn),
      change('2', 'selectionDecision', decisionId, decision)]))
      .toEqual({ ok: true, value: undefined });
    const store = accountStore(database, repository, [change('3', 'routineSession', routineId,
      { ownerInstallationId: installationId, routine: session })]);
    expect(await store.createRoutine(session)).toEqual({ ok: true, value: undefined });
    expect(await store.loadRoutineSession(session.id)).toEqual({ ok: true, value: session });
    await database.closeAsync();
  });

  it('keeps the canonical server plan explanation available before a routine starts', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const { checkIn, decision } = routineFixture();
    expect(await hydrate(repository, [change('1', 'checkIn', checkInId, checkIn),
      change('2', 'selectionDecision', decisionId, { canonicalDecision: decision })]))
      .toEqual({ ok: true, value: undefined });
    expect(await store.loadLatestSelectionDecision(checkIn.id)).toEqual({ ok: true, value: decision });
    const account = accountStore(database, repository, []);
    expect(await account.appendSelectionDecision({ ...decision,
      createdAtMilliseconds: stoppedAtMilliseconds }))
      .toEqual({ ok: true, value: undefined });
    expect(await account.appendSelectionDecision({ ...decision, recommendedLevel: 'active' }))
      .toEqual({ ok: false, error: { code: 'conflictingWrite' } });
    expect(await account.loadLatestSelectionDecision(checkIn.id)).toEqual({ ok: true, value: decision });
    expect(await account.completeCheckIn(checkIn, [])).toEqual({ ok: true, value: undefined });
    expect(await account.completeCheckIn({ ...checkIn,
      entries: checkIn.entries.map((entry) => ({ ...entry, changeReport: 'better' })) }, []))
      .toEqual({ ok: false, error: { code: 'conflictingWrite' } });
    await database.closeAsync();
  });

  it('rolls back an out-of-order routine page and accepts a complete retry', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const { checkIn, decision, session, started, stopped } = routineFixture();
    const initial = [change('1', 'checkIn', checkInId, checkIn),
      change('2', 'selectionDecision', decisionId, decision),
      change('3', 'routineSession', routineId, { ownerInstallationId: otherInstallationId, routine: session })];
    expect(await hydrate(repository, [...initial, change('5', 'routineEvent', stoppedEventId, stopped)]))
      .toEqual({ ok: false, error: { code: 'localPersistence' } });
    expect(await store.loadRoutineSession(session.id)).toEqual({ ok: true, value: undefined });
    expect(await repository.loadCursor()).toEqual({ ok: true, value: undefined });
    expect(await hydrate(repository, [...initial,
      change('4', 'routineEvent', startedEventId, started), change('5', 'routineEvent', stoppedEventId, stopped)]))
      .toEqual({ ok: true, value: undefined });
    expect(await store.loadRoutineSession(session.id)).toMatchObject({ ok: true, value: { status: 'stopped' } });
    await database.closeAsync();
  });

  it('does not rewind a newer local checkpoint when older server events and snapshots echo back', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const { checkIn, decision, session, started, stopped } = routineFixture();
    const firstPage = [change('1', 'checkIn', checkInId, checkIn),
      change('2', 'selectionDecision', decisionId, decision),
      change('3', 'routineSession', routineId, { ownerInstallationId: installationId, routine: session }),
      change('4', 'routineEvent', startedEventId, started)];
    expect(await hydrate(repository, firstPage)).toEqual({ ok: true, value: undefined });
    expect(await store.recordRoutineEvent(stopped as never, {
      status: 'stopped', currentStepIndex: 0, stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: stoppedAtMilliseconds, endedAtMilliseconds: stoppedAtMilliseconds,
    })).toEqual({ ok: true, value: undefined });
    expect(await hydrate(repository, firstPage)).toEqual({ ok: true, value: undefined });
    expect(await store.loadRoutineSession(session.id)).toMatchObject({ ok: true,
      value: { status: 'stopped', endedAtMilliseconds: stoppedAtMilliseconds } });
    expect(await store.loadRoutineEvents(session.id)).toMatchObject({ ok: true,
      value: [{ id: startedEventId }, { id: stoppedEventId }] });
    await database.closeAsync();
  });

  it('hydrates another installation’s complete routine audit across pages without inventing timestamps', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const { checkIn, decision, session, started, stopped } = routineFixture();
    expect(await hydrate(repository, [
      change('1', 'checkIn', checkInId, checkIn),
      change('2', 'selectionDecision', decisionId, decision),
      change('3', 'routineSession', routineId, { ownerInstallationId: otherInstallationId, routine: session }),
      change('4', 'routineEvent', startedEventId, started),
    ], true)).toEqual({ ok: true, value: undefined });
    expect(await store.loadRoutineSession(session.id)).toMatchObject({ ok: true,
      value: { status: 'inProgress', startedAtMilliseconds: nowMilliseconds } });
    expect(await store.loadLatestSelectionDecision(checkIn.id)).toEqual({ ok: true, value: decision });
    expect(await hydrate(repository, [change('5', 'routineEvent', stoppedEventId, stopped)]))
      .toEqual({ ok: true, value: undefined });
    const events = await store.loadRoutineEvents(session.id);
    expect(events.ok && events.value.map((event) => event.id)).toEqual([startedEventId, stoppedEventId]);
    expect(await store.loadRoutineSession(session.id)).toMatchObject({ ok: true,
      value: { status: 'stopped', startedAtMilliseconds: nowMilliseconds,
        endedAtMilliseconds: stoppedAtMilliseconds } });
    await database.closeAsync();
  });

  it('replaces a local draft with the authoritative completed check-in on retry', async () => {
    const { database, repository } = await fixture();
    const store = new KineoSqliteStore(database);
    const completed: CheckIn = {
      id: checkInId, status: 'completed', kind: 'normal', primaryArea: 'neck',
      startedAtMilliseconds: nowMilliseconds, completedAtMilliseconds: nowMilliseconds,
      dayContext: { localDay: required(parseLocalDay('2026-09-02')), timeZoneId: 'America/Chicago', calendarId: 'gregorian' },
      entries: [{ id: entryId, area: 'neck', role: 'primary', changeReport: 'similar',
        movementComfort: 'good', submittedAtMilliseconds: nowMilliseconds }],
    };
    expect(await store.saveCheckInDraft({ ...completed, status: 'draft',
      completedAtMilliseconds: undefined, entries: [] })).toEqual({ ok: true, value: undefined });
    const page = {
      account: { accountId, status: 'active' as const, historyEpoch: 1, legalAcceptances: [] },
      changes: [{ cursor: '1', entityKind: 'checkIn', entityId: checkInId,
        operation: 'upsert' as const, payload: completed }],
      nextCursor: '1', hasMore: false,
    };
    expect(await repository.applyBootstrapPage(page)).toEqual({ ok: true, value: undefined });
    expect(await repository.applyBootstrapPage(page)).toEqual({ ok: true, value: undefined });
    expect(await store.loadCheckIn(completed.id)).toEqual({ ok: true, value: completed });
    await database.closeAsync();
  });

  it('does not authorize an offline cache until the final hydration page commits', async () => {
    const { database, repository } = await fixture();
    const account = { accountId, status: 'active' as const, historyEpoch: 1, legalAcceptances: [] };
    expect(await repository.isHydrated()).toEqual({ ok: true, value: false });
    await repository.applyBootstrapPage({ account, changes: [], nextCursor: '1', hasMore: true });
    expect(await repository.isHydrated()).toEqual({ ok: true, value: false });
    await repository.applyBootstrapPage({ account, changes: [], nextCursor: '2', hasMore: false });
    expect(await repository.isHydrated()).toEqual({ ok: true, value: true });
    // A later interrupted refresh must not disable an already complete cache.
    await repository.applyBootstrapPage({ account, changes: [], nextCursor: '3', hasMore: true });
    expect(await repository.isHydrated()).toEqual({ ok: true, value: true });
    await database.closeAsync();
  });

  it('binds one account and rejects a different owner', async () => {
    const { database } = await fixture();
    const other = new KineoSqliteSyncRepository(
      database,
      otherAccountId,
      installationId,
    );
    await expect(other.initialize(nowMilliseconds)).resolves.toEqual({
      ok: false,
      error: { code: 'localPersistence' },
    });
    await database.closeAsync();
  });

  it('round-trips valid outbox mutations and rejects identifier collisions', async () => {
    const { database, repository } = await fixture();
    await expect(repository.enqueue(mutation)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(repository.pendingMutations()).resolves.toEqual({
      ok: true,
      value: [mutation],
    });
    await expect(repository.enqueue({
      ...mutation,
      command: {
        kind: 'startRoutine',
        decisionId: 'decision',
        decision: {},
        routine: {},
      },
    })).resolves.toEqual({
      ok: false,
      error: { code: 'localPersistence' },
    });
    await database.closeAsync();
  });

  it('applies bootstrap state, legal acceptance, and cursor atomically', async () => {
    const { database, repository } = await fixture();
    await expect(repository.applyBootstrapPage({
      account: {
        accountId,
        status: 'active',
        historyEpoch: 1,
        legalAcceptances: [{
          documentKind: 'privacyPolicy',
          documentVersion: '2026-09-02',
          locale: 'en-US',
          acceptedAtMilliseconds: nowMilliseconds,
        }],
      },
      changes: [{
        cursor: '12',
        entityKind: 'profile',
        entityId: accountId,
        operation: 'upsert',
        payload: {
          adultAcknowledged: false,
          weeklyGoalDays: 3,
          telemetryChoice: 'notOffered',
          createdAtMilliseconds: nowMilliseconds,
          updatedAtMilliseconds: nowMilliseconds,
        },
      }],
      nextCursor: '12',
      hasMore: false,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(repository.loadCursor()).resolves.toEqual({
      ok: true,
      value: '12',
    });
    const loaded = await repository.loadAccount();
    expect(loaded.ok && loaded.value?.legalAcceptances).toHaveLength(1);
    await database.closeAsync();
  });

  it('marks conflicts and acknowledges idempotent success', async () => {
    const { database, repository } = await fixture();
    await repository.enqueue(mutation);
    await repository.applySyncPage({
      accountStatus: 'active', historyEpoch: 1, changes: [], hasMore: false,
      dispositions: [{
        mutationId: mutation.mutationId,
        kind: 'conflict',
        authoritativeVersion: 2,
      }],
    }, [mutation]);
    await expect(repository.pendingMutationCount()).resolves.toEqual({
      ok: true,
      value: 0,
    });
    await database.closeAsync();
  });

  it.each(['invalidCommand', 'staleHistoryEpoch', 'installationRevoked',
    'routineOwnedByAnotherInstallation', 'accountDeleting'] as const)(
    'quarantines %s so a rejected mutation cannot retry forever', async (code) => {
      const { database, repository } = await fixture();
      await repository.enqueue(mutation);
      expect(await repository.applySyncPage({
        accountStatus: 'active', historyEpoch: 1, changes: [], hasMore: false,
        dispositions: [{ mutationId: mutation.mutationId, kind: 'rejected', code }],
      }, [mutation])).toEqual({ ok: true, value: undefined });
      expect(await repository.pendingMutations()).toEqual({ ok: true, value: [] });
      // Re-enqueuing an identical command must not reactivate its rejected intent.
      await repository.enqueue(mutation);
      expect(await repository.pendingMutationCount()).toEqual({ ok: true, value: 0 });
      await database.closeAsync();
    },
  );

  it('projects hydrated profile, check-in, and attention state locally', async () => {
    const { database, repository } = await fixture();
    const dayContext = {
      localDay: '2026-09-02',
      timeZoneId: 'America/Chicago',
      calendarId: 'gregorian',
    };
    const checkIn = {
      id: checkInId,
      status: 'completed',
      kind: 'normal',
      primaryArea: 'neck',
      startedAtMilliseconds: nowMilliseconds,
      completedAtMilliseconds: nowMilliseconds,
      dayContext,
      entries: [{
        id: entryId,
        area: 'neck',
        role: 'primary',
        changeReport: 'worse',
        movementComfort: 'limited',
        conditionalSafetyAnswer: 'notSure',
        submittedAtMilliseconds: nowMilliseconds,
      }],
    };
    await expect(repository.applyBootstrapPage({
      account: {
        accountId,
        status: 'active',
        historyEpoch: 1,
        legalAcceptances: [],
      },
      changes: [
        {
          cursor: '1',
          entityKind: 'profile',
          entityId: accountId,
          operation: 'upsert',
          payload: {
            onboardingCompletedAtMilliseconds: nowMilliseconds,
            adultAcknowledged: true,
            safetyBoundaryVersion: 'safety-v1',
            safetyAcknowledgedAtMilliseconds: nowMilliseconds,
            primaryArea: 'neck',
            weeklyGoalDays: 3,
            telemetryChoice: 'notOffered',
            createdAtMilliseconds: nowMilliseconds,
            updatedAtMilliseconds: nowMilliseconds,
          },
        },
        {
          cursor: '2',
          entityKind: 'checkIn',
          entityId: checkInId,
          operation: 'upsert',
          payload: checkIn,
        },
        {
          cursor: '3',
          entityKind: 'safetyEvent',
          entityId: safetyEventId,
          operation: 'upsert',
          payload: {
            id: safetyEventId,
            area: 'neck',
            kind: 'attentionEntered',
            sourceCheckInEntryId: entryId,
            occurredAtMilliseconds: nowMilliseconds,
            dayContext,
            statusAfter: 'attentionRequired',
          },
        },
      ],
      nextCursor: '3',
      hasMore: false,
    })).resolves.toEqual({ ok: true, value: undefined });

    const store = new KineoSqliteStore(database);
    const profile = await store.loadProfileState();
    const loadedCheckIn = await store.loadCheckIn(checkInId as never);
    const attention = await store.loadAttentionStates();
    expect(profile.ok && profile.value?.profile.primaryArea).toBe('neck');
    expect(loadedCheckIn.ok && loadedCheckIn.value?.entries).toHaveLength(1);
    expect(attention.ok && attention.value).toEqual([
      { area: 'neck', updatedAtMilliseconds: nowMilliseconds },
    ]);
    await database.closeAsync();
  });

  it('advances the reset epoch and removes stale offline mutations', async () => {
    const { database, repository } = await fixture();
    await repository.enqueue(mutation);
    await expect(repository.resetForHistoryEpoch(2)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(repository.pendingMutations()).resolves.toEqual({
      ok: true,
      value: [],
    });
    const account = await repository.loadAccount();
    expect(account.ok && account.value?.historyEpoch).toBe(2);
    await database.closeAsync();
  });
});
