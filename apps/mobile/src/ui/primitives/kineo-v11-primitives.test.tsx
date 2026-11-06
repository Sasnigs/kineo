import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import * as Native from 'react-native';
import * as Motion from 'react-native-reanimated';
import { V11TimerDial, V11TimerStatePill, V11RoutinePacing, V11RoutineMediaFrame, formatV11Countdown } from './kineo-v11-routine';
import { V11ChoiceRow, V11FloatingTabBar, V11NoticeCard, V11PrimaryButton,
  V11AreaEmblem, V11ProgressPill, V11SegmentedControl, V11Shell,
  V11ListRow, V11SafetyButton, useV11ReducedMotion } from './kineo-v11-primitives';
import { v11Layout, v11Colors, v11Motion } from '../theme/tokens';

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

const durationOptions = [{ value: 'quick', label: 'Quick' }, { value: 'standard', label: 'Standard' }] as const;
const standardCell = { x: 170, y: 4, width: 166, height: 52 };
const quickCell = { x: 4, y: 4, width: 166, height: 52 };

describe('Phase 2 primitives', () => {
  it('preserves exact area radio names while displaying anatomical detail and an emblem', async () => {
    const select = jest.fn();
    const view = await render(<V11ChoiceRow role="radio" title="Neck" selected detail="Cervical comfort & gentle rotation"
      accessibilityLabel="Neck" leading={<V11AreaEmblem area="neck" />} onPress={select} />);
    expect(view.getByRole('radio', { name: 'Neck' }).props.accessibilityState.checked).toBe(true);
    expect(view.getByText('Cervical comfort & gentle rotation')).toBeTruthy();
    expect(view.queryByRole('image')).toBeNull();
    await fireEvent.press(view.getByRole('radio', { name: 'Neck' }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('labels standalone combined emblems and exposes a single step context', async () => {
    const view = await render(<><V11AreaEmblem area="dual" label="Neck and upper back focus" />
      <V11ProgressPill current={1} total={2} /></>);
    expect(view.getByRole('image', { name: 'Neck and upper back focus' })).toBeTruthy();
    expect(view.getByLabelText('Step 1 of 2')).toBeTruthy();
  });

  it('keeps duration selection controlled and blocks activation when revision is pending', async () => {
    const select = jest.fn();
    const view = await render(<V11SegmentedControl label="Duration" options={durationOptions} value="standard" onSelect={select} />);
    expect(view.getByRole('radio', { name: 'Standard' }).props.accessibilityState.checked).toBe(true);
    await fireEvent(view.getByRole('radio', { name: 'Quick' }), 'layout', { nativeEvent: { layout: quickCell } });
    await fireEvent(view.getByRole('radio', { name: 'Standard' }), 'layout', { nativeEvent: { layout: standardCell } });
    await fireEvent.press(view.getByRole('radio', { name: 'Quick' }));
    expect(select).toHaveBeenCalledWith('quick');
    expect(view.getByRole('radio', { name: 'Standard' }).props.accessibilityState.checked).toBe(true);
    await view.rerender(<V11SegmentedControl label="Duration" options={durationOptions} value="quick" onSelect={select} disabled />);
    expect(view.getByRole('radio', { name: 'Quick' }).props.accessibilityState.checked).toBe(true);
    await fireEvent.press(view.getByRole('radio', { name: 'Standard' }));
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('moves all shell actions into scroll flow and stacks durations at large text', async () => {
    jest.spyOn(Native, 'useWindowDimensions').mockReturnValue({ ...testDimensions, fontScale: enlargedFontScale });
    const select = jest.fn();
    const view = await render(<V11Shell bottomBar={<V11PrimaryButton label="Continue" onPress={select} />}>
      <V11SegmentedControl label="Duration" options={durationOptions} value="standard" onSelect={select} />
    </V11Shell>);
    expect(view.getByTestId('v11-inline-footer')).toBeTruthy();
    expect(view.queryByTestId('v11-pinned-footer')).toBeNull();
    expect(view.queryByTestId('v11-scroll-fade')).toBeNull();
    expect(StyleSheet.flatten(view.getByTestId('v11-duration-group').props.style).flexDirection).toBe('column');
    await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
    expect(select).toHaveBeenCalledTimes(1);
  });
});

it('anchors the measured duration lens to physical left in RTL rather than swapping it twice', async () => {
  jest.replaceProperty(Native.I18nManager, 'isRTL', true);
  const view = await render(<V11SegmentedControl label="Duration" options={durationOptions} value="standard" onSelect={() => undefined} />);
  await fireEvent(view.getByRole('radio', { name: 'Standard' }), 'layout', { nativeEvent: { layout: quickCell } });
  const lens = StyleSheet.flatten(view.getByTestId('v11-duration-lens').props.style);
  expect(lens.end).toBe(0);
  expect(lens.left).toBeUndefined();
  expect(lens.start).toBeUndefined();
});

const routinePlannedSeconds = 60;
const routineRemainingSeconds = 42;
const minutePlusSecond = 61;
const captionBeatIndex = 1;
const controlsBeatIndex = 2;

describe('Phase 3 routine primitives', () => {
  it('renders only countdown numerals inside the dial and exposes authoritative timer progress', async () => {
    const view = await render(<V11TimerDial remainingSeconds={routineRemainingSeconds} totalSeconds={routinePlannedSeconds} />);
    expect(view.getByText('00:42')).toBeTruthy();
    expect(view.queryByText('Your pace')).toBeNull();
    const timer = view.getByRole('progressbar', { name: 'Movement timer' });
    expect(timer.props.accessibilityValue).toMatchObject({ max: routinePlannedSeconds,
      now: routinePlannedSeconds - routineRemainingSeconds, text: '00:42 remaining' });
    expect(formatV11Countdown(minutePlusSecond)).toBe('01:01');
    expect(formatV11Countdown(0)).toBe('00:00');
  });

  it('keeps completed status quiet and non-interactive, with a decorative check only for completion', async () => {
    const view = await render(<V11TimerStatePill label="Step complete" completed />);
    const badge = view.getByTestId('v11-timer-state');
    const style = StyleSheet.flatten(badge.props.style);
    expect(style.borderWidth).toBe(v11Layout.borderWidth);
    expect(style.borderColor).toEqual(v11Colors.selectionBorder);
    expect(style.backgroundColor).toEqual(v11Colors.accentSoft);
    expect(style.elevation).toBe(0);
    expect(style.shadowOpacity).toBeUndefined();
    expect(view.getByTestId('v11-step-check')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
    await view.rerender(<V11TimerStatePill label="Next step ready" ready />);
    expect(view.queryByTestId('v11-step-check')).toBeNull();
  });

  it('collapses a completed timer immediately under Reduce Motion without a delayed choreography', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const delay = jest.spyOn(Motion, 'withDelay');
    const view = await render(<V11RoutinePacing mode="counting" remainingSeconds={routineRemainingSeconds}
      totalSeconds={routinePlannedSeconds} statusLabel="42 seconds remaining · 60 seconds planned"
      guidance="Take your time. Continue when the timer ends." />);
    delay.mockClear();
    await view.rerender(<V11RoutinePacing mode="complete" remainingSeconds={0} totalSeconds={routinePlannedSeconds}
      statusLabel="Step complete" guidance="Continue when you choose." />);
    expect(view.getByText('Step complete')).toBeTruthy();
    expect(view.getByText('Continue when you choose.')).toBeTruthy();
    expect(view.queryByRole('progressbar')).toBeNull();
    expect(delay).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Step complete');
  });

  it('schedules the hold, fold and staggered rise once when the authoritative timer completes', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const delay = jest.spyOn(Motion, 'withDelay');
    const renderPacing = (completed: boolean) => <><MotionPreference /><V11RoutinePacing
      mode={completed ? 'complete' : 'counting'} remainingSeconds={completed ? 0 : routineRemainingSeconds}
      totalSeconds={routinePlannedSeconds} statusLabel={completed ? 'Step complete' : 'In progress'}
      guidance={completed ? 'Continue when you choose.' : 'Continue when the timer ends.'} /></>;
    const view = await render(renderPacing(false));
    await waitFor(() => expect(view.getByText('Standard')).toBeTruthy());
    delay.mockClear();
    await view.rerender(renderPacing(true));
    expect(delay).toHaveBeenCalledWith(v11Motion.completion.holdDuration, expect.anything());
    expect(delay).toHaveBeenCalledWith(v11Motion.completion.holdDuration + captionBeatIndex * v11Motion.completion.stagger, expect.anything());
    expect(delay).toHaveBeenCalledWith(v11Motion.completion.holdDuration + controlsBeatIndex * v11Motion.completion.stagger, expect.anything());
    delay.mockClear();
    await view.rerender(renderPacing(true));
    expect(delay).not.toHaveBeenCalled();
  });

  it('shows transitions without a competing dial and integrates a legible media provenance footer', async () => {
    const view = await render(<><V11RoutineMediaFrame accessibilityLabel="Exercise preview"><Text>Video slot</Text></V11RoutineMediaFrame>
      <V11RoutinePacing mode="transition" statusLabel="Next step ready" guidance="Take a short transition before your next movement." /></>);
    expect(view.getByRole('image', { name: 'Exercise preview' })).toBeTruthy();
    expect(view.getByText('Sample media · pending review')).toBeTruthy();
    expect(view.getByText('Next step ready')).toBeTruthy();
    expect(view.queryByTestId('v11-dial-stage')).toBeNull();
    expect(view.queryByTestId('v11-step-check')).toBeNull();
  });
});

it('keeps menu rows named, disabled-safe, and readable at enlarged text without making metrics actionable', async () => {
  jest.spyOn(Native, 'useWindowDimensions').mockReturnValue({ ...testDimensions, fontScale: enlargedFontScale });
  const press = jest.fn();
  const view = await render(<>
    <V11ListRow label="Neck" accessibilityLabel="View Neck history" subtitle="Main focus area" value="1 check-in" onPress={press} />
    <V11ListRow label="Delete All Data" danger disabled onPress={press} />
    <V11ListRow label="Weekly goal" value="3 days" />
  </>);
  expect(view.getByRole('button', { name: 'View Neck history' }).props.accessibilityHint).toBe('Main focus area, 1 check-in');
  expect(view.getByText('1 check-in')).toBeTruthy();
  expect(StyleSheet.flatten(view.getByRole('button', { name: 'View Neck history' }).props.style).minHeight).toBeGreaterThanOrEqual(v11Layout.controlMinimumHeight);
  await fireEvent.press(view.getByRole('button', { name: 'Delete All Data' }));
  expect(press).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'View Neck history' }));
  expect(press).toHaveBeenCalledTimes(1);
  expect(view.queryByRole('button', { name: 'Weekly goal' })).toBeNull();
});
