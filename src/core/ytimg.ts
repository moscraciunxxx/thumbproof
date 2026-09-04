/**
 * ThumbProof — YouTube thumbnail retrieval.
 *
 * ============================================================================
 * WHY THIS IS PURELY CLIENT-SIDE
 * ============================================================================
 * `i.ytimg.com` serves thumbnail rasters with CORS enabled: `fetch()` returns a
 * response of type "cors", and an `<img crossOrigin="anonymous">` drawn to a
 * canvas leaves that canvas readable by `getImageData`. Verified empirically
 * against the deployed page. So a creator can paste a URL and get real measured
 * pixels with no API key, no backend and no upload — which keeps the promise in
 * types.ts intact: every number the tool shows is measured, on the user's own
 * machine, from bytes YouTube itself served.
 *
 * ============================================================================
 * THIS FILE MUST NOT THROW ON USER INPUT
 * ============================================================================
 * `parseYouTubeId` is fed whatever is in the clipboard. That is hostile input by
 * definition: half-copied URLs, share text, an entire paragraph, a `javascript:`
 * URI. It returns `null` for anything it cannot read and never throws — every
 * `new URL()` call is inside a try/catch, and every regex here is anchored and
 * linear (no nested quantifiers), so no input can trigger catastrophic
 * backtracking.
 *
 * The only function that throws is `fetchBestThumbnail`, and only after the
 * entire ladder has failed — that is a genuine "there is nothing to analyse"
 * condition the UI must surface, not a parse failure.
 */

/** A thumbnail raster YouTube actually serves. */
export interface YtVariant {
  name: string;
  width: number;
  height: number;
  url: string;
}

/**
 * Injectable image loader. Resolves with the decoded natural dimensions of the
 * raster at `url`, rejects if it cannot be decoded. Exists so tests never touch
 * the network — the network is not a unit under test.
 */
export type ThumbnailLoader = (url: string) => Promise<{ width: number; height: number }>;

/** The exact shape of a YouTube video id: 11 chars of base64url. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Anything longer than this is not a URL a human pasted — browsers and servers
 * cap practical URLs far below it. Bailing early means a megabyte of pasted text
 * costs one length check instead of a regex scan.
 */
const MAX_INPUT = 2048;

/** `scheme:` prefix per RFC 3986. Used only to *reject* non-http(s) schemes. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/**
 * Path prefixes on youtube.com that are followed by a bare video id.
 * `v` and `e` are the legacy Flash-era embed paths; still handed out by old
 * share dialogs and still resolve, so they are cheap to accept.
 */
const ID_BEARING_PATHS = new Set(['shorts', 'embed', 'live', 'v', 'e']);

/** Hosts we will read an id from. Subdomains (`m.`, `music.`, `gaming.`) allowed. */
const YT_DOMAINS = ['youtube.com', 'youtube-nocookie.com'];

/**
 * Extract an 11-character video id from anything a creator might paste.
 *
 * Accepts: watch URLs (`?v=` in any parameter position), `youtu.be` short links,
 * `/shorts/`, `/embed/`, `/live/`, the legacy `/v/` and `/e/` embed paths, any
 * `*.youtube.com` subdomain (`m.`, `music.`), `youtube-nocookie.com`, URLs with
 * no scheme, surrounding whitespace, and a bare id on its own.
 *
 * Returns `null` — never throws — for everything else, including channel and
 * playlist pages, non-YouTube hosts, non-http(s) schemes, and any candidate that
 * is not exactly 11 chars of `[A-Za-z0-9_-]`.
 *
 * Deliberately NOT supported:
 *  - `youtube.com/attribution_link?u=%2Fwatch%3Fv%3D...` — the id lives inside a
 *    percent-encoded nested URL. Rare enough that the extra unwrapping layer
 *    (and the second parse it needs) is not worth the attack surface.
 *  - `youtube.com:443/watch?v=...` (host:port with no scheme). `youtube.com:` is
 *    indistinguishable from a scheme without guessing, and we resolve that
 *    ambiguity toward rejection.
 *  - ids carried in a fragment (`#v=...`). Not a form YouTube ever emits.
 *
 * O(n) in the input length.
 */
export function parseYouTubeId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s.length === 0 || s.length > MAX_INPUT) return null;

  // A bare id, pasted on its own. Checked first: no URL contains a `/` or `:`
  // and is also exactly 11 id-legal chars, so this cannot shadow a real URL.
  if (VIDEO_ID.test(s)) return s;

  const scheme = SCHEME.exec(s);
  let candidate = s;
  if (scheme) {
    const proto = (scheme[1] ?? '').toLowerCase();
    // `javascript:`, `data:`, `file:` and friends stop here.
    if (proto !== 'http' && proto !== 'https') return null;
  } else {
    // `youtube.com/watch?v=...` — a scheme-less paste. `new URL` needs one.
    candidate = `https://${s}`;
  }

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const segments = u.pathname.split('/').filter((p) => p.length > 0);

  // youtu.be/<id> — the whole path is the id.
  if (host === 'youtu.be') {
    return idOrNull(segments[0]);
  }

  // `endsWith('.youtube.com')` only matches on a label boundary, so
  // `evil-youtube.com` and `notyoutube.com` are both correctly rejected.
  const isYouTube = YT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  if (!isYouTube) return null;

  // `?v=` first, and via searchParams so parameter ORDER never matters:
  // `?list=PL123&v=<id>&t=42s` reads identically to `?v=<id>`.
  const v = idOrNull(u.searchParams.get('v'));
  if (v) return v;

  const [head, tail] = segments;
  if (head && tail && ID_BEARING_PATHS.has(head.toLowerCase())) {
    return idOrNull(tail);
  }

  // A channel page, a playlist page, the homepage: real YouTube, no video.
  return null;
}

/** Gate every extracted candidate through the same shape check. */
function idOrNull(candidate: string | undefined | null): string | null {
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/**
 * The derivative ladder for an id, best first.
 *
 * `maxresdefault` only exists when the upload was at least 1280 wide; `hq720`
 * is generated far more often, which is why it sits second rather than being
 * treated as a curiosity — it is usually the best raster actually available.
 *
 * ASPECT RATIO WARNING: `sddefault` (640x480), `hqdefault` (480x360) and
 * `default` (120x90) are 4:3 frames. A 16:9 upload is LETTERBOXED into them —
 * YouTube pads the top and bottom with black bars rather than cropping. Any
 * measurement taken on one of those rasters without stripping the bars is
 * measuring the padding as if it were artwork: contrast, saliency and text-size
 * checks all shift. `maxresdefault`, `hq720` and `mqdefault` are true 16:9 and
 * need no such treatment.
 *
 * The id is percent-encoded on the way into the path so that a malformed id
 * handed straight to this function (it does not validate — `parseYouTubeId`
 * does) cannot inject path segments such as `../`.
 */
export function thumbnailLadder(id: string): YtVariant[] {
  const base = `https://i.ytimg.com/vi/${encodeURIComponent(id)}`;
  const rungs: ReadonlyArray<readonly [string, number, number]> = [
    ['maxresdefault', 1280, 720], // 16:9, source must have been >=1280 wide
    ['hq720', 1280, 720], // 16:9, often present when maxres is not
    ['sddefault', 640, 480], // 4:3 — letterboxes a 16:9 upload
    ['hqdefault', 480, 360], // 4:3 — letterboxes a 16:9 upload
    ['mqdefault', 320, 180], // 16:9
    ['default', 120, 90], // 4:3 — letterboxes a 16:9 upload
  ];
  return rungs.map(([name, width, height]) => ({
    name,
    width,
    height,
    url: `${base}/${name}.jpg`,
  }));
}

/**
 * True when a decoded image is YouTube's grey "no maxres" placeholder.
 *
 * When a video has no raster at the requested rung, `i.ytimg.com` does NOT
 * return 404. It returns HTTP 200 with a 120x90 flat grey JPEG. An `<img>` load
 * therefore SUCCEEDS, and a caller that only checks for load errors will happily
 * analyse a grey rectangle and report it as the creator's thumbnail. Size is the
 * only signal available before decode, so 120x90 is the test.
 *
 * Consequence worth stating plainly: a genuine `default.jpg` is also exactly
 * 120x90 and is indistinguishable here. That costs nothing, because 120px is far
 * below `MIN_USEFUL_WIDTH` and is rejected either way — there is no thumbnail
 * decision worth making from a 120px raster.
 */
export function isPlaceholder(width: number, height: number): boolean {
  return width === 120 && height === 90;
}

/**
 * Below this, a raster cannot answer the question ThumbProof asks. The smallest
 * surface we simulate is a mobile feed card, and measuring stroke widths or
 * contrast on a source narrower than the surface itself would be measuring the
 * upscaler, not the artwork.
 */
const MIN_USEFUL_WIDTH = 320;

/**
 * Fetch the best available raster.
 *
 * Walks the ladder best-first and returns the FIRST variant that loads, is not
 * the grey placeholder, and is at least `MIN_USEFUL_WIDTH` wide — then stops.
 * It does not probe the remaining rungs: on the common path (maxres exists) that
 * is one request instead of six.
 *
 * The returned variant carries the dimensions the loader actually MEASURED, not
 * the nominal ones from the ladder. YouTube's rungs are conventional, not
 * guaranteed, and this project does not report numbers it has not observed.
 *
 * Throws when every rung fails, naming the id — that is a real condition (a
 * private, deleted or nonexistent video) and the UI must be able to say so.
 */
export async function fetchBestThumbnail(
  id: string,
  load: ThumbnailLoader = loadViaImage,
): Promise<YtVariant> {
  const ladder = thumbnailLadder(id);
  for (const variant of ladder) {
    let size: { width: number; height: number };
    try {
      size = await load(variant.url);
    } catch {
      continue; // 404, CORS failure, decode failure — try the next rung down.
    }
    if (isPlaceholder(size.width, size.height)) continue;
    if (size.width < MIN_USEFUL_WIDTH) continue;
    return { ...variant, width: size.width, height: size.height };
  }
  throw new Error(
    `ytimg: no thumbnail could be retrieved for video id "${id}" ` +
      `(tried ${ladder.length} variants: ${ladder.map((v) => v.name).join(', ')})`,
  );
}

/**
 * Default loader: a CORS-enabled `<img>`, resolving with its natural size.
 *
 * `crossOrigin = 'anonymous'` is the load-bearing line. Without it the image
 * still renders, but drawing it to a canvas TAINTS that canvas and every later
 * `getImageData` throws a SecurityError — the analyser would die at the first
 * pixel read, several steps away from the actual mistake.
 *
 * Never used by the tests, which pass their own loader.
 */
function loadViaImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('ytimg: no Image constructor here — pass an explicit loader'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const { naturalWidth, naturalHeight } = img;
      if (naturalWidth === 0 || naturalHeight === 0) {
        reject(new Error(`ytimg: decoded to zero pixels: ${url}`));
        return;
      }
      resolve({ width: naturalWidth, height: naturalHeight });
    };
    img.onerror = () => reject(new Error(`ytimg: could not load ${url}`));
    img.src = url;
  });
}
