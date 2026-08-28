jest.mock('expo-video', () => ({
  useVideoPlayer: (_source, setup) => {
    const player = {
      loop: false,
      muted: false,
      play: jest.fn(),
    };
    setup?.(player);
    return player;
  },
  VideoView: 'VideoView',
}));
