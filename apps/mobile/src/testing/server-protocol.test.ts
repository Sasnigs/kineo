import { describe, expect, it } from '@jest/globals';

import {
  validateSyncRequest,
} from '../../../../supabase/functions/_shared/protocol';

const installationId = '20000000-0000-4000-8000-000000000001';
const mutationId = '30000000-0000-4000-8000-000000000001';
const legalCommand = { kind: 'acceptLegal', acceptance: {
  documentKind: 'privacyPolicy', documentVersion: 'test', locale: 'en-US', acceptedAtMilliseconds: 1,
} };

describe('server sync protocol', () => {
  it('accepts skipping optional feedback without inventing responses', () => {
    expect(validateSyncRequest({ installationId, mutations: [{
      mutationId, installationId, historyEpoch: 1, createdAtMilliseconds: 1,
      command: { kind: 'submitFeedback', submission: {
        id: mutationId, routineSessionId: mutationId, submittedAtMilliseconds: 1,
        dayContext: { localDay: '2026-09-07', timeZoneId: 'UTC', calendarId: 'gregorian' },
        responses: [],
      } },
    }] })).toBeDefined();
  });
  it.each(['authoritativePlan', 'authorityVersion'])('rejects client-supplied server field %s', (field) => {
    expect(validateSyncRequest({
      installationId,
      mutations: [{
        mutationId, installationId, historyEpoch: 1, createdAtMilliseconds: 1,
        command: { ...legalCommand, [field]: 1 },
      }],
    })).toBeUndefined();
  });

  it('rejects reordered and installation-mismatched mutations', () => {
    const mutation = (id: string, createdAtMilliseconds: number) => ({
      mutationId: id,
      installationId,
      historyEpoch: 1,
      createdAtMilliseconds,
      command: legalCommand,
    });
    expect(validateSyncRequest({
      installationId,
      mutations: [
        mutation(mutationId, 2),
        mutation('30000000-0000-4000-8000-000000000002', 1),
      ],
    })).toBeUndefined();
    expect(validateSyncRequest({
      installationId,
      mutations: [{
        ...mutation(mutationId, 1),
        installationId: '20000000-0000-4000-8000-000000000099',
      }],
    })).toBeUndefined();
  });

  it('does not expose reauthentication-only history reset through ordinary sync', () => {
    expect(validateSyncRequest({ installationId, mutations: [{
      mutationId, installationId, historyEpoch: 1, createdAtMilliseconds: 1, command: { kind: 'resetHistory' },
    }] })).toBeUndefined();
  });

  it('rejects malformed commands before they reach PostgreSQL', () => {
    expect(validateSyncRequest({
      installationId,
      mutations: [{
        mutationId,
        installationId,
        historyEpoch: 1,
        createdAtMilliseconds: 1,
        command: {
          kind: 'saveProfile',
          expectedVersion: 0,
          profile: { adultAcknowledged: true, weeklyGoalDays: 99 },
        },
      }],
    })).toBeUndefined();
  });

});
