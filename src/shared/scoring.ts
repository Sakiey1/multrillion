export const ROUND_MS = 30_000;
export const TOTAL_ROUNDS = 7;
export const MAX_PLAYERS = 5;

/**
 * Speed adds up to 15% of the answer's points. 15% keeps tiers from overlapping:
 * the fastest 85 (97.75) still loses to the slowest 100.
 */
export const SPEED_BONUS_MAX = 0.15;

export function speedBonus(points: number, answerMs: number, roundMs = ROUND_MS): number {
  if (points <= 0) return 0;
  const remaining = Math.max(0, Math.min(1, 1 - answerMs / roundMs));
  return Math.round(points * SPEED_BONUS_MAX * remaining);
}
