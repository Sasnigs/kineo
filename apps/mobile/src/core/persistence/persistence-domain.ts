import {
  requiresConditionalSafetyAnswer,
  type AreaRole,
  type BodyArea,
  type ChangeReport,
  type CheckInEntryId,
  type CheckInId,
  type ConditionalSafetyAnswer,
  type MovementComfort,
  type SafetyStatus,
} from '../domain/selection-domain';
import type { Result } from '../shared/result';

export type PersistenceDomainError = Readonly<{
  code: 'invalidDomainValue';
  field: string;
}>;

declare const localDayBrand: unique symbol;
export type LocalDay = string & { readonly [localDayBrand]: 'LocalDay' };

declare const safetyEventIdBrand: unique symbol;
export type SafetyEventId = string & {
  readonly [safetyEventIdBrand]: 'SafetyEventId';
};

declare const pauseTodayEventIdBrand: unique symbol;
export type PauseTodayEventId = string & {
  readonly [pauseTodayEventIdBrand]: 'PauseTodayEventId';
};

export type LocalDayContext = Readonly<{
  localDay: LocalDay;
  timeZoneId: string;
  calendarId: string;
}>;

export const telemetryChoices = [
  'notOffered',
  'declined',
  'optedIn',
] as const;
export type TelemetryChoice = (typeof telemetryChoices)[number];

export type UserProfile = Readonly<{
  onboardingCompletedAtMilliseconds?: number;
  adultAcknowledged: boolean;
  safetyBoundaryVersion?: string;
  safetyAcknowledgedAtMilliseconds?: number;
  primaryArea?: BodyArea;
  secondaryArea?: BodyArea;
  routinePreference?: string;
  weeklyGoalDays: number;
  telemetryChoice: TelemetryChoice;
  createdAtMilliseconds: number;
  updatedAtMilliseconds: number;
}>;

export type ReminderWindow = Readonly<{
  startMinutes: number;
  endMinutes: number;
}>;

export type ReminderSettings = Readonly<{
  enabled: boolean;
  window?: ReminderWindow;
  timeZoneId?: string;
  updatedAtMilliseconds: number;
}>;

export type ProfileState = Readonly<{
  profile: UserProfile;
  reminderSettings?: ReminderSettings;
}>;

export const checkInStatuses = ['draft', 'completed', 'abandoned'] as const;
export type CheckInStatus = (typeof checkInStatuses)[number];

export const checkInKinds = ['normal', 'attentionCorrection'] as const;
export type CheckInKind = (typeof checkInKinds)[number];

export type CorrectionSource = Readonly<{
  area: BodyArea;
  triggeringEntryId?: CheckInEntryId;
}>;

export type CheckInEntry = Readonly<{
  id: CheckInEntryId;
  area: BodyArea;
  role: AreaRole;
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  conditionalSafetyAnswer?: ConditionalSafetyAnswer;
  submittedAtMilliseconds: number;
}>;

export type CheckIn = Readonly<{
  id: CheckInId;
  status: CheckInStatus;
  kind: CheckInKind;
  correctionSource?: CorrectionSource;
  primaryArea: BodyArea;
  secondaryArea?: BodyArea;
  startedAtMilliseconds: number;
  completedAtMilliseconds?: number;
  dayContext: LocalDayContext;
  entries: readonly CheckInEntry[];
}>;

export const safetyEventKinds = [
  'attentionEntered',
  'attentionClearedReturnedToUsual',
  'attentionClearedCorrection',
  'attentionReaffirmed',
  'attentionReaffirmedCorrection',
] as const;
export type SafetyEventKind = (typeof safetyEventKinds)[number];

export type AttentionState = Readonly<{
  area: BodyArea;
  updatedAtMilliseconds: number;
}>;

export type SafetyEvent = Readonly<{
  id: SafetyEventId;
  area: BodyArea;
  kind: SafetyEventKind;
  sourceCheckInEntryId?: CheckInEntryId;
  returnAnswer?: ConditionalSafetyAnswer;
  occurredAtMilliseconds: number;
  dayContext: LocalDayContext;
}>;

export type SafetyMutation = Readonly<{
  event: SafetyEvent;
  statusAfter: SafetyStatus;
  expectedAttentionUpdatedAtMilliseconds?: number;
}>;

export type PauseTodayEvent = Readonly<{
  id: PauseTodayEventId;
  checkInId: CheckInId;
  chosenAtMilliseconds: number;
  dayContext: LocalDayContext;
}>;

export const minimumWeeklyGoalDays = 1;
export const maximumWeeklyGoalDays = 7;
export const defaultWeeklyGoalDays = 3;
export const firstReminderStartMinute = 0;
export const lastReminderStartMinute = 1_439;
export const firstReminderEndMinute = 1;
export const endOfDayMinute = 1_440;

const canonicalLowercaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const localDayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const firstMonth = 1;
const lastMonth = 12;
const firstDay = 1;
const utcMonthOffset = 1;

function failure<Value>(field: string): Result<Value, PersistenceDomainError> {
  return { ok: false, error: { code: 'invalidDomainValue', field } };
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function isTimestamp(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value);
}

function parseUuid<Value extends string>(
  candidate: string,
): Result<Value, PersistenceDomainError> {
  return canonicalLowercaseUuidPattern.test(candidate)
    ? { ok: true, value: candidate as Value }
    : failure('identifier');
}

export function parseSafetyEventId(
  candidate: string,
): Result<SafetyEventId, PersistenceDomainError> {
  return parseUuid<SafetyEventId>(candidate);
}

export function parsePauseTodayEventId(
  candidate: string,
): Result<PauseTodayEventId, PersistenceDomainError> {
  return parseUuid<PauseTodayEventId>(candidate);
}

export function parseLocalDay(
  candidate: string,
): Result<LocalDay, PersistenceDomainError> {
  const match = localDayPattern.exec(candidate);
  if (match === null) {
    return failure('localDay');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(day) ||
    year <= 0 ||
    month < firstMonth ||
    month > lastMonth ||
    day < firstDay
  ) {
    return failure('localDay');
  }
  const date = new Date(Date.UTC(year, month - utcMonthOffset, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - utcMonthOffset ||
    date.getUTCDate() !== day
  ) {
    return failure('localDay');
  }
  return { ok: true, value: candidate as LocalDay };
}

export function createLocalDayContext(
  input: LocalDayContext,
): Result<LocalDayContext, PersistenceDomainError> {
  if (!isNonEmpty(input.timeZoneId) || !isNonEmpty(input.calendarId)) {
    return failure('dayContext');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function createUserProfile(
  input: UserProfile,
): Result<UserProfile, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.weeklyGoalDays) ||
    input.weeklyGoalDays < minimumWeeklyGoalDays ||
    input.weeklyGoalDays > maximumWeeklyGoalDays
  ) {
    return failure('weeklyGoalDays');
  }
  if (
    !isTimestamp(input.createdAtMilliseconds) ||
    !isTimestamp(input.updatedAtMilliseconds) ||
    input.updatedAtMilliseconds < input.createdAtMilliseconds
  ) {
    return failure('profileTimestamps');
  }
  if (input.primaryArea !== undefined && input.primaryArea === input.secondaryArea) {
    return failure('profileAreas');
  }
  if (
    input.routinePreference !== undefined &&
    !isNonEmpty(input.routinePreference)
  ) {
    return failure('routinePreference');
  }
  if (
    input.onboardingCompletedAtMilliseconds !== undefined &&
    (!isTimestamp(input.onboardingCompletedAtMilliseconds) ||
      !input.adultAcknowledged ||
      !isNonEmpty(input.safetyBoundaryVersion) ||
      !isTimestamp(input.safetyAcknowledgedAtMilliseconds) ||
      input.primaryArea === undefined)
  ) {
    return failure('completedOnboarding');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function createReminderWindow(
  input: ReminderWindow,
): Result<ReminderWindow, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.startMinutes) ||
    !Number.isSafeInteger(input.endMinutes) ||
    input.startMinutes < firstReminderStartMinute ||
    input.startMinutes > lastReminderStartMinute ||
    input.endMinutes < firstReminderEndMinute ||
    input.endMinutes > endOfDayMinute ||
    input.endMinutes <= input.startMinutes
  ) {
    return failure('reminderWindow');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function createReminderSettings(
  input: ReminderSettings,
): Result<ReminderSettings, PersistenceDomainError> {
  if (
    !isTimestamp(input.updatedAtMilliseconds) ||
    (input.enabled && input.window === undefined) ||
    (input.timeZoneId !== undefined && !isNonEmpty(input.timeZoneId))
  ) {
    return failure('reminderSettings');
  }
  const window =
    input.window === undefined ? undefined : createReminderWindow(input.window);
  if (window !== undefined && !window.ok) {
    return window;
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      window: window?.value,
    }),
  };
}

export function createProfileState(
  input: ProfileState,
): Result<ProfileState, PersistenceDomainError> {
  const profile = createUserProfile(input.profile);
  if (!profile.ok) {
    return profile;
  }
  const reminderSettings =
    input.reminderSettings === undefined
      ? undefined
      : createReminderSettings(input.reminderSettings);
  if (reminderSettings !== undefined && !reminderSettings.ok) {
    return reminderSettings;
  }
  return {
    ok: true,
    value: Object.freeze({
      profile: profile.value,
      reminderSettings: reminderSettings?.value,
    }),
  };
}

export function createCheckInEntry(
  input: CheckInEntry,
): Result<CheckInEntry, PersistenceDomainError> {
  const requiresAnswer = requiresConditionalSafetyAnswer(input);
  if (
    requiresAnswer !== (input.conditionalSafetyAnswer !== undefined) ||
    !isTimestamp(input.submittedAtMilliseconds)
  ) {
    return failure('checkInEntry');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function createCheckIn(
  input: CheckIn,
): Result<CheckIn, PersistenceDomainError> {
  const dayContext = createLocalDayContext(input.dayContext);
  if (!dayContext.ok) {
    return dayContext;
  }
  if (
    input.primaryArea === input.secondaryArea ||
    !isTimestamp(input.startedAtMilliseconds)
  ) {
    return failure('checkIn');
  }
  if (
    (input.kind === 'normal') !== (input.correctionSource === undefined) ||
    (input.correctionSource !== undefined &&
      input.correctionSource.area !== input.primaryArea &&
      input.correctionSource.area !== input.secondaryArea)
  ) {
    return failure('correctionSource');
  }
  const entries: CheckInEntry[] = [];
  for (const inputEntry of input.entries) {
    const entry = createCheckInEntry(inputEntry);
    if (!entry.ok) {
      return entry;
    }
    const expectedRole: AreaRole | undefined =
      entry.value.area === input.primaryArea
        ? 'primary'
        : entry.value.area === input.secondaryArea
          ? 'secondary'
          : undefined;
    if (entry.value.role !== expectedRole) {
      return failure('checkInEntryRole');
    }
    entries.push(entry.value);
  }
  if (
    new Set(entries.map((entry) => entry.id)).size !== entries.length ||
    new Set(entries.map((entry) => entry.area)).size !== entries.length
  ) {
    return failure('duplicateCheckInEntry');
  }
  const primaryEntryExists = entries.some(
    (entry) => entry.area === input.primaryArea && entry.role === 'primary',
  );
  if (
    (input.status === 'completed' &&
      (!isTimestamp(input.completedAtMilliseconds) ||
        input.completedAtMilliseconds < input.startedAtMilliseconds ||
        !primaryEntryExists)) ||
    (input.status !== 'completed' &&
      input.completedAtMilliseconds !== undefined)
  ) {
    return failure('checkInStatus');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      correctionSource:
        input.correctionSource === undefined
          ? undefined
          : Object.freeze({ ...input.correctionSource }),
      dayContext: dayContext.value,
      entries: Object.freeze(entries),
    }),
  };
}

export function createAttentionState(
  input: AttentionState,
): Result<AttentionState, PersistenceDomainError> {
  return isTimestamp(input.updatedAtMilliseconds)
    ? { ok: true, value: Object.freeze({ ...input }) }
    : failure('attentionState');
}

export function createSafetyEvent(
  input: SafetyEvent,
): Result<SafetyEvent, PersistenceDomainError> {
  const dayContext = createLocalDayContext(input.dayContext);
  if (!dayContext.ok) {
    return dayContext;
  }
  const isEntrySourced =
    input.kind === 'attentionEntered' ||
    input.kind === 'attentionClearedCorrection' ||
    input.kind === 'attentionReaffirmedCorrection';
  const hasValidShape = isEntrySourced
    ? input.sourceCheckInEntryId !== undefined && input.returnAnswer === undefined
    : input.kind === 'attentionClearedReturnedToUsual'
      ? input.sourceCheckInEntryId === undefined && input.returnAnswer === 'yes'
      : input.sourceCheckInEntryId === undefined &&
        (input.returnAnswer === 'no' || input.returnAnswer === 'notSure');
  if (!hasValidShape || !isTimestamp(input.occurredAtMilliseconds)) {
    return failure('safetyEvent');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      dayContext: dayContext.value,
    }),
  };
}

export function createSafetyMutation(
  input: SafetyMutation,
): Result<SafetyMutation, PersistenceDomainError> {
  const event = createSafetyEvent(input.event);
  if (!event.ok) {
    return event;
  }
  const clearsAttention =
    event.value.kind === 'attentionClearedReturnedToUsual' ||
    event.value.kind === 'attentionClearedCorrection';
  const expectedStatus: SafetyStatus = clearsAttention
    ? 'normal'
    : 'attentionRequired';
  const changesExistingAttention = event.value.kind !== 'attentionEntered';
  const expectedTimestamp = input.expectedAttentionUpdatedAtMilliseconds;
  if (
    input.statusAfter !== expectedStatus ||
    (changesExistingAttention &&
      (!isTimestamp(expectedTimestamp) ||
        expectedTimestamp >= event.value.occurredAtMilliseconds)) ||
    (!changesExistingAttention && expectedTimestamp !== undefined)
  ) {
    return failure('safetyMutation');
  }
  return {
    ok: true,
    value: Object.freeze({ ...input, event: event.value }),
  };
}

export function createPauseTodayEvent(
  input: PauseTodayEvent,
): Result<PauseTodayEvent, PersistenceDomainError> {
  const dayContext = createLocalDayContext(input.dayContext);
  if (!dayContext.ok) {
    return dayContext;
  }
  if (!isTimestamp(input.chosenAtMilliseconds)) {
    return failure('pauseTodayEvent');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      dayContext: dayContext.value,
    }),
  };
}
