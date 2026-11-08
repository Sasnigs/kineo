import { useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BodyArea } from '../../core/domain/selection-domain';
import { v11Colors as c, v11Spacing as s, v11Typography as t, v11Canvas as cv, v11Layout as l, radius } from '../theme/tokens';
import { V11AreaEmblem, V11ChoiceRow, V11InlineTextAction, V11PrimaryButton, V11ProgressPill, V11PageHeader } from './kineo-v11-primitives';
import { V11CanvasArt } from './kineo-v11-canvas-artwork';

export const areaDisplayNames: Record<BodyArea, string> = { neck: 'Neck', upperMidBack: 'Upper & mid back', lowerBack: 'Lower back' };
export const canvasParts = StyleSheet.create({
  soft: { backgroundColor:c.softWell,borderRadius:l.focalRadius,padding:s.roomy,gap:s.small },
  spread: { flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:s.small },
  divider: { height:l.borderWidth,backgroundColor:c.separator,marginVertical:s.small },
  fine: { color: c.textSecondary, fontSize: cv.captionSize, lineHeight: cv.captionLine },
  body: { color: c.textSecondary, fontSize: t.bodySize, lineHeight: t.bodyLineHeight },
  title: { color: c.textPrimary, fontSize: t.headingSize, lineHeight: t.headingLineHeight, fontWeight: t.semiboldWeight },
  section: { marginTop: s.small, gap: s.small },
  focal: { backgroundColor: c.focalSurface, borderRadius: l.focalRadius, padding: s.large, gap: s.small,
    shadowColor: c.shadow, shadowOpacity: l.shadowOpacity, shadowRadius: l.shadowRadius,
    shadowOffset: { width: 0, height: l.shadowOffsetY }, elevation: l.elevation },
  badge: { alignSelf: 'flex-start', color: c.textPrimary, backgroundColor: c.softWell, borderRadius: radius.status,
    paddingHorizontal: s.small, paddingVertical: s.compact, fontSize: cv.captionSize, fontWeight: t.semiboldWeight, overflow: 'hidden' },
  checkline: { flexDirection: 'row', alignItems: 'flex-start', gap: s.compact },
});
export function V11Topline({ onBack, label = '' }: { onBack: () => void; label?: string }) {
  return <View style={styles.topline}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}>
      <Ionicons name={I18nManager.isRTL ? 'arrow-forward' : 'arrow-back'} size={cv.rowIcon} color={c.textPrimary} />
    </Pressable>
    <Text style={canvasParts.fine}>{label}</Text><View style={styles.spacer} />
  </View>;
}
export function V11Question<T extends string>({ context, current, total, title, helper, options, onContinue, onSelectionChange,
  onBack, hideHeader = false, editorial = false, cta = 'Continue', disabled = false, initial, tail, children }: {
  context: string; current?: number; total?: number; title: string; helper?: string;
  options: readonly { value: T; title: string; detail?: string; area?: BodyArea }[];
  hideHeader?: boolean; editorial?: boolean; onSelectionChange?: (value: T) => void; onContinue: (value: T) => void; onBack?: () => void; cta?: string; disabled?: boolean; initial?: T;
  tail?: ReactNode; children?: ReactNode;
}) {
  const [selected, setSelected] = useState<T | undefined>(initial);
  return <>
    {current && total ? <V11ProgressPill current={current} total={total} /> : null}
    {onBack ? <V11Topline onBack={onBack} /> : null}
    {!editorial ? <View style={styles.questionContext}><Text style={styles.areaPill}>{context}</Text>
      {current && total ? <Text style={styles.stepCount}>{current} of {total}</Text> : null}</View> : null}
    {hideHeader?null:<V11PageHeader kind={editorial ? 'editorial' : 'question'} context={editorial ? context : undefined} title={title} lead={helper} />}
    <View accessible={false} accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.answers}>
      {options.map(option => <V11ChoiceRow key={option.value} title={option.title} detail={option.detail}
        accessibilityLabel={option.title} accessibilityHint={context} selected={selected === option.value}
        disabled={disabled} area={Boolean(option.area)} leading={option.area ? <V11AreaEmblem area={option.area} /> : undefined}
        onPress={() => { setSelected(option.value); onSelectionChange?.(option.value); }} />)}
    </View>
    <V11PrimaryButton label={cta} disabled={disabled || selected === undefined}
      onPress={() => { if (selected !== undefined) onContinue(selected); }} />
    {children}{tail}
  </>;
}
export function V11Checkline({ children }: { children: string }) {
  return <View style={canvasParts.checkline}><Ionicons accessible={false} name="checkmark" size={cv.rowIcon} color={c.secondaryAction} />
    <Text style={[canvasParts.body, styles.grow]}>{children}</Text></View>;
}
export function V11Hero({ title, body, label, onPress }: { title: string; body: string; label: string; onPress: () => void }) {
  return <View style={styles.hero}>
    <View pointerEvents="none" style={styles.heroArt}><V11CanvasArt name="hero" onHero /></View>
    <Text style={styles.heroTitle}>{title}</Text><Text style={styles.heroBody}>{body}</Text>
    <V11PrimaryButton hero label={label} onPress={onPress} />
  </View>;
}
const weekNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
export function canvasTodayLabel(localDay?: string) {
  return dateFormat.format(localDay ? new Date(`${localDay}T12:00:00`) : new Date());
}
export function V11Rhythm({ current, goal, today, days, onHistory }: {
  current: number; goal: number; today?: string; days?: readonly string[]; onHistory: () => void;
}) {
  const now = today ? new Date(`${today}T12:00:00`) : new Date();
  const mondayOffset = (now.getDay() + cv.daysPerWeek - 1) % cv.daysPerWeek;
  const monday = new Date(now); monday.setDate(now.getDate() - mondayOffset);
  return <View style={styles.supportCard}>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" style={canvasParts.title}>Your rhythm</Text>
      <V11InlineTextAction compact label="View history" style={styles.chip} onPress={onHistory} /></View>
    <View style={styles.week}>{weekNames.map((name, index) => {
      const date = new Date(monday); date.setDate(monday.getDate() + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const complete = days?.includes(key) === true;
      return <View key={name} accessible accessibilityLabel={`${name} ${date.getDate()}${complete ? ', participated' : ''}${date.toDateString() === now.toDateString() ? ', today' : ''}`} style={styles.day}>
        <Text style={canvasParts.fine}>{name.slice(0, 1)}</Text><View style={[styles.dayCell, complete && styles.dayComplete,
          date.toDateString() === now.toDateString() && styles.dayNow]}>{complete ? <Ionicons name="checkmark" size={cv.rowIcon} color={c.secondaryAction} /> : <Text style={canvasParts.fine}>{date.getDate()}</Text>}</View>
      </View>;
    })}</View>
    <Text style={canvasParts.fine}>{current} of {goal} days this week. No streak to protect.</Text>
  </View>;
}
export function V11FocusRow({ areas, onEdit }: { areas: readonly BodyArea[]; onEdit: () => void }) {
  return <View style={[styles.supportCard, styles.focus]}><V11AreaEmblem areas={areas} />
    <View style={styles.grow}><Text style={canvasParts.fine}>Your focus areas</Text>
      <Text style={canvasParts.body}>{areas.map(area => areaDisplayNames[area]).join(' · ')}</Text></View>
    <V11InlineTextAction compact label="Edit" style={styles.chip} onPress={onEdit} />
  </View>;
}
const heroArtRight = -8;
const styles = StyleSheet.create({
  grow: { flex: 1 }, topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: l.touchMinimumHeight },
  back: { width: l.touchMinimumHeight, height: l.touchMinimumHeight, borderRadius: cv.choiceRadius, backgroundColor: c.softWell, alignItems: 'center', justifyContent: 'center' },
  spacer: { width: l.touchMinimumHeight }, questionContext: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: s.small, justifyContent: 'space-between' },
  areaPill: { backgroundColor: c.softWell, color: c.textPrimary, borderRadius: radius.status, paddingVertical: s.compact,
    paddingHorizontal: s.small, fontSize: t.captionSize, lineHeight: t.captionLineHeight, fontWeight: t.semiboldWeight, overflow: 'hidden' },
  stepCount: { color: c.textSecondary, fontSize: t.captionSize, fontVariant: ['tabular-nums'] }, answers: { gap: s.small },
  hero: { backgroundColor: c.heroSurface, borderRadius: l.focalRadius, padding: s.roomy, gap: s.small, overflow: 'hidden' },
  heroArt: { position: 'absolute', right: heroArtRight, top: 0, width: cv.heroWidth, opacity: cv.heroOpacity },
  heroTitle: { color: c.heroInk, fontSize: cv.heroTitleSize, lineHeight: cv.heroTitleLine, fontWeight: t.semiboldWeight },
  heroBody: { color: c.heroInk, fontSize: t.bodySize, lineHeight: t.bodyLineHeight },
  supportCard: { backgroundColor: c.surface, borderRadius: cv.sectionRadius, padding: s.standard, marginTop: s.micro, gap: s.small },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: s.compact },
  chip: { backgroundColor: c.softWell, borderRadius: radius.status, paddingHorizontal: s.small, paddingVertical: s.micro },
  focus: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  week: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: s.micro },
  day: { gap: s.compact, alignItems: 'center' }, dayCell: { minWidth: cv.daySize, minHeight: cv.daySize, padding: s.micro, borderRadius: radius.status, alignItems: 'center', justifyContent: 'center' },
  dayComplete: { backgroundColor: c.softWell }, dayNow: { borderWidth: l.borderWidth, borderColor: c.secondaryAction },
});
