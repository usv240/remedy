"use client";

import { useRouter } from "next/navigation";
import { TOUR, TOUR_KEY } from "@/components/tour/steps";

/** "Take the 2-minute tour" as a text link: starts the guided tour at its first stop. Hidden until the tour has stops. */
export function TourButton({ label = "Take the 2-minute tour", className = "text-link" }: { label?: string; className?: string }) {
  const router = useRouter();
  if (TOUR.length === 0) return null;
  return (
    <button
      type="button"
      className={`link-btn ${className}`}
      onClick={() => {
        try {
          sessionStorage.setItem(TOUR_KEY, "0");
        } catch {
          /* private windows: the tour lasts for this page only */
        }
        // The tour card reads its step when the path changes; on the first stop's own page, load it afresh.
        if (window.location.pathname === new URL(TOUR[0].path, window.location.href).pathname) window.location.assign(TOUR[0].path);
        else router.push(TOUR[0].path);
      }}
    >
      {label}
    </button>
  );
}
