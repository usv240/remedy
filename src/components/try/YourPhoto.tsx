"use client";

import { useRef, useState } from "react";
import type { PublicRecall } from "@/app/api/claims/_lib/recall";
import { ClaimFlow } from "@/components/claim/ClaimFlow";
import { ClaimInfo } from "@/components/claim/ClaimInfo";
import { FindRecall, type RecallPick } from "@/components/claim/FindRecall";
import { RecallCard } from "@/components/claim/RecallCard";
import { StepArt } from "@/components/claim/StepArt";
import { SHOP } from "@/lib/payments/shop-catalog";
import { markerWord, ownerSteps } from "@/components/claim/steps";

const SHOP_RECALL = SHOP.recall;

/** "Your photo": pick a recall, then the same photo, checks and result as an owner's claim, live. */
export function YourPhoto({ picks }: { picks: RecallPick[] }) {
  const [recall, setRecall] = useState<PublicRecall | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const head = useRef<HTMLHeadingElement>(null);

  async function choose(p: RecallPick) {
    setState("loading");
    try {
      const r = await fetch(`/api/try/recall?q=${p.number}`);
      const j = await r.json();
      if (!r.ok || !j.data?.found) throw new Error();
      setRecall(j.data.recall as PublicRecall);
      setState("idle");
      requestAnimationFrame(() => head.current?.focus());
    } catch {
      setState("error");
    }
  }

  if (!recall) {
    return (
      <div className="tr-yours">
        <p className="tr-intro">
          Pick the recall, add any photo, and watch the six checks run live. <ClaimInfo k="try.yourphoto" topic="trying your own photo" />
        </p>
        <FindRecall picks={picks} onPick={(p) => void choose(p)} label="Which recall is it for?" />
        {state === "loading" && <p className="cl-note">Opening the recall</p>}
        {state === "error" && (
          <p className="cl-error" role="alert">
            That recall could not open just now. Please try again.
          </p>
        )}
      </div>
    );
  }

  const steps = ownerSteps(recall.rule);
  const word = markerWord(recall.rule);
  const action = recall.rule.actions.includes("write_recalled") ? "write" : recall.rule.actions.includes("cut_cord") ? "cut_cord" : recall.rule.actions.includes("cut_in_half") ? "cut_in_half" : null;
  return (
    <div className="tr-yours">
      <div className="tr-picked">
        <h3 className="tr-sub" ref={head} tabIndex={-1}>
          Recall {recall.number}
        </h3>
        <button type="button" className="cl-textbtn" onClick={() => setRecall(null)}>
          Choose another recall
        </button>
      </div>
      <ol className="cl-steps tr-steps">
        <li className="cl-step" data-step="safe">
          <h2 className="cl-step-title" data-n="1">
            Your recall and what to do
          </h2>
          <RecallCard recall={recall} compact />
          <ol className="cl-todo">
            {steps.map((s) => (
              <li key={s.text} className="cl-todo-item">
                <StepArt kind={s.kind} word={word ?? undefined} />
                <p className="cl-todo-text">{s.text}</p>
              </li>
            ))}
          </ol>
        </li>
        <ClaimFlow key={recall.number} recall={{ number: recall.number, product: recall.product, word, action, example: recall.example, shop: recall.number === SHOP_RECALL }} source="try" startAt={2} />
      </ol>
    </div>
  );
}
