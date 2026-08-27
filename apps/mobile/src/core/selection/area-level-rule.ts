import type {
  ChangeReport,
  MovementComfort,
  RoutineLevel,
} from '../domain/selection-domain';

export type AreaLevelInput = Readonly<{
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  activeUnlocked: boolean;
}>;

/** Matches the frozen Swift AreaLevelRule decision matrix. */
export function selectAreaLevel({
  changeReport,
  movementComfort,
  activeUnlocked,
}: AreaLevelInput): RoutineLevel {
  if (changeReport === 'worse' || movementComfort === 'limited') {
    return 'gentle';
  }

  if (
    changeReport === 'better' &&
    movementComfort === 'good' &&
    activeUnlocked
  ) {
    return 'active';
  }

  return 'balanced';
}
