"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const FIRM_LINKS = [
  { href: "/firm", label: "Home" },
  { href: "/firm/claims", label: "Claims" },
  { href: "/firm/plan", label: "Recall plan" },
  { href: "/firm/reports", label: "CPSC report" },
  { href: "/firm/buyers", label: "Buyers" },
  { href: "/firm/scan", label: "Scan a catalog" },
] as const;

const isCurrent = (path: string | null, href: string) => path !== null && (href === "/firm" ? path === "/firm" : path === href || path.startsWith(`${href}/`));

/** The console's sections. The path is URL data, so the fallback (no current mark) renders first, then this. */
export function FirmNav({ path }: { path?: string | null }) {
  return (
    <nav aria-label="Firm console">
      <ul className="firm-nav">
        {FIRM_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} aria-current={isCurrent(path ?? null, l.href) ? "page" : undefined}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FirmNavAt() {
  return <FirmNav path={usePathname()} />;
}
