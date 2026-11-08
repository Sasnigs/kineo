jest.mock('expo-video', () => ({
  useVideoPlayer: (_source, setup) => {
    const player = {
      loop: false,
      muted: false,
      pause: jest.fn(),
      play: jest.fn(),
    };
    setup?.(player);
    return player;
  },
  VideoView: 'VideoView',
}));

// Reanimated's public mock keeps UI-thread worklets deterministic in Node.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
