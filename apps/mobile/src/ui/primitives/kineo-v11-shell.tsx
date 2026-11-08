import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { v11Colors as c, v11ArtColors, v11Layout as l, v11Spacing as s } from '../theme/tokens';

const fade = {
  viewBox: '0 0 100 32', width: '100%', startX: '0%', startY: '0%', endX: '0%', endY: '100%',
  maskInk: '#FFFFFF', terminalOpacity: 0.92,
  layers: [
    { intensity: 4, start: '0%', end: '30%' },
    { intensity: 8, start: '15%', end: '45%' },
    { intensity: 12, start: '30%', end: '60%' },
    { intensity: 20, start: '45%', end: '75%' },
    { intensity: 28, start: '60%', end: '90%' },
    { intensity: 36, start: '75%', end: '100%' },
  ],
} as const;

function ProgressiveFooterFade() {
  const appearance = useColorScheme();
  const canvasTone=v11ArtColors[appearance==='dark'?'dark':'light'].bg;
  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => {
      receivedChange = true;
      if (active) setReduceTransparency(value);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => {
      if (active && !receivedChange) setReduceTransparency(value);
    }, () => {
      // An unreadable preference must keep translucent blur disabled.
      if (active && !receivedChange) setReduceTransparency(true);
    });
    return () => { active = false; subscription?.remove(); };
  }, []);
  // A native scroll indicator remains available when translucent materials are disabled.
  if (reduceTransparency) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    {fade.layers.map((layer, index) => <MaskedView key={layer.start}
      style={StyleSheet.absoluteFill} maskElement={
        <Svg width={fade.width} height={l.scrollFadeHeight} viewBox={fade.viewBox} preserveAspectRatio="none">
          <Defs><LinearGradient id={`mask-${index}`} x1={fade.startX} y1={fade.startY} x2={fade.endX} y2={fade.endY}>
            <Stop offset={layer.start} stopColor={fade.maskInk} stopOpacity={0} />
            <Stop offset={layer.end} stopColor={fade.maskInk} stopOpacity={1} />
          </LinearGradient></Defs>
          <Rect width={fade.width} height={l.scrollFadeHeight} fill={`url(#mask-${index})`} />
        </Svg>
      }>
      <BlurView tint={appearance === 'dark' ? 'dark' : 'light'} intensity={layer.intensity} style={StyleSheet.absoluteFill} />
    </MaskedView>)}
    <Svg width={fade.width} height={l.scrollFadeHeight} viewBox={fade.viewBox} preserveAspectRatio="none">
      <Defs><LinearGradient id="footer-tone" x1={fade.startX} y1={fade.startY} x2={fade.endX} y2={fade.endY}>
        <Stop offset={fade.startY} stopColor={canvasTone} stopOpacity={0} />
        <Stop offset={fade.endY} stopColor={canvasTone} stopOpacity={fade.terminalOpacity} />
      </LinearGradient></Defs>
      <Rect width={fade.width} height={l.scrollFadeHeight} fill="url(#footer-tone)" />
    </Svg>
  </View>;
}

/** Measured scroll affordance; only shared values change while scrolling. */
export function V11Shell({ children, bottomBar, persistentBottomBar, progressiveFade = true, compact = false, footerPlacement = 'flow' }: {
  children: ReactNode; bottomBar?: ReactNode; persistentBottomBar?: ReactNode; progressiveFade?: boolean; compact?: boolean; footerPlacement?: 'flow' | 'navigation' | 'pinned-actions';
}) {
  const { fontScale } = useWindowDimensions();
  const inline = footerPlacement === 'flow' || fontScale > l.fixedBottomBarMaximumFontScale;
  const hasFooter = bottomBar !== undefined || persistentBottomBar !== undefined;
  const contentHeight = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(event => { scrollY.set(event.contentOffset.y); });
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: contentHeight.get() - viewportHeight.get() - scrollY.get() > l.scrollFadeTolerance ? 1 : 0,
  }));
  const footer = <>{bottomBar}{persistentBottomBar}</>;
  return <SafeAreaView style={styles.safeArea}>
    <View style={styles.body}>
      <Animated.ScrollView testID="v11-screen-scroll" style={styles.scroll}
        contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator
        onLayout={event => viewportHeight.set(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => contentHeight.set(height)} onScroll={onScroll}>
        <View style={[styles.readable, compact && styles.compact]}>
          {children}
          {inline && hasFooter ? <View testID="v11-inline-footer" style={styles.inlineFooter}>{footer}</View> : null}
        </View>
      </Animated.ScrollView>
      {!inline && progressiveFade ? <Animated.View testID="v11-scroll-fade" pointerEvents="none"
        accessible={false} accessibilityElementsHidden style={[styles.fade, fadeStyle]}><ProgressiveFooterFade /></Animated.View> : null}
    </View>
    {!inline && hasFooter ? <View testID="v11-pinned-footer" style={styles.footer}>{footer}</View> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  compact: { gap: s.compact },
  safeArea: { flex: 1, backgroundColor: c.canvas },
  body: { flex: 1, position: 'relative' },
  scroll: { flex: 1 },
  page: { flexGrow: 1, paddingHorizontal: s.screenHorizontal, paddingTop: s.small, paddingBottom: s.standard },
  readable: { alignSelf: 'center', width: '100%', flexGrow: 1, maxWidth: l.readableWidth, gap: s.standard },
  footer: { backgroundColor: c.canvas, gap: s.compact, paddingTop: s.compact, paddingBottom: s.micro },
  inlineFooter: { gap: s.compact, marginTop: s.standard },
  fade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: l.scrollFadeHeight },
});
