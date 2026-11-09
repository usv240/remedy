"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { MadeSafeExample } from "@/app/api/claims/_lib/recall-text";
import type { ClaimEvent, ClaimView, PayView } from "@/app/api/claims/_lib/types";
import { Checking, type Stage } from "./Checking";
import { ClaimInfo } from "./ClaimInfo";
import { day, money } from "./format";
import type { PhotoCheck } from "./photo-check";
import type { StepKind } from "./steps";

/** The photo types the claim takes; the in-browser check says the same when a photo is something else. */
const ACCEPT = "image/jpeg,image/png";

/**
 * The in-browser photo check (blur, light and size, src/components/claim/photo-check.ts) loads when "Take a photo" or
 * "Choose a photo" is first pressed, so the claim page opens and answers without it.
 */
let photoCheck: Promise<typeof import("./photo-check")> | null = null;
function loadPhotoCheck() {
  photoCheck ??= import("./photo-check");
  photoCheck.catch(() => {
    photoCheck = null;
  });
  return photoCheck;
}

/** The result, with its payout choices, loads while the six checks run: it is not needed before then. */
const loadResult = () => import("./Result").then((m) => m.Result);
const Result = dynamic(loadResult, { loading: () => <p className="cl-later">Loading your result</p> });

export type FlowRecall = {
  number: string;
  product: string;
  /** The word to write in marker, when the recall asks for one. */
  word: string | null;
  /** The main action, for the framing tip and the retake drawing. */
  action: StepKind | null;
  example: MadeSafeExample | null;
  /** Show "Bought it from Brightline with PayPal?" (the sample shop's recall). */
  shop: boolean;
  /** How many photos the remedy asks for, and what each shows when it says (src/lib/recall/photo-count.ts). */
  photos?: { count: number; shows: string[] };
  /**
   * The recall asks for a photo taken now (firm_recall.require_live_capture): the photo button opens the camera, the
   * library choice and the sample photo are hidden, and the claim records that the camera was asked for.
   */
  liveCapture?: boolean;
};

/** The sample shop's receipt, kept on this device after a purchase so the claim can link it. */
export const SHOP_SALE_KEY = "remedy-shop-sale";
/** The published photo of the sample charger with its cord cut (public/samples/charger/CREDITS.json). */
export const SAMPLE_PHOTO_URL = "/samples/charger/cord-cut.jpg";
export type StoredSale = { saleId: string; captureId: string; amount: string; paidAt: string };

function readSale(): StoredSale | null {
  try {
    const s = JSON.parse(localStorage.getItem(SHOP_SALE_KEY) ?? "null") as StoredSale | null;
    return s?.saleId && s.captureId ? s : null;
  } catch {
    return null;
  }
}

const FRAME_TIP: Partial<Record<StepKind, string>> = {
  cut_cord: "Fit the whole product in the frame, with the cut cord and both cut ends in view.",
  cut_in_half: "Fit both pieces in the frame, so the cut shows.",
  write: "Fit the whole product in the frame, with the writing facing the camera.",
};

/**
 * Steps 3 to 5 of the claim: snap a photo (with a framing guide and the blur check in the browser), watch the six
 * checks complete, then the answer. Renders list items, so the page's own ordered list of steps holds them.
 */
export function ClaimFlow({ recall, source = "web", startAt = 3 }: { recall: FlowRecall; source?: "web" | "try"; startAt?: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  // The further photos a remedy asks for (it asks for two or three): one slot each, in order.
  const extraCount = Math.max(0, Math.min(3, (recall.photos?.count ?? 1) - 1));
  const [extras, setExtras] = useState<(File | null)[]>(() => Array.from({ length: extraCount }, () => null));
  const [preview, setPreview] = useState<string | null>(null);
  const [check, setCheck] = useState<PhotoCheck | null>(null);
  const [override, setOverride] = useState(false);
  const [phase, setPhase] = useState<"photo" | "checking" | "result">("photo");
  const [stage, setStage] = useState<Stage>("sending");
  const [elapsed, setElapsed] = useState(0);
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [error, setError] = useState("");
  const [sale, setSale] = useState<StoredSale | null>(null);
  const [useSale, setUseSale] = useState(true);
  const [email, setEmail] = useState("");
  const t0 = useRef(0);
  const checkingRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const takeId = useId();
  const chooseId = useId();
  const tipId = useId();
  const emailId = useId();

  useEffect(() => {
    if (!recall.shop) return;
    // localStorage is only readable on the client, after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSale(readSale());
  }, [recall.shop]);

  useEffect(() => {
    if (phase !== "checking") return;
    const t = window.setInterval(() => setElapsed(performance.now() - t0.current), 100);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError("");
    setOverride(false);
    setFile(f);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name) ? null : URL.createObjectURL(f);
    });
    setCheck(null);
    try {
      const { checkPhoto } = await loadPhotoCheck();
      setCheck(await checkPhoto(f));
    } catch {
      setError("The photo check could not load just now. Please check your connection and choose the photo again.");
    }
  }

  /** The shop recall only: Brightline's published photo of this charger with its cord cut, for a visitor with no charger to cut. */
  async function pickSamplePhoto() {
    setError("");
    try {
      const r = await fetch(SAMPLE_PHOTO_URL);
      if (!r.ok) throw new Error();
      await pick(new File([await r.blob()], "brightline-charger-cord-cut.jpg", { type: "image/jpeg" }));
    } catch {
      setError("The sample photo could not load just now. Please try again, or choose a photo of your own.");
    }
  }

  async function poll(id: string): Promise<ClaimView | null> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await fetch(`/api/claims/${id}`).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (j?.data && j.data.decision !== "pending") return j.data as ClaimView;
    }
    return null;
  }

  async function submit() {
    if (!file) return;
    setPhase("checking");
    setStage("sending");
    setClaim(null);
    setError("");
    t0.current = performance.now();
    setElapsed(0);
    void loadResult();
    requestAnimationFrame(() => checkingRef.current?.focus());
    const fd = new FormData();
    fd.set("recall", recall.number);
    fd.set("photo", file);
    for (const f of extras) if (f) fd.append("photo", f);
    // Arrived from a firm's personal claim link (?n=...): send its token, so the firm sees the notice was answered.
    const notice = new URLSearchParams(window.location.search).get("n");
    fd.set("source", notice ? "link" : source);
    if (notice) fd.set("notice", notice);
    fd.set("capture", recall.liveCapture ? "camera" : "any");
    if (recall.shop && sale && useSale) {
      fd.set("sale_id", sale.saleId);
      fd.set("capture_id", sale.captureId);
    } else if (recall.shop && email.trim()) fd.set("paypal_email", email.trim());

    let id: string | null = null;
    let result: ClaimView | null = null;
    try {
      const res = await fetch("/api/claims", { method: "POST", body: fd, headers: { Accept: "text/event-stream" } });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? "Your photo could not be sent just now. Please try again.");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let failure: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = chunk
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
            .join("");
          if (!data) continue;
          const e = JSON.parse(data) as ClaimEvent;
          if (e.type === "claim") id = e.id;
          else if (e.type === "stage") setStage(e.state === "start" ? e.stage : "stored");
          else if (e.type === "result") result = e.claim;
          else if (e.type === "error") failure = e.message;
        }
      }
      if (!result && id) result = await poll(id);
      if (!result) throw new Error(failure ?? "The check did not finish. Please try again.");
    } catch (e) {
      if (id && !result) result = await poll(id);
      if (!result) {
        setElapsed(performance.now() - t0.current);
        setError((e as Error).message || "Your photo could not be sent just now. Please try again.");
        setPhase("photo");
        return;
      }
    }
    setElapsed(performance.now() - t0.current);
    setStage("done");
    setClaim(result);
    setPhase("result");
    window.setTimeout(() => resultRef.current?.focus(), 520);
  }

  function retake() {
    setPhase("photo");
    setFile(null);
    setExtras(Array.from({ length: extraCount }, () => null));
    setPreview(null);
    setCheck(null);
    setClaim(null);
    requestAnimationFrame(() => document.getElementById(takeId)?.focus());
  }

  function paid(p: PayView) {
    router.push(p.claim.receipt_url);
  }

  const blocked = check && !check.ok && check.kind !== "quality";
  const soft = check && !check.ok && check.kind === "quality";
  const canSend = Boolean(file) && extras.every(Boolean) && !blocked && (!soft || override) && check !== null;
  const total = extraCount + 1;
  const shows = recall.photos?.shows ?? [];

  return (
    <>
      <li className="cl-step" data-step="photo">
        <h2 className="cl-step-title" data-n={startAt}>
          {total > 1 ? `Snap ${total === 2 ? "two" : total === 3 ? "three" : total} photos` : "Snap a photo"} <ClaimInfo k="claim.photo" topic="your photo" />
        </h2>
        {total > 1 && (
          <p className="cl-hint cl-multi-lead">
            This recall asks for {total} photos.{shows[0] ? ` Photo 1: ${shows[0]}.` : ""}
          </p>
        )}
        <div className="cl-photo" data-ui>
          <div className="cl-frame" data-has={preview ? "" : undefined}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the owner's own photo
              <img src={preview} alt="Your photo, ready to check" />
            ) : (
              <p className="cl-frame-empty">Your photo appears here</p>
            )}
            <svg className="cl-corners" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path d="M6 20V6h14M80 6h14v14M94 80v14H80M20 94H6V80" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <p id={tipId} className="cl-tip">
            {(recall.action && FRAME_TIP[recall.action]) ?? "Fit the whole product in the frame."} Good light, phone held still.
          </p>
          <div className="cl-pick">
            <label className="btn btn-ink cl-pick-btn" onPointerDown={() => void loadPhotoCheck()}>
              <input id={takeId} className="cl-file" type="file" accept={ACCEPT} capture="environment" aria-describedby={tipId} onChange={(e) => void pick(e.target.files?.[0])} disabled={phase === "checking"} />
              {file ? "Take it again" : "Take a photo"}
            </label>
            {!recall.liveCapture && (
              <label className="btn btn-quiet cl-pick-btn" onPointerDown={() => void loadPhotoCheck()}>
                <input id={chooseId} className="cl-file" type="file" accept={ACCEPT} onChange={(e) => void pick(e.target.files?.[0])} disabled={phase === "checking"} />
                Choose a photo
              </label>
            )}
          </div>
          {recall.liveCapture && (
            <p className="cl-hint cl-live-capture">
              <strong>A photo taken now:</strong> this recall asks for a new photo, so the button opens your camera. <ClaimInfo k="claim.live-capture" topic="a photo taken now" />
            </p>
          )}
          {extras.map((f, i) => (
            <div key={i} className="cl-extra">
              <p className="cl-extra-k">
                Photo {i + 2} of {total}
                {shows[i + 1] ? `: ${shows[i + 1]}` : ""}
              </p>
              <label className="btn btn-quiet cl-pick-btn">
                <input
                  className="cl-file"
                  type="file"
                  accept={ACCEPT}
                  capture="environment"
                  onChange={(e) => {
                    const picked = e.target.files?.[0] ?? null;
                    setExtras((xs) => xs.map((x, k) => (k === i ? picked : x)));
                  }}
                  disabled={phase === "checking"}
                />
                {f ? `Photo ${i + 2} added: take it again` : `Add photo ${i + 2}`}
              </label>
            </div>
          ))}
          {recall.shop && !recall.liveCapture && (
            <div className="cl-sample">
              <button type="button" className="btn btn-quiet cl-sample-btn" onClick={() => void pickSamplePhoto()} disabled={phase === "checking"}>
                Use Brightline&rsquo;s sample photo
              </button>
              <p className="cl-hint">
                No charger to cut? This public-domain photo shows this charger with its cord cut (Dmitry G, Wikimedia Commons). Every visitor can claim with it; any other photo is checked against earlier claims as usual.
              </p>
            </div>
          )}
          <p className="cl-hint cl-privacy">
            <strong>Your photo:</strong> show just the product, with no people in it. It is kept without camera or location data, and deleted 90 days after your claim is decided.
          </p>
          {check && !check.ok && (
            <div className="cl-precheck" role="alert">
              <p className="cl-precheck-lead">{check.message}</p>
              {check.kind === "quality" && (
                <>
                  <ul className="cl-guide">
                    {check.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  <label className="cl-check-box">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Send it anyway
                  </label>
                </>
              )}
            </div>
          )}
          {check?.ok && (
            <p className="cl-precheck-ok">
              Looks clear. <span className="cl-tech tabular">Sharpness {check.report.metrics.sharpness}, {check.width} by {check.height} px, checked in this browser.</span>
            </p>
          )}

          {recall.shop && (
            <details className="cl-sale" open={Boolean(sale)}>
              <summary>Bought it from Brightline with PayPal?</summary>
              <p className="cl-hint cl-sale-why">
                PayPal can refund a purchase for 180 days, so the money goes back the way you paid. <ClaimInfo k="claim.sale" topic="buying with PayPal" />
              </p>
              {sale ? (
                <label className="cl-check-box">
                  <input type="checkbox" checked={useSale} onChange={(e) => setUseSale(e.target.checked)} /> Use my purchase from {day(sale.paidAt)}, {money(sale.amount)}, made on this device. The refund goes back to it.
                </label>
              ) : (
                <div className="cl-field">
                  <label htmlFor={emailId}>The email of the PayPal account you paid with</label>
                  <input id={emailId} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                  <p className="cl-hint">
                    If we find your Brightline purchase, the refund goes back to that payment. No purchase yet?{" "}
                    <a className="text-link" href="/try/shop">
                      Buy the sample charger
                    </a>
                    .
                  </p>
                </div>
              )}
            </details>
          )}

          {error && (
            <p className="cl-error" role="alert">
              {error}
            </p>
          )}
          <div className="cl-actions">
            <button type="button" className="btn btn-primary cl-send" onClick={() => void submit()} disabled={!canSend || phase === "checking"}>
              {phase === "checking" ? "Checking" : total > 1 ? "Check my photos" : "Check my photo"}
            </button>
            {!file && <span className="cl-hint">Add a photo first.</span>}
            {file && !extras.every(Boolean) && <span className="cl-hint">Add all {total} photos first.</span>}
          </div>
        </div>
      </li>

      <li className="cl-step" data-step="checking" data-active={phase !== "photo" ? "" : undefined}>
        <h2 className="cl-step-title" data-n={startAt + 1} ref={checkingRef} tabIndex={-1}>
          Checking
        </h2>
        {phase === "photo" ? (
          <p className="cl-later">Six checks run on your photo, in a few seconds.</p>
        ) : (
          <Checking checks={claim?.checks ?? null} stage={stage} elapsedMs={elapsed} technical={claim?.timings ?? null} reviewersAgreed={claim?.decision === "verified" && claim?.decided_by === "reviewers"} />
        )}
      </li>

      <li className="cl-step" data-step="result" data-active={phase === "result" ? "" : undefined}>
        <h2 className="cl-step-title" data-n={startAt + 2} ref={resultRef} tabIndex={-1}>
          Your result
        </h2>
        {phase === "result" && claim ? (
          <Result claim={claim} ctx={{ action: recall.action, word: recall.word, example: recall.example }} onRetake={retake} onPaid={paid} />
        ) : (
          <p className="cl-later">Verified photos are paid straight away through PayPal.</p>
        )}
      </li>
    </>
  );
}
