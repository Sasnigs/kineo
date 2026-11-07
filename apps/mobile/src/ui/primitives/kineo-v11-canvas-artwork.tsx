import { StyleSheet, View, useColorScheme } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { v11Colors, v11ArtColors, v11Canvas as cv } from '../theme/tokens';
import { canvasArt } from './kineo-v11-canvas-art';

const artRatio = { welcome: cv.welcomeAspect, hero: cv.heroWidth / cv.heroHeight, neck: 1, upper: 1, lower: 1, dual: 1, 'neck-glide': 320 / 190, 'seated-nod': 320 / 190, 'thoracic-open': 320 / 190 } as const;
export function V11CanvasArt({ name, onHero = false, regions, fit = false }: { name: keyof typeof canvasArt; onHero?: boolean; fit?: boolean; regions?: readonly ('neck' | 'upper' | 'lower')[] }) {
  const palette = v11ArtColors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  // Preserve the canvas dual glyph for neck + upper back; compose its existing zones for other valid pairs.
  const source = name === 'dual' && regions?.includes('lower')
    ? canvasArt.neck.replace(/<g class="area-focus">[\s\S]*?<\/g>/, '<g class="area-focus">' +
      regions.map(region => focusZone(region)).join('') + '</g>')
    : canvasArt[name];
  const xml = source.replace(/var\(--ks-([a-z]+)\)/g, (_match, role: keyof typeof palette) => palette[role])
    .replace(/currentColor/g, onHero ? v11Colors.heroInk : palette.ink);
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.art, fit ? {height:'100%'} : { aspectRatio: artRatio[name] }]}>
    <SvgXml xml={xml} width="100%" height="100%" />
  </View>;
}
const styles = StyleSheet.create({ art: { width: '100%' } });

function focusZone(region: 'neck' | 'upper' | 'lower') {
  const match = canvasArt[region].match(/<g class="area-focus">([\s\S]*?)<\/g>/);
  if (!match) throw new Error(`Canvas focus zone is missing: ${region}`);
  return match[1];
}
