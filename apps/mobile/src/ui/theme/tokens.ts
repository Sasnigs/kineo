import { DynamicColorIOS } from 'react-native';

const adaptiveColor = (light: string, dark: string) =>
  DynamicColorIOS({ light, dark });

export const colors = {
  canvas: adaptiveColor('#F6F4EC', '#09130F'),
  surface: adaptiveColor('#FFFFFF', '#14231D'),
  elevatedSurface: adaptiveColor('#FCFDF9', '#1B2C25'),
  ink: adaptiveColor('#102A22', '#F4F8F5'),
  secondaryInk: adaptiveColor('#60706A', '#B7C5BF'),
  accent: adaptiveColor('#C7F36A', '#C7F36A'),
  accentDark: adaptiveColor('#215D4B', '#C7F36A'),
  accentDeep: adaptiveColor('#123D31', '#D9F8A0'),
  accentSoft: adaptiveColor('#EAF6D5', '#263E32'),
  forest: adaptiveColor('#123D31', '#0E2A22'),
  inverseInk: adaptiveColor('#F8FCF9', '#0A1712'),
  onDark: adaptiveColor('#F8FCF9', '#F4F8F5'),
  mutedSurface: adaptiveColor('#EBEFE9', '#22342C'),
  attentionSurface: adaptiveColor('#FFF3DD', '#3A2A16'),
  attentionInk: adaptiveColor('#7A4711', '#FFD59A'),
  danger: adaptiveColor('#A43D3D', '#FF9B9B'),
  border: adaptiveColor('#DCE3DD', '#3E5148'),
  shadow: adaptiveColor('#0B2D22', '#000000'),
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
  heroSize: 40,
  heroLineHeight: 45,
  eyebrowSize: 12,
  eyebrowTracking: 1.5,
  titleSize: 30,
  titleLineHeight: 36,
  subtitleSize: 22,
  subtitleLineHeight: 28,
  bodySize: 17,
  bodyLineHeight: 25,
  detailSize: 15,
  detailLineHeight: 21,
  captionSize: 13,
  captionLineHeight: 18,
  strongWeight: '700',
  displayWeight: '800',
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
  shadowOpacity: 0.12,
  shadowRadius: 18,
  shadowOffsetY: 10,
  elevation: 4,
  controlFontSizeMultiplier: 1.6,
  navigationFontSizeMultiplier: 1.4,
} as const;
