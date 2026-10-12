export interface RatingState {
  successfulRuns: number;
  nextPromptAt: number;
  choice?: 'rate' | 'never';
}

export function recordSuccessfulValidation(state: RatingState | undefined): { state: RatingState; prompt: boolean } {
  const next: RatingState = {
    successfulRuns: (state?.successfulRuns ?? 0) + 1,
    nextPromptAt: state?.nextPromptAt ?? 10,
    choice: state?.choice,
  };
  return { state: next, prompt: !next.choice && next.successfulRuns >= next.nextPromptAt };
}

export function recordRatingChoice(state: RatingState, choice: 'Rate' | 'Later' | 'Never' | undefined): RatingState {
  if (choice === 'Rate') return { ...state, choice: 'rate' };
  if (choice === 'Never') return { ...state, choice: 'never' };
  return { ...state, nextPromptAt: state.successfulRuns + 25 };
}
