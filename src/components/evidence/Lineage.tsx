import Link from "next/link";

/**
 * Where the two-reviewer design comes from, and the part that is new here. Each paper is cited for what it shows, from
 * its own abstract (read 2026-11-08). Shown on /evidence/photo-checks#lineage; the README's three ideas name the same
 * lineage in one line.
 */
export const LINEAGE: { who: string; year: string; what: string; url: string }[] = [
  { who: "Zheng and others, Judging LLM-as-a-Judge", year: "2023", what: "A model as the reviewer of another's output, with its position and verbosity biases measured.", url: "https://arxiv.org/abs/2306.05685" },
  { who: "Madras, Pitassi and Zemel, Predict Responsibly", year: "2018", what: "Learning to defer: a model that hands the cases it should not decide to a person.", url: "https://arxiv.org/abs/1711.06664" },
  { who: "Jung, Brahman and Choi, Trust or Escalate", year: "2024", what: "A judge that answers only when confident and escalates the rest, with a guaranteed level of agreement with people.", url: "https://arxiv.org/abs/2407.18370" },
  { who: "Badshah, Emami and Sajjad, Judge, Retrieve, or Abstain", year: "2026", what: "When unsure, fetch evidence and judge again; still unsure, abstain and flag the case for human review.", url: "https://arxiv.org/abs/2608.17994" },
  { who: "Kohli, Nine Judges, Two Effective Votes", year: "2026", what: "Nine frontier models from seven families made the same mistakes on the same items, so a panel of different model names gave about two independent votes.", url: "https://arxiv.org/abs/2605.29800" },
];

export function Lineage() {
  return (
    <div className="ev-lineage">
      <p className="page-prose jp-intro">
        Two reviewers and a referee is a design with a lineage. The published pattern is one judge that abstains on its own confidence, or a panel of different models. The finding that panels from one model family share errors is why the
        two reviewers here read two different rulebooks rather than two model names.
      </p>
      <ul className="ev-rules ev-lineage-list">
        {LINEAGE.map((l) => (
          <li key={l.url}>
            <strong>
              <a className="text-link" href={l.url} target="_blank" rel="noreferrer">
                {l.who}
              </a>
              , {l.year}.
            </strong>{" "}
            {l.what}
          </li>
        ))}
      </ul>
      <p className="page-prose">
        <span className="jg-k">The part that is new here.</span> The Product reviewer sees only the recall&rsquo;s official pictures; the Remedy reviewer sees only the remedy text. Each must cite what it saw, a referee in code counts only votes whose
        evidence checks out, and a disagreement goes to a person at the firm, in payments: nothing is paid until that person decides. &ldquo;The agent proposes, a person approves&rdquo; is a pattern many payment agents share this year; the
        two rulebooks and the abstention on disagreement are the design choice. <span className="lp-tech">The reviewers and the referee: src/lib/verify/reviewers.ts; the decision: src/lib/verify/decide.ts; tests/verify.test.ts. </span>
        <Link className="text-link" href="/firm/claims">
          See the two reviewers on a look-alike claim
        </Link>
      </p>
    </div>
  );
}
