import type { MadeSafeExample } from "@/app/api/claims/_lib/recall-text";
import { ClaimInfo } from "./ClaimInfo";

/** The CPSC's own made-safe photo for this kind of action: "This is the kind of photo the firm accepts". */
export function Example({ example }: { example: MadeSafeExample }) {
  return (
    <figure className="cl-example">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small local CPSC thumbnail */}
      <img src={example.src} alt={example.alt} width={example.width} height={example.height} loading="lazy" />
      <figcaption>
        <span className="cl-example-k">
          This is the kind of photo the firm accepts. <ClaimInfo k="claim.example" topic="the example photo" />
        </span>
        <span className="cl-example-cap">
          {example.caption} Photo:{" "}
          <a className="text-link" href={example.original} target="_blank" rel="noreferrer">
            US Consumer Product Safety Commission
          </a>
          .
        </span>
      </figcaption>
    </figure>
  );
}
