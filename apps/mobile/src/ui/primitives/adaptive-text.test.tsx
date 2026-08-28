import { render } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';

import { typography } from '@/ui/theme/tokens';

import { Text } from './adaptive-text';

describe('adaptive text', () => {
  it('keeps accessibility scaling readable within narrow iPhone layouts', async () => {
    const view = await render(<Text>Kineo heading</Text>);

    expect(view.getByText('Kineo heading').props.maxFontSizeMultiplier).toBe(
      typography.maximumFontSizeMultiplier,
    );
  });
});
