import { describe, expect, it } from '@jest/globals';

import {
  createPendingMutation,
  createSyncRequest,
  firstHistoryEpoch,
} from './sync-contract';

const accountId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const firstMutationId = '30000000-0000-4000-8000-000000000001';
const secondMutationId = '30000000-0000-4000-8000-000000000002';
const createdAtMilliseconds = 1_788_300_000_000;

describe('sync contract', () => {
  it('creates an ordered request from valid pending mutations', () => {
    const first = createPendingMutation({
      mutationId: firstMutationId,
      accountId,
      installationId,
      historyEpoch: firstHistoryEpoch,
      createdAtMilliseconds,
      command: { kind: 'acceptLegal', acceptance: {
        documentKind: 'termsOfService',
        documentVersion: '2026-09-02',
        locale: 'en-US',
        acceptedAtMilliseconds: createdAtMilliseconds,
      } },
    });
    const second = createPendingMutation({
      mutationId: secondMutationId,
      accountId,
      installationId,
      historyEpoch: firstHistoryEpoch,
      createdAtMilliseconds: createdAtMilliseconds + 1,
      command: { kind: 'resetHistory' },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(createSyncRequest({
      expectedAccountId: accountId,
      installationId,
      cursor: 'opaque-cursor',
      mutations: [first.value, second.value],
    })).toEqual({
      ok: true,
      value: {
        installationId,
        cursor: 'opaque-cursor',
        mutations: [
          {
            mutationId: firstMutationId,
            installationId,
            historyEpoch: firstHistoryEpoch,
            createdAtMilliseconds,
            command: first.value.command,
          },
          {
            mutationId: secondMutationId,
            installationId,
            historyEpoch: firstHistoryEpoch,
            createdAtMilliseconds: createdAtMilliseconds + 1,
            command: second.value.command,
          },
        ],
      },
    });
  });

  it('rejects duplicate IDs and mutations from another account or installation', () => {
    const mutation = createPendingMutation({
      mutationId: firstMutationId,
      accountId,
      installationId,
      historyEpoch: firstHistoryEpoch,
      createdAtMilliseconds,
      command: { kind: 'resetHistory' },
    });
    expect(mutation.ok).toBe(true);
    if (!mutation.ok) return;

    expect(createSyncRequest({
      expectedAccountId: accountId,
      installationId,
      mutations: [mutation.value, mutation.value],
    })).toEqual({ ok: false, error: { code: 'duplicateMutation' } });

    expect(createSyncRequest({
      expectedAccountId: '10000000-0000-4000-8000-000000000099',
      installationId,
      mutations: [mutation.value],
    })).toEqual({ ok: false, error: { code: 'ownershipMismatch' } });
  });

  it('rejects non-monotonic installation ordering', () => {
    const later = createPendingMutation({
      mutationId: secondMutationId,
      accountId,
      installationId,
      historyEpoch: firstHistoryEpoch,
      createdAtMilliseconds: createdAtMilliseconds + 1,
      command: { kind: 'resetHistory' },
    });
    const earlier = createPendingMutation({
      mutationId: firstMutationId,
      accountId,
      installationId,
      historyEpoch: firstHistoryEpoch,
      createdAtMilliseconds,
      command: { kind: 'resetHistory' },
    });
    expect(later.ok && earlier.ok).toBe(true);
    if (!later.ok || !earlier.ok) return;

    expect(createSyncRequest({
      expectedAccountId: accountId,
      installationId,
      mutations: [later.value, earlier.value],
    })).toEqual({ ok: false, error: { code: 'mutationOrder' } });
  });
});
