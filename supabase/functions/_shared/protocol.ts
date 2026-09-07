export const syncProtocolVersion = 'sync-v1.0.0';
export const maximumSyncMutationCount = 100;
export const defaultChangePageSize = 200;
export const maximumChangePageSize = 500;

const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const cursorShape = /^[1-9][0-9]*$/u;
const bodyAreas = new Set(['neck', 'upperMidBack', 'lowerBack']);
const changeReports = new Set(['better', 'similar', 'worse']);
const movementComforts = new Set(['limited', 'okay', 'good']);
const safetyAnswers = new Set(['no', 'yes', 'notSure']);
const legalDocumentKinds = new Set(['termsOfService', 'privacyPolicy']);
const safetyEventKinds = new Set([
  'attentionEntered',
  'attentionClearedReturnedToUsual',
  'attentionClearedCorrection',
  'attentionReaffirmed',
  'attentionReaffirmedCorrection',
]);
const safetyStatuses = new Set(['normal', 'attentionRequired']);
const routineStatuses = new Set([
  'prepared', 'inProgress', 'paused', 'completed',
  'stopped', 'safetyStopped', 'abandoned',
]);
const routineEventKinds = new Set([
  'started', 'paused', 'resumed', 'stepCompleted', 'skipped',
  'alternativeSelected', 'stopped', 'safetyStopped', 'completed', 'abandoned',
]);
const feedbackResponses = new Set(['better', 'same', 'worse']);
const telemetryChoices = new Set(['notOffered', 'declined', 'optedIn']);
const localDayShape = /^\d{4}-\d{2}-\d{2}$/u;
const localeShape = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const sha256Shape = /^[0-9a-f]{64}$/u;
const minimumWeeklyGoalDays = 1;
const maximumWeeklyGoalDays = 7;
const maximumCheckInEntryCount = 2;
const maximumFeedbackResponseCount = 2;
const minimumMinuteOfDay = 0;
const maximumMinuteOfDay = 1_440;
const commandKinds = new Set([
  'acceptLegal',
  'saveProfile',
  'submitCheckIn',
  'applyAttentionTransition',
  'recordPauseToday',
  'startRoutine',
  'recordRoutineEvent',
  'submitFeedback',
]);
export type ValidatedMutation = Readonly<{
  mutationId: string;
  installationId: string;
  historyEpoch: number;
  createdAtMilliseconds: number;
  command: Readonly<Record<string, unknown> & { kind: string }>;
}>;

export type ValidatedSyncRequest = Readonly<{
  installationId: string;
  cursor?: string;
  mutations: readonly ValidatedMutation[];
}>;

export type ValidatedBootstrapRequest = Readonly<{
  installationId: string;
  appVersion: string;
  platformVersion: string;
  cursor?: string;
}>;

export function validateBootstrapRequest(
  value: unknown,
): ValidatedBootstrapRequest | undefined {
  if (
    !isRecord(value) ||
    !isUuid(value.installationId) ||
    !isNonEmptyString(value.appVersion) ||
    !isNonEmptyString(value.platformVersion) ||
    !isOptionalCursor(value.cursor)
  ) {
    return undefined;
  }
  return {
    installationId: value.installationId,
    appVersion: value.appVersion,
    platformVersion: value.platformVersion,
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
  };
}

export function validateSyncRequest(
  value: unknown,
): ValidatedSyncRequest | undefined {
  if (
    !isRecord(value) ||
    !isUuid(value.installationId) ||
    !isOptionalCursor(value.cursor) ||
    !Array.isArray(value.mutations) ||
    value.mutations.length > maximumSyncMutationCount
  ) {
    return undefined;
  }
  const mutationIds = new Set<string>();
  const mutations: ValidatedMutation[] = [];
  let priorTimestamp = 0;
  for (const candidate of value.mutations) {
    const mutation = validateMutation(candidate, value.installationId);
    if (
      mutation === undefined ||
      mutationIds.has(mutation.mutationId) ||
      mutation.createdAtMilliseconds < priorTimestamp
    ) {
      return undefined;
    }
    mutationIds.add(mutation.mutationId);
    priorTimestamp = mutation.createdAtMilliseconds;
    mutations.push(mutation);
  }
  return {
    installationId: value.installationId,
    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
    mutations,
  };
}

export function decodeCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return 0;
  if (!cursorShape.test(cursor)) return undefined;
  const value = Number(cursor);
  return Number.isSafeInteger(value) ? value : undefined;
}

function validateMutation(
  value: unknown,
  installationId: string,
): ValidatedMutation | undefined {
  if (
    !isRecord(value) ||
    !isUuid(value.mutationId) ||
    value.installationId !== installationId ||
    !isPositiveSafeInteger(value.historyEpoch) ||
    !isPositiveSafeInteger(value.createdAtMilliseconds) ||
    !isRecord(value.command) ||
    typeof value.command.kind !== 'string' ||
    !commandKinds.has(value.command.kind) ||
    !validateCommand(value.command)
  ) {
    return undefined;
  }
  return {
    mutationId: value.mutationId,
    installationId,
    historyEpoch: value.historyEpoch,
    createdAtMilliseconds: value.createdAtMilliseconds,
    command: value.command as Readonly<Record<string, unknown> & { kind: string }>,
  };
}

function validateCommand(command: Record<string, unknown>): boolean {
  // This field is exclusively server-owned; never accept an injected approval.
  if ('authoritativePlan' in command || 'authorityVersion' in command) return false;
  switch (command.kind) {
    case 'acceptLegal':
      return isRecord(command.acceptance) &&
        legalDocumentKinds.has(String(command.acceptance.documentKind)) &&
        isNonEmptyString(command.acceptance.documentVersion) &&
        typeof command.acceptance.locale === 'string' &&
        localeShape.test(command.acceptance.locale) &&
        isPositiveSafeInteger(command.acceptance.acceptedAtMilliseconds);
    case 'saveProfile':
      return validateProfileCommand(command);
    case 'submitCheckIn':
      return validateSubmitCheckInCommand(command);
    case 'applyAttentionTransition':
      return validateAttentionTransition(command.transition);
    case 'recordPauseToday':
      return validatePauseToday(command.event);
    case 'startRoutine':
      return validateRoutineStart(command);
    case 'recordRoutineEvent':
      return validateRoutineEvent(command.event);
    case 'submitFeedback':
      return validateFeedback(command.submission);
    case 'resetHistory':
      return true;
    default:
      return false;
  }
}

function validateProfileCommand(command: Record<string, unknown>): boolean {
  if (!isNonNegativeSafeInteger(command.expectedVersion) || !isRecord(command.profile)) {
    return false;
  }
  const profile = command.profile;
  const primary = optionalArea(profile.primaryArea);
  const secondary = optionalArea(profile.secondaryArea);
  if (
    typeof profile.adultAcknowledged !== 'boolean' ||
    !isBoundedSafeInteger(
      profile.weeklyGoalDays,
      minimumWeeklyGoalDays,
      maximumWeeklyGoalDays,
    ) ||
    primary === false ||
    secondary === false ||
    (typeof primary === 'string' && primary === secondary) ||
    !isOptionalNonEmptyString(profile.safetyBoundaryVersion) ||
    !isOptionalPositiveSafeInteger(profile.safetyAcknowledgedAtMilliseconds) ||
    !isOptionalPositiveSafeInteger(profile.onboardingCompletedAtMilliseconds) ||
    !isOptionalNonEmptyString(profile.routinePreference) ||
    !telemetryChoices.has(String(profile.telemetryChoice)) ||
    !isPositiveSafeInteger(profile.createdAtMilliseconds) ||
    !isPositiveSafeInteger(profile.updatedAtMilliseconds) ||
    Number(profile.updatedAtMilliseconds) < Number(profile.createdAtMilliseconds)
  ) return false;
  if (command.reminderSettings === undefined) return true;
  if (!isRecord(command.reminderSettings)) return false;
  const reminder = command.reminderSettings;
  if (
    typeof reminder.enabled !== 'boolean' ||
    !isOptionalNonEmptyString(reminder.timeZoneId) ||
    !isPositiveSafeInteger(reminder.updatedAtMilliseconds)
  ) return false;
  if (!reminder.enabled) return true;
  return isRecord(reminder.window) &&
    isBoundedSafeInteger(
      reminder.window.startMinutes,
      minimumMinuteOfDay,
      maximumMinuteOfDay - 1,
    ) &&
    isBoundedSafeInteger(
      reminder.window.endMinutes,
      minimumMinuteOfDay + 1,
      maximumMinuteOfDay,
    ) &&
    Number(reminder.window.endMinutes) > Number(reminder.window.startMinutes);
}

function validateSubmitCheckInCommand(command: Record<string, unknown>): boolean {
  if (
    !isUuid(command.decisionId) ||
    !isPositiveSafeInteger(command.decisionRevision) ||
    (command.durationVariant !== 'quick' && command.durationVariant !== 'standard') ||
    (command.requestedOverride !== undefined &&
      command.requestedOverride !== 'gentle' &&
      command.requestedOverride !== 'balanced' &&
      command.requestedOverride !== 'active') ||
    (command.suppressPlan !== undefined && typeof command.suppressPlan !== 'boolean')
  ) return false;
  if (!validateCheckIn(command.checkIn)) return false;
  if (command.attentionTransitions === undefined) return true;
  return Array.isArray(command.attentionTransitions) &&
    command.attentionTransitions.length <= maximumCheckInEntryCount &&
    command.attentionTransitions.every(validateAttentionTransition);
}

function validateCheckIn(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    value.status !== 'completed' ||
    (value.kind !== 'normal' && value.kind !== 'attentionCorrection') ||
    !bodyAreas.has(String(value.primaryArea)) ||
    optionalArea(value.secondaryArea) === false ||
    value.primaryArea === value.secondaryArea ||
    !isPositiveSafeInteger(value.startedAtMilliseconds) ||
    !isPositiveSafeInteger(value.completedAtMilliseconds) ||
    Number(value.completedAtMilliseconds) < Number(value.startedAtMilliseconds) ||
    !validateDayContext(value.dayContext) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0 ||
    value.entries.length > maximumCheckInEntryCount
  ) return false;
  const ids = new Set<string>();
  const areas = new Set<string>();
  for (const entry of value.entries) {
    if (
      !isRecord(entry) ||
      !isUuid(entry.id) ||
      ids.has(entry.id) ||
      !bodyAreas.has(String(entry.area)) ||
      areas.has(String(entry.area)) ||
      (entry.role !== 'primary' && entry.role !== 'secondary') ||
      !changeReports.has(String(entry.changeReport)) ||
      !movementComforts.has(String(entry.movementComfort)) ||
      !isPositiveSafeInteger(entry.submittedAtMilliseconds)
    ) return false;
    const needsSafety =
      entry.changeReport === 'worse' || entry.movementComfort === 'limited';
    if (
      needsSafety !== (typeof entry.conditionalSafetyAnswer === 'string') ||
      (needsSafety && !safetyAnswers.has(String(entry.conditionalSafetyAnswer)))
    ) return false;
    ids.add(entry.id);
    areas.add(String(entry.area));
  }
  return areas.has(String(value.primaryArea)) &&
    (value.secondaryArea === undefined || areas.has(String(value.secondaryArea)));
}

function validateAttentionTransition(value: unknown): boolean {
  if (!(isRecord(value) &&
    isUuid(value.id) &&
    bodyAreas.has(String(value.area)) &&
    safetyEventKinds.has(String(value.kind)) &&
    safetyStatuses.has(String(value.statusAfter)) &&
    (value.sourceCheckInEntryId === undefined || isUuid(value.sourceCheckInEntryId)) &&
    (value.returnAnswer === undefined || safetyAnswers.has(String(value.returnAnswer))) &&
    isOptionalPositiveSafeInteger(value.expectedAttentionUpdatedAtMilliseconds) &&
    isPositiveSafeInteger(value.occurredAtMilliseconds) &&
    validateDayContext(value.dayContext))) return false;
  const clearsAttention = value.kind === 'attentionClearedReturnedToUsual' ||
    value.kind === 'attentionClearedCorrection';
  return clearsAttention
    ? value.statusAfter === 'normal'
    : value.statusAfter === 'attentionRequired';
}

function validatePauseToday(value: unknown): boolean {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.checkInId) &&
    isPositiveSafeInteger(value.chosenAtMilliseconds) &&
    validateDayContext(value.dayContext);
}

function validateRoutineStart(command: Record<string, unknown>): boolean {
  if (
    !isUuid(command.decisionId) ||
    !isRecord(command.decision) ||
    command.decision.id !== command.decisionId ||
    !isUuid(command.decision.checkInId) ||
    !isPositiveSafeInteger(command.decision.revision) ||
    !isNonEmptyString(command.decision.rulesVersion) ||
    !isNonEmptyString(command.decision.catalogVersionRequested) ||
    !isNonEmptyString(command.decision.catalogVersionDelivered) ||
    !routineLevel(command.decision.recommendedLevel) ||
    !routineLevel(command.decision.selectedLevel) ||
    !routineLevel(command.decision.deliveredLevel) ||
    (command.decision.duration !== 'quick' && command.decision.duration !== 'standard') ||
    typeof command.decision.compositionFingerprint !== 'string' ||
    !sha256Shape.test(command.decision.compositionFingerprint) ||
    !Array.isArray(command.decision.areaInputs) ||
    command.decision.areaInputs.length === 0 ||
    command.decision.areaInputs.length > maximumCheckInEntryCount ||
    !Array.isArray(command.decision.reasons) ||
    !Array.isArray(command.decision.notices) ||
    !isRecord(command.routine)
  ) return false;
  const routine = command.routine;
  if (
    !isUuid(routine.id) ||
    routine.decisionId !== command.decisionId ||
    !isUuid(routine.checkInId) ||
    routine.status !== 'prepared' ||
    routine.currentStepIndex !== 0 ||
    routine.stepElapsedMilliseconds !== 0 ||
    routine.startedAtMilliseconds !== undefined ||
    routine.endedAtMilliseconds !== undefined ||
    !isPositiveSafeInteger(routine.updatedAtMilliseconds) ||
    !validateDayContext(routine.dayContext) ||
    !isRecord(routine.snapshot) ||
    typeof routine.snapshot.json !== 'string' ||
    !sha256Shape.test(String(routine.snapshot.checksum)) ||
    !Array.isArray(routine.snapshot.includedAreas) ||
    routine.snapshot.includedAreas.length === 0 ||
    routine.snapshot.includedAreas.length > maximumCheckInEntryCount ||
    routine.snapshot.includedAreas.some((area) => !bodyAreas.has(String(area)))
  ) return false;
  try {
    const snapshot: unknown = JSON.parse(routine.snapshot.json);
    return isRecord(snapshot) &&
      snapshot.sessionId === routine.id &&
      snapshot.decisionId === command.decisionId;
  } catch {
    return false;
  }
}

function routineLevel(value: unknown): boolean {
  return value === 'gentle' || value === 'balanced' || value === 'active';
}

function validateRoutineEvent(value: unknown): boolean {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.routineSessionId) &&
    isPositiveSafeInteger(value.sequenceNumber) &&
    routineEventKinds.has(String(value.kind)) &&
    isPositiveSafeInteger(value.occurredAtMilliseconds) &&
    isPositiveSafeInteger(value.expectedVersion) &&
    routineStatuses.has(String(value.resultingStatus)) &&
    isNonNegativeSafeInteger(value.resultingStepIndex) &&
    isNonNegativeSafeInteger(value.resultingStepElapsedMilliseconds) &&
    (value.kind === 'started'
      ? isPositiveSafeInteger(value.resultingStartedAtMilliseconds)
      : isOptionalPositiveSafeInteger(value.resultingStartedAtMilliseconds)) &&
    isPositiveSafeInteger(value.resultingUpdatedAtMilliseconds) &&
    isOptionalPositiveSafeInteger(value.resultingEndedAtMilliseconds);
}

function validateFeedback(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.routineSessionId) ||
    !isPositiveSafeInteger(value.submittedAtMilliseconds) ||
    !validateDayContext(value.dayContext) ||
    !Array.isArray(value.responses) ||
    value.responses.length > maximumFeedbackResponseCount
  ) return false;
  const ids = new Set<string>();
  const areas = new Set<string>();
  return value.responses.every((response) => {
    if (
      !isRecord(response) ||
      !isUuid(response.id) ||
      ids.has(response.id) ||
      !bodyAreas.has(String(response.area)) ||
      areas.has(String(response.area)) ||
      !feedbackResponses.has(String(response.response))
    ) return false;
    ids.add(response.id);
    areas.add(String(response.area));
    return true;
  });
}

function validateDayContext(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.localDay === 'string' &&
    localDayShape.test(value.localDay) &&
    isNonEmptyString(value.timeZoneId) &&
    isNonEmptyString(value.calendarId);
}

function optionalArea(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === 'string' && bodyAreas.has(value) ? value : false;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalPositiveSafeInteger(value: unknown): boolean {
  return value === undefined || isPositiveSafeInteger(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidShape.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalCursor(value: unknown): boolean {
  return value === undefined ||
    (typeof value === 'string' && cursorShape.test(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
