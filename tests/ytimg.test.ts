/**
 * The URL box is the only place a stranger's bytes enter ThumbProof.
 *
 * Everything else in this project is fed pixels the user chose from disk. The
 * paste field takes arbitrary clipboard content, so these tests are written the
 * way input-validation tests should be: every accepted form is asserted to
 * produce the exact id, every rejected form is asserted to produce `null`, and
 * the hostile inputs are asserted to do BOTH - return null and not throw - since
 * a throw here takes down the page on a stray keystroke.
 *
 * `fetchBestThumbnail` is tested against a recording stub. No test touches the
 * network: the network is not a unit, and a test that depends on YouTube's CDN
 * being up is a test that fails for reasons unrelated to this code.
 */

import { describe, it, expect } from 'vitest';
import {
  parseYouTubeId,
  thumbnailLadder,
  isPlaceholder,
  fetchBestThumbnail,
} from '../src/core/ytimg';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeId - forms a creator actually pastes', () => {
  const accepted: ReadonlyArray<readonly [string, string]> = [
    ['canonical watch URL', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['youtu.be short link', 'https://youtu.be/dQw4w9WgXcQ'],
    ['shorts', 'https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ['embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['live', 'https://www.youtube.com/live/dQw4w9WgXcQ'],
    ['mobile subdomain', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['music subdomain', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['params before v', 'https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=42s'],
    ['params after v', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s'],
    ['youtu.be with a timestamp', 'https://youtu.be/dQw4w9WgXcQ?t=42'],
    ['bare id', 'dQw4w9WgXcQ'],
    ['leading and trailing whitespace', '   https://youtu.be/dQw4w9WgXcQ   '],
    ['bare id with whitespace', '   dQw4w9WgXcQ  '],
    ['no scheme', 'youtube.com/watch?v=dQw4w9WgXcQ'],
    ['no scheme, short link', 'youtu.be/dQw4w9WgXcQ'],
    ['http rather than https', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['no www', 'https://youtube.com/watch?v=dQw4w9WgXcQ'],
    ['nocookie embed', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['legacy /v/ embed path', 'https://www.youtube.com/v/dQw4w9WgXcQ'],
    ['trailing slash', 'https://youtu.be/dQw4w9WgXcQ/'],
    ['uppercase host', 'https://WWW.YouTube.COM/watch?v=dQw4w9WgXcQ'],
    ['fragment after the id', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=1m'],
  ];

  for (const [label, url] of accepted) {
    it(`reads the id from ${label}`, () => {
      expect(parseYouTubeId(url)).toBe(ID);
    });
  }

  it('handles a newline-and-tab wrapped paste', () => {
    expect(parseYouTubeId('\n\t https://youtu.be/dQw4w9WgXcQ \t\n')).toBe(ID);
  });

  it('preserves ids containing the base64url extras - and _', () => {
    expect(parseYouTubeId('https://youtu.be/a-B_c1D2e3F')).toBe('a-B_c1D2e3F');
    expect(parseYouTubeId('_-_-_-_-_-_')).toBe('_-_-_-_-_-_');
  });
});

describe('parseYouTubeId - rejections', () => {
  const rejected: ReadonlyArray<readonly [string, string]> = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['a non-YouTube URL', 'https://vimeo.com/12345'],
    ['a lookalike host', 'https://notyoutube.com/watch?v=dQw4w9WgXcQ'],
    ['a hyphenated lookalike host', 'https://evil-youtube.com/watch?v=dQw4w9WgXcQ'],
    [
      'a host that merely starts with youtube.com',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    ],
    ['a channel page', 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw'],
    ['a handle page', 'https://www.youtube.com/@someone'],
    ['a playlist page', 'https://www.youtube.com/playlist?list=PL1234567890'],
    ['the YouTube homepage', 'https://www.youtube.com/'],
    ['a watch URL with no v parameter', 'https://www.youtube.com/watch'],
    ['an id that is too short', 'https://youtube.com/watch?v=short'],
    ['an id that is too long', 'https://youtube.com/watch?v=dQw4w9WgXcQextra'],
    ['a 10-char bare token', 'dQw4w9WgXc'],
    ['a 12-char bare token', 'dQw4w9WgXcQQ'],
    ['a bare token with an illegal char', 'dQw4w9WgXc!'],
    ['a shorts URL with no id', 'https://www.youtube.com/shorts/'],
    ['an unsupported scheme on a real host', 'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    [
      'an attribution_link wrapper (documented as unsupported)',
      'https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DdQw4w9WgXcQ',
    ],
  ];

  for (const [label, url] of rejected) {
    it(`returns null for ${label}`, () => {
      expect(parseYouTubeId(url)).toBeNull();
    });
  }
});

describe('parseYouTubeId - hostile input never throws', () => {
  const hostile: string[] = [
    '',
    '   ',
    'not a url',
    'https://',
    'https:',
    '//',
    '???',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://vimeo.com/12345',
    'https://youtube.com/watch?v=short',
    'https://youtube.com/watch?v=../../../etc/passwd',
    'https://youtu.be/../../admin',
    '<script>alert(1)</script>',
    '{"v":"dQw4w9WgXcQ"}',
    'https://youtube.com/watch?v=' + 'a'.repeat(5000),
    'x'.repeat(5000),
    '?'.repeat(5000),
    'https://' + 'a.'.repeat(2000) + 'youtube.com/watch?v=dQw4w9WgXcQ',
  ];

  for (const input of hostile) {
    const label =
      input.length > 40 ? `a ${input.length}-char string starting ${input.slice(0, 24)}` : JSON.stringify(input);
    it(`survives ${label}`, () => {
      expect(() => parseYouTubeId(input)).not.toThrow();
      expect(parseYouTubeId(input)).toBeNull();
    });
  }

  it('never throws across the whole hostile corpus', () => {
    for (const input of hostile) {
      expect(parseYouTubeId(input)).toBeNull();
    }
  });

  it('survives non-string input that slipped past the type system', () => {
    const junk: unknown[] = [null, undefined, 42, {}, [], true];
    for (const value of junk) {
      expect(() => parseYouTubeId(value as string)).not.toThrow();
      expect(parseYouTubeId(value as string)).toBeNull();
    }
  });
});

describe('thumbnailLadder', () => {
  it('puts maxresdefault first', () => {
    expect(thumbnailLadder(ID)[0]!.name).toBe('maxresdefault');
  });

  it('puts hq720 second, because it exists when maxres often does not', () => {
    expect(thumbnailLadder(ID)[1]!.name).toBe('hq720');
  });

  it('is ordered by descending width', () => {
    const widths = thumbnailLadder(ID).map((v) => v.width);
    const sorted = [...widths].sort((a, b) => b - a);
    expect(widths).toEqual(sorted);
  });

  it('names every rung YouTube actually serves', () => {
    expect(thumbnailLadder(ID).map((v) => v.name)).toEqual([
      'maxresdefault',
      'hq720',
      'sddefault',
      'hqdefault',
      'mqdefault',
      'default',
    ]);
  });

  it('builds every url on i.ytimg.com and includes the id', () => {
    for (const v of thumbnailLadder(ID)) {
      expect(v.url).toContain(ID);
      expect(v.url).toBe(`https://i.ytimg.com/vi/${ID}/${v.name}.jpg`);
    }
  });

  it('carries the nominal dimensions of each rung', () => {
    const byName = new Map(thumbnailLadder(ID).map((v) => [v.name, v]));
    const dims = (name: string): [number, number] => {
      const v = byName.get(name)!;
      return [v.width, v.height];
    };
    expect(dims('maxresdefault')).toEqual([1280, 720]);
    expect(dims('hq720')).toEqual([1280, 720]);
    expect(dims('sddefault')).toEqual([640, 480]);
    expect(dims('hqdefault')).toEqual([480, 360]);
    expect(dims('mqdefault')).toEqual([320, 180]);
    expect(dims('default')).toEqual([120, 90]);
  });

  it('escapes a malformed id rather than letting it inject path segments', () => {
    const url = thumbnailLadder('../../evil')[0]!.url;
    expect(url).not.toContain('../');
    expect(url.startsWith('https://i.ytimg.com/vi/')).toBe(true);
  });

  it('returns a fresh array each call, so a caller cannot mutate shared state', () => {
    const a = thumbnailLadder(ID);
    a[0]!.name = 'clobbered';
    expect(thumbnailLadder(ID)[0]!.name).toBe('maxresdefault');
  });
});

describe('isPlaceholder', () => {
  it('is true for the 120x90 grey placeholder', () => {
    expect(isPlaceholder(120, 90)).toBe(true);
  });

  it('is false for a real maxres raster', () => {
    expect(isPlaceholder(1280, 720)).toBe(false);
  });

  it('is false for every other rung', () => {
    expect(isPlaceholder(640, 480)).toBe(false);
    expect(isPlaceholder(480, 360)).toBe(false);
    expect(isPlaceholder(320, 180)).toBe(false);
  });

  it('requires BOTH dimensions to match, not either', () => {
    expect(isPlaceholder(120, 720)).toBe(false);
    expect(isPlaceholder(1280, 90)).toBe(false);
  });
});

/** A loader that answers from a table and records the order it was asked in. */
function recordingLoader(table: Record<string, { width: number; height: number } | 'error'>) {
  const calls: string[] = [];
  const load = async (url: string): Promise<{ width: number; height: number }> => {
    const name = (url.split('/').pop() ?? '').replace(/\.jpg$/, '');
    calls.push(name);
    const entry = table[name];
    if (entry === undefined || entry === 'error') {
      throw new Error(`stub: ${name} is not available`);
    }
    return entry;
  };
  return { load, calls };
}

const MAXRES = { width: 1280, height: 720 };
const PLACEHOLDER = { width: 120, height: 90 };

describe('fetchBestThumbnail', () => {
  it('picks maxresdefault when it loads', async () => {
    const { load } = recordingLoader({ maxresdefault: MAXRES, hq720: MAXRES });
    const best = await fetchBestThumbnail(ID, load);
    expect(best.name).toBe('maxresdefault');
    expect(best.url).toBe(`https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`);
  });

  it('stops at the first usable rung instead of probing the whole ladder', async () => {
    const { load, calls } = recordingLoader({
      maxresdefault: MAXRES,
      hq720: MAXRES,
      sddefault: { width: 640, height: 480 },
    });
    await fetchBestThumbnail(ID, load);
    expect(calls).toEqual(['maxresdefault']);
  });

  it('falls through to hq720 when maxres is the 120x90 placeholder', async () => {
    const { load, calls } = recordingLoader({
      maxresdefault: PLACEHOLDER,
      hq720: MAXRES,
      sddefault: { width: 640, height: 480 },
    });
    const best = await fetchBestThumbnail(ID, load);
    expect(best.name).toBe('hq720');
    expect(calls).toEqual(['maxresdefault', 'hq720']);
  });

  it('falls through again when a variant rejects outright', async () => {
    const { load, calls } = recordingLoader({
      maxresdefault: PLACEHOLDER,
      hq720: 'error',
      sddefault: { width: 640, height: 480 },
      hqdefault: { width: 480, height: 360 },
    });
    const best = await fetchBestThumbnail(ID, load);
    expect(best.name).toBe('sddefault');
    expect(calls).toEqual(['maxresdefault', 'hq720', 'sddefault']);
  });

  it('walks the ladder strictly best-first', async () => {
    const { load, calls } = recordingLoader({ mqdefault: { width: 320, height: 180 } });
    const best = await fetchBestThumbnail(ID, load);
    expect(best.name).toBe('mqdefault');
    expect(calls).toEqual(['maxresdefault', 'hq720', 'sddefault', 'hqdefault', 'mqdefault']);
    expect(calls).toEqual(
      thumbnailLadder(ID)
        .map((v) => v.name)
        .slice(0, calls.length),
    );
  });

  it('skips a raster narrower than 320px even though it loaded fine', async () => {
    const { load, calls } = recordingLoader({
      maxresdefault: { width: 200, height: 112 },
      hq720: MAXRES,
    });
    const best = await fetchBestThumbnail(ID, load);
    expect(best.name).toBe('hq720');
    expect(calls).toEqual(['maxresdefault', 'hq720']);
  });

  it('accepts mqdefault at exactly the 320px floor', async () => {
    const { load } = recordingLoader({ mqdefault: { width: 320, height: 180 } });
    expect((await fetchBestThumbnail(ID, load)).width).toBe(320);
  });

  it('reports the MEASURED size, not the nominal size of the rung', async () => {
    const { load } = recordingLoader({ maxresdefault: { width: 1920, height: 1080 } });
    const best = await fetchBestThumbnail(ID, load);
    expect(best.name).toBe('maxresdefault');
    expect(best.width).toBe(1920);
    expect(best.height).toBe(1080);
  });

  it('throws, naming the id, when every rung fails', async () => {
    const { load, calls } = recordingLoader({});
    await expect(fetchBestThumbnail(ID, load)).rejects.toThrow(ID);
    await expect(fetchBestThumbnail(ID, load)).rejects.toThrow(/no thumbnail could be retrieved/i);
    expect(calls.length).toBe(thumbnailLadder(ID).length * 2);
  });

  it('throws when only the grey placeholder is served at every rung', async () => {
    const all = Object.fromEntries(thumbnailLadder(ID).map((v) => [v.name, PLACEHOLDER] as const));
    const { load } = recordingLoader(all);
    await expect(fetchBestThumbnail(ID, load)).rejects.toThrow(ID);
  });

  it('throws when the only rung that loads is the 120x90 default', async () => {
    const { load } = recordingLoader({ default: { width: 120, height: 90 } });
    await expect(fetchBestThumbnail(ID, load)).rejects.toThrow(/no thumbnail could be retrieved/i);
  });
});
