import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { G, Line, Path } from 'react-native-svg';

import { v11Colors as c, v11Layout as l, v11Motion as m,
  v11Spacing as s, v11Typography as t, radius } from '../theme/tokens';
import { V11AreaEmblem, useV11ReducedMotion, type V11BodyArea } from './kineo-v11-primitives';

const dial = {
  viewBox: '0 0 120 120', centerX: 60, centerY: 56, radius: 45,
  startDegrees: 135, sweepDegrees: 270, degreesPerHalfTurn: 180,
  tickCount: 24, cardinalEvery: 6, cardinalInner: 50, cardinalOuter: 56,
  tickInner: 51.5, tickOuter: 54.5, tickOpacity: 0.55, cardinalOpacity: 0.78,
  tickWidth: 1.6, cardinalWidth: 2.1, trackWidth: 7.5, progressWidth: 3,
  readoutSize: 25, readoutLineHeight: 32, readoutTracking: -0.75,
  secondsPerMinute: 60, readoutDigits: 2,
  path: 'M28.1802 87.8198A45 45 0 1 1 91.8198 87.8198',
  iconViewBox: '0 0 24 24', checkPath: 'M5 12L10 17L19 7', iconStroke: 2,
} as const;
const arcLength = dial.radius * dial.sweepDegrees * Math.PI / dial.degreesPerHalfTurn;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const choreography = m.completion;

export function formatV11Countdown(seconds: number): string {
  const remaining = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(remaining / dial.secondsPerMinute);
  return `${String(minutes).padStart(dial.readoutDigits, '0')}:${String(remaining % dial.secondsPerMinute).padStart(dial.readoutDigits, '0')}`;
}

export function V11RoutineMediaFrame({ children, accessibilityLabel }: {
  children: ReactNode; accessibilityLabel: string;
}) {
  return <View style={styles.mediaFrame}>
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={styles.mediaContent}>{children}</View>
    <View style={styles.mediaFooter}>
      <Text style={styles.provenance}>Sample media · pending review</Text>
    </View>
  </View>;
}

export function V11RoutineTransition({ area }: { area: V11BodyArea }) {
  return <View accessible accessibilityRole="image" accessibilityLabel="Routine transition" style={styles.transition}>
    <V11AreaEmblem area={area} />
    <Text style={styles.transitionLabel}>Next movement</Text>
  </View>;
}

/** Ring interpolation is visual only; authoritative elapsed time remains in the service. */
export function V11TimerDial({ remainingSeconds, totalSeconds }: { remainingSeconds: number; totalSeconds: number }) {
  const { fontScale } = useWindowDimensions();
  const reduced = useV11ReducedMotion();
  const progress = useSharedValue(0);
  const target = totalSeconds > 0 ? Math.max(0, Math.min(1, 1 - remainingSeconds / totalSeconds)) : 1;
  useEffect(() => {
    progress.set(reduced ? target : withTiming(target, m.progressTiming));
    return () => cancelAnimation(progress);
  }, [target, reduced, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: arcLength * (1 - progress.get()) }));
  const largeText = fontScale > l.fixedBottomBarMaximumFontScale;
  const size = l.timerDialSize * fontScale;
  return <View testID="v11-countdown" accessible accessibilityRole="progressbar" accessibilityLabel="Movement timer"
    accessibilityValue={{ min: 0, max: totalSeconds, now: Math.max(0, totalSeconds - remainingSeconds), text: `${formatV11Countdown(remainingSeconds)} remaining` }}
    style={largeText ? styles.largeDial : { width: size, height: size }}>
    {largeText ? null : <Svg width={size} height={size} viewBox={dial.viewBox} accessible={false}>
      <G stroke={c.textSecondary} strokeLinecap="round">
        {Array.from({ length: dial.tickCount }, (_, index) => {
          const cardinal = index % dial.cardinalEvery === 0;
          const angle = (dial.startDegrees + index * dial.sweepDegrees / (dial.tickCount - 1)) * Math.PI / dial.degreesPerHalfTurn;
          const inner = cardinal ? dial.cardinalInner : dial.tickInner;
          const outer = cardinal ? dial.cardinalOuter : dial.tickOuter;
          return <Line key={index} x1={dial.centerX + Math.cos(angle) * inner} y1={dial.centerY + Math.sin(angle) * inner}
            x2={dial.centerX + Math.cos(angle) * outer} y2={dial.centerY + Math.sin(angle) * outer}
            strokeWidth={cardinal ? dial.cardinalWidth : dial.tickWidth} opacity={cardinal ? dial.cardinalOpacity : dial.tickOpacity} />;
        })}
      </G>
      <Path d={dial.path} fill="none" stroke={c.separator} strokeWidth={dial.trackWidth} strokeLinecap="round" />
      <AnimatedPath d={dial.path} fill="none" stroke={c.primaryAction} strokeWidth={dial.progressWidth}
        strokeLinecap="round" strokeDasharray={[arcLength, arcLength]} animatedProps={animatedProps} />
    </Svg>}
    <View pointerEvents="none" style={largeText ? undefined : styles.readoutOverlay}>
      <Text accessible={false} style={styles.readout}>{formatV11Countdown(remainingSeconds)}</Text>
    </View>
  </View>;
}

export function V11TimerStatePill({ label, completed = false, ready = false }: { label: string; completed?: boolean; ready?: boolean }) {
  return <View testID="v11-timer-state" accessible accessibilityLabel={label}
    accessibilityLiveRegion={completed ? 'polite' : 'none'} style={[styles.statePill, (completed || ready) && styles.statePillDone]}>
    {completed ? <Svg testID="v11-step-check" width={l.completionIconSize} height={l.completionIconSize} viewBox={dial.iconViewBox} accessible={false}>
      <Path d={dial.checkPath} fill="none" stroke={c.secondaryAction} strokeWidth={dial.iconStroke} strokeLinecap="round" strokeLinejoin="round" />
    </Svg> : null}
    <Text style={styles.stateLabel}>{label}</Text>
  </View>;
}

/** A single, cancelable completion moment. It never advances or unlocks the routine itself. */
export function V11RoutinePacing({ mode, remainingSeconds = 0, totalSeconds = 0, statusLabel, guidance, controls }: {
  mode: 'counting' | 'complete' | 'transition' | 'repetitions'; remainingSeconds?: number; totalSeconds?: number;
  statusLabel: string; guidance: string; controls?: ReactNode;
}) {
  const reduced = useV11ReducedMotion();
  const showDial = mode === 'counting' || mode === 'complete';
  const complete = mode === 'complete';
  const [measuredHeight, setMeasuredHeight] = useState<number>(l.timerDialSize);
  const fold = useSharedValue(mode === 'counting' ? 1 : 0);
  const pulse = useSharedValue(1);
  const pillRise = useSharedValue(1);
  const captionRise = useSharedValue(1);
  const controlsRise = useSharedValue(1);
  const wasComplete = useRef(complete);
  const announcedComplete = useRef(false);
  useEffect(() => {
    if (complete && !announcedComplete.current) AccessibilityInfo.announceForAccessibility(statusLabel);
    announcedComplete.current = complete;
  }, [complete, statusLabel]);
  useEffect(() => {
    const newlyCompleted = complete && !wasComplete.current;
    wasComplete.current = complete;
    const values = [fold, pulse, pillRise, captionRise, controlsRise];
    const cancel = () => values.forEach(value => cancelAnimation(value));
    cancel();
    pulse.set(1);
    if (!newlyCompleted || reduced) {
      fold.set(mode === 'counting' ? 1 : 0);
      pillRise.set(1); captionRise.set(1); controlsRise.set(1);
      return cancel;
    }
    fold.set(1);
    pillRise.set(0); captionRise.set(0); controlsRise.set(0);
    const pulseRiseDuration = choreography.holdDuration * choreography.pulseRiseFraction;
    pulse.set(withSequence(
      withTiming(choreography.pulsePeak, { duration: pulseRiseDuration, easing: choreography.easing }),
      withTiming(1, { duration: choreography.holdDuration - pulseRiseDuration, easing: choreography.easing }),
    ));
    fold.set(withDelay(choreography.holdDuration, withTiming(0, {
      duration: choreography.foldDuration, easing: choreography.easing,
    })));
    [pillRise, captionRise, controlsRise].forEach((value, index) => {
      value.set(withDelay(choreography.holdDuration + index * choreography.stagger,
        withTiming(1, { duration: choreography.riseDuration, easing: choreography.riseEasing })));
    });
    return cancel;
  }, [complete, mode, reduced, fold, pulse, pillRise, captionRise, controlsRise]);
  // The owner's explicit dial fold is bounded to this measured stage; body text is never height-clamped.
  const dialStage = useAnimatedStyle(() => ({ height: measuredHeight * fold.get(), opacity: fold.get(),
    transform: [{ translateY: choreography.foldLift * (1 - fold.get()) }, { scale: choreography.foldScale + (1 - choreography.foldScale) * fold.get() }] }));
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  const pillStyle = useAnimatedStyle(() => ({ opacity: choreography.initialRiseOpacity + (1 - choreography.initialRiseOpacity) * pillRise.get(),
    transform: [{ translateY: choreography.riseDistance * (1 - pillRise.get()) }, { scale: choreography.initialRiseScale + (1 - choreography.initialRiseScale) * pillRise.get() }] }));
  const captionStyle = useAnimatedStyle(() => ({ opacity: choreography.initialRiseOpacity + (1 - choreography.initialRiseOpacity) * captionRise.get(),
    transform: [{ translateY: choreography.riseDistance * (1 - captionRise.get()) }] }));
  const controlsStyle = useAnimatedStyle(() => ({ opacity: choreography.initialRiseOpacity + (1 - choreography.initialRiseOpacity) * controlsRise.get(),
    transform: [{ translateY: choreography.riseDistance * (1 - controlsRise.get()) }] }));
  return <View style={styles.pacing}>
    {showDial ? <Animated.View testID="v11-dial-stage" accessibilityElementsHidden={complete}
      importantForAccessibility={complete ? 'no-hide-descendants' : 'auto'} style={[styles.dialStage, dialStage]}>
      <Animated.View onLayout={event => setMeasuredHeight(event.nativeEvent.layout.height)} style={[styles.dialContent, pulseStyle]}>
        <V11TimerDial remainingSeconds={remainingSeconds} totalSeconds={totalSeconds} />
      </Animated.View>
    </Animated.View> : null}
    <Animated.View style={pillStyle}><V11TimerStatePill label={statusLabel} completed={complete} ready={mode === 'transition'} /></Animated.View>
    <Animated.View style={captionStyle}><Text style={styles.guidance}>{guidance}</Text></Animated.View>
    {controls ? <Animated.View style={[styles.controls, controlsStyle]}>{controls}</Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  mediaFrame: { borderRadius: l.routineMediaRadius, borderWidth: l.borderWidth, borderColor: c.separator,
    backgroundColor: c.softWell, overflow: 'hidden' },
  mediaContent: { height: l.routineVideoHeight },
  mediaFooter: { minHeight: l.routineMediaFooterHeight, paddingHorizontal: s.standard, paddingVertical: s.micro,
    borderTopWidth: l.borderWidth, borderTopColor: c.separator, justifyContent: 'center', backgroundColor: c.softWell },
  provenance: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, textAlign: 'right', fontWeight: t.mediumWeight },
  transition: { minHeight: l.routineVideoHeight, alignItems: 'center', justifyContent: 'center', gap: s.small,
    backgroundColor: c.softWell, borderRadius: l.routineMediaRadius },
  transitionLabel: { color: c.textSecondary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight },
  readoutOverlay: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  readout: { color: c.textPrimary, fontSize: dial.readoutSize, lineHeight: dial.readoutLineHeight,
    letterSpacing: dial.readoutTracking, fontWeight: t.strongWeight, fontVariant: ['tabular-nums'], textAlign: 'center' },
  largeDial: { padding: s.small },
  statePill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: s.compact,
    borderRadius: radius.status, paddingHorizontal: s.controlVertical, paddingVertical: s.micro,
    borderWidth: l.borderWidth, borderColor: c.separator, backgroundColor: c.softWell, elevation: 0 },
  statePillDone: { borderColor: c.selectionBorder, backgroundColor: c.accentSoft },
  stateLabel: { color: c.textPrimary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.semiboldWeight, textAlign: 'center', flexShrink: 1 },
  pacing: { alignItems: 'center', gap: s.micro },
  dialStage: { width: '100%', overflow: 'hidden', alignItems: 'center' },
  dialContent: { alignItems: 'center', width: '100%' },
  guidance: { marginTop: s.small, color: c.textSecondary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight, textAlign: 'center' },
  controls: { marginTop: s.large, width: '100%' },
});
