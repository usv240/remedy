/**
 * The guided tour: the five-minute path through the product, one stop per thing to look at. Each stop names a page, a CSS
 * selector for the element it describes, and one sentence. Stops are added as the pages they point at ship.
 */
import { STOPS } from "./stops";

export type TourStep = { path: string; target: string; title: string; text: string };

export const TOUR: TourStep[] = STOPS;

export const TOUR_KEY = "remedy.tour";

/** True when the page in view is the step's page: the same path, and every query value the step names. */
export function onStepPage(step: TourStep, loc: { pathname: string; search: string }) {
  const want = new URL(step.path, "http://x");
  if (want.pathname !== loc.pathname) return false;
  const have = new URLSearchParams(loc.search);
  return [...want.searchParams].every(([k, v]) => have.get(k) === v);
}
