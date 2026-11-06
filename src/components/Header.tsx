"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ViewMenu } from "./ViewMenu";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/try", label: "Try a photo" },
  { href: "/recalls", label: "Recalls" },
  { href: "/developers", label: "Developers" },
  { href: "/judges", label: "For judges" },
];

const CTA = { href: "/try", label: "Try a photo" };

/** The section a path belongs to, so its link can say "you are here". "/#how" is a place on the home page, never a page. */
const current = (path: string, href: string) => href !== "/#how" && (path === href || path.startsWith(`${href}/`));

/** The path is URL data, so the bar that reads it streams inside Suspense; the fallback is the same bar with no
 *  "you are here" marker, so nothing moves when it resolves. */
export function Header() {
  return (
    <Suspense fallback={<HeaderBar path={null} />}>
      <HeaderAt />
    </Suspense>
  );
}

function HeaderAt() {
  return <HeaderBar path={usePathname()} />;
}

function HeaderBar({ path }: { path: string | null }) {
  const [menu, setMenu] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // A new page closes the phone menu.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenu(false);
  }, [path]);

  // The phone menu is a full sheet: the page behind it stops scrolling, Escape closes it and returns focus to Menu,
  // and focus starts on the first link.
  useEffect(() => {
    if (!menu) return;
    const root = document.documentElement;
    root.dataset.menu = "open";
    sheet.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        button.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      delete root.dataset.menu;
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <header className="site-header frame">
      <Link href="/" className="wordmark" aria-label="Remedy home">
        Remedy
      </Link>
      <nav aria-label="Main" className="site-nav">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="nav-link" aria-current={path && current(path, l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <ViewMenu />
        <Link href={CTA.href} className="btn btn-primary header-cta">
          {CTA.label}
        </Link>
        <button ref={button} type="button" className="btn btn-quiet menu-btn" aria-expanded={menu} aria-controls="mobile-menu" onClick={() => setMenu((m) => !m)}>
          {menu ? "Close" : "Menu"}
        </button>
      </div>
      {menu && (
        <div ref={sheet} id="mobile-menu" className="mobile-menu">
          <nav aria-label="Main mobile">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="mobile-link" aria-current={path && current(path, l.href) ? "page" : undefined} onClick={() => setMenu(false)}>
                {l.label}
              </Link>
            ))}
            <Link href={CTA.href} className="btn btn-primary mobile-cta" onClick={() => setMenu(false)}>
              {CTA.label}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
