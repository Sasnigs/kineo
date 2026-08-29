import {
  bodyAreas,
  parseCheckInEntryId,
  parseCheckInId,
  requiresConditionalSafetyAnswer,
  type ConditionalSafetyAnswer,
} from '../core/domain/selection-domain';
import {
  createCheckIn,
  createCheckInEntry,
  createSafetyEvent,
  createSafetyMutation,
  parseLocalDay,
  parseSafetyEventId,
  type AttentionState,
  type LocalDayContext,
  type SafetyEvent,
} from '../core/persistence/persistence-domain';
import type { KineoPersistence } from '../core/persistence/kineo-store';
import type {
  AreaCheckInAnswers,
  AttentionCorrectionDraft,
  AttentionPrompt,
  AttentionResolution,
  CheckInDraft,
  ProductResult,
} from '../core/product/product-flow';
import type { ProductClock, ProductRuntime } from './kineo-product-service';

const timestampIncrement = 1;

function invalidData<Value>(): ProductResult<Value> {
  return { ok: false, error: { code: 'invalidData' } };
}

function invalidState<Value>(): ProductResult<Value> {
  return { ok: false, error: { code: 'invalidState' } };
}

export class KineoAttentionModule {
  constructor(
    private readonly store: KineoPersistence,
    private readonly clock: ProductClock,
    private readonly runtime: ProductRuntime,
  ) {}

  prompt(attention: AttentionState): ProductResult<AttentionPrompt> {
    const responseEventId = parseSafetyEventId(this.runtime.nextIdentifier());
    return responseEventId.ok
      ? {
          ok: true,
          value: {
            area: attention.area,
            responseEventId: responseEventId.value,
            expectedAttentionUpdatedAtMilliseconds: attention.updatedAtMilliseconds,
          },
        }
      : invalidData();
  }

  async respondToReturn(
    prompt: AttentionPrompt,
    answer: ConditionalSafetyAnswer,
  ): Promise<ProductResult<AttentionResolution>> {
    const existing = await this.store.loadSafetyEvent(prompt.responseEventId);
    if (!existing.ok) return { ok: false, error: { code: 'persistence', cause: existing.error } };
    if (existing.value !== undefined) {
      return this.returnEventMatches(existing.value, prompt, answer)
        ? this.resolution()
        : invalidState();
    }
    const attention = await this.currentAttention(prompt);
    if (!attention.ok) return attention;
    const dayContext = this.dayContext();
    if (!dayContext.ok) return dayContext;
    const clearsAttention = answer === 'yes';
    const event = createSafetyEvent({
      id: prompt.responseEventId,
      area: prompt.area,
      kind: clearsAttention
        ? 'attentionClearedReturnedToUsual'
        : 'attentionReaffirmed',
      returnAnswer: answer,
      occurredAtMilliseconds: this.timestampAfter(attention.value.updatedAtMilliseconds),
      dayContext: dayContext.value,
    });
    if (!event.ok) return invalidData();
    const mutation = createSafetyMutation({
      event: event.value,
      statusAfter: clearsAttention ? 'normal' : 'attentionRequired',
      expectedAttentionUpdatedAtMilliseconds: attention.value.updatedAtMilliseconds,
    });
    if (!mutation.ok) return invalidData();
    const saved = await this.store.applySafetyMutation(mutation.value);
    return saved.ok
      ? this.resolution()
      : { ok: false, error: { code: 'persistence', cause: saved.error } };
  }

  async beginCorrection(
    prompt: AttentionPrompt,
  ): Promise<ProductResult<AttentionCorrectionDraft>> {
    const attention = await this.currentAttention(prompt);
    if (!attention.ok) return attention;
    const dayContext = this.dayContext();
    if (!dayContext.ok) return dayContext;
    const existing = await this.store.loadLatestCheckInDraft('attentionCorrection');
    if (!existing.ok) return { ok: false, error: { code: 'persistence', cause: existing.error } };

    let checkInDraft: CheckInDraft;
    if (
      existing.value?.correctionSource?.area === prompt.area &&
      existing.value.dayContext.localDay === dayContext.value.localDay
    ) {
      const restored = this.draftForExistingCorrection(existing.value.id, existing.value.startedAtMilliseconds, prompt.area, existing.value.dayContext);
      if (!restored.ok) return restored;
      checkInDraft = restored.value;
    } else {
      const checkInId = parseCheckInId(this.runtime.nextIdentifier());
      const entryId = parseCheckInEntryId(this.runtime.nextIdentifier());
      if (!checkInId.ok || !entryId.ok) return invalidData();
      checkInDraft = {
        checkInId: checkInId.value,
        primaryEntryId: entryId.value,
        primaryArea: prompt.area,
        startedAtMilliseconds: this.clock.nowMilliseconds(),
        dayContext: dayContext.value,
      };
      const draft = createCheckIn({
        id: checkInDraft.checkInId,
        status: 'draft',
        kind: 'attentionCorrection',
        correctionSource: { area: prompt.area },
        primaryArea: prompt.area,
        startedAtMilliseconds: checkInDraft.startedAtMilliseconds,
        dayContext: checkInDraft.dayContext,
        entries: [],
      });
      if (!draft.ok) return invalidData();
      const saved = await this.store.saveCheckInDraft(draft.value);
      if (!saved.ok) return { ok: false, error: { code: 'persistence', cause: saved.error } };
    }
    const safetyEventId = parseSafetyEventId(this.runtime.nextIdentifier());
    return safetyEventId.ok
      ? {
          ok: true,
          value: {
            checkIn: checkInDraft,
            safetyEventId: safetyEventId.value,
            expectedAttentionUpdatedAtMilliseconds:
              attention.value.updatedAtMilliseconds,
          },
        }
      : invalidData();
  }

  async submitCorrection(
    draft: AttentionCorrectionDraft,
    answers: AreaCheckInAnswers,
  ): Promise<ProductResult<AttentionResolution>> {
    if (answers.area !== draft.checkIn.primaryArea) return invalidState();
    const existingEvent = await this.store.loadSafetyEvent(draft.safetyEventId);
    if (!existingEvent.ok) {
      return { ok: false, error: { code: 'persistence', cause: existingEvent.error } };
    }
    if (existingEvent.value !== undefined) return this.resolution();
    const [attention, persisted] = await Promise.all([
      this.currentAttention({
        area: draft.checkIn.primaryArea,
        responseEventId: draft.safetyEventId,
        expectedAttentionUpdatedAtMilliseconds:
          draft.expectedAttentionUpdatedAtMilliseconds,
      }),
      this.store.loadCheckIn(draft.checkIn.checkInId),
    ]);
    if (!attention.ok) return attention;
    if (!persisted.ok) return { ok: false, error: { code: 'persistence', cause: persisted.error } };
    if (
      persisted.value?.status !== 'draft' ||
      persisted.value.kind !== 'attentionCorrection' ||
      persisted.value.correctionSource?.area !== draft.checkIn.primaryArea
    ) return invalidState();
    const completedAt = this.timestampAfter(Math.max(
      attention.value.updatedAtMilliseconds,
      persisted.value.startedAtMilliseconds,
    ));
    const entry = createCheckInEntry({
      id: draft.checkIn.primaryEntryId,
      area: answers.area,
      role: 'primary',
      changeReport: answers.changeReport,
      movementComfort: answers.movementComfort,
      conditionalSafetyAnswer: answers.conditionalSafetyAnswer,
      submittedAtMilliseconds: completedAt,
    });
    if (!entry.ok) return invalidData();
    const completed = createCheckIn({
      ...persisted.value,
      status: 'completed',
      completedAtMilliseconds: completedAt,
      entries: [entry.value],
    });
    if (!completed.ok) return invalidData();
    const reaffirms = requiresConditionalSafetyAnswer(entry.value) &&
      (entry.value.conditionalSafetyAnswer === 'yes' ||
        entry.value.conditionalSafetyAnswer === 'notSure');
    const event = createSafetyEvent({
      id: draft.safetyEventId,
      area: answers.area,
      kind: reaffirms
        ? 'attentionReaffirmedCorrection'
        : 'attentionClearedCorrection',
      sourceCheckInEntryId: entry.value.id,
      occurredAtMilliseconds: completedAt,
      dayContext: persisted.value.dayContext,
    });
    if (!event.ok) return invalidData();
    const mutation = createSafetyMutation({
      event: event.value,
      statusAfter: reaffirms ? 'attentionRequired' : 'normal',
      expectedAttentionUpdatedAtMilliseconds: attention.value.updatedAtMilliseconds,
    });
    if (!mutation.ok) return invalidData();
    const saved = await this.store.completeCheckIn(completed.value, [mutation.value]);
    return saved.ok
      ? this.resolution()
      : { ok: false, error: { code: 'persistence', cause: saved.error } };
  }

  private async currentAttention(
    prompt: AttentionPrompt,
  ): Promise<ProductResult<AttentionState>> {
    const states = await this.store.loadAttentionStates();
    if (!states.ok) return { ok: false, error: { code: 'persistence', cause: states.error } };
    const state = states.value.find(({ area }) => area === prompt.area);
    return state?.updatedAtMilliseconds === prompt.expectedAttentionUpdatedAtMilliseconds
      ? { ok: true, value: state }
      : invalidState();
  }

  private async resolution(): Promise<ProductResult<AttentionResolution>> {
    const states = await this.store.loadAttentionStates();
    if (!states.ok) return { ok: false, error: { code: 'persistence', cause: states.error } };
    const byArea = new Map(states.value.map((state) => [state.area, state]));
    const first = bodyAreas.map((area) => byArea.get(area)).find(
      (state): state is AttentionState => state !== undefined,
    );
    if (first !== undefined) {
      const prompt = this.prompt(first);
      return prompt.ok
        ? { ok: true, value: { kind: 'attentionRequired', prompt: prompt.value } }
        : prompt;
    }
    const profile = await this.store.loadProfileState();
    if (!profile.ok) return { ok: false, error: { code: 'persistence', cause: profile.error } };
    const primaryArea = profile.value?.profile.primaryArea;
    return primaryArea === undefined
      ? invalidState()
      : { ok: true, value: { kind: 'ready', primaryArea } };
  }

  private dayContext(): ProductResult<LocalDayContext> {
    const value = this.runtime.localDayContext();
    const localDay = parseLocalDay(value.localDay);
    return localDay.ok && value.timeZoneId.trim().length > 0 && value.calendarId.trim().length > 0
      ? { ok: true, value: { ...value, localDay: localDay.value } }
      : invalidData();
  }

  private timestampAfter(minimum: number): number {
    return Math.max(this.clock.nowMilliseconds(), minimum + timestampIncrement);
  }

  private draftForExistingCorrection(
    checkInId: CheckInDraft['checkInId'],
    startedAtMilliseconds: number,
    area: CheckInDraft['primaryArea'],
    dayContext: LocalDayContext,
  ): ProductResult<CheckInDraft> {
    const entryId = parseCheckInEntryId(this.runtime.nextIdentifier());
    return entryId.ok
      ? {
          ok: true,
          value: {
            checkInId,
            primaryEntryId: entryId.value,
            primaryArea: area,
            startedAtMilliseconds,
            dayContext,
          },
        }
      : invalidData();
  }

  private returnEventMatches(
    event: SafetyEvent,
    prompt: AttentionPrompt,
    answer: ConditionalSafetyAnswer,
  ): boolean {
    return event.area === prompt.area &&
      event.returnAnswer === answer &&
      event.kind === (answer === 'yes'
        ? 'attentionClearedReturnedToUsual'
        : 'attentionReaffirmed');
  }
}
