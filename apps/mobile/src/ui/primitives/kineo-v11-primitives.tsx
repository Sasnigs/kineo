import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, I18nManager, Pressable, StyleSheet, Text, View,
  useWindowDimensions, type AccessibilityRole, type PressableProps,
  type LayoutRectangle, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { v11Canvas as cv, radius, v11Colors as c, v11Layout as l, v11Motion as m,
  v11Spacing as s, v11Typography as t } from '../theme/tokens';

import { V11CanvasArt } from './kineo-v11-canvas-artwork';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
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
  { id: 'progress', label: 'History', path: glyph.progress },
  { id: 'profile', label: 'You', path: glyph.profile },
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
    <Svg width={cv.brandSize} height={cv.brandSize} viewBox={mark.viewBox} accessible={false}>
      <Rect x={mark.inset} y={mark.inset} width={mark.size} height={mark.size}
        rx={mark.radius} fill={c.primaryAction} />
      <Path d={mark.route} fill="none" stroke={c.accent}
        strokeWidth={mark.strokeWidth} strokeLinecap="round" />
      <Circle cx={mark.nodeX} cy={mark.nodeY} r={mark.nodeRadius} fill={c.onPrimaryAction} />
    </Svg>
    <Text style={styles.wordmark}>Kineo</Text>
    {context ? <Text style={styles.brandContext}>{context}</Text> : null}
  </View>;
}

export function V11WelcomeArtwork({ privacyLabel: _privacyLabel }: { privacyLabel?: string }) {
  return <View style={styles.welcomeArt}>
    <View accessible accessibilityRole="image" accessibilityLabel="Example: Neck, Limited check-in; Gentle five-minute plan; movement at your pace."><V11CanvasArt name="welcome" /></View>
    <Text style={styles.welcomeCaption}>One example of how your check-in shapes a plan.</Text>
  </View>;
}

export function V11PageHeader({ context, title, lead, kind = 'editorial', today = false }: { context?: string; title: string; lead?: string; kind?: 'editorial' | 'notice' | 'question' | 'routine'; today?: boolean }) {
  return <View style={styles.header}>
    {context ? <Text style={[styles.context, kind === 'notice' && styles.noticeContext]}>{context}</Text> : null}
    <Text accessibilityRole="header" accessibilityLabel={title.replace(/\s+/g, ' ')} style={[styles.display, (today || kind === 'notice' || kind === 'question') && styles.questionDisplay, kind === 'routine' && {fontSize:cv.routineSize,lineHeight:cv.routineLine}]}>{title}</Text>
    {lead ? <Text style={styles.lead}>{lead}</Text> : null}
  </View>;
}

type ButtonProps = Readonly<{ label: string; onPress: () => void; disabled?: boolean;
  compact?: boolean; icon?: keyof typeof Ionicons.glyphMap; hero?: boolean; accessibilityLabel?: string; accessibilityHint?: string; style?: StyleProp<ViewStyle> }>;
function V11Button({ label, style, tone, hero = false, disabled, icon, compact = false, ...props }: ButtonProps & { tone: 'primary' | 'secondary' | 'safety' | 'inline' | 'destructive' }) {
  return <MotionPressable {...props} hitSlop={compact ? s.compact : undefined} disabled={disabled} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? label}
    style={[styles.button, styles[tone], hero && styles.heroButton, compact && styles.compactButton, disabled && styles.disabledButton, style]}>
    {icon ? <Ionicons accessible={false} name={icon} size={cv.rowIcon} color={disabled ? c.textSecondary : hero ? c.heroActionInk : tone === 'primary' ? c.onPrimaryAction : tone === 'safety' ? c.safetyAction : c.secondaryAction} /> : null}
    <Text style={[styles.buttonLabel, tone === 'primary' && styles.onPrimary,
      tone === 'safety' && styles.safetyLabel, tone === 'destructive' && styles.destructiveLabel, tone === 'inline' && styles.inlineLabel, hero && styles.heroButtonLabel, compact && styles.compactLabel, disabled && styles.disabledLabel]}>{label}</Text>
  </MotionPressable>;
}
export const V11PrimaryButton = (props: ButtonProps) => <V11Button {...props} tone="primary" />;
export const V11SecondaryButton = (props: ButtonProps) => <V11Button {...props} tone="secondary" />;
export const V11DestructiveButton = (props: ButtonProps) => <V11Button {...props} tone="destructive" />;
export const V11SafetyButton = (props: ButtonProps) => <V11Button icon="shield-outline" {...props} tone="safety" />;
export const V11InlineTextAction = (props: ButtonProps) => <V11Button {...props} tone="inline" />;

export function V11ChoiceRow({ title, detail, selected, onPress, disabled = false,
  role = 'radio', accessibilityLabel, accessibilityHint, leading, area = false }: Readonly<{ title: string; detail?: string; selected: boolean;
  accessibilityLabel?: string; accessibilityHint?: string; leading?: ReactNode;
  area?: boolean; onPress: () => void; disabled?: boolean; role?: 'radio' | 'checkbox' | 'button' }>) {
  return <MotionPressable accessibilityRole={role} accessibilityHint={accessibilityHint} accessibilityLabel={accessibilityLabel ?? (detail ? `${title}. ${detail}` : title)}
    accessibilityState={role === 'button' ? undefined : { checked: selected }} disabled={disabled} onPress={onPress}
    pressScale={m.pressScaleCard} style={[styles.choice, area && styles.areaChoice, selected && styles.choiceSelected]}>
    {leading}
    <View style={styles.choiceText}><Text style={styles.choiceTitle}>{title}</Text>
      {detail ? <Text style={styles.caption}>{detail}</Text> : null}</View>
    <View style={[styles.checkCircle, selected && styles.checkSelected]}>
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
  </MotionPressable>;
}

/** Menu rows keep their exact action name while secondary details remain available as a hint. */
export function V11ListRow({ label, subtitle, value, leading, accessibilityLabel,
  danger = false, disabled = false, onPress, icon }: Readonly<{
  label: string; subtitle?: string; value?: string; leading?: ReactNode; icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string; danger?: boolean; disabled?: boolean; onPress?: () => void;
}>) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > l.fixedBottomBarMaximumFontScale;
  const content = <>
    {leading ?? (icon ? <Ionicons accessible={false} name={icon} size={cv.rowIcon} color={danger ? c.destructive : c.secondaryAction} /> : null)}
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

export function V11Emblem({ caution = false, kind }: { caution?: boolean; kind?: keyof typeof Ionicons.glyphMap }) {
  return <View accessible={false} style={[styles.emblem, caution && styles.caution]}>
    {kind ? <Ionicons name={kind === 'leaf' ? 'leaf-outline' : kind === 'mail' ? 'mail-outline' : kind} color={caution?c.safetyAction:c.secondaryAction} size={cv.daySize} /> : <Glyph path={caution ? glyph.shield : glyph.check} color={caution ? c.safetyAction : c.secondaryAction} />}
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
export function V11AreaEmblem({ area, areas, label }: { area?: V11BodyArea | 'dual'; areas?: readonly V11BodyArea[]; label?: string }) {
  const kind = area ?? (areas?.length === 2 ? 'dual' : areas?.[0]) ?? 'neck';
  const name = kind === 'upperMidBack' ? 'upper' : kind === 'lowerBack' ? 'lower' : kind;
  return <View testID={`v11-area-${kind}`} accessible={Boolean(label)} accessibilityLabel={label}
    accessibilityRole={label ? 'image' : undefined} style={styles.areaEmblem}>
    <V11CanvasArt name={name} regions={areas?.map(item => item === 'upperMidBack' ? 'upper' : item === 'lowerBack' ? 'lower' : 'neck')} />
  </View>;
}

export function V11ProgressPill({ current, total }: { current: number; total: number }) {
  const percent = Math.min(1, Math.max(0, current / Math.max(1, total))) * fullProgressPercent;
  return <View accessible accessibilityLabel={`Step ${current} of ${total}`} style={styles.progressTrack}>
    <View style={[styles.progressFill, { width: `${percent}%` }]} />
  </View>;
}
const fullProgressPercent = 100;

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
  compactButton: { minHeight: cv.chipHeight, paddingVertical: s.micro, borderRadius: radius.status, backgroundColor: c.softWell },
  compactLabel: { fontSize: cv.chipSize, lineHeight: t.captionLineHeight },
  welcomeArt: { gap: s.small, marginVertical: s.small },
  welcomeCaption: { color: c.textSecondary, fontSize: cv.captionSize, lineHeight: cv.captionLine },
  context: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.semiboldWeight },
  noticeContext: { color: c.safetyAction },
  questionDisplay: { fontSize: cv.questionSize, lineHeight: cv.questionLine, letterSpacing: cv.questionTracking },
  disabledButton: { backgroundColor: c.softWell, borderWidth: 0, shadowOpacity: 0, elevation: 0 }, disabledLabel: { color: c.textSecondary },
  heroButton: { backgroundColor: c.heroAction }, heroButtonLabel: { color: c.heroActionInk },
  listRow: { backgroundColor: 'transparent', minHeight: cv.rowMinimum, paddingHorizontal: 0, paddingVertical: s.standard,
    borderBottomWidth: l.borderWidth, borderBottomColor: c.separator, flexDirection: 'row', alignItems: 'center', gap: s.small },
  listDanger: { backgroundColor: c.cautionSurface },
  listCopy: { flex: 1, minWidth: 0, gap: s.micro },
  listTitle: { color: c.textPrimary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight, fontWeight: t.semiboldWeight },
  listDetail: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  listValue: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight,
    maxWidth: listValueMaximumWidth, flexShrink: 1, textAlign: 'right', fontVariant: [t.timerNumeralVariant] },
  areaEmblem: { width: cv.areaSize, height: cv.areaSize, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'relative', height: l.progressTrackHeight, backgroundColor: c.softWell, borderRadius: radius.status, overflow: 'hidden' },
  progressFill: { position: 'absolute', top: 0, bottom: 0, start: 0, borderRadius: radius.status, backgroundColor: c.textPrimary },
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
  disabled: { opacity: 1 },
  focused: { outlineColor: c.selectionBorder, outlineWidth: l.selectedBorderWidth, outlineOffset: s.micro },
  brand: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: s.compact },
  wordmark: { color: c.textPrimary, fontSize: cv.brandWordmark, fontWeight: t.strongWeight },
  brandContext: { flexGrow: 1, flexShrink: 1, color: c.textSecondary, textAlign: 'right', fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  caption: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  header: { gap: s.small },
  display: { color: c.textPrimary, fontSize: cv.editorialSize, lineHeight: cv.editorialLine,
    fontWeight: t.strongWeight, letterSpacing: cv.editorialTracking },
  lead: { color: c.textSecondary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight },
  button: { minWidth: l.touchMinimumHeight, minHeight: l.controlMinimumHeight, borderRadius: cv.buttonRadius,
    paddingHorizontal: s.standard, paddingVertical: s.controlVertical, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: s.compact },
  primary: { backgroundColor: c.primaryAction, shadowColor: c.shadow, shadowOpacity: l.cardShadowOpacity,
    shadowRadius: l.cardShadowRadius, shadowOffset: { width: 0, height: l.cardShadowOffsetY }, elevation: l.cardElevation },
  secondary: { backgroundColor: c.softWell, borderWidth: l.borderWidth, borderColor: c.separator },
  destructive: { backgroundColor: c.surface, borderWidth: l.borderWidth, borderColor: c.destructive },
  destructiveLabel: { color: c.destructive },
  safety: { backgroundColor: c.safetyActionSurface, borderWidth: l.borderWidth, borderColor: c.safetyActionBorder },
  inline: { backgroundColor: 'transparent', minHeight: l.touchMinimumHeight },
  buttonLabel: { color: c.textPrimary, fontSize: t.choiceSize, lineHeight: t.choiceLineHeight, fontWeight: t.semiboldWeight, textAlign: 'center' },
  onPrimary: { color: c.onPrimaryAction }, safetyLabel: { color: c.safetyAction, fontSize:cv.safetyLabelSize, fontWeight:t.mediumWeight }, inlineLabel: { color: c.secondaryAction },
  choice: { flexDirection: 'row', alignItems: 'center', gap: s.small, minHeight: l.choiceMinimumHeight,
    backgroundColor: c.softWell, borderWidth: 0, borderRadius: cv.choiceRadius, padding: s.standard },
  areaChoice: { minHeight: cv.areaChoiceMinimum },
  choiceSelected: { backgroundColor: c.softWell, borderWidth: l.selectedBorderWidth, borderColor: c.selectionBorder },
  choiceText: { flex: 1, gap: s.micro },
  choiceTitle: { color: c.textPrimary, fontSize: t.choiceSize, lineHeight: t.choiceLineHeight, fontWeight: t.semiboldWeight },
  checkCircle: { width: cv.ringSize, height: cv.ringSize, borderRadius: radius.status, borderWidth: l.selectedBorderWidth,
    borderColor: c.textSecondary, alignItems: 'center', justifyContent: 'center' },
  checkSelected: { borderColor: c.selectionBorder },
  radioDot: { width: cv.ringDot, height: cv.ringDot, borderRadius: radius.status, backgroundColor: c.selectionBorder },
  notice: { borderRadius: radius.option, borderWidth: l.borderWidth, borderColor: c.separator,
    padding: s.standard, gap: s.micro, backgroundColor: c.softWell },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: s.compact },
  noticeTitle: { flex: 1, color: c.textPrimary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.semiboldWeight },
  noticeBody: { color: c.textPrimary, fontSize: t.captionSize, lineHeight: t.captionLineHeight },
  caution: { backgroundColor: c.cautionSurface, borderColor: c.safetyActionBorder }, cautionText: { color: c.cautionText },
  emblem: { width: cv.emblemSize, height: cv.emblemSize, borderRadius: radius.status,
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
  tabSelected: { backgroundColor: c.surface },
  tabLabel: { color: c.textSecondary, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.mediumWeight },
  tabActiveLabel: { color: c.activeTab, fontWeight: t.strongWeight },
});
