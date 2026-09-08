import { describe, expect, it } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';

import { PrototypeLegalDocuments } from './prototype-legal-documents';

describe('prototype legal document access', () => {
  it('lets the user read both prototype documents without first accepting', async () => {
    const screen = await render(<PrototypeLegalDocuments />);
    await fireEvent.press(screen.getByRole('button', { name: 'Read prototype Terms of Service' }));
    expect(screen.getByText(/Internal testing only/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Read prototype Privacy Policy' }));
    expect(screen.getByText(/not end-to-end encrypted/)).toBeTruthy();
  });
});
