import { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import type { KineoProductServing } from '@/application/kineo-product-service';
import type { Dose } from '@/core/content/catalog-primitives';
import {
  bodyAreas,
  requiresConditionalSafetyAnswer,
  type BodyArea,
  type AreaResponse,
  type ChangeReport,
  type MovementComfort,
} from '@/core/domain/selection-domain';
import type {
  AreaCheckInAnswers,
  AttentionCorrectionDraft,
  AttentionPrompt,
  AttentionResolution,
  CheckInDraft,
  PlanPresentation,
  ProfilePresentation,
  ProgressPresentation,
  ProductFlowError,
  ProductStartState,
  RoutinePresentation,
} from '@/core/product/product-flow';
import {
  colors,
  layout,
  radius,
  spacing,
  typography,
} from '@/ui/theme/tokens';

type LocalScreen =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'error'; error: ProductFlowError }>
  | Readonly<{ kind: 'start'; state: ProductStartState }>
  | Readonly<{ kind: 'ageConfirmation' }>
  | Readonly<{ kind: 'ageUnavailable' }>
  | Readonly<{
      kind: 'checkIn';
      draft: CheckInDraft;
      currentArea: BodyArea;
      answers: Readonly<Partial<Record<BodyArea, AreaCheckInAnswers>>>;
      stage: 'change' | 'comfort' | 'safety';
      changeReport?: ChangeReport;
      movementComfort?: MovementComfort;
      correctionDraft?: AttentionCorrectionDraft;
    }>
  | Readonly<{ kind: 'attentionReturn'; prompt: AttentionPrompt }>
  | Readonly<{ kind: 'attentionGuidance'; prompt: AttentionPrompt }>
  | Readonly<{ kind: 'plan'; plan: PlanPresentation }>
  | Readonly<{ kind: 'routine'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'routineOptions'; routine: RoutinePresentation }>
  | Readonly<{
      kind: 'alternativePreview';
      routine: RoutinePresentation;
      alternative: NonNullable<RoutinePresentation['selectedAlternative']>;
    }>
  | Readonly<{ kind: 'endConfirmation'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'safetyGuidance'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'completion'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'progress'; progress: ProgressPresentation }>
  | Readonly<{
      kind: 'progressArea';
      progress: ProgressPresentation;
      area: BodyArea;
    }>
  | Readonly<{ kind: 'profile'; profile: ProfilePresentation }>
  | Readonly<{ kind: 'profileAreas'; profile: ProfilePresentation }>
  | Readonly<{ kind: 'confirmReset'; profile: ProfilePresentation }>
  | Readonly<{ kind: 'confirmDelete'; profile: ProfilePresentation }>
  | Readonly<{
      kind: 'feedback';
      routine: RoutinePresentation;
      areaIndex: number;
      responses: Readonly<Partial<Record<BodyArea, AreaResponse>>>;
    }>;

type KineoProductAppProps = Readonly<{
  service: KineoProductServing;
  onStoreRestartRequired: () => void;
}>;

type MainTab = 'today' | 'progress' | 'profile';

const areaLabels: Readonly<Record<BodyArea, string>> = Object.freeze({
  neck: 'Neck',
  upperMidBack: 'Upper & mid back',
  lowerBack: 'Lower back',
});

const minutesPerHour = 60;
const morningReminderWindow = Object.freeze({
  startMinutes: 8 * minutesPerHour,
  endMinutes: 9 * minutesPerHour,
});
const eveningReminderWindow = Object.freeze({
  startMinutes: 18 * minutesPerHour,
  endMinutes: 19 * minutesPerHour,
});
const prototypeMovementVideo = require('../../../assets/videos/prototype-side-reach.mp4') as number;

function errorMessage(error: ProductFlowError): string {
  if (error.code === 'invalidState' || error.code === 'invalidData') {
    return "Kineo couldn't continue from that state. Try again.";
  }
  if (error.code === 'contentUnavailable') return 'No approved prototype routine is available for this plan.';
  if (error.code === 'attentionRequired') return 'Attention Required is active. Review it before another routine.';
  if (error.code === 'reminderUnavailable') return "Kineo couldn't update reminders. Try again.";
  switch (error.cause.code) {
    case 'protectedDataUnavailable':
      return 'Unlock this iPhone, then try again.';
    case 'storageProtectionFailed':
      return "Kineo couldn't verify private storage.";
    default:
      return "Kineo couldn't save that change. Try again.";
  }
}

export function KineoProductApp({
  service,
  onStoreRestartRequired,
}: KineoProductAppProps) {
  const [screen, setScreen] = useState<LocalScreen>({ kind: 'loading' });
  const [selectedPrimaryArea, setSelectedPrimaryArea] = useState<BodyArea>();
  const [selectedSecondaryArea, setSelectedSecondaryArea] = useState<BodyArea>();
  const [isSecondaryCleared, setIsSecondaryCleared] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reminderReconciliationFailed, setReminderReconciliationFailed] = useState(false);

  const load = useCallback(async () => {
    setScreen({ kind: 'loading' });
    const result = await service.loadStartState();
    setScreen(
      result.ok
        ? { kind: 'start', state: result.value }
        : { kind: 'error', error: result.error },
    );
  }, [service]);

  useEffect(() => {
    let isActive = true;
    void service.loadStartState().then((result) => {
      if (!isActive) return;
      setScreen(
        result.ok
          ? { kind: 'start', state: result.value }
          : { kind: 'error', error: result.error },
      );
    });
    return () => {
      isActive = false;
    };
  }, [service]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void service.reconcileReminder().then((result) => {
        setReminderReconciliationFailed(!result.ok);
      });
    });
    return () => subscription.remove();
  }, [service]);

  const lifecycleRoutine = screen.kind === 'routine' || screen.kind === 'feedback'
    ? screen.routine
    : screen.kind === 'start' && screen.state.kind === 'unfinishedRoutine'
      ? screen.state.routine
      : undefined;
  const lifecycleSessionId = lifecycleRoutine?.sessionId;
  const lifecycleStatus = lifecycleRoutine?.status;

  useEffect(() => {
    if (lifecycleSessionId === undefined || lifecycleStatus !== 'inProgress') return;
    let isActive = true;
    let isPausing = false;
    const refresh = async () => {
      const result = await service.refreshRoutine(lifecycleSessionId);
      if (!isActive) return;
      setScreen(result.ok
        ? { kind: 'routine', routine: result.value }
        : { kind: 'error', error: result.error });
    };
    const interval = setInterval(() => void refresh(), routineRefreshIntervalMilliseconds);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' || isPausing) return;
      isPausing = true;
      void service.pauseRoutine(lifecycleSessionId).then((result) => {
        if (!isActive) return;
        setScreen(result.ok
          ? { kind: 'routine', routine: result.value }
          : { kind: 'error', error: result.error });
      });
    });
    return () => {
      isActive = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, [lifecycleSessionId, lifecycleStatus, service]);

  const submit = useCallback(
    async <Value,>(operation: () => Promise<
      | Readonly<{ ok: true; value: Value }>
      | Readonly<{ ok: false; error: ProductFlowError }>
    >) => {
      if (isSubmitting) return undefined;
      setIsSubmitting(true);
      const result = await operation();
      setIsSubmitting(false);
      if (!result.ok) {
        setScreen({ kind: 'error', error: result.error });
      }
      return result;
    },
    [isSubmitting],
  );

  const onboarding =
    screen.kind === 'start' && screen.state.kind === 'onboarding'
      ? screen.state.progress
      : undefined;

  const startCheckIn = useCallback(async () => {
    const result = await submit(() => service.beginCheckIn());
    if (!result?.ok) return;
    setScreen({
      kind: 'checkIn',
      draft: result.value,
      currentArea: result.value.primaryArea,
      answers: {},
      stage: 'change',
    });
  }, [service, submit]);

  const submitCompletedAnswers = useCallback(async (
    draft: CheckInDraft,
    answers: Readonly<Partial<Record<BodyArea, AreaCheckInAnswers>>>,
    correctionDraft?: AttentionCorrectionDraft,
  ) => {
    const primary = answers[draft.primaryArea];
    if (primary === undefined) return;
    if (correctionDraft !== undefined) {
      const corrected = await submit(() =>
        service.submitAttentionCorrection(correctionDraft, primary),
      );
      if (corrected?.ok) setScreen(screenForAttentionResolution(corrected.value));
      return;
    }
    const secondary = draft.secondaryArea === undefined
      ? undefined
      : answers[draft.secondaryArea];
    const result = await submit(() => service.submitCheckIn(draft, primary, secondary));
    if (!result?.ok) return;
    setScreen(result.value.kind === 'plan'
      ? { kind: 'plan', plan: result.value.plan }
      : {
          kind: 'attentionGuidance',
          prompt: {
            area: result.value.area,
            responseEventId: result.value.responseEventId,
            expectedAttentionUpdatedAtMilliseconds:
              result.value.expectedAttentionUpdatedAtMilliseconds,
          },
        });
  }, [service, submit]);

  const openTab = useCallback(async (tab: MainTab) => {
    if (tab === 'today') {
      await load();
      return;
    }
    if (tab === 'progress') {
      const result = await service.loadProgress();
      setScreen(result.ok
        ? { kind: 'progress', progress: result.value }
        : { kind: 'error', error: result.error });
      return;
    }
    const result = await service.loadProfile();
    setScreen(result.ok
      ? { kind: 'profile', profile: result.value }
      : { kind: 'error', error: result.error });
  }, [load, service]);

  const pauseForRoutineMenu = useCallback(async (
    routine: RoutinePresentation,
    destination: 'options' | 'end' | 'safety',
  ) => {
    const paused = routine.status === 'inProgress'
      ? await submit(() => service.pauseRoutine(routine.sessionId))
      : { ok: true as const, value: routine };
    if (!paused?.ok) return;
    setScreen(
      destination === 'options'
        ? { kind: 'routineOptions', routine: paused.value }
        : destination === 'end'
          ? { kind: 'endConfirmation', routine: paused.value }
          : { kind: 'safetyGuidance', routine: paused.value },
    );
  }, [service, submit]);

  const activeCheckIn = screen.kind === 'checkIn'
    ? screen
    : screen.kind === 'start' && screen.state.kind === 'unfinishedCheckIn'
      ? {
          kind: 'checkIn' as const,
          draft: screen.state.draft,
          currentArea: screen.state.draft.primaryArea,
          answers: {},
          stage: 'change' as const,
        }
      : undefined;

  if (activeCheckIn !== undefined) {
    const areaName = areaLabels[activeCheckIn.currentArea];
    const continueWithAnswer = (
      answer: AreaCheckInAnswers,
    ) => {
      const answers = { ...activeCheckIn.answers, [answer.area]: answer };
      if (
        activeCheckIn.currentArea === activeCheckIn.draft.primaryArea &&
        activeCheckIn.draft.secondaryArea !== undefined
      ) {
        setScreen({
          kind: 'checkIn',
          draft: activeCheckIn.draft,
          currentArea: activeCheckIn.draft.secondaryArea,
          answers,
          stage: 'change',
        });
        return;
      }
      void submitCompletedAnswers(
        activeCheckIn.draft,
        answers,
        activeCheckIn.correctionDraft,
      );
    };
    if (activeCheckIn.stage === 'change') {
      return (
        <Shell>
          <ProgressLabel current={1} total={2} />
          <PageHeader eyebrow={areaName.toUpperCase()} title="Compared with your usual pattern…" />
          <Text style={styles.supporting}>Choose the closest answer for right now.</Text>
          <ChoiceButton label="Better" onPress={() => setScreen({ ...activeCheckIn, stage: 'comfort', changeReport: 'better' })} />
          <ChoiceButton label="Similar" onPress={() => setScreen({ ...activeCheckIn, stage: 'comfort', changeReport: 'similar' })} />
          <ChoiceButton label="Worse" onPress={() => setScreen({ ...activeCheckIn, stage: 'comfort', changeReport: 'worse' })} />
          {activeCheckIn.currentArea === activeCheckIn.draft.secondaryArea ? (
            <SecondaryButton
              label="Skip this area today"
              onPress={() => void submitCompletedAnswers(
                activeCheckIn.draft,
                activeCheckIn.answers,
                activeCheckIn.correctionDraft,
              )}
            />
          ) : null}
        </Shell>
      );
    }
    if (activeCheckIn.stage === 'comfort') {
      const selectComfort = (movementComfort: MovementComfort) => {
        const changeReport = activeCheckIn.changeReport;
        if (changeReport === undefined) return;
        if (requiresConditionalSafetyAnswer({ changeReport, movementComfort })) {
          setScreen({ ...activeCheckIn, stage: 'safety', movementComfort });
          return;
        }
        continueWithAnswer({ area: activeCheckIn.currentArea, changeReport, movementComfort });
      };
      return (
        <Shell>
          <ProgressLabel current={2} total={2} />
          <PageHeader eyebrow={areaName.toUpperCase()} title="How comfortable does movement feel?" />
          <ChoiceButton label="Limited" onPress={() => selectComfort('limited')} />
          <ChoiceButton label="Okay" onPress={() => selectComfort('okay')} />
          <ChoiceButton label="Good" onPress={() => selectComfort('good')} />
        </Shell>
      );
    }
    const answerSafety = (conditionalSafetyAnswer: 'no' | 'yes' | 'notSure') => {
      if (activeCheckIn.changeReport === undefined || activeCheckIn.movementComfort === undefined) return;
      continueWithAnswer({
        area: activeCheckIn.currentArea,
        changeReport: activeCheckIn.changeReport,
        movementComfort: activeCheckIn.movementComfort,
        conditionalSafetyAnswer,
      });
    };
    return (
      <Shell>
        <PageHeader eyebrow="ONE SAFETY CHECK" title="Is this new, sudden, or unusual for you?" />
        <Text style={styles.supporting}>Your answer may pause Kineo routines so you can decide what support you need.</Text>
        <ChoiceButton label="No" onPress={() => answerSafety('no')} />
        <ChoiceButton label="Yes" onPress={() => answerSafety('yes')} />
        <ChoiceButton label="Not sure" onPress={() => answerSafety('notSure')} />
        <SecondaryButton
          label="I selected that by mistake"
          onPress={() => setScreen({
            ...activeCheckIn,
            stage: 'change',
            changeReport: undefined,
            movementComfort: undefined,
          })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'routineOptions') {
    const routine = screen.routine;
    const movement = routine.currentItem?.kind === 'movement'
      ? routine.currentItem
      : undefined;
    const alternative = movement?.availableAlternatives[0];
    return (
      <Shell>
        <PageHeader eyebrow="ROUTINE OPTIONS" title="What do you need?" />
        {alternative === undefined ? null : (
          <ChoiceButton
            label="Try an alternative"
            onPress={() => setScreen({
              kind: 'alternativePreview',
              routine,
              alternative,
            })}
          />
        )}
        <ChoiceButton
          label="Skip this step"
          onPress={() => void (async () => {
            const resumed = await submit(() => service.resumeRoutine(routine.sessionId));
            if (!resumed?.ok) return;
            const skipped = await submit(() => service.skipRoutineStep(
              resumed.value.sessionId,
              resumed.value.currentStepIndex,
            ));
            if (skipped?.ok) setScreen({ kind: 'routine', routine: skipped.value });
          })()}
        />
        <ChoiceButton
          label="End routine"
          onPress={() => setScreen({ kind: 'endConfirmation', routine })}
        />
        <ChoiceButton
          label="Something feels wrong"
          onPress={() => setScreen({ kind: 'safetyGuidance', routine })}
        />
        <SecondaryButton label="Back to routine" onPress={() => setScreen({ kind: 'routine', routine })} />
      </Shell>
    );
  }

  if (screen.kind === 'alternativePreview') {
    return (
      <Shell>
        <PageHeader eyebrow="ALTERNATIVE" title={screen.alternative.localizedTitle} />
        <Text style={styles.supporting}>{screen.alternative.localizedInstruction}</Text>
        <Text style={styles.safetyCue}>{screen.alternative.localizedSafetyCue}</Text>
        <PrimaryButton
          label="Use this alternative"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.selectRoutineAlternative(
              screen.routine.sessionId,
              screen.routine.currentStepIndex,
              screen.alternative.movementId,
            ));
            if (result?.ok) setScreen({ kind: 'routine', routine: result.value });
          })()}
        />
        <SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'routine', routine: screen.routine })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'endConfirmation') {
    return (
      <Shell>
        <PageHeader eyebrow="END ROUTINE" title="End this routine now?" />
        <Text style={styles.supporting}>Your intentional stop will remain in Progress as participation.</Text>
        <SecondaryButton
          danger
          disabled={isSubmitting}
          label="End routine"
          onPress={() => void (async () => {
            const result = await submit(() => service.endRoutine(
              screen.routine.sessionId,
              'intentional',
            ));
            if (result?.ok) {
              if (result.value.status === 'abandoned') await load();
              else setScreen({ kind: 'routine', routine: result.value });
            }
          })()}
        />
        <SecondaryButton
          label={screen.routine.status === 'prepared'
            ? 'Keep routine ready'
            : 'Keep routine paused'}
          onPress={() => setScreen({ kind: 'routine', routine: screen.routine })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'safetyGuidance') {
    return (
      <Shell>
        <PageHeader eyebrow="PAUSE AND CHECK IN" title="Stop if something feels wrong." />
        <Text style={styles.supporting}>
          Kineo cannot assess a new or concerning change. End the routine and seek appropriate professional support if needed.
        </Text>
        <PrimaryButton
          label="End routine"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.endRoutine(
              screen.routine.sessionId,
              'safety',
            ));
            if (result?.ok) setScreen({ kind: 'routine', routine: result.value });
          })()}
        />
        <SecondaryButton
          label="I tapped this by mistake"
          onPress={() => setScreen({ kind: 'routine', routine: screen.routine })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'completion') {
    return (
      <Shell>
        <PageHeader eyebrow="ROUTINE SAVED" title="You made a choice for today." />
        <Text style={styles.supporting}>
          {levelLabel(screen.routine.deliveredLevel)} · {durationLabel(screen.routine.duration)} · {screen.routine.includedAreas.map((area) => areaLabels[area]).join(' + ')}
        </Text>
        <PrimaryButton label="Done" onPress={() => void load()} />
        <SecondaryButton label="Start another check-in" onPress={() => void startCheckIn()} />
      </Shell>
    );
  }

  if (screen.kind === 'attentionReturn') {
    const respond = async (answer: 'yes' | 'no' | 'notSure') => {
      const result = await submit(() => service.respondToAttentionReturn(screen.prompt, answer));
      if (result?.ok) setScreen(screenForAttentionResolution(result.value));
    };
    return (
      <Shell>
        <PageHeader
          eyebrow="ATTENTION CHECK"
          title={`Has ${areaLabels[screen.prompt.area].toLowerCase()} returned to its usual pattern?`}
        />
        <Text style={styles.supporting}>Kineo will keep routines paused unless you answer yes.</Text>
        <ChoiceButton label="Yes" onPress={() => void respond('yes')} />
        <ChoiceButton label="No" onPress={() => void respond('no')} />
        <ChoiceButton label="Not sure" onPress={() => void respond('notSure')} />
        <SecondaryButton
          label="I selected that by mistake"
          onPress={() => void (async () => {
            const result = await submit(() => service.beginAttentionCorrection(screen.prompt));
            if (!result?.ok) return;
            setScreen({
              kind: 'checkIn',
              draft: result.value.checkIn,
              correctionDraft: result.value,
              currentArea: result.value.checkIn.primaryArea,
              answers: {},
              stage: 'change',
            });
          })()}
        />
      </Shell>
    );
  }

  const activeRoutine = screen.kind === 'routine' || screen.kind === 'feedback'
    ? screen.routine
    : screen.kind === 'start' && screen.state.kind === 'unfinishedRoutine'
      ? screen.state.routine
      : undefined;
  if (activeRoutine !== undefined) {
    const updateRoutine = async (
      operation: () => Promise<
        | Readonly<{ ok: true; value: RoutinePresentation }>
        | Readonly<{ ok: false; error: ProductFlowError }>
      >,
    ) => {
      const result = await submit(operation);
      if (result?.ok) setScreen({ kind: 'routine', routine: result.value });
    };
    if (activeRoutine.status === 'prepared') {
      return (
        <Shell>
          <PageHeader eyebrow="ROUTINE READY" title="Begin when you’re ready." />
          <Text style={styles.supporting}>Kineo did not start this routine while the app was interrupted.</Text>
          <PrimaryButton
            label="Begin routine"
            disabled={isSubmitting}
            onPress={() => void updateRoutine(() => service.startRoutine(activeRoutine.decisionId))}
          />
          <SecondaryButton
            label="End routine"
            onPress={() => setScreen({ kind: 'endConfirmation', routine: activeRoutine })}
          />
        </Shell>
      );
    }
    if (activeRoutine.status === 'paused') {
      return (
        <Shell>
          <PageHeader eyebrow="ROUTINE PAUSED" title="Your place is saved." />
          <Text style={styles.supporting}>Resume when you’re ready. Kineo won’t infer progress while paused.</Text>
          <PrimaryButton
            label="Resume routine"
            disabled={isSubmitting}
            onPress={() => void updateRoutine(() => service.resumeRoutine(activeRoutine.sessionId))}
          />
          <SecondaryButton
            label="End routine"
            onPress={() => void pauseForRoutineMenu(activeRoutine, 'end')}
          />
          <SecondaryButton
            label="Something feels wrong"
            onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')}
          />
        </Shell>
      );
    }
    if (activeRoutine.status === 'inProgress' && activeRoutine.currentItem !== undefined) {
      const item = activeRoutine.currentItem;
      const alternative = activeRoutine.selectedAlternative;
      const instruction = item.kind === 'movement'
        ? alternative?.localizedInstruction ?? item.localizedInstruction
        : 'Take this brief transition before continuing.';
      const safetyCue = item.kind === 'movement'
        ? alternative?.localizedSafetyCue ?? item.localizedSafetyCue
        : undefined;
      const presentedTitle = alternative?.localizedTitle ?? item.localizedTitle;
      const dose = item.kind === 'movement'
        ? alternative?.scheduledDose ?? item.scheduledDose
        : undefined;
      return (
        <Shell>
          <View style={styles.routineProgressRow}>
            <Text style={styles.eyebrow}>STEP {activeRoutine.currentStepIndex + displayIndexOffset} OF {activeRoutine.totalStepCount}</Text>
            <Text style={styles.areaBadgeText}>{areaLabels[item.sourceArea]}</Text>
          </View>
          {item.kind === 'movement' ? (
            <RoutineVideo accessibilityLabel={item.accessibleDescription} />
          ) : (
            <View style={styles.mediaPlaceholder} accessibilityLabel="Routine transition">
              <Text style={styles.mediaPlaceholderText}>NEXT MOVEMENT</Text>
            </View>
          )}
          <PageHeader eyebrow={activeRoutine.deliveredLevel.toUpperCase()} title={presentedTitle} />
          <Text style={styles.supporting}>{instruction}</Text>
          {dose === undefined ? null : (
            <View style={styles.routineTimerCard}>
              <Text style={styles.routineTimerText}>
                {routineTimerText(activeRoutine, dose)}
              </Text>
              <Text style={styles.cardBody}>
                {dose.kind === 'timed'
                  ? `${dose.activeSeconds} seconds planned`
                  : `${dose.repetitionCount} repetitions`}
              </Text>
            </View>
          )}
          {safetyCue === undefined ? null : <Text style={styles.safetyCue}>{safetyCue}</Text>}
          <PrimaryButton
            label="Continue"
            disabled={isSubmitting || !routineStepCanAdvance(activeRoutine, dose)}
            onPress={() => void updateRoutine(() => service.advanceRoutine(
              activeRoutine.sessionId,
              activeRoutine.currentStepIndex,
            ))}
          />
          <SecondaryButton
            label="Pause"
            disabled={isSubmitting}
            onPress={() => void updateRoutine(() => service.pauseRoutine(activeRoutine.sessionId))}
          />
          <SecondaryButton
            label="Something feels wrong"
            onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')}
          />
          <SecondaryButton
            label="More options"
            onPress={() => void pauseForRoutineMenu(activeRoutine, 'options')}
          />
        </Shell>
      );
    }
    const feedbackAreaIndex = screen.kind === 'feedback' ? screen.areaIndex : 0;
    const feedbackResponses = screen.kind === 'feedback' ? screen.responses : {};
    const feedbackArea = activeRoutine.includedAreas[feedbackAreaIndex];
    const finishFeedback = async (response?: AreaResponse) => {
      if (feedbackArea === undefined) return;
      const responses = response === undefined
        ? feedbackResponses
        : { ...feedbackResponses, [feedbackArea]: response };
      const nextAreaIndex = feedbackAreaIndex + displayIndexOffset;
      if (nextAreaIndex < activeRoutine.includedAreas.length) {
        setScreen({
          kind: 'feedback',
          routine: activeRoutine,
          areaIndex: nextAreaIndex,
          responses,
        });
        return;
      }
      const result = await submit(() => service.submitFeedback(activeRoutine.sessionId, responses));
      if (result?.ok) setScreen({ kind: 'completion', routine: activeRoutine });
    };
    return (
      <Shell>
        <PageHeader
          eyebrow="OPTIONAL RESPONSE"
          title={feedbackArea === undefined
            ? 'Your routine is saved.'
            : `How did ${areaLabels[feedbackArea].toLowerCase()} feel afterward?`}
        />
        <Text style={styles.supporting}>This helps Kineo interpret your own history. It does not measure recovery.</Text>
        <ChoiceButton label="Better" onPress={() => void finishFeedback('better')} />
        <ChoiceButton label="About the same" onPress={() => void finishFeedback('same')} />
        <ChoiceButton label="Worse" onPress={() => void finishFeedback('worse')} />
        <SecondaryButton label="Skip response" onPress={() => void finishFeedback()} />
      </Shell>
    );
  }

  const activePlan = screen.kind === 'plan'
    ? screen.plan
    : screen.kind === 'start' && screen.state.kind === 'unfinishedPlan'
      ? screen.state.plan
      : undefined;
  if (activePlan !== undefined) {
    const revise = async (
      duration: PlanPresentation['duration'],
      requestedLevel?: PlanPresentation['selectedLevel'],
    ) => {
      const result = await submit(() =>
        service.revisePlan(activePlan.checkInId, duration, requestedLevel),
      );
      if (result?.ok) setScreen({ kind: 'plan', plan: result.value });
    };
    const gentlerLevel = activePlan.gentlerLevel;
    return (
      <Shell>
        <PageHeader eyebrow="READY WHEN YOU ARE" title="Your plan for today" />
        <View style={styles.planHero}>
          <Text style={styles.planLevel}>{levelLabel(activePlan.deliveredLevel)}</Text>
          <Text style={styles.planMeta}>
            {durationLabel(activePlan.duration)} · {activePlan.itemCount} steps · {Math.round(activePlan.nominalSeconds / secondsPerMinute)} min
          </Text>
        </View>
        {planExplanationLines(activePlan).map((line) => (
          <Text key={line} style={styles.supporting}>{line}</Text>
        ))}
        {activePlan.omittedSecondaryArea === undefined ? null : (
          <Text style={styles.supporting}>
            {areaLabels[activePlan.omittedSecondaryArea]} is not included because compatible prototype content is unavailable.
          </Text>
        )}
        <View style={styles.segmentedControl} accessibilityRole="radiogroup">
          {(['quick', 'standard'] as const).map((duration) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: activePlan.duration === duration }}
              key={duration}
              onPress={() => void revise(duration)}
              style={[
                styles.segment,
                activePlan.duration === duration && styles.segmentSelected,
              ]}
            >
              <Text style={styles.segmentText}>{durationLabel(duration)}</Text>
            </Pressable>
          ))}
        </View>
        {gentlerLevel === undefined ? null : (
          <SecondaryButton
            label={`Choose ${levelLabel(gentlerLevel)} instead`}
            onPress={() => void revise(activePlan.duration, gentlerLevel)}
          />
        )}
        <PrimaryButton
          label="Begin routine"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.startRoutine(activePlan.decisionId));
            if (result?.ok) setScreen({ kind: 'routine', routine: result.value });
          })()}
        />
        {activePlan.pauseTodayAvailable ? (
          <SecondaryButton
            label="Pause Today"
            onPress={() => void (async () => {
              const result = await submit(() => service.pauseToday(activePlan.checkInId));
              if (result?.ok) setScreen({
                kind: 'start',
                state: { kind: 'today', primaryArea: result.value },
              });
            })()}
          />
        ) : null}
        <NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />
      </Shell>
    );
  }

  if (screen.kind === 'progress') {
    const hasHistory = screen.progress.areas.some(({ checkInCount }) => checkInCount > 0);
    return (
      <Shell>
        <PageHeader eyebrow="YOUR HISTORY" title="Progress without pressure" />
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>
            {screen.progress.weeklyParticipationDayCount} of {screen.progress.weeklyGoalDays}
          </Text>
          <Text style={styles.metricLabel}>consistency days this week</Text>
        </View>
        <Text style={styles.cardBody}>
          {screen.progress.participationDayCount} total participation days. Completed routines, intentional stops, and eligible Pause Today choices count equally.
        </Text>
        {!hasHistory ? (
          <View style={styles.historyCard}>
            <Text style={styles.cardTitle}>Your patterns will appear here</Text>
            <Text style={styles.cardBody}>Complete a check-in to begin your private history.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.cardTitle}>Areas</Text>
            {screen.progress.areas.filter(({ checkInCount }) => checkInCount > 0).map((area) => (
              <ChoiceButton
                key={area.area}
                label={`${areaLabels[area.area]} · ${area.checkInCount} check-ins`}
                onPress={() => setScreen({
                  kind: 'progressArea',
                  progress: screen.progress,
                  area: area.area,
                })}
              />
            ))}
            <Text style={styles.cardTitle}>Recent sessions</Text>
            {screen.progress.recentSessions.map((session) => (
              <View key={session.sessionId} style={styles.historyCard}>
                <Text style={styles.cardTitle}>{session.localDay} · {levelLabel(session.deliveredLevel)}</Text>
                <Text style={styles.cardBody}>
                  {session.areas.map((area) => areaLabels[area]).join(' + ')} · {routineStatusLabel(session.status)}
                </Text>
              </View>
            ))}
          </>
        )}
        <NavigationBar active="progress" onSelect={(tab) => void openTab(tab)} />
      </Shell>
    );
  }

  if (screen.kind === 'progressArea') {
    const area = screen.progress.areas.find(({ area }) => area === screen.area);
    if (area === undefined) {
      return (
        <Shell>
          <PageHeader eyebrow="PROGRESS" title="Area history unavailable" />
          <PrimaryButton
            label="Back to Progress"
            onPress={() => setScreen({ kind: 'progress', progress: screen.progress })}
          />
        </Shell>
      );
    }
    return (
      <Shell>
        <PageHeader eyebrow="AREA DETAIL" title={areaLabels[area.area]} />
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>{area.participationCount} participation choices</Text>
          <Text style={styles.cardBody}>{area.completedRoutineCount} completed routines</Text>
          <Text style={styles.cardBody}>
            Responses: {area.responses.better} better · {area.responses.same} same · {area.responses.worse} worse
          </Text>
          <Text style={styles.cardBody}>
            {area.activeUnlocked ? 'Active option available' : 'Active remains locked'}
          </Text>
        </View>
        <Text style={styles.cardTitle}>Check-in and level history</Text>
        {[...area.history].reverse().map((entry, index) => (
          <View key={`${entry.localDay}-${index}`} style={styles.historyCard}>
            <Text style={styles.cardTitle}>{entry.localDay}</Text>
            <Text style={styles.cardBody}>
              {changeReportLabel(entry.changeReport)} · {movementComfortLabel(entry.movementComfort)}
            </Text>
            {entry.routine === undefined ? null : (
              <Text style={styles.cardBody}>
                {levelLabel(entry.routine.deliveredLevel)} · {routineStatusLabel(entry.routine.status)} · {entry.routine.response ?? 'No response'}
              </Text>
            )}
          </View>
        ))}
        <Text style={styles.cardBody}>
          These events occurred in your history. Kineo does not claim that one caused another.
        </Text>
        <PrimaryButton
          label="Back to Progress"
          onPress={() => setScreen({ kind: 'progress', progress: screen.progress })}
        />
        <NavigationBar active="progress" onSelect={(tab) => void openTab(tab)} />
      </Shell>
    );
  }

  if (screen.kind === 'profileAreas') {
    const primary = selectedPrimaryArea ?? screen.profile.profile.primaryArea;
    const secondary = isSecondaryCleared
      ? undefined
      : selectedSecondaryArea ?? screen.profile.profile.secondaryArea;
    return (
      <Shell>
        <PageHeader eyebrow="PROFILE" title="Choose your areas" />
        <Text style={styles.cardTitle}>Primary area</Text>
        {bodyAreas.map((area) => (
          <ChoiceButton key={area} label={areaLabels[area]} onPress={() => {
            setSelectedPrimaryArea(area);
            setIsSecondaryCleared(secondary === area);
            if (secondary === area) setSelectedSecondaryArea(undefined);
          }} />
        ))}
        <Text style={styles.cardTitle}>Optional second area</Text>
        {bodyAreas.filter((area) => area !== primary).map((area) => (
          <ChoiceButton key={area} label={areaLabels[area]} onPress={() => {
            setIsSecondaryCleared(false);
            setSelectedSecondaryArea(area);
          }} />
        ))}
        <SecondaryButton label="No second area" onPress={() => {
          setIsSecondaryCleared(true);
          setSelectedSecondaryArea(undefined);
        }} />
        <PrimaryButton
          label="Save areas"
          disabled={primary === undefined || isSubmitting}
          onPress={() => void (async () => {
            if (primary === undefined) return;
            const result = await submit(() => service.saveAreaPreferences(primary, secondary));
            if (result?.ok) setScreen({ kind: 'profile', profile: result.value });
          })()}
        />
      </Shell>
    );
  }

  if (screen.kind === 'confirmReset') {
    return (
      <Shell>
        <PageHeader eyebrow="PRIVACY & DATA" title="Reset history?" />
        <Text style={styles.supporting}>
          This removes check-ins, plans, routines, feedback, and Progress history.
        </Text>
        <View style={styles.safetyCard}>
          <Text style={styles.cardTitle}>Safety exception</Text>
          <Text style={styles.cardBody}>
            Any current Attention Required area remains so Reset cannot bypass it. Your areas and reminder preference also remain.
          </Text>
        </View>
        <SecondaryButton
          danger
          disabled={isSubmitting}
          label="Reset history"
          onPress={() => void (async () => {
            const result = await submit(() => service.resetHistory());
            if (result?.ok) setScreen({ kind: 'profile', profile: screen.profile });
          })()}
        />
        <SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'confirmDelete') {
    return (
      <Shell>
        <PageHeader eyebrow="PRIVACY & DATA" title="Delete all Kineo data?" />
        <Text style={styles.supporting}>
          This removes your profile, all local history, current Attention Required areas, and Kineo reminders. It cannot be undone.
        </Text>
        <Text style={styles.cardBody}>
          It does not change iPhone notification permission history or data and diagnostics held independently by Apple.
        </Text>
        <SecondaryButton
          danger
          disabled={isSubmitting}
          label="Delete all data"
          onPress={() => void (async () => {
            const result = await submit(() => service.deleteAllData());
            if (result?.ok || result?.error.code === 'persistence') {
              onStoreRestartRequired();
            }
          })()}
        />
        <SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'profile') {
    const profile = screen.profile.profile;
    const reminder = screen.profile.reminderSettings;
    const updateReminder = async (
      window: typeof morningReminderWindow,
    ) => {
      const result = await submit(() => service.enableReminder(window));
      if (result?.ok) setScreen({ kind: 'profile', profile: result.value });
    };
    return (
      <Shell>
        <PageHeader eyebrow="SETTINGS" title="Profile" />
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Areas</Text>
          <Text style={styles.cardBody}>
            {profile.primaryArea === undefined ? 'Not set' : areaLabels[profile.primaryArea]}
            {profile.secondaryArea === undefined ? '' : ` · ${areaLabels[profile.secondaryArea]}`}
          </Text>
          <SecondaryButton label="Change areas" onPress={() => {
            setSelectedPrimaryArea(profile.primaryArea);
            setSelectedSecondaryArea(profile.secondaryArea);
            setIsSecondaryCleared(profile.secondaryArea === undefined);
            setScreen({ kind: 'profileAreas', profile: screen.profile });
          }} />
        </View>
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Routine preferences</Text>
          <Text style={styles.cardBody}>
            Your daily check-in selects the level. Choose Quick or Standard on each plan; available time never changes the selected level.
          </Text>
          <Text style={styles.cardBody}>Weekly consistency goal: {profile.weeklyGoalDays} days</Text>
        </View>
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Reminders</Text>
          <Text style={styles.cardBody}>
            {reminder?.enabled && (
              screen.profile.reminderAuthorization === 'authorized' ||
              screen.profile.reminderAuthorization === 'provisional'
            )
              ? 'One generic daily reminder is scheduled.'
              : screen.profile.reminderAuthorization === 'denied'
                ? 'Notifications are off in iPhone Settings. Kineo still works without them.'
                : screen.profile.reminderAuthorization === 'unavailable'
                  ? 'Reminder settings are temporarily unavailable. Kineo still works without them.'
                  : 'Optional. Kineo asks for notification access only after you choose a time.'}
          </Text>
          {reminderReconciliationFailed ? (
            <Text style={styles.safetyCue}>
              Kineo could not reconcile reminders after returning to the app. Try again from Profile.
            </Text>
          ) : null}
          {screen.profile.reminderAuthorization === 'denied' ? (
            <SecondaryButton
              label="Open iPhone Settings"
              onPress={() => void submit(() => service.openReminderSettings())}
            />
          ) : null}
          {reminder?.enabled && (
            screen.profile.reminderAuthorization === 'authorized' ||
            screen.profile.reminderAuthorization === 'provisional'
          ) ? (
            <SecondaryButton
              label="Turn reminders off"
              disabled={isSubmitting}
              onPress={() => void (async () => {
                const result = await submit(() => service.disableReminder());
                if (result?.ok) setScreen({ kind: 'profile', profile: result.value });
              })()}
            />
          ) : (
            <>
              <ChoiceButton
                label="Morning · 8:00 AM"
                onPress={() => void updateReminder(morningReminderWindow)}
              />
              <ChoiceButton
                label="Evening · 6:00 PM"
                onPress={() => void updateReminder(eveningReminderWindow)}
              />
            </>
          )}
        </View>
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Health app context</Text>
          <Text style={styles.cardBody}>
            Disabled in this prototype. Health data does not select or change Kineo routines.
          </Text>
        </View>
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Privacy & data</Text>
          <Text style={styles.cardBody}>Your Kineo history stays on this device. Reset keeps your profile and any current Attention gate.</Text>
          <SecondaryButton
            label="Reset History"
            onPress={() => setScreen({ kind: 'confirmReset', profile: screen.profile })}
          />
          <SecondaryButton
            danger
            label="Delete All Data"
            onPress={() => setScreen({ kind: 'confirmDelete', profile: screen.profile })}
          />
        </View>
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>Safety and support</Text>
          <Text style={styles.cardBody}>
            Kineo provides movement planning for general wellness. It does not diagnose or treat a condition.
          </Text>
          <Text style={styles.cardBody}>
            This build uses prototype exercise media and is not ready for public release.
          </Text>
          <Text style={styles.cardBody}>For app support during internal testing, contact the Kineo product team.</Text>
        </View>
        <View style={styles.historyCard}>
          <Text style={styles.cardTitle}>App information</Text>
          <Text style={styles.cardBody}>Kineo internal prototype · Expo build</Text>
          <Text style={styles.cardBody}>No account, telemetry, or remote synchronization is enabled.</Text>
        </View>
        <NavigationBar active="profile" onSelect={(tab) => void openTab(tab)} />
      </Shell>
    );
  }

  if (screen.kind === 'loading') {
    return (
      <Shell>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentDark} />
          <Text style={styles.supporting}>Preparing your private Kineo space…</Text>
        </View>
      </Shell>
    );
  }

  if (screen.kind === 'error') {
    return (
      <Shell>
        <PageHeader eyebrow="LET'S TRY THAT AGAIN" title="Your data stayed put." />
        <Text style={styles.supporting}>{errorMessage(screen.error)}</Text>
        <PrimaryButton label="Retry" disabled={isSubmitting} onPress={() => void load()} />
      </Shell>
    );
  }

  if (screen.kind === 'ageConfirmation') {
    return (
      <Shell>
        <ProgressLabel current={1} total={4} />
        <PageHeader eyebrow="BEFORE WE BEGIN" title="Are you 18 or older?" />
        <Text style={styles.supporting}>
          Kineo is currently designed for adults. Your answer stays on this device.
        </Text>
        <PrimaryButton
          label="Yes, I’m 18 or older"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.confirmAdultEligibility());
            if (result?.ok) await load();
          })()}
        />
        <SecondaryButton label="No" onPress={() => setScreen({ kind: 'ageUnavailable' })} />
      </Shell>
    );
  }

  if (screen.kind === 'ageUnavailable') {
    return (
      <Shell>
        <PageHeader eyebrow="NOT AVAILABLE YET" title="Kineo is for adults right now." />
        <Text style={styles.supporting}>
          We can’t continue with setup. No movement plan has been created.
        </Text>
        <SecondaryButton label="I answered by mistake" onPress={() => setScreen({ kind: 'ageConfirmation' })} />
      </Shell>
    );
  }

  if (onboarding?.step === 'welcome') {
    return (
      <Shell>
        <View style={styles.brandPill}><Text style={styles.brandPillText}>KINEO</Text></View>
        <PageHeader
          eyebrow="MOVE WITH TODAY IN MIND"
          title="A routine shaped around how you feel now."
        />
        <Text style={styles.supporting}>
          A short check-in guides a private, on-device movement routine for your neck and back.
        </Text>
        <View style={styles.featureCard}>
          <FeatureRow number="01" text="Quick daily check-in" />
          <FeatureRow number="02" text="A routine matched to your answers" />
          <FeatureRow number="03" text="Progress without pressure" />
        </View>
        <PrimaryButton label="Get started" onPress={() => setScreen({ kind: 'ageConfirmation' })} />
      </Shell>
    );
  }

  if (onboarding?.step === 'primaryArea') {
    return (
      <AreaSelection
        eyebrow="YOUR MAIN FOCUS"
        title="Where would you like to start?"
        supporting="Choose the area you most want today’s routine to consider."
        selected={selectedPrimaryArea}
        options={bodyAreas}
        onSelect={setSelectedPrimaryArea}
        onContinue={() => void (async () => {
          if (selectedPrimaryArea === undefined) return;
          const result = await submit(() => service.savePrimaryArea(selectedPrimaryArea));
          if (result?.ok) await load();
        })()}
        disabled={selectedPrimaryArea === undefined || isSubmitting}
        progressCurrent={2}
      />
    );
  }

  if (onboarding?.step === 'secondaryArea') {
    const options = bodyAreas.filter((area) => area !== onboarding.primaryArea);
    return (
      <AreaSelection
        eyebrow="OPTIONAL SECOND AREA"
        title="Anything else to include?"
        supporting="Choose one more area, or keep today focused."
        selected={selectedSecondaryArea}
        options={options}
        onSelect={setSelectedSecondaryArea}
        onContinue={() => void (async () => {
          const result = await submit(() => service.saveSecondaryArea(selectedSecondaryArea));
          if (result?.ok) await load();
        })()}
        disabled={isSubmitting}
        progressCurrent={3}
        optionalLabel="Just focus on my main area"
        onOptional={() => void (async () => {
          const result = await submit(() => service.saveSecondaryArea());
          if (result?.ok) await load();
        })()}
      />
    );
  }

  if (onboarding?.step === 'safetyBoundary') {
    return (
      <Shell>
        <ProgressLabel current={4} total={4} />
        <PageHeader eyebrow="A CLEAR BOUNDARY" title="You stay in control." />
        <View style={styles.safetyCard}>
          <Text style={styles.cardTitle}>Kineo is wellness guidance—not medical care.</Text>
          <Text style={styles.cardBody}>
            Kineo is not intended for a new injury, sudden or unusual symptoms, postoperative rehabilitation, or emergencies.
          </Text>
          <Text style={styles.cardBody}>
            Stop if you feel worse or something feels wrong, and seek appropriate professional help when needed. Kineo will withhold a routine when your answers need more caution.
          </Text>
        </View>
        <PrimaryButton
          label="I understand"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.acknowledgeSafetyBoundary());
            if (result?.ok) await load();
          })()}
        />
      </Shell>
    );
  }

  if (onboarding?.step === 'firstCheckIn') {
    return (
      <Shell>
        <PageHeader eyebrow="SETUP COMPLETE" title="Let’s make this useful." />
        <Text style={styles.supporting}>
          Your first short check-in will shape a routine for {areaLabels[onboarding.primaryArea].toLowerCase()}.
        </Text>
        <PrimaryButton
          label="Continue to Today"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.completeOnboarding());
            if (result?.ok) await load();
          })()}
        />
      </Shell>
    );
  }

  if (screen.kind === 'start' && screen.state.kind === 'attentionRequired') {
    const attentionPrompt = screen.state.prompt;
    return (
      <Shell>
        <PageHeader eyebrow="ATTENTION REQUIRED" title="Pause before another routine." />
        <Text style={styles.supporting}>
          Your earlier answer for {areaLabels[attentionPrompt.area].toLowerCase()} needs a fresh safety check before Kineo can continue.
        </Text>
        <PrimaryButton
          label="Review now"
          onPress={() => setScreen({ kind: 'attentionReturn', prompt: attentionPrompt })}
        />
        <NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />
      </Shell>
    );
  }

  if (screen.kind === 'attentionGuidance') {
    return (
      <Shell>
        <PageHeader eyebrow="ATTENTION REQUIRED" title="Kineo cannot guide this change." />
        <Text style={styles.supporting}>
          Your answer for {areaLabels[screen.prompt.area].toLowerCase()} described a new, sudden, unusual, or uncertain change. Kineo will not provide another routine right now.
        </Text>
        <Text style={styles.supporting}>
          Seek appropriate professional help if needed. Use urgent or emergency services when the situation may be an emergency.
        </Text>
        <Text style={styles.supporting}>
          On your next visit, Kineo will ask whether this area has returned to its usual recurring pattern.
        </Text>
        <NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />
      </Shell>
    );
  }

  const primaryArea = screen.kind === 'start' && screen.state.kind === 'today'
    ? screen.state.primaryArea
    : undefined;
  return (
    <Shell>
      <View style={styles.todayTopRow}>
        <View>
          <Text style={styles.eyebrow}>TODAY</Text>
          <Text style={styles.todayTitle}>How are you moving?</Text>
        </View>
        <View style={styles.areaBadge}><Text style={styles.areaBadgeText}>{primaryArea ? areaLabels[primaryArea] : 'Kineo'}</Text></View>
      </View>
      <View style={styles.todayCard}>
        <Text style={styles.todayCardEyebrow}>YOUR NEXT ROUTINE</Text>
        <Text style={styles.todayCardTitle}>Start with a quick check-in.</Text>
        <Text style={styles.todayCardBody}>Three focused answers. No long daily questionnaire.</Text>
        <PrimaryButton label="Check in" disabled={isSubmitting} onPress={() => void startCheckIn()} />
      </View>
      <View style={styles.testSection}>
        <Text style={styles.testLabel}>TESTING</Text>
        <SecondaryButton
          label="Reset demo to first use"
          disabled={isSubmitting}
          danger
          onPress={() => void (async () => {
            const result = await submit(() => service.deleteAllData());
            if (result?.ok || result?.error.code === 'persistence') {
              onStoreRestartRequired();
            }
          })()}
        />
      </View>
      <NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />
    </Shell>
  );
}

function Shell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.readable}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

function PageHeader({ eyebrow, title }: Readonly<{ eyebrow: string; title: string }>) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    </View>
  );
}

function RoutineVideo({ accessibilityLabel }: Readonly<{ accessibilityLabel: string }>) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const player = useVideoPlayer(prototypeMovementVideo, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
  });
  useEffect(() => {
    let isActive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isActive) setReduceMotion(enabled);
      })
      .catch(() => {
        if (isActive) setReduceMotion(true);
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      isActive = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (reduceMotion) {
      player.pause();
    } else {
      player.play();
    }
  }, [player, reduceMotion]);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={styles.mediaPlaceholder}
    >
      <VideoView
        allowsPictureInPicture={false}
        contentFit="cover"
        nativeControls={false}
        player={player}
        style={styles.routineVideo}
      />
      <View pointerEvents="none" style={styles.prototypeMediaBadge}>
        <Text style={styles.prototypeMediaBadgeText}>PROTOTYPE MOVEMENT</Text>
      </View>
    </View>
  );
}

function ProgressLabel({ current, total }: Readonly<{ current: number; total: number }>) {
  return <Text style={styles.progress}>STEP {current} OF {total}</Text>;
}

function FeatureRow({ number, text }: Readonly<{ number: string; text: string }>) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureNumber}>{number}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function AreaSelection({
  eyebrow, title, supporting, selected, options, onSelect, onContinue, disabled,
  progressCurrent, optionalLabel, onOptional,
}: Readonly<{
  eyebrow: string;
  title: string;
  supporting: string;
  selected?: BodyArea;
  options: readonly BodyArea[];
  onSelect: (area: BodyArea) => void;
  onContinue: () => void;
  disabled: boolean;
  progressCurrent: number;
  optionalLabel?: string;
  onOptional?: () => void;
}>) {
  return (
    <Shell>
      <ProgressLabel current={progressCurrent} total={4} />
      <PageHeader eyebrow={eyebrow} title={title} />
      <Text style={styles.supporting}>{supporting}</Text>
      <View accessibilityRole="radiogroup" style={styles.optionList}>
        {options.map((area) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === area }}
            key={area}
            onPress={() => onSelect(area)}
            style={[styles.option, selected === area && styles.optionSelected]}
          >
            <Text style={[styles.optionText, selected === area && styles.optionTextSelected]}>{areaLabels[area]}</Text>
            <View style={[styles.radio, selected === area && styles.radioSelected]} />
          </Pressable>
        ))}
      </View>
      <PrimaryButton label="Continue" onPress={onContinue} disabled={disabled} />
      {optionalLabel && onOptional ? <SecondaryButton label={optionalLabel} onPress={onOptional} /> : null}
    </Shell>
  );
}

function PrimaryButton({ label, onPress, disabled = false }: Readonly<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, disabled && styles.buttonDisabled, pressed && styles.buttonPressed]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, disabled = false, danger = false }: Readonly<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
    >
      <Text style={[styles.secondaryButtonText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

function ChoiceButton({ label, onPress }: Readonly<{ label: string; onPress: () => void }>) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.choiceButton}>
      <Text style={styles.choiceButtonText}>{label}</Text>
      <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.choiceArrow}>›</Text>
    </Pressable>
  );
}

function NavigationBar({
  active,
  onSelect,
}: Readonly<{ active: MainTab; onSelect: (tab: MainTab) => void }>) {
  const tabs: readonly Readonly<{ id: MainTab; label: string }>[] = [
    { id: 'today', label: 'Today' },
    { id: 'progress', label: 'Progress' },
    { id: 'profile', label: 'Profile' },
  ];
  return (
    <View accessibilityRole="tablist" style={styles.navigationBar}>
      {tabs.map((tab) => (
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.id }}
          key={tab.id}
          onPress={() => onSelect(tab.id)}
          style={styles.navigationItem}
        >
          <Text style={[
            styles.navigationText,
            active === tab.id && styles.navigationTextSelected,
          ]}>{tab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const secondsPerMinute = 60;
const millisecondsPerSecond = 1_000;
const countdownRoundingOffsetMilliseconds = millisecondsPerSecond - 1;
const routineRefreshIntervalMilliseconds = millisecondsPerSecond;
const noElapsedMilliseconds = 0;
const displayIndexOffset = 1;

function levelLabel(level: PlanPresentation['deliveredLevel']): string {
  return level[0].toUpperCase() + level.slice(1);
}

function durationLabel(duration: PlanPresentation['duration']): string {
  return duration === 'quick' ? 'Quick' : 'Standard';
}

function changeReportLabel(change: ChangeReport): string {
  return displayValueLabel(change);
}

function movementComfortLabel(comfort: MovementComfort): string {
  return displayValueLabel(comfort);
}

function displayValueLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function routineStatusLabel(status: RoutinePresentation['status']): string {
  switch (status) {
    case 'inProgress': return 'In progress';
    case 'safetyStopped': return 'Ended after safety pause';
    case 'stopped': return 'Intentionally stopped';
    case 'completed': return 'Completed';
    case 'prepared': return 'Ready';
    case 'paused': return 'Paused';
    case 'abandoned': return 'Not completed';
  }
}

function planExplanationLines(plan: PlanPresentation): readonly string[] {
  const copyByKey: Readonly<Record<string, string>> = {
    'reason.user_gentler_override': 'You chose a gentler option for today.',
    'reason.reported_worse': 'You reported feeling worse than your usual pattern.',
    'reason.movement_limited': 'Movement felt limited today.',
    'reason.better_good_active': 'You reported feeling better with good movement comfort.',
    'reason.balanced_checkin': 'Your check-in supports a Balanced option today.',
    'reason.active_locked': 'Active remains unavailable until enough qualifying history is recorded.',
    'reason.secondary_more_conservative': 'The more cautious area set today’s level.',
  };
  return plan.explanationKeys.map(
    (key) => copyByKey[key] ?? 'Your saved check-in determined this plan.',
  );
}

function routineTimerText(
  routine: RoutinePresentation,
  dose: Dose,
): string {
  if (dose.kind === 'timed') {
    const totalMilliseconds = dose.estimatedSeconds * millisecondsPerSecond;
    const remainingMilliseconds = Math.max(
      noElapsedMilliseconds,
      totalMilliseconds - routine.stepElapsedMilliseconds,
    );
    const remainingSeconds = Math.floor(
      (remainingMilliseconds + countdownRoundingOffsetMilliseconds) /
        millisecondsPerSecond,
    );
    return `${remainingSeconds} seconds remaining`;
  }
  return `${Math.floor(routine.stepElapsedMilliseconds / millisecondsPerSecond)} seconds elapsed`;
}

function routineStepCanAdvance(
  routine: RoutinePresentation,
  dose: Dose | undefined,
): boolean {
  return dose?.kind !== 'timed' ||
    routine.stepElapsedMilliseconds >= dose.activeSeconds * millisecondsPerSecond;
}

function screenForAttentionResolution(resolution: AttentionResolution): LocalScreen {
  return resolution.kind === 'ready'
    ? { kind: 'start', state: { kind: 'today', primaryArea: resolution.primaryArea } }
    : { kind: 'attentionGuidance', prompt: resolution.prompt };
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  page: { flexGrow: 1, paddingHorizontal: spacing.screenHorizontal, paddingVertical: spacing.screenVertical },
  readable: { alignSelf: 'center', flex: 1, gap: spacing.roomy, maxWidth: layout.readableWidth, width: '100%' },
  centered: { alignItems: 'center', flex: 1, gap: spacing.standard, justifyContent: 'center' },
  header: { gap: spacing.compact },
  eyebrow: { color: colors.accentDark, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  progress: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  title: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight, lineHeight: typography.titleLineHeight },
  supporting: { color: colors.secondaryInk, fontSize: typography.bodySize, lineHeight: typography.bodyLineHeight },
  brandPill: { alignSelf: 'flex-start', backgroundColor: colors.accentDark, borderRadius: radius.status, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  brandPillText: { color: colors.inverseInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  featureCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, padding: spacing.roomy },
  featureRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.standard, minHeight: layout.controlMinimumHeight },
  featureNumber: { color: colors.accentDark, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  featureText: { color: colors.ink, flex: 1, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  primaryButton: { alignItems: 'center', backgroundColor: colors.accentDark, borderRadius: radius.button, justifyContent: 'center', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.roomy, paddingVertical: spacing.controlVertical },
  primaryButtonText: { color: colors.inverseInk, fontSize: typography.bodySize, fontWeight: typography.buttonWeight },
  secondaryButton: { alignItems: 'center', borderRadius: radius.button, justifyContent: 'center', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.roomy, paddingVertical: spacing.controlVertical },
  secondaryButtonText: { color: colors.accentDark, fontSize: typography.bodySize, fontWeight: typography.buttonWeight },
  dangerText: { color: colors.danger },
  buttonDisabled: { opacity: layout.disabledOpacity },
  buttonPressed: { opacity: layout.pressedOpacity },
  optionList: { gap: spacing.compact },
  choiceButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.option, borderWidth: layout.borderWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.roomy, paddingVertical: spacing.controlVertical },
  choiceButtonText: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  choiceArrow: { color: colors.accentDark, fontSize: typography.titleSize },
  option: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.option, borderWidth: layout.borderWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.standard, paddingVertical: spacing.controlVertical },
  optionSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accentDark },
  optionText: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  optionTextSelected: { color: colors.accentDark },
  radio: { borderColor: colors.border, borderRadius: radius.status, borderWidth: layout.borderWidth, height: spacing.roomy, width: spacing.roomy },
  radioSelected: { backgroundColor: colors.accentDark, borderColor: colors.accentDark },
  safetyCard: { backgroundColor: colors.surface, borderLeftColor: colors.accent, borderLeftWidth: spacing.compact, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  cardTitle: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  cardBody: { color: colors.secondaryInk, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight },
  todayTopRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  todayTitle: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight, lineHeight: typography.titleLineHeight },
  areaBadge: { backgroundColor: colors.accentSoft, borderRadius: radius.status, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  areaBadgeText: { color: colors.accentDark, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  todayCard: { backgroundColor: colors.surface, borderRadius: radius.card, gap: spacing.standard, padding: spacing.roomy },
  planHero: { backgroundColor: colors.accentSoft, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  planLevel: { color: colors.accentDark, fontSize: typography.titleSize, fontWeight: typography.displayWeight },
  planMeta: { color: colors.secondaryInk, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight },
  segmentedControl: { backgroundColor: colors.surface, borderRadius: radius.button, flexDirection: 'row', padding: spacing.compact },
  segment: { alignItems: 'center', borderRadius: radius.button, flex: 1, minHeight: layout.controlMinimumHeight, justifyContent: 'center', paddingHorizontal: spacing.standard },
  segmentSelected: { backgroundColor: colors.accentSoft },
  segmentText: { color: colors.accentDark, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  metricCard: { backgroundColor: colors.accentDark, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  metricValue: { color: colors.inverseInk, fontSize: typography.titleSize, fontWeight: typography.displayWeight },
  metricLabel: { color: colors.inverseInk, fontSize: typography.bodySize },
  historyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.compact, padding: spacing.roomy },
  routineProgressRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  mediaPlaceholder: { alignItems: 'center', aspectRatio: layout.mediaAspectRatio, backgroundColor: colors.accentSoft, borderRadius: radius.card, justifyContent: 'center' },
  mediaPlaceholderText: { color: colors.accentDark, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  routineVideo: { height: '100%', width: '100%' },
  prototypeMediaBadge: { backgroundColor: colors.accentDark, borderRadius: radius.status, bottom: spacing.compact, left: spacing.compact, paddingHorizontal: spacing.compact, paddingVertical: spacing.compact, position: 'absolute' },
  prototypeMediaBadgeText: { color: colors.inverseInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  safetyCue: { backgroundColor: colors.surface, borderLeftColor: colors.accent, borderLeftWidth: spacing.compact, borderRadius: radius.card, color: colors.secondaryInk, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight, padding: spacing.standard },
  routineTimerCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.compact, padding: spacing.standard },
  routineTimerText: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  todayCardEyebrow: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  todayCardTitle: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight, lineHeight: typography.titleLineHeight },
  todayCardBody: { color: colors.secondaryInk, fontSize: typography.bodySize, lineHeight: typography.bodyLineHeight },
  testSection: { borderTopColor: colors.border, borderTopWidth: layout.borderWidth, gap: spacing.compact, marginTop: spacing.section, paddingTop: spacing.standard },
  testLabel: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  navigationBar: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, flexDirection: 'row', marginTop: 'auto', padding: spacing.compact },
  navigationItem: { alignItems: 'center', flex: 1, minHeight: layout.controlMinimumHeight, justifyContent: 'center' },
  navigationText: { color: colors.secondaryInk, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  navigationTextSelected: { color: colors.accentDark },
});
