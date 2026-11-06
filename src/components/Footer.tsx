"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const LINKS = [
  { href: "/try", label: "Try a photo" },
  { href: "/recalls", label: "Recalls" },
  { href: "/learn", label: "Learn" },
  { href: "/developers", label: "Developers" },
  { href: "/evidence", label: "Evidence" },
  { href: "/stack", label: "How it is built" },
  { href: "/status", label: "Status" },
  { href: "/about", label: "About" },
];

/** Screens people work in (a claim on a phone, the firm console): a short footer, so the task stays the last thing. */
const QUIET = /^\/(claim|firm)(\/|$)/;

/**
 * "Contact as the headline" from the direction sheet: a saturated field (lime in light, the second tone step in dark),
 * three short notes on top, and the product's own address set at display size. Work screens get a short footer.
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
        . Recall refunds on a verified photo, paid through PayPal. Demonstration in PayPal sandbox.
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
          <li>Recall refunds on a verified photo, paid through PayPal</li>
          <li>Demonstration in PayPal sandbox</li>
        </ul>
        <a className="fc-top-link" href="#main">
          Back to top
        </a>
      </div>
      <Link className="fc-display" href="/">
        <span>remedy-y0ym</span>
        <span>.onrender.com</span>
      </Link>
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
