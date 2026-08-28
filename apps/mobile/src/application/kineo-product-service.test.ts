/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import { KineoSqliteStore } from '../infrastructure/persistence/kineo-sqlite-store';
import { migrateKineoDatabase } from '../infrastructure/persistence/kineo-schema';
import { ProtectedKineoStore } from '../infrastructure/persistence/protected-kineo-store';
import { NodeSqliteTestDatabase } from '../infrastructure/persistence/testing/node-sqlite-test-database';
import { KineoProductService } from './kineo-product-service';
import type {
  ReminderAuthorization,
  ReminderScheduling,
  ReminderResult,
} from '../core/product/reminder-scheduling';
import type { ReminderWindow } from '../core/persistence/persistence-domain';

const initialTimestamp = 1_750_000_000_000;
const nextTimestamp = initialTimestamp + 1;
const checkInId = '00000000-0000-0000-0000-000000000101';
const primaryEntryId = '00000000-0000-0000-0000-000000000102';
const secondaryEntryId = '00000000-0000-0000-0000-000000000103';
const restoredPrimaryEntryId = '00000000-0000-0000-0000-000000000104';
const restoredSecondaryEntryId = '00000000-0000-0000-0000-000000000105';
const secondRestoredPrimaryEntryId = '00000000-0000-0000-0000-000000000106';
const secondRestoredSecondaryEntryId = '00000000-0000-0000-0000-000000000107';
const firstGeneratedIdentifier = 101;
const lastGeneratedIdentifier = 199;
const uuidSuffixLength = 12;
const localDay = '2025-06-15';
const followingLocalDay = '2025-06-16';
const firstElapsedIncrementMilliseconds = 1_500;
const pausedClockIncrementMilliseconds = 8_000;
const morningReminderWindow = Object.freeze({
  startMinutes: 8 * 60,
  endMinutes: 9 * 60,
});

class FakeReminderScheduler implements ReminderScheduling {
  authorization: ReminderAuthorization = 'notDetermined';
  requestResult: ReminderResult<ReminderAuthorization> = {
    ok: true,
    value: 'authorized',
  };
  scheduleResult: ReminderResult<void> = { ok: true, value: undefined };
  cancelResult: ReminderResult<void> = { ok: true, value: undefined };
  scheduledWindow?: ReminderWindow;
  scheduledTimeZoneId?: string;
  cancelCount = 0;

  async authorizationStatus(): Promise<ReminderAuthorization> {
    return this.authorization;
  }

  async requestAuthorization(): Promise<ReminderResult<ReminderAuthorization>> {
    if (this.requestResult.ok) this.authorization = this.requestResult.value;
    return this.requestResult;
  }

  async replaceDailyReminder(
    window: ReminderWindow,
    timeZoneId: string,
  ): Promise<ReminderResult<void>> {
    this.scheduledWindow = window;
    this.scheduledTimeZoneId = timeZoneId;
    return this.scheduleResult;
  }

  async cancelAll(): Promise<ReminderResult<void>> {
    this.cancelCount += 1;
    return this.cancelResult;
  }
}

async function makeService() {
  const database = new NodeSqliteTestDatabase();
  const migrated = await migrateKineoDatabase(database, initialTimestamp);
  if (!migrated.ok) throw new Error('Product-service migration failed.');
  let timestamp = initialTimestamp;
  let monotonicMilliseconds = 0;
  let currentLocalDay = localDay;
  const store = new ProtectedKineoStore(
    new KineoSqliteStore(database),
    async () => ({ ok: true, value: undefined }),
    async () => undefined,
    async () => ({ ok: true, value: undefined }),
  );
  const reminderScheduler = new FakeReminderScheduler();
  return {
    database,
    store,
    service: new KineoProductService(
      store,
      { nowMilliseconds: () => timestamp },
      {
        nextIdentifier: (() => {
          const identifiers = Array.from(
            { length: lastGeneratedIdentifier - firstGeneratedIdentifier + 1 },
            (_, index) =>
              `00000000-0000-0000-0000-${String(firstGeneratedIdentifier + index).padStart(uuidSuffixLength, '0')}`,
          );
          return () => {
            const identifier = identifiers.shift();
            if (identifier === undefined) throw new Error('Identifier fixture exhausted.');
            return identifier;
          };
        })(),
        monotonicMilliseconds: () => monotonicMilliseconds,
        localDayContext: () => ({
          localDay: currentLocalDay,
          timeZoneId: 'America/Chicago',
          calendarId: 'gregorian',
        }),
      },
      reminderScheduler,
    ),
    reminderScheduler,
    advanceClock: () => {
      timestamp = nextTimestamp;
    },
    advanceMonotonicClock: (increment: number) => {
      monotonicMilliseconds += increment;
    },
    setLocalDay: (value: string) => {
      currentLocalDay = value;
    },
  };
}

describe('Kineo product service onboarding', () => {
  it('restores every durable onboarding checkpoint', async () => {
    const { database, service, advanceClock } = await makeService();
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'onboarding', progress: { step: 'welcome' } },
    });
    await service.confirmAdultEligibility();
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'onboarding', progress: { step: 'primaryArea' } },
    });
    await service.savePrimaryArea('neck');
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'secondaryArea', primaryArea: 'neck' },
      },
    });
    await service.saveSecondaryArea('lowerBack');
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'safetyBoundary', primaryArea: 'neck' },
      },
    });
    advanceClock();
    await service.acknowledgeSafetyBoundary();
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'firstCheckIn', primaryArea: 'neck' },
      },
    });
    await expect(service.completeOnboarding()).resolves.toEqual({ ok: true, value: 'neck' });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'today', primaryArea: 'neck' },
    });
    await database.closeAsync();
  });

  it('rejects duplicate selected areas without changing the checkpoint', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('upperMidBack');
    await expect(service.saveSecondaryArea('upperMidBack')).resolves.toEqual({
      ok: false,
      error: { code: 'invalidState' },
    });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'onboarding',
        progress: { step: 'secondaryArea', primaryArea: 'upperMidBack' },
      },
    });
    await database.closeAsync();
  });
});

describe('Kineo product service reminders', () => {
  it('persists intent before permission and enables only after scheduling succeeds', async () => {
    const { database, service, reminderScheduler } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();

    const enabled = await service.enableReminder(morningReminderWindow);

    expect(enabled).toMatchObject({
      ok: true,
      value: {
        reminderAuthorization: 'authorized',
        reminderSettings: {
          enabled: true,
          window: morningReminderWindow,
          timeZoneId: 'America/Chicago',
        },
      },
    });
    expect(reminderScheduler.scheduledWindow).toEqual(morningReminderWindow);
    expect(reminderScheduler.scheduledTimeZoneId).toBe('America/Chicago');
    await database.closeAsync();
  });

  it('keeps the reminder disabled when permission is denied', async () => {
    const { database, service, reminderScheduler } = await makeService();
    reminderScheduler.requestResult = { ok: true, value: 'denied' };
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();

    await expect(service.enableReminder(morningReminderWindow)).resolves.toMatchObject({
      ok: true,
      value: {
        reminderAuthorization: 'denied',
        reminderSettings: { enabled: false, window: morningReminderWindow },
      },
    });
    expect(reminderScheduler.scheduledWindow).toBeUndefined();
    await database.closeAsync();
  });

  it('surfaces scheduling failure and preserves disabled persisted state', async () => {
    const { database, service, reminderScheduler } = await makeService();
    reminderScheduler.authorization = 'authorized';
    reminderScheduler.scheduleResult = {
      ok: false,
      error: { code: 'schedulingFailed' },
    };
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();

    await expect(service.enableReminder(morningReminderWindow)).resolves.toEqual({
      ok: false,
      error: { code: 'reminderUnavailable' },
    });
    await expect(service.loadProfile()).resolves.toMatchObject({
      ok: true,
      value: { reminderSettings: { enabled: false } },
    });
    await database.closeAsync();
  });

  it('cancels before persisting a disabled reminder', async () => {
    const { database, service, reminderScheduler } = await makeService();
    reminderScheduler.authorization = 'authorized';
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    await service.enableReminder(morningReminderWindow);

    await expect(service.disableReminder()).resolves.toMatchObject({
      ok: true,
      value: { reminderSettings: { enabled: false } },
    });
    expect(reminderScheduler.cancelCount).toBe(1);
    await database.closeAsync();
  });
});

describe('Kineo product service check-in', () => {
  it('creates and restores the same durable two-area draft', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea('lowerBack');
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();

    const started = await service.beginCheckIn();
    expect(started).toEqual({
      ok: true,
      value: {
        checkInId,
        primaryEntryId,
        primaryArea: 'neck',
        secondaryEntryId,
        secondaryArea: 'lowerBack',
        startedAtMilliseconds: initialTimestamp,
        dayContext: {
          localDay,
          timeZoneId: 'America/Chicago',
          calendarId: 'gregorian',
        },
      },
    });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'unfinishedCheckIn',
        draft: started.ok
          ? {
              ...started.value,
              primaryEntryId: restoredPrimaryEntryId,
              secondaryEntryId: restoredSecondaryEntryId,
            }
          : undefined,
      },
    });
    await expect(service.beginCheckIn()).resolves.toEqual({
      ok: true,
      value: started.ok
        ? {
            ...started.value,
            primaryEntryId: secondRestoredPrimaryEntryId,
            secondaryEntryId: secondRestoredSecondaryEntryId,
          }
        : undefined,
    });
    await database.closeAsync();
  });

  it('abandons a stale draft instead of restoring it on another local day', async () => {
    const { database, service, setLocalDay, store } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Stale check-in fixture did not start.');
    setLocalDay(followingLocalDay);

    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'today', primaryArea: 'neck' },
    });
    const persisted = await store.loadCheckIn(draft.value.checkInId);
    expect(persisted).toMatchObject({ ok: true, value: { status: 'abandoned' } });
    await database.closeAsync();
  });

  it('commits a normal check-in and restores its deterministic plan', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const started = await service.beginCheckIn();
    if (!started.ok) throw new Error('Check-in fixture did not start.');

    const submitted = await service.submitCheckIn(started.value, {
      area: 'neck',
      changeReport: 'better',
      movementComfort: 'okay',
    });
    expect(submitted).toMatchObject({
      ok: true,
      value: {
        kind: 'plan',
        plan: {
          checkInId: checkInId,
          primaryArea: 'neck',
          includedAreas: ['neck'],
          recommendedLevel: 'balanced',
          selectedLevel: 'balanced',
          deliveredLevel: 'balanced',
          duration: 'standard',
          pauseTodayAvailable: false,
        },
      },
    });
    const plan = submitted.ok && submitted.value.kind === 'plan'
      ? submitted.value.plan
      : undefined;
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'unfinishedPlan', plan },
    });
    await database.closeAsync();
  });

  it('persists Attention and withholds a plan after a flagged answer', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('lowerBack');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const started = await service.beginCheckIn();
    if (!started.ok) throw new Error('Check-in fixture did not start.');

    const submitted = await service.submitCheckIn(started.value, {
      area: 'lowerBack',
      changeReport: 'worse',
      movementComfort: 'limited',
      conditionalSafetyAnswer: 'notSure',
    });
    expect(submitted).toEqual({
      ok: true,
      value: {
        kind: 'attentionRequired',
        area: 'lowerBack',
        responseEventId: '00000000-0000-0000-0000-000000000104',
        expectedAttentionUpdatedAtMilliseconds: initialTimestamp,
      },
    });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: {
        kind: 'attentionRequired',
        prompt: {
          area: 'lowerBack',
          responseEventId: '00000000-0000-0000-0000-000000000105',
          expectedAttentionUpdatedAtMilliseconds: initialTimestamp,
        },
      },
    });
    await expect(service.beginCheckIn()).resolves.toEqual({
      ok: false,
      error: { code: 'invalidState' },
    });
    await database.closeAsync();
  });

  it('keeps Attention on uncertainty and clears it only after return-to-usual', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Check-in fixture did not start.');
    const flagged = await service.submitCheckIn(draft.value, {
      area: 'neck',
      changeReport: 'worse',
      movementComfort: 'okay',
      conditionalSafetyAnswer: 'yes',
    });
    if (!flagged.ok || flagged.value.kind !== 'attentionRequired') {
      throw new Error('Attention fixture was not created.');
    }
    const kept = await service.respondToAttentionReturn({
      area: flagged.value.area,
      responseEventId: flagged.value.responseEventId,
      expectedAttentionUpdatedAtMilliseconds:
        flagged.value.expectedAttentionUpdatedAtMilliseconds,
    }, 'notSure');
    expect(kept).toMatchObject({
      ok: true,
      value: { kind: 'attentionRequired', prompt: { area: 'neck' } },
    });
    if (!kept.ok || kept.value.kind !== 'attentionRequired') {
      throw new Error('Attention was not reaffirmed.');
    }
    await expect(service.respondToAttentionReturn(kept.value.prompt, 'yes')).resolves.toEqual({
      ok: true,
      value: { kind: 'ready', primaryArea: 'neck' },
    });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'today', primaryArea: 'neck' },
    });
    await database.closeAsync();
  });

  it('clears Attention only after a complete valid correction', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Check-in fixture did not start.');
    const flagged = await service.submitCheckIn(draft.value, {
      area: 'neck',
      changeReport: 'worse',
      movementComfort: 'limited',
      conditionalSafetyAnswer: 'notSure',
    });
    if (!flagged.ok || flagged.value.kind !== 'attentionRequired') {
      throw new Error('Attention fixture was not created.');
    }
    const correction = await service.beginAttentionCorrection({
      area: flagged.value.area,
      responseEventId: flagged.value.responseEventId,
      expectedAttentionUpdatedAtMilliseconds:
        flagged.value.expectedAttentionUpdatedAtMilliseconds,
    });
    if (!correction.ok) throw new Error('Correction fixture did not start.');
    await expect(service.submitAttentionCorrection(correction.value, {
      area: 'neck',
      changeReport: 'similar',
      movementComfort: 'okay',
    })).resolves.toEqual({
      ok: true,
      value: { kind: 'ready', primaryArea: 'neck' },
    });
    await database.closeAsync();
  });

  it('starts, restores, and completes the persisted routine', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Check-in fixture did not start.');
    const checkedIn = await service.submitCheckIn(draft.value, {
      area: 'neck',
      changeReport: 'similar',
      movementComfort: 'okay',
    });
    if (!checkedIn.ok || checkedIn.value.kind !== 'plan') {
      throw new Error('Plan fixture was not created.');
    }

    let routine = await service.startRoutine(checkedIn.value.plan.decisionId);
    expect(routine).toMatchObject({
      ok: true,
      value: {
        primaryArea: 'neck',
        includedAreas: ['neck'],
        status: 'inProgress',
        currentStepIndex: 0,
        contentAvailable: true,
      },
    });
    if (!routine.ok) throw new Error('Routine fixture did not start.');
    await expect(service.startRoutine(checkedIn.value.plan.decisionId)).resolves.toEqual(routine);
    const restored = await service.loadStartState();
    expect(restored).toMatchObject({
      ok: true,
      value: { kind: 'unfinishedRoutine', routine: { status: 'paused' } },
    });
    if (!restored.ok || restored.value.kind !== 'unfinishedRoutine') {
      throw new Error('Routine fixture did not restore.');
    }
    routine = await service.resumeRoutine(restored.value.routine.sessionId);
    if (!routine.ok || routine.value.status !== 'inProgress') {
      throw new Error('Routine fixture did not resume.');
    }
    const staleStepIndex = routine.value.currentStepIndex;
    routine = await service.advanceRoutine(routine.value.sessionId, staleStepIndex);
    if (!routine.ok) throw new Error('Routine fixture did not advance.');
    await expect(
      service.advanceRoutine(routine.value.sessionId, staleStepIndex),
    ).resolves.toEqual({ ok: false, error: { code: 'invalidState' } });
    const maximumExpectedStepCount = 20;
    let advances = 0;
    while (routine.ok && routine.value.status === 'inProgress') {
      routine = await service.advanceRoutine(
        routine.value.sessionId,
        routine.value.currentStepIndex,
      );
      advances += 1;
      if (advances > maximumExpectedStepCount) {
        throw new Error('Routine did not reach a terminal state.');
      }
    }
    expect(routine).toMatchObject({ ok: true, value: { status: 'completed' } });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'today', primaryArea: 'neck' },
    });
    await database.closeAsync();
  });

  it('uses monotonic time while active and checkpoints it while paused', async () => {
    const { database, service, advanceMonotonicClock } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Timed check-in did not start.');
    const checkedIn = await service.submitCheckIn(draft.value, {
      area: 'neck',
      changeReport: 'similar',
      movementComfort: 'okay',
    });
    if (!checkedIn.ok || checkedIn.value.kind !== 'plan') {
      throw new Error('Timed plan was not created.');
    }
    const started = await service.startRoutine(checkedIn.value.plan.decisionId);
    if (!started.ok) throw new Error('Timed routine did not start.');

    advanceMonotonicClock(firstElapsedIncrementMilliseconds);
    await expect(service.refreshRoutine(started.value.sessionId)).resolves.toMatchObject({
      ok: true,
      value: { stepElapsedMilliseconds: firstElapsedIncrementMilliseconds },
    });
    const paused = await service.pauseRoutine(started.value.sessionId);
    expect(paused).toMatchObject({
      ok: true,
      value: {
        status: 'paused',
        stepElapsedMilliseconds: firstElapsedIncrementMilliseconds,
      },
    });
    advanceMonotonicClock(pausedClockIncrementMilliseconds);
    await expect(service.refreshRoutine(started.value.sessionId)).resolves.toMatchObject({
      ok: true,
      value: { stepElapsedMilliseconds: firstElapsedIncrementMilliseconds },
    });
    await database.closeAsync();
  });

  it('persists alternatives, skip reasons, safe stopping, and idempotent feedback', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Check-in fixture did not start.');
    const checkedIn = await service.submitCheckIn(draft.value, {
      area: 'neck',
      changeReport: 'better',
      movementComfort: 'good',
    });
    if (!checkedIn.ok || checkedIn.value.kind !== 'plan') {
      throw new Error('Plan fixture was not created.');
    }
    let routine = await service.startRoutine(checkedIn.value.plan.decisionId);
    if (!routine.ok || routine.value.currentItem?.kind !== 'movement') {
      throw new Error('Routine movement fixture was not created.');
    }
    const alternative = routine.value.currentItem.availableAlternatives[0];
    if (alternative === undefined) throw new Error('Alternative fixture is missing.');

    routine = await service.selectRoutineAlternative(
      routine.value.sessionId,
      routine.value.currentStepIndex,
      alternative.movementId,
    );
    expect(routine).toMatchObject({
      ok: true,
      value: {
        status: 'paused',
        selectedAlternative: { movementId: alternative.movementId },
      },
    });
    if (!routine.ok) throw new Error('Alternative was not selected.');
    await expect(service.refreshRoutine(routine.value.sessionId)).resolves.toMatchObject({
      ok: true,
      value: {
        selectedAlternative: { movementId: alternative.movementId },
      },
    });
    routine = await service.resumeRoutine(routine.value.sessionId);
    if (!routine.ok) throw new Error('Routine did not resume.');
    routine = await service.skipRoutineStep(
      routine.value.sessionId,
      routine.value.currentStepIndex,
      'unclear',
    );
    expect(routine).toMatchObject({
      ok: true,
      value: { status: 'inProgress', currentStepIndex: 1 },
    });
    if (!routine.ok) throw new Error('Routine step was not skipped.');
    routine = await service.endRoutine(routine.value.sessionId, true);
    expect(routine).toMatchObject({ ok: true, value: { status: 'safetyStopped' } });
    if (!routine.ok) throw new Error('Routine did not stop safely.');
    const feedback = { neck: 'same' as const };
    await expect(service.submitFeedback(routine.value.sessionId, feedback)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(service.submitFeedback(routine.value.sessionId, feedback)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await database.closeAsync();
  });

  it('derives Progress and Active eligibility from persisted area outcomes', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();

    const qualifyingRoutineCount = 2;
    for (let completedCount = 0; completedCount < qualifyingRoutineCount; completedCount += 1) {
      const draft = await service.beginCheckIn();
      if (!draft.ok) throw new Error('Qualifying check-in did not start.');
      const checkedIn = await service.submitCheckIn(draft.value, {
        area: 'neck',
        changeReport: 'better',
        movementComfort: 'okay',
      });
      if (!checkedIn.ok || checkedIn.value.kind !== 'plan') {
        throw new Error('Qualifying plan was not created.');
      }
      let routine = await service.startRoutine(checkedIn.value.plan.decisionId);
      const maximumExpectedStepCount = 20;
      let advances = 0;
      while (routine.ok && routine.value.status === 'inProgress') {
        routine = await service.advanceRoutine(
          routine.value.sessionId,
          routine.value.currentStepIndex,
        );
        advances += 1;
        if (advances > maximumExpectedStepCount) {
          throw new Error('Qualifying routine did not complete.');
        }
      }
      if (!routine.ok) throw new Error('Qualifying routine failed.');
      await service.submitFeedback(routine.value.sessionId, { neck: 'same' });
    }

    const progress = await service.loadProgress();
    expect(progress).toMatchObject({ ok: true, value: { participationDayCount: 1 } });
    const neckProgress = progress.ok
      ? progress.value.areas.find(({ area }) => area === 'neck')
      : undefined;
    expect(neckProgress).toEqual({
      area: 'neck',
      checkInCount: qualifyingRoutineCount,
      completedRoutineCount: qualifyingRoutineCount,
      qualifyingOutcomeCount: qualifyingRoutineCount,
      activeUnlocked: true,
      responses: { better: 0, same: qualifyingRoutineCount, worse: 0 },
    });

    const activeDraft = await service.beginCheckIn();
    if (!activeDraft.ok) throw new Error('Active check-in did not start.');
    const activePlan = await service.submitCheckIn(activeDraft.value, {
      area: 'neck',
      changeReport: 'better',
      movementComfort: 'good',
    });
    expect(activePlan).toMatchObject({
      ok: true,
      value: {
        kind: 'plan',
        plan: { recommendedLevel: 'active', selectedLevel: 'active' },
      },
    });
    await database.closeAsync();
  });

  it('persists Pause Today and profile area changes without losing onboarding', async () => {
    const { database, service } = await makeService();
    await service.confirmAdultEligibility();
    await service.savePrimaryArea('neck');
    await service.saveSecondaryArea();
    await service.acknowledgeSafetyBoundary();
    await service.completeOnboarding();
    const draft = await service.beginCheckIn();
    if (!draft.ok) throw new Error('Pause Today check-in did not start.');
    const checkedIn = await service.submitCheckIn(draft.value, {
      area: 'neck',
      changeReport: 'worse',
      movementComfort: 'okay',
      conditionalSafetyAnswer: 'no',
    });
    if (!checkedIn.ok || checkedIn.value.kind !== 'plan') {
      throw new Error('Pause Today plan was not created.');
    }
    expect(checkedIn.value.plan.pauseTodayAvailable).toBe(true);
    await expect(service.pauseToday(checkedIn.value.plan.checkInId)).resolves.toEqual({
      ok: true,
      value: 'neck',
    });
    await expect(service.loadStartState()).resolves.toEqual({
      ok: true,
      value: { kind: 'today', primaryArea: 'neck' },
    });

    const profile = await service.saveAreaPreferences('lowerBack', 'upperMidBack');
    expect(profile).toMatchObject({
      ok: true,
      value: {
        profile: {
          primaryArea: 'lowerBack',
          secondaryArea: 'upperMidBack',
          onboardingCompletedAtMilliseconds: initialTimestamp,
        },
      },
    });
    await database.closeAsync();
  });
});
