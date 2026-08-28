export const colors = {
  canvas: '#F4F1E8',
  surface: '#FFFFFF',
  ink: '#18322B',
  secondaryInk: '#5B6964',
  accent: '#B7D55A',
  accentDark: '#315F4F',
  accentSoft: '#E7F0C5',
  inverseInk: '#FFFFFF',
  mutedSurface: '#EBEEE9',
  danger: '#A43D3D',
  border: '#D8DDD8',
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
} as const;
