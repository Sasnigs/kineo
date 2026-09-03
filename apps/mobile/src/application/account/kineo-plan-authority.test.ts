/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import type {
  SyncLocalRepository,
  SyncModule,
  SyncOutbox,
} from '../../core/account/sync-module';
import type { PendingMutation } from '../../core/account/sync-contract';
import type { CheckIn } from '../../core/persistence/persistence-domain';
import {
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
} from '../../core/domain/selection-domain';
import { KineoCloudPlanAuthority } from './kineo-plan-authority';

const accountId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const mutationId = '30000000-0000-4000-8000-000000000001';
const checkInId = parseCheckInId('40000000-0000-4000-8000-000000000001');
const entryId = parseCheckInEntryId('50000000-0000-4000-8000-000000000001');
const decisionId = parseSelectionDecisionId('60000000-0000-4000-8000-000000000001');
const nowMilliseconds = 1_788_300_000_000;

if (!checkInId.ok || !entryId.ok || !decisionId.ok) {
  throw new Error('Invalid test identifiers.');
}
const validDecisionId = decisionId.value;

const checkIn: CheckIn = {
  id: checkInId.value,
  status: 'completed',
  kind: 'normal',
  primaryArea: 'neck',
  startedAtMilliseconds: nowMilliseconds,
  completedAtMilliseconds: nowMilliseconds,
  dayContext: {
    localDay: '2026-09-02' as never,
    timeZoneId: 'America/Chicago',
    calendarId: 'gregorian',
  },
  entries: [{
    id: entryId.value,
    area: 'neck',
    role: 'primary',
    changeReport: 'similar',
    movementComfort: 'okay',
    submittedAtMilliseconds: nowMilliseconds,
  }],
};

class FakeRepository implements SyncLocalRepository, SyncOutbox {
  pending: PendingMutation[] = [];
  entity: unknown = {
    decisionId: validDecisionId,
    revision: 1,
    rulesVersion: 'selection-v1.0.0-prototype',
    catalogVersion: '0.1.0',
    recommendedLevel: 'balanced',
    selectedLevel: 'balanced',
    deliveredLevel: 'balanced',
    durationVariant: 'standard',
  };
  async loadAccount() {
    return {
      ok: true as const,
      value: {
        accountId,
        status: 'active' as const,
        historyEpoch: 1,
        legalAcceptances: [],
      },
    };
  }
  async loadCursor() { return { ok: true as const, value: undefined }; }
  async applyBootstrapPage() { return { ok: true as const, value: undefined }; }
  async applySyncPage() { return { ok: true as const, value: undefined }; }
  async pendingMutationCount() {
    return { ok: true as const, value: this.pending.length };
  }
  async loadSynchronizedEntity() {
    return { ok: true as const, value: this.entity };
  }
  async enqueue(mutation: PendingMutation) {
    this.pending.push(mutation);
    return { ok: true as const, value: undefined };
  }
  async pendingMutations() {
    return { ok: true as const, value: this.pending };
  }
  async discardPendingMutations() {
    this.pending = [];
    return { ok: true as const, value: undefined };
  }
}

class FakeSync implements SyncModule {
  offline = false;
  async bootstrap() {
    return { ok: false as const, error: { code: 'offline' as const } };
  }
  async synchronize() {
    return this.offline
      ? { ok: false as const, error: { code: 'offline' as const } }
      : {
          ok: true as const,
          value: {
            account: {
              accountId,
              status: 'active' as const,
              historyEpoch: 1,
              legalAcceptances: [],
            },
            pendingMutationCount: 0,
          },
        };
  }
}

describe('KineoCloudPlanAuthority', () => {
  it('accepts only the server decision returned through synchronized state', async () => {
    const authority = new KineoCloudPlanAuthority(
      accountId,
      installationId,
      new FakeSync(),
      new FakeRepository(),
      () => mutationId,
      () => nowMilliseconds,
    );
    await expect(authority.authorize(
      checkIn,
      validDecisionId,
      1,
      'standard',
    )).resolves.toEqual({
      ok: true,
      value: {
        kind: 'approved',
        decisionId: validDecisionId,
        decisionRevision: 1,
        rulesVersion: 'selection-v1.0.0-prototype',
        catalogVersion: '0.1.0',
        recommendedLevel: 'balanced',
        selectedLevel: 'balanced',
        deliveredLevel: 'balanced',
        duration: 'standard',
      },
    });
  });

  it('keeps the protected mutation queued when validation is offline', async () => {
    const repository = new FakeRepository();
    const sync = new FakeSync();
    sync.offline = true;
    const authority = new KineoCloudPlanAuthority(
      accountId,
      installationId,
      sync,
      repository,
      () => mutationId,
      () => nowMilliseconds,
    );
    await expect(authority.authorize(
      checkIn,
      validDecisionId,
      1,
      'standard',
    )).resolves.toEqual({
      ok: false,
      error: { code: 'onlineValidationRequired' },
    });
    expect(repository.pending).toHaveLength(1);
  });
});
