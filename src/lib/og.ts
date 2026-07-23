// Build-time Open Graph reader for the showcase section.
//
// Runs in Node during `astro build`, never in the browser: a client-side fetch of another
// site's HTML is blocked by CORS, and this site is static (GitHub Pages) so there is no
// server to proxy through. The cards are therefore baked at build — see the deploy
// workflow's `repository_dispatch`, which lets a project repo trigger a rebuild here when
// it publishes a release, so the cards refresh without anyone editing this repo.
//
// Every field falls back to a committed copy in site.ts. A project site being down, slow,
// or mid-deploy must never fail the build or blank a card — it just serves the last known
// values, which are the ones a reviewer already approved.

export type OgData = {
  title: string;
  description: string;
  image: string;
};

const TIMEOUT_MS = 8000;

/** Read one `<meta>` value, accepting either attribute order (content before or after property). */
function readMeta(html: string, prop: string): string | undefined {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*?content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?property=["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return undefined;
}

// The tags are HTML-escaped in the source pages (&amp;, &#39;, …). Astro escapes on output,
// so decoding here is what stops a title rendering as "you&amp;apos;re".
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" doesn't become "<"
}

/**
 * Fetch a page and read its OG tags, falling back field-by-field to the committed values.
 *
 * Relative `og:image` values are resolved against the page URL, so a project page using
 * `content="og.png"` still yields an absolute src.
 */
export async function readOg(url: string, fallback: OgData): Promise<OgData> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const image = readMeta(html, 'og:image') ?? fallback.image;
    return {
      title: readMeta(html, 'og:title') ?? fallback.title,
      description: readMeta(html, 'og:description') ?? fallback.description,
      image: new URL(image, url).href,
    };
  } catch (err) {
    // Warn rather than throw: a red build over someone else's cold start would be the
    // worse failure. The card still renders, from the committed copy.
    console.warn(
      `[showcase] Could not read OG tags from ${url} — using the committed fallback. ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return fallback;
  }
}
