import type { EmbedderSpec } from "./manifest.ts";
import type { Candidate } from "./vector-index.ts";

export type MatchGates = Pick<EmbedderSpec, "match_threshold" | "match_margin">;

/**
 * The accept rule for one ranking (best first): the best product must clear the
 * match threshold AND lead the runner-up by the match margin. Below either gate
 * the result is "no match" — never the best guess.
 */
export function rankingWins(
  spec: MatchGates,
  ranking: readonly Candidate[],
): boolean {
  const [top, second] = ranking;
  return (
    top !== undefined &&
    top.score >= spec.match_threshold &&
    top.score - (second?.score ?? 0) >= spec.match_margin
  );
}

/**
 * Turns a stream of per-embedding rankings into one decision. A product locks in
 * once it wins `needed` of the last `window` embeddings, where a win requires the
 * match threshold and a clear lead over the runner-up. One lucky frame never decides.
 */
export class MatchVoter {
  private readonly spec: MatchGates;
  private readonly window: number;
  private readonly needed: number;
  private votes: (string | null)[] = [];

  constructor(spec: MatchGates, window = 3, needed = 2) {
    this.spec = spec;
    this.window = window;
    this.needed = needed;
  }

  /** Records one ranking (best first) and returns the locked product id, if any. */
  push(ranking: readonly Candidate[]): string | null {
    const top = ranking[0];
    const wins = top !== undefined && rankingWins(this.spec, ranking);
    this.votes = [...this.votes, wins ? top.productId : null].slice(
      -this.window,
    );
    if (!wins) return null;
    const count = this.votes.filter((id) => id === top.productId).length;
    return count >= this.needed ? top.productId : null;
  }

  reset(): void {
    this.votes = [];
  }
}
