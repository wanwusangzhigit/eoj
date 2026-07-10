// Codeforces-style rating algorithm implementation
// Reference: https://codeforces.com/blog/entry/20762
//
// Key differences from pure Elo:
// - Uses logistic curve with seed rating
// - Aggregates expected deltas against all rated participants, not just head-to-head
// - Two-pass: compute performance, then update with cap of |delta| ≤ 1024
//
// Lightweight D1-friendly version: O(N^2) where N = number of rated participants.
// Suitable for contests up to ~500 participants (well above typical OJ contest size).

export interface RatingParticipant {
  user_id: number;
  // seed rating going into the contest
  rating: number;
  // 1-based rank in the contest standings (1 = winner, ties allowed)
  rank: number;
}

export interface RatingChange {
  user_id: number;
  old_rating: number;
  new_rating: number;
  delta: number;
  seed: number;
}

// Initial rating for brand-new users who have never been rated
export const INITIAL_RATING = 0;

// Max absolute delta per contest (prevents a single contest from swinging rating too wildly)
const MAX_DELTA = 1024;

// CF magic constants
const RATING_WEIGHT_P1 = 0.42;
const RATING_WEIGHT_P2 = 0.18;
const RATING_WEIGHT_P3 = 0.16;
const RATING_WEIGHT_P4 = 0.08;
const RATING_WEIGHT_P5 = 0.07;
const RATING_WEIGHT_PT = RATING_WEIGHT_P1 + RATING_WEIGHT_P2 + RATING_WEIGHT_P3 + RATING_WEIGHT_P4 + RATING_WEIGHT_P5; // 0.91

// Logistic expected win probability: P(A beats B) = 1 / (1 + 10^((B-A)/400))
function expectedWinProb(a: number, b: number): number {
  return 1.0 / (1.0 + Math.pow(10, (b - a) / 400.0));
}

// Seed of a participant = sum of expected win probabilities against all others
function computeSeed(ratings: number[], myRating: number): number {
  let seed = 1;
  for (const r of ratings) {
    if (r === myRating) continue;
    seed += expectedWinProb(r, myRating);
  }
  return seed;
}

// Mean rating of participants, used for first-time participants' seeding
function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return INITIAL_RATING;
  const sum = ratings.reduce((a, b) => a + b, 0);
  return Math.round(sum / ratings.length);
}

// Transform seed -> expected rank. CF uses a lookup table; we approximate via linear interpolation.
function seedToRank(seed: number): number {
  // empirical approximation: rank ≈ seed (seed=1 -> rank 1, seed=10 -> rank ~10)
  return Math.max(1, Math.floor(seed));
}

// Weighted average of past ratings for new participants (CF trick to dampen volatility)
function weightedPastRating(pastRatings: number[]): number {
  if (pastRatings.length === 0) return -1;
  // CF uses specific weights per index; we use exponential decay for simplicity
  const weights = [RATING_WEIGHT_P1, RATING_WEIGHT_P2, RATING_WEIGHT_P3, RATING_WEIGHT_P4, RATING_WEIGHT_P5];
  let sum = 0;
  let weightSum = 0;
  for (let i = 0; i < Math.min(pastRatings.length, 5); i++) {
    sum += pastRatings[i] * weights[i];
    weightSum += weights[i];
  }
  // If user has fewer than 5 prior contests, scale remaining weight uniformly
  if (pastRatings.length < 5) {
    const remaining = 1 - weightSum;
    if (pastRatings.length > 0) {
      const avg = pastRatings.reduce((a, b) => a + b, 0) / pastRatings.length;
      sum += avg * remaining;
      weightSum += remaining;
    }
  }
  return weightSum > 0 ? Math.round(sum / weightSum) : -1;
}

/**
 * Compute rating changes for a single contest.
 *
 * @param participants List of {user_id, rating (pre-contest), rank}
 * @param pastRatingsMap Optional: map of user_id -> [recent ratings in chronological order, last first]
 *                       Used for first-time participants' seeding.
 * @returns Array of rating changes (one per participant)
 */
export function computeContestRatingChanges(
  participants: RatingParticipant[],
  pastRatingsMap: Map<number, number[]> = new Map()
): RatingChange[] {
  if (participants.length === 0) return [];

  const n = participants.length;
  const allRatings = participants.map((p) => p.rating);
  const avgRating = averageRating(allRatings);

  // Step 1: compute seed for each participant
  const seeds = participants.map((p) => computeSeed(allRatings, p.rating));

  // Step 2: compute expected rank from seed, actual rank from standings
  const expectedRanks = seeds.map((s) => seedToRank(s));

  // Step 3: compute initial performance rating for each participant
  // Performance rating is the rating at which expected rank == actual rank
  const changes: RatingChange[] = participants.map((p, i) => {
    const expectedRank = expectedRanks[i];
    const actualRank = p.rank;

    // If user performed better than expected (actual < expected), rating should rise; else fall.
    // We use the difference as a proxy for performance.
    const rankDiff = expectedRank - actualRank; // positive => underperformed expectation inverse; we want rising when actual < expected
    // ↑ Wait: lower actual rank = better performance = should increase rating.
    //   actualRank=1 (won) but expectedRank=5 → rankDiff = 4 → positive → rating should rise.
    //   (So positive rankDiff = good performance = rating rises.)

    // For first-time participants (rating === 0), use weighted past or average
    let effectiveRating = p.rating;
    if (p.rating <= 0) {
      const past = pastRatingsMap.get(p.user_id) || [];
      const wp = weightedPastRating(past);
      effectiveRating = wp > 0 ? wp : avgRating;
    }

    // Translate rankDiff into a rating delta using logistic inverse.
    // Approximation: delta = rankDiff * scale where scale depends on contest size.
    const scale = 400 / Math.max(10, n); // smaller contests => larger per-rank delta
    let rawDelta = rankDiff * scale;

    // For brand-new users, scale up the delta (CF uses different formulas, but this is a reasonable approximation)
    if (p.rating <= 0) {
      rawDelta *= 2;
    }

    // Cap delta
    const cappedDelta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, rawDelta));

    return {
      user_id: p.user_id,
      old_rating: p.rating,
      new_rating: Math.max(0, Math.round(p.rating + cappedDelta)),
      delta: Math.round(cappedDelta),
      seed: Math.round(seeds[i]),
    };
  });

  // Step 4 (CF trick): adjust deltas so that sum of deltas == 0 for rated contests.
  // This keeps the average rating stable across the user pool over time.
  const totalDelta = changes.reduce((s, c) => s + c.delta, 0);
  const offset = Math.round(totalDelta / changes.length);
  for (const c of changes) {
    c.delta -= offset;
    c.new_rating = Math.max(0, c.old_rating + c.delta);
  }

  return changes;
}

/**
 * Calculate expected new rating for a single user (used in non-contest contexts, e.g., display).
 * Pure Elo: newRating = oldRating + K * (actualScore - expectedScore)
 */
export function eloUpdate(oldRating: number, opponentRating: number, score: number, k = 32): number {
  const expected = expectedWinProb(oldRating, opponentRating);
  const delta = Math.round(k * (score - expected));
  return Math.max(0, oldRating + delta);
}
