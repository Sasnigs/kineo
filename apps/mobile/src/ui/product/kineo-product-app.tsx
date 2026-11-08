import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

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
  PlanSequenceStep,
  ProfilePresentation,
  ProgressPresentation,
  ProductFlowError,
  ProductStartState,
  RoutinePresentation,
} from '@/core/product/product-flow';
import {
  layout,
  spacing,
  v11Colors, v11Layout, v11Typography, v11Canvas,
} from '@/ui/theme/tokens';

import {
  V11BrandMark, V11PageHeader, V11ProgressPill, V11Shell,
  V11PrimaryButton, V11SecondaryButton, V11NoticeCard, V11Emblem,
  V11WelcomeArtwork, V11InlineTextAction, V11ListRow, V11FloatingTabBar, V11SegmentedControl, V11SafetyButton,
} from '../primitives/kineo-v11-primitives';

import { V11RoutineMediaFrame, V11RoutinePacing, formatV11Countdown } from '../primitives/kineo-v11-routine';

import { V11Question, V11Topline, V11Checkline, V11Hero, V11Rhythm, V11FocusRow, canvasTodayLabel, canvasParts } from '../primitives/kineo-v11-canvas-parts';

import { V11Preferences, restoreV11Appearance, type V11AccountActions } from './kineo-v11-preferences';
import { V11History } from './kineo-v11-history';
import { V11CanvasArt } from '../primitives/kineo-v11-canvas-artwork';

import { createExclusiveActionGate } from './exclusive-action-gate';

type LocalScreen =
  | Readonly<{kind:'routineInstruction';routine:RoutinePresentation;instruction:string;safetyCue?:string}>
  | Readonly<{ kind: 'skipConfirmation'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'ended'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'saveError'; routine: RoutinePresentation; responses: Readonly<Partial<Record<BodyArea, AreaResponse>>> }>
  | Readonly<{ kind: 'saving'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'weeklyIntention'; primaryArea: BodyArea }>
  | Readonly<{ kind: 'onboardingBack'; step: 'primaryArea' | 'secondaryArea' | 'safetyBoundary' | 'firstCheckIn'; primaryArea: BodyArea }>
  | Readonly<{ kind: 'checkInHelp'; checkIn: Extract<LocalScreen, { kind: 'checkIn' }> }>
  | Readonly<{ kind: 'planWhy'; plan: PlanPresentation }>
  | Readonly<{ kind: 'movementPreview'; plan: PlanPresentation; index: number }>
  | Readonly<{ kind: 'contentInfo'; plan: PlanPresentation; index: number }>
  | Readonly<{ kind: 'pauseToday'; plan: PlanPresentation }>
  | Readonly<{ kind: 'restSaved' }>
  | Readonly<{ kind: 'support'; prompt: AttentionPrompt }>
  | Readonly<{ kind: 'sessionView'; session: ProgressPresentation['recentSessions'][number] }>
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
  | Readonly<{
      kind: 'feedback';
      routine: RoutinePresentation;
      areaIndex: number;
      responses: Readonly<Partial<Record<BodyArea, AreaResponse>>>;
    }>;

type KineoProductAppProps = Readonly<{
  service: KineoProductServing;
  onStoreRestartRequired: () => void;
  onBackToAccount?: () => void;
  accountActions?: V11AccountActions;
}>;

type MainTab = 'today' | 'progress' | 'profile';

const areaLabels: Readonly<Record<BodyArea, string>> = Object.freeze({
  neck: 'Neck',
  upperMidBack: 'Upper & mid back',
  lowerBack: 'Lower back',
});

const defaultWeeklyIntentionDays = 3;
const onboardingSteps = { age: 1, primaryArea: 1, secondaryArea: 2, weeklyIntention: 3, safetyBoundary: 4 } as const;
const checkInSteps = { change: 1, comfort: 2 } as const;
const onboardingStepCount = onboardingSteps.safetyBoundary;
const checkInStepCount = 2;
const durationOptions = [{ value: 'quick', label: 'Quick · 5 min' }, { value: 'standard', label: 'Standard · 10 min' }] as const;


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
  accountActions, onBackToAccount,
}: KineoProductAppProps) {
  useEffect(() => { void restoreV11Appearance().catch(() => { /* Device appearance remains the safe default if preference storage is unavailable. */ }); }, []);
  const [screen, setScreen] = useState<LocalScreen>({ kind: 'loading' });
  const [weeklyGoalDraft, setWeeklyGoalDraft] = useState(defaultWeeklyIntentionDays);
  const [selectedPrimaryArea, setSelectedPrimaryArea] = useState<BodyArea>();
  const [selectedSecondaryArea, setSelectedSecondaryArea] = useState<BodyArea>();
  const [todayData, setTodayData] = useState<{ profile?: ProfilePresentation; progress?: ProgressPresentation; failed?: boolean }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCheckInAnswers, setLastCheckInAnswers] = useState<Readonly<Partial<Record<BodyArea, AreaCheckInAnswers>>>>({});
  const submissionGate = useRef(createExclusiveActionGate());
  const [, setReminderReconciliationFailed] = useState(false);
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale > layout.fixedBottomBarMaximumFontScale;

  const todaySurface = screen.kind === 'start' && ['today', 'unfinishedPlan', 'unfinishedRoutine'].includes(screen.state.kind);
  useEffect(() => {
    if (!todaySurface) return;
    let active = true;
    void Promise.all([service.loadProfile(), service.loadProgress()]).then(([profile, progress]) => {
      if (active) setTodayData({ profile: profile.ok ? profile.value : undefined,
        progress: progress.ok ? progress.value : undefined, failed: !profile.ok || !progress.ok });
    });
    return () => { active = false; };
  }, [service, todaySurface]);

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

  const lifecycleRoutine = screen.kind === 'routine' || screen.kind === 'feedback' ? screen.routine
    : screen.kind === 'start' && screen.state.kind === 'unfinishedRoutine' ? screen.state.routine : undefined;
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

  const menuRoutine=screen.kind==='skipConfirmation'||screen.kind==='routineInstruction'?screen.routine:undefined;
  useEffect(()=>{
    if(!menuRoutine||menuRoutine.status!=='inProgress')return;
    let live=true;const subscription=AppState.addEventListener('change',state=>{
      if(state==='active')return;
      void service.pauseRoutine(menuRoutine.sessionId).then(result=>{if(live)setScreen(result.ok?{kind:'routine',routine:result.value}:{kind:'error',error:result.error});});
    });return()=>{live=false;subscription.remove();};
  },[menuRoutine,service]);

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

  const onboarding = screen.kind === 'onboardingBack' ? screen :
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
    setLastCheckInAnswers(answers);
    setScreen(result.value.kind === 'plan'
      ? { kind: 'start', state: { kind: 'unfinishedPlan', plan: result.value.plan } }
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
    const backToChange = () => setScreen({ ...activeCheckIn, stage: 'change', movementComfort: undefined });
    if (activeCheckIn.stage === 'change') return <V11Shell key={`${areaName}-change`}>
      <V11Question context={areaName} current={checkInSteps.change} total={checkInStepCount}
        title={activeCheckIn.currentArea === activeCheckIn.draft.secondaryArea ? 'And how is this area today?' : 'Compared with your usual pattern…'}
        helper={activeCheckIn.currentArea === activeCheckIn.draft.secondaryArea ? `Compared with your usual pattern for ${areaName.toLowerCase()}.` : 'Choose the closest answer for right now.'}
        initial={activeCheckIn.changeReport} onSelectionChange={changeReport => setScreen({...activeCheckIn,changeReport})} onBack={() => setScreen({kind:'start',state:{kind:'today',primaryArea:activeCheckIn.draft.primaryArea}})} disabled={isSubmitting}
        options={[{value:'better',title:'Better',detail:'Feels easier than usual'}, {value:'similar',title:'Similar',detail:'About your usual pattern'}, {value:'worse',title:'Worse',detail:'Feels worse than usual'}] as const}
        onContinue={changeReport => setScreen({...activeCheckIn,stage:'comfort',changeReport})} />
      <Pressable accessibilityRole="button" accessibilityLabel="Why we ask" style={styles.canvasQuestionHelp} onPress={() => setScreen({kind:'checkInHelp',checkIn:activeCheckIn})}><Text style={styles.canvasQuestionHelpLabel}>Why we ask</Text></Pressable>
      {activeCheckIn.currentArea === activeCheckIn.draft.secondaryArea ? <V11InlineTextAction label="Skip this area today"
        onPress={() => void submitCompletedAnswers(activeCheckIn.draft,activeCheckIn.answers,activeCheckIn.correctionDraft)} /> : null}
    </V11Shell>;
    if (activeCheckIn.stage === 'comfort') return <V11Shell key={`${areaName}-comfort`}>
      <V11Question context={areaName} current={checkInSteps.comfort} total={checkInStepCount} title="How does movement feel?"
        helper={activeCheckIn.currentArea === activeCheckIn.draft.secondaryArea ? `Answer for ${areaName.toLowerCase()} right now.` : 'Answer for this area, not your whole body.'}
        onBack={backToChange} initial={activeCheckIn.movementComfort} disabled={isSubmitting}
        options={[{value:'limited',title:'Limited',detail:'Less comfortable or more restricted'}, {value:'okay',title:'Okay',detail:'Manageable today'}, {value:'good',title:'Good',detail:'Comfortable today'}] as const}
        onContinue={movementComfort => {
          const changeReport=activeCheckIn.changeReport; if (!changeReport) return;
          if (requiresConditionalSafetyAnswer({changeReport,movementComfort})) setScreen({...activeCheckIn,stage:'safety',movementComfort});
          else continueWithAnswer({area:activeCheckIn.currentArea,changeReport,movementComfort});
        }} />
      <Text style={canvasParts.fine}>There is no right answer. Choose what feels closest.</Text>
    </V11Shell>;
    return <V11Shell key={`${areaName}-safety`}>
      <V11Question context={`${areaName} · Pause and check`} title="Is this a new or unusual change?"
        helper="Including a sudden change—or something you’re unsure about." onBack={() => setScreen({...activeCheckIn,stage:'comfort'})}
        disabled={isSubmitting} options={[{value:'notSure',title:'Yes, or I’m not sure',detail:'Kineo won’t offer a routine right now'},
          {value:'no',title:'No, it’s my usual recurring pattern',detail:'Continue the check-in'}] as const}
        onContinue={conditionalSafetyAnswer => {
          if (!activeCheckIn.changeReport || !activeCheckIn.movementComfort) return;
          continueWithAnswer({area:activeCheckIn.currentArea,changeReport:activeCheckIn.changeReport,
            movementComfort:activeCheckIn.movementComfort,conditionalSafetyAnswer});
        }} />
      <V11NoticeCard tone="caution" title="You don’t need to push through" message="If something feels wrong, stop and seek appropriate professional help when needed." />
    </V11Shell>;
  }
  if (screen.kind === 'checkInHelp') return <V11Shell><V11Topline onBack={() => setScreen(screen.checkIn)} />
    <V11PageHeader context="A little context" title={'Your usual\npattern is personal.'} />
    <View style={canvasParts.focal}><Text style={canvasParts.title}>Compare with what is familiar to you.</Text>
      <Text style={canvasParts.body}>We use your answer alongside how movement feels today to choose an available routine level.</Text></View>
    <Text style={canvasParts.body}>This is not a medical assessment. A new, sudden, unusual, or uncertain change needs a different next step.</Text>
    <V11PrimaryButton label="Back to my check-in" onPress={() => setScreen(screen.checkIn)} />
  </V11Shell>;

  if(screen.kind==='routineInstruction')return <V11Shell><V11Topline onBack={()=>setScreen({kind:'routine',routine:screen.routine})}/><V11PageHeader context="About this guidance" title="Before you begin."/><Text style={canvasParts.body}>{screen.instruction}</Text>{screen.safetyCue?<V11NoticeCard tone="caution" message={screen.safetyCue}/>:null}<V11PrimaryButton label="Back to movement" onPress={()=>setScreen({kind:'routine',routine:screen.routine})}/></V11Shell>;
  if (screen.kind === 'skipConfirmation') return <V11Shell><V11Topline onBack={()=>setScreen({kind:'routine',routine:screen.routine})}/><V11Emblem kind="play-skip-forward-outline"/>
    <V11PageHeader kind="routine" context="Your routine, your choice" title={"Move past\nthis step?"} lead="It will be recorded as skipped, not completed."/>
    <View style={canvasParts.soft}><Text style={canvasParts.badge}>Up next</Text><Text style={canvasParts.title}>A short transition</Text><Text style={canvasParts.body}>Then your next authored movement.</Text></View>
    <V11PrimaryButton label="Skip this step" disabled={isSubmitting} onPress={()=>void(async()=>{const result=await submit(()=>service.skipRoutineStep(screen.routine.sessionId,screen.routine.currentStepIndex));if(result?.ok)setScreen({kind:'routine',routine:result.value});})()}/>
    <V11SecondaryButton label="Stay on this step" onPress={()=>setScreen({kind:'routine',routine:screen.routine})}/></V11Shell>;
  if (screen.kind === 'alternativePreview') return <V11Shell><V11Topline label="Alternative" onBack={()=>setScreen({kind:'routine',routine:screen.routine})}/>
    <V11PageHeader kind="routine" context={`Alternative ${areaLabels[screen.routine.currentItem?.sourceArea??screen.routine.primaryArea].toLowerCase()} movement · Keep the choice in your hands`} title={presentedMovementTitle(screen.alternative.localizedTitle,screen.routine.currentItem?.sourceArea??screen.routine.primaryArea,true)}/>
    <V11RoutineMediaFrame accessibilityLabel={screen.alternative.accessibleDescription}><V11CanvasArt fit name="seated-nod"/></V11RoutineMediaFrame>
    <View style={canvasParts.soft}><Text style={canvasParts.title}>Supported short-arc option</Text><Text style={canvasParts.body}>{screen.alternative.localizedInstruction}</Text></View>
    <V11PrimaryButton label="Use this alternative" disabled={isSubmitting} onPress={()=>void(async()=>{const selected=await submit(()=>service.selectRoutineAlternative(screen.routine.sessionId,screen.routine.currentStepIndex,screen.alternative.movementId));if(!selected?.ok)return;const resumed=await submit(()=>service.resumeRoutine(selected.value.sessionId));if(resumed?.ok)setScreen({kind:'routine',routine:resumed.value});})()}/>
    <V11SecondaryButton label="Keep original movement" onPress={()=>void(async()=>{const result=await submit(()=>service.resumeRoutine(screen.routine.sessionId));if(result?.ok)setScreen({kind:'routine',routine:result.value});})()}/></V11Shell>;
  if (screen.kind === 'endConfirmation' || screen.kind === 'safetyGuidance') {
    const safety=screen.kind==='safetyGuidance';
    return <V11Shell><V11Topline label={safety?'Routine paused':''} onBack={()=>setScreen({kind:'routine',routine:screen.routine})}/><V11Emblem caution={safety} kind={safety?'shield-outline':'square-outline'}/>
      <V11PageHeader kind="notice" context={safety?'Stop and check in':'It’s okay to stop'} title={safety?'Listen to\nthat feeling.':'End this\nroutine here?'} lead={safety?'Kineo cannot assess a new or concerning change.':'What you’ve done will be saved. Unfinished steps won’t be marked complete.'}/>
      {safety?<V11NoticeCard tone="caution" title="When to seek care" message="Seek professional support if needed, or contact urgent or emergency services if this feels like an emergency."/>:null}
      <V11PrimaryButton label={safety?'End routine':'End and save'} disabled={isSubmitting} onPress={()=>void(async()=>{const result=await submit(()=>service.endRoutine(screen.routine.sessionId,safety?'safety':'intentional'));if(result?.ok){if(result.value.status==='abandoned')await load();else setScreen({kind:'ended',routine:result.value});}})()}/>
      <V11SecondaryButton label={safety?'I tapped this by mistake':'Keep my place'} onPress={()=>setScreen({kind:'routine',routine:screen.routine})}/>
      {safety?<Text style={canvasParts.fine}>Returning leaves the routine paused. Resume only when you choose.</Text>:null}</V11Shell>;
  }
  if (screen.kind === 'ended' || screen.kind === 'completion') {
    const ended=screen.kind==='ended';
    return <V11Shell>{ended?null:<V11BrandMark context="Your daily movement"/>}<V11Emblem/>
      <V11PageHeader kind={ended?'notice':'editorial'} context={ended?'Saved':'Routine saved'} title={ended?'You chose\nto stop.':'A little time.\nWell considered.'} lead={ended?'That choice matters. Your routine is saved as ended early.':'Your session is now in your history.'}/>
      <View style={ended?canvasParts.soft:canvasParts.focal}><View style={canvasParts.spread}><Text style={canvasParts.title}>{levelLabel(screen.routine.deliveredLevel)} · {durationLabel(screen.routine.duration)}</Text>{ended?null:<Text style={canvasParts.badge}>Saved</Text>}</View>
        <Text style={canvasParts.body}>{areaListLabel(screen.routine.includedAreas)}</Text>{ended?<Text style={canvasParts.fine}>Completed, skipped, and unfinished steps stay distinct in your history.</Text>:<><View style={canvasParts.divider}/><View style={canvasParts.spread}><Text style={canvasParts.fine}>Today’s participation</Text><Text style={canvasParts.title}>{screen.routine.status==='completed'||screen.routine.status==='stopped'?'Recorded':'Not counted'}</Text></View></>}</View>
      <V11PrimaryButton label="Done" onPress={()=>void load()}/><V11InlineTextAction label="View session" onPress={()=>setScreen({kind:'sessionView',session:{sessionId:screen.routine.sessionId,localDay:new Date().toLocaleDateString('en-CA') as never,status:screen.routine.status,deliveredLevel:screen.routine.deliveredLevel,areas:screen.routine.includedAreas}})}/></V11Shell>;
  }
  if(screen.kind==='saving')return <V11Shell><V11BrandMark/><V11PageHeader context="Finishing up" title={"Saving your\nroutine…"} lead="Keep this screen open while we confirm it’s saved."/><ActivityIndicator accessibilityLabel="Saving your routine" color={v11Colors.secondaryAction}/><V11PrimaryButton label="Saving…" disabled onPress={()=>undefined}/><Text style={canvasParts.fine}>This is not a success confirmation yet.</Text></V11Shell>;
  if(screen.kind==='saveError')return <V11Shell><V11BrandMark/><V11Emblem caution kind="cloud-offline-outline"/><V11PageHeader kind="notice" context="Not saved yet" title={"We couldn’t\nconfirm the save."} lead="Your routine is not marked as saved. Try again when your connection is available."/><V11NoticeCard title="Local copy preserved on this device" message="Retry now or return to Today while Kineo keeps this session ready to save."/><V11PrimaryButton label="Try saving again" onPress={()=>void(async()=>{setScreen({kind:'saving',routine:screen.routine});const result=await service.submitFeedback(screen.routine.sessionId,screen.responses);setScreen(result.ok?{kind:'completion',routine:screen.routine}:{...screen});})()}/><V11InlineTextAction label="Get support" onPress={()=>void openTab('profile')}/></V11Shell>;

  const activeReturnPrompt = screen.kind === 'attentionReturn' ? screen.prompt : screen.kind === 'start' && screen.state.kind === 'attentionRequired' ? screen.state.prompt : undefined;
  if (activeReturnPrompt) return <V11Shell footerPlacement="navigation" bottomBar={<V11FloatingTabBar active="today" onSelect={tab => void openTab(tab)} />}>
    <V11BrandMark context="Your daily movement" />
    <V11Question context="Before another routine" title={`Has your ${areaLabels[activeReturnPrompt.area].toLowerCase()}\nreturned to its\nusual pattern?`}
      helper="Last time, you reported a new or uncertain change." disabled={isSubmitting}
      options={[{value:'yes',title:'Yes, my usual recurring pattern',detail:'Start today’s check-in'},
        {value:'notSure',title:'No, or I’m not sure',detail:'Keep routines paused for now'}] as const}
      onContinue={answer => void (async () => { const result=await submit(() => service.respondToAttentionReturn(activeReturnPrompt,answer));
        if(result?.ok) { if(result.value.kind==='ready') await startCheckIn(); else setScreen(screenForAttentionResolution(result.value)); }
      })()} />
    <Text style={canvasParts.fine}>This question does not confirm that movement is medically safe.</Text>
    <V11InlineTextAction label="I selected that by mistake" onPress={() => void (async () => {
      const result=await submit(() => service.beginAttentionCorrection(activeReturnPrompt));
      if(result?.ok) setScreen({kind:'checkIn',draft:result.value.checkIn,correctionDraft:result.value,currentArea:result.value.checkIn.primaryArea,answers:{},stage:'change'});
    })()} />
  </V11Shell>;

  const activeRoutine = screen.kind === 'routine' || screen.kind === 'feedback'
    ? screen.routine
    : screen.kind === 'start' && screen.state.kind === 'unfinishedRoutine' && screen.state.routine.status !== 'paused'
      ? screen.state.routine : undefined;
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
    if (activeRoutine.status === 'paused') return <V11Shell footerPlacement="pinned-actions" bottomBar={<View style={styles.v11ActionInset}><V11PrimaryButton label="Resume routine" icon="play-outline" disabled={isSubmitting} onPress={()=>void updateRoutine(()=>service.resumeRoutine(activeRoutine.sessionId))}/><V11SafetyButton label="Something feels wrong" onPress={()=>void pauseForRoutineMenu(activeRoutine,'safety')}/></View>}>
      <V11Topline label="Routine paused" onBack={()=>void updateRoutine(()=>service.resumeRoutine(activeRoutine.sessionId))}/><V11Emblem kind="pause-outline"/>
      <V11PageHeader kind="routine" context="No rush" title={"Your place\nis saved."} lead="Your timer stays still while you’re paused."/>
      <View style={canvasParts.soft}><Text style={canvasParts.badge}>Step {activeRoutine.currentStepIndex+displayIndexOffset} of {activeRoutine.totalStepCount}</Text><Text style={canvasParts.title}>{activeRoutine.currentItem?presentedMovementTitle(activeRoutine.currentItem.localizedTitle,activeRoutine.currentItem.sourceArea,Boolean(activeRoutine.selectedAlternative)):'Movement'}</Text><View style={canvasParts.spread}><Text style={canvasParts.body}>Time remaining</Text><Text style={styles.v11FocalTitle}>{activeRoutine.currentItem?.kind==='movement'&&activeRoutine.currentItem.scheduledDose.kind==='timed'?formatV11Countdown(routineRemainingSeconds(activeRoutine,activeRoutine.currentItem.scheduledDose)):'Step ready'}</Text></View></View>
      <V11SecondaryButton label="End routine" onPress={()=>void pauseForRoutineMenu(activeRoutine,'end')}/></V11Shell>;
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
      const finalStep=activeRoutine.currentStepIndex===activeRoutine.totalStepCount-displayIndexOffset;
      const controls = transitionStep || (completedStep&&finalStep) ? undefined : <View style={[styles.v11RoutineActions,usesLargeTextLayout&&styles.v11RoutineActionsStacked]}>
        {completedStep?<V11SecondaryButton label="Repeat step" style={styles.v11RoutineAction} disabled={isSubmitting||!service.repeatRoutineStep} onPress={()=>void updateRoutine(()=>service.repeatRoutineStep!(activeRoutine.sessionId,activeRoutine.currentStepIndex))}/>:null}
        {alternative?<V11SecondaryButton label="Original" style={styles.v11RoutineAction} disabled={isSubmitting||!service.restoreRoutineOriginal} onPress={()=>void updateRoutine(()=>service.restoreRoutineOriginal!(activeRoutine.sessionId,activeRoutine.currentStepIndex))}/>:availableAlternative?<V11SecondaryButton label="Alternative" style={styles.v11RoutineAction} disabled={isSubmitting} onPress={()=>void(async()=>{const paused=await submit(()=>service.pauseRoutine(activeRoutine.sessionId));if(paused?.ok)setScreen({kind:'alternativePreview',routine:paused.value,alternative:availableAlternative});})()}/>:null}
        {!completedStep?<><V11SecondaryButton label="Skip" style={styles.v11RoutineAction} disabled={isSubmitting} onPress={()=>setScreen({kind:'skipConfirmation',routine:activeRoutine})}/><V11SecondaryButton label="Pause" style={styles.v11RoutineAction} disabled={isSubmitting} onPress={()=>void updateRoutine(()=>service.pauseRoutine(activeRoutine.sessionId))}/></>:null}
      </View>;
      return (
        <V11Shell key={`routine-step-${activeRoutine.currentStepIndex}`} footerPlacement="pinned-actions"
          bottomBar={<View style={styles.v11ActionInset}>
            <V11PrimaryButton label={!canAdvance?'Continue when timer ends':transitionStep?'Continue to movement':finalStep?'Finish routine':'Continue'} disabled={isSubmitting || !canAdvance}
              onPress={() => void updateRoutine(() => service.advanceRoutine(activeRoutine.sessionId, activeRoutine.currentStepIndex))} />
          </View>}
          persistentBottomBar={<View style={styles.v11ActionInset}>
            <V11SafetyButton disabled={isSubmitting} label="Something feels wrong"
              onPress={() => void pauseForRoutineMenu(activeRoutine, 'safety')} />
          </View>}>
          <V11PageHeader kind="routine" context={`${areaLabels[item.sourceArea]} · ${levelLabel(activeRoutine.deliveredLevel)} · ${activeRoutine.currentStepIndex + displayIndexOffset} of ${activeRoutine.totalStepCount}`}
            title={finalStep&&completedStep?'Your sequence is complete.':transitionStep?'Between movements':presentedMovementTitle(presentedTitle,item.sourceArea,Boolean(alternative))} />
          <V11RoutineMediaFrame accessibilityLabel={item.kind==='movement'?alternative?.accessibleDescription??item.accessibleDescription:'Between movements'}><V11CanvasArt fit name={alternative?'seated-nod':item.sourceArea==='neck'?'neck-glide':'thoracic-open'}/></V11RoutineMediaFrame>
          <V11RoutinePacing key={`${item.itemId}-${alternative?.movementId ?? 'original'}`}
            mode={transitionStep ? 'transition' : completedStep ? 'complete' : timed ? 'counting' : 'repetitions'}
            remainingSeconds={remaining} totalSeconds={timed?.activeSeconds}
            statusLabel={transitionStep?'Next step ready · 30 sec rest':completedStep?finalStep?'Routine complete':'Step complete':timed?`In progress · ${Math.ceil(timed.activeSeconds/secondsPerMinute)} min step`:dose?.kind==='repetitions'?`${dose.repetitionCount} repetitions`:'Movement ready'}
            guidance={transitionStep?'A short transition before your next movement.':completedStep&&finalStep?'Take a moment before you move on.':canAdvance?'Continue when you choose.':'Take your time. Continue when the timer ends.'}
            controls={controls} />
          <V11InlineTextAction label="Movement guidance" onPress={()=>setScreen({kind:'routineInstruction',routine:activeRoutine,instruction,safetyCue})}/>
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
      setScreen({kind:'saving',routine:activeRoutine});
      const result=await service.submitFeedback(activeRoutine.sessionId,responses);
      setScreen(result.ok?{kind:'completion',routine:activeRoutine}:{kind:'saveError',routine:activeRoutine,responses});
    };
    return <V11Shell key={`feedback-${feedbackAreaIndex}`}><V11Question context={feedbackArea?areaLabels[feedbackArea]:'Your routine'} current={feedbackAreaIndex+displayIndexOffset} total={activeRoutine.includedAreas.length}
      title={`How did your ${feedbackArea=== 'upperMidBack'?'upper back':feedbackArea?areaLabels[feedbackArea].toLowerCase():'area'} feel afterward?`} helper="Optional. Your response adds context to your history; it does not measure recovery."
      options={[{value:'better',title:'Better'},{value:'same',title:'About the same'},{value:'worse',title:'Worse'}] as const} cta="Save response" disabled={isSubmitting} onContinue={response=>void finishFeedback(response)}/><V11InlineTextAction label="Skip response" onPress={()=>void finishFeedback()}/></V11Shell>;
  }

  const activePlan = screen.kind === 'plan' ? screen.plan : undefined;
  if (screen.kind === 'planWhy') return <V11Shell><V11Topline label="Why this plan" onBack={() => setScreen({kind:'plan',plan:screen.plan})} />
    <V11PageHeader context="Your answers → your options" title={'Nothing\nmysterious here.'} />
    {screen.plan.includedAreas.map(area => {
      const answer=lastCheckInAnswers[area];
      const reasons=planExplanationLines({...screen.plan,explanations:screen.plan.explanations.filter(reason=>reason.parameters.area===area)});
      return <View key={area} style={canvasParts.section}><Text style={canvasParts.title}>{areaLabels[area]}</Text>
        {answer ? <Text style={canvasParts.body}>{answer.changeReport==='similar'?'Similar to usual':`${changeReportLabel(answer.changeReport)} than usual`} · {movementComfortLabel(answer.movementComfort)} movement</Text> : null}
        <Text style={canvasParts.body}>{reasons.length ? reasons.join(' ') : 'This area is included in your routine.'}</Text></View>;
    })}
    {planExplanationLines({...screen.plan,explanations:screen.plan.explanations.filter(reason=>!bodyAreas.some(area=>area===reason.parameters.area))}).map(reason=><Text key={reason} style={canvasParts.body}>{reason}</Text>)}
    <V11Checkline>Quick and Standard change duration—not level.</V11Checkline>
    <V11Checkline>You can always choose a gentler available option.</V11Checkline>
    <Text style={canvasParts.body}>These answers guide a wellness routine. They do not diagnose a condition or measure recovery.</Text>
    <V11PrimaryButton label="Back to my plan" onPress={() => setScreen({kind:'plan',plan:screen.plan})} />
  </V11Shell>;
  if (screen.kind === 'contentInfo' || screen.kind === 'movementPreview') {
    const item=screen.plan.sequence?.[screen.index];
    const movementTitle=item ? canvasMovementTitle(item) : 'Movement preview';
    return <V11Shell><V11Topline label={`Movement ${screen.index + displayIndexOffset}`} onBack={() => setScreen({kind:'plan',plan:screen.plan})} />
      {screen.kind==='contentInfo' ? <><V11PageHeader context="About this guidance" title="Movement content." />
        <Text style={canvasParts.body}>Sample media · pending review</Text><Text style={canvasParts.body}>Final instruction and media require content review.</Text>
        <V11PrimaryButton label="Back to preview" onPress={() => setScreen({...screen,kind:'movementPreview'})} />
      </> : <><V11PageHeader context={`${areaLabels[item?.area ?? screen.plan.primaryArea]} · ${levelLabel(screen.plan.deliveredLevel)}`} title={`${movementTitle}.`} />
        <RoutineVideo accessibilityLabel={movementTitle} />
        <Text style={canvasParts.badge}>{Math.round((item?.estimatedSeconds ?? secondsPerMinute) / secondsPerMinute)} min · No equipment</Text>
        <Text accessibilityRole="header" style={canvasParts.title}>Before you begin</Text>
        <Text style={canvasParts.body}>Get comfortable before you begin. You can pause or stop whenever you choose.</Text>
        <V11ListRow label="About this guidance" subtitle="How movement content is prepared" onPress={() => setScreen({...screen,kind:'contentInfo'})} />
        <V11PrimaryButton label="Back to sequence" onPress={() => setScreen({kind:'plan',plan:screen.plan})} />
      </>}
    </V11Shell>;
  }
  if (screen.kind === 'pauseToday') return <V11Shell><V11Topline onBack={() => setScreen({kind:'plan',plan:screen.plan})} /><V11Emblem kind="leaf" />
    <V11PageHeader context="A valid choice" title={'Make room\nfor rest today.'} lead="You can return when you’re ready. There’s no routine to complete right now." />
    <V11PrimaryButton label="Save today’s choice" disabled={isSubmitting} onPress={() => void (async () => {
      const result=await submit(() => service.pauseToday(screen.plan.checkInId)); if(result?.ok) setScreen({kind:'restSaved'});
    })()} />
    <V11InlineTextAction label="Back" onPress={() => setScreen({kind:'plan',plan:screen.plan})} />
    <Text style={canvasParts.fine}>Participation credit follows the existing eligibility rules.</Text>
  </V11Shell>;
  if (screen.kind === 'restSaved') return <V11Shell><V11BrandMark /><V11Emblem />
    <V11PageHeader context="Choice saved" title={'Today can\nbe a quieter day.'} lead="Your eligible pause choice is recorded in your history." />
    <V11PrimaryButton label="Back to Today" onPress={() => void load()} />
    <V11InlineTextAction label="View history" onPress={() => void openTab('progress')} />
  </V11Shell>;
  if (activePlan !== undefined) {
    const revise=async (duration:PlanPresentation['duration'], level?:PlanPresentation['selectedLevel']) => {
      const result=await submit(() => service.revisePlan(activePlan.checkInId,duration,level)); if(result?.ok) setScreen({kind:'plan',plan:result.value});
    };
    return <V11Shell key="plan" compact footerPlacement="pinned-actions" bottomBar={<View style={styles.v11ActionInset}><V11PrimaryButton label="Begin routine" icon="play-outline" disabled={isSubmitting}
      onPress={() => void (async () => {const result=await submit(() => service.startRoutine(activePlan.decisionId));
        if(result?.ok) setScreen({kind:'routine',routine:result.value}); })()} /></View>}>
      <V11Topline label="Your plan" onBack={() => void load()} />
      <View style={styles.canvasPlanFocal}><Text style={canvasParts.badge}>{levelLabel(activePlan.deliveredLevel)}</Text>
        <Text accessibilityRole="header" style={styles.canvasPlanTitle}>{activePlan.deliveredLevel==='gentle' ? 'Keep it gentle.' : activePlan.deliveredLevel==='balanced' ? 'A steady starting point.' : 'Room to move.'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Why this plan" accessibilityHint={planExplanationLines(activePlan).join(' ')}
          onPress={() => setScreen({kind:'planWhy',plan:activePlan})} style={styles.canvasPlanReason}>
          <Text style={styles.canvasPlanReasonTitle}>Why this plan today</Text>
          <Text style={canvasParts.body}>{planExplanationLines(activePlan).join(' ')}</Text>
        </Pressable>
        <Text style={canvasParts.fine}>{Math.round(activePlan.nominalSeconds / secondsPerMinute)} min · {activePlan.itemCount} guided steps</Text>
      </View>
      <PlanDurationSelector activeDuration={activePlan.duration} disabled={isSubmitting} onSelect={duration => void revise(duration,activePlan.selectedLevel)} />
      <Text style={canvasParts.fine}>Same level, different length</Text>
      <PlanSequence plan={activePlan} onPreview={index => setScreen({kind:'movementPreview',plan:activePlan,index})} />
      {activePlan.omittedSecondary ? <V11NoticeCard message={omittedAreaExplanation(activePlan.omittedSecondary.area, activePlan.omittedSecondary.reason)} /> : null}
      {activePlan.gentlerLevel ? <V11InlineTextAction label="Choose Gentle instead" onPress={() => void revise(activePlan.duration,activePlan.gentlerLevel)} /> : null}
      {activePlan.pauseTodayAvailable ? <V11InlineTextAction label="Pause Today" onPress={() => setScreen({kind:'pauseToday',plan:activePlan})} /> : null}
      <View style={styles.canvasReviewFlag}><Text style={canvasParts.fine}>Illustrative movement labels and timings. Final instruction and media require content review.</Text></View>
    </V11Shell>;
  }

  if (screen.kind === 'progress' || screen.kind === 'progressArea') return <V11History
    key="history" progress={screen.progress} initialArea={screen.kind==='progressArea'?screen.area:undefined}
    service={service} onToday={()=>void load()} onYou={()=>void openTab('profile')}/>;

  if (screen.kind === 'profile' || screen.kind === 'profileAreas') return <V11Preferences
    key={screen.kind} initial={screen.profile} initialRoute={screen.kind === 'profileAreas'?'areas':'you'} service={service}
    accountActions={accountActions} onToday={()=>void load()} onHistory={()=>void openTab('progress')} onRestart={onStoreRestartRequired}/>;

  if (screen.kind === 'loading') {
    return (
      <V11Shell key="loading">
        <V11BrandMark />
        <V11PageHeader context="One moment" title={"Getting your\nday ready."}/><View style={styles.centered}>
          <ActivityIndicator color={v11Colors.secondaryAction} accessibilityLabel="Loading Kineo" />
          <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.supporting}>Checking your saved state…</Text>
        </View>
      </V11Shell>
    );
  }

  if (screen.kind === 'error') {
    return (
      <V11Shell key="error">
        <V11BrandMark />
        <V11Emblem caution />
        <V11PageHeader kind="notice" context={screen.error.code==='onlineValidationRequired'?'Connection unavailable':'Not available'} title={screen.error.code==='contentUnavailable'?'We can’t load\nthis routine.':screen.error.code==='onlineValidationRequired'?'Let’s reconnect\nbefore continuing.':'We can’t continue\nfrom here.'} />
        <Text style={styles.supporting}>{errorMessage(screen.error)}</Text>
        <V11PrimaryButton label="Try again" disabled={isSubmitting} onPress={() => void load()} />
      </V11Shell>
    );
  }

  if (screen.kind === 'ageConfirmation') return <V11Shell><V11Topline label="Before we begin" onBack={() => void load()} />
    <V11Question editorial context="A quick check" title={'Are you 18\nor older?'} helper="Kineo is currently available to adults."
      options={[{value:'yes',title:'Yes, I’m 18 or older',detail:'Continue to account setup'},{value:'no',title:'No, I’m under 18',detail:'Kineo is currently for adults only'}] as const}
      onContinue={answer => { if(answer==='no') setScreen({kind:'ageUnavailable'}); else void (async()=>{const result=await submit(()=>service.confirmAdultEligibility());if(result?.ok)await load();})(); }} />
    <Text style={canvasParts.fine}>We only need confirmation—not your date of birth.</Text>
  </V11Shell>;
  if (screen.kind === 'ageUnavailable') return <V11Shell><V11Topline onBack={()=>setScreen({kind:'ageConfirmation'})} /><V11Emblem kind="leaf" />
    <V11PageHeader kind="notice" context="Not available yet" title={'Kineo is for\nadults right now.'} lead="We can’t continue with setup." />
    <V11SecondaryButton label="I answered by mistake" onPress={()=>setScreen({kind:'ageConfirmation'})} />
    <Text style={canvasParts.fine}>You haven’t created an account.</Text></V11Shell>;
  if (onboarding?.step === 'welcome') return <V11Shell><V11BrandMark context="Your daily movement" />
    <V11PageHeader title="Make room for how you feel today." lead="A short check-in. A considered plan. The freedom to take it gently." />
    <V11WelcomeArtwork /><V11PrimaryButton label="Find your starting point" onPress={()=>setScreen({kind:'ageConfirmation'})} />
    {onBackToAccount ? <V11InlineTextAction label="I already have an account" onPress={onBackToAccount} /> : null}
    <Text style={canvasParts.fine}>For adults · General wellness, not medical care</Text></V11Shell>;
  if (onboarding?.step === 'primaryArea') return <V11Shell key="primary-area">
    <V11Question context="Focus area" current={onboardingSteps.primaryArea} total={onboardingStepCount} title="Where would you like to focus?" helper="Choose one area to check in with regularly."
      onBack={onBackToAccount ?? (()=>void load())} options={bodyAreas.map(area=>({value:area,title:areaLabels[area],area}))}
      initial={selectedPrimaryArea} disabled={isSubmitting} onContinue={area=>void(async()=>{setSelectedPrimaryArea(area);const result=await submit(()=>service.savePrimaryArea(area));if(result?.ok)await load();})()} />
    <Text style={canvasParts.fine}>You can change your focus areas later.</Text></V11Shell>;
  if (onboarding?.step === 'secondaryArea') {
    const finish=(area?:BodyArea)=>{setSelectedSecondaryArea(area);setScreen({kind:'weeklyIntention',primaryArea:onboarding.primaryArea});};
    return <V11Shell key="secondary-area"><V11Question context="Your areas" current={onboardingSteps.secondaryArea} total={onboardingStepCount} title="One more area?"
      helper={`${areaLabels[onboarding.primaryArea]} is your main focus. A second area is optional.`}
      onBack={()=>setScreen({kind:'onboardingBack',step:'primaryArea',primaryArea:onboarding.primaryArea})}
      options={bodyAreas.filter(area=>area!==onboarding.primaryArea).map(area=>({value:area,title:areaLabels[area],area}))}
      initial={selectedSecondaryArea} disabled={isSubmitting} cta="Add this area" onContinue={area=>void finish(area)} />
      <V11InlineTextAction label={`Just ${areaLabels[onboarding.primaryArea].toLowerCase()} for now`} onPress={()=>void finish()} />
    </V11Shell>;
  }
  if (screen.kind==='weeklyIntention') return <V11Shell><V11Question context="Your rhythm" current={onboardingSteps.weeklyIntention} total={onboardingStepCount}
    title="What feels realistic this week?" helper="A gentle intention—not a streak to protect." cta="Set my intention" initial={String(weeklyGoalDraft)}
    onBack={()=>setScreen({kind:'onboardingBack',step:'secondaryArea',primaryArea:screen.primaryArea})}
    options={[{value:'2',title:'2 days a week',detail:'A little space to begin'},{value:'3',title:'3 days a week',detail:'Room for movement and rest'},{value:'4',title:'4 days a week',detail:'A more regular check-in'}] as const}
    disabled={isSubmitting} onContinue={days=>void(async()=>{setWeeklyGoalDraft(Number(days));const result=await submit(()=>service.saveWeeklyGoalDays(Number(days)));if(!result?.ok)return;const areas=await submit(()=>service.saveSecondaryArea(selectedSecondaryArea));if(areas?.ok)await load();})()} />
    <Text style={canvasParts.body}>Listening counts, too. Eligible rest choices and intentional stops count alongside completed routines.</Text>
  </V11Shell>;
  if (onboarding?.step === 'safetyBoundary') return <V11Shell><V11ProgressPill current={onboardingSteps.safetyBoundary} total={onboardingStepCount} />
    <V11Topline label="4 of 4" onBack={()=>void(async()=>{const result=await submit(()=>service.loadProfile());if(result?.ok){setWeeklyGoalDraft(result.value.profile.weeklyGoalDays);setSelectedSecondaryArea(result.value.profile.secondaryArea);setScreen({kind:'weeklyIntention',primaryArea:onboarding.primaryArea});}})()} />
    <V11PageHeader context="You stay in control" title={'Guidance.\nNot medical care.'} />
    <V11NoticeCard tone="caution" title="Know the boundary" message="Kineo is not intended for a new injury, sudden or unusual symptoms, postoperative rehabilitation, or emergencies." />
    <V11Checkline>Stop if you feel worse or something feels wrong.</V11Checkline>
    <V11Checkline>Seek appropriate professional help when needed.</V11Checkline>
    <V11Checkline>Some answers mean Kineo will not offer a routine.</V11Checkline>
    <V11PrimaryButton label="I understand" disabled={isSubmitting} onPress={()=>void(async()=>{const result=await submit(()=>service.acknowledgeSafetyBoundary());if(result?.ok)await load();})()} />
    <Text style={canvasParts.fine}>You can pause, stop, or choose a gentler option at any time.</Text>
  </V11Shell>;
  if (onboarding?.step === 'firstCheckIn') return <V11Shell><V11Topline onBack={()=>setScreen({kind:'onboardingBack',step:'safetyBoundary',primaryArea:onboarding.primaryArea})} />
    <V11PageHeader context="Here’s how it works" title={'A small loop.\nBuilt around you.'} />
    <View style={canvasParts.focal}><Text style={canvasParts.badge}>Example — not your plan yet</Text>
      <Text style={styles.v11FocalTitle}>{'Check in.\nSee your options.\nMove at your pace.'}</Text>
      <V11ListRow label="1 · Tell us how you feel" icon="chatbubble-outline" subtitle="A short check-in for each area" />
      <V11ListRow label="2 · Review your plan" icon="list-outline" subtitle="See movements, timing, and the reason" />
      <V11ListRow label="3 · Make your choice" icon="play-outline" subtitle="Move, adapt, or stop" /></View>
    <V11PrimaryButton label="Go to Today" disabled={isSubmitting} onPress={()=>void(async()=>{const result=await submit(()=>service.completeOnboarding());if(result?.ok)await load();})()} />
    <Text style={canvasParts.fine}>No wearable or health score needed.</Text>
  </V11Shell>;
  const attentionPrompt=screen.kind==='start'&&screen.state.kind==='attentionRequired'?screen.state.prompt:screen.kind==='attentionGuidance'?screen.prompt:undefined;
  if (screen.kind==='support') return <V11Shell><V11Topline onBack={()=>setScreen({kind:'attentionGuidance',prompt:screen.prompt})} />
    <V11PageHeader context="Safety & support" title="Listen to that feeling." lead="Kineo cannot assess a new or concerning change." />
    <V11NoticeCard title="When to seek care" message="Seek appropriate professional help if needed. Use urgent or emergency services when the situation may be an emergency." />
    <V11PrimaryButton label="Back to Today" onPress={()=>void load()} /></V11Shell>;
  if (attentionPrompt) return <V11Shell footerPlacement="navigation" bottomBar={<V11FloatingTabBar active="today" onSelect={tab=>void openTab(tab)} />}>
    <V11PageHeader kind="notice" context="Attention required" title="No routine right now." />
    <View style={styles.canvasSafetyFocal}><Ionicons accessible={false} name="shield-outline" size={v11Typography.titleSize} color={v11Colors.safetyAction} /><Text style={styles.canvasSafetyTitle}>Kineo cannot assess this change.</Text>
      <Text style={styles.canvasSafetyBody}>Your {areaLabels[attentionPrompt.area].toLowerCase()} answer described a new, sudden, unusual, or uncertain change.</Text>
      <Text style={styles.canvasSafetyHeading}>Your next step</Text><Text style={styles.canvasSafetyBody}>Seek appropriate professional help if needed. Use urgent or emergency services when the situation may be an emergency.</Text></View>
    <Text style={styles.canvasSafetyBody}>On your next visit, we’ll ask whether this area has returned to its usual recurring pattern.</Text>
    <V11SecondaryButton label="Safety & support" onPress={()=>setScreen({kind:'support',prompt:attentionPrompt})} />
    <V11InlineTextAction label="View my history" onPress={()=>void openTab('progress')} />
  </V11Shell>;
  if(screen.kind==='sessionView')return <V11History progress={todayData.progress??{participationDayCount:0,weeklyParticipationDayCount:0,weeklyGoalDays:defaultWeeklyIntentionDays,recentSessions:[screen.session],areas:[]}} initialSession={screen.session.sessionId} service={service} onToday={()=>void load()} onYou={()=>void openTab('profile')}/>;
  const readyPlan=screen.kind==='start'&&screen.state.kind==='unfinishedPlan'?screen.state.plan:undefined;
  const pausedRoutine=screen.kind==='start'&&screen.state.kind==='unfinishedRoutine'?screen.state.routine:undefined;
  const profile=todayData.profile?.profile;
  const focus=[profile?.primaryArea,profile?.secondaryArea].filter((area):area is BodyArea=>area!==undefined);
  const today=todayData.progress?.currentLocalDay;
  const session=todayData.progress?.recentSessions.find(item=>item.localDay===today);
  return <V11Shell key="today" footerPlacement="navigation" bottomBar={<V11FloatingTabBar active="today" onSelect={tab=>void openTab(tab)} />}>
    {pausedRoutine ? <V11BrandMark context="Your daily movement" /> : null}
    <V11PageHeader today context={pausedRoutine?'Your place is saved':canvasTodayLabel(today)}
      title={pausedRoutine?'Come back\nat your pace.':readyPlan?'A little space to move.':session?'You made space for yourself.':'Start with how you feel.'}
      lead={readyPlan?'Your check-in is saved.':undefined} />
    {pausedRoutine ? <><V11Hero title={`Step ${pausedRoutine.currentStepIndex+displayIndexOffset} is\nwaiting for you.`}
      body={`${pausedRoutine.currentItem?.localizedTitle ?? 'Your movement'} · Your timer is paused.`} label="Resume routine" onPress={()=>setScreen({kind:'routine',routine:pausedRoutine})} />
      <V11SecondaryButton label="End routine" onPress={()=>void pauseForRoutineMenu(pausedRoutine,'end')} /></>
      : readyPlan ? <V11Hero title={`Your ${levelLabel(readyPlan.deliveredLevel).toLowerCase()} ${Math.round(readyPlan.nominalSeconds/secondsPerMinute)}-minute plan.`}
        body={`Your ${areaLabels[readyPlan.primaryArea].toLowerCase()} check-in supports a ${levelLabel(readyPlan.deliveredLevel)} option today.`}
        label="Review your plan" onPress={()=>setScreen({kind:'plan',plan:readyPlan})} />
      : session ? <View style={canvasParts.focal}><Text style={canvasParts.badge}>Saved</Text><Text style={styles.v11FocalTitle}>Today’s routine</Text>
        <Text style={canvasParts.body}>{levelLabel(session.deliveredLevel)} · {areaListLabel(session.areas)}</Text>
        <V11ListRow label="See session" subtitle={routineStatusLabel(session.status)} onPress={()=>setScreen({kind:'sessionView',session})} /></View>
      : <V11Hero title="A few minutes for yourself." body={`Check in with your ${focus.length?areaListLabel(focus).toLowerCase():'focus areas'} before choosing a routine.`}
        label="Check in" onPress={()=>void startCheckIn()} />}
    {todayData.progress ? <V11Rhythm current={todayData.progress.weeklyParticipationDayCount} goal={todayData.progress.weeklyGoalDays}
      today={today} days={todayData.progress.participationLocalDays} onHistory={()=>void openTab('progress')} /> : null}
    {profile && focus.length ? <V11FocusRow areas={focus} onEdit={()=>{if(todayData.profile)setScreen({kind:'profileAreas',profile:todayData.profile});}} /> : null}
    {todayData.failed ? <V11NoticeCard message="Your rhythm and focus summary are temporarily unavailable. Open History or You to try again." /> : null}
    {session?<><Text style={canvasParts.fine}>Multiple sessions today still count as one participation day.</Text><V11SecondaryButton label="Start another check-in" onPress={()=>void startCheckIn()} /></>:null}
    {pausedRoutine?<Text style={canvasParts.fine}>There’s no need to make up time.</Text>:null}
  </V11Shell>;

}

function RoutineVideo({accessibilityLabel}:{accessibilityLabel:string}){return <V11RoutineMediaFrame accessibilityLabel={accessibilityLabel}><V11CanvasArt fit name="neck-glide"/></V11RoutineMediaFrame>;}

function presentedMovementTitle(title:string,area:BodyArea,alternative=false){
  if(!/^Prototype (movement|alternative) \d+$/.test(title))return title;
  return alternative?(area==='neck'?'Seated chin nod':area==='upperMidBack'?'Supported upper-back movement':'Supported lower-back movement'):area==='neck'?'Neck mobility':area==='upperMidBack'?'Upper-back mobility':'Lower-back mobility';
}

/** Approved canvas labels for explicitly prototype-only media; reviewed authored titles remain intact. */
function canvasMovementTitle(step: PlanSequenceStep): string {
  if (step.kind !== 'movement') return 'A moment to settle';
  if (!/^Prototype movement \d+$/.test(step.title)) return step.title;
  return step.area === 'neck' ? 'Neck mobility' : step.area === 'upperMidBack' ? 'Upper-back mobility' : 'Lower-back mobility';
}

function PlanSequence({ plan, onPreview }: { plan: PlanPresentation; onPreview: (index: number) => void }) {
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
        <Text style={styles.v11StepTitle}>{canvasMovementTitle(step)}</Text>
        <Text style={styles.v11Meta}>{step.estimatedSeconds % secondsPerMinute === 0
          ? `${step.estimatedSeconds / secondsPerMinute} min` : `${step.estimatedSeconds} sec`} · {step.kind === 'movement' ? 'sample movement' : 'transition'}</Text>
      </View>
      {step.kind === 'movement' ? <V11InlineTextAction compact label="Preview" onPress={() => onPreview(index)} /> : null}
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
  return areas.map((area) => areaLabels[area]).join(' · ');
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
  canvasQuestionHelp: { minHeight: v11Layout.touchMinimumHeight, alignSelf: 'flex-start', justifyContent: 'center' },
  canvasQuestionHelpLabel: { color: v11Colors.secondaryAction, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight, textDecorationLine: 'underline' },
  canvasReviewFlag: { borderWidth: layout.borderWidth, borderStyle: 'dashed', borderColor: v11Colors.separator,
    borderRadius: v11Canvas.reviewFlagRadius, paddingVertical: spacing.compact, paddingHorizontal: spacing.small, marginTop: spacing.small },
  canvasPlanReason: { gap: spacing.compact, minHeight: v11Layout.touchMinimumHeight },
  canvasPlanReasonTitle: { color: v11Colors.textPrimary, fontSize: v11Canvas.planReasonSize, lineHeight: v11Typography.captionLineHeight, fontWeight: v11Typography.semiboldWeight },
  canvasSafetyFocal: { backgroundColor: v11Colors.safetyActionSurface, borderRadius: v11Layout.focalRadius, padding: spacing.roomy, gap: spacing.standard },
  canvasSafetyBody: { color: v11Colors.safetyAction, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  canvasSafetyTitle: { color: v11Colors.safetyAction, fontSize: v11Typography.titleSize, lineHeight: v11Typography.titleLineHeight, fontWeight: v11Typography.semiboldWeight },
  canvasSafetyHeading: { color: v11Colors.safetyAction, fontSize: v11Typography.choiceSize, lineHeight: v11Typography.choiceLineHeight, fontWeight: v11Typography.semiboldWeight },
  canvasPlanFocal: { ...canvasParts.focal, paddingVertical: spacing.controlVertical, paddingHorizontal: spacing.standard, gap: spacing.compact },
  canvasPlanTitle: { color: v11Colors.textPrimary, fontSize: v11Canvas.planSize, lineHeight: v11Canvas.planLine, fontWeight: v11Typography.strongWeight },
  v11RoutineActionsStacked: { flexDirection: 'column' },
  v11RoutineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact },
  v11RoutineAction: { flexGrow: 1, flexBasis: 0, minWidth: layout.controlMinimumHeight, paddingHorizontal: spacing.compact },
  v11PlanFocal: { ...raisedSurfaceShadow, backgroundColor: v11Colors.focalSurface,
    borderRadius: v11Layout.focalRadius, borderWidth: layout.borderWidth, borderColor: v11Colors.separator,
    padding: spacing.standard, gap: spacing.small },
  v11FocalTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.titleSize,
    lineHeight: v11Typography.titleLineHeight, fontWeight: v11Typography.semiboldWeight },
  v11Meta: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, lineHeight: v11Typography.captionLineHeight },
  v11Body: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
  v11SectionTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.headingSize,
    lineHeight: v11Typography.headingLineHeight, fontWeight: v11Typography.semiboldWeight },
  v11ActionInset: { paddingHorizontal: spacing.screenHorizontal, gap: spacing.compact, alignSelf: 'center', maxWidth: layout.readableWidth, width: '100%' },
  v11Sequence: { gap: spacing.compact },
  v11SequenceHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.compact, alignItems: 'center', minHeight: v11Layout.touchMinimumHeight },
  v11SequenceStep: { minHeight: v11Layout.planStepMinimumHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.small,
    paddingVertical: spacing.compact, borderBottomWidth: layout.borderWidth, borderBottomColor: v11Colors.separator },
  v11StepNumber: { color: v11Colors.textSecondary, fontSize: v11Typography.captionSize, width: spacing.roomy, fontVariant: ['tabular-nums'] },
  v11StepCopy: { flex: 1, gap: spacing.micro },
  v11StepTitle: { color: v11Colors.textPrimary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight, fontWeight: v11Typography.mediumWeight },
  centered: { alignItems: 'center', flex: 1, gap: spacing.standard, justifyContent: 'center' },
  supporting: { color: v11Colors.textSecondary, fontSize: v11Typography.bodySize, lineHeight: v11Typography.bodyLineHeight },
});
