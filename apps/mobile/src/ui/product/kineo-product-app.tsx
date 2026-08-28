import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { KineoProductServing } from '@/application/kineo-product-service';
import {
  bodyAreas,
  type BodyArea,
} from '@/core/domain/selection-domain';
import type {
  ProductFlowError,
  ProductStartState,
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
  | Readonly<{ kind: 'ageUnavailable' }>;

type KineoProductAppProps = Readonly<{
  service: KineoProductServing;
  onDeleted: () => void;
}>;

const areaLabels: Readonly<Record<BodyArea, string>> = Object.freeze({
  neck: 'Neck',
  upperMidBack: 'Upper & mid back',
  lowerBack: 'Lower back',
});

function errorMessage(error: ProductFlowError): string {
  if (error.code === 'invalidState' || error.code === 'invalidData') {
    return "Kineo couldn't continue from that state. Try again.";
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

export function KineoProductApp({ service, onDeleted }: KineoProductAppProps) {
  const [screen, setScreen] = useState<LocalScreen>({ kind: 'loading' });
  const [selectedPrimaryArea, setSelectedPrimaryArea] = useState<BodyArea>();
  const [selectedSecondaryArea, setSelectedSecondaryArea] = useState<BodyArea>();
  const [isSubmitting, setIsSubmitting] = useState(false);

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
            Stop if a movement feels wrong. Kineo will withhold a routine when your answers need more caution.
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
    return (
      <Shell>
        <PageHeader eyebrow="ATTENTION REQUIRED" title="Pause before another routine." />
        <Text style={styles.supporting}>
          Your earlier answer for {areaLabels[screen.state.area].toLowerCase()} needs a fresh safety check before Kineo can continue.
        </Text>
        <PrimaryButton label="Review now" onPress={() => undefined} />
      </Shell>
    );
  }

  if (screen.kind === 'start' && screen.state.kind === 'unfinishedRoutine') {
    return (
      <Shell>
        <PageHeader eyebrow="ROUTINE SAVED" title="Pick up where you left off." />
        <Text style={styles.supporting}>Your last completed step is safely stored.</Text>
        <PrimaryButton label="Resume routine" onPress={() => undefined} />
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
        <PrimaryButton label="Check in" onPress={() => undefined} />
      </View>
      <View style={styles.testSection}>
        <Text style={styles.testLabel}>TESTING</Text>
        <SecondaryButton
          label="Reset demo to first use"
          disabled={isSubmitting}
          danger
          onPress={() => void (async () => {
            const result = await submit(() => service.deleteAllData());
            if (result?.ok) onDeleted();
          })()}
        />
      </View>
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
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.72 },
  optionList: { gap: spacing.compact },
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
  todayCardEyebrow: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
  todayCardTitle: { color: colors.ink, fontSize: typography.titleSize, fontWeight: typography.displayWeight, lineHeight: typography.titleLineHeight },
  todayCardBody: { color: colors.secondaryInk, fontSize: typography.bodySize, lineHeight: typography.bodyLineHeight },
  testSection: { borderTopColor: colors.border, borderTopWidth: layout.borderWidth, gap: spacing.compact, marginTop: spacing.section, paddingTop: spacing.standard },
  testLabel: { color: colors.secondaryInk, fontSize: typography.eyebrowSize, fontWeight: typography.strongWeight, letterSpacing: typography.eyebrowTracking },
});
