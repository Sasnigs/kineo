import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/ui/theme/tokens';

export function MigrationFoundationScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.eyebrow}>
          KINEO · DEVELOPER PREVIEW
        </Text>
        <Text style={styles.title}>A safer foundation for daily movement.</Text>
        <Text style={styles.body}>
          Product flows are moving to Expo one verified parity slice at a time.
        </Text>

        <View accessibilityLabel="Migration status" style={styles.card}>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.status}>FIRST RULE VERIFIED</Text>
          </View>
          <Text style={styles.cardTitle}>Area-level selection</Text>
          <Text style={styles.cardBody}>
            Neck, upper and mid back, and lower back now share the frozen Swift
            decision matrix in the Expo core.
          </Text>
        </View>

        <Text style={styles.footer}>
          The Swift app remains the runnable reference until feature parity.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.screenHorizontal,
    paddingVertical: spacing.screenVertical,
    gap: spacing.standard,
  },
  eyebrow: {
    color: colors.secondaryInk,
    fontSize: typography.eyebrowSize,
    fontWeight: '700',
    letterSpacing: typography.eyebrowTracking,
  },
  title: {
    color: colors.ink,
    fontSize: typography.titleSize,
    fontWeight: '800',
    lineHeight: typography.titleLineHeight,
  },
  body: {
    color: colors.secondaryInk,
    fontSize: typography.bodySize,
    lineHeight: typography.bodyLineHeight,
    marginBottom: spacing.standard,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.compact,
    padding: spacing.screenHorizontal,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.compact,
  },
  statusDot: {
    backgroundColor: colors.accent,
    borderRadius: radius.status,
    height: spacing.compact,
    width: spacing.compact,
  },
  status: {
    color: colors.ink,
    fontSize: typography.eyebrowSize,
    fontWeight: '700',
    letterSpacing: typography.eyebrowTracking,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: typography.bodySize,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.secondaryInk,
    fontSize: typography.detailSize,
    lineHeight: typography.detailLineHeight,
  },
  footer: {
    color: colors.secondaryInk,
    fontSize: typography.detailSize,
    lineHeight: typography.detailLineHeight,
    marginTop: spacing.standard,
  },
});
