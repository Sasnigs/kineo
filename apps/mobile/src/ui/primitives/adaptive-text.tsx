import {
  Text as NativeText,
  type TextProps as NativeTextProps,
} from 'react-native';

import { typography } from '@/ui/theme/tokens';

type AdaptiveTextProps = Omit<NativeTextProps, 'maxFontSizeMultiplier'>;

export function Text(props: AdaptiveTextProps) {
  return (
    <NativeText
      {...props}
      maxFontSizeMultiplier={typography.maximumFontSizeMultiplier}
    />
  );
}
