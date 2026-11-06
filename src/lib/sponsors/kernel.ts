import Kernel from "@onkernel/sdk";

export type PageRead = { text: string; title: string; via: "kernel" | "fetch"; liveViewUrl?: string; sessionId?: string };

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Only public http(s) pages; no private network addresses. */
export function safePublicUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(u.hostname) && process.env.NODE_ENV === "production") return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Read a public page: a cpsc.gov recall page or a firm's recall microsite. KERNEL's cloud browser renders
 * JavaScript-heavy pages and returns a live-view link; a plain fetch is the fallback for static pages and for when
 * KERNEL is not configured.
 */
export async function readPage(url: URL): Promise<PageRead> {
  if (process.env.KERNEL_API_KEY && process.env.FALLBACK_KERNEL !== "true") {
    const kernel = new Kernel();
    const browser = await kernel.browsers.create({ timeout_seconds: 120 });
    try {
      const r = await kernel.browsers.playwright.execute(browser.session_id, {
        code: `await page.goto(${JSON.stringify(url.toString())}, { waitUntil: 'networkidle', timeout: 30000 });
return { title: await page.title(), text: (await page.evaluate(() => document.body.innerText)).slice(0, 60000) };`,
        timeout_sec: 60,
      });
      if (r.success && r.result && typeof r.result === "object") {
        const res = r.result as { title?: string; text?: string };
        return { text: res.text ?? "", title: res.title ?? "", via: "kernel", liveViewUrl: browser.browser_live_view_url, sessionId: browser.session_id };
      }
    } finally {
      await kernel.browsers.deleteByID(browser.session_id).catch(() => undefined);
    }
  }
  const res = await fetch(url, { headers: { "User-Agent": "RemedyBot/1.0 (+https://github.com/usv240/remedy)" }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  return { text: stripHtml(html).slice(0, 60000), title, via: "fetch" };
}
