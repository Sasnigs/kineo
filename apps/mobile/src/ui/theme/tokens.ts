import { DynamicColorIOS } from 'react-native';
import { Easing, ReduceMotion } from 'react-native-reanimated';

const adaptiveColor = (light: string, dark: string) =>
  DynamicColorIOS({ light, dark });

export const colors = {
  canvas: adaptiveColor('#F7F6F1', '#0B130F'),
  surface: adaptiveColor('#FFFFFF', '#13201A'),
  elevatedSurface: adaptiveColor('#FFFFFF', '#192A22'),
  ink: adaptiveColor('#142A21', '#F3F7F2'),
  secondaryInk: adaptiveColor('#52675C', '#B8C9BC'),
  accent: adaptiveColor('#C7F36A', '#C7F36A'),
  accentDark: adaptiveColor('#1B4D38', '#8FD4B0'),
  accentDeep: adaptiveColor('#1D463B', '#C7F36A'),
  accentSoft: adaptiveColor('#E5EFE9', '#1E3329'),
  forest: adaptiveColor('#123D31', '#0E2A22'),
  inverseInk: adaptiveColor('#FFFFFF', '#122118'),
  onDark: adaptiveColor('#F8FCF9', '#F4F8F5'),
  mutedSurface: adaptiveColor('#EDF2EB', '#13201A'),
  attentionSurface: adaptiveColor('#FFF1DE', '#342619'),
  attentionInk: adaptiveColor('#713C19', '#FFE0B1'),
  danger: adaptiveColor('#A43D3D', '#FFB6A4'),
  border: adaptiveColor('#D4DED4', '#3C5144'),
  borderStrong: adaptiveColor('#52675C', '#B8C9BC'),
  shadow: adaptiveColor('#171D19', '#000000'),
} as const;

export const spacing = {
  screenHorizontal: 20,
  screenVertical: 18,
  micro: 4,
  compact: 8,
  small: 12,
  standard: 16,
  large: 20,
  roomy: 24,
  section: 32,
  hero: 40,
  controlVertical: 14,
} as const;

export const radius = {
  card: 24,
  hero: 32,
  status: 999,
  button: 16,
  option: 18,
  icon: 14,
} as const;

export const typography = {
  heroSize: 32,
  heroLineHeight: 37,
  eyebrowSize: 13,
  eyebrowTracking: 0,
  titleSize: 24,
  titleLineHeight: 29,
  subtitleSize: 19,
  subtitleLineHeight: 24,
  bodySize: 15,
  bodyLineHeight: 22,
  detailSize: 15,
  detailLineHeight: 22,
  captionSize: 13,
  captionLineHeight: 18,
  strongWeight: '700',
  displayWeight: '700',
  buttonWeight: '700',
} as const;

export const layout = {
  readableWidth: 560,
  controlMinimumHeight: 52,
  tabMinimumHeight: 62,
  borderWidth: 1,
  selectedBorderWidth: 2,
  disabledOpacity: 0.45,
  pressedOpacity: 0.84,
  subtleOpacity: 0.72,
  mediaAspectRatio: 1.16,
  heroArtworkHeight: 196,
  heroOrbSize: 144,
  heroOrbInnerSize: 104,
  heroPathWidth: 124,
  heroPathHeight: 12,
  heroPathRotation: '34deg',
  heroPathTrailingRotation: '-34deg',
  iconSize: 22,
  smallIconSize: 18,
  heroIconSize: 62,
  shadowOpacity: 0.055,
  shadowRadius: 24,
  shadowOffsetY: 10,
  elevation: 4,
  fixedBottomBarMaximumFontScale: 1.6,
} as const;

/** Tactile v1.1 semantic roles. Legacy exports above remain compatible. */
export const v11Colors = {
  canvas: colors.canvas,
  surface: colors.surface,
  focalSurface: colors.elevatedSurface,
  elevatedSurface: colors.elevatedSurface,
  softWell: colors.mutedSurface,
  textPrimary: colors.ink,
  primaryInk: colors.ink,
  textSecondary: colors.secondaryInk,
  secondaryInk: colors.secondaryInk,
  separator: colors.border,
  border: colors.border,
  borderStrong: colors.borderStrong,
  primaryAction: colors.accentDeep,
  onPrimaryAction: colors.inverseInk,
  secondaryAction: colors.accentDark,
  activeTab: adaptiveColor('#1D463B', '#DCE9DC'),
  selection: adaptiveColor('#1D463B', '#C7F36A'),
  selectionBorder: adaptiveColor('#1D463B', '#C7F36A'),
  accentSoft: colors.accentSoft,
  accent: colors.accent,
  cautionSurface: colors.attentionSurface,
  cautionText: colors.attentionInk,
  cautionInk: colors.attentionInk,
  safetyAction: adaptiveColor('#8A431E', '#FFD19B'),
  safetyActionSurface: adaptiveColor('#FFF3E7', '#2C2119'),
  safetyActionBorder: adaptiveColor('#BE815A', '#A97752'),
  destructive: colors.danger,
  danger: colors.danger,
  shadow: colors.shadow,
} as const;

export const v11Spacing = spacing;
export const v11Typography = {
  displaySize: 32, displayLineHeight: 37,
  titleSize: 24, titleLineHeight: 29,
  sectionSize: 19, sectionLineHeight: 24,
  headingSize: 17, headingLineHeight: 22,
  choiceSize: 16, choiceLineHeight: 22,
  bodySize: 15, bodyLineHeight: 22,
  captionSize: 13, captionLineHeight: 18,
  contextSize: 13, displayTracking: -0.5,
  timerNumeralVariant: 'tabular-nums',
  regularWeight: '400', mediumWeight: '500',
  semiboldWeight: '600', strongWeight: '700',
} as const;

export const v11Layout = {
  ...layout,
  referenceWidth: 402, referenceHeight: 874, contentWidth: 362,
  statusSafeZoneHeight: 60, touchMinimumHeight: 44,
  choiceMinimumHeight: 60, focalRadius: 24, controlRadius: 16,
  inputRadius: 14, choiceRadius: 18, emblemSize: 48,
  brandMarkSize: 28, tabInset: 4, tabRadius: 999,
  cardShadowOpacity: 0.025, cardShadowRadius: 8,
  cardShadowOffsetY: 2, cardElevation: 1,
  pressRetentionOffset: 16,
} as const;

// Reanimated 4's duration-based springs use perceptual duration.
const springPerceptualFactor = 1.5;
const pressDuration = 140;
const selectionDuration = 180;
const pillDuration = 220;
const quart = Easing.bezier(0.23, 1, 0.32, 1);
const standard = Easing.bezier(0.2, 0.8, 0.2, 1);
export const v11Motion = {
  pressScaleButton: 0.97, pressScaleCard: 0.98,
  pressSpring: { duration: pressDuration / springPerceptualFactor,
    dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System },
  selectionSpring: { duration: selectionDuration / springPerceptualFactor,
    dampingRatio: 0.92, reduceMotion: ReduceMotion.System },
  pillSpring: { duration: pillDuration / springPerceptualFactor,
    dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System },
  stageEnter: { duration: 180, easing: quart },
  sequenceEnter: { duration: 160, easing: quart },
  progressTiming: { duration: 260, easing: quart },
  reducedMotionFade: { duration: 150, easing: standard, reduceMotion: ReduceMotion.Never },
} as const;
