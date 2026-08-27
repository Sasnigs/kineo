export const changeReports = ['better', 'similar', 'worse'] as const;
export type ChangeReport = (typeof changeReports)[number];

export const movementComforts = ['limited', 'okay', 'good'] as const;
export type MovementComfort = (typeof movementComforts)[number];

export const routineLevels = ['gentle', 'balanced', 'active'] as const;
export type RoutineLevel = (typeof routineLevels)[number];

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
