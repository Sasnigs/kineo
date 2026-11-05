import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import * as Native from 'react-native';
import { V11ChoiceRow, V11FloatingTabBar, V11NoticeCard, V11PrimaryButton,
  V11SafetyButton, useV11ReducedMotion } from './kineo-v11-primitives';
import { v11Layout, v11Colors } from '../theme/tokens';

const enlargedFontScale = 2;
const layoutWidth = 362;
const testDimensions = { width: 402, height: 874, scale: 2, fontScale: 1 };
afterEach(() => { jest.restoreAllMocks(); });

function MotionPreference() {
  const reduced = useV11ReducedMotion();
  return <Text>{reduced ? 'Reduced' : 'Standard'}</Text>;
}

describe('v1.1 accessible primitives', () => {
  it('commits actions on activation, exposes disabled state, and gives safety a dedicated treatment', async () => {
    const press = jest.fn();
    const view = await render(<><V11PrimaryButton label="Continue" onPress={press} />
      <V11PrimaryButton label="Unavailable" disabled onPress={press} />
      <V11SafetyButton label="Something feels wrong" onPress={press} /></>);
    const button = view.getByRole('button', { name: 'Continue' });
    await fireEvent(button, 'pressIn');
    expect(press).not.toHaveBeenCalled();
    await fireEvent.press(button);
    expect(press).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByRole('button', { name: 'Unavailable' }));
    expect(press).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button', { name: 'Unavailable' }).props.accessibilityState.disabled).toBe(true);
    const safety = StyleSheet.flatten(view.getByRole('button', { name: 'Something feels wrong' }).props.style);
    expect(safety.backgroundColor).toEqual(v11Colors.safetyActionSurface);
    expect(safety.minHeight).toBeGreaterThanOrEqual(v11Layout.controlMinimumHeight);
  });

  it('exposes choice name, checked state, and non-color selection feedback', async () => {
    const select = jest.fn();
    const view = await render(<V11ChoiceRow title="Neck" detail="Main focus area" selected onPress={select} />);
    const choice = view.getByRole('radio', { name: 'Neck. Main focus area' });
    expect(choice.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(choice);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('preserves tab semantics and uses normal-flow stacked controls at large text', async () => {
    jest.spyOn(Native, 'useWindowDimensions').mockReturnValue({ ...testDimensions, fontScale: enlargedFontScale });
    const select = jest.fn();
    const view = await render(<V11FloatingTabBar active="progress" onSelect={select} />);
    const bar = view.getByTestId('kineo-primary-tabs');
    expect(bar.props.accessibilityRole).toBe('tablist');
    expect(StyleSheet.flatten(bar.props.style).flexDirection).toBe('column');
    expect(view.getByRole('tab', { name: 'Progress' }).props.accessibilityState.selected).toBe(true);
    await fireEvent.press(view.getByRole('tab', { name: 'Profile' }));
    expect(select).toHaveBeenCalledWith('profile');
    await fireEvent(bar, 'layout', { nativeEvent: { layout: { width: layoutWidth } } });
  });

  it('announces recoverable notices without relying on a warning color alone', async () => {
    const view = await render(<V11NoticeCard role="alert" tone="caution" title="Try again" message="Connect to the internet and retry." />);
    expect(view.getByRole('alert').props.accessibilityLiveRegion).toBe('polite');
    expect(view.getByText('Connect to the internet and retry.')).toBeTruthy();
  });

  it('observes live OS reduction and removes its subscription on unmount', async () => {
    let change: ((value: boolean) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, callback) => {
      change = callback as unknown as (value: boolean) => void;
      return { remove } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>;
    });
    const view = await render(<MotionPreference />);
    await waitFor(() => expect(view.getByText('Standard')).toBeTruthy());
    await act(() => change?.(true));
    expect(view.getByText('Reduced')).toBeTruthy();
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('fails safely to reduced motion when the native preference cannot be read', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('Native preference unavailable'));
    const view = await render(<MotionPreference />);
    await waitFor(() => expect(view.getByText('Reduced')).toBeTruthy());
  });
});
