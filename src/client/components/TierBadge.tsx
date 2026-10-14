import { tierFor } from "../../shared/questions";

export function TierBadge({ points }: { points: number }) {
  const tier = tierFor(points);
  return <span className={`tier tier-${tier.key}`}>{tier.label}</span>;
}
