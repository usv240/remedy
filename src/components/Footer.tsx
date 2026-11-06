"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const REPO = "https://github.com/usv240/remedy";

const LINKS = [
  { href: "/try", label: "Try a photo" },
  { href: "/recalls", label: "Recalls" },
  { href: "/learn", label: "Learn" },
  { href: "/developers", label: "Developers" },
  { href: "/judges", label: "For judges" },
  { href: "/stack", label: "How it is built" },
  { href: "/status", label: "Status" },
  { href: "/about", label: "About" },
];

/** Screens people work in (a claim on a phone, the firm console): a short footer, so the task stays the last thing. */
const QUIET = /^\/(claim|firm)(\/|$)/;

/**
 * "Contact as the headline" from the direction sheet: a saturated field (lime in light, the second tone step in dark),
 * three short notes on top, and the way to reach the project set at display size. Work screens get a short footer.
 */
export function Footer() {
  return (
    <Suspense fallback={<ContactFooter home={false} />}>
      <FooterAt />
    </Suspense>
  );
}

function FooterAt() {
  const path = usePathname() ?? "/";
  return QUIET.test(path) ? <QuietFooter /> : <ContactFooter home={path === "/"} />;
}

function QuietFooter() {
  return (
    <footer className="footer-quiet frame" aria-label="Site footer">
      <p className="footer-quiet-lead">
        <Link href="/" className="text-link">
          Remedy
        </Link>
        . Built for the PayPal AI Hackathon, November 2026. Demonstration in PayPal sandbox.
      </p>
      <p className="footer-credit">Recall data and images: U.S. Consumer Product Safety Commission</p>
    </footer>
  );
}

function ContactFooter({ home }: { home: boolean }) {
  return (
    <footer className="footer-contact frame" data-home={home ? "" : undefined} aria-label="Site footer">
      <div className="fc-top">
        <ul className="fc-notes">
          <li className="fc-wordmark">Remedy</li>
          <li>Built for the PayPal AI Hackathon, November 2026</li>
          <li>Recall refunds on a verified photo, paid through PayPal</li>
        </ul>
        <a className="fc-top-link" href="#main">
          Back to top
        </a>
      </div>
      <a className="fc-display" href={REPO}>
        <span>github.com/usv240</span>
        <span>/remedy</span>
      </a>
      <div className="fc-meta">
        <nav aria-label="Footer">
          <ul className="fc-links">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="fc-credit">Recall data and images: U.S. Consumer Product Safety Commission</p>
        <p className="fc-year">Open source, MIT license. 2026</p>
      </div>
    </footer>
  );
}
