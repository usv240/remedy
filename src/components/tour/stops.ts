/**
 * The guided tour's stops, in the order a visitor walks them (about two minutes). Each names a page, a CSS selector for
 * the element it describes, and one sentence. Stops on other builders' pages point at their h1 until those pages pick
 * a stable target. Read by src/components/tour/steps.ts.
 */
export type Stop = { path: string; target: string; title: string; text: string };

export const STOPS: Stop[] = [
  {
    path: "/",
    target: "#showcase",
    title: "Every recall, read as a checklist",
    text: "Type any product. Remedy searches every US recall since 2024 and shows what each remedy asks: what to cut or mark, and the refund.",
  },
  {
    path: "/recalls/27056",
    target: "#rule",
    title: "One recall's proof rule",
    text: "The official remedy, quoted word for word, and the rule Claude read from it, with how sure it is of each field.",
  },
  {
    path: "/try",
    target: "main h1",
    title: "Try a photo",
    text: "Run a sample photo, or your own, through the six checks, and watch the sandbox payout arrive.",
  },
  {
    path: "/firm",
    target: "main h1",
    title: "The firm's side",
    text: "Brightline Home, a fictional sample firm: the claims queue, the plan that updates itself from PayPal, and the monthly report.",
  },
  {
    path: "/developers",
    target: "#playground",
    title: "For developers and agents",
    text: "A free key and a live playground, and a recorded session of an AI assistant using the MCP tools to find a recall and open a claim.",
  },
  {
    path: "/evidence",
    target: "#results",
    title: "Evidence: the numbers, and where they come from",
    text: "The CPSC data behind every figure, the extraction benchmark, and the recorded photo checks. That is the tour.",
  },
];
