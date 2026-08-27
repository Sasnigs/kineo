import { describe, expect, it } from '@jest/globals';

import {
  selectAreaLevel,
  type ChangeReport,
  type MovementComfort,
  type RoutineLevel,
} from './area-level-rule';

type LevelCase = Readonly<{
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  lockedLevel: RoutineLevel;
  unlockedLevel: RoutineLevel;
}>;

const levelCases = [
  {
    changeReport: 'better',
    movementComfort: 'limited',
    lockedLevel: 'gentle',
    unlockedLevel: 'gentle',
  },
  {
    changeReport: 'better',
    movementComfort: 'okay',
    lockedLevel: 'balanced',
    unlockedLevel: 'balanced',
  },
  {
    changeReport: 'better',
    movementComfort: 'good',
    lockedLevel: 'balanced',
    unlockedLevel: 'active',
  },
  {
    changeReport: 'similar',
    movementComfort: 'limited',
    lockedLevel: 'gentle',
    unlockedLevel: 'gentle',
  },
  {
    changeReport: 'similar',
    movementComfort: 'okay',
    lockedLevel: 'balanced',
    unlockedLevel: 'balanced',
  },
  {
    changeReport: 'similar',
    movementComfort: 'good',
    lockedLevel: 'balanced',
    unlockedLevel: 'balanced',
  },
  {
    changeReport: 'worse',
    movementComfort: 'limited',
    lockedLevel: 'gentle',
    unlockedLevel: 'gentle',
  },
  {
    changeReport: 'worse',
    movementComfort: 'okay',
    lockedLevel: 'gentle',
    unlockedLevel: 'gentle',
  },
  {
    changeReport: 'worse',
    movementComfort: 'good',
    lockedLevel: 'gentle',
    unlockedLevel: 'gentle',
  },
] satisfies readonly LevelCase[];

describe('selectAreaLevel', () => {
  it.each(levelCases)(
    'matches the frozen matrix for $changeReport and $movementComfort',
    ({ changeReport, movementComfort, lockedLevel, unlockedLevel }) => {
      expect(
        selectAreaLevel({
          changeReport,
          movementComfort,
          activeUnlocked: false,
        }),
      ).toBe(lockedLevel);
      expect(
        selectAreaLevel({
          changeReport,
          movementComfort,
          activeUnlocked: true,
        }),
      ).toBe(unlockedLevel);
    },
  );
});
