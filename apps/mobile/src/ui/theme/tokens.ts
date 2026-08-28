import { DynamicColorIOS } from 'react-native';

const adaptiveColor = (light: string, dark: string) =>
  DynamicColorIOS({ light, dark });

export const colors = {
  canvas: adaptiveColor('#F4F1E8', '#101915'),
  surface: adaptiveColor('#FFFFFF', '#1B2923'),
  ink: adaptiveColor('#18322B', '#F3F7F5'),
  secondaryInk: adaptiveColor('#5B6964', '#B8C5C0'),
  accent: adaptiveColor('#B7D55A', '#B7D55A'),
  accentDark: adaptiveColor('#315F4F', '#B7D55A'),
  accentSoft: adaptiveColor('#E7F0C5', '#294238'),
  inverseInk: adaptiveColor('#FFFFFF', '#101915'),
  mutedSurface: adaptiveColor('#EBEEE9', '#26352F'),
  danger: adaptiveColor('#A43D3D', '#FF9B9B'),
  border: adaptiveColor('#D8DDD8', '#42534C'),
} as const;

export const spacing = {
  screenHorizontal: 24,
  screenVertical: 20,
  compact: 8,
  standard: 16,
  roomy: 24,
  section: 32,
  controlVertical: 15,
} as const;

export const radius = {
  card: 20,
  status: 999,
  button: 16,
  option: 16,
} as const;

export const typography = {
  maximumFontSizeMultiplier: 2,
  eyebrowSize: 13,
  eyebrowTracking: 1.6,
  titleSize: 38,
  titleLineHeight: 44,
  bodySize: 17,
  bodyLineHeight: 25,
  detailSize: 15,
  detailLineHeight: 21,
  strongWeight: '700',
  displayWeight: '800',
  buttonWeight: '700',
} as const;

export const layout = {
  readableWidth: 560,
  controlMinimumHeight: 52,
  borderWidth: 1,
  disabledOpacity: 0.45,
  pressedOpacity: 0.72,
  mediaAspectRatio: 1.35,
} as const;
