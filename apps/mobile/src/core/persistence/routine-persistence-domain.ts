import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { RoutineSessionSnapshot } from '../content/routine-session-snapshot';
import type {
  AreaResponse,
  BodyArea,
  CheckInId,
  RoutineStatus,
  SelectionDecisionId,
} from '../domain/selection-domain';
import { bodyAreas, routineStatuses, terminalRoutineStatuses } from '../domain/selection-domain';
import type { Result } from '../shared/result';
import type { LocalDayContext, PersistenceDomainError } from './persistence-domain';
import { createLocalDayContext } from './persistence-domain';

declare const pauseTodayEventIdBrand: unique symbol;
export type PauseTodayEventId = string & {
  readonly [pauseTodayEventIdBrand]: 'PauseTodayEventId';
};

declare const routineEventIdBrand: unique symbol;
export type RoutineEventId = string & {
  readonly [routineEventIdBrand]: 'RoutineEventId';
};

declare const feedbackSubmissionIdBrand: unique symbol;
export type FeedbackSubmissionId = string & {
  readonly [feedbackSubmissionIdBrand]: 'FeedbackSubmissionId';
};

declare const areaFeedbackIdBrand: unique symbol;
export type AreaFeedbackId = string & {
  readonly [areaFeedbackIdBrand]: 'AreaFeedbackId';
};

export const routineEventKinds = [
  'started',
  'paused',
  'resumed',
  'stepCompleted',
  'skipped',
  'alternativeSelected',
  'stopped',
  'safetyStopped',
  'completed',
  'abandoned',
] as const;
export type RoutineEventKind = (typeof routineEventKinds)[number];

export const routineEventReasons = [
  'uncomfortable',
  'unclear',
  'notEnoughSpace',
] as const;
export type RoutineEventReason = (typeof routineEventReasons)[number];

export type PauseTodayEvent = Readonly<{
  id: PauseTodayEventId;
  checkInId: CheckInId;
  chosenAtMilliseconds: number;
  dayContext: LocalDayContext;
}>;

export type OpaqueRoutineSnapshot = Readonly<{
  json: string;
  checksum: string;
  includedAreas: readonly BodyArea[];
}>;

export type RoutineSession = Readonly<{
  id: import('../content/routine-session-snapshot').RoutineSessionId;
  decisionId: SelectionDecisionId;
  checkInId: CheckInId;
  status: RoutineStatus;
  snapshot: OpaqueRoutineSnapshot;
  currentStepIndex: number;
  stepElapsedMilliseconds: number;
  startedAtMilliseconds?: number;
  updatedAtMilliseconds: number;
  endedAtMilliseconds?: number;
  dayContext: LocalDayContext;
}>;

export type RoutineEvent = Readonly<{
  id: RoutineEventId;
  routineSessionId: import('../content/routine-session-snapshot').RoutineSessionId;
  sequenceNumber: number;
  kind: RoutineEventKind;
  stepId?: string;
  moduleId?: string;
  alternativeId?: string;
  localReason?: RoutineEventReason;
  occurredAtMilliseconds: number;
}>;

export type RoutineCheckpoint = Readonly<{
  status: RoutineStatus;
  currentStepIndex: number;
  stepElapsedMilliseconds: number;
  updatedAtMilliseconds: number;
  endedAtMilliseconds?: number;
}>;

export type FeedbackResponse = Readonly<{
  id: AreaFeedbackId;
  area: BodyArea;
  response: AreaResponse;
}>;

export type FeedbackSubmission = Readonly<{
  id: FeedbackSubmissionId;
  routineSessionId: import('../content/routine-session-snapshot').RoutineSessionId;
  responses: readonly FeedbackResponse[];
  submittedAtMilliseconds: number;
  dayContext: LocalDayContext;
}>;

const canonicalLowercaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const firstSequenceNumber = 1;
const minimumIncludedAreaCount = 1;
const maximumIncludedAreaCount = 2;
const minimumCheckpointValue = 0;

function failure<Value>(field: string): Result<Value, PersistenceDomainError> {
  return { ok: false, error: { code: 'invalidDomainValue', field } };
}

function parseIdentifier<Value extends string>(candidate: string): Result<Value, PersistenceDomainError> {
  return canonicalLowercaseUuidPattern.test(candidate)
    ? { ok: true, value: candidate as Value }
    : failure('identifier');
}

export const parsePauseTodayEventId = (candidate: string) =>
  parseIdentifier<PauseTodayEventId>(candidate);
export const parseRoutineEventId = (candidate: string) =>
  parseIdentifier<RoutineEventId>(candidate);
export const parseFeedbackSubmissionId = (candidate: string) =>
  parseIdentifier<FeedbackSubmissionId>(candidate);
export const parseAreaFeedbackId = (candidate: string) =>
  parseIdentifier<AreaFeedbackId>(candidate);

function validAreas(areas: readonly BodyArea[]): boolean {
  return (
    areas.length >= minimumIncludedAreaCount &&
    areas.length <= maximumIncludedAreaCount &&
    new Set(areas).size === areas.length
  );
}

export function createPauseTodayEvent(
  input: PauseTodayEvent,
): Result<PauseTodayEvent, PersistenceDomainError> {
  const context = createLocalDayContext(input.dayContext);
  if (!context.ok || !Number.isSafeInteger(input.chosenAtMilliseconds)) {
    return failure('pauseTodayEvent');
  }
  return { ok: true, value: Object.freeze({ ...input, dayContext: context.value }) };
}

export function encodeRoutineSnapshot(
  snapshot: RoutineSessionSnapshot,
): OpaqueRoutineSnapshot {
  const json = JSON.stringify(snapshot);
  return Object.freeze({
    json,
    checksum: bytesToHex(sha256(utf8ToBytes(json))),
    includedAreas: Object.freeze([...snapshot.includedAreas]),
  });
}

export function createOpaqueRoutineSnapshot(
  input: OpaqueRoutineSnapshot,
): Result<OpaqueRoutineSnapshot, PersistenceDomainError> {
  if (
    input.json.length === 0 ||
    bytesToHex(sha256(utf8ToBytes(input.json))) !== input.checksum ||
    !validAreas(input.includedAreas)
  ) {
    return failure('routineSnapshot');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.json);
  } catch (error) {
    return failure(`routineSnapshot:${error instanceof Error ? error.name : 'parse'}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('includedAreas' in parsed) ||
    !Array.isArray(parsed.includedAreas) ||
    parsed.includedAreas.some(
      (area) => typeof area !== 'string' || !bodyAreas.includes(area as BodyArea),
    ) ||
    JSON.stringify(parsed.includedAreas) !== JSON.stringify(input.includedAreas)
  ) {
    return failure('routineSnapshot');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      includedAreas: Object.freeze([...input.includedAreas]),
    }),
  };
}

function isTerminal(status: RoutineStatus): boolean {
  return terminalRoutineStatuses.includes(status as (typeof terminalRoutineStatuses)[number]);
}

export function createRoutineSession(
  input: RoutineSession,
): Result<RoutineSession, PersistenceDomainError> {
  const snapshot = createOpaqueRoutineSnapshot(input.snapshot);
  const context = createLocalDayContext(input.dayContext);
  const checkpointIsValid =
    Number.isSafeInteger(input.currentStepIndex) &&
    input.currentStepIndex >= minimumCheckpointValue &&
    Number.isSafeInteger(input.stepElapsedMilliseconds) &&
    input.stepElapsedMilliseconds >= minimumCheckpointValue &&
    Number.isSafeInteger(input.updatedAtMilliseconds);
  const lifecycleIsValid =
    (input.status === 'prepared' &&
      input.startedAtMilliseconds === undefined &&
      input.endedAtMilliseconds === undefined) ||
    ((input.status === 'inProgress' || input.status === 'paused') &&
      input.startedAtMilliseconds !== undefined &&
      input.endedAtMilliseconds === undefined) ||
    ((input.status === 'completed' ||
      input.status === 'stopped' ||
      input.status === 'safetyStopped') &&
      input.startedAtMilliseconds !== undefined &&
      input.endedAtMilliseconds !== undefined) ||
    (input.status === 'abandoned' && input.endedAtMilliseconds !== undefined);
  const chronologyIsValid =
    (input.startedAtMilliseconds === undefined ||
      input.updatedAtMilliseconds >= input.startedAtMilliseconds) &&
    (input.endedAtMilliseconds === undefined ||
      (input.endedAtMilliseconds <= input.updatedAtMilliseconds &&
        (input.startedAtMilliseconds === undefined ||
          input.endedAtMilliseconds >= input.startedAtMilliseconds)));
  if (!snapshot.ok || !context.ok || !checkpointIsValid || !lifecycleIsValid || !chronologyIsValid) {
    return failure('routineSession');
  }
  return {
    ok: true,
    value: Object.freeze({ ...input, snapshot: snapshot.value, dayContext: context.value }),
  };
}

export function createRoutineEvent(
  input: RoutineEvent,
): Result<RoutineEvent, PersistenceDomainError> {
  const hasStep = input.stepId !== undefined && input.moduleId !== undefined;
  const matchingStepFields = (input.stepId === undefined) === (input.moduleId === undefined);
  const fieldsAreValid =
    input.kind === 'stepCompleted'
      ? hasStep && input.alternativeId === undefined && input.localReason === undefined
      : input.kind === 'skipped'
        ? hasStep && input.alternativeId === undefined
        : input.kind === 'alternativeSelected'
          ? hasStep && input.alternativeId !== undefined && input.localReason === undefined
          : !hasStep && input.alternativeId === undefined && input.localReason === undefined;
  if (
    !Number.isSafeInteger(input.sequenceNumber) ||
    input.sequenceNumber < firstSequenceNumber ||
    !Number.isSafeInteger(input.occurredAtMilliseconds) ||
    !matchingStepFields ||
    !fieldsAreValid
  ) {
    return failure('routineEvent');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function createRoutineCheckpoint(
  input: RoutineCheckpoint,
): Result<RoutineCheckpoint, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.currentStepIndex) ||
    input.currentStepIndex < minimumCheckpointValue ||
    !Number.isSafeInteger(input.stepElapsedMilliseconds) ||
    input.stepElapsedMilliseconds < minimumCheckpointValue ||
    !Number.isSafeInteger(input.updatedAtMilliseconds) ||
    isTerminal(input.status) !== (input.endedAtMilliseconds !== undefined) ||
    (input.endedAtMilliseconds !== undefined &&
      input.endedAtMilliseconds > input.updatedAtMilliseconds)
  ) {
    return failure('routineCheckpoint');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function isValidRoutineTransition(
  current: RoutineStatus,
  event: RoutineEventKind,
  next: RoutineStatus,
): boolean {
  switch (event) {
    case 'started': return current === 'prepared' && next === 'inProgress';
    case 'paused': return current === 'inProgress' && next === 'paused';
    case 'resumed': return current === 'paused' && next === 'inProgress';
    case 'stepCompleted':
    case 'skipped': return current === 'inProgress' && next === 'inProgress';
    case 'alternativeSelected': return current === next && (next === 'inProgress' || next === 'paused');
    case 'completed': return (current === 'inProgress' || current === 'paused') && next === 'completed';
    case 'stopped': return (current === 'inProgress' || current === 'paused') && next === 'stopped';
    case 'safetyStopped': return (current === 'inProgress' || current === 'paused') && next === 'safetyStopped';
    case 'abandoned': return !isTerminal(current) && next === 'abandoned';
  }
}

export function createRoutineEventMutation(
  event: RoutineEvent,
  checkpoint: RoutineCheckpoint,
): Result<Readonly<{ event: RoutineEvent; checkpoint: RoutineCheckpoint }>, PersistenceDomainError> {
  const createdEvent = createRoutineEvent(event);
  const createdCheckpoint = createRoutineCheckpoint(checkpoint);
  if (
    !createdEvent.ok ||
    !createdCheckpoint.ok ||
    checkpoint.updatedAtMilliseconds < event.occurredAtMilliseconds ||
    (checkpoint.endedAtMilliseconds !== undefined &&
      checkpoint.endedAtMilliseconds < event.occurredAtMilliseconds)
  ) {
    return failure('routineEventMutation');
  }
  return { ok: true, value: Object.freeze({ event: createdEvent.value, checkpoint: createdCheckpoint.value }) };
}

export function createFeedbackSubmission(
  input: FeedbackSubmission,
): Result<FeedbackSubmission, PersistenceDomainError> {
  const context = createLocalDayContext(input.dayContext);
  if (
    !context.ok ||
    !Number.isSafeInteger(input.submittedAtMilliseconds) ||
    new Set(input.responses.map(({ id }) => id)).size !== input.responses.length ||
    new Set(input.responses.map(({ area }) => area)).size !== input.responses.length
  ) {
    return failure('feedbackSubmission');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      responses: Object.freeze(input.responses.map((response) => Object.freeze({ ...response }))),
      dayContext: context.value,
    }),
  };
}

export function parseRoutineStatus(value: string): RoutineStatus | undefined {
  return routineStatuses.includes(value as RoutineStatus) ? (value as RoutineStatus) : undefined;
}
