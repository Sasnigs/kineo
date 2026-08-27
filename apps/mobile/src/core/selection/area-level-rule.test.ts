import { describe, expect, it } from '@jest/globals';

import levelCaseFixture from '../../../../../Packages/KineoModules/Tests/KineoCoreTests/Fixtures/area-level-selection-v1.json';

import {
  changeReports,
  movementComforts,
  routineLevels,
  type ChangeReport,
  type MovementComfort,
  type RoutineLevel,
} from '../domain/selection-domain';
import { selectAreaLevel } from './area-level-rule';

type LevelCase = Readonly<{
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  lockedLevel: RoutineLevel;
  unlockedLevel: RoutineLevel;
}>;

function includes<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): candidate is Values[number] {
  return values.includes(candidate as Values[number]);
}

function parseLevelCase(candidate: (typeof levelCaseFixture)[number]): LevelCase {
  if (
    !includes(changeReports, candidate.changeReport) ||
    !includes(movementComforts, candidate.movementComfort) ||
    !includes(routineLevels, candidate.lockedLevel) ||
    !includes(routineLevels, candidate.unlockedLevel)
  ) {
    throw new Error('The shared area-level parity fixture contains an invalid value.');
  }

  return {
    changeReport: candidate.changeReport,
    movementComfort: candidate.movementComfort,
    lockedLevel: candidate.lockedLevel,
    unlockedLevel: candidate.unlockedLevel,
  };
}

const levelCases = levelCaseFixture.map(parseLevelCase);

describe('selectAreaLevel', () => {
  it('covers every change and movement-comfort input', () => {
    const expectedInputs = changeReports.flatMap((changeReport) =>
      movementComforts.map(
        (movementComfort) => `${changeReport}:${movementComfort}`,
      ),
    );
    const fixtureInputs = levelCases.map(
      ({ changeReport, movementComfort }) =>
        `${changeReport}:${movementComfort}`,
    );

    expect(fixtureInputs).toHaveLength(expectedInputs.length);
    expect(new Set(fixtureInputs)).toEqual(new Set(expectedInputs));
  });

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
