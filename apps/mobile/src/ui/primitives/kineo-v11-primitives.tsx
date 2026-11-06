import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, I18nManager, Pressable, StyleSheet, Text, View,
  useWindowDimensions, type AccessibilityRole, type PressableProps,
  type LayoutRectangle, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { radius, v11Colors as c, v11Layout as l, v11Motion as m,
  v11Spacing as s, v11Typography as t } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const artwork = {
  viewBox: '0 0 320 220', aspectRatio: 320 / 220,
  centerX: 211, centerY: 105, outerRadius: 67, innerRadius: 48,
  tickCount: 24, tickStart: 60, tickEnd: 65, tickWidth: 1.2,
  fullTurn: Math.PI * 2, quarterTurn: Math.PI / 2,
  haloOpacity: 0.12, tickOpacity: 0.45, routeWidth: 20,
  path: 'M32 184 C51 115 139 153 142 92 C145 53 99 61 117 25',
  contour: 'M49 201 C68 132 156 170 159 109 C162 70 116 78 134 42',
  lineWidth: 2, hairlineWidth: 1, routeOpacity: 0.18,
} as const;
const mark = { viewBox: '0 0 20 20', route: 'M5.5 14.5 C6.5 10.5 13.5 10 13.5 6',
  inset: 1, size: 18, radius: 5.5, nodeX: 13.5, nodeY: 6, nodeRadius: 2.1, strokeWidth: 2.2 } as const;
const glyph = { viewBox: '0 0 24 24', strokeWidth: 1.8,
  check: 'M5 12 L10 17 L19 7', info: 'M12 10 V17 M12 7 V7.1',
  shield: 'M12 3 L20 6 V12 C20 17 16 20 12 22 C8 20 4 17 4 12 V6 Z',
  today: 'M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21 M5.6 5.6 L7 7 M17 17 L18.4 18.4 M5.6 18.4 L7 17 M17 7 L18.4 5.6',
  progress: 'M4 19 H21 M7 15 V11 M12 15 V7 M17 15 V4',
  profile: 'M5 21 C5 12 19 12 19 21 M12 3 A4 4 0 1 0 12 11 A4 4 0 1 0 12 3',
} as const;
const tabItems = [
  { id: 'today', label: 'Today', path: glyph.today },
  { id: 'progress', label: 'Progress', path: glyph.progress },
  { id: 'profile', label: 'Profile', path: glyph.profile },
] as const;
export type V11Tab = typeof tabItems[number]['id'];

/** Fail safely to reduced motion until the OS answers, including in Jest. */
export function useV11ReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      receivedChange = true;
      if (active) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !receivedChange) setReduced(value);
    }, () => {
      // Missing native accessibility support must never enable motion by default.
      if (active && !receivedChange) setReduced(true);
    });
    return () => { active = false; subscription?.remove(); };
  }, []);
  return reduced;
}

type MotionPressableProps = Omit<PressableProps, 'style'> & { pressScale?: number; style?: StyleProp<ViewStyle> };
function MotionPressable({ pressScale = m.pressScaleButton, disabled, style,
  onPressIn, onPressOut, onFocus, onBlur, ...props }: MotionPressableProps) {
  const reduced = useV11ReducedMotion();
  const scale = useSharedValue(1);
  const [focused, setFocused] = useState(false);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  useEffect(() => {
    if (reduced || disabled) { cancelAnimation(scale); scale.set(1); }
    return () => cancelAnimation(scale);
  }, [reduced, disabled, scale]);
  return <AnimatedPressable {...props} disabled={disabled}
    pressRetentionOffset={l.pressRetentionOffset}
    accessibilityState={{ ...props.accessibilityState, disabled: Boolean(disabled) }}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); onBlur?.(event); }}
    onPressIn={event => {
      scale.set(reduced || disabled ? 1 : withSpring(pressScale, m.pressSpring));
      onPressIn?.(event);
    }}
    onPressOut={event => {
      scale.set(reduced ? 1 : withSpring(1, m.pressSpring));
      onPressOut?.(event);
    }}
    style={[style, disabled && styles.disabled, focused && styles.focused, animated]} />;
}

function Glyph({ path, color = c.textPrimary, size = l.iconSize }: {
  path: string; color?: typeof c.textPrimary; size?: number;
}) {
  return <Svg width={size} height={size} viewBox={glyph.viewBox} accessible={false}>
    <Path d={path} fill="none" stroke={color} strokeWidth={glyph.strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
}

export function V11BrandMark({ context }: { context?: string }) {
  return <View style={styles.brand}>
    <Svg width={l.brandMarkSize} height={l.brandMarkSize} viewBox={mark.viewBox} accessible={false}>
      <Rect x={mark.inset} y={mark.inset} width={mark.size} height={mark.size}
        rx={mark.radius} fill={c.primaryAction} />
      <Path d={mark.route} fill="none" stroke={c.onPrimaryAction}
        strokeWidth={mark.strokeWidth} strokeLinecap="round" />
      <Circle cx={mark.nodeX} cy={mark.nodeY} r={mark.nodeRadius} fill={c.onPrimaryAction} />
    </Svg>
    <Text style={styles.wordmark}>Kineo</Text>
    {context ? <Text style={styles.brandContext}>{context}</Text> : null}
  </View>;
}

export function V11WelcomeArtwork({ privacyLabel = 'Private by design' }: { privacyLabel?: string }) {
  return <View style={styles.welcomeCard}>
    <Svg width="100%" style={styles.artwork} viewBox={artwork.viewBox} accessible={false}>
      <Circle cx={artwork.centerX} cy={artwork.centerY} r={artwork.outerRadius}
        fill={c.secondaryAction} opacity={artwork.haloOpacity} />
      <Circle cx={artwork.centerX} cy={artwork.centerY} r={artwork.innerRadius}
        stroke={c.secondaryAction} strokeWidth={artwork.hairlineWidth} fill="none" />
      <G stroke={c.secondaryAction} opacity={artwork.tickOpacity}>
        {Array.from({ length: artwork.tickCount }, (_, index) => {
          const angle = index / artwork.tickCount * artwork.fullTurn - artwork.quarterTurn;
          return <Line key={index} strokeWidth={artwork.tickWidth}
            x1={artwork.centerX + Math.cos(angle) * artwork.tickStart}
            y1={artwork.centerY + Math.sin(angle) * artwork.tickStart}
            x2={artwork.centerX + Math.cos(angle) * artwork.tickEnd}
            y2={artwork.centerY + Math.sin(angle) * artwork.tickEnd} />;
        })}
      </G>
      <Path d={artwork.path} stroke={c.secondaryAction} strokeWidth={artwork.routeWidth}
        opacity={artwork.routeOpacity} fill="none" strokeLinecap="round" />
      <Path d={artwork.path} stroke={c.secondaryAction} strokeWidth={artwork.lineWidth}
        fill="none" strokeLinecap="round" />
      <Path d={artwork.contour} stroke={c.secondaryAction} strokeWidth={artwork.hairlineWidth}
        fill="none" strokeLinecap="round" />
      <Circle cx={artwork.centerX} cy={artwork.centerY} r={s.compact} fill={c.primaryAction} />
    </Svg>
    <Text style={styles.artworkCopy}>A brief check-in. One focused routine.</Text>
    <View style={styles.trustRow}>
      {[privacyLabel, 'No routine browsing'].map(label => <View key={label} style={styles.trustChip}>
        <Text style={styles.caption}>{label}</Text>
      </View>)}
    </View>
  </View>;
}

export function V11PageHeader({ context, title, lead }: { context?: string; title: string; lead?: string }) {
  return <View style={styles.header}>
    {context ? <Text style={styles.caption}>{context}</Text> : null}
    <Text accessibilityRole="header" style={styles.display}>{title}</Text>
    {lead ? <Text style={styles.lead}>{lead}</Text> : null}
  </View>;
}

type ButtonProps = Readonly<{ label: string; onPress: () => void; disabled?: boolean;
  accessibilityLabel?: string; accessibilityHint?: string; style?: StyleProp<ViewStyle> }>;
function V11Button({ label, style, tone, ...props }: ButtonProps & { tone: 'primary' | 'secondary' | 'safety' | 'inline' | 'destructive' }) {
  return <MotionPressable {...props} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? label}
    style={[styles.button, styles[tone], style]}>
    <Text style={[styles.buttonLabel, tone === 'primary' && styles.onPrimary,
      tone === 'safety' && styles.safetyLabel, tone === 'destructive' && styles.destructiveLabel, tone === 'inline' && styles.inlineLabel]}>{label}</Text>
  </MotionPressable>;
}
export const V11PrimaryButton = (props: ButtonProps) => <V11Button {...props} tone="primary" />;
export const V11SecondaryButton = (props: ButtonProps) => <V11Button {...props} tone="secondary" />;
export const V11DestructiveButton = (props: ButtonProps) => <V11Button {...props} tone="destructive" />;
export const V11SafetyButton = (props: ButtonProps) => <V11Button {...props} tone="safety" />;
export const V11InlineTextAction = (props: ButtonProps) => <V11Button {...props} tone="inline" />;

export function V11ChoiceRow({ title, detail, selected, onPress, disabled = false,
  role = 'radio', accessibilityLabel, accessibilityHint, leading }: Readonly<{ title: string; detail?: string; selected: boolean;
  accessibilityLabel?: string; accessibilityHint?: string; leading?: ReactNode;
  onPress: () => void; disabled?: boolean; role?: 'radio' | 'checkbox' | 'button' }>) {
  return <MotionPressable accessibilityRole={role} accessibilityHint={accessibilityHint} accessibilityLabel={accessibilityLabel ?? (detail ? `${title}. ${detail}` : title)}
    accessibilityState={role === 'button' ? undefined : { checked: selected }} disabled={disabled} onPress={onPress}
    pressScale={m.pressScaleCard} style={[styles.choice, selected && styles.choiceSelected]}>
    {leading}
    <View style={styles.choiceText}><Text style={styles.choiceTitle}>{title}</Text>
      {detail ? <Text style={styles.lead}>{detail}</Text> : null}</View>
    <View style={[styles.checkCircle, selected && styles.checkSelected]}>
      {selected ? <Glyph path={glyph.check} size={l.smallIconSize} color={c.onPrimaryAction} /> : null}
    </View>
  </MotionPressable>;
}

/** Menu rows keep their exact action name while secondary details remain available as a hint. */
export function V11ListRow({ label, subtitle, value, leading, accessibilityLabel,
  danger = false, disabled = false, onPress }: Readonly<{
  label: string; subtitle?: string; value?: string; leading?: ReactNode;
  accessibilityLabel?: string; danger?: boolean; disabled?: boolean; onPress?: () => void;
}>) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > l.fixedBottomBarMaximumFontScale;
  const content = <>
    {leading}
    <View style={styles.listCopy}>
      <Text style={[styles.listTitle, danger && styles.destructiveLabel]}>{label}</Text>
      {subtitle ? <Text style={styles.listDetail}>{subtitle}</Text> : null}
      {stacked && value !== undefined ? <Text style={styles.listDetail}>{value}</Text> : null}
    </View>
    {!stacked && value !== undefined ? <Text style={styles.listValue}>{value}</Text> : null}
    {onPress ? <Glyph path="M9 5 L16 12 L9 19" size={l.smallIconSize} color={c.textSecondary} /> : null}
  </>;
  const rowStyle = [styles.listRow, danger && styles.listDanger];
  return onPress ? <MotionPressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityHint={[subtitle, value].filter(Boolean).join(', ') || undefined}
    disabled={disabled} onPress={onPress} pressScale={m.pressScaleCard} style={rowStyle}>{content}</MotionPressable>
    : <View style={rowStyle}>{content}</View>;
}

export function V11NoticeCard({ title, message, tone = 'neutral', role }: Readonly<{
  title?: string; message: string; tone?: 'neutral' | 'caution'; role?: AccessibilityRole;
}>) {
  return <View accessible={role !== undefined} accessibilityRole={role}
    accessibilityLabel={role ? [title, message].filter(Boolean).join('. ') : undefined}
    accessibilityLiveRegion={role === 'alert' ? 'polite' : undefined}
    style={[styles.notice, tone === 'caution' && styles.caution]}>
    <View style={styles.noticeHead}>
      <Glyph path={tone === 'caution' ? glyph.shield : glyph.info}
        color={tone === 'caution' ? c.cautionText : c.secondaryAction} size={l.smallIconSize} />
      {title ? <Text style={[styles.noticeTitle, tone === 'caution' && styles.cautionText]}>{title}</Text> : null}
    </View>
    <Text style={[styles.noticeBody, tone === 'caution' && styles.cautionText]}>{message}</Text>
  </View>;
}

export function V11Emblem({ caution = false }: { caution?: boolean }) {
  return <View accessible={false} style={[styles.emblem, caution && styles.caution]}>
    <Glyph path={caution ? glyph.shield : glyph.check} color={caution ? c.safetyAction : c.secondaryAction} />
  </View>;
}

export function V11FloatingTabBar({ active, onSelect }: { active: V11Tab; onSelect: (tab: V11Tab) => void }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > l.fixedBottomBarMaximumFontScale;
  const reduced = useV11ReducedMotion();
  const [width, setWidth] = useState(0);
  const translation = useSharedValue(0);
  const index = tabItems.findIndex(tab => tab.id === active);
  const cellWidth = Math.max(0, width - l.tabInset * 2) / tabItems.length;
  useEffect(() => {
    const visualIndex = I18nManager.isRTL ? tabItems.length - 1 - index : index;
    const target = visualIndex * cellWidth;
    translation.set(reduced || stacked ? target : withSpring(target, m.pillSpring));
    return () => cancelAnimation(translation);
  }, [cellWidth, index, reduced, stacked, translation]);
  const lensStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.get() }] }));
  return <View testID="kineo-primary-tabs" accessible={false} accessibilityRole="tablist" accessibilityLabel="Main navigation"
    onLayout={event => setWidth(event.nativeEvent.layout.width)} style={[styles.tabs, stacked && styles.tabsStacked]}>
    {stacked ? null : <Animated.View pointerEvents="none" style={[styles.lens, I18nManager.isRTL ? styles.tabLensRtl : styles.tabLensLtr, { width: cellWidth }, lensStyle]} />}
    {tabItems.map(tab => <MotionPressable key={tab.id} accessibilityRole="tab" accessibilityLabel={tab.label}
      accessibilityState={{ selected: active === tab.id }} onPress={() => onSelect(tab.id)}
      style={[styles.tab, stacked && styles.tabStacked, stacked && active === tab.id && styles.tabSelected]}>
      <Glyph path={tab.path} color={active === tab.id ? c.activeTab : c.textSecondary} />
      <Text style={[styles.tabLabel, active === tab.id && styles.tabActiveLabel]}>{tab.label}</Text>
    </MotionPressable>)}
  </View>;
}


export type V11BodyArea = 'neck' | 'upperMidBack' | 'lowerBack';
const areaArt = {
  viewBox: '0 0 56 56', headX: 28, headY: 10.5, headRadius: 4.5,
  headOpacity: 0.1, figureWidth: 1.75, focusWidth: 1.8,
  spineWidth: 1.2, spineOpacity: 0.28, spineDash: '2 2',
  torso: 'M25.2 15V18C19 18.8 13 22 13 27.5C13 30 15 31.5 17.5 31.5L19 36.5L16 46H40L37 36.5L38.5 31.5C41 31.5 43 30 43 27.5C43 22 37 18.8 30.8 18V15',
  spine: 'M28 16V44', collarX: 20.5, collarY: 14, collarWidth: 15,
  collarHeight: 7, dualCollarHeight: 5.5, collarRadius: 3.5,
  upper: 'M13.5 23.5C16 19.2 21.5 18.5 28 18.5C34.5 18.5 40 19.2 42.5 23.5C41 29.2 35.5 30.8 28 30.8C20.5 30.8 15 29.2 13.5 23.5Z',
  dualUpper: 'M13.5 25.5C16 23.2 21.5 22.5 28 22.5C34.5 22.5 40 23.2 42.5 25.5C41 29.2 35.5 30.8 28 30.8C20.5 30.8 15 29.2 13.5 25.5Z',
  lower: 'M18.5 34.5C22 33.2 34 33.2 37.5 34.5L39.5 43.5C34.5 45.8 21.5 45.8 16.5 43.5Z',
} as const;

/** Decorative beside a text label; supply label only when used standalone. */
export function V11AreaEmblem({ area = 'neck', areas, label }: {
  area?: V11BodyArea | 'dual'; areas?: readonly V11BodyArea[]; label?: string;
}) {
  const regions = areas?.length ? areas : area === 'dual' ? ['neck', 'upperMidBack'] : [area];
  const combined = regions.includes('neck') && regions.includes('upperMidBack');
  return <View testID={`v11-area-${regions.join('-')}`} accessible={label !== undefined}
    accessibilityRole={label ? 'image' : undefined} accessibilityLabel={label} style={styles.areaEmblem}>
    <Svg width={l.areaEmblemSize} height={l.areaEmblemSize} viewBox={areaArt.viewBox} accessible={false}>
      <Circle cx={areaArt.headX} cy={areaArt.headY} r={areaArt.headRadius}
        fill={c.secondaryAction} fillOpacity={areaArt.headOpacity} stroke={c.secondaryAction} strokeWidth={areaArt.figureWidth} />
      <Path d={areaArt.torso} fill="none" stroke={c.secondaryAction} strokeWidth={areaArt.figureWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={areaArt.spine} stroke={c.secondaryAction} strokeOpacity={areaArt.spineOpacity}
        strokeWidth={areaArt.spineWidth} strokeDasharray={areaArt.spineDash} />
      {regions.includes('neck') ? <Rect x={areaArt.collarX} y={areaArt.collarY} width={areaArt.collarWidth}
        height={combined ? areaArt.dualCollarHeight : areaArt.collarHeight} rx={areaArt.collarRadius}
        fill={c.accent} stroke={c.secondaryAction} strokeWidth={areaArt.focusWidth} /> : null}
      {regions.includes('upperMidBack') ? <Path d={combined ? areaArt.dualUpper : areaArt.upper}
        fill={c.accent} stroke={c.secondaryAction} strokeWidth={areaArt.focusWidth} strokeLinejoin="round" /> : null}
      {regions.includes('lowerBack') ? <Path d={areaArt.lower} fill={c.accent}
        stroke={c.secondaryAction} strokeWidth={areaArt.focusWidth} strokeLinejoin="round" /> : null}
    </Svg>
  </View>;
}

export function V11ProgressPill({ current, total }: { current: number; total: number }) {
  return <View accessible accessibilityLabel={`Step ${current} of ${total}`} style={styles.progressContext}>
    <Text style={styles.caption}>Step {current} of {total}</Text>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.progressTrack}>
      {Array.from({ length: total }, (_, index) => <View key={index}
        style={[styles.progressSegment, index < current && styles.progressSegmentComplete]} />)}
    </View>
  </View>;
}

export function V11SegmentedControl<Value extends string>({ label, options, value, onSelect, disabled = false }: {
  label: string; options: readonly [Readonly<{ value: Value; label: string }>, Readonly<{ value: Value; label: string }>];
  value: Value; onSelect: (value: Value) => void; disabled?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > l.fixedBottomBarMaximumFontScale;
  const reduced = useV11ReducedMotion();
  const [frames, setFrames] = useState<Partial<Record<Value, LayoutRectangle>>>({});
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const positioned = useRef(false);
  const frame = frames[value];
  useEffect(() => {
    if (!frame) return;
    const immediate = reduced || !positioned.current;
    x.set(immediate ? frame.x : withSpring(frame.x, m.pillSpring));
    y.set(immediate ? frame.y : withSpring(frame.y, m.pillSpring));
    positioned.current = true;
    return () => { cancelAnimation(x); cancelAnimation(y); };
  }, [frame, reduced, x, y]);
  const lensStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));
  return <View testID="v11-duration-group" accessibilityRole="radiogroup" accessibilityLabel={label}
    style={[styles.segmented, stacked && styles.segmentedStacked]}>
    {frame ? <Animated.View pointerEvents="none" accessible={false}
      testID="v11-duration-lens" style={[styles.segmentLens, I18nManager.isRTL ? styles.physicalLeftRtl : styles.physicalLeftLtr, { width: frame.width, height: frame.height }, lensStyle]} /> : null}
    {options.map(option => <MotionPressable key={option.value} accessibilityRole="radio"
      accessibilityLabel={option.label} accessibilityState={{ checked: value === option.value }} disabled={disabled}
      onLayout={event => {
        const next = event.nativeEvent.layout;
        setFrames(previous => {
          const old = previous[option.value];
          return old?.x === next.x && old.y === next.y && old.width === next.width && old.height === next.height
            ? previous : { ...previous, [option.value]: next };
        });
      }}
      onPress={() => onSelect(option.value)} style={[styles.segmentOption, stacked && styles.segmentOptionStacked,
        !frame && option.value === value && styles.segmentInitialSelected]}>
      <Text style={[styles.segmentLabel, option.value === value && styles.segmentLabelSelected]}>{option.label}</Text>
    </MotionPressable>)}
  </View>;
}

export { V11Shell } from './kineo-v11-shell';

const listValueMaximumWidth = '42%';
const styles = StyleSheet.create({
  listRow: { minHeight: l.controlMinimumHeight, paddingHorizontal: s.standard, paddingVertical: s.small,
    borderBottomWidth: l.borderWidth, borderBottomColor: c.separator, flexDirection: 'row', alignItems: 'center', gap: s.small },
  listDanger: { backgroundColor: c.cautionSurface },
  listCopy: { flex: 1, minWidth: 0, gap: s.micro },
  listTitle: { color: c.textPrimary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight, fontWeight: t.semiboldWeight },
  listDetail: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  listValue: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight,
    maxWidth: listValueMaximumWidth, flexShrink: 1, textAlign: 'right', fontVariant: [t.timerNumeralVariant] },
  areaEmblem: { width: l.areaEmblemSize, height: l.areaEmblemSize, borderRadius: l.areaEmblemRadius,
    backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  progressContext: { gap: s.compact },
  progressTrack: { flexDirection: 'row', gap: s.micro },
  progressSegment: { height: l.progressTrackHeight, flex: 1, borderRadius: radius.status, backgroundColor: c.separator },
  progressSegmentComplete: { backgroundColor: c.primaryAction },
  segmented: { flexDirection: 'row', padding: l.tabInset, borderRadius: l.controlRadius, backgroundColor: c.softWell, position: 'relative' },
  segmentedStacked: { flexDirection: 'column' },
  physicalLeftRtl: { end: 0 }, physicalLeftLtr: { start: 0 },
  tabLensRtl: { end: l.tabInset }, tabLensLtr: { start: l.tabInset },
  segmentLens: { position: 'absolute', top: 0, borderRadius: l.controlRadius,
    backgroundColor: c.focalSurface, borderWidth: l.selectedBorderWidth, borderColor: c.selectionBorder },
  segmentOption: { flex: 1, minHeight: l.controlMinimumHeight, padding: s.small, alignItems: 'center', justifyContent: 'center', borderRadius: l.controlRadius },
  segmentOptionStacked: { flex: 0 },
  segmentInitialSelected: { backgroundColor: c.focalSurface, borderWidth: l.selectedBorderWidth, borderColor: c.selectionBorder },
  segmentLabel: { color: c.textSecondary, fontSize: t.choiceSize, lineHeight: t.choiceLineHeight, fontWeight: t.mediumWeight, textAlign: 'center' },
  segmentLabelSelected: { color: c.textPrimary, fontWeight: t.strongWeight },
  disabled: { opacity: l.disabledOpacity },
  focused: { outlineColor: c.selectionBorder, outlineWidth: l.selectedBorderWidth, outlineOffset: s.micro },
  brand: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: s.compact },
  wordmark: { color: c.textPrimary, fontSize: t.sectionSize, fontWeight: t.strongWeight },
  brandContext: { flexGrow: 1, flexShrink: 1, color: c.textSecondary, textAlign: 'right', fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  welcomeCard: { backgroundColor: c.focalSurface, borderRadius: l.focalRadius, padding: s.standard,
    borderColor: c.separator, borderWidth: l.borderWidth, gap: s.small,
    shadowColor: c.shadow, shadowOffset: { width: 0, height: l.shadowOffsetY },
    shadowOpacity: l.shadowOpacity, shadowRadius: l.shadowRadius, elevation: l.elevation },
  artwork: { aspectRatio: artwork.aspectRatio },
  artworkCopy: { color: c.textPrimary, fontSize: t.headingSize, lineHeight: t.headingLineHeight, fontWeight: t.semiboldWeight },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap', gap: s.compact },
  trustChip: { borderRadius: radius.status, backgroundColor: c.softWell, paddingHorizontal: s.small, paddingVertical: s.compact },
  caption: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  header: { gap: s.small },
  display: { color: c.textPrimary, fontSize: t.displaySize, lineHeight: t.displayLineHeight,
    fontWeight: t.strongWeight, letterSpacing: t.displayTracking },
  lead: { color: c.textSecondary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight },
  button: { minWidth: l.touchMinimumHeight, minHeight: l.controlMinimumHeight, borderRadius: l.controlRadius,
    paddingHorizontal: s.standard, paddingVertical: s.controlVertical, justifyContent: 'center', alignItems: 'center' },
  primary: { backgroundColor: c.primaryAction },
  secondary: { backgroundColor: c.surface, borderWidth: l.borderWidth, borderColor: c.separator },
  destructive: { backgroundColor: c.surface, borderWidth: l.borderWidth, borderColor: c.destructive },
  destructiveLabel: { color: c.destructive },
  safety: { backgroundColor: c.safetyActionSurface, borderWidth: l.borderWidth, borderColor: c.safetyActionBorder },
  inline: { backgroundColor: 'transparent' },
  buttonLabel: { color: c.textPrimary, fontSize: t.choiceSize, lineHeight: t.choiceLineHeight, fontWeight: t.semiboldWeight, textAlign: 'center' },
  onPrimary: { color: c.onPrimaryAction }, safetyLabel: { color: c.safetyAction }, inlineLabel: { color: c.secondaryAction },
  choice: { flexDirection: 'row', alignItems: 'center', gap: s.small, minHeight: l.choiceMinimumHeight,
    padding: s.standard, borderRadius: l.choiceRadius, borderWidth: l.borderWidth, borderColor: c.separator, backgroundColor: c.surface },
  choiceSelected: { borderWidth: l.selectedBorderWidth, borderColor: c.selectionBorder, backgroundColor: c.accentSoft },
  choiceText: { flex: 1, gap: s.micro },
  choiceTitle: { color: c.textPrimary, fontSize: t.choiceSize, lineHeight: t.choiceLineHeight, fontWeight: t.semiboldWeight },
  checkCircle: { width: s.roomy, height: s.roomy, borderRadius: radius.status, borderWidth: l.borderWidth,
    borderColor: c.textSecondary, alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: c.primaryAction, borderColor: c.selectionBorder },
  notice: { borderRadius: radius.option, borderWidth: l.borderWidth, borderColor: c.separator,
    padding: s.standard, gap: s.micro, backgroundColor: c.softWell },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: s.compact },
  noticeTitle: { flex: 1, color: c.textPrimary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.semiboldWeight },
  noticeBody: { color: c.textPrimary, fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  caution: { backgroundColor: c.cautionSurface, borderColor: c.safetyActionBorder }, cautionText: { color: c.cautionText },
  emblem: { width: l.emblemSize, height: l.emblemSize, borderRadius: radius.status,
    backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  tabs: { marginHorizontal: s.large, marginVertical: s.micro, padding: l.tabInset, flexDirection: 'row',
    borderRadius: l.tabRadius, backgroundColor: c.softWell, position: 'relative' },
  tabsStacked: { flexDirection: 'column', gap: s.micro },
  lens: { position: 'absolute', top: l.tabInset, bottom: l.tabInset,
    borderRadius: l.tabRadius, backgroundColor: c.surface, shadowColor: c.shadow,
    shadowOpacity: l.cardShadowOpacity, shadowRadius: l.cardShadowRadius,
    shadowOffset: { width: 0, height: l.cardShadowOffsetY }, elevation: l.cardElevation },
  tab: { flex: 1, minHeight: l.tabMinimumHeight, minWidth: l.touchMinimumHeight,
    borderRadius: l.tabRadius, alignItems: 'center', justifyContent: 'center', gap: s.micro, padding: s.compact },
  tabStacked: { flex: 0, flexDirection: 'row', justifyContent: 'flex-start', gap: s.small },
  tabSelected: { backgroundColor: c.surface }, tabPressed: { opacity: l.pressedOpacity },
  tabLabel: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.mediumWeight },
  tabActiveLabel: { color: c.activeTab, fontWeight: t.strongWeight },
});
