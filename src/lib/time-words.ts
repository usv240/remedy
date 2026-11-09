/**
 * What each check time on the site is, in the same words wherever one appears. Three different times are shown, and
 * each says which it is:
 * - `median`: the "about N seconds" on the home page and /evidence, the median of every recorded live check
 *   (checkTimes in src/components/evidence/errors.ts);
 * - `recorded`: one recorded run's own time, as the home page's sample panel replays it (content/public/verify-runs.json);
 * - `replayed` and `live`: the time a run took just now on /try, with the model's answer replayed or read live.
 * Safe for client components.
 */
export const TIME_WORDS = {
  median: "median of the recorded live checks",
  recorded: "this recorded run",
  replayed: "replayed now",
  live: "live now",
} as const;

export type TimeKind = keyof typeof TIME_WORDS;
