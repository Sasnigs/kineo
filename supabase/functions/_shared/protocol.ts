export const syncProtocolVersion = 'sync-v1.0.0';
export const selectionRulesVersion = 'selection-v1.0.0-prototype';
export const maximumSyncMutationCount = 100;
export const defaultChangePageSize = 200;
export const maximumChangePageSize = 500;
export const activeUnlockOutcomeCount = 2;

const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const cursorShape = /^[1-9][0-9]*$/u;
const bodyAreas = new Set(['neck', 'upperMidBack', 'lowerBack']);
const changeReports = new Set(['better', 'similar', 'worse']);
const movementComforts = new Set(['limited', 'okay', 'good']);
const safetyAnswers = new Set(['no', 'yes', 'notSure']);
const commandKinds = new Set([
  'acceptLegal',
  'saveProfile',
  'submitCheckIn',
  'applyAttentionTransition',
  'startRoutine',
  'recordRoutineEvent',
  'submitFeedback',
  'resetHistory',
]);

export type ServerRoutineLevel = 'gentle' | 'balanced' | 'active';

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

export type AuthoritativePlan = Readonly<{
  decisionId: string;
  checkInId: string;
  revision: number;
  rulesVersion: typeof selectionRulesVersion;
  catalogVersion: string;
  recommendedLevel: ServerRoutineLevel;
  selectedLevel: ServerRoutineLevel;
  deliveredLevel: ServerRoutineLevel;
  durationVariant: 'quick' | 'standard';
  includedAreas: readonly string[];
  routineSnapshot: Readonly<{
    schemaVersion: string;
    catalogVersion: string;
    rulesVersion: string;
    includedAreas: readonly string[];
    selectedLevel: ServerRoutineLevel;
    durationVariant: 'quick' | 'standard';
  }>;
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

export function createAuthoritativePlan(
  command: Readonly<Record<string, unknown> & { kind: string }>,
  historyCounts: Readonly<Record<string, number>>,
): AuthoritativePlan | undefined {
  if (command.kind !== 'submitCheckIn' || !isRecord(command.checkIn)) {
    return undefined;
  }
  const checkIn = command.checkIn;
  if (
    !isUuid(checkIn.id) ||
    !bodyAreas.has(String(checkIn.primaryArea)) ||
    !Array.isArray(checkIn.entries) ||
    checkIn.entries.length === 0
  ) {
    return undefined;
  }
  const parsedEntries: Array<{
    area: string;
    changeReport: string;
    movementComfort: string;
    conditionalSafetyAnswer?: string;
  }> = [];
  for (const entry of checkIn.entries) {
    if (
      !isRecord(entry) ||
      !isUuid(entry.id) ||
      !bodyAreas.has(String(entry.area)) ||
      !changeReports.has(String(entry.changeReport)) ||
      !movementComforts.has(String(entry.movementComfort))
    ) {
      return undefined;
    }
    const needsSafety =
      entry.changeReport === 'worse' || entry.movementComfort === 'limited';
    if (
      needsSafety !== (typeof entry.conditionalSafetyAnswer === 'string') ||
      (needsSafety && !safetyAnswers.has(String(entry.conditionalSafetyAnswer)))
    ) {
      return undefined;
    }
    parsedEntries.push({
      area: String(entry.area),
      changeReport: String(entry.changeReport),
      movementComfort: String(entry.movementComfort),
      ...(typeof entry.conditionalSafetyAnswer === 'string'
        ? { conditionalSafetyAnswer: entry.conditionalSafetyAnswer }
        : {}),
    });
  }
  if (
    parsedEntries.some(({ conditionalSafetyAnswer }) =>
      conditionalSafetyAnswer === 'yes' ||
      conditionalSafetyAnswer === 'notSure')
  ) {
    return undefined;
  }
  const primary = parsedEntries.find(
    ({ area }) => area === checkIn.primaryArea,
  );
  if (primary === undefined) return undefined;
  const primaryLevel = selectAreaLevel(
    primary.changeReport,
    primary.movementComfort,
    (historyCounts[primary.area] ?? 0) >= activeUnlockOutcomeCount,
  );
  const levels = parsedEntries.map((entry) =>
    selectAreaLevel(
      entry.changeReport,
      entry.movementComfort,
      (historyCounts[entry.area] ?? 0) >= activeUnlockOutcomeCount,
    ),
  );
  const recommendedLevel = levels.reduce(gentlerLevel, primaryLevel);
  const requestedOverride =
    command.requestedOverride === 'gentle' ||
    command.requestedOverride === 'balanced' ||
    command.requestedOverride === 'active'
      ? command.requestedOverride
      : undefined;
  const selectedLevel = requestedOverride === undefined
    ? recommendedLevel
    : gentlerLevel(recommendedLevel, requestedOverride);
  const decisionId = command.decisionId;
  if (!isUuid(decisionId)) return undefined;
  const durationVariant =
    command.durationVariant === 'quick' ? 'quick' : 'standard';
  const catalogVersion = '0.1.0';
  const includedAreas = parsedEntries.map(({ area }) => area);
  return {
    decisionId,
    checkInId: checkIn.id,
    revision: isPositiveSafeInteger(command.decisionRevision)
      ? command.decisionRevision
      : 1,
    rulesVersion: selectionRulesVersion,
    catalogVersion,
    recommendedLevel,
    selectedLevel,
    deliveredLevel: selectedLevel,
    durationVariant,
    includedAreas,
    routineSnapshot: {
      schemaVersion: 'routine-snapshot-v1',
      catalogVersion,
      rulesVersion: selectionRulesVersion,
      includedAreas,
      selectedLevel,
      durationVariant,
    },
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
    !commandKinds.has(value.command.kind)
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

function selectAreaLevel(
  changeReport: string,
  movementComfort: string,
  activeUnlocked: boolean,
): ServerRoutineLevel {
  if (changeReport === 'worse' || movementComfort === 'limited') {
    return 'gentle';
  }
  if (
    changeReport === 'better' &&
    movementComfort === 'good' &&
    activeUnlocked
  ) {
    return 'active';
  }
  return 'balanced';
}

function gentlerLevel(
  left: ServerRoutineLevel,
  right: ServerRoutineLevel,
): ServerRoutineLevel {
  const rank: Readonly<Record<ServerRoutineLevel, number>> = {
    gentle: 0,
    balanced: 1,
    active: 2,
  };
  return rank[left] <= rank[right] ? left : right;
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
