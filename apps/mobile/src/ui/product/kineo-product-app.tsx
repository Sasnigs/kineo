import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
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
  layout,
  radius,
  spacing,
  v11Colors, v11Layout, v11Typography,
} from '@/ui/theme/tokens';

import {
  V11AreaEmblem, V11BrandMark, V11PageHeader, V11ProgressPill, V11Shell,
  V11PrimaryButton, V11SecondaryButton, V11ChoiceRow, V11NoticeCard, V11Emblem,
  V11WelcomeArtwork, V11InlineTextAction, V11ListRow, V11FloatingTabBar, V11SegmentedControl, V11SafetyButton, V11DestructiveButton, useV11ReducedMotion,
} from '../primitives/kineo-v11-primitives';

import { V11RoutineMediaFrame, V11RoutineTransition, V11RoutinePacing } from '../primitives/kineo-v11-routine';

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

const areaDescriptions: Readonly<Record<BodyArea, string>> = {
  neck: 'Cervical comfort & gentle rotation',
  upperMidBack: 'Thoracic posture & shoulder blades',
  lowerBack: 'Lumbar support & easy hinge',
};
const onboardingSteps = { age: 1, primaryArea: 2, secondaryArea: 3, safetyBoundary: 4 } as const;
const checkInSteps = { change: 1, comfort: 2 } as const;
const onboardingStepCount = onboardingSteps.safetyBoundary;
const checkInStepCount = 2;
const durationOptions = [{ value: 'quick', label: 'Quick' }, { value: 'standard', label: 'Standard' }] as const;
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
  const usesLargeTextLayout = fontScale > layout.fixedBottomBarMaximumFontScale;

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
        <V11Shell key={`${activeCheckIn.currentArea}-change`}>
          <V11ProgressPill current={checkInSteps.change} total={checkInStepCount} />
          <V11PageHeader context={areaName} title="Compared with your usual pattern…" />
          <Text style={styles.supporting}>Choose the closest answer for right now.</Text>
          <V11ActionChoice label="Better" onPress={() => setScreen({ ...activeCheckIn, stage: 'comfort', changeReport: 'better' })} />
          <V11ActionChoice label="Similar" onPress={() => setScreen({ ...activeCheckIn, stage: 'comfort', changeReport: 'similar' })} />
          <V11ActionChoice label="Worse" onPress={() => setScreen({ ...activeCheckIn, stage: 'comfort', changeReport: 'worse' })} />
          {activeCheckIn.currentArea === activeCheckIn.draft.secondaryArea ? (
            <V11SecondaryButton
              label="Skip this area today"
              onPress={() => void submitCompletedAnswers(
                activeCheckIn.draft,
                activeCheckIn.answers,
                activeCheckIn.correctionDraft,
              )}
            />
          ) : null}
        </V11Shell>
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
        <V11Shell key={`${activeCheckIn.currentArea}-comfort`}>
          <V11ProgressPill current={checkInSteps.comfort} total={checkInStepCount} />
          <V11PageHeader context={areaName} title="How does movement feel?" />
          <V11ActionChoice label="Limited" onPress={() => selectComfort('limited')} />
          <V11ActionChoice label="Okay" onPress={() => selectComfort('okay')} />
          <V11ActionChoice label="Good" onPress={() => selectComfort('good')} />
        </V11Shell>
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
      <V11Shell key={`${activeCheckIn.currentArea}-safety`}>
        <V11Emblem caution />
        <V11PageHeader context="One safety check" title="Is this new, sudden, or unusual for you?" />
        <Text style={styles.supporting}>Your answer may pause Kineo routines so you can decide what support you need.</Text>
        <V11ActionChoice label="No" onPress={() => answerSafety('no')} />
        <V11ActionChoice label="Yes" onPress={() => answerSafety('yes')} />
        <V11ActionChoice label="Not sure" onPress={() => answerSafety('notSure')} />
        <V11SecondaryButton
          label="I selected that by mistake"
          onPress={() => setScreen({
            ...activeCheckIn,
            stage: 'change',
            changeReport: undefined,
            movementComfort: undefined,
          })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'alternativePreview') {
    return (
      <V11Shell key="alternative-preview">
        <V11AreaEmblem area={screen.routine.currentItem?.sourceArea ?? screen.routine.primaryArea} />
        <V11PageHeader context="Alternative" title={screen.alternative.localizedTitle} />
        <View style={styles.v11PlanFocal}><Text style={styles.v11Body}>{screen.alternative.localizedInstruction}</Text></View>
        <V11NoticeCard tone="caution" message={screen.alternative.localizedSafetyCue} />
        <V11PrimaryButton
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
        <V11SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'routine', routine: screen.routine })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'endConfirmation') {
    return (
      <V11Shell key="end-confirmation">
        <V11Emblem caution />
        <V11PageHeader context="End routine" title="End this routine now?" />
        <Text style={styles.supporting}>Your intentional stop will remain in Progress as participation.</Text>
        <V11DestructiveButton
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
        <V11SecondaryButton
          label={screen.routine.status === 'prepared'
            ? 'Keep routine ready'
            : 'Keep routine paused'}
          onPress={() => setScreen({ kind: 'routine', routine: screen.routine })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'safetyGuidance') {
    return (
      <V11Shell key="safety-guidance">
        <V11Emblem caution />
        <V11PageHeader context="Pause and check in" title="Stop if something feels wrong." />
        <V11NoticeCard tone="caution" title="When to seek care"
          message="Kineo cannot assess a new or concerning change. End the routine and seek appropriate professional support if needed." />
        <V11PrimaryButton
          label="End routine"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.endRoutine(
              screen.routine.sessionId,
              'safety',
            ));
            if (result?.ok) {
              if (result.value.status === 'abandoned') await load();
              else setScreen({ kind: 'routine', routine: result.value });
            }
          })()}
        />
        <V11SecondaryButton
          label="I tapped this by mistake"
          onPress={() => setScreen({ kind: 'routine', routine: screen.routine })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'completion') {
    return (
      <V11Shell key="completion" bottomBar={<View style={styles.v11ActionInset}>
        <V11PrimaryButton label="Done" onPress={() => void load()} />
        <V11SecondaryButton label="Start another check-in" onPress={() => void startCheckIn()} />
      </View>}>
        <V11BrandMark />
        <V11Emblem caution={false} />
        <V11PageHeader context="Routine saved" title="You made a choice for today." />
        <View style={styles.v11PlanFocal}>
          <Text style={styles.v11FocalTitle}>{levelLabel(screen.routine.deliveredLevel)} · {durationLabel(screen.routine.duration)}</Text>
          <Text style={styles.v11Body}>{screen.routine.includedAreas.map(area => areaLabels[area]).join(' · ')}</Text>
          <Text style={styles.v11Meta}>{screen.routine.status === 'completed' || screen.routine.status === 'stopped'
            ? "Today's participation: Recorded" : 'Routine record: Saved'}</Text>
        </View>
      </V11Shell>
    );
  }

  if (screen.kind === 'attentionReturn') {
    const respond = async (answer: 'yes' | 'no' | 'notSure') => {
      const result = await submit(() => service.respondToAttentionReturn(screen.prompt, answer));
      if (result?.ok) setScreen(screenForAttentionResolution(result.value));
    };
    return (
      <V11Shell key="attention-return">
        <V11Emblem caution />
        <V11PageHeader
          context="Attention check"
          title={`Has ${areaLabels[screen.prompt.area].toLowerCase()} returned to its usual pattern?`}
        />
        <V11NoticeCard tone="caution" message="Kineo will keep routines paused unless you answer yes." />
        <V11ActionChoice label="Yes" onPress={() => void respond('yes')} />
        <V11ActionChoice label="No" onPress={() => void respond('no')} />
        <V11ActionChoice label="Not sure" onPress={() => void respond('notSure')} />
        <V11SecondaryButton
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
      </V11Shell>
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
        <V11Shell key="routine-prepared">
          <V11Emblem />
          <V11PageHeader context="Routine ready" title="Begin when you’re ready." />
          <View style={styles.v11PlanFocal}>
            <Text style={styles.v11SectionTitle}>{levelLabel(activeRoutine.deliveredLevel)} · {durationLabel(activeRoutine.duration)}</Text>
            <Text style={styles.v11Body}>Kineo did not start this routine while the app was interrupted.</Text>
          </View>
          <V11PrimaryButton
            label="Begin routine"
            disabled={isSubmitting}
            onPress={() => void updateRoutine(() => service.startRoutine(activeRoutine.decisionId))}
          />
          <V11SecondaryButton
            label="End routine"
            onPress={() => setScreen({ kind: 'endConfirmation', routine: activeRoutine })}
          />
          <V11SafetyButton label="Something feels wrong" onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')} />
        </V11Shell>
      );
    }
    if (activeRoutine.status === 'paused') {
      return (
        <V11Shell key="routine-paused">
          <V11Emblem />
          <V11PageHeader context="Routine paused" title="Your place is saved." />
          <View style={styles.v11PlanFocal}>
            <Text style={styles.v11SectionTitle}>{levelLabel(activeRoutine.deliveredLevel)} · {durationLabel(activeRoutine.duration)}</Text>
            <Text style={styles.v11Body}>Resume when you’re ready. Kineo won’t infer progress while paused.</Text>
          </View>
          <V11PrimaryButton
            label="Resume routine"
            disabled={isSubmitting}
            onPress={() => void updateRoutine(() => service.resumeRoutine(activeRoutine.sessionId))}
          />
          <V11SecondaryButton
            label="End routine"
            onPress={() => void pauseForRoutineMenu(activeRoutine, 'end')}
          />
          <V11SafetyButton
            label="Something feels wrong"
            onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')}
          />
        </V11Shell>
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
      const timed = dose?.kind === 'timed' ? dose : undefined;
      const canAdvance = routineStepCanAdvance(activeRoutine, dose);
      const remaining = timed ? routineRemainingSeconds(activeRoutine, timed) : undefined;
      const completedStep = timed !== undefined && canAdvance;
      const transitionStep = item.kind !== 'movement';
      const controls = <View style={[styles.v11RoutineActions, usesLargeTextLayout && styles.v11RoutineActionsStacked]}>
        {transitionStep || availableAlternative === undefined ? null : <V11SecondaryButton
          accessibilityLabel="Try an alternative" label="Alternative" disabled={isSubmitting}
          style={[styles.v11RoutineAction, usesLargeTextLayout && styles.v11RoutineActionStacked]}
          onPress={() => void (async () => {
            const paused = await submit(() => service.pauseRoutine(activeRoutine.sessionId));
            if (paused?.ok) setScreen({ kind: 'alternativePreview', routine: paused.value, alternative: availableAlternative });
          })()} />}
        {completedStep || transitionStep ? <V11SecondaryButton label="End routine" disabled={isSubmitting}
          style={[styles.v11RoutineAction, usesLargeTextLayout && styles.v11RoutineActionStacked]}
          onPress={() => void pauseForRoutineMenu(activeRoutine, 'end')} /> : <>
          <V11SecondaryButton label="Skip this step" disabled={isSubmitting} style={[styles.v11RoutineAction, usesLargeTextLayout && styles.v11RoutineActionStacked]}
            onPress={() => void updateRoutine(() => service.skipRoutineStep(activeRoutine.sessionId, activeRoutine.currentStepIndex))} />
          <V11SecondaryButton label="Pause" disabled={isSubmitting} style={[styles.v11RoutineAction, usesLargeTextLayout && styles.v11RoutineActionStacked]}
            onPress={() => void updateRoutine(() => service.pauseRoutine(activeRoutine.sessionId))} />
        </>}
      </View>;
      return (
        <V11Shell key={`routine-step-${activeRoutine.currentStepIndex}`}
          bottomBar={<View style={styles.v11ActionInset}>
            <V11PrimaryButton label="Continue" disabled={isSubmitting || !canAdvance}
              onPress={() => void updateRoutine(() => service.advanceRoutine(activeRoutine.sessionId, activeRoutine.currentStepIndex))} />
          </View>}
          persistentBottomBar={<View style={styles.v11ActionInset}>
            <V11SafetyButton disabled={isSubmitting} label="Something feels wrong"
              onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')} />
          </View>}>
          <V11PageHeader context={`${areaLabels[item.sourceArea]} · ${levelLabel(activeRoutine.deliveredLevel)} · Step ${activeRoutine.currentStepIndex + displayIndexOffset} of ${activeRoutine.totalStepCount}`}
            title={presentedTitle} />
          {item.kind === 'movement' ? <RoutineVideo accessibilityLabel={alternative?.accessibleDescription ?? item.accessibleDescription} />
            : <V11RoutineTransition area={item.sourceArea} />}
          <Text style={styles.v11Body}>{instruction}</Text>
          <V11RoutinePacing key={`${item.itemId}-${alternative?.movementId ?? 'original'}`}
            mode={transitionStep ? 'transition' : completedStep ? 'complete' : timed ? 'counting' : 'repetitions'}
            remainingSeconds={remaining} totalSeconds={timed?.activeSeconds}
            statusLabel={transitionStep ? 'Next step ready' : completedStep ? 'Step complete'
              : dose ? `${routineTimerText(activeRoutine, dose)} · ${dose.kind === 'timed' ? `${dose.activeSeconds} seconds planned` : `${dose.repetitionCount} repetitions`}` : 'Movement ready'}
            guidance={transitionStep ? 'Take a short transition before your next movement.' : canAdvance
              ? 'Continue when you choose.' : 'Take your time. Continue when the timer ends.'}
            controls={controls} />
          {safetyCue === undefined ? null : <V11NoticeCard tone="caution" message={safetyCue} />}
        </V11Shell>
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
      <V11Shell key={`feedback-${feedbackAreaIndex}`}>
        <V11PageHeader
          context="Optional response"
          title={feedbackArea === undefined
            ? 'Your routine is saved.'
            : `How did ${areaLabels[feedbackArea].toLowerCase()} feel afterward?`}
        />
        <Text style={styles.supporting}>This helps Kineo interpret your own history. It does not measure recovery.</Text>
        <V11ActionChoice label="Better" onPress={() => void finishFeedback('better')} />
        <V11ActionChoice label="About the same" onPress={() => void finishFeedback('same')} />
        <V11ActionChoice label="Worse" onPress={() => void finishFeedback('worse')} />
        <V11SecondaryButton label="Skip response" onPress={() => void finishFeedback()} />
      </V11Shell>
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
      <V11Shell key="plan" bottomBar={
        <View style={styles.v11PlanFooter}>
          <View style={styles.v11ActionInset}>
            <V11PrimaryButton label="Begin routine" disabled={isSubmitting}
              onPress={() => void (async () => {
                const result = await submit(() => service.startRoutine(activePlan.decisionId));
                if (result?.ok) setScreen({ kind: 'routine', routine: result.value });
              })()} />
          </View>
          <V11FloatingTabBar active="today" onSelect={(tab) => void openTab(tab)} />
        </View>
      }>
        <V11PageHeader context="Ready when you are" title="Your plan for today" />
        <View style={styles.v11PlanFocal}>
          <View style={styles.v11FocalTop}>
            <V11AreaEmblem areas={activePlan.includedAreas} />
            <Text style={styles.v11LevelBadge}>{levelLabel(activePlan.deliveredLevel)}</Text>
          </View>
          <Text style={styles.v11FocalTitle}>{levelLabel(activePlan.deliveredLevel)} routine</Text>
          <Text style={styles.v11Meta}>
            {activePlan.itemCount} guided steps · {Math.round(activePlan.nominalSeconds / secondsPerMinute)} min
          </Text>
          <View style={styles.v11PlanReason}>
            <Text style={styles.v11SectionTitle}>Why this routine</Text>
            <Text style={styles.v11Body}>Included today: {areaListLabel(activePlan.includedAreas)}.</Text>
            {planExplanationLines(activePlan).map(line => <Text key={line} style={styles.v11Body}>{line}</Text>)}
          </View>
        </View>
        {activePlan.omittedSecondary === undefined ? null : <V11NoticeCard message={
          omittedAreaExplanation(activePlan.omittedSecondary.area, activePlan.omittedSecondary.reason)
        } />}
        <PlanDurationSelector activeDuration={activePlan.duration} disabled={isSubmitting}
          onSelect={duration => void revise(duration)} />
        <PlanSequence plan={activePlan} />
        {gentlerLevel === undefined ? null : <V11SecondaryButton
          label={`Choose ${levelLabel(gentlerLevel)} instead`} disabled={isSubmitting}
          onPress={() => void revise(activePlan.duration, gentlerLevel)} />}
        {activePlan.pauseTodayAvailable ? <V11SecondaryButton label="Pause Today" disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.pauseToday(activePlan.checkInId));
            if (result?.ok) setScreen({ kind: 'start', state: { kind: 'today', primaryArea: result.value } });
          })()} /> : null}
      </V11Shell>
    );
  }

  if (screen.kind === 'progress') {
    const hasHistory = screen.progress.areas.some(({ checkInCount }) => checkInCount > 0);
    return (
      <V11Shell
        bottomBar={<V11FloatingTabBar active="progress" onSelect={(tab) => void openTab(tab)} />}
        key="progress"
      >
        <V11BrandMark context="Your history" />
        <V11PageHeader context="Your history" title="Progress"
          lead="A private view of your check-ins, routines, and responses." />
        <ConsistencyMeter
          current={screen.progress.weeklyParticipationDayCount}
          goal={screen.progress.weeklyGoalDays}
        />
        {!hasHistory ? (
          <View style={styles.emptyStateCard}>
            <V11Emblem />
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
                    leading={<V11AreaEmblem area={area.area} />}
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
                      leading={<V11AreaEmblem areas={session.areas} />}
                      label={areaListLabel(session.areas)}
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
      </V11Shell>
    );
  }

  if (screen.kind === 'progressArea') {
    const area = screen.progress.areas.find(({ area }) => area === screen.area);
    if (area === undefined) {
      return (
        <V11Shell key="progress-unavailable" bottomBar={<V11FloatingTabBar active="progress" onSelect={(tab) => void openTab(tab)} />}>
          <V11Emblem />
          <V11PageHeader context="Progress" title="Area history unavailable" />
          <V11PrimaryButton
            label="Back to Progress"
            onPress={() => setScreen({ kind: 'progress', progress: screen.progress })}
          />
        </V11Shell>
      );
    }
    return (
      <V11Shell
        bottomBar={<V11FloatingTabBar active="progress" onSelect={(tab) => void openTab(tab)} />}
        key="progress-area"
      >
        <V11InlineTextAction label="Back to Progress"
          onPress={() => setScreen({ kind: 'progress', progress: screen.progress })} />
        <V11AreaEmblem area={area.area} />
        <V11PageHeader context="Area history" title={areaLabels[area.area]} />
        <View style={styles.historySummary}>
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
      </V11Shell>
    );
  }

  if (screen.kind === 'profileAreas') {
    const primary = selectedPrimaryArea ?? screen.profile.profile.primaryArea;
    const secondary = isSecondaryCleared
      ? undefined
      : selectedSecondaryArea ?? screen.profile.profile.secondaryArea;
    return (
      <V11Shell key="profile-areas">
        <V11PageHeader context="Profile" title="Choose your areas" />
        <SectionHeading title="Primary area" />
        <View accessible={false} testID="primary-area-options" accessibilityRole="radiogroup" accessibilityLabel="Primary area" style={styles.optionList}>
        {bodyAreas.map((area) => (
          <V11ChoiceRow key={area} title={areaLabels[area]} accessibilityLabel={areaLabels[area]}
            accessibilityHint="Primary area" leading={<V11AreaEmblem area={area} />} selected={primary === area} disabled={isSubmitting} onPress={() => {
            setSelectedPrimaryArea(area);
            setIsSecondaryCleared(secondary === undefined || secondary === area);
            setSelectedSecondaryArea(secondary === area ? undefined : secondary);
          }} />
        ))}
        </View>
        <SectionHeading title="Optional second area" />
        <View accessible={false} testID="secondary-area-options" accessibilityRole="radiogroup" accessibilityLabel="Optional second area" style={styles.optionList}>
        {bodyAreas.filter((area) => area !== primary).map((area) => (
          <V11ChoiceRow key={area} title={areaLabels[area]} accessibilityLabel={areaLabels[area]}
            accessibilityHint="Optional second area" leading={<V11AreaEmblem area={area} />} selected={secondary === area} disabled={isSubmitting} onPress={() => {
            setIsSecondaryCleared(false);
            setSelectedSecondaryArea(area);
          }} />
        ))}
        </View>
        <V11SecondaryButton label="No second area" disabled={isSubmitting} onPress={() => {
          setIsSecondaryCleared(true);
          setSelectedSecondaryArea(undefined);
        }} />
        <V11PrimaryButton
          label="Save areas"
          disabled={primary === undefined || isSubmitting}
          onPress={() => void (async () => {
            if (primary === undefined) return;
            const result = await submit(() => service.saveAreaPreferences(primary, secondary));
            if (result?.ok) setScreen({ kind: 'profile', profile: result.value });
          })()}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'confirmReset') {
    return (
      <V11Shell key="confirm-reset">
        <V11Emblem caution />
        <V11PageHeader context="Privacy & data" title="Reset history?" />
        <Text style={styles.supporting}>
          This removes check-ins, plans, routines, feedback, and Progress history.
        </Text>
        <V11NoticeCard tone="caution" title="Safety exception"
          message="Any current Attention Required area remains so Reset cannot bypass it. Your areas and reminder preference also remain." />
        {accountActions?.provider === 'email' ? (
          <V11PasswordField
            autoComplete="current-password"
            onChangeText={setAccountPassword}
            label="Confirm your password"
            value={accountPassword}
          />
        ) : null}
        <V11DestructiveButton
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
        <V11SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'confirmExport') {
    return (
      <V11Shell key="confirm-export">
        <V11Emblem />
        <V11PageHeader context="Privacy & data" title="Export your Kineo data?" />
        <Text style={styles.supporting}>
          Kineo will create a private JSON file and open the iPhone share sheet. The one-time server copy expires after {exportDownloadLifetimeMinutes} minutes.
        </Text>
        {accountActions?.provider === 'email' ? (
          <V11PasswordField
            autoComplete="current-password"
            onChangeText={setAccountPassword}
            label="Confirm your password"
            value={accountPassword}
          />
        ) : null}
        <V11PrimaryButton
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
        <V11SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'changePassword') {
    const passwordIsLongEnough =
      [...replacementPassword].length >= minimumPasswordCharacterCount;
    const passwordsMatch = replacementPassword === replacementPasswordConfirmation;
    return (
      <V11Shell key="change-password">
        <V11Emblem />
        <V11PageHeader context="Account security" title="Change your password" />
        <Text style={styles.supporting}>
          Confirm your current password, then use at least {minimumPasswordCharacterCount} characters for the new one.
        </Text>
        <V11PasswordField
          autoComplete="current-password"
          onChangeText={setAccountPassword}
          label="Current password"
          value={accountPassword}
          />
        <V11PasswordField
          autoComplete="new-password"
          onChangeText={setReplacementPassword}
          label="New password"
          value={replacementPassword}
          />
        <V11PasswordField
          autoComplete="new-password"
          onChangeText={setReplacementPasswordConfirmation}
          label="Confirm new password"
          value={replacementPasswordConfirmation}
          />
        {!passwordsMatch && replacementPasswordConfirmation.length > 0 ? (
          <V11NoticeCard tone="caution" role="alert" message="The passwords do not match." />
        ) : null}
        <V11PrimaryButton
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
        <V11SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'confirmDelete') {
    return (
      <V11Shell key="confirm-delete">
        <V11Emblem caution />
        <V11PageHeader context="Privacy & data" title="Delete all Kineo data?" />
        <Text style={styles.supporting}>
          This removes your profile, all local history, current Attention Required areas, and Kineo reminders. It cannot be undone.
        </Text>
        <V11NoticeCard message="It does not change iPhone notification permission history or data and diagnostics held independently by Apple." />
        {accountActions?.provider === 'email' ? (
          <V11PasswordField
            autoComplete="current-password"
            onChangeText={setAccountPassword}
            label="Confirm your password"
            value={accountPassword}
          />
        ) : null}
        <V11DestructiveButton
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
        <V11SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'confirmLogout') {
    return (
      <V11Shell key="confirm-logout">
        <V11Emblem />
        <V11PageHeader context="Account" title="Sign out of Kineo?" />
        <Text style={styles.supporting}>
          Kineo will first upload changes saved on this iPhone, revoke this installation, and remove its local data.
        </Text>
        <V11PrimaryButton
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
        <V11DestructiveButton
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
        <V11SecondaryButton
          label="Cancel"
          onPress={() => setScreen({ kind: 'profile', profile: screen.profile })}
        />
      </V11Shell>
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
      <V11Shell
        bottomBar={<V11FloatingTabBar active="profile" onSelect={(tab) => void openTab(tab)} />}
        key="profile"
      >
        <V11BrandMark context="Settings & privacy" />
        <V11PageHeader context="Your space" title="Profile" />
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
            <V11NoticeCard tone="caution" message="Kineo could not reconcile reminders after returning to the app. Try again from Profile." />
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
          <SectionHeading title="Internal testing" />
          <V11SecondaryButton
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
      </V11Shell>
    );
  }

  if (screen.kind === 'loading') {
    return (
      <V11Shell key="loading">
        <V11BrandMark />
        <View style={styles.centered}>
          <ActivityIndicator color={v11Colors.secondaryAction} accessibilityLabel="Loading Kineo" />
          <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.supporting}>Preparing your private Kineo space…</Text>
        </View>
      </V11Shell>
    );
  }

  if (screen.kind === 'error') {
    return (
      <V11Shell key="error">
        <V11BrandMark />
        <V11Emblem caution />
        <V11PageHeader context="Let’s try that again" title="Your data stayed put." />
        <Text style={styles.supporting}>{errorMessage(screen.error)}</Text>
        <V11PrimaryButton label="Retry" disabled={isSubmitting} onPress={() => void load()} />
      </V11Shell>
    );
  }

  if (screen.kind === 'ageConfirmation') {
    return (
      <V11Shell key="age-confirmation">
        <V11ProgressPill current={onboardingSteps.age} total={onboardingStepCount} />
        <V11PageHeader context="Before we begin" title="Are you 18 or older?" />
        <Text style={styles.supporting}>
          Kineo is currently designed for adults. Your answer stays on this device.
        </Text>
        <V11PrimaryButton
          label="Yes, I’m 18 or older"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.confirmAdultEligibility());
            if (result?.ok) await load();
          })()}
        />
        <V11SecondaryButton label="No" onPress={() => setScreen({ kind: 'ageUnavailable' })} />
      </V11Shell>
    );
  }

  if (screen.kind === 'ageUnavailable') {
    return (
      <V11Shell key="age-unavailable">
        <V11Emblem caution />
        <V11PageHeader context="Not available yet" title="Kineo is for adults right now." />
        <Text style={styles.supporting}>
          We can’t continue with setup. No movement plan has been created.
        </Text>
        <V11SecondaryButton label="I answered by mistake" onPress={() => setScreen({ kind: 'ageConfirmation' })} />
      </V11Shell>
    );
  }

  if (onboarding?.step === 'welcome') {
    return (
      <V11Shell
        bottomBar={(
          <View style={styles.v11ActionInset}>
            <V11PrimaryButton
              label="Get started"
              onPress={() => setScreen({ kind: 'ageConfirmation' })}
            />
          </View>
        )}
        key="welcome"
      >
        <V11BrandMark context="Your daily movement" />
        <V11PageHeader context="Move with today in mind"
          title="A routine shaped around how you feel now."
          lead="A short check-in guides a private, on-device movement routine for your neck and back." />
        <V11WelcomeArtwork />
        <Text style={styles.welcomeFootnote}>
          For adults managing recurring neck or back discomfort. Wellness guidance, not medical care.
        </Text>
      </V11Shell>
    );
  }

  if (onboarding?.step === 'primaryArea') {
    return (
      <AreaSelection
        eyebrow="Your main focus"
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
        progressCurrent={onboardingSteps.primaryArea}
      />
    );
  }

  if (onboarding?.step === 'secondaryArea') {
    const options = bodyAreas.filter((area) => area !== onboarding.primaryArea);
    return (
      <AreaSelection
        eyebrow="Optional second area"
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
        progressCurrent={onboardingSteps.secondaryArea}
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
      <V11Shell key="safety-boundary">
        <V11ProgressPill current={onboardingSteps.safetyBoundary} total={onboardingStepCount} />
        <V11Emblem caution />
        <V11PageHeader context="A clear boundary" title="You stay in control." />
        <V11NoticeCard tone="caution" title="Kineo is wellness guidance—not medical care."
          message="Kineo is not intended for a new injury, sudden or unusual symptoms, postoperative rehabilitation, or emergencies." />
        <Text style={styles.v11Body}>
          Stop if you feel worse or something feels wrong, and seek appropriate professional help when needed. Kineo will withhold a routine when your answers need more caution.
        </Text>
        <V11PrimaryButton
          label="I understand"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.acknowledgeSafetyBoundary());
            if (result?.ok) await load();
          })()}
        />
      </V11Shell>
    );
  }

  if (onboarding?.step === 'firstCheckIn') {
    return (
      <V11Shell key="first-check-in">
        <V11Emblem />
        <V11PageHeader context="Setup complete" title="Let’s make this useful." />
        <Text style={styles.supporting}>
          Your first short check-in will shape a routine for {areaLabels[onboarding.primaryArea].toLowerCase()}.
        </Text>
        <V11PrimaryButton
          label="Continue to Today"
          disabled={isSubmitting}
          onPress={() => void (async () => {
            const result = await submit(() => service.completeOnboarding());
            if (result?.ok) await load();
          })()}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'start' && screen.state.kind === 'attentionRequired') {
    const attentionPrompt = screen.state.prompt;
    return (
      <V11Shell
        bottomBar={<V11FloatingTabBar active="today" onSelect={(tab) => void openTab(tab)} />}
        key="attention-required"
      >
        <V11Emblem caution />
        <V11PageHeader context="Attention Required" title="Pause before another routine." />
        <V11NoticeCard tone="caution" message={`Your earlier answer for ${areaLabels[attentionPrompt.area].toLowerCase()} needs a fresh safety check before Kineo can continue.`} />
        <V11PrimaryButton
          label="Review now"
          onPress={() => setScreen({ kind: 'attentionReturn', prompt: attentionPrompt })}
        />
      </V11Shell>
    );
  }

  if (screen.kind === 'attentionGuidance') {
    return (
      <V11Shell
        bottomBar={<V11FloatingTabBar active="today" onSelect={(tab) => void openTab(tab)} />}
        key="attention-guidance"
      >
        <V11Emblem caution />
        <V11PageHeader context="Attention Required" title="Kineo cannot guide this change." />
        <Text style={styles.supporting}>
          Your answer for {areaLabels[screen.prompt.area].toLowerCase()} described a new, sudden, unusual, or uncertain change. Kineo will not provide another routine right now.
        </Text>
        <V11NoticeCard tone="caution" title="When to seek care" message="Seek appropriate professional help if needed. Use urgent or emergency services when the situation may be an emergency." />
        <Text style={styles.supporting}>
          On your next visit, Kineo will ask whether this area has returned to its usual recurring pattern.
        </Text>
      </V11Shell>
    );
  }

  const primaryArea = screen.kind === 'start' && screen.state.kind === 'today'
    ? screen.state.primaryArea
    : undefined;
  return (
    <V11Shell key="today" bottomBar={<V11FloatingTabBar active="today" onSelect={tab => void openTab(tab)} />}>
      <V11BrandMark context="Your daily movement" />
      <V11PageHeader context="Today" title={usesLargeTextLayout ? 'Check in' : 'How are you moving?'}
        lead="Start with how you feel. Your answers guide what comes next." />
      <View style={styles.v11PlanFocal}>
        {primaryArea === undefined ? null : <V11AreaEmblem area={primaryArea} />}
        <Text style={styles.v11FocalTitle}>{usesLargeTextLayout ? 'Start here' : 'Check in with yourself'}</Text>
        <Text style={styles.v11Body}>Tell Kineo what feels different today. Your answers decide what, if anything, comes next.</Text>
        {primaryArea === undefined ? null : <View style={styles.v11FocusSummary}>
          <Text style={styles.v11Meta}>Your focus area</Text>
          <Text style={styles.v11SectionTitle}>{areaLabels[primaryArea]}</Text>
        </View>}
        <V11PrimaryButton disabled={isSubmitting} label="Check in" onPress={() => void startCheckIn()} />
      </View>
    </V11Shell>
  );
}

type KineoIconName = keyof typeof Ionicons.glyphMap;

function SectionHeading({ title, detail }: Readonly<{ title: string; detail?: string }>) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={[styles.sectionHeading, fontScale > layout.fixedBottomBarMaximumFontScale && styles.sectionHeadingAccessible]}>
      <Text accessibilityRole="header" style={styles.sectionHeadingText}>{title}</Text>
      {detail === undefined ? null : <Text style={styles.sectionHeadingDetail}>{detail}</Text>}
    </View>
  );
}

function ListRow({ icon, leading, ...props }: Readonly<{
  icon: KineoIconName; leading?: ReactNode; label: string; subtitle?: string; value?: string;
  accessibilityLabel?: string; danger?: boolean; disabled?: boolean; onPress?: () => void;
}>) {
  return <V11ListRow {...props} leading={leading ?? <View style={[styles.listRowIcon, props.danger && styles.listRowIconDanger]}>
    <Ionicons accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      color={props.danger ? v11Colors.destructive : v11Colors.secondaryAction} name={icon} size={layout.iconSize} />
  </View>} />;
}

function V11PasswordField({ label, ...props }: Readonly<{
  label: string; autoComplete: 'current-password' | 'new-password'; value: string;
  onChangeText: (text: string) => void;
}>) {
  return <View style={styles.passwordField}>
    <Text style={styles.v11SectionTitle}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} placeholder={label}
      placeholderTextColor={v11Colors.textSecondary} secureTextEntry autoCapitalize="none" autoCorrect={false}
      style={styles.textInput} />
  </View>;
}

function ConsistencyMeter({ current, goal }: Readonly<{ current: number; goal: number }>) {
  const days = Array.from({ length: goal }, (_, index) => index < current);
  return (
    <View accessible accessibilityLabel={`${current} of ${goal} participation days this week`} style={styles.v11PlanFocal}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricEyebrow}>This week</Text>
        <Ionicons color={v11Colors.primaryAction} name="calendar-clear-outline" size={layout.iconSize} />
      </View>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricValue}>{current}</Text>
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
  const reduceMotion = useV11ReducedMotion();
  const player = useVideoPlayer(prototypeMovementVideo, videoPlayer => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
  });
  useEffect(() => {
    const updatePlayback = (state: string | null) => {
      if (reduceMotion || state !== 'active') player.pause();
      else player.play();
    };
    updatePlayback(AppState.currentState);
    const subscription = AppState.addEventListener('change', updatePlayback);
    // useVideoPlayer owns release on unmount; do not call into its released native object.
    return () => subscription.remove();
  }, [player, reduceMotion]);
  return <V11RoutineMediaFrame accessibilityLabel={accessibilityLabel}>
    <VideoView allowsPictureInPicture={false} contentFit="cover" nativeControls={false}
      player={player} style={styles.v11Video} />
  </V11RoutineMediaFrame>;
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
  return <V11Shell key={title} bottomBar={<View style={styles.v11ActionInset}>
    <V11PrimaryButton label="Continue" onPress={onContinue} disabled={disabled} />
    {optionalLabel && onOptional ? <V11SecondaryButton label={optionalLabel} onPress={onOptional} disabled={disabled} /> : null}
  </View>}>
    <V11ProgressPill current={progressCurrent} total={onboardingStepCount} />
    <V11PageHeader context={eyebrow} title={title} lead={supporting} />
    <View accessibilityRole="radiogroup" accessibilityLabel="Focus area" style={styles.optionList}>
      {options.map(area => <V11ChoiceRow key={area} role="radio" title={areaLabels[area]}
        accessibilityLabel={areaLabels[area]} detail={areaDescriptions[area]} selected={selected === area}
        leading={<V11AreaEmblem area={area} />} onPress={() => onSelect(area)} />)}
    </View>
  </V11Shell>;
}

function V11ActionChoice({ label, onPress }: { label: string; onPress: () => void }) {
  return <V11ChoiceRow role="button" title={label} selected={false} onPress={onPress} />;
}

function PlanSequence({ plan }: { plan: PlanPresentation }) {
  const [expanded, setExpanded] = useState(true);
  return <View style={styles.v11Sequence}>
    <Pressable accessibilityRole="button" accessibilityLabel="Your sequence" accessibilityState={{ expanded }}
      onPress={() => setExpanded(value => !value)} style={styles.v11SequenceHeading}>
      <Ionicons accessible={false} name={expanded ? 'chevron-down' : 'chevron-forward'}
        color={v11Colors.textSecondary} size={layout.smallIconSize} />
      <Text style={styles.v11SectionTitle}>Your sequence</Text>
      <Text style={styles.v11Meta}>{plan.itemCount} steps</Text>
    </Pressable>
    {expanded ? plan.sequence?.length ? plan.sequence.map((step, index) => <View key={step.id} style={styles.v11SequenceStep}>
      <Text style={styles.v11StepNumber}>{index + displayIndexOffset}</Text>
      <View style={styles.v11StepCopy}>
        <Text style={styles.v11StepTitle}>{step.title}</Text>
        <Text style={styles.v11Meta}>{step.estimatedSeconds % secondsPerMinute === 0
          ? `${step.estimatedSeconds / secondsPerMinute} min` : `${step.estimatedSeconds} sec`} · {areaLabels[step.area]}</Text>
      </View>
    </View>) : <Text style={styles.v11Body}>{plan.itemCount} guided steps. Movement details appear when you begin.</Text> : null}
  </View>;
}

function PlanDurationSelector({ activeDuration, onSelect, disabled = false }: Readonly<{
  activeDuration: PlanPresentation['duration'];
  onSelect: (duration: PlanPresentation['duration']) => void;
  disabled?: boolean;
}>) {
  return <View style={styles.v11Sequence}>
    <Text style={styles.v11Meta}>Choose a duration</Text>
    <V11SegmentedControl label="Choose a duration" options={durationOptions} value={activeDuration}
      onSelect={onSelect} disabled={disabled} />
  </View>;
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

function routineRemainingSeconds(routine: RoutinePresentation, dose: Extract<Dose, { kind: 'timed' }>): number {
  const remainingMilliseconds = Math.max(noElapsedMilliseconds, dose.activeSeconds * millisecondsPerSecond - routine.stepElapsedMilliseconds);
  return Math.floor((remainingMilliseconds + countdownRoundingOffsetMilliseconds) / millisecondsPerSecond);
}

function routineTimerText(routine: RoutinePresentation, dose: Dose): string {
  return dose.kind === 'timed' ? `${routineRemainingSeconds(routine, dose)} seconds remaining`
    : `${Math.floor(routine.stepElapsedMilliseconds / millisecondsPerSecond)} seconds elapsed`;
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
  shadowColor: v11Colors.shadow,
  shadowOffset: { height: layout.shadowOffsetY, width: 0 },
  shadowOpacity: layout.shadowOpacity,
  shadowRadius: layout.shadowRadius,
} as const;

const styles = StyleSheet.create({
  passwordField: { gap: spacing.compact },
  historySummary: { ...raisedSurfaceShadow, backgroundColor: v11Colors.focalSurface,
    borderRadius: v11Layout.focalRadius, borderColor: v11Colors.separator, borderWidth: layout.borderWidth, overflow: 'hidden' },
  v11Video: { flex: 1, width: '100%', height: '100%' },
  v11RoutineActionsStacked: { flexDirection: 'column' },
  v11RoutineActionStacked: { flexBasis: 'auto' },
  v11RoutineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  v11RoutineAction: { flexGrow: 1, flexBasis: 0, minWidth: layout.controlMinimumHeight, paddingHorizontal: spacing.compact },
  v11PlanFocal: { ...raisedSurfaceShadow, backgroundColor: v11Colors.focalSurface,
    borderRadius: v11Layout.focalRadius, borderWidth: layout.borderWidth, borderColor: v11Colors.separator,
    padding: spacing.standard, gap: spacing.small },
  v11FocalTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.small, justifyContent: 'space-between' },
  v11LevelBadge: { color: v11Colors.secondaryAction, backgroundColor: v11Colors.accentSoft,
    fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight,
    fontWeight: v11Typography.semiboldWeight, paddingVertical: spacing.micro, paddingHorizontal: spacing.small, borderRadius: radius.status, overflow: 'hidden' },
  v11FocalTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.titleSize,
    lineHeight: v11Typography.titleLineHeight, fontWeight: v11Typography.semiboldWeight },
  v11Meta: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight },
  v11Body: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  v11SectionTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.headingSize,
    lineHeight: v11Typography.headingLineHeight, fontWeight: v11Typography.semiboldWeight },
  v11PlanReason: { borderTopWidth: layout.borderWidth, borderTopColor: v11Colors.separator, paddingTop: spacing.compact, gap: spacing.compact },
  v11FocusSummary: { gap: spacing.micro, borderTopWidth: layout.borderWidth, borderTopColor: v11Colors.separator, paddingTop: spacing.small },
  v11PlanFooter: { gap: spacing.compact },
  v11ActionInset: { paddingHorizontal: spacing.screenHorizontal, gap: spacing.compact, alignSelf: 'center', maxWidth: layout.readableWidth, width: '100%' },
  v11Sequence: { gap: spacing.compact },
  v11SequenceHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, alignItems: 'center', minHeight: layout.controlMinimumHeight },
  v11SequenceStep: { minHeight: v11Layout.planStepMinimumHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.small,
    paddingVertical: spacing.compact, borderBottomWidth: layout.borderWidth, borderBottomColor: v11Colors.separator },
  v11StepNumber: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, width: spacing.roomy, fontVariant: ['tabular-nums'] },
  v11StepCopy: { flex: 1, gap: spacing.micro },
  v11StepTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight, fontWeight: v11Typography.mediumWeight },
  centered: { alignItems: 'center', flex: 1, gap: spacing.standard, justifyContent: 'center' },
  tabSection: { gap: spacing.compact },
  sectionHeading: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, justifyContent: 'space-between' },
  sectionHeadingAccessible: { alignItems: 'flex-start', flexDirection: 'column' },
  sectionHeadingText: { color: v11Colors.textPrimary, fontSize: v11Typography.sectionSize, lineHeight: v11Typography.sectionLineHeight, fontWeight: v11Typography.semiboldWeight },
  sectionHeadingDetail: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight },
  sectionFootnote: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight, paddingHorizontal: spacing.micro },
  groupedList: { backgroundColor: v11Colors.surface, borderColor: v11Colors.separator, borderRadius: v11Layout.choiceRadius, borderWidth: layout.borderWidth, overflow: 'hidden' },
  destructiveGroup: { backgroundColor: v11Colors.surface, borderColor: v11Colors.separator, borderRadius: v11Layout.choiceRadius, borderWidth: layout.borderWidth, marginTop: spacing.standard, overflow: 'hidden' },
  listRowIcon: { alignItems: 'center', backgroundColor: v11Colors.softWell, borderRadius: v11Layout.areaEmblemRadius, height: v11Layout.areaEmblemSize, justifyContent: 'center', width: v11Layout.areaEmblemSize },
  listRowIconDanger: { backgroundColor: v11Colors.cautionSurface },
  emptyStateCard: { alignItems: 'flex-start', backgroundColor: v11Colors.surface, borderColor: v11Colors.separator, borderRadius: radius.card, borderWidth: layout.borderWidth, gap: spacing.compact, padding: spacing.roomy },
  areaHistoryEntry: { backgroundColor: v11Colors.surface, borderBottomColor: v11Colors.separator, borderBottomWidth: layout.borderWidth, gap: spacing.micro, paddingHorizontal: spacing.standard, paddingVertical: spacing.standard },
  supporting: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  welcomeFootnote: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight, textAlign: 'center' },
  textInput: {
    backgroundColor: v11Colors.surface,
    borderColor: v11Colors.borderStrong,
    borderRadius: v11Layout.inputRadius,
    borderWidth: layout.borderWidth,
    color: v11Colors.textPrimary,
    fontSize: v11Typography.bodySize,
    lineHeight: v11Typography.bodyLineHeight,
    minHeight: layout.controlMinimumHeight,
    paddingVertical: spacing.controlVertical,
    paddingHorizontal: spacing.standard,
  },
  optionList: { gap: spacing.compact },
  cardTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.headingSize, lineHeight: v11Typography.headingLineHeight, fontWeight: v11Typography.semiboldWeight },
  cardBody: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  metricHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  metricEyebrow: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight, fontWeight: v11Typography.mediumWeight },
  metricValueRow: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  metricValue: { color: v11Colors.textPrimary, fontSize: v11Typography.displaySize, lineHeight: v11Typography.displayLineHeight, fontWeight: v11Typography.strongWeight, fontVariant: [v11Typography.timerNumeralVariant] },
  metricGoal: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight, paddingBottom: spacing.compact },
  metricCaption: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  consistencyDots: { flexDirection: 'row', gap: spacing.compact },
  consistencyDot: { backgroundColor: v11Colors.softWell, borderRadius: radius.status, flex: 1, height: spacing.compact },
  consistencyDotComplete: { backgroundColor: v11Colors.primaryAction },
  testSection: { borderTopColor: v11Colors.separator, borderTopWidth: layout.borderWidth, gap: spacing.compact, marginTop: spacing.section, paddingTop: spacing.standard },
});
