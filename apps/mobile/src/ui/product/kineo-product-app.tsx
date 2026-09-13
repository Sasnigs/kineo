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
  TextInput,
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
  ProductResult,
  ProductStartState,
  RoutinePresentation,
} from '@/core/product/product-flow';
import type { AuthProvider } from '@/core/account/auth-module';
import { minimumPasswordCharacterCount } from '@/core/account/account-domain';
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
  | Readonly<{ kind: 'confirmExport'; profile: ProfilePresentation }>
  | Readonly<{ kind: 'changePassword'; profile: ProfilePresentation }>
  | Readonly<{ kind: 'confirmDelete'; profile: ProfilePresentation }>
  | Readonly<{ kind: 'confirmLogout'; profile: ProfilePresentation }>
  | Readonly<{
      kind: 'feedback';
      routine: RoutinePresentation;
      areaIndex: number;
      responses: Readonly<Partial<Record<BodyArea, AreaResponse>>>;
    }>;

type KineoProductAppProps = Readonly<{
  service: KineoProductServing;
  onStoreRestartRequired: () => void;
  accountActions?: Readonly<{
    provider: AuthProvider;
    resetHistory(password?: string): Promise<ProductResult<void>>;
    exportData(password?: string): Promise<ProductResult<void>>;
    changePassword(
      currentPassword: string,
      newPassword: string,
    ): Promise<ProductResult<void>>;
    deleteAccount(password?: string): Promise<ProductResult<void>>;
    logout(discardPendingChanges: boolean): Promise<ProductResult<void>>;
  }>;
}>;

type MainTab = 'today' | 'progress' | 'profile';

const areaLabels: Readonly<Record<BodyArea, string>> = Object.freeze({
  neck: 'Neck',
  upperMidBack: 'Upper & mid back',
  lowerBack: 'Lower back',
});

const minutesPerHour = 60;
const exportDownloadLifetimeMinutes = 15;
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
  if (error.code === 'onlineValidationRequired') {
    return 'Connect to the internet so Kineo can validate this check-in and create your plan.';
  }
  if (error.code === 'accountUnavailable') {
    return 'Your account session needs to be refreshed. Close and reopen Kineo.';
  }
  if (error.code === 'serverRejected') {
    return 'Kineo could not safely validate this plan. Review your answers and try again.';
  }
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
  accountActions,
}: KineoProductAppProps) {
  const [screen, setScreen] = useState<LocalScreen>({ kind: 'loading' });
  const [selectedPrimaryArea, setSelectedPrimaryArea] = useState<BodyArea>();
  const [selectedSecondaryArea, setSelectedSecondaryArea] = useState<BodyArea>();
  const [isSecondaryCleared, setIsSecondaryCleared] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [replacementPassword, setReplacementPassword] = useState('');
  const [replacementPasswordConfirmation, setReplacementPasswordConfirmation] = useState('');
  const submissionGate = useRef(createExclusiveActionGate());
  const [reminderReconciliationFailed, setReminderReconciliationFailed] = useState(false);
  const { fontScale } = useWindowDimensions();
  const usesAccessibleRowLayout = fontScale > layout.fixedBottomBarMaximumFontScale;

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
              </View>
            </View>
          )}
          persistentBottomBar={(
            <SecondaryButton
              disabled={isSubmitting}
              icon="alert-circle-outline"
              label="Something feels wrong"
              onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')}
            />
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
        <View style={styles.tabIntro}>
          <PageHeader eyebrow="YOUR HISTORY" title="Progress" />
          <Text style={styles.supporting}>A private view of your check-ins, routines, and responses.</Text>
        </View>
        <ConsistencyMeter
          current={screen.progress.weeklyParticipationDayCount}
          goal={screen.progress.weeklyGoalDays}
        />
        {!hasHistory ? (
          <View style={styles.emptyStateCard}>
            <View style={styles.emptyStateIcon}>
              <Ionicons color={colors.accentDark} name="time-outline" size={layout.iconSize} />
            </View>
            <Text style={styles.cardTitle}>Your patterns will appear here</Text>
            <Text style={styles.cardBody}>After your first check-in, you can revisit each area and routine here.</Text>
          </View>
        ) : (
          <>
            <View style={styles.tabSection}>
              <SectionHeading title="Your areas" detail="Check-ins by area" />
              <View style={styles.groupedList}>
                {screen.progress.areas.filter(({ checkInCount }) => checkInCount > 0).map((area) => (
                  <ListRow
                    key={area.area}
                    icon="body-outline"
                    label={areaLabels[area.area]}
                    value={`${area.checkInCount} ${area.checkInCount === 1 ? 'check-in' : 'check-ins'}`}
                    accessibilityLabel={`View ${areaLabels[area.area]} history`}
                    onPress={() => setScreen({
                      kind: 'progressArea',
                      progress: screen.progress,
                      area: area.area,
                    })}
                  />
                ))}
              </View>
            </View>
            {screen.progress.recentSessions.length > 0 ? (
              <View style={styles.tabSection}>
                <SectionHeading title="Recent sessions" />
                <View style={styles.groupedList}>
                  {screen.progress.recentSessions.map((session) => (
                    <ListRow
                      key={session.sessionId}
                      icon="walk-outline"
                      label={session.areas.map((area) => areaLabels[area]).join(' + ')}
                      subtitle={`${levelLabel(session.deliveredLevel)} · ${routineStatusLabel(session.status)}`}
                      value={localDayLabel(session.localDay)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
        {hasHistory ? (
          <Text style={styles.sectionFootnote}>
            {screen.progress.participationDayCount} participation {screen.progress.participationDayCount === 1 ? 'day' : 'days'} in total. Completed routines, intentional stops, and eligible Pause Today choices count equally.
          </Text>
        ) : null}
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
        <Pressable
          accessibilityLabel="Back to Progress"
          accessibilityRole="button"
          onPress={() => setScreen({ kind: 'progress', progress: screen.progress })}
          style={styles.backLink}
        >
          <Ionicons color={colors.accentDark} name="chevron-back" size={layout.smallIconSize} />
          <Text style={styles.backLinkText}>Progress</Text>
        </Pressable>
        <PageHeader eyebrow="AREA HISTORY" title={areaLabels[area.area]} />
        <View style={styles.groupedList}>
          <ListRow icon="calendar-outline" label="Participation choices" value={`${area.participationCount}`} />
          <ListRow icon="checkmark-circle-outline" label="Completed routines" value={`${area.completedRoutineCount}`} />
          <ListRow
            icon="chatbubble-outline"
            label="After-routine responses"
            subtitle={`${area.responses.better} better · ${area.responses.same} same · ${area.responses.worse} worse`}
          />
        </View>
        <Text style={styles.sectionFootnote}>
          {area.activeUnlocked ? 'Active option is available.' : 'Active option is not available yet.'}
        </Text>
        <SectionHeading title="Check-in history" />
        <View style={styles.groupedList}>
          {[...area.history].reverse().map((entry, index) => (
            <View key={`${entry.localDay}-${index}`} style={styles.areaHistoryEntry}>
              <Text style={styles.cardTitle}>{localDayLabel(entry.localDay)}</Text>
              <Text style={styles.cardBody}>
                {changeReportLabel(entry.changeReport)} · {movementComfortLabel(entry.movementComfort)}
              </Text>
              {entry.routine === undefined ? null : (
                <Text style={styles.cardBody}>
                  {levelLabel(entry.routine.deliveredLevel)} · {routineStatusLabel(entry.routine.status)} · {entry.routine.response === undefined ? 'No response' : displayValueLabel(entry.routine.response)}
                </Text>
              )}
            </View>
          ))}
        </View>
        <Text style={styles.sectionFootnote}>
          These events occurred in your history. Kineo does not claim that one caused another.
        </Text>
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
        {accountActions?.provider === 'email' ? (
          <TextInput
            autoComplete="current-password"
            onChangeText={setAccountPassword}
            placeholder="Confirm your password"
            placeholderTextColor={colors.secondaryInk}
            secureTextEntry
            style={styles.textInput}
            value={accountPassword}
          />
        ) : null}
        <SecondaryButton
          danger
          disabled={isSubmitting}
          label="Reset history"
          onPress={() => void (async () => {
            const result = await submit(() =>
              accountActions?.resetHistory(accountPassword) ??
              service.resetHistory()
            );
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

  if (screen.kind === 'confirmExport') {
    return (
      <Shell key="confirm-export">
        <PageHeader eyebrow="PRIVACY & DATA" title="Export your Kineo data?" />
        <Text style={styles.supporting}>
          Kineo will create a private JSON file and open the iPhone share sheet. The one-time server copy expires after {exportDownloadLifetimeMinutes} minutes.
        </Text>
        {accountActions?.provider === 'email' ? (
          <TextInput
            autoComplete="current-password"
            onChangeText={setAccountPassword}
            placeholder="Confirm your password"
            placeholderTextColor={colors.secondaryInk}
            secureTextEntry
            style={styles.textInput}
            value={accountPassword}
          />
        ) : null}
        <PrimaryButton
          disabled={isSubmitting}
          label="Create private export"
          onPress={() => void (async () => {
            const result = await submit(() =>
              accountActions?.exportData(accountPassword) ??
              Promise.resolve({ ok: false, error: { code: 'accountUnavailable' } })
            );
            if (result?.ok) {
              setAccountPassword('');
              setScreen({ kind: 'profile', profile: screen.profile });
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

  if (screen.kind === 'changePassword') {
    const passwordIsLongEnough =
      [...replacementPassword].length >= minimumPasswordCharacterCount;
    const passwordsMatch = replacementPassword === replacementPasswordConfirmation;
    return (
      <Shell key="change-password">
        <PageHeader eyebrow="ACCOUNT SECURITY" title="Change your password" />
        <Text style={styles.supporting}>
          Confirm your current password, then use at least {minimumPasswordCharacterCount} characters for the new one.
        </Text>
        <TextInput
          autoComplete="current-password"
          onChangeText={setAccountPassword}
          placeholder="Current password"
          placeholderTextColor={colors.secondaryInk}
          secureTextEntry
          style={styles.textInput}
          value={accountPassword}
        />
        <TextInput
          autoComplete="new-password"
          onChangeText={setReplacementPassword}
          placeholder="New password"
          placeholderTextColor={colors.secondaryInk}
          secureTextEntry
          style={styles.textInput}
          value={replacementPassword}
        />
        <TextInput
          autoComplete="new-password"
          onChangeText={setReplacementPasswordConfirmation}
          placeholder="Confirm new password"
          placeholderTextColor={colors.secondaryInk}
          secureTextEntry
          style={styles.textInput}
          value={replacementPasswordConfirmation}
        />
        {!passwordsMatch && replacementPasswordConfirmation.length > 0 ? (
          <Text accessibilityRole="alert" style={styles.safetyCue}>
            The passwords do not match.
          </Text>
        ) : null}
        <PrimaryButton
          disabled={
            isSubmitting ||
            accountPassword.length === 0 ||
            !passwordIsLongEnough ||
            !passwordsMatch
          }
          label="Update password"
          onPress={() => void (async () => {
            const result = await submit(() =>
              accountActions?.changePassword(
                accountPassword,
                replacementPassword,
              ) ?? Promise.resolve({
                ok: false,
                error: { code: 'accountUnavailable' },
              })
            );
            if (result?.ok) {
              setAccountPassword('');
              setReplacementPassword('');
              setReplacementPasswordConfirmation('');
              setScreen({ kind: 'profile', profile: screen.profile });
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
        {accountActions?.provider === 'email' ? (
          <TextInput
            autoComplete="current-password"
            onChangeText={setAccountPassword}
            placeholder="Confirm your password"
            placeholderTextColor={colors.secondaryInk}
            secureTextEntry
            style={styles.textInput}
            value={accountPassword}
          />
        ) : null}
        <SecondaryButton
          danger
          disabled={isSubmitting}
          label="Delete all data"
          onPress={() => void (async () => {
            const result = await submit(() =>
              accountActions?.deleteAccount(accountPassword) ??
              service.deleteAllData()
            );
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

  if (screen.kind === 'confirmLogout') {
    return (
      <Shell key="confirm-logout">
        <PageHeader eyebrow="ACCOUNT" title="Sign out of Kineo?" />
        <Text style={styles.supporting}>
          Kineo will first upload changes saved on this iPhone, revoke this installation, and remove its local data.
        </Text>
        <PrimaryButton
          disabled={isSubmitting}
          label="Sync and sign out"
          onPress={() => void (async () => {
            const result = await submit(() =>
              accountActions?.logout(false) ??
              Promise.resolve({ ok: false, error: { code: 'accountUnavailable' } })
            );
            if (result?.ok) onStoreRestartRequired();
          })()}
        />
        <SecondaryButton
          danger
          disabled={isSubmitting}
          label="Discard unsynced changes and sign out"
          onPress={() => void (async () => {
            const result = await submit(() =>
              accountActions?.logout(true) ??
              Promise.resolve({ ok: false, error: { code: 'accountUnavailable' } })
            );
            if (result?.ok) onStoreRestartRequired();
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
    const reminderIsOn = reminder?.enabled === true && (
      screen.profile.reminderAuthorization === 'authorized' ||
      screen.profile.reminderAuthorization === 'provisional'
    );
    const reminderStatusText = reminderIsOn
      ? 'One generic reminder is scheduled each day.'
      : screen.profile.reminderAuthorization === 'denied'
        ? 'Notifications are off in iPhone Settings. Kineo still works without them.'
        : screen.profile.reminderAuthorization === 'unavailable'
          ? 'Reminder settings are temporarily unavailable. Kineo still works without them.'
          : 'Optional. Kineo asks for notification access only after you choose a time.';
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
        <PageHeader eyebrow="YOUR SPACE" title="Profile" />
        <View style={styles.tabSection}>
          <SectionHeading title="Your routine" />
          <View style={styles.groupedList}>
            <ListRow
              icon="body-outline"
              label="Change areas"
              subtitle={profile.primaryArea === undefined ? 'No primary area yet' :
                [profile.primaryArea, profile.secondaryArea]
                  .filter((area): area is BodyArea => area !== undefined)
                  .map((area) => areaLabels[area]).join(' · ')}
              onPress={() => {
                setSelectedPrimaryArea(profile.primaryArea);
                setSelectedSecondaryArea(profile.secondaryArea);
                setIsSecondaryCleared(profile.secondaryArea === undefined);
                setScreen({ kind: 'profileAreas', profile: screen.profile });
              }}
            />
            <ListRow icon="calendar-outline" label="Weekly goal" value={`${profile.weeklyGoalDays} days`} />
          </View>
          <Text style={styles.sectionFootnote}>
            Check-ins choose the level. Quick or Standard changes duration only.
          </Text>
        </View>
        <View style={styles.tabSection}>
          <SectionHeading title="Reminders" />
          <View style={styles.groupedList}>
            <ListRow
              icon="notifications-outline"
              label="Daily reminder"
              value={reminderIsOn ? 'On' : 'Off'}
            />
            {screen.profile.reminderAuthorization === 'denied' ? (
              <ListRow icon="settings-outline" label="Open iPhone Settings" onPress={() => void submit(() => service.openReminderSettings())} />
            ) : null}
            {reminderIsOn ? (
              <ListRow
                icon="notifications-off-outline"
                label="Turn reminders off"
                disabled={isSubmitting}
                onPress={() => void (async () => {
                  const result = await submit(() => service.disableReminder());
                  if (result?.ok) setScreen({ kind: 'profile', profile: result.value });
                })()}
              />
            ) : screen.profile.reminderAuthorization === 'denied' ? null : (
              <>
                <ListRow icon="sunny-outline" label="Morning · 8:00 AM" onPress={() => void updateReminder(morningReminderWindow)} />
                <ListRow icon="moon-outline" label="Evening · 6:00 PM" onPress={() => void updateReminder(eveningReminderWindow)} />
              </>
            )}
          </View>
          <Text style={styles.sectionFootnote}>
            {reminderStatusText}
          </Text>
          {reminderReconciliationFailed ? (
            <Text style={styles.safetyCue}>
              Kineo could not reconcile reminders after returning to the app. Try again from Profile.
            </Text>
          ) : null}
        </View>
        <View style={styles.tabSection}>
          <SectionHeading title="Account & privacy" />
          <View style={styles.groupedList}>
            <ListRow icon="person-circle-outline" label="Sign-in method" value={accountActions?.provider ?? 'Local test profile'} />
            {accountActions?.provider === 'email' ? (
              <ListRow icon="key-outline" label="Change password" onPress={() => setScreen({ kind: 'changePassword', profile: screen.profile })} />
            ) : null}
            <ListRow icon="refresh-outline" label="Reset History" onPress={() => setScreen({ kind: 'confirmReset', profile: screen.profile })} />
            {accountActions === undefined ? null : (
              <>
                <ListRow icon="download-outline" label="Export my data" onPress={() => setScreen({ kind: 'confirmExport', profile: screen.profile })} />
                <ListRow icon="log-out-outline" label="Sign out" onPress={() => setScreen({ kind: 'confirmLogout', profile: screen.profile })} />
              </>
            )}
          </View>
          <Text style={styles.sectionFootnote}>
            Your history follows your account across signed-in devices. Reset keeps your profile and any current Attention gate.
          </Text>
          <View style={styles.destructiveGroup}>
            <ListRow danger icon="trash-outline" label="Delete All Data" onPress={() => setScreen({ kind: 'confirmDelete', profile: screen.profile })} />
          </View>
        </View>
        <View style={styles.tabSection}>
          <SectionHeading title="About Kineo" />
          <View style={styles.groupedList}>
            <ListRow icon="heart-outline" label="Health app context" subtitle="Disabled in this prototype. Health data does not select or change Kineo routines." />
            <ListRow icon="help-circle-outline" label="Safety and support" subtitle="General wellness movement planning; not diagnosis or treatment. Contact the Kineo product team for internal-test support." />
            <ListRow icon="information-circle-outline" label="App information" subtitle="Internal Expo prototype · telemetry off" />
          </View>
          <Text style={styles.sectionFootnote}>Prototype exercise media is not ready for public release.</Text>
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
      </View>
      <View style={styles.todayIntro}>
        <Text style={styles.eyebrow}>TODAY</Text>
        <Text accessibilityRole="header" maxFontSizeMultiplier={layout.displayMaximumFontScale} style={styles.todayTitle}>How are you moving?</Text>
        <Text style={styles.supporting}>Start with how you feel. Your answers guide what comes next.</Text>
      </View>
      <View style={styles.todayCard}>
        <View style={styles.todayCardTopRow}>
          <View style={styles.todayCardIcon}>
            <Ionicons color={colors.accentDark} name="body-outline" size={layout.iconSize} />
          </View>
          <Text style={styles.todayCardStepLabel}>FIRST STEP</Text>
        </View>
        <Text maxFontSizeMultiplier={layout.displayMaximumFontScale} style={styles.todayCardTitle}>Check in with yourself</Text>
        <Text style={styles.todayCardBody}>Tell Kineo what feels different today. Your answers decide what, if anything, comes next.</Text>
        <PrimaryButton
          disabled={isSubmitting}
          icon="arrow-forward"
          label="Check in"
          onPress={() => void startCheckIn()}
        />
      </View>
      {primaryArea === undefined ? null : (
        <View style={styles.todayAreaRow}>
          <Ionicons color={colors.accentDark} name="location-outline" size={layout.smallIconSize} />
          <View style={[styles.todayAreaContent, usesAccessibleRowLayout && styles.todayAreaContentAccessible]}>
            <Text style={styles.todayAreaText}>Your focus area</Text>
            <Text style={styles.todayAreaValue}>{areaLabels[primaryArea]}</Text>
          </View>
        </View>
      )}
    </Shell>
  );
}

type KineoIconName = keyof typeof Ionicons.glyphMap;

function Shell({
  children,
  bottomBar,
  persistentBottomBar,
}: Readonly<{
  children: ReactNode;
  bottomBar?: ReactNode;
  persistentBottomBar?: ReactNode;
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
        {(bottomBar === undefined || shouldInlineBottomBar) && persistentBottomBar === undefined ? null : (
          <View style={styles.bottomBar}>
            {shouldInlineBottomBar ? null : bottomBar}
            {persistentBottomBar}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function PageHeader({ eyebrow, title }: Readonly<{ eyebrow: string; title: string }>) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" maxFontSizeMultiplier={layout.displayMaximumFontScale} style={styles.title}>{title}</Text>
    </View>
  );
}

function SectionHeading({ title, detail }: Readonly<{ title: string; detail?: string }>) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.sectionHeading, fontScale > layout.fixedBottomBarMaximumFontScale && styles.sectionHeadingAccessible]}>
      <Text accessibilityRole="header" maxFontSizeMultiplier={layout.displayMaximumFontScale} style={styles.sectionHeadingText}>{title}</Text>
      {detail === undefined ? null : <Text style={styles.sectionHeadingDetail}>{detail}</Text>}
    </View>
  );
}

function ListRow({
  icon, label, subtitle, value, accessibilityLabel, danger = false, disabled = false, onPress,
}: Readonly<{
  icon: KineoIconName;
  label: string;
  subtitle?: string;
  value?: string;
  accessibilityLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}>) {
  const { fontScale } = useWindowDimensions();
  const usesAccessibleRowLayout = fontScale > layout.fixedBottomBarMaximumFontScale;
  const content = (
    <>
      <View style={[styles.listRowIcon, danger && styles.listRowIconDanger]}>
        <Ionicons color={danger ? colors.danger : colors.accentDark} name={icon} size={layout.iconSize} />
      </View>
      <View style={styles.listRowContent}>
        <Text style={[styles.listRowLabel, danger && styles.dangerText]}>{label}</Text>
        {subtitle === undefined ? null : <Text style={styles.listRowSubtitle}>{subtitle}</Text>}
        {usesAccessibleRowLayout && value !== undefined ? <Text style={styles.listRowValueAccessible}>{value}</Text> : null}
      </View>
      {value === undefined || usesAccessibleRowLayout ? null : <Text style={styles.listRowValue}>{value}</Text>}
      {onPress === undefined ? null : (
        <Ionicons
          accessibilityElementsHidden
          color={colors.secondaryInk}
          importantForAccessibility="no-hide-descendants"
          name="chevron-forward"
          size={layout.smallIconSize}
        />
      )}
    </>
  );
  if (onPress === undefined) return <View style={styles.listRow}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={[subtitle, value].filter((detail) => detail !== undefined).join(', ') || undefined}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, disabled && styles.buttonDisabled, pressed && styles.listRowPressed]}
    >
      {content}
    </Pressable>
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
      <Text maxFontSizeMultiplier={layout.displayMaximumFontScale} style={[styles.brandName, inverse && styles.brandNameInverse]}>KINEO</Text>
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
    <View accessibilityLabel={`${current} of ${goal} participation days this week`} style={styles.consistencyMeter}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricEyebrow}>THIS WEEK</Text>
        <Ionicons color={colors.accentDark} name="calendar-clear-outline" size={layout.iconSize} />
      </View>
      <View style={styles.metricValueRow}>
        <Text maxFontSizeMultiplier={layout.displayMaximumFontScale} style={styles.metricValue}>{current}</Text>
        <Text style={styles.metricGoal}>of {goal} days</Text>
      </View>
      <Text style={styles.metricCaption}>Days you took part</Text>
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
  const { fontScale } = useWindowDimensions();
  const usesAccessibleTabLayout = fontScale > layout.fixedBottomBarMaximumFontScale;
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
    <View accessibilityRole="tablist" style={[styles.navigationBar, usesAccessibleTabLayout && styles.navigationBarAccessible]}>
      {tabs.map((tab) => (
        <Pressable
          accessibilityLabel={tab.label}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.id }}
          key={tab.id}
          onPress={() => onSelect(tab.id)}
          style={({ pressed }) => [styles.navigationItem, usesAccessibleTabLayout && styles.navigationItemAccessible, pressed && styles.navigationItemPressed]}
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
const localDayDisplayTimeSuffix = 'T12:00:00';
const localDayFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function localDayLabel(localDay: string): string {
  const date = new Date(`${localDay}${localDayDisplayTimeSuffix}`);
  return Number.isNaN(date.getTime()) ? localDay : localDayFormatter.format(date);
}

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
  bottomBar: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: layout.borderWidth, gap: spacing.compact, paddingBottom: spacing.micro, paddingHorizontal: spacing.screenHorizontal, paddingTop: spacing.micro },
  inlineBottomBar: { borderTopColor: colors.border, borderTopWidth: layout.borderWidth, marginTop: spacing.standard, paddingTop: spacing.standard },
  actionStack: { gap: spacing.compact },
  centered: { alignItems: 'center', flex: 1, gap: spacing.standard, justifyContent: 'center' },
  header: { gap: spacing.compact },
  tabIntro: { gap: spacing.compact },
  tabSection: { gap: spacing.compact },
  sectionHeading: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, justifyContent: 'space-between' },
  sectionHeadingAccessible: { alignItems: 'flex-start', flexDirection: 'column' },
  sectionHeadingText: { color: colors.ink, fontSize: typography.subtitleSize, fontWeight: typography.strongWeight },
  sectionHeadingDetail: { color: colors.secondaryInk, fontSize: typography.captionSize },
  backLink: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.micro, minHeight: layout.controlMinimumHeight },
  backLinkText: { color: colors.accentDark, fontSize: typography.bodySize },
  sectionFootnote: { color: colors.secondaryInk, fontSize: typography.captionSize, paddingHorizontal: spacing.micro },
  groupedList: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.option, borderWidth: layout.borderWidth, overflow: 'hidden' },
  destructiveGroup: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.option, borderWidth: layout.borderWidth, marginTop: spacing.standard, overflow: 'hidden' },
  listRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.standard, minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  listRowPressed: { backgroundColor: colors.accentSoft },
  listRowIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  listRowIconDanger: { backgroundColor: colors.attentionSurface },
  listRowContent: { flex: 1, gap: spacing.micro },
  listRowLabel: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  listRowSubtitle: { color: colors.secondaryInk, fontSize: typography.captionSize },
  listRowValue: { color: colors.secondaryInk, fontSize: typography.detailSize, maxWidth: '42%', textAlign: 'right' },
  listRowValueAccessible: { color: colors.secondaryInk, fontSize: typography.detailSize },
  emptyStateCard: { alignItems: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.compact, padding: spacing.roomy },
  emptyStateIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  areaHistoryEntry: { backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: layout.borderWidth, gap: spacing.micro, paddingHorizontal: spacing.standard, paddingVertical: spacing.standard },
  eyebrow: { color: colors.accentDark, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  progress: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  progressHeader: { gap: spacing.compact },
  progressTrack: { flexDirection: 'row', gap: spacing.micro },
  progressSegment: { backgroundColor: colors.mutedSurface, borderRadius: radius.status, flex: 1, height: spacing.micro },
  progressSegmentComplete: { backgroundColor: colors.accentDark },
  title: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight },
  supporting: { color: colors.secondaryInk, fontSize: typography.bodySize },
  brandMark: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  brandGlyph: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.section, justifyContent: 'center', width: spacing.section },
  brandGlyphInverse: { backgroundColor: colors.accent },
  brandName: { color: colors.ink, fontSize: typography.detailSize, fontWeight: typography.displayWeight, letterSpacing: typography.eyebrowTracking },
  brandNameInverse: { color: colors.onDark },
  welcomeHero: { ...raisedSurfaceShadow, backgroundColor: colors.forest, borderRadius: radius.hero, gap: spacing.large, overflow: 'hidden', padding: spacing.roomy },
  welcomeEyebrow: { color: colors.accent, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  welcomeTitle: { color: colors.onDark, fontSize: typography.heroSize, fontWeight: typography.displayWeight },
  welcomeBody: { color: colors.onDark, fontSize: typography.bodySize, opacity: layout.subtleOpacity },
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
  welcomeFootnote: { color: colors.secondaryInk, fontSize: typography.captionSize, textAlign: 'center' },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.button,
    borderWidth: layout.borderWidth,
    color: colors.ink,
    fontSize: typography.bodySize,
    minHeight: layout.controlMinimumHeight,
    paddingHorizontal: spacing.standard,
  },
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
  cardBody: { color: colors.secondaryInk, fontSize: typography.detailSize },
  todayTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.compact },
  todayIntro: { gap: spacing.compact },
  todayTitle: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight },
  areaBadge: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.status, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  areaBadgeText: { color: colors.accentDark, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  todayCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.standard, padding: spacing.roomy },
  todayCardTopRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, justifyContent: 'space-between' },
  todayCardIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: layout.controlMinimumHeight, justifyContent: 'center', width: layout.controlMinimumHeight },
  todayCardStepLabel: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  todayCardTitle: { color: colors.ink, fontSize: typography.subtitleSize, fontWeight: typography.displayWeight },
  todayCardBody: { color: colors.secondaryInk, fontSize: typography.bodySize },
  todayAreaRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.micro, paddingVertical: spacing.standard },
  todayAreaContent: { flex: 1, flexDirection: 'row', gap: spacing.compact, justifyContent: 'space-between' },
  todayAreaContentAccessible: { flexDirection: 'column' },
  todayAreaText: { color: colors.secondaryInk, fontSize: typography.detailSize },
  todayAreaValue: { color: colors.ink, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  planHero: { ...raisedSurfaceShadow, backgroundColor: colors.accent, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  planHeroTopRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  planLevelIcon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.icon, height: layout.controlMinimumHeight, justifyContent: 'center', width: layout.controlMinimumHeight },
  planDurationBadge: { alignItems: 'center', backgroundColor: colors.forest, borderRadius: radius.status, flexDirection: 'row', gap: spacing.compact, paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  planDurationBadgeText: { color: colors.onDark, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  planKicker: { color: colors.accentDeep, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  planLevel: { color: colors.forest, fontSize: typography.titleSize, fontWeight: typography.displayWeight },
  planMeta: { color: colors.accentDeep, fontSize: typography.detailSize },
  planReasonCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.standard, padding: spacing.roomy },
  planReasonRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.standard },
  planReasonText: { color: colors.secondaryInk, flex: 1, fontSize: typography.detailSize },
  sectionLabel: { color: colors.accentDeep, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  durationSelector: { gap: spacing.micro },
  segmentedControl: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.button, borderWidth: layout.borderWidth, flexDirection: 'row', padding: spacing.compact },
  segment: { alignItems: 'center', borderRadius: radius.button, flex: 1, flexDirection: 'row', gap: spacing.compact, justifyContent: 'center', minHeight: layout.controlMinimumHeight, paddingHorizontal: spacing.standard },
  segmentSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accentDark, borderWidth: layout.selectedBorderWidth },
  segmentText: { color: colors.accentDark, fontSize: typography.detailSize, fontWeight: typography.strongWeight },
  consistencyMeter: { backgroundColor: colors.accentSoft, borderRadius: radius.card, gap: spacing.compact, padding: spacing.roomy },
  metricHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  metricEyebrow: { color: colors.accentDeep, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  metricValueRow: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  metricValue: { color: colors.ink, fontSize: typography.heroSize, fontWeight: typography.displayWeight },
  metricGoal: { color: colors.secondaryInk, fontSize: typography.detailSize, paddingBottom: spacing.compact },
  metricCaption: { color: colors.secondaryInk, fontSize: typography.detailSize },
  consistencyDots: { flexDirection: 'row', gap: spacing.compact },
  consistencyDot: { backgroundColor: colors.mutedSurface, borderRadius: radius.status, flex: 1, height: spacing.compact },
  consistencyDotComplete: { backgroundColor: colors.accentDark },
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
  safetyCue: { backgroundColor: colors.attentionSurface, borderLeftColor: colors.attentionInk, borderLeftWidth: spacing.compact, borderRadius: radius.card, color: colors.attentionInk, fontSize: typography.detailSize, padding: spacing.standard },
  routineTimerCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, borderWidth: layout.borderWidth, flexDirection: 'row', gap: spacing.standard, padding: spacing.standard },
  routineTimerIcon: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.icon, height: spacing.hero, justifyContent: 'center', width: spacing.hero },
  routineTimerContent: { flex: 1, gap: spacing.micro },
  routineTimerText: { color: colors.ink, fontSize: typography.bodySize, fontWeight: typography.strongWeight },
  testSection: { borderTopColor: colors.border, borderTopWidth: layout.borderWidth, gap: spacing.compact, marginTop: spacing.section, paddingTop: spacing.standard },
  testHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.compact },
  testLabel: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  navigationBar: { backgroundColor: colors.surface, flexDirection: 'row' },
  navigationBarAccessible: { flexDirection: 'column' },
  navigationItem: { alignItems: 'center', flex: 1, gap: spacing.micro, justifyContent: 'center', minHeight: layout.tabMinimumHeight },
  navigationItemAccessible: { flex: 0, flexDirection: 'row', gap: spacing.standard, justifyContent: 'flex-start', paddingHorizontal: spacing.standard, paddingVertical: spacing.compact },
  navigationItemPressed: { opacity: layout.pressedOpacity },
  navigationText: { color: colors.secondaryInk, fontSize: typography.captionSize, fontWeight: typography.strongWeight },
  navigationTextSelected: { color: colors.accentDark },
});
