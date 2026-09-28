/**
 * Web image search for the tutor, backed by Wikimedia Commons.
 *
 * Commons has freely licensed diagrams for most NCERT topics (anatomy plates,
 * PV diagrams, circuits, molecular structures), needs no API key, and serves
 * images from a CDN that browsers can hotlink.
 */

export type ImageResult = { title: string; url: string; page: string };

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const SHOWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"]);

// Scanned book pages ("Image from page 97 of ...") match almost any query but
// are rarely the diagram the student needs.
const NOISE = /^(image from page|page \d+|[^a-z]*$)/i;

/**
 * Title matches first (every word in the file title is far more precise than
 * Commons' full-text search), topped up with full-text results if needed.
 */
export async function searchImages(query: string, limit = 5): Promise<ImageResult[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const byTitle = await searchCommons(words.map((w) => `intitle:${w}`).join(" "), limit);
  if (byTitle.length >= limit) return byTitle;
  const seen = new Set(byTitle.map((r) => r.url));
  const broad = (await searchCommons(query, limit)).filter((r) => !seen.has(r.url));
  return [...byTitle, ...broad].slice(0, limit);
}

async function searchCommons(search: string, limit: number): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${search} filetype:bitmap|drawing`,
    gsrnamespace: "6", // File: pages
    gsrlimit: String(Math.min(limit * 2, 20)),
    prop: "imageinfo",
    iiprop: "url|mime",
    iiurlwidth: "800",
  });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    // Wikimedia asks API clients to identify themselves.
    headers: { "user-agent": "AtomTutor/1.0 (https://theatom.vercel.app)" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Wikimedia search failed: HTTP ${res.status}`);
  const data = (await res.json()) as {
    query?: {
      pages?: Record<string, {
        index: number;
        title: string;
        imageinfo?: { thumburl?: string; url: string; mime: string; descriptionurl: string }[];
      }>;
    };
  };

  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .flatMap((p) => {
      const info = p.imageinfo?.[0];
      const title = p.title.replace(/^File:/, "").replace(/\.\w+$/, "");
      if (!info || !SHOWABLE.has(info.mime) || NOISE.test(title)) return [];
      return [{
        title,
        url: info.thumburl ?? info.url,
        page: info.descriptionurl,
      }];
    })
    .slice(0, limit);
}
