/**
 * Loading Bryntum Gantt in the browser. The trial ships one 5.8 MB bundle
 * that Turbopack cannot analyse within Render's build memory, so scripts/vendor-bryntum.mjs copies its UMD build to
 * public/bryntum/ and the page loads it as a plain script; bryntum-global.cjs hands its exports to the code.
 *
 * Use: dynamic(() => ensureBryntumTheme().then(ensureBryntumScript).then(() => import("./YourGantt")), { ssr: false })
 */
let bryntumScript: Promise<void> | null = null;

/** Load /bryntum/gantt.umd.js once. It defines window.bryntum.gantt. */
export function ensureBryntumScript(): Promise<void> {
  const g = globalThis as { bryntum?: { gantt?: unknown } };
  if (g.bryntum?.gantt) return Promise.resolve();
  bryntumScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/bryntum/gantt.umd.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      bryntumScript = null;
      s.remove();
      reject(new Error("The plan could not load. Please reload the page."));
    };
    document.head.appendChild(s);
  });
  return bryntumScript;
}

/** The site's theme as Bryntum's light or dark: "system" follows the device. */
export function bryntumThemeName(): "light" | "dark" {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return "dark";
  if (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

/**
 * Put the matching Bryntum theme on the page before Bryntum's code loads. Bryntum checks for a theme soon after it
 * loads and, finding none, fetches one from its CDN, so the theme must already be there. Call it again when the site's
 * theme changes.
 */
export function ensureBryntumTheme(): Promise<void> {
  const href = `/vendor/bryntum/stockholm-${bryntumThemeName()}.css`;
  let link = document.getElementById("bryntum-theme") as HTMLLinkElement | null;
  if (link && link.getAttribute("href") === href && link.sheet) return Promise.resolve();
  if (!link) {
    link = document.createElement("link");
    link.id = "bryntum-theme";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  const el = link;
  return new Promise((resolve) => {
    const done = () => resolve();
    el.addEventListener("load", done, { once: true });
    el.addEventListener("error", done, { once: true });
    if (el.getAttribute("href") !== href) el.setAttribute("href", href);
    else if (el.sheet) resolve();
  });
}
