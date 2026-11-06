import { Suspense, type ReactNode } from "react";
import { FirmNav, FirmNavAt } from "@/components/firm/FirmNav";
import "./firm.css";

/** The firm console's frame: navigation on the tinted ground, each screen on the white sheet. */
export default function FirmLayout({ children }: { children: ReactNode }) {
  return (
    <div className="firm">
      <aside className="firm-side">
        <p className="firm-side-name">Brightline Home</p>
        <p className="firm-side-note">Recall console</p>
        <Suspense fallback={<FirmNav />}>
          <FirmNavAt />
        </Suspense>
        <p className="firm-side-label">Brightline Home is a fictional sample firm. Payouts run in the PayPal sandbox. Remedy is not affiliated with the recalling firm.</p>
      </aside>
      <div className="firm-sheet">{children}</div>
    </div>
  );
}
