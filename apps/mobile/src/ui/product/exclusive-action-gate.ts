export type ExclusiveActionGate = Readonly<{
  run<Value>(operation: () => Promise<Value>): Promise<Value | undefined>;
}>;

export function createExclusiveActionGate(): ExclusiveActionGate {
  let isRunning = false;
  return {
    async run<Value>(operation: () => Promise<Value>): Promise<Value | undefined> {
      if (isRunning) return undefined;
      isRunning = true;
      try {
        return await operation();
      } finally {
        isRunning = false;
      }
    },
  };
}
