import {
  buildRoutineSessionSnapshot,
  decodeRoutineSessionSnapshot,
  findSnapshotAlternative,
  parseRoutineSessionId,
  type RoutineSessionId,
  type RoutineSessionSnapshot,
} from '../core/content/routine-session-snapshot';
import { composeRoutine, parseCompositionId } from '../core/content/routine-composer';
import {
  makePrototypeRoutineCatalog,
  prototypeCatalogAssetDigests,
  prototypeCatalogLocalizedStrings,
} from '../core/content/prototype-routine-catalog';
import type {
  AreaResponse,
  BodyArea,
  SelectionDecisionId,
} from '../core/domain/selection-domain';
import {
  createFeedbackSubmission,
  createRoutineEvent,
  createRoutineSession,
  encodeRoutineSnapshot,
  parseAreaFeedbackId,
  parseFeedbackSubmissionId,
  parseRoutineEventId,
  type RoutineEventKind,
  type RoutineEventReason,
  type RoutineSession,
} from '../core/persistence/routine-persistence-domain';
import type { KineoPersistence } from '../core/persistence/kineo-store';
import type {
  ProductFlowError,
  ProductResult,
  RoutineEndReason,
  RoutinePresentation,
} from '../core/product/product-flow';

type RoutineEnvironment = Readonly<{
  nowMilliseconds(): number;
  monotonicMilliseconds(): number;
  nextIdentifier(): string;
}>;

const initialStepIndex = 0;
const noElapsedTime = 0;
const firstEventSequence = 1;
const stepIndexIncrement = 1;
const millisecondsPerSecond = 1_000;

function failure<Value>(error: ProductFlowError): ProductResult<Value> {
  return { ok: false, error };
}

function invalidData<Value>(): ProductResult<Value> {
  return failure({ code: 'invalidData' });
}

function invalidState<Value>(): ProductResult<Value> {
  return failure({ code: 'invalidState' });
}

export class KineoRoutineModule {
  private readonly activeStepStartedAt = new Map<RoutineSessionId, number>();

  constructor(
    private readonly store: KineoPersistence,
    private readonly environment: RoutineEnvironment,
  ) {}

  async start(decisionId: SelectionDecisionId): Promise<ProductResult<RoutinePresentation>> {
    const attention = await this.store.loadAttentionStates();
    if (!attention.ok) return failure({ code: 'persistence', cause: attention.error });
    if (attention.value.length > 0) {
      return failure({
        code: 'attentionRequired',
        areas: attention.value.map(({ area }) => area),
      });
    }
    const existing = await this.store.loadNonterminalRoutine();
    if (!existing.ok) return failure({ code: 'persistence', cause: existing.error });
    if (existing.value !== undefined) {
      if (existing.value.decisionId !== decisionId) return invalidState();
      return existing.value.status === 'prepared'
        ? this.transition(existing.value, 'started', 'inProgress')
        : this.presentation(existing.value);
    }
    const decision = await this.store.loadLatestUnconsumedSelectionDecision();
    if (!decision.ok) return failure({ code: 'persistence', cause: decision.error });
    if (decision.value?.id !== decisionId || decision.value.outcome !== 'selected') {
      return invalidState();
    }
    const checkIn = await this.store.loadCheckIn(decision.value.checkInId);
    if (!checkIn.ok) return failure({ code: 'persistence', cause: checkIn.error });
    if (checkIn.value?.status !== 'completed') return invalidState();

    const sessionId = parseRoutineSessionId(this.environment.nextIdentifier());
    const compositionId = parseCompositionId(this.environment.nextIdentifier());
    if (!sessionId.ok || !compositionId.ok) return invalidData();
    const catalog = makePrototypeRoutineCatalog();
    const primaryInput = decision.value.areaInputs.find(({ role }) => role === 'primary');
    const secondaryInput = decision.value.areaInputs.find(({ role }) => role === 'secondary');
    if (primaryInput === undefined) return invalidData();
    const composition = composeRoutine(
      {
        decisionId,
        primaryArea: primaryInput.area,
        secondaryArea: secondaryInput?.area,
        selectedLevel: decision.value.selectedLevel,
        duration: decision.value.duration,
        catalogVersion: catalog.catalogVersion,
        buildChannel: 'internal_prototype',
      },
      catalog,
      this.catalogResources(),
      compositionId.value,
    );
    if (composition.kind !== 'composed') {
      return failure({ code: 'contentUnavailable' });
    }
    if (composition.routine.fingerprint !== decision.value.compositionFingerprint) {
      return invalidData();
    }
    const timestamp = this.environment.nowMilliseconds();
    const snapshot = buildRoutineSessionSnapshot({
      sessionId: sessionId.value,
      decisionId,
      composition: composition.routine,
      catalog,
      resources: this.catalogResources(),
      buildChannel: 'internal_prototype',
      rulesVersion: decision.value.rulesVersion,
      notices: decision.value.notices.map(({ code }) => code),
      explanationKeys: decision.value.reasons.map(({ code }) => code),
      explanationParameters: decision.value.reasons.map(({ parameters }) => parameters),
      createdAtMilliseconds: timestamp,
    });
    if (!snapshot.ok) return failure({ code: 'contentUnavailable' });
    const session = createRoutineSession({
      id: sessionId.value,
      decisionId,
      checkInId: decision.value.checkInId,
      status: 'prepared',
      snapshot: encodeRoutineSnapshot(snapshot.value),
      currentStepIndex: initialStepIndex,
      stepElapsedMilliseconds: noElapsedTime,
      updatedAtMilliseconds: timestamp,
      dayContext: checkIn.value.dayContext,
    });
    if (!session.ok) return invalidData();
    const created = await this.store.createRoutine(session.value);
    if (!created.ok) return failure({ code: 'persistence', cause: created.error });
    return this.transition(session.value, 'started', 'inProgress');
  }

  async refresh(sessionId: RoutineSessionId): Promise<ProductResult<RoutinePresentation>> {
    const session = await this.store.loadRoutineSession(sessionId);
    if (!session.ok) return failure({ code: 'persistence', cause: session.error });
    return session.value === undefined ? invalidState() : this.presentation(session.value);
  }

  async restoreInterrupted(
    session: RoutineSession,
  ): Promise<ProductResult<RoutinePresentation>> {
    const snapshot = this.decodeSnapshot(session);
    if (!snapshot.ok) return snapshot;
    if (session.status === 'prepared') return this.presentation(session);
    if (session.status === 'inProgress') return this.transition(session, 'paused', 'paused');
    return this.presentation(session);
  }

  async pause(sessionId: RoutineSessionId): Promise<ProductResult<RoutinePresentation>> {
    const session = await this.requiredSession(sessionId);
    return session.ok ? this.transition(session.value, 'paused', 'paused') : session;
  }

  async resume(sessionId: RoutineSessionId): Promise<ProductResult<RoutinePresentation>> {
    const session = await this.requiredSession(sessionId);
    return session.ok ? this.transition(session.value, 'resumed', 'inProgress') : session;
  }

  async advance(
    sessionId: RoutineSessionId,
    expectedStepIndex: number,
  ): Promise<ProductResult<RoutinePresentation>> {
    const session = await this.requiredSession(sessionId);
    if (!session.ok) return session;
    if (session.value.status !== 'inProgress') return invalidState();
    if (session.value.currentStepIndex !== expectedStepIndex) return invalidState();
    const presented = await this.presentation(session.value);
    if (!presented.ok) return presented;
    if (
      session.value.currentStepIndex < initialStepIndex ||
      session.value.currentStepIndex >= presented.value.totalStepCount
    ) return invalidData();
    const item = presented.value.currentItem;
    if (item === undefined) return invalidData();
    if (item.kind === 'movement') {
      const dose = presented.value.selectedAlternative?.scheduledDose ?? item.scheduledDose;
      if (
        dose.kind === 'timed' &&
        presented.value.stepElapsedMilliseconds <
          dose.activeSeconds * millisecondsPerSecond
      ) return invalidState();
    }
    const nextIndex = session.value.currentStepIndex + stepIndexIncrement;
    if (nextIndex >= presented.value.totalStepCount) {
      return this.transition(session.value, 'completed', 'completed');
    }
    return this.transition(
      session.value,
      'stepCompleted',
      'inProgress',
      nextIndex,
      item.itemId,
      item.sourceOwnerId,
    );
  }

  async skip(
    sessionId: RoutineSessionId,
    expectedStepIndex: number,
    reason?: RoutineEventReason,
  ): Promise<ProductResult<RoutinePresentation>> {
    const session = await this.requiredSession(sessionId);
    if (!session.ok) return session;
    if (this.isTerminal(session.value.status)) return this.presentation(session.value);
    if (session.value.status !== 'inProgress') return invalidState();
    if (session.value.currentStepIndex !== expectedStepIndex) return invalidState();
    const snapshot = this.decodeSnapshot(session.value);
    if (!snapshot.ok) return snapshot;
    const item = snapshot.value.items[session.value.currentStepIndex];
    if (item === undefined) return invalidData();
    const nextIndex = session.value.currentStepIndex + stepIndexIncrement;
    const skipped = await this.recordTransition(
      session.value,
      'skipped',
      'inProgress',
      nextIndex,
      item.itemId,
      item.sourceOwnerId,
      undefined,
      reason,
    );
    if (!skipped.ok) return skipped;
    return nextIndex >= snapshot.value.items.length
      ? this.transition(skipped.value, 'completed', 'completed')
      : this.presentation(skipped.value);
  }

  async selectAlternative(
    sessionId: RoutineSessionId,
    expectedStepIndex: number,
    movementId: NonNullable<RoutinePresentation['currentItem']>['availableAlternatives'][number]['movementId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    let session = await this.requiredSession(sessionId);
    if (!session.ok) return session;
    if (session.value.status !== 'inProgress' && session.value.status !== 'paused') {
      return invalidState();
    }
    if (session.value.currentStepIndex !== expectedStepIndex) return invalidState();
    const snapshot = this.decodeSnapshot(session.value);
    if (!snapshot.ok) return snapshot;
    const item = snapshot.value.items[session.value.currentStepIndex];
    if (item === undefined || !findSnapshotAlternative(snapshot.value, item.itemId, movementId).ok) {
      return invalidState();
    }
    const events = await this.store.loadRoutineEvents(sessionId);
    if (!events.ok) return failure({ code: 'persistence', cause: events.error });
    const alreadySelected = [...events.value].reverse().find(
      (event) => event.kind === 'alternativeSelected' && event.stepId === item.itemId,
    )?.alternativeId;
    if (alreadySelected === movementId) return this.presentation(session.value, movementId);
    if (session.value.status === 'inProgress') {
      const paused = await this.recordTransition(session.value, 'paused', 'paused');
      if (!paused.ok) return paused;
      session = paused;
    }
    const selected = await this.recordTransition(
      session.value,
      'alternativeSelected',
      'paused',
      session.value.currentStepIndex,
      item.itemId,
      item.sourceOwnerId,
      movementId,
    );
    return selected.ok ? this.presentation(selected.value, movementId) : selected;
  }

  async end(
    sessionId: RoutineSessionId,
    reason: RoutineEndReason,
  ): Promise<ProductResult<RoutinePresentation>> {
    let session = await this.requiredSession(sessionId);
    if (!session.ok) return session;
    if (this.isTerminal(session.value.status)) return this.presentation(session.value);
    if (session.value.status === 'prepared') {
      return reason === 'intentional'
        ? this.transition(session.value, 'abandoned', 'abandoned')
        : invalidState();
    }
    if (session.value.status === 'inProgress') {
      const paused = await this.recordTransition(session.value, 'paused', 'paused');
      if (!paused.ok) return paused;
      session = paused;
    }
    if (session.value.status !== 'paused') return invalidState();
    return this.transition(
      session.value,
      reason === 'safety' ? 'safetyStopped' : 'stopped',
      reason === 'safety' ? 'safetyStopped' : 'stopped',
    );
  }

  async submitFeedback(
    sessionId: RoutineSessionId,
    responses: Readonly<Partial<Record<BodyArea, AreaResponse>>>,
  ): Promise<ProductResult<void>> {
    const existing = await this.store.hasFeedbackForRoutine(sessionId);
    if (!existing.ok) return failure({ code: 'persistence', cause: existing.error });
    if (existing.value) return { ok: true, value: undefined };
    const session = await this.requiredSession(sessionId);
    if (!session.ok) return session;
    if (
      session.value.status !== 'completed' &&
      session.value.status !== 'stopped' &&
      session.value.status !== 'safetyStopped'
    ) return invalidState();
    const snapshot = this.decodeSnapshot(session.value);
    if (!snapshot.ok) return snapshot;
    const responseAreas = Object.keys(responses) as BodyArea[];
    if (responseAreas.some((area) => !snapshot.value.includedAreas.includes(area))) {
      return invalidState();
    }
    const feedbackId = parseFeedbackSubmissionId(this.environment.nextIdentifier());
    if (!feedbackId.ok) return invalidData();
    const feedbackResponses = [];
    for (const area of snapshot.value.includedAreas) {
      const response = responses[area];
      if (response === undefined) continue;
      const id = parseAreaFeedbackId(this.environment.nextIdentifier());
      if (!id.ok) return invalidData();
      feedbackResponses.push({ id: id.value, area, response });
    }
    const timestamp = Math.max(
      this.environment.nowMilliseconds(),
      session.value.endedAtMilliseconds ?? session.value.updatedAtMilliseconds,
    );
    const submission = createFeedbackSubmission({
      id: feedbackId.value,
      routineSessionId: sessionId,
      responses: feedbackResponses,
      submittedAtMilliseconds: timestamp,
      dayContext: session.value.dayContext,
    });
    if (!submission.ok) return invalidData();
    const saved = await this.store.submitFeedback(submission.value);
    return saved.ok
      ? { ok: true, value: undefined }
      : failure({ code: 'persistence', cause: saved.error });
  }

  private async requiredSession(
    sessionId: RoutineSessionId,
  ): Promise<ProductResult<RoutineSession>> {
    const session = await this.store.loadRoutineSession(sessionId);
    if (!session.ok) return failure({ code: 'persistence', cause: session.error });
    return session.value === undefined ? invalidState() : { ok: true, value: session.value };
  }

  private async transition(
    session: RoutineSession,
    kind: RoutineEventKind,
    status: RoutineSession['status'],
    currentStepIndex = session.currentStepIndex,
    stepId?: string,
    moduleId?: string,
    alternativeId?: string,
    localReason?: RoutineEventReason,
  ): Promise<ProductResult<RoutinePresentation>> {
    const updated = await this.recordTransition(
      session,
      kind,
      status,
      currentStepIndex,
      stepId,
      moduleId,
      alternativeId,
      localReason,
    );
    return updated.ok ? this.presentation(updated.value) : updated;
  }

  private async recordTransition(
    session: RoutineSession,
    kind: RoutineEventKind,
    status: RoutineSession['status'],
    currentStepIndex = session.currentStepIndex,
    stepId?: string,
    moduleId?: string,
    alternativeId?: string,
    localReason?: RoutineEventReason,
  ): Promise<ProductResult<RoutineSession>> {
    const snapshot = this.decodeSnapshot(session);
    if (!snapshot.ok) return snapshot;
    const events = await this.store.loadRoutineEvents(session.id);
    if (!events.ok) return failure({ code: 'persistence', cause: events.error });
    const eventId = parseRoutineEventId(this.environment.nextIdentifier());
    if (!eventId.ok) return invalidData();
    const timestamp = Math.max(this.environment.nowMilliseconds(), session.updatedAtMilliseconds);
    const event = createRoutineEvent({
      id: eventId.value,
      routineSessionId: session.id,
      sequenceNumber: events.value.length + firstEventSequence,
      kind,
      stepId,
      moduleId,
      alternativeId,
      localReason,
      occurredAtMilliseconds: timestamp,
    });
    if (!event.ok) return invalidData();
    const terminal = this.isTerminal(status);
    const elapsed = kind === 'stepCompleted' || kind === 'skipped'
      ? { ok: true as const, value: noElapsedTime }
      : this.elapsedMilliseconds(session);
    if (!elapsed.ok) return elapsed;
    const activeStart = status === 'inProgress'
      ? this.monotonicNow()
      : { ok: true as const, value: undefined };
    if (!activeStart.ok) return activeStart;
    const recorded = await this.store.recordRoutineEvent(event.value, {
      status,
      currentStepIndex,
      stepElapsedMilliseconds: elapsed.value,
      updatedAtMilliseconds: timestamp,
      endedAtMilliseconds: terminal ? timestamp : undefined,
    });
    if (!recorded.ok) return failure({ code: 'persistence', cause: recorded.error });
    if (activeStart.value !== undefined) {
      this.activeStepStartedAt.set(session.id, activeStart.value);
    } else {
      this.activeStepStartedAt.delete(session.id);
    }
    const updated = await this.store.loadRoutineSession(session.id);
    if (!updated.ok) return failure({ code: 'persistence', cause: updated.error });
    return updated.value === undefined ? invalidData() : { ok: true, value: updated.value };
  }

  private async presentation(
    session: RoutineSession,
    selectedMovementId?: NonNullable<RoutinePresentation['selectedAlternative']>['movementId'],
  ): Promise<ProductResult<RoutinePresentation>> {
    const snapshot = this.decodeSnapshot(session);
    if (!snapshot.ok) return snapshot;
    const terminal = session.status === 'completed' || session.status === 'stopped' ||
      session.status === 'safetyStopped' || session.status === 'abandoned';
    const currentItem = terminal ? undefined : snapshot.value.items[session.currentStepIndex];
    const primaryArea = snapshot.value.includedAreas[initialStepIndex];
    if ((!terminal && currentItem === undefined) || primaryArea === undefined) return invalidData();
    let restoredMovementId: string | undefined = selectedMovementId;
    if (restoredMovementId === undefined && currentItem !== undefined) {
      const events = await this.store.loadRoutineEvents(session.id);
      if (!events.ok) return failure({ code: 'persistence', cause: events.error });
      restoredMovementId = [...events.value].reverse().find(
        (event) =>
          event.kind === 'alternativeSelected' && event.stepId === currentItem.itemId,
      )?.alternativeId;
    }
    const selectedAlternative =
      restoredMovementId === undefined || currentItem === undefined
        ? undefined
        : currentItem.availableAlternatives.find(
            ({ movementId }) => movementId === restoredMovementId,
          );
    if (restoredMovementId !== undefined && selectedAlternative === undefined) {
      return invalidData();
    }
    const elapsed = this.elapsedMilliseconds(session);
    if (!elapsed.ok) return elapsed;
    return {
      ok: true,
      value: {
        sessionId: session.id,
        decisionId: session.decisionId,
        primaryArea,
        includedAreas: snapshot.value.includedAreas,
        selectedLevel: snapshot.value.selectedLevel,
        deliveredLevel: snapshot.value.deliveredLevel,
        duration: snapshot.value.duration,
        status: session.status,
        currentStepIndex: session.currentStepIndex,
        totalStepCount: snapshot.value.items.length,
        currentItem,
        selectedAlternative,
        stepElapsedMilliseconds: elapsed.value,
        contentAvailable: true,
      },
    };
  }

  private elapsedMilliseconds(
    session: RoutineSession,
  ): ProductResult<number> {
    if (session.status !== 'inProgress') {
      return { ok: true, value: session.stepElapsedMilliseconds };
    }
    const startedAt = this.activeStepStartedAt.get(session.id);
    if (startedAt === undefined) {
      return { ok: true, value: session.stepElapsedMilliseconds };
    }
    const current = this.monotonicNow();
    if (!current.ok || current.value < startedAt) return invalidData();
    const total = session.stepElapsedMilliseconds + (current.value - startedAt);
    return Number.isSafeInteger(total) && total >= noElapsedTime
      ? { ok: true, value: total }
      : invalidData();
  }

  private monotonicNow(): ProductResult<number> {
    const value = Math.floor(this.environment.monotonicMilliseconds());
    return Number.isSafeInteger(value) && value >= noElapsedTime
      ? { ok: true, value }
      : invalidData();
  }

  private isTerminal(status: RoutineSession['status']): boolean {
    return status === 'completed' || status === 'stopped' ||
      status === 'safetyStopped' || status === 'abandoned';
  }

  private decodeSnapshot(
    session: RoutineSession,
  ): ProductResult<RoutineSessionSnapshot> {
    const decoded = decodeRoutineSessionSnapshot(session.snapshot.json);
    return decoded.ok &&
      decoded.value.sessionId === session.id &&
      decoded.value.decisionId === session.decisionId
      ? decoded
      : invalidData();
  }

  private catalogResources() {
    return {
      localizedStrings: prototypeCatalogLocalizedStrings(),
      assetDigestsByPath: prototypeCatalogAssetDigests(),
    };
  }
}
