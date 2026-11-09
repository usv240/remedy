/**
 * What each check time on the site is, in the same words wherever one appears. Three different times are shown, and
 * each says which it is:
 * - `median`: the "about N seconds" on the home page and /evidence, the median of every recorded live check
 *   (checkTimes in src/components/evidence/errors.ts);
 * - `recorded`: one recorded run's own time, the model's recorded calls and the checks in code: the home page's sample
 *   panel, and a replayed example on /try and its full-result page;
 * - `live`: a run made just now on /try, by the model or by code alone.
 * The answer's source wears the matching word: Recorded or Live (ANSWER_WORDS). Safe for client components.
 */
export const TIME_WORDS = {
  median: "median of the recorded live checks",
  recorded: "this recorded run",
  live: "live now",
} as const;

/** The pill beside a run's time: the model's answer came from a recorded run, or was read just now. */
export const ANSWER_WORDS = { recorded: "Recorded", live: "Live" } as const;

export type TimeKind = keyof typeof TIME_WORDS;
