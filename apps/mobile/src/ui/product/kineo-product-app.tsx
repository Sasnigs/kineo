import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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

import { createExclusiveActionGate } from './exclusive-action-gate';

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
  const submissionGate = useRef(createExclusiveActionGate());
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
      const result = await submissionGate.current.run(async () => {
        setIsSubmitting(true);
        try {
          return await operation();
        } finally {
          setIsSubmitting(false);
        }
      });
      if (result === undefined) return undefined;
      if (!result.ok) {
        setScreen({ kind: 'error', error: result.error });
      }
      return result;
    },
    [],
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
    destination: 'end' | 'safety',
  ) => {
    const paused = routine.status === 'inProgress'
      ? await submit(() => service.pauseRoutine(routine.sessionId))
      : { ok: true as const, value: routine };
    if (!paused?.ok) return;
    setScreen(
      destination === 'end'
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
        <Shell key={`${activeCheckIn.currentArea}-change`}>
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
        <Shell key={`${activeCheckIn.currentArea}-comfort`}>
          <ProgressLabel current={2} total={2} />
          <PageHeader eyebrow={areaName.toUpperCase()} title="How does movement feel?" />
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
      <Shell key={`${activeCheckIn.currentArea}-safety`}>
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

  if (screen.kind === 'alternativePreview') {
    return (
      <Shell key="alternative-preview">
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
      <Shell key="end-confirmation">
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
      <Shell key="safety-guidance">
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
      <Shell key="completion">
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
      <Shell key="attention-return">
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
        <Shell key="routine-prepared">
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
        <Shell key="routine-paused">
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
      const availableAlternative = item.kind === 'movement'
        ? item.availableAlternatives[0]
        : undefined;
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
        <Shell
          bottomBar={(
            <View style={styles.actionStack}>
              <PrimaryButton
                icon="arrow-forward"
                label="Continue"
                disabled={isSubmitting || !routineStepCanAdvance(activeRoutine, dose)}
                onPress={() => void updateRoutine(() => service.advanceRoutine(
                  activeRoutine.sessionId,
                  activeRoutine.currentStepIndex,
                ))}
              />
              <View style={styles.routineActionRow}>
                {availableAlternative === undefined ? null : (
                  <RoutineActionButton
                    accessibilityLabel="Try an alternative"
                    disabled={isSubmitting}
                    icon="swap-horizontal-outline"
                    label="Alternative"
                    onPress={() => void (async () => {
                      const paused = await submit(() => service.pauseRoutine(activeRoutine.sessionId));
                      if (paused?.ok) {
                        setScreen({
                          kind: 'alternativePreview',
                          routine: paused.value,
                          alternative: availableAlternative,
                        });
                      }
                    })()}
                  />
                )}
                <RoutineActionButton
                  disabled={isSubmitting}
                  icon="play-skip-forward-outline"
                  label="Skip this step"
                  onPress={() => void updateRoutine(() => service.skipRoutineStep(
                    activeRoutine.sessionId,
                    activeRoutine.currentStepIndex,
                  ))}
                />
                <RoutineActionButton
                  disabled={isSubmitting}
                  icon="pause"
                  label="Pause"
                  onPress={() => void updateRoutine(() => service.pauseRoutine(activeRoutine.sessionId))}
                />
                <RoutineActionButton
                  accessibilityLabel="Something feels wrong"
                  disabled={isSubmitting}
                  icon="alert-circle-outline"
                  label="Safety"
                  onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')}
                />
              </View>
            </View>
          )}
          key={`routine-step-${activeRoutine.currentStepIndex}`}
        >
          <View style={styles.routineProgressRow}>
            <Text style={styles.eyebrow}>STEP {activeRoutine.currentStepIndex + displayIndexOffset} OF {activeRoutine.totalStepCount}</Text>
            <View style={styles.areaBadge}>
              <Ionicons color={colors.accentDark} name="body-outline" size={layout.smallIconSize} />
              <Text style={styles.areaBadgeText}>{areaLabels[item.sourceArea]}</Text>
            </View>
          </View>
          {item.kind === 'movement' ? (
            <RoutineVideo accessibilityLabel={item.accessibleDescription} />
          ) : (
            <View style={styles.mediaPlaceholder} accessibilityLabel="Routine transition">
              <Ionicons color={colors.accentDark} name="arrow-forward-circle-outline" size={layout.heroIconSize} />
              <Text style={styles.mediaPlaceholderText}>NEXT MOVEMENT</Text>
            </View>
          )}
          <PageHeader eyebrow={activeRoutine.deliveredLevel.toUpperCase()} title={presentedTitle} />
          <Text style={styles.supporting}>{instruction}</Text>
          {dose === undefined ? null : (
            <View style={styles.routineTimerCard}>
              <View style={styles.routineTimerIcon}>
                <Ionicons color={colors.forest} name="timer-outline" size={layout.iconSize} />
              </View>
              <View style={styles.routineTimerContent}>
                <Text style={styles.routineTimerText}>
                  {routineTimerText(activeRoutine, dose)}
                </Text>
                <Text style={styles.cardBody}>
                  {dose.kind === 'timed'
                    ? `${dose.activeSeconds} seconds planned`
                    : `${dose.repetitionCount} repetitions`}
                </Text>
              </View>
            </View>
          )}
          {safetyCue === undefined ? null : <Text style={styles.safetyCue}>{safetyCue}</Text>}
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
      <Shell key={`feedback-${feedbackAreaIndex}`}>
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
      <Shell
        bottomBar={(
          <View style={styles.actionStack}>
            <PlanDurationSelector
              activeDuration={activePlan.duration}
              onSelect={(duration) => void revise(duration)}
            />
            <PrimaryButton
              icon="play"
              label="Begin routine"
              disabled={isSubmitting}
              onPress={() => void (async () => {
                const result = await submit(() => service.startRoutine(activePlan.decisionId));
                if (result?.ok) setScreen({ kind: 'routine', routine: result.value });
              })()}
            />
            <NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />
          </View>
        )}
        key="plan"
      >
        <PageHeader eyebrow="READY WHEN YOU ARE" title="Your plan for today" />
        <View style={styles.planHero}>
          <View style={styles.planHeroTopRow}>
            <View style={styles.planLevelIcon}>
              <Ionicons
                color={colors.forest}
                name={planLevelIcon(activePlan.deliveredLevel)}
                size={layout.iconSize}
              />
            </View>
            <View style={styles.planDurationBadge}>
              <Ionicons color={colors.accent} name="time-outline" size={layout.smallIconSize} />
              <Text style={styles.planDurationBadgeText}>{durationLabel(activePlan.duration)}</Text>
            </View>
          </View>
          <Text style={styles.planKicker}>YOUR ROUTINE LEVEL</Text>
          <Text style={styles.planLevel}>{levelLabel(activePlan.deliveredLevel)}</Text>
          <Text style={styles.planMeta}>
            {activePlan.itemCount} guided steps · {Math.round(activePlan.nominalSeconds / secondsPerMinute)} min
          </Text>
        </View>
        <View style={styles.planReasonCard}>
          <Text style={styles.cardTitle}>Why this routine</Text>
          <View style={styles.planReasonRow}>
            <Ionicons color={colors.accentDark} name="body-outline" size={layout.smallIconSize} />
            <Text style={styles.planReasonText}>
              Included today: {areaListLabel(activePlan.includedAreas)}.
            </Text>
          </View>
          {planExplanationLines(activePlan).map((line) => (
            <View key={line} style={styles.planReasonRow}>
              <Ionicons color={colors.accentDark} name="checkmark-circle-outline" size={layout.smallIconSize} />
              <Text style={styles.planReasonText}>{line}</Text>
            </View>
          ))}
          {activePlan.omittedSecondary === undefined ? null : (
            <View style={styles.planReasonRow}>
              <Ionicons color={colors.attentionInk} name="information-circle-outline" size={layout.smallIconSize} />
              <Text style={styles.planReasonText}>
                {omittedAreaExplanation(
                  activePlan.omittedSecondary.area,
                  activePlan.omittedSecondary.reason,
                )}
              </Text>
            </View>
          )}
        </View>
        {gentlerLevel === undefined ? null : (
          <SecondaryButton
            label={`Choose ${levelLabel(gentlerLevel)} instead`}
            onPress={() => void revise(activePlan.duration, gentlerLevel)}
          />
        )}
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
      </Shell>
    );
  }

  if (screen.kind === 'progress') {
    const hasHistory = screen.progress.areas.some(({ checkInCount }) => checkInCount > 0);
    return (
      <Shell
        bottomBar={<NavigationBar active="progress" onSelect={(tab) => void openTab(tab)} />}
        key="progress"
      >
        <PageHeader eyebrow="YOUR HISTORY" title="Progress without pressure" />
        <ConsistencyMeter
          current={screen.progress.weeklyParticipationDayCount}
          goal={screen.progress.weeklyGoalDays}
        />
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
      </Shell>
    );
  }

  if (screen.kind === 'progressArea') {
    const area = screen.progress.areas.find(({ area }) => area === screen.area);
    if (area === undefined) {
      return (
        <Shell key="progress-unavailable">
          <PageHeader eyebrow="PROGRESS" title="Area history unavailable" />
          <PrimaryButton
            label="Back to Progress"
            onPress={() => setScreen({ kind: 'progress', progress: screen.progress })}
          />
        </Shell>
      );
    }
    return (
      <Shell
        bottomBar={<NavigationBar active="progress" onSelect={(tab) => void openTab(tab)} />}
        key="progress-area"
      >
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
      </Shell>
    );
  }

  if (screen.kind === 'profileAreas') {
    const primary = selectedPrimaryArea ?? screen.profile.profile.primaryArea;
    const secondary = isSecondaryCleared
      ? undefined
      : selectedSecondaryArea ?? screen.profile.profile.secondaryArea;
    return (
      <Shell key="profile-areas">
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
      <Shell key="confirm-reset">
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
      <Shell key="confirm-delete">
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
      <Shell
        bottomBar={<NavigationBar active="profile" onSelect={(tab) => void openTab(tab)} />}
        key="profile"
      >
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
      </Shell>
    );
  }

  if (screen.kind === 'loading') {
    return (
      <Shell key="loading">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentDark} />
          <Text style={styles.supporting}>Preparing your private Kineo space…</Text>
        </View>
      </Shell>
    );
  }

  if (screen.kind === 'error') {
    return (
      <Shell key="error">
        <PageHeader eyebrow="LET'S TRY THAT AGAIN" title="Your data stayed put." />
        <Text style={styles.supporting}>{errorMessage(screen.error)}</Text>
        <PrimaryButton label="Retry" disabled={isSubmitting} onPress={() => void load()} />
      </Shell>
    );
  }

  if (screen.kind === 'ageConfirmation') {
    return (
      <Shell key="age-confirmation">
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
      <Shell key="age-unavailable">
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
      <Shell
        bottomBar={(
          <View style={styles.actionStack}>
            <PrimaryButton
              icon="arrow-forward"
              label="Get started"
              onPress={() => setScreen({ kind: 'ageConfirmation' })}
            />
          </View>
        )}
        key="welcome"
      >
        <View style={styles.welcomeHero}>
          <BrandMark inverse />
          <Text style={styles.welcomeEyebrow}>MOVE WITH TODAY IN MIND</Text>
          <Text accessibilityRole="header" style={styles.welcomeTitle}>
            A routine shaped around how you feel now.
          </Text>
          <Text style={styles.welcomeBody}>
            A short check-in guides a private, on-device movement routine for your neck and back.
          </Text>
          <HeroArtwork />
        </View>
        <View style={styles.infoPillRow}>
          <InfoPill icon="shield-checkmark-outline" label="Private by design" />
          <InfoPill icon="options-outline" label="No routine browsing" />
        </View>
        <Text style={styles.welcomeFootnote}>
          For adults managing recurring neck or back discomfort. Wellness guidance, not medical care.
        </Text>
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
      <Shell key="safety-boundary">
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
      <Shell key="first-check-in">
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
      <Shell
        bottomBar={<NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />}
        key="attention-required"
      >
        <PageHeader eyebrow="ATTENTION REQUIRED" title="Pause before another routine." />
        <Text style={styles.supporting}>
          Your earlier answer for {areaLabels[attentionPrompt.area].toLowerCase()} needs a fresh safety check before Kineo can continue.
        </Text>
        <PrimaryButton
          label="Review now"
          onPress={() => setScreen({ kind: 'attentionReturn', prompt: attentionPrompt })}
        />
      </Shell>
    );
  }

  if (screen.kind === 'attentionGuidance') {
    return (
      <Shell
        bottomBar={<NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />}
        key="attention-guidance"
      >
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
      </Shell>
    );
  }

  const primaryArea = screen.kind === 'start' && screen.state.kind === 'today'
    ? screen.state.primaryArea
    : undefined;
  return (
    <Shell
      bottomBar={<NavigationBar active="today" onSelect={(tab) => void openTab(tab)} />}
      key="today"
    >
      <View style={styles.todayTopRow}>
        <BrandMark />
        <View style={styles.areaBadge}>
          <Ionicons color={colors.accentDark} name="location-outline" size={layout.smallIconSize} />
          <Text style={styles.areaBadgeText}>{primaryArea ? areaLabels[primaryArea] : 'Kineo'}</Text>
        </View>
      </View>
      <View style={styles.todayIntro}>
        <Text style={styles.eyebrow}>TODAY</Text>
        <Text accessibilityRole="header" style={styles.todayTitle}>How are you moving?</Text>
        <Text style={styles.supporting}>Take a moment, then let today’s answers shape what comes next.</Text>
      </View>
      <View style={styles.todayCard}>
        <View style={styles.todayCardTopRow}>
          <View style={styles.todayCardIcon}>
            <Ionicons color={colors.forest} name="sparkles" size={layout.iconSize} />
          </View>
          <View style={styles.todayCardPill}>
            <Ionicons color={colors.accentDeep} name="time-outline" size={layout.smallIconSize} />
            <Text style={styles.todayCardPillText}>Brief check-in</Text>
          </View>
        </View>
        <Text style={styles.todayCardEyebrow}>YOUR NEXT ROUTINE</Text>
        <Text style={styles.todayCardTitle}>Start with how today feels.</Text>
        <Text style={styles.todayCardBody}>Short, focused, and shaped by your answers—not a library to search.</Text>
        <PrimaryButton
          disabled={isSubmitting}
          icon="arrow-forward"
          label="Check in"
          onPress={() => void startCheckIn()}
        />
      </View>
      <View style={styles.testSection}>
        <View style={styles.testHeading}>
          <Ionicons color={colors.secondaryInk} name="flask-outline" size={layout.smallIconSize} />
          <Text style={styles.testLabel}>INTERNAL TESTING</Text>
        </View>
        <SecondaryButton
          icon="refresh-outline"
          label="Reset demo to first use"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.deleteAllData());
            if (result?.ok || result?.error.code === 'persistence') {
              onStoreRestartRequired();
            }
          })()}
        />
      </View>
    </Shell>
  );
}

type KineoIconName = keyof typeof Ionicons.glyphMap;

function Shell({
  children,
  bottomBar,
}: Readonly<{
  children: ReactNode;
  bottomBar?: ReactNode;
}>) {
  const { fontScale } = useWindowDimensions();
  const shouldInlineBottomBar = bottomBar !== undefined &&
    fontScale > layout.fixedBottomBarMaximumFontScale;
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.readable}>
            {children}
            {shouldInlineBottomBar ? (
              <View style={styles.inlineBottomBar}>{bottomBar}</View>
            ) : null}
          </View>
        </ScrollView>
        {bottomBar === undefined || shouldInlineBottomBar ? null : (
          <View style={styles.bottomBar}>{bottomBar}</View>
        )}
      </View>
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

function BrandMark({ inverse = false }: Readonly<{ inverse?: boolean }>) {
  return (
    <View style={styles.brandMark}>
      <View style={[styles.brandGlyph, inverse && styles.brandGlyphInverse]}>
        <Ionicons
          color={inverse ? colors.forest : colors.accentDark}
          name="pulse"
          size={layout.smallIconSize}
        />
      </View>
      <Text style={[styles.brandName, inverse && styles.brandNameInverse]}>KINEO</Text>
    </View>
  );
}

function HeroArtwork() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.heroArtwork}
    >
      <View style={styles.heroPath} />
      <View style={[styles.heroPath, styles.heroPathTrailing]} />
      <View style={styles.heroOrb}>
        <View style={styles.heroOrbInner}>
          <Ionicons color={colors.forest} name="body-outline" size={layout.heroIconSize} />
        </View>
      </View>
      <View style={styles.heroFloatBadge}>
        <Ionicons color={colors.accentDeep} name="sparkles" size={layout.smallIconSize} />
        <Text style={styles.heroFloatBadgeText}>Shaped by today</Text>
      </View>
    </View>
  );
}

function InfoPill({ icon, label }: Readonly<{ icon: KineoIconName; label: string }>) {
  return (
    <View style={styles.infoPill}>
      <Ionicons color={colors.accentDeep} name={icon} size={layout.smallIconSize} />
      <Text style={styles.infoPillText}>{label}</Text>
    </View>
  );
}

function ConsistencyMeter({ current, goal }: Readonly<{ current: number; goal: number }>) {
  const days = Array.from({ length: goal }, (_, index) => index < current);
  return (
    <View
      accessibilityLabel={`${current} of ${goal} consistency days this week`}
      style={styles.consistencyMeter}
    >
      <View style={styles.metricHeader}>
        <View style={styles.metricIcon}>
          <Ionicons color={colors.forest} name="calendar-clear-outline" size={layout.iconSize} />
        </View>
        <Text style={styles.metricEyebrow}>THIS WEEK</Text>
      </View>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricValue}>{current}</Text>
        <Text style={styles.metricGoal}>of {goal} consistency days</Text>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.consistencyDots}
      >
        {days.map((isComplete, index) => (
          <View key={index} style={[styles.consistencyDot, isComplete && styles.consistencyDotComplete]} />
        ))}
      </View>
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
  const progressSegments = Array.from({ length: total }, (_, index) => index < current);
  return (
    <View accessibilityLabel={`Step ${current} of ${total}`} style={styles.progressHeader}>
      <Text style={styles.progress}>STEP {current} OF {total}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.progressTrack}>
        {progressSegments.map((isComplete, index) => (
          <View
            key={index}
            style={[styles.progressSegment, isComplete && styles.progressSegmentComplete]}
          />
        ))}
      </View>
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
    <Shell key={title}>
      <ProgressLabel current={progressCurrent} total={4} />
      <PageHeader eyebrow={eyebrow} title={title} />
      <Text style={styles.supporting}>{supporting}</Text>
      <View accessibilityRole="radiogroup" style={styles.optionList}>
        {options.map((area) => (
          <Pressable
            accessibilityLabel={areaLabels[area]}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected === area }}
            key={area}
            onPress={() => onSelect(area)}
            style={[styles.option, selected === area && styles.optionSelected]}
          >
            <View style={styles.optionContent}>
              <View style={[styles.optionIcon, selected === area && styles.optionIconSelected]}>
                <Ionicons
                  color={selected === area ? colors.inverseInk : colors.accentDark}
                  name="body-outline"
                  size={layout.iconSize}
                />
              </View>
              <Text style={[styles.optionText, selected === area && styles.optionTextSelected]}>{areaLabels[area]}</Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={selected === area ? colors.accentDark : colors.border}
              importantForAccessibility="no-hide-descendants"
              name={selected === area ? 'checkmark-circle' : 'ellipse-outline'}
              size={layout.iconSize}
            />
          </Pressable>
        ))}
      </View>
      <PrimaryButton label="Continue" onPress={onContinue} disabled={disabled} />
      {optionalLabel && onOptional ? <SecondaryButton label={optionalLabel} onPress={onOptional} /> : null}
    </Shell>
  );
}

function PrimaryButton({ label, onPress, disabled = false, icon }: Readonly<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: KineoIconName;
}>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, disabled && styles.buttonDisabled, pressed && styles.buttonPressed]}
    >
      <View style={styles.buttonContent}>
        {icon === undefined ? null : (
          <Ionicons color={colors.inverseInk} name={icon} size={layout.smallIconSize} />
        )}
        <Text style={styles.primaryButtonText}>{label}</Text>
      </View>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, disabled = false, danger = false, icon }: Readonly<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  icon?: KineoIconName;
}>) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        danger && styles.secondaryButtonDanger,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <View style={styles.buttonContent}>
        {icon === undefined ? null : (
          <Ionicons
            color={danger ? colors.danger : colors.accentDark}
            name={icon}
            size={layout.smallIconSize}
          />
        )}
        <Text style={[styles.secondaryButtonText, danger && styles.dangerText]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function ChoiceButton({ label, onPress }: Readonly<{ label: string; onPress: () => void }>) {
  const icon = choiceIcon(label);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.choiceButton, pressed && styles.choiceButtonPressed]}
    >
      <View style={styles.choiceContent}>
        <View style={styles.choiceIcon}>
          <Ionicons color={colors.accentDark} name={icon} size={layout.iconSize} />
        </View>
        <Text style={styles.choiceButtonText}>{label}</Text>
      </View>
      <Ionicons
        accessibilityElementsHidden
        color={colors.secondaryInk}
        importantForAccessibility="no-hide-descendants"
        name="chevron-forward"
        size={layout.smallIconSize}
      />
    </Pressable>
  );
}

function PlanDurationSelector({
  activeDuration,
  onSelect,
}: Readonly<{
  activeDuration: PlanPresentation['duration'];
  onSelect: (duration: PlanPresentation['duration']) => void;
}>) {
  return (
    <View style={styles.durationSelector}>
      <Text style={styles.sectionLabel}>CHOOSE A DURATION</Text>
      <View accessibilityRole="radiogroup" style={styles.segmentedControl}>
        {(['quick', 'standard'] as const).map((duration) => (
          <Pressable
            accessibilityLabel={durationLabel(duration)}
            accessibilityRole="radio"
            accessibilityState={{ checked: activeDuration === duration }}
            key={duration}
            onPress={() => onSelect(duration)}
            style={[
              styles.segment,
              activeDuration === duration && styles.segmentSelected,
            ]}
          >
            <Ionicons
              color={activeDuration === duration ? colors.accentDeep : colors.secondaryInk}
              name={duration === 'quick' ? 'flash-outline' : 'layers-outline'}
              size={layout.smallIconSize}
            />
            <Text style={styles.segmentText}>{durationLabel(duration)}</Text>
            {activeDuration === duration ? (
              <Ionicons
                accessibilityElementsHidden
                color={colors.accentDeep}
                importantForAccessibility="no-hide-descendants"
                name="checkmark-circle"
                size={layout.smallIconSize}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RoutineActionButton({
  accessibilityLabel,
  disabled = false,
  icon,
  label,
  onPress,
}: Readonly<{
  accessibilityLabel?: string;
  disabled?: boolean;
  icon: KineoIconName;
  label: string;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.routineAction,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Ionicons color={colors.accentDark} name={icon} size={layout.smallIconSize} />
      <Text style={styles.routineActionText}>{label}</Text>
    </Pressable>
  );
}

function choiceIcon(label: string): KineoIconName {
  switch (label) {
    case 'Better': return 'arrow-up-circle-outline';
    case 'Similar':
    case 'About the same': return 'remove-circle-outline';
    case 'Worse': return 'arrow-down-circle-outline';
    case 'Limited': return 'contract-outline';
    case 'Okay': return 'ellipse-outline';
    case 'Good': return 'sparkles-outline';
    case 'No': return 'checkmark-circle-outline';
    case 'Yes': return 'alert-circle-outline';
    case 'Not sure': return 'help-circle-outline';
    default: return 'arrow-forward-circle-outline';
  }
}

function NavigationBar({
  active,
  onSelect,
}: Readonly<{ active: MainTab; onSelect: (tab: MainTab) => void }>) {
  const tabs: readonly Readonly<{
    id: MainTab;
    label: string;
    icon: KineoIconName;
    selectedIcon: KineoIconName;
  }>[] = [
    { id: 'today', label: 'Today', icon: 'sparkles-outline', selectedIcon: 'sparkles' },
    { id: 'progress', label: 'Progress', icon: 'stats-chart-outline', selectedIcon: 'stats-chart' },
    { id: 'profile', label: 'Profile', icon: 'person-outline', selectedIcon: 'person' },
  ];
  return (
    <View accessibilityRole="tablist" style={styles.navigationBar}>
      {tabs.map((tab) => (
        <Pressable
          accessibilityLabel={tab.label}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.id }}
          key={tab.id}
          onPress={() => onSelect(tab.id)}
          style={({ pressed }) => [styles.navigationItem, pressed && styles.navigationItemPressed]}
        >
          <Ionicons
            color={active === tab.id ? colors.accentDark : colors.secondaryInk}
            name={active === tab.id ? tab.selectedIcon : tab.icon}
            size={layout.iconSize}
          />
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

function planLevelIcon(level: PlanPresentation['deliveredLevel']): KineoIconName {
  switch (level) {
    case 'gentle': return 'leaf-outline';
    case 'balanced': return 'scale-outline';
    case 'active': return 'flash-outline';
  }
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
  return plan.explanations.map(({ key, parameters }) => {
    const area = bodyAreas.find((candidate) => candidate === parameters.area);
    const areaLabel = area === undefined ? undefined : areaLabels[area];
    switch (key) {
      case 'reason.user_gentler_override':
        return 'You chose a gentler option for today.';
      case 'reason.reported_worse':
        return areaLabel === undefined
          ? 'You reported feeling worse than your usual pattern.'
          : `You reported ${areaLabel.toLowerCase()} felt worse than your usual pattern.`;
      case 'reason.movement_limited':
        return areaLabel === undefined
          ? 'Movement felt limited today.'
          : `Movement felt limited around ${areaLabel.toLowerCase()} today.`;
      case 'reason.better_good_active':
        return areaLabel === undefined
          ? 'You reported feeling better with good movement comfort.'
          : `${areaLabel} felt better with good movement comfort.`;
      case 'reason.balanced_checkin':
        return areaLabel === undefined
          ? 'Your check-in supports a Balanced option today.'
          : `Your ${areaLabel.toLowerCase()} check-in supports a Balanced option today.`;
      case 'reason.active_locked':
        return 'Active remains unavailable until enough qualifying history is recorded.';
      case 'reason.secondary_more_conservative':
        return areaLabel === undefined
          ? 'The more cautious area set today’s level.'
          : `${areaLabel} set today’s more cautious level.`;
      default:
        return 'Your saved check-in determined this plan.';
    }
  });
}

function areaListLabel(areas: readonly BodyArea[]): string {
  return areas.map((area) => areaLabels[area]).join(' and ');
}

function omittedAreaExplanation(
  area: BodyArea,
  reason: NonNullable<PlanPresentation['omittedSecondary']>['reason'],
): string {
  if (reason === 'secondaryUnanswered') {
    return `${areaLabels[area]} was skipped for today’s check-in and is not included.`;
  }
  return `${areaLabels[area]} is not included because compatible prototype content is unavailable.`;
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

const raisedSurfaceShadow = {
  elevation: layout.elevation,
  shadowColor: colors.shadow,
  shadowOffset: { height: layout.shadowOffsetY, width: 0 },
  shadowOpacity: layout.shadowOpacity,
  shadowRadius: layout.shadowRadius,
} as const;

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.canvas, flex: 1 },
  shell: { flex: 1 },
  page: { flexGrow: 1, paddingBottom: spacing.roomy, paddingHorizontal: spacing.screenHorizontal, paddingTop: spacing.screenVertical },
  readable: { alignSelf: 'center', flexGrow: 1, gap: spacing.large, maxWidth: layout.readableWidth, width: '100%' },
  bottomBar: { backgroundColor: colors.canvas, borderTopColor: colors.border, borderTopWidth: layout.borderWidth, paddingBottom: spacing.micro, paddingHorizontal: spacing.screenHorizontal, paddingTop: spacing.compact },
  inlineBottomBar: { borderTopColor: colors.border, borderTopWidth: layout.borderWidth, marginTop: spacing.standard, paddingTop: spacing.standard },
  actionStack: { gap: spacing.compact },
  centered: { alignItems: 'center', flex: 1, gap: spacing.standard, justifyContent: 'center' },
  header: { gap: spacing.compact },
  eyebrow: { color: colors.accentDark, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  progress: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  progressHeader: { gap: spacing.compact },
  progressTrack: { flexDirection: 'row', gap: spacing.micro },
  progressSegment: { backgroundColor: colors.mutedSurface, borderRadius: radius.status, flex: 1, height: spacing.micro },
  progressSegmentComplete: { backgroundColor: colors.accentDark },
  title: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight, lineHeight: typography.titleLineHeight },
  supporting: { color: colors.secondaryInk, fontSize: typography.bodySize, lineHeight: typography.bodyLineHeight },
  brandMark: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  brandGlyph: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.section, justifyContent: 'center', width: spacing.section },
  brandGlyphInverse: { backgroundColor: colors.accent },
  brandName: { color: colors.ink, fontSize: typography.detailSize, fontWeight: typography.displayWeight, letterSpacing: typography.eyebrowTracking },
  brandNameInverse: { color: colors.onDark },
  welcomeHero: { ...raisedSurfaceShadow, backgroundColor: colors.forest, borderRadius: radius.hero, gap: spacing.large, overflow: 'hidden', padding: spacing.roomy },
  welcomeEyebrow: { color: colors.accent, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  welcomeTitle: { color: colors.onDark, fontSize: typography.heroSize, fontWeight: typography.displayWeight, lineHeight: typography.heroLineHeight },
  welcomeBody: { color: colors.onDark, fontSize: typography.bodySize, lineHeight: typography.bodyLineHeight, opacity: layout.subtleOpacity },
  heroArtwork: { alignItems: 'center', height: layout.heroArtworkHeight, justifyContent: 'center', position: 'relative' },
  heroPath: { backgroundColor: colors.accent, borderRadius: radius.status, height: layout.heroPathHeight, position: 'absolute', transform: [{ rotate: layout.heroPathRotation }], width: layout.heroPathWidth },
  heroPathTrailing: { opacity: layout.subtleOpacity, transform: [{ rotate: layout.heroPathTrailingRotation }] },
  heroOrb: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: radius.status, height: layout.heroOrbSize, justifyContent: 'center', width: layout.heroOrbSize },
  heroOrbInner: { alignItems: 'center', backgroundColor: colors.onDark, borderRadius: radius.status, height: layout.heroOrbInnerSize, justifyContent: 'center', width: layout.heroOrbInnerSize },
  heroFloatBadge: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.status, bottom: spacing.compact, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact, position: 'absolute', right: spacing.micro },
  heroFloatBadgeText: { color: colors.accentDeep, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  infoPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  infoPill: { alignItems: 'center', backgroundColor: colors.elevatedSurface, borderColor: colors.border, borderRadius: radius.status, borderWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  infoPillText: { color: colors.accentDeep, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  welcomeFootnote: { color: colors.secondaryInk, fontSize: typography.captionSize, lineHeight: typography.captionLineHeight, textAlign: 'center' },
  primaryButton: { ...raisedSurfaceShadow, alignItems: 'center', backgroundColor: colors.accentDark, borderRadius: radius.button, justifyContent: 'center', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.roomy, paddingVertical: spacing.controlVertical },
  primaryButtonText: { color: colors.inverseInk, fontSize: typography.bodySize, fontWeight: typography.buttonWeight },
  secondaryButton: { alignItems: 'center', borderColor: colors.border, borderRadius: radius.button, borderWidth: layout.borderWidth, justifyContent: 'center', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.roomy, paddingVertical: spacing.controlVertical },
  secondaryButtonDanger: { borderColor: colors.danger },
  secondaryButtonText: { color: colors.accentDark, fontSize: typography.bodySize, fontWeight: typography.buttonWeight },
  dangerText: { color: colors.danger },
  buttonContent: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact, justifyContent: 'center' },
  buttonDisabled: { opacity: layout.disabledOpacity },
  buttonPressed: { opacity: layout.pressedOpacity },
  optionList: { gap: spacing.compact },
  choiceButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.option, borderWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.standard, justifyContent: 'space-between', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.standard, paddingVertical: spacing.controlVertical },
  choiceButtonPressed: { backgroundColor: colors.accentSoft, borderColor: colors.accentDark },
  choiceContent: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.standard },
  choiceIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  choiceButtonText: { color: colors.ink, flex: 1, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  option: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.option, borderWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.standard, justifyContent: 'space-between', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.standard, paddingVertical: spacing.controlVertical },
  optionSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accentDark, borderWidth: layout.selectedBorderWidth },
  optionContent: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.standard },
  optionIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  optionIconSelected: { backgroundColor: colors.accentDark },
  optionText: { color: colors.ink, flex: 1, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  optionTextSelected: { color: colors.accentDark },
  safetyCard: { backgroundColor: colors.attentionSurface, borderLeftColor: colors.attentionInk, borderLeftWidth: spacing.compact, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  cardTitle: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  cardBody: { color: colors.secondaryInk, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight },
  todayTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  todayIntro: { gap: spacing.compact },
  todayTitle: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight, lineHeight: typography.titleLineHeight },
  areaBadge: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.status, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  areaBadgeText: { color: colors.accentDark, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  todayCard: { ...raisedSurfaceShadow, backgroundColor: colors.accentSoft, borderRadius: radius.card, gap: spacing.standard, padding: spacing.roomy },
  todayCardTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  todayCardIcon: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: radius.icon, height: layout.controlMinimumHeight, justifyContent: 'center', width: layout.controlMinimumHeight },
  todayCardPill: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.status, flexDirection: 'row', gap: spacing.micro, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  todayCardPillText: { color: colors.accentDeep, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  todayCardEyebrow: { color: colors.accentDeep, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  todayCardTitle: { color: colors.ink, fontSize: typography.subtitleSize, fontWeight: typography.displayWeight, lineHeight: typography.subtitleLineHeight },
  todayCardBody: { color: colors.secondaryInk, fontSize: typography.bodySize, lineHeight: typography.bodyLineHeight },
  planHero: { ...raisedSurfaceShadow, backgroundColor: colors.accent, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  planHeroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  planLevelIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.icon, height: layout.controlMinimumHeight, justifyContent: 'center', width: layout.controlMinimumHeight },
  planDurationBadge: { alignItems: 'center', backgroundColor: colors.forest, borderRadius: radius.status, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  planDurationBadgeText: { color: colors.onDark, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  planKicker: { color: colors.accentDeep, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  planLevel: { color: colors.forest, fontSize: typography.titleSize, fontWeight: typography.displayWeight },
  planMeta: { color: colors.accentDeep, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight },
  planReasonCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.standard, padding: spacing.roomy },
  planReasonRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.standard },
  planReasonText: { color: colors.secondaryInk, flex: 1, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight },
  sectionLabel: { color: colors.accentDeep, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  durationSelector: { gap: spacing.micro },
  segmentedControl: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.button, borderWidth: layout.borderWidth, flexDirection: 'row', padding: spacing.compact },
  segment: { alignItems: 'center', borderRadius: radius.button, flex: 1, flexDirection: 'row', gap: spacing.compact, justifyContent: 'center', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.standard },
  segmentSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accentDark, borderWidth: layout.selectedBorderWidth },
  segmentText: { color: colors.accentDark, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  consistencyMeter: { ...raisedSurfaceShadow, backgroundColor: colors.forest, borderRadius: radius.card, gap: spacing.standard, padding: spacing.roomy },
  metricHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  metricIcon: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  metricEyebrow: { color: colors.accent, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  metricValueRow: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  metricValue: { color: colors.onDark, fontSize: typography.heroSize, fontWeight: typography.displayWeight, lineHeight: typography.heroLineHeight },
  metricGoal: { color: colors.onDark, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight, opacity: layout.subtleOpacity, paddingBottom: spacing.compact },
  consistencyDots: { flexDirection: 'row', gap: spacing.compact },
  consistencyDot: { backgroundColor: colors.mutedSurface, borderRadius: radius.status, flex: 1, height: spacing.compact, opacity: layout.subtleOpacity },
  consistencyDotComplete: { backgroundColor: colors.accent, opacity: 1 },
  historyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.compact, padding: spacing.roomy },
  routineProgressRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  routineActionRow: { flexDirection: 'row', gap: spacing.compact },
  routineAction: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.button, borderWidth: layout.borderWidth, flex: 1, gap: spacing.micro, justifyContent: 'center', minHeight: layout.controlMinimumHeight, padding: spacing.compact },
  routineActionText: { color: colors.accentDark, fontSize: typography.captionSize, fontWeight: typography.strongWeight, textAlign: 'center' },
  mediaPlaceholder: { ...raisedSurfaceShadow, alignItems: 'center', aspectRatio: layout.mediaAspectRatio, backgroundColor: colors.accentSoft, borderRadius: radius.card, justifyContent: 'center', overflow: 'hidden' },
  mediaPlaceholderText: { color: colors.accentDark, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  routineVideo: { height: '100%', width: '100%' },
  prototypeMediaBadge: { backgroundColor: colors.forest, borderRadius: radius.status, bottom: spacing.compact, left: spacing.compact, paddingHorizontal: spacing.compact, paddingVertical: spacing.compact, position: 'absolute' },
  prototypeMediaBadgeText: { color: colors.onDark, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  safetyCue: { backgroundColor: colors.attentionSurface, borderLeftColor: colors.attentionInk, borderLeftWidth: spacing.compact, borderRadius: radius.card, color: colors.attentionInk, fontSize: typography.detailSize, lineHeight: typography.detailLineHeight, padding: spacing.standard },
  routineTimerCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.standard, padding: spacing.standard },
  routineTimerIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  routineTimerContent: { flex: 1, gap: spacing.micro },
  routineTimerText: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  testSection: { borderTopColor: colors.border, borderTopWidth: layout.borderWidth, gap: spacing.compact, marginTop: spacing.section, paddingTop: spacing.standard },
  testHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  testLabel: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  navigationBar: { ...raisedSurfaceShadow, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, flexDirection: 'row', padding: spacing.compact },
  navigationItem: { alignItems: 'center', flex: 1, gap: spacing.micro, justifyContent: 'center', minHeight: layout.tabMinimumHeight },
  navigationItemPressed: { opacity: layout.pressedOpacity },
  navigationText: { color: colors.secondaryInk, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  navigationTextSelected: { color: colors.accentDark },
});
