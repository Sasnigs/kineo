import { describe, expect, it } from '@jest/globals';

import { createExclusiveActionGate } from './exclusive-action-gate';

describe('exclusive action gate', () => {
  it('ignores an overlapping action and releases after success', async () => {
    const gate = createExclusiveActionGate();
    let operationCallCount = 0;
    let finishFirstOperation: ((value: string) => void) | undefined;
    const firstOperation = gate.run(async () => {
      operationCallCount += 1;
      return new Promise<string>((resolve) => {
        finishFirstOperation = resolve;
      });
    });

    const overlappingResult = await gate.run(async () => {
      operationCallCount += 1;
      return 'overlapping';
    });

    expect(overlappingResult).toBeUndefined();
    expect(operationCallCount).toBe(1);
    if (finishFirstOperation === undefined) {
      throw new Error('First operation did not expose its completion seam.');
    }
    finishFirstOperation('first');
    await expect(firstOperation).resolves.toBe('first');
    await expect(gate.run(async () => {
      operationCallCount += 1;
      return 'next';
    })).resolves.toBe('next');
    expect(operationCallCount).toBe(2);
  });

  it('releases after a typed failure result', async () => {
    const gate = createExclusiveActionGate();
    const typedFailure = { ok: false as const, error: { code: 'expectedFailure' as const } };

    await expect(gate.run(async () => typedFailure)).resolves.toEqual(typedFailure);
    await expect(gate.run(async () => ({ ok: true as const }))).resolves.toEqual({ ok: true });
  });
});
