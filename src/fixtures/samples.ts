/**
 * ThumbProof — sample thumbnails.
 *
 * These are the demo. A judge with five minutes will not go and find a thumbnail
 * to upload, so the tool has to open with one-click samples that each fail exactly
 * one way, plus one that passes, plus a back-catalogue for the shelf test.
 *
 * Authored as standalone SVG source strings at 1280x720 rather than PNGs so that:
 *   - the repo stays tiny and diffable,
 *   - type renders with real font metrics (the cap-height check has to measure
 *     glyphs, not a resampled bitmap),
 *   - the app rasterises them at runtime with `drawImage` from a `data:` URL.
 *
 * Because they load through a plain `<img src="data:...">`, every document here is
 * strictly self-contained: no external images, no web fonts, no `<foreignObject>`,
 * no xlink. The only absolute URL anywhere is the SVG namespace declaration.
 */

export interface Sample {
  id: string;
  /** Short creator-facing name, e.g. "Wall of text". */
  title: string;
  /** One sentence naming the failure this sample demonstrates (or "clean" for the good one). */
  teaches: string;
  /** Expected headline verdict, so the UI can show "this one should fail". */
  expect: 'pass' | 'warn' | 'fail';
  /** Complete standalone SVG document string, 1280x720, no external refs. */
  svg: string;
}

/** Shared type stacks. Generic families only — nothing is fetched. */
const DISPLAY = "Impact, Haettenschweiler, 'Arial Narrow Bold', 'Arial Black', sans-serif";
const HEAVY = "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const UI = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/* ------------------------------------------------------------------ *
 * 1. wall-of-text — a subtitle plus a bullet list. Nothing survives.
 * ------------------------------------------------------------------ */

const WALL_OF_TEXT = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="wtb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#152447"/><stop offset="1" stop-color="#3a1552"/></linearGradient>
<linearGradient id="wty" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd93d"/><stop offset="1" stop-color="#ff9f1c"/></linearGradient>
</defs>
<rect width="1280" height="720" fill="url(#wtb)"/>
<circle cx="1120" cy="150" r="250" fill="#5b2ea8" opacity="0.4"/>
<g stroke="#4a6ea8" stroke-width="3" opacity="0.35"><path d="M0 470h1280M0 560h1280M0 650h1280"/></g>
<g>
<rect x="878" y="250" width="336" height="212" rx="12" fill="#0a1426" stroke="#4b74b8" stroke-width="7"/>
<rect x="902" y="274" width="288" height="164" fill="#183a6d"/>
<g fill="#7fb2ff" opacity="0.75"><rect x="920" y="294" width="150" height="9"/><rect x="920" y="316" width="230" height="9"/><rect x="920" y="338" width="190" height="9"/><rect x="920" y="360" width="240" height="9"/><rect x="920" y="382" width="120" height="9"/><rect x="920" y="404" width="205" height="9"/></g>
<path d="M844 466h404l42 42H802z" fill="#0a1426"/>
</g>
<g font-family="${DISPLAY}" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="7" paint-order="stroke" letter-spacing="1">
<text x="56" y="112" font-size="62">HOW I BUILT A FULL SAAS APP</text>
<text x="56" y="182" font-size="62">IN ONE WEEKEND (NO CODE)</text>
</g>
<g font-family="${UI}" font-weight="700" font-size="30" fill="#ffe27a">
<text x="70" y="272">1. Picking the stack in under 10 minutes</text>
<text x="70" y="316">2. The database schema I always start from</text>
<text x="70" y="360">3. Auth, billing and email without a backend</text>
<text x="70" y="404">4. Deploying to production on a free tier</text>
<text x="70" y="448">5. The three mistakes that cost me a weekend</text>
</g>
<g font-family="${UI}" font-weight="400" font-size="26" fill="#cfd8ef">
<text x="70" y="516">timestamps, full source code and the template in the description</text>
<text x="70" y="552">no paid tools, no sponsors, filmed in one continuous session</text>
</g>
<rect x="0" y="600" width="1280" height="120" fill="#000000" opacity="0.55"/>
<text x="640" y="652" text-anchor="middle" font-family="${UI}" font-weight="600" font-size="34" fill="#ffffff">everything you actually need to know before you start building,</text>
<text x="640" y="694" text-anchor="middle" font-family="${UI}" font-weight="600" font-size="34" fill="#ffffff">explained slowly, step by step, from a completely blank folder</text>
<rect x="1044" y="20" width="200" height="52" rx="8" fill="url(#wty)"/>
<text x="1144" y="57" text-anchor="middle" font-family="${UI}" font-weight="800" font-size="28" fill="#20160a">PART 3 OF 7</text>
</svg>`;

/* ------------------------------------------------------------------ *
 * 2. low-contrast — pale grey type on a mid-grey field.
 * ------------------------------------------------------------------ */

const LOW_CONTRAST = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="lcb" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="#adb3b9"/><stop offset="0.55" stop-color="#9ba1a7"/><stop offset="1" stop-color="#8c9298"/></linearGradient>
<linearGradient id="lcr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a4aab0"/><stop offset="1" stop-color="#949aa0"/></linearGradient>
<filter id="lch" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>
</defs>
<rect width="1280" height="720" fill="url(#lcb)"/>
<circle cx="944" cy="176" r="126" fill="#bcc1c6" filter="url(#lch)"/>
<path d="M0 508 200 356 372 470 596 292 828 486 1052 366 1280 494v226H0z" fill="url(#lcr)"/>
<path d="M0 596 296 464 520 580 782 428 1014 574 1280 452v268H0z" fill="#8f9599"/>
<path d="M0 668 340 596 640 646 980 580 1280 640v80H0z" fill="#878d93"/>
<g fill="#9ba1a7" opacity="0.9"><rect x="292" y="556" width="7" height="62"/><path d="M295 548l30 20-30 16z"/></g>
<g font-family="${UI}" fill="#c9cdd2">
<text x="640" y="332" text-anchor="middle" font-weight="300" font-size="134" letter-spacing="16">STILL HERE</text>
<text x="640" y="418" text-anchor="middle" font-weight="400" font-size="34" letter-spacing="11" fill="#c2c7cc">ONE YEAR ALONE IN THE HIGHLANDS</text>
</g>
<rect x="470" y="366" width="340" height="2" fill="#c4c9ce"/>
<text x="640" y="642" text-anchor="middle" font-family="${UI}" font-weight="300" font-size="30" letter-spacing="7" fill="#bec3c8">DAY 365</text>
</svg>`;

/* ------------------------------------------------------------------ *
 * 3. badge-collision — payoff word parked under the duration pill.
 * ------------------------------------------------------------------ */

const BADGE_COLLISION = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="bcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b0121f"/><stop offset="1" stop-color="#f0521c"/></linearGradient>
<linearGradient id="bcw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffcf3d"/><stop offset="1" stop-color="#ff8a00"/></linearGradient>
<filter id="bcg" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
</defs>
<rect width="1280" height="720" fill="url(#bcb)"/>
<path d="M0 0h620L360 720H0z" fill="#7d0c17" opacity="0.55"/>
<circle cx="1120" cy="560" r="270" fill="#ffffff" opacity="0.14" filter="url(#bcg)"/>
<g font-family="${DISPLAY}" font-weight="700" fill="#ffffff" stroke="#5a0710" stroke-width="12" paint-order="stroke">
<text x="60" y="212" font-size="152">I GOT IT</text>
<text x="60" y="352" font-size="152">FOR</text>
</g>
<path d="M470 400c150 40 300 86 420 168" stroke="#ffd23d" stroke-width="26" fill="none" stroke-linecap="round"/>
<path d="M880 520l16 96-92-40z" fill="#ffd23d"/>
<g>
<circle cx="1108" cy="546" r="152" fill="#f2c39b" stroke="#5a0710" stroke-width="10"/>
<path d="M960 512c8-92 74-146 148-146s140 54 148 146c-40-46-96-58-148-58s-108 12-148 58z" fill="#3a2418"/>
<ellipse cx="1058" cy="524" rx="15" ry="20" fill="#2a1a12"/>
<ellipse cx="1156" cy="524" rx="15" ry="20" fill="#2a1a12"/>
<ellipse cx="1108" cy="626" rx="44" ry="54" fill="#7b1d1d"/>
<ellipse cx="1108" cy="644" rx="30" ry="30" fill="#e0716d"/>
</g>
<text x="1176" y="690" text-anchor="middle" font-family="${DISPLAY}" font-weight="700" font-size="104" fill="url(#bcw)" stroke="#3d0509" stroke-width="11" paint-order="stroke">FREE</text>
<rect x="46" y="430" width="326" height="74" rx="10" fill="#111111"/>
<text x="209" y="486" text-anchor="middle" font-family="${UI}" font-weight="800" font-size="40" fill="#ffd23d">NO CATCH</text>
<text x="60" y="596" font-family="${UI}" font-weight="700" font-size="42" fill="#ffe6b0">and they shipped it same day</text>
</svg>`;

/* ------------------------------------------------------------------ *
 * 4. detail-collapse — high-frequency composition, nothing survives 168px.
 * ------------------------------------------------------------------ */

const DETAIL_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="dcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1524"/><stop offset="1" stop-color="#101d2e"/></linearGradient>
<pattern id="dch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><rect width="9" height="9" fill="none"/><path d="M0 0v9" stroke="#2b4a6b" stroke-width="1.4"/></pattern>
<pattern id="dcd" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.5" fill="#2f5c86"/></pattern>
</defs>
<rect width="1280" height="720" fill="url(#dcb)"/>
<rect width="1280" height="720" fill="url(#dch)" opacity="0.55"/>
<rect x="0" y="470" width="1280" height="250" fill="url(#dcd)" opacity="0.7"/>
<g stroke="#3b6da0" stroke-width="1.2" opacity="0.75">
<path d="M40 0v720M120 0v720M200 0v720M280 0v720M360 0v720M440 0v720M520 0v720M600 0v720M680 0v720M760 0v720M840 0v720M920 0v720M1000 0v720M1080 0v720M1160 0v720M1240 0v720"/>
<path d="M0 60h1280M0 140h1280M0 220h1280M0 300h1280M0 380h1280M0 460h1280M0 540h1280M0 620h1280M0 700h1280"/>
</g>
<g fill="none" stroke="#5ee0c0" stroke-width="2"><path d="M30 430 90 392 150 410 210 340 270 366 330 300 390 322 450 258 510 284 570 214 630 240 690 176 750 202 810 140 870 166 930 108 990 132 1050 78 1110 100 1170 54 1240 74"/></g>
<g fill="none" stroke="#ff7ab8" stroke-width="1.6" stroke-dasharray="5 4"><path d="M30 466 90 442 150 456 210 418 270 436 330 400 390 416 450 380 510 398 570 360 630 378 690 342 750 358 810 320 870 338 930 300 990 318 1050 280 1110 298 1170 262 1240 280"/></g>
<g stroke="#4a80b8" stroke-width="1.4" fill="#14263b">
<rect x="34" y="500" width="140" height="94" rx="5"/><rect x="190" y="500" width="140" height="94" rx="5"/><rect x="346" y="500" width="140" height="94" rx="5"/><rect x="502" y="500" width="140" height="94" rx="5"/><rect x="658" y="500" width="140" height="94" rx="5"/><rect x="814" y="500" width="140" height="94" rx="5"/><rect x="970" y="500" width="140" height="94" rx="5"/><rect x="1126" y="500" width="120" height="94" rx="5"/>
<rect x="34" y="610" width="140" height="86" rx="5"/><rect x="190" y="610" width="140" height="86" rx="5"/><rect x="346" y="610" width="140" height="86" rx="5"/><rect x="502" y="610" width="140" height="86" rx="5"/><rect x="658" y="610" width="140" height="86" rx="5"/><rect x="814" y="610" width="140" height="86" rx="5"/><rect x="970" y="610" width="140" height="86" rx="5"/><rect x="1126" y="610" width="120" height="86" rx="5"/>
</g>
<g font-family="${UI}" font-weight="600" font-size="15" fill="#8fc4f0">
<text x="44" y="524">RSI 14</text><text x="200" y="524">MACD</text><text x="356" y="524">EMA 200</text><text x="512" y="524">VOL 24H</text><text x="668" y="524">FUNDING</text><text x="824" y="524">OI DELTA</text><text x="980" y="524">SPREAD</text><text x="1136" y="524">BASIS</text>
<text x="44" y="634">LIQ MAP</text><text x="200" y="634">CVD</text><text x="356" y="634">SKEW</text><text x="512" y="634">IV RANK</text><text x="668" y="634">GAMMA</text><text x="824" y="634">THETA</text><text x="980" y="634">VEGA</text><text x="1136" y="634">CORREL</text>
</g>
<g font-family="${UI}" font-weight="700" font-size="21" fill="#e8f3ff">
<text x="44" y="560">+18.4%</text><text x="200" y="560">-2.10</text><text x="356" y="560">41 902</text><text x="512" y="560">3.2 B</text><text x="668" y="560">0.014%</text><text x="824" y="560">+7.8%</text><text x="980" y="560">0.6 bp</text><text x="1136" y="560">1.08</text>
<text x="44" y="670">14 220</text><text x="200" y="670">-880</text><text x="356" y="670">-4.2</text><text x="512" y="670">62</text><text x="668" y="670">0.031</text><text x="824" y="670">-0.9</text><text x="980" y="670">12.4</text><text x="1136" y="670">0.71</text>
</g>
<g font-family="${UI}" font-weight="800" font-size="34" fill="#ffffff"><text x="34" y="52">THE 27 INDICATORS I CHECK EVERY SINGLE MORNING</text></g>
<g font-family="${UI}" font-weight="500" font-size="17" fill="#9fd0f5"><text x="34" y="82">full spreadsheet, alert rules and backtest results linked below</text></g>
</svg>`;

/* ------------------------------------------------------------------ *
 * 5. edge-bleed — the good stuff jammed into the corners.
 * ------------------------------------------------------------------ */

const EDGE_BLEED = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="ebb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a0f5c"/><stop offset="0.55" stop-color="#7a1c8f"/><stop offset="1" stop-color="#e0357a"/></linearGradient>
<linearGradient id="ebt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffd6ef"/></linearGradient>
</defs>
<rect width="1280" height="720" fill="url(#ebb)"/>
<g stroke="#ffffff" stroke-width="3" opacity="0.18" fill="none"><circle cx="0" cy="720" r="320"/><circle cx="0" cy="720" r="450"/><circle cx="1280" cy="0" r="300"/><circle cx="1280" cy="0" r="420"/></g>
<g>
<circle cx="1046" cy="86" r="180" fill="#f5c8a2" stroke="#2a0f5c" stroke-width="9"/>
<path d="M872 66c14-104 88-166 174-166s160 62 174 166c-44-52-104-66-174-66s-130 14-174 66z" fill="#241018"/>
<ellipse cx="988" cy="70" rx="16" ry="21" fill="#241018"/>
<ellipse cx="1104" cy="70" rx="16" ry="21" fill="#241018"/>
<path d="M986 150q60 52 120 0" stroke="#7a2436" stroke-width="14" fill="none" stroke-linecap="round"/>
</g>
<g font-family="${DISPLAY}" font-weight="700" fill="url(#ebt)" stroke="#1b0a3c" stroke-width="11" paint-order="stroke">
<text x="2" y="392" font-size="150">THE WHOLE STORY</text>
<text x="2" y="530" font-size="150">NOBODY TELLS YOU</text>
</g>
<g transform="rotate(-16 96 44)">
<rect x="-42" y="6" width="278" height="76" fill="#ffd23d"/>
<text x="96" y="60" text-anchor="middle" font-family="${UI}" font-weight="900" font-size="40" fill="#2a0f5c">NEW 2026</text>
</g>
<text x="4" y="710" font-family="${DISPLAY}" font-weight="700" font-size="88" fill="#ffd23d" stroke="#1b0a3c" stroke-width="9" paint-order="stroke">EPISODE 4</text>
<path d="M1276 300l-96 54 96 54z" fill="#ffffff" opacity="0.92"/>
<text x="1278" y="612" text-anchor="end" font-family="${UI}" font-weight="800" font-size="46" fill="#ffffff" stroke="#1b0a3c" stroke-width="7" paint-order="stroke">PART 1</text>
</svg>`;

/* ------------------------------------------------------------------ *
 * 6. clean — three heavy words, subject left, bottom-right kept empty.
 * ------------------------------------------------------------------ */

const CLEAN = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="clb" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#ffd54a"/><stop offset="1" stop-color="#ff9a12"/></linearGradient>
<linearGradient id="clw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff8a00"/><stop offset="1" stop-color="#ffb42e"/></linearGradient>
</defs>
<rect width="1280" height="720" fill="url(#clb)"/>
<path d="M0 720V440L520 0h286L188 720z" fill="url(#clw)" opacity="0.45"/>
<circle cx="240" cy="348" r="220" fill="#fff0b8" opacity="0.5"/>
<circle cx="250" cy="318" r="140" fill="none" stroke="#fff6de" stroke-width="11" opacity="0.8"/>
<g fill="#1a1208"><circle cx="250" cy="318" r="126"/><path d="M62 720c0-152 84-244 188-244s188 92 188 244z"/></g>
<rect x="440" y="136" width="740" height="436" rx="22" fill="#fff6de" opacity="0.62"/>
<text x="478" y="212" font-family="${UI}" font-weight="800" font-size="34" letter-spacing="5" fill="#9a3d05">FOR 30 DAYS</text>
<rect x="478" y="234" width="132" height="10" fill="#c2410c"/>
<g font-family="${HEAVY}" font-weight="900" fill="#141008" letter-spacing="-3">
<text x="472" y="392" font-size="156">I QUIT</text>
<text x="472" y="548" font-size="156">COFFEE</text>
</g>
</svg>`;

export const SAMPLES: readonly Sample[] = [
  {
    id: 'wall-of-text',
    title: 'Wall of text',
    teaches:
      'A two-line headline, a five-item list and a full subtitle sentence — even the largest line is about 6px tall by the time a phone draws it.',
    expect: 'fail',
    svg: WALL_OF_TEXT,
  },
  {
    id: 'low-contrast',
    title: 'Low contrast',
    teaches:
      'Pale grey type sitting on a mid-grey landscape reads about 1.7:1, far under the 4.5:1 a body needs to separate it from the background.',
    expect: 'fail',
    svg: LOW_CONTRAST,
  },
  {
    id: 'badge-collision',
    title: 'Badge collision',
    teaches:
      'The payoff word and the face are parked in the bottom-right corner, exactly where YouTube stamps the duration pill over the artwork.',
    expect: 'fail',
    svg: BADGE_COLLISION,
  },
  {
    id: 'detail-collapse',
    title: 'Detail collapse',
    teaches:
      'Hairline grids, dashed plot lines and sixteen tiny data tiles turn into grey mush the moment the image is downscaled to feed size.',
    expect: 'fail',
    svg: DETAIL_COLLAPSE,
  },
  {
    id: 'edge-bleed',
    title: 'Edge bleed',
    teaches:
      'The face, the corner flag and both headline lines run into the frame edges, so rounded corners and tighter surface crops shave them off.',
    expect: 'warn',
    svg: EDGE_BLEED,
  },
  {
    id: 'clean',
    title: 'Clean',
    teaches:
      'Clean: three heavy words at 180px in near-black on a bright field, subject on the left third, and the bottom-right corner left empty for the badge.',
    expect: 'pass',
    svg: CLEAN,
  },
];

/* ------------------------------------------------------------------ *
 * Back catalogue — five thumbnails from one channel, deliberately
 * interchangeable. Same face, same palette, same layout, one word apart.
 * Line them up in a sidebar and nothing claims the click.
 * ------------------------------------------------------------------ */

function catalogueSvg(word: string, episode: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs>
<linearGradient id="cgb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c2334"/><stop offset="1" stop-color="#11566a"/></linearGradient>
</defs>
<rect width="1280" height="720" fill="url(#cgb)"/>
<path d="M0 0h520L360 720H0z" fill="#0a1c2a" opacity="0.6"/>
<circle cx="980" cy="330" r="300" fill="#1c7f92" opacity="0.35"/>
<rect x="60" y="128" width="26" height="392" fill="#ffd23d"/>
<g>
<circle cx="972" cy="336" r="176" fill="#f0c9a0" stroke="#07161f" stroke-width="9"/>
<path d="M796 306c8-108 84-172 176-172s168 64 176 172c-48-54-110-70-176-70s-128 16-176 70z" fill="#2e1e14"/>
<ellipse cx="914" cy="318" rx="17" ry="23" fill="#221610"/>
<ellipse cx="1030" cy="318" rx="17" ry="23" fill="#221610"/>
<ellipse cx="972" cy="440" rx="50" ry="60" fill="#6f1c1c"/>
<ellipse cx="972" cy="462" rx="34" ry="32" fill="#d9706c"/>
<path d="M776 720c0-124 88-198 196-198s196 74 196 198z" fill="#12405a"/>
</g>
<text x="124" y="270" font-family="${DISPLAY}" font-weight="700" font-size="132" fill="#ffffff" stroke="#04121a" stroke-width="10" paint-order="stroke">${word}</text>
<text x="124" y="374" font-family="${DISPLAY}" font-weight="700" font-size="132" fill="#ffd23d" stroke="#04121a" stroke-width="10" paint-order="stroke">SECRETS</text>
<text x="126" y="446" font-family="${UI}" font-weight="700" font-size="38" fill="#bfe6f0">nobody explains this properly</text>
<rect x="124" y="486" width="252" height="62" rx="8" fill="#ffd23d"/>
<text x="250" y="530" text-anchor="middle" font-family="${UI}" font-weight="900" font-size="32" fill="#0c2334">${episode}</text>
</svg>`;
}

export const BACK_CATALOGUE: readonly Sample[] = [
  {
    id: 'catalogue-1',
    title: 'Money secrets',
    teaches: 'Back-catalogue entry: same face, same teal-and-yellow layout, only the first word changes.',
    expect: 'warn',
    svg: catalogueSvg('MONEY', 'EPISODE 11'),
  },
  {
    id: 'catalogue-2',
    title: 'Budget secrets',
    teaches: 'Back-catalogue entry: same face, same teal-and-yellow layout, only the first word changes.',
    expect: 'warn',
    svg: catalogueSvg('BUDGET', 'EPISODE 12'),
  },
  {
    id: 'catalogue-3',
    title: 'Savings secrets',
    teaches: 'Back-catalogue entry: same face, same teal-and-yellow layout, only the first word changes.',
    expect: 'warn',
    svg: catalogueSvg('SAVINGS', 'EPISODE 13'),
  },
  {
    id: 'catalogue-4',
    title: 'Pension secrets',
    teaches: 'Back-catalogue entry: same face, same teal-and-yellow layout, only the first word changes.',
    expect: 'warn',
    svg: catalogueSvg('PENSION', 'EPISODE 14'),
  },
  {
    id: 'catalogue-5',
    title: 'Retire secrets',
    teaches: 'Back-catalogue entry: same face, same teal-and-yellow layout, only the first word changes.',
    expect: 'warn',
    svg: catalogueSvg('RETIRE', 'EPISODE 15'),
  },
];

/**
 * Wrap a sample's SVG source as a `data:` URL suitable for `img.src`.
 * Uses percent-encoding rather than base64 so the payload stays readable in
 * devtools and avoids a btoa round-trip on non-ASCII.
 */
export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
