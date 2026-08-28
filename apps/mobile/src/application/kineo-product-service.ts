import {
  bodyAreas,
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
  terminalRoutineStatuses,
  type DurationVariant,
  type AreaResponse,
  type ConditionalSafetyAnswer,
  type RoutineLevel,
  type SelectionDecisionId,
  type BodyArea,
} from '../core/domain/selection-domain';
import {
  parseCompositionId,
  composeRoutine,
  type ComposedRoutine,
} from '../core/content/routine-composer';
import {
  makePrototypeRoutineCatalog,
  prototypeCatalogAssetDigests,
  prototypeCatalogLocalizedStrings,
} from '../core/content/prototype-routine-catalog';
import {
  createSelectionDecision,
  type SelectionDecision,
} from '../core/persistence/decision-persistence-domain';
import type { PersistenceError } from '../core/persistence/persistence-contract';
import type { KineoPersistence } from '../core/persistence/kineo-store';
import {
  createProfileState,
  createReminderSettings,
  createSafetyEvent,
  createSafetyMutation,
  defaultWeeklyGoalDays,
  parseLocalDay,
  parseSafetyEventId,
  type CheckIn,
  type LocalDayContext,
  type ProfileState,
  type ReminderWindow,
  type UserProfile,
} from '../core/persistence/persistence-domain';
import type { ReminderScheduling } from '../core/product/reminder-scheduling';
import {
  createActiveHistoryState,
  isActiveUnlocked,
  reduceActiveHistory,
  type ActiveHistoryState,
} from '../core/selection/active-history';
import {
  prototypeSelectionRulesVersion,
  selectPlan,
  type SelectedPlan,
} from '../core/selection/plan-selector';
import type {
  CheckInDraft,
  AreaCheckInAnswers,
  AttentionCorrectionDraft,
  AttentionPrompt,
  AttentionResolution,
  CheckInResult,
  PlanPresentation,
  ProfilePresentation,
  ProgressPresentation,
  RoutinePresentation,
  ProductResult,
  ProductStartState,
} from '../core/product/product-flow';
import {
  createPauseTodayEvent,
  parsePauseTodayEventId,
  type RoutineEventReason,
} from '../core/persistence/routine-persistence-domain';
import { KineoRoutineModule } from './kineo-routine-module';
import { KineoAttentionModule } from './kineo-attention-module';

export type ProductClock = Readonly<{
  nowMilliseconds(): number;
}>;

export type ProductRuntime = Readonly<{
  nextIdentifier(): string;
  monotonicMilliseconds(): number;
  localDayContext(): Readonly<{
    localDay: string;
    timeZoneId: string;
    calendarId: string;
  }>;
}>;

export const prototypeSafetyBoundaryVersion = 'prototype-safety-v1';
const firstEntryRevision = 1;
const firstDecisionRevision = 1;
const noExistingRevision = 0;

export interface KineoProductServing {
  loadStartState(): Promise<ProductResult<ProductStartState>>;
  confirmAdultEligibility(): Promise<ProductResult<void>>;
  savePrimaryArea(area: BodyArea): Promise<ProductResult<void>>;
  saveSecondaryArea(area?: BodyArea): Promise<ProductResult<void>>;
  acknowledgeSafetyBoundary(): Promise<ProductResult<void>>;
  completeOnboarding(): Promise<ProductResult<BodyArea>>;
  respondToAttentionReturn(
    prompt: AttentionPrompt,
    answer: ConditionalSafetyAnswer,
  ): Promise<ProductResult<AttentionResolution>>;
  beginAttentionCorrection(
    prompt: AttentionPrompt,
  ): Promise<ProductResult<AttentionCorrectionDraft>>;
  submitAttentionCorrection(
    draft: AttentionCorrectionDraft,
    answers: AreaCheckInAnswers,
  ): Promise<ProductResult<AttentionResolution>>;
  beginCheckIn(): Promise<ProductResult<CheckInDraft>>;
  submitCheckIn(
    draft: CheckInDraft,
    primary: AreaCheckInAnswers,
    secondary?: AreaCheckInAnswers,
  ): Promise<ProductResult<CheckInResult>>;
  revisePlan(
    checkInId: CheckInDraft['checkInId'],
    duration: DurationVariant,
    requestedLevel?: RoutineLevel,
  ): Promise<ProductResult<PlanPresentation>>;
  pauseToday(
    checkInId: CheckInDraft['checkInId'],
  ): Promise<ProductResult<BodyArea>>;
  startRoutine(
    decisionId: PlanPresentation['decisionId'],
  ): Promise<ProductResult<RoutinePresentation>>;
  refreshRoutine(
    sessionId: RoutinePresentation['sessionId'],
  ): Promise<ProductResult<RoutinePresentation>>;
  pauseRoutine(
    sessionId: RoutinePresentation['sessionId'],
  ): Promise<ProductResult<RoutinePresentation>>;
  resumeRoutine(
    sessionId: RoutinePresentation['sessionId'],
  ): Promise<ProductResult<RoutinePresentation>>;
  advanceRoutine(
    sessionId: RoutinePresentation['sessionId'],
    expectedStepIndex: number,
  ): Promise<ProductResult<RoutinePresentation>>;
  skipRoutineStep(
    sessionId: RoutinePresentation['sessionId'],
    expectedStepIndex: number,
    reason?: RoutineEventReason,
  ): Promise<ProductResult<RoutinePresentation>>;
  selectRoutineAlternative(
    sessionId: RoutinePresentation['sessionId'],
    expectedStepIndex: number,
    movementId: NonNullable<RoutinePresentation['currentItem']>['availableAlternatives'][number]['movementId'],
  ): Promise<ProductResult<RoutinePresentation>>;
  endRoutine(
    sessionId: RoutinePresentation['sessionId'],
    forSafety: boolean,
  ): Promise<ProductResult<RoutinePresentation>>;
  submitFeedback(
    sessionId: RoutinePresentation['sessionId'],
    responses: Readonly<Partial<Record<BodyArea, AreaResponse>>>,
  ): Promise<ProductResult<void>>;
  loadProgress(): Promise<ProductResult<ProgressPresentation>>;
  loadProfile(): Promise<ProductResult<ProfilePresentation>>;
  saveAreaPreferences(
    primaryArea: BodyArea,
    secondaryArea?: BodyArea,
  ): Promise<ProductResult<ProfilePresentation>>;
  enableReminder(
    window: ReminderWindow,
  ): Promise<ProductResult<ProfilePresentation>>;
  disableReminder(): Promise<ProductResult<ProfilePresentation>>;
  resetHistory(): Promise<ProductResult<void>>;
  deleteAllData(): Promise<ProductResult<void>>;
}

function persistenceFailure<Value>(
  cause: PersistenceError,
): ProductResult<Value> {
  return { ok: false, error: { code: 'persistence', cause } };
}

const invalidState = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'invalidState' as const }),
});

export class KineoProductService implements KineoProductServing {
  private readonly routineModule: KineoRoutineModule;
  private readonly attentionModule: KineoAttentionModule;

  constructor(
    private readonly store: KineoPersistence,
    private readonly clock: ProductClock,
    private readonly runtime: ProductRuntime,
    private readonly reminderScheduler: ReminderScheduling,
  ) {
    this.routineModule = new KineoRoutineModule(store, {
      nowMilliseconds: () => clock.nowMilliseconds(),
      monotonicMilliseconds: () => runtime.monotonicMilliseconds(),
      nextIdentifier: () => runtime.nextIdentifier(),
    });
    this.attentionModule = new KineoAttentionModule(store, clock, runtime);
  }

  async loadStartState(): Promise<ProductResult<ProductStartState>> {
    const profile = await this.store.loadProfileState();
    if (!profile.ok) return persistenceFailure(profile.error);
    const progress = this.onboardingProgress(profile.value?.profile);
    if (progress !== undefined) {
      return { ok: true, value: { kind: 'onboarding', progress } };
    }
    const primaryArea = profile.value?.profile.primaryArea;
    if (primaryArea === undefined) return invalidState;

    const routine = await this.store.loadNonterminalRoutine();
    if (!routine.ok) return persistenceFailure(routine.error);
    if (routine.value !== undefined) {
      const restored = await this.routineModule.restoreInterrupted(routine.value);
      return restored.ok
        ? { ok: true, value: { kind: 'unfinishedRoutine', routine: restored.value } }
        : restored;
    }
    const attention = await this.store.loadAttentionStates();
    if (!attention.ok) return persistenceFailure(attention.error);
    const firstAttention = attention.value[0];
    if (firstAttention !== undefined) {
      const prompt = this.attentionModule.prompt(firstAttention);
      if (!prompt.ok) return prompt;
      return {
          ok: true,
          value: {
            kind: 'attentionRequired',
            prompt: prompt.value,
          },
        };
    }
    const draft = await this.store.loadLatestCheckInDraft('normal');
    if (!draft.ok) return persistenceFailure(draft.error);
    if (
      draft.value !== undefined &&
      draft.value.primaryArea === primaryArea &&
      draft.value.secondaryArea === profile.value?.profile.secondaryArea &&
      draft.value.dayContext.localDay === this.runtime.localDayContext().localDay
    ) {
      const restored = this.checkInDraft(draft.value);
      return restored === undefined
        ? { ok: false, error: { code: 'invalidData' } }
        : { ok: true, value: { kind: 'unfinishedCheckIn', draft: restored } };
    }
    if (draft.value !== undefined) {
      const abandoned = await this.store.abandonCheckInDraft(draft.value.id);
      if (!abandoned.ok) return persistenceFailure(abandoned.error);
    }
    const decision = await this.store.loadLatestUnconsumedSelectionDecision();
    if (!decision.ok) return persistenceFailure(decision.error);
    if (decision.value !== undefined) {
      const plan = await this.preparePlan(
        decision.value.checkInId,
        decision.value.duration,
        decision.value.requestedOverride,
      );
      return plan.ok
        ? { ok: true, value: { kind: 'unfinishedPlan', plan: plan.value } }
        : plan;
    }
    return { ok: true, value: { kind: 'today', primaryArea } };
  }

  async confirmAdultEligibility(): Promise<ProductResult<void>> {
    const timestamp = this.clock.nowMilliseconds();
    return this.updateProfile((existing) => ({
      onboardingCompletedAtMilliseconds:
        existing?.onboardingCompletedAtMilliseconds,
      adultAcknowledged: true,
      safetyBoundaryVersion: existing?.safetyBoundaryVersion,
      safetyAcknowledgedAtMilliseconds:
        existing?.safetyAcknowledgedAtMilliseconds,
      primaryArea: existing?.primaryArea,
      weeklyGoalDays: existing?.weeklyGoalDays ?? defaultWeeklyGoalDays,
      telemetryChoice: existing?.telemetryChoice ?? 'notOffered',
      createdAtMilliseconds: existing?.createdAtMilliseconds ?? timestamp,
      updatedAtMilliseconds: timestamp,
    }));
  }

  async savePrimaryArea(area: BodyArea): Promise<ProductResult<void>> {
    return this.updateExistingProfile((existing, timestamp) => ({
      ...existing,
      primaryArea: area,
      secondaryArea: undefined,
      safetyBoundaryVersion:
        existing.onboardingCompletedAtMilliseconds === undefined
          ? undefined
          : existing.safetyBoundaryVersion,
      safetyAcknowledgedAtMilliseconds:
        existing.onboardingCompletedAtMilliseconds === undefined
          ? undefined
          : existing.safetyAcknowledgedAtMilliseconds,
      updatedAtMilliseconds: timestamp,
    }));
  }

  async saveSecondaryArea(area?: BodyArea): Promise<ProductResult<void>> {
    return this.updateExistingProfile((existing, timestamp) => {
      if (existing.primaryArea === undefined || area === existing.primaryArea) {
        return undefined;
      }
      return {
        ...existing,
        secondaryArea: area,
        safetyBoundaryVersion:
          existing.onboardingCompletedAtMilliseconds === undefined
            ? prototypeSafetyBoundaryVersion
            : existing.safetyBoundaryVersion,
        updatedAtMilliseconds: timestamp,
      };
    });
  }

  async acknowledgeSafetyBoundary(): Promise<ProductResult<void>> {
    return this.updateExistingProfile((existing, timestamp) =>
      existing.primaryArea === undefined
        ? undefined
        : {
            ...existing,
            safetyBoundaryVersion: prototypeSafetyBoundaryVersion,
            safetyAcknowledgedAtMilliseconds: timestamp,
            updatedAtMilliseconds: timestamp,
          },
    );
  }

  async completeOnboarding(): Promise<ProductResult<BodyArea>> {
    let completedArea: BodyArea | undefined;
    const result = await this.updateExistingProfile((existing, timestamp) => {
      if (
        !existing.adultAcknowledged ||
        existing.primaryArea === undefined ||
        existing.safetyBoundaryVersion === undefined ||
        existing.safetyAcknowledgedAtMilliseconds === undefined
      ) {
        return undefined;
      }
      completedArea = existing.primaryArea;
      return {
        ...existing,
        onboardingCompletedAtMilliseconds:
          existing.onboardingCompletedAtMilliseconds ?? timestamp,
        updatedAtMilliseconds: timestamp,
      };
    });
    if (!result.ok) return result;
    return completedArea === undefined
      ? invalidState
      : { ok: true, value: completedArea };
  }

  respondToAttentionReturn(
    prompt: AttentionPrompt,
    answer: ConditionalSafetyAnswer,
  ): Promise<ProductResult<AttentionResolution>> {
    return this.attentionModule.respondToReturn(prompt, answer);
  }

  beginAttentionCorrection(
    prompt: AttentionPrompt,
  ): Promise<ProductResult<AttentionCorrectionDraft>> {
    return this.attentionModule.beginCorrection(prompt);
  }

  submitAttentionCorrection(
    draft: AttentionCorrectionDraft,
    answers: AreaCheckInAnswers,
  ): Promise<ProductResult<AttentionResolution>> {
    return this.attentionModule.submitCorrection(draft, answers);
  }

  async beginCheckIn(): Promise<ProductResult<CheckInDraft>> {
    const attention = await this.store.loadAttentionStates();
    if (!attention.ok) return persistenceFailure(attention.error);
    if (attention.value.length > 0) return invalidState;

    const profile = await this.store.loadProfileState();
    if (!profile.ok) return persistenceFailure(profile.error);
    const userProfile = profile.value?.profile;
    if (
      userProfile?.onboardingCompletedAtMilliseconds === undefined ||
      userProfile.primaryArea === undefined
    ) {
      return invalidState;
    }
    const day = this.runtime.localDayContext();
    const existing = await this.store.loadLatestCheckInDraft('normal');
    if (!existing.ok) return persistenceFailure(existing.error);
    if (
      existing.value !== undefined &&
      existing.value.primaryArea === userProfile.primaryArea &&
      existing.value.secondaryArea === userProfile.secondaryArea &&
      existing.value.dayContext.localDay === day.localDay
    ) {
      const restored = this.checkInDraft(existing.value);
      return restored === undefined
        ? { ok: false, error: { code: 'invalidData' } }
        : { ok: true, value: restored };
    }
    if (existing.value !== undefined) {
      const abandoned = await this.store.abandonCheckInDraft(existing.value.id);
      if (!abandoned.ok) return persistenceFailure(abandoned.error);
    }

    const checkInId = parseCheckInId(this.runtime.nextIdentifier());
    const primaryEntryId = parseCheckInEntryId(this.runtime.nextIdentifier());
    const secondaryEntryId =
      userProfile.secondaryArea === undefined
        ? undefined
        : parseCheckInEntryId(this.runtime.nextIdentifier());
    const localDay = parseLocalDay(day.localDay);
    if (
      !checkInId.ok ||
      !primaryEntryId.ok ||
      (secondaryEntryId !== undefined && !secondaryEntryId.ok) ||
      !localDay.ok ||
      day.timeZoneId.trim().length === 0 ||
      day.calendarId.trim().length === 0
    ) {
      return { ok: false, error: { code: 'invalidData' } };
    }
    const timestamp = this.clock.nowMilliseconds();
    const dayContext: LocalDayContext = {
      localDay: localDay.value,
      timeZoneId: day.timeZoneId,
      calendarId: day.calendarId,
    };
    const draft: CheckInDraft = {
      checkInId: checkInId.value,
      primaryEntryId: primaryEntryId.value,
      primaryArea: userProfile.primaryArea,
      secondaryEntryId: secondaryEntryId?.value,
      secondaryArea: userProfile.secondaryArea,
      startedAtMilliseconds: timestamp,
      dayContext,
    };
    const saved = await this.store.saveCheckInDraft({
      id: draft.checkInId,
      status: 'draft',
      kind: 'normal',
      primaryArea: draft.primaryArea,
      secondaryArea: draft.secondaryArea,
      startedAtMilliseconds: draft.startedAtMilliseconds,
      dayContext: draft.dayContext,
      entries: [],
    });
    return saved.ok ? { ok: true, value: draft } : persistenceFailure(saved.error);
  }

  async submitCheckIn(
    draft: CheckInDraft,
    primary: AreaCheckInAnswers,
    secondary?: AreaCheckInAnswers,
  ): Promise<ProductResult<CheckInResult>> {
    if (
      primary.area !== draft.primaryArea ||
      (secondary !== undefined && secondary.area !== draft.secondaryArea) ||
      (secondary !== undefined && draft.secondaryEntryId === undefined)
    ) {
      return invalidState;
    }
    const entries = [
      {
        id: draft.primaryEntryId,
        area: draft.primaryArea,
        role: 'primary' as const,
        changeReport: primary.changeReport,
        movementComfort: primary.movementComfort,
        conditionalSafetyAnswer: primary.conditionalSafetyAnswer,
        submittedAtMilliseconds: draft.startedAtMilliseconds,
      },
      ...(secondary === undefined || draft.secondaryEntryId === undefined
        ? []
        : [{
            id: draft.secondaryEntryId,
            area: secondary.area,
            role: 'secondary' as const,
            changeReport: secondary.changeReport,
            movementComfort: secondary.movementComfort,
            conditionalSafetyAnswer: secondary.conditionalSafetyAnswer,
            submittedAtMilliseconds: draft.startedAtMilliseconds,
          }]),
    ];
    const completed: CheckIn = {
      id: draft.checkInId,
      status: 'completed',
      kind: 'normal',
      primaryArea: draft.primaryArea,
      secondaryArea: secondary?.area,
      startedAtMilliseconds: draft.startedAtMilliseconds,
      completedAtMilliseconds: draft.startedAtMilliseconds,
      dayContext: draft.dayContext,
      entries,
    };
    const mutations = [];
    for (const entry of entries) {
      if (
        entry.conditionalSafetyAnswer !== 'yes' &&
        entry.conditionalSafetyAnswer !== 'notSure'
      ) continue;
      const eventId = parseSafetyEventId(this.runtime.nextIdentifier());
      if (!eventId.ok) return { ok: false, error: { code: 'invalidData' } };
      const event = createSafetyEvent({
        id: eventId.value,
        area: entry.area,
        kind: 'attentionEntered',
        sourceCheckInEntryId: entry.id,
        occurredAtMilliseconds: draft.startedAtMilliseconds,
        dayContext: draft.dayContext,
      });
      if (!event.ok) return { ok: false, error: { code: 'invalidData' } };
      const mutation = createSafetyMutation({
        event: event.value,
        statusAfter: 'attentionRequired',
      });
      if (!mutation.ok) return { ok: false, error: { code: 'invalidData' } };
      mutations.push(mutation.value);
    }
    const saved = await this.store.completeCheckIn(completed, mutations);
    if (!saved.ok) return persistenceFailure(saved.error);
    if (mutations.length > 0) {
      const attention = await this.store.loadAttentionStates();
      if (!attention.ok) return persistenceFailure(attention.error);
      const first = attention.value[0];
      if (first === undefined) return { ok: false, error: { code: 'invalidData' } };
      const prompt = this.attentionModule.prompt(first);
      return !prompt.ok
        ? prompt
        : {
            ok: true,
            value: {
              kind: 'attentionRequired',
              area: prompt.value.area,
              responseEventId: prompt.value.responseEventId,
              expectedAttentionUpdatedAtMilliseconds:
                prompt.value.expectedAttentionUpdatedAtMilliseconds,
            },
          };
    }
    const plan = await this.preparePlan(draft.checkInId, 'standard');
    return plan.ok
      ? { ok: true, value: { kind: 'plan', plan: plan.value } }
      : plan;
  }

  revisePlan(
    checkInId: CheckInDraft['checkInId'],
    duration: DurationVariant,
    requestedLevel?: RoutineLevel,
  ): Promise<ProductResult<PlanPresentation>> {
    return this.preparePlan(checkInId, duration, requestedLevel);
  }

  async pauseToday(
    checkInId: CheckInDraft['checkInId'],
  ): Promise<ProductResult<BodyArea>> {
    const checkIn = await this.store.loadCheckIn(checkInId);
    if (!checkIn.ok) return persistenceFailure(checkIn.error);
    if (checkIn.value?.status !== 'completed') return invalidState;
    const existing = await this.store.loadPauseToday(checkIn.value.dayContext.localDay);
    if (!existing.ok) return persistenceFailure(existing.error);
    if (existing.value?.checkInId === checkInId) {
      return { ok: true, value: checkIn.value.primaryArea };
    }
    if (existing.value !== undefined) return invalidState;
    const id = parsePauseTodayEventId(this.runtime.nextIdentifier());
    if (!id.ok) return { ok: false, error: { code: 'invalidData' } };
    const event = createPauseTodayEvent({
      id: id.value,
      checkInId,
      chosenAtMilliseconds: Math.max(
        this.clock.nowMilliseconds(),
        checkIn.value.completedAtMilliseconds ?? checkIn.value.startedAtMilliseconds,
      ),
      dayContext: checkIn.value.dayContext,
    });
    if (!event.ok) return { ok: false, error: { code: 'invalidData' } };
    const saved = await this.store.recordPauseToday(event.value);
    return saved.ok
      ? { ok: true, value: checkIn.value.primaryArea }
      : persistenceFailure(saved.error);
  }

  startRoutine(
    decisionId: PlanPresentation['decisionId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.start(decisionId);
  }

  refreshRoutine(
    sessionId: RoutinePresentation['sessionId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.refresh(sessionId);
  }

  pauseRoutine(
    sessionId: RoutinePresentation['sessionId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.pause(sessionId);
  }

  resumeRoutine(
    sessionId: RoutinePresentation['sessionId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.resume(sessionId);
  }

  advanceRoutine(
    sessionId: RoutinePresentation['sessionId'],
    expectedStepIndex: number,
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.advance(sessionId, expectedStepIndex);
  }

  skipRoutineStep(
    sessionId: RoutinePresentation['sessionId'],
    expectedStepIndex: number,
    reason?: RoutineEventReason,
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.skip(sessionId, expectedStepIndex, reason);
  }

  selectRoutineAlternative(
    sessionId: RoutinePresentation['sessionId'],
    expectedStepIndex: number,
    movementId: NonNullable<RoutinePresentation['currentItem']>['availableAlternatives'][number]['movementId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.selectAlternative(sessionId, expectedStepIndex, movementId);
  }

  endRoutine(
    sessionId: RoutinePresentation['sessionId'],
    forSafety: boolean,
  ): Promise<ProductResult<RoutinePresentation>> {
    return this.routineModule.end(sessionId, forSafety);
  }

  submitFeedback(
    sessionId: RoutinePresentation['sessionId'],
    responses: Readonly<Partial<Record<BodyArea, AreaResponse>>>,
  ): Promise<ProductResult<void>> {
    return this.routineModule.submitFeedback(sessionId, responses);
  }

  async loadProgress(): Promise<ProductResult<ProgressPresentation>> {
    const history = await this.store.loadAreaHistory();
    if (!history.ok) return persistenceFailure(history.error);
    const pauseTodayHistory = await this.store.loadPauseTodayHistory();
    if (!pauseTodayHistory.ok) return persistenceFailure(pauseTodayHistory.error);
    const participatingStatuses = new Set(['completed', 'stopped'] as const);
    const participationDays = new Set(
      history.value.flatMap((record) =>
        record.routine !== undefined && participatingStatuses.has(
          record.routine.status as 'completed' | 'stopped',
        )
          ? [record.localDay]
          : [],
      ),
    );
    for (const record of pauseTodayHistory.value) {
      participationDays.add(record.localDay);
    }
    const areas = [];
    for (const area of bodyAreas) {
      const areaRecords = history.value.filter((record) => record.area === area);
      const participatingRoutineCount = areaRecords.filter(
        ({ routine }) =>
          routine !== undefined &&
          routine.wasIncluded &&
          participatingStatuses.has(routine.status as 'completed' | 'stopped'),
      ).length;
      const pauseTodayCount = pauseTodayHistory.value.filter(({ areas }) =>
        areas.includes(area),
      ).length;
      let activeHistory = createActiveHistoryState({ area, qualifyingOutcomeCount: 0 });
      if (!activeHistory.ok) return { ok: false, error: { code: 'invalidData' } };
      const responses = { better: 0, same: 0, worse: 0 };
      for (const record of areaRecords) {
        const routine = record.routine;
        if (routine?.response !== undefined) responses[routine.response] += 1;
        if (
          routine === undefined ||
          !routine.wasIncluded ||
          !terminalRoutineStatuses.includes(
            routine.status as (typeof terminalRoutineStatuses)[number],
          )
        ) continue;
        const reduced = reduceActiveHistory(activeHistory.value, {
          area,
          routineStatus: routine.status,
          deliveredLevel: routine.deliveredLevel,
          response: routine.response,
          wasIncludedInDeliveredRoutine: true,
        });
        if (!reduced.ok) return { ok: false, error: { code: 'invalidData' } };
        activeHistory = { ok: true, value: reduced.value };
      }
      areas.push({
        area,
        checkInCount: areaRecords.length,
        completedRoutineCount: areaRecords.filter(
          ({ routine }) => routine?.status === 'completed' && routine.wasIncluded,
        ).length,
        participationCount: participatingRoutineCount + pauseTodayCount,
        qualifyingOutcomeCount: activeHistory.value.qualifyingOutcomeCount,
        activeUnlocked: isActiveUnlocked(activeHistory.value),
        latestResponse: activeHistory.value.mostRecentRecordedResponse,
        responses,
      });
    }
    return {
      ok: true,
      value: { participationDayCount: participationDays.size, areas },
    };
  }

  async loadProfile(): Promise<ProductResult<ProfilePresentation>> {
    const state = await this.store.loadProfileState();
    if (!state.ok) return persistenceFailure(state.error);
    if (state.value === undefined) return invalidState;
    const authorization = await this.reminderScheduler.authorizationStatus();
    const reminderAuthorization = authorization.ok
      ? authorization.value
      : 'unavailable';
    return {
      ok: true,
      value: {
        profile: state.value.profile,
        reminderSettings: state.value.reminderSettings,
        reminderAuthorization,
      },
    };
  }

  async saveAreaPreferences(
    primaryArea: BodyArea,
    secondaryArea?: BodyArea,
  ): Promise<ProductResult<ProfilePresentation>> {
    if (primaryArea === secondaryArea) return invalidState;
    const draft = await this.store.loadLatestCheckInDraft('normal');
    if (!draft.ok) return persistenceFailure(draft.error);
    if (
      draft.value !== undefined &&
      (draft.value.primaryArea !== primaryArea ||
        draft.value.secondaryArea !== secondaryArea)
    ) {
      const abandoned = await this.store.abandonCheckInDraft(draft.value.id);
      if (!abandoned.ok) return persistenceFailure(abandoned.error);
    }
    const updated = await this.updateExistingProfile((existing, timestamp) => ({
      ...existing,
      primaryArea,
      secondaryArea,
      updatedAtMilliseconds: timestamp,
    }));
    return updated.ok ? this.loadProfile() : updated;
  }

  async enableReminder(
    window: ReminderWindow,
  ): Promise<ProductResult<ProfilePresentation>> {
    const state = await this.store.loadProfileState();
    if (!state.ok) return persistenceFailure(state.error);
    if (state.value === undefined) return invalidState;
    const moment = this.runtime.localDayContext();
    const pending = createReminderSettings({
      enabled: false,
      window,
      timeZoneId: moment.timeZoneId,
      updatedAtMilliseconds: this.clock.nowMilliseconds(),
    });
    if (!pending.ok) return { ok: false, error: { code: 'invalidData' } };
    const pendingState = createProfileState({
      profile: state.value.profile,
      reminderSettings: pending.value,
    });
    if (!pendingState.ok) return { ok: false, error: { code: 'invalidData' } };
    const pendingSaved = await this.store.saveProfileState(pendingState.value);
    if (!pendingSaved.ok) return persistenceFailure(pendingSaved.error);

    const currentAuthorization = await this.reminderScheduler.authorizationStatus();
    if (!currentAuthorization.ok) {
      return { ok: false, error: { code: 'reminderUnavailable' } };
    }
    let authorization = currentAuthorization.value;
    if (authorization === 'notDetermined') {
      const requested = await this.reminderScheduler.requestAuthorization();
      if (!requested.ok) return { ok: false, error: { code: 'reminderUnavailable' } };
      authorization = requested.value;
    }
    if (authorization !== 'authorized' && authorization !== 'provisional') {
      return this.loadProfile();
    }
    const scheduled = await this.reminderScheduler.replaceDailyReminder(
      window,
      moment.timeZoneId,
    );
    if (!scheduled.ok) return { ok: false, error: { code: 'reminderUnavailable' } };
    const enabled = createReminderSettings({
      enabled: true,
      window,
      timeZoneId: moment.timeZoneId,
      updatedAtMilliseconds: Math.max(
        this.clock.nowMilliseconds(),
        pending.value.updatedAtMilliseconds + firstEntryRevision,
      ),
    });
    if (!enabled.ok) return { ok: false, error: { code: 'invalidData' } };
    const enabledState = createProfileState({
      profile: state.value.profile,
      reminderSettings: enabled.value,
    });
    if (!enabledState.ok) return { ok: false, error: { code: 'invalidData' } };
    const enabledSaved = await this.store.saveProfileState(enabledState.value);
    if (!enabledSaved.ok) {
      const rolledBack = await this.reminderScheduler.cancelAll();
      return rolledBack.ok
        ? persistenceFailure(enabledSaved.error)
        : { ok: false, error: { code: 'reminderUnavailable' } };
    }
    return this.loadProfile();
  }

  async disableReminder(): Promise<ProductResult<ProfilePresentation>> {
    const state = await this.store.loadProfileState();
    if (!state.ok) return persistenceFailure(state.error);
    if (state.value === undefined) return invalidState;
    const existing = state.value.reminderSettings;
    const cancelled = await this.reminderScheduler.cancelAll();
    if (!cancelled.ok) return { ok: false, error: { code: 'reminderUnavailable' } };
    if (existing !== undefined) {
      const disabled = createReminderSettings({
        enabled: false,
        updatedAtMilliseconds: Math.max(
          this.clock.nowMilliseconds(),
          existing.updatedAtMilliseconds + firstEntryRevision,
        ),
      });
      if (!disabled.ok) return { ok: false, error: { code: 'invalidData' } };
      const disabledState = createProfileState({
        profile: state.value.profile,
        reminderSettings: disabled.value,
      });
      if (!disabledState.ok) return { ok: false, error: { code: 'invalidData' } };
      const saved = await this.store.saveProfileState(disabledState.value);
      if (!saved.ok) {
        if (
          existing.enabled &&
          existing.window !== undefined &&
          existing.timeZoneId !== undefined
        ) {
          const restored = await this.reminderScheduler.replaceDailyReminder(
            existing.window,
            existing.timeZoneId,
          );
          if (!restored.ok) {
            return { ok: false, error: { code: 'reminderUnavailable' } };
          }
        }
        return persistenceFailure(saved.error);
      }
    }
    return this.loadProfile();
  }

  async resetHistory(): Promise<ProductResult<void>> {
    const result = await this.store.resetHistory();
    return result.ok ? result : persistenceFailure(result.error);
  }

  async deleteAllData(): Promise<ProductResult<void>> {
    const cancelled = await this.reminderScheduler.cancelAll();
    if (!cancelled.ok) return { ok: false, error: { code: 'reminderUnavailable' } };
    const result = await this.store.deleteAllData();
    return result.ok ? result : persistenceFailure(result.error);
  }

  private onboardingProgress(
    profile: UserProfile | undefined,
  ): Extract<ProductStartState, { kind: 'onboarding' }>['progress'] | undefined {
    if (profile === undefined || !profile.adultAcknowledged) return { step: 'welcome' };
    if (profile.primaryArea === undefined) return { step: 'primaryArea' };
    if (profile.safetyBoundaryVersion === undefined) {
      return {
        step: 'secondaryArea',
        primaryArea: profile.primaryArea,
        selectedArea: profile.secondaryArea,
      };
    }
    if (profile.safetyAcknowledgedAtMilliseconds === undefined) {
      return { step: 'safetyBoundary', primaryArea: profile.primaryArea };
    }
    if (profile.onboardingCompletedAtMilliseconds === undefined) {
      return { step: 'firstCheckIn', primaryArea: profile.primaryArea };
    }
    return undefined;
  }

  private checkInDraft(checkIn: CheckIn): CheckInDraft | undefined {
    if (checkIn.status !== 'draft' || checkIn.kind !== 'normal') return undefined;
    const primaryEntryId = parseCheckInEntryId(this.runtime.nextIdentifier());
    const secondaryEntryId =
      checkIn.secondaryArea === undefined
        ? undefined
        : parseCheckInEntryId(this.runtime.nextIdentifier());
    if (!primaryEntryId.ok || (secondaryEntryId !== undefined && !secondaryEntryId.ok)) {
      return undefined;
    }
    return {
      checkInId: checkIn.id,
      primaryEntryId: primaryEntryId.value,
      primaryArea: checkIn.primaryArea,
      secondaryEntryId: secondaryEntryId?.value,
      secondaryArea: checkIn.secondaryArea,
      startedAtMilliseconds: checkIn.startedAtMilliseconds,
      dayContext: checkIn.dayContext,
    };
  }

  private async preparePlan(
    checkInId: CheckInDraft['checkInId'],
    duration: DurationVariant,
    requestedOverride?: RoutineLevel,
  ): Promise<ProductResult<PlanPresentation>> {
    const attention = await this.store.loadAttentionStates();
    if (!attention.ok) return persistenceFailure(attention.error);
    if (attention.value.length > 0) {
      return {
        ok: false,
        error: { code: 'attentionRequired', areas: attention.value.map(({ area }) => area) },
      };
    }
    const [checkInResult, profileResult, existingResult, areaHistoryResult] = await Promise.all([
      this.store.loadCheckIn(checkInId),
      this.store.loadProfileState(),
      this.store.loadLatestSelectionDecision(checkInId),
      this.store.loadAreaHistory(),
    ]);
    if (!checkInResult.ok) return persistenceFailure(checkInResult.error);
    if (!profileResult.ok) return persistenceFailure(profileResult.error);
    if (!existingResult.ok) return persistenceFailure(existingResult.error);
    if (!areaHistoryResult.ok) return persistenceFailure(areaHistoryResult.error);
    const checkIn = checkInResult.value;
    const profile = profileResult.value?.profile;
    const primaryEntry = checkIn?.entries.find(({ area }) => area === checkIn.primaryArea);
    if (
      checkIn?.status !== 'completed' ||
      profile?.primaryArea === undefined ||
      primaryEntry === undefined
    ) return invalidState;

    const existing =
      existingResult.value?.duration === duration &&
      existingResult.value.requestedOverride === requestedOverride
        ? existingResult.value
        : undefined;
    const decisionId = existing === undefined
      ? parseSelectionDecisionId(this.runtime.nextIdentifier())
      : { ok: true as const, value: existing.id };
    if (!decisionId.ok) return { ok: false, error: { code: 'invalidData' } };

    const historyByArea: Partial<Record<BodyArea, ActiveHistoryState>> = {};
    for (const area of [
      checkIn.primaryArea,
      ...(profile.secondaryArea === undefined ? [] : [profile.secondaryArea]),
    ]) {
      const state = createActiveHistoryState({ area, qualifyingOutcomeCount: 0 });
      if (!state.ok) return { ok: false, error: { code: 'invalidData' } };
      let current = state.value;
      for (const record of areaHistoryResult.value) {
        if (
          record.area !== area ||
          record.routine === undefined ||
          !record.routine.wasIncluded ||
          !terminalRoutineStatuses.includes(
            record.routine.status as (typeof terminalRoutineStatuses)[number],
          )
        ) continue;
        const reduced = reduceActiveHistory(current, {
          area,
          routineStatus: record.routine.status,
          deliveredLevel: record.routine.deliveredLevel,
          response: record.routine.response,
          wasIncludedInDeliveredRoutine: true,
        });
        if (!reduced.ok) return { ok: false, error: { code: 'invalidData' } };
        current = reduced.value;
      }
      historyByArea[area] = current;
    }
    const secondaryEntry = checkIn.secondaryArea === undefined
      ? undefined
      : checkIn.entries.find(({ area }) => area === checkIn.secondaryArea);
    const checkInsByArea = {
      [checkIn.primaryArea]: {
        checkInEntryId: primaryEntry.id,
        entryRevision: firstEntryRevision,
        area: primaryEntry.area,
        changeReport: primaryEntry.changeReport,
        movementComfort: primaryEntry.movementComfort,
        conditionalSafetyAnswer: primaryEntry.conditionalSafetyAnswer,
      },
      ...(secondaryEntry === undefined ? {} : {
        [secondaryEntry.area]: {
          checkInEntryId: secondaryEntry.id,
          entryRevision: firstEntryRevision,
          area: secondaryEntry.area,
          changeReport: secondaryEntry.changeReport,
          movementComfort: secondaryEntry.movementComfort,
          conditionalSafetyAnswer: secondaryEntry.conditionalSafetyAnswer,
        },
      }),
    };
    const catalog = makePrototypeRoutineCatalog();
    const selected = selectPlan({
      decisionId: decisionId.value,
      checkInId,
      decisionRevision:
        existing?.revision ??
        ((existingResult.value?.revision ?? noExistingRevision) + firstDecisionRevision),
      primaryArea: checkIn.primaryArea,
      secondaryArea: profile.secondaryArea,
      secondaryParticipation: profile.secondaryArea === undefined
        ? undefined
        : checkIn.secondaryArea === profile.secondaryArea
          ? 'include'
          : 'skipForSession',
      checkInsByArea,
      safetyByArea: Object.fromEntries(bodyAreas.map((area) => [area, { area, status: 'normal' as const }])),
      historyByArea,
      requestedOverride,
      duration,
      rulesVersion: prototypeSelectionRulesVersion,
      catalogVersion: catalog.catalogVersion,
    });
    if (selected.kind !== 'selected') return invalidState;
    const compositionId = parseCompositionId(this.runtime.nextIdentifier());
    if (!compositionId.ok) return { ok: false, error: { code: 'invalidData' } };
    const composition = composeRoutine(
      {
        decisionId: decisionId.value,
        primaryArea: selected.plan.compositionRequest.primaryArea,
        secondaryArea: selected.plan.compositionRequest.secondaryArea,
        selectedLevel: selected.plan.selectedLevel,
        duration,
        catalogVersion: catalog.catalogVersion,
        buildChannel: 'internal_prototype',
      },
      catalog,
      {
        localizedStrings: prototypeCatalogLocalizedStrings(),
        assetDigestsByPath: prototypeCatalogAssetDigests(),
      },
      compositionId.value,
    );
    if (composition.kind !== 'composed') {
      return { ok: false, error: { code: 'contentUnavailable' } };
    }
    if (
      existing !== undefined &&
      existing.compositionFingerprint !== composition.routine.fingerprint
    ) return { ok: false, error: { code: 'invalidData' } };
    if (existing === undefined) {
      const decision = this.makeDecision(
        checkInId,
        decisionId.value,
        existingResult.value?.revision === undefined
          ? firstDecisionRevision
          : existingResult.value.revision + firstDecisionRevision,
        selected.plan,
        composition.routine,
        historyByArea,
      );
      if (!decision.ok) return decision;
      const appended = await this.store.appendSelectionDecision(decision.value);
      if (!appended.ok) return persistenceFailure(appended.error);
    }
    return {
      ok: true,
      value: {
        decisionId: decisionId.value,
        checkInId,
        primaryArea: checkIn.primaryArea,
        includedAreas: composition.routine.includedAreas,
        omittedSecondaryArea:
          composition.routine.omittedArea ?? selected.plan.omittedAreas[0]?.area,
        recommendedLevel: selected.plan.recommendedLevel,
        selectedLevel: selected.plan.selectedLevel,
        deliveredLevel: composition.routine.deliveredLevel,
        duration,
        explanationKeys: selected.plan.explanations.map(({ key }) => key),
        itemCount: composition.routine.orderedItems.length,
        nominalSeconds: composition.routine.nominalSeconds,
        pauseTodayAvailable: selected.plan.pauseTodayAvailable,
      },
    };
  }

  private makeDecision(
    checkInId: CheckInDraft['checkInId'],
    decisionId: SelectionDecisionId,
    revision: number,
    selected: SelectedPlan,
    composition: ComposedRoutine,
    historyByArea: Readonly<Partial<Record<BodyArea, ActiveHistoryState>>>,
  ): ProductResult<SelectionDecision> {
    const created = createSelectionDecision({
      id: decisionId,
      checkInId,
      revision,
      rulesVersion: prototypeSelectionRulesVersion,
      catalogVersionRequested: composition.catalogVersion,
      catalogVersionDelivered: composition.catalogVersion,
      outcome: 'selected',
      recommendedLevel: selected.recommendedLevel,
      requestedOverride: selected.requestedOverride,
      overrideDisposition: selected.overrideDisposition,
      selectedLevel: selected.selectedLevel,
      deliveredLevel: composition.deliveredLevel,
      duration: selected.duration,
      secondaryOmissionReason: composition.omissionReason ?? selected.omittedAreas[0]?.reason,
      validationResult: composition.status === 'exact' ? 'exact' : 'fallback',
      primaryTemplateId: composition.primaryTemplate.id,
      primaryTemplateRevision: composition.primaryTemplate.revision,
      secondaryModuleId: composition.secondaryModule?.id,
      secondaryModuleRevision: composition.secondaryModule?.revision,
      compatibilityRuleId: composition.compatibilityRule?.id,
      compositionFingerprint: composition.fingerprint,
      createdAtMilliseconds: this.clock.nowMilliseconds(),
      areaInputs: selected.includedAreaDecisions.map((area) => ({
        area: area.area,
        role: area.role,
        checkInEntryId: area.checkInEntryId,
        baseLevel: area.baseLevel,
        activeUnlocked: area.activeUnlocked,
        qualifyingCount: historyByArea[area.area]?.qualifyingOutcomeCount ?? 0,
        latestResponse: historyByArea[area.area]?.mostRecentRecordedResponse,
        included: composition.includedAreas.includes(area.area),
      })),
      reasons: selected.explanations.map((reason, position) => ({
        kind: 'selection',
        position,
        code: reason.key,
        parameters: reason.parameters,
      })),
      notices: selected.notices.map((notice, position) => ({
        position,
        code: notice.key,
        area: notice.area,
        parameters: {},
      })),
    });
    return created.ok
      ? { ok: true, value: created.value }
      : { ok: false, error: { code: 'invalidData' } };
  }

  private async updateExistingProfile(
    update: (existing: UserProfile, timestamp: number) => UserProfile | undefined,
  ): Promise<ProductResult<void>> {
    return this.updateProfile((existing) =>
      existing === undefined ? undefined : update(existing, this.clock.nowMilliseconds()),
    );
  }

  private async updateProfile(
    update: (existing: UserProfile | undefined) => UserProfile | undefined,
  ): Promise<ProductResult<void>> {
    const loaded = await this.store.loadProfileState();
    if (!loaded.ok) return persistenceFailure(loaded.error);
    const updated = update(loaded.value?.profile);
    if (updated === undefined) return invalidState;
    const state: ProfileState = {
      profile: updated,
      reminderSettings: loaded.value?.reminderSettings,
    };
    const validated = createProfileState(state);
    if (!validated.ok) return { ok: false, error: { code: 'invalidData' } };
    const saved = await this.store.saveProfileState(validated.value);
    return saved.ok ? saved : persistenceFailure(saved.error);
  }
}
