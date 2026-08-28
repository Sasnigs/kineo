import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '@/ui/theme/tokens';

type MigrationFoundationScreenProps = Readonly<{
  bundledContentAssetCount: number;
}>;

export function MigrationFoundationScreen({
  bundledContentAssetCount,
}: MigrationFoundationScreenProps) {
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
            <Text style={styles.status}>CONTENT CORE VERIFIED</Text>
          </View>
          <Text style={styles.cardTitle}>Deterministic routines</Text>
          <Text style={styles.cardBody}>
            The verified selection and content engines now include a signed
            prototype catalog with {bundledContentAssetCount} bundled media
            asset.
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
    fontWeight: typography.strongWeight,
    letterSpacing: typography.eyebrowTracking,
  },
  title: {
    color: colors.ink,
    fontSize: typography.titleSize,
    fontWeight: typography.displayWeight,
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
    fontWeight: typography.strongWeight,
    letterSpacing: typography.eyebrowTracking,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: typography.bodySize,
    fontWeight: typography.strongWeight,
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
