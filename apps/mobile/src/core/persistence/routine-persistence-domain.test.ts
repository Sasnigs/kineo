import { describe, expect, it } from '@jest/globals';

import type { RoutineSessionSnapshot } from '../content/routine-session-snapshot';
import { parseRoutineSessionId } from '../content/routine-session-snapshot';
import { parseCheckInId, parseSelectionDecisionId } from '../domain/selection-domain';
import { parseLocalDay } from './persistence-domain';
import {
  createOpaqueRoutineSnapshot,
  createRoutineCheckpoint,
  createRoutineEvent,
  createRoutineSession,
  encodeRoutineSnapshot,
  isValidRoutineTransition,
} from './routine-persistence-domain';

const timestamp = 1_750_000_000_000;
const sessionIdValue = '00000000-0000-0000-0000-000000000101';
const decisionIdValue = '00000000-0000-0000-0000-000000000102';
const checkInIdValue = '00000000-0000-0000-0000-000000000103';
const eventIdValue = '00000000-0000-0000-0000-000000000104';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) throw new Error('Fixture validation failed.');
  return result.value;
}

function snapshot(): RoutineSessionSnapshot {
  return {
    sessionId: required(parseRoutineSessionId(sessionIdValue)),
    decisionId: required(parseSelectionDecisionId(decisionIdValue)),
    compositionId: 'composition.test' as RoutineSessionSnapshot['compositionId'],
    catalogVersion: '0.1.0' as RoutineSessionSnapshot['catalogVersion'],
    rulesVersion: 'selection-v1',
    fingerprint: 'a'.repeat(64) as RoutineSessionSnapshot['fingerprint'],
    selectedLevel: 'gentle',
    deliveredLevel: 'gentle',
    duration: 'quick',
    includedAreas: ['neck'],
    notices: [],
    presentedExplanationKeys: [],
    presentedExplanationParameters: [],
    items: [{} as RoutineSessionSnapshot['items'][number]],
    createdAtMilliseconds: timestamp,
  };
}

describe('routine persistence domain', () => {
  it('detects changed snapshot bytes', () => {
    const encoded = encodeRoutineSnapshot(snapshot());
    expect(createOpaqueRoutineSnapshot({ ...encoded, json: `${encoded.json} ` })).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'routineSnapshot' },
    });
  });

  it('validates prepared session lifecycle', () => {
    const result = createRoutineSession({
      id: required(parseRoutineSessionId(sessionIdValue)),
      decisionId: required(parseSelectionDecisionId(decisionIdValue)),
      checkInId: required(parseCheckInId(checkInIdValue)),
      status: 'prepared',
      snapshot: encodeRoutineSnapshot(snapshot()),
      currentStepIndex: 0,
      stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: timestamp,
      dayContext: {
        localDay: required(parseLocalDay('2026-08-27')),
        timeZoneId: 'America/Chicago',
        calendarId: 'gregorian',
      },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects mismatched event fields and terminal checkpoints without end time', () => {
    expect(createRoutineEvent({
      id: eventIdValue as never,
      routineSessionId: sessionIdValue as never,
      sequenceNumber: 1,
      kind: 'started',
      stepId: 'unexpected',
      moduleId: 'unexpected',
      occurredAtMilliseconds: timestamp,
    }).ok).toBe(false);
    expect(createRoutineCheckpoint({
      status: 'completed',
      currentStepIndex: 1,
      stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: timestamp,
    }).ok).toBe(false);
  });

  it('encodes the allowed state transitions', () => {
    expect(isValidRoutineTransition('prepared', 'started', 'inProgress')).toBe(true);
    expect(isValidRoutineTransition('paused', 'resumed', 'inProgress')).toBe(true);
    expect(isValidRoutineTransition('completed', 'started', 'inProgress')).toBe(false);
  });
});
