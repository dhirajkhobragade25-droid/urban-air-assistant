/**
 * "Glacier": deep, see-through glass over one sky colour.
 *
 * The whole page takes one colour family for the time of day (a dawn rose,
 * a midday teal-blue, a dusk violet, a night navy), deepening from top to
 * bottom. The hero scene fades into it. Cards are a deeper tint of the same
 * colour with a light frost, and text on them is white.
 *
 * Only the scene at the top reacts to the AQI. The page, the cards and the
 * frost depend on the time of day alone, so the reading never shifts them.
 *
 * Glass is see-through, so what is behind it decides whether its text can be
 * read. skyFor() picks the lightest card tint at which every text colour stays
 * at WCAG AA over every part of the page, with frost and buttons on top. The
 * tests check every time of day, and that styles.css matches.
 *
 * Pure functions only; app.js writes the results into CSS custom properties.
 */
import { mix, contrastRatio, MIN_CONTRAST, INK_DARK } from './grade.js';

const rgbOf = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const cssRgb = (hex, alpha) => {
  const [r, g, b] = rgbOf(hex);
  return alpha === undefined ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)`;
};

/** Text colours on the glass (mirrors :root in styles.css): light inks on deep colour. */
export const TEXT = Object.freeze({
  ink: '#ffffff',
  ink2: '#e8eef6',
  ink3: '#cbd6e3',
  danger: '#ffb4a6',
  ok: '#9ff0c0',
  caution: '#ffd47e',
  move: '#c0cdff',
  glacier: '#93e6f4',
});
export const GLASS_TEXT = Object.freeze(Object.values(TEXT));
/** The footer sits straight on the page, in the neutral inks only. */
export const BARE_TEXT = Object.freeze([TEXT.ink, TEXT.ink2, TEXT.ink3]);
/** Tab labels: the active one in ink, the rest in ink-2. */
export const TAB_TEXT = Object.freeze([TEXT.ink, TEXT.ink2]);

/** White film on buttons, chips and fields over a card (mirrors --glass-fill in styles.css). */
export const CONTROL_FILL = 0.14;

/** Lays `top` at opacity `alpha` over `bottom` (sRGB, like the browser). */
export const composite = (top, alpha, bottom) => mix(bottom, top, alpha);

/** Lowest contrast any of `colours` makes on `surface`. */
export const worstText = (surface, colours) => Math.min(...colours.map((c) => contrastRatio(c, surface)));

/** One colour family per time of day: the page's top, middle and bottom. */
export const SKY = Object.freeze({
  morning: Object.freeze(['#d27778', '#a95c7f', '#5f3a6b']), // dawn coral, rose, plum
  afternoon: Object.freeze(['#3a8fb3', '#2c73a0', '#1b4a78']), // teal sky, blue, deep blue
  evening: Object.freeze(['#86599d', '#574184', '#29285b']), // dusk violet, indigo, deep indigo
  night: Object.freeze(['#25386f', '#172653', '#0a1331']), // navy, midnight, ink blue
});
/** Cards are the page's deepest colour, this much darker again. */
export const DEEPEN = 0.6;

/* ---------- Frost ---------- */

/**
 * The same light frost on every card at any AQI (mirrors --frost and
 * --frost-tint in styles.css): thicker at the edges, clear in the middle.
 */
export const GLASS_FROST = Object.freeze({ amount: 0.3, colour: '#ffffff', alpha: 0.08 });

/* ---------- The sky ---------- */

/** Lightest alpha (in 5 % steps from 30 %) that passes `ok`; fully opaque if none does. */
export function pickAlpha(ok) {
  for (let step = 6; step <= 19; step += 1) if (ok(step / 20)) return step / 20;
  return 1;
}

/**
 * The page and its glass for a time of day: three page colours, the card
 * tint, the tab bar tint and the solid sheet colour, as CSS custom
 * properties. The AQI is deliberately not an input.
 */
export function skyFor(phase) {
  const stops = [...(SKY[phase] || SKY.afternoon)];
  const deep = mix(stops[2], '#000000', DEEPEN);
  // Worst case for white text: the frost film in pure white.
  const film = GLASS_FROST.alpha;
  const readsOn = (surface) =>
    worstText(surface, GLASS_TEXT) >= MIN_CONTRAST + 0.1 &&
    contrastRatio(TEXT.ink, composite('#ffffff', CONTROL_FILL, surface)) >= MIN_CONTRAST + 0.1;
  const card = pickAlpha((alpha) =>
    stops.every((stop) => {
      const glass = composite(deep, alpha, stop);
      return readsOn(glass) && readsOn(composite('#ffffff', film, glass));
    }),
  );
  // The tab bar floats over anything, even the brightest sky in the scene.
  const tab = pickAlpha((alpha) =>
    ['#ffffff', '#000000', ...stops].every(
      (under) => worstText(composite(deep, alpha, under), TAB_TEXT) >= MIN_CONTRAST + 0.1,
    ),
  );
  return {
    stops,
    deep,
    card,
    tab,
    vars: {
      '--page-1': stops[0],
      '--page-2': stops[1],
      '--page-3': stops[2],
      '--card': cssRgb(deep, card),
      '--tab': cssRgb(deep, tab),
      '--card-deep': cssRgb(deep),
    },
  };
}

/** Glass over the hero scene: frosted white under dark ink, smoked under light ink. */
export const HERO_GLASS = Object.freeze({
  light: Object.freeze({ colour: '#ffffff', alpha: 0.42 }),
  smoked: Object.freeze({ colour: '#0c0e14', alpha: 0.4 }),
});

export function heroGlassFor(ink) {
  const tone = ink === INK_DARK ? 'light' : 'smoked';
  const glass = HERO_GLASS[tone];
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(glass.colour.slice(i, i + 2), 16));
  return { tone, ...glass, css: `rgb(${r} ${g} ${b} / ${Math.round(glass.alpha * 100)}%)` };
}
