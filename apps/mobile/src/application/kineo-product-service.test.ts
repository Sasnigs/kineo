/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import { KineoSqliteStore } from '../infrastructure/persistence/kineo-sqlite-store';
import { migrateKineoDatabase } from '../infrastructure/persistence/kineo-schema';
import { ProtectedKineoStore } from '../infrastructure/persistence/protected-kineo-store';
import { NodeSqliteTestDatabase } from '../infrastructure/persistence/testing/node-sqlite-test-database';
import { KineoProductService } from './kineo-product-service';

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

async function makeService() {
  const database = new NodeSqliteTestDatabase();
  const migrated = await migrateKineoDatabase(database, initialTimestamp);
  if (!migrated.ok) throw new Error('Product-service migration failed.');
  let timestamp = initialTimestamp;
  const store = new ProtectedKineoStore(
    new KineoSqliteStore(database),
    async () => ({ ok: true, value: undefined }),
    async () => undefined,
    async () => ({ ok: true, value: undefined }),
  );
  return {
    database,
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
        localDayContext: () => ({
          localDay,
          timeZoneId: 'America/Chicago',
          calendarId: 'gregorian',
        }),
      },
    ),
    advanceClock: () => {
      timestamp = nextTimestamp;
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
    const maximumExpectedStepCount = 20;
    let advances = 0;
    while (routine.ok && routine.value.status === 'inProgress') {
      routine = await service.advanceRoutine(routine.value.sessionId);
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
    routine = await service.resumeRoutine(routine.value.sessionId);
    if (!routine.ok) throw new Error('Routine did not resume.');
    routine = await service.skipRoutineStep(routine.value.sessionId, 'unclear');
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
});
