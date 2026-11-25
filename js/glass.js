/**
 * "Glacier": the liquid-glass material, kept readable.
 *
 * Glass is see-through, so whatever sits behind it decides whether the text
 * on it can be read. This module washes the scene's colour grade into the
 * page backdrop only as far as muted text still meets WCAG AA, and picks a
 * light or smoked tint for glass over the hero scene to match its ink.
 * Every time of day and smog level is checked in the tests, and the tests
 * also check that styles.css uses these same numbers.
 *
 * Pure functions only; app.js writes the results into CSS custom properties.
 */
import { mix, contrastRatio, MIN_CONTRAST, INK_DARK } from './grade.js';

export const PAPER = '#f3f1ec';

/** Text colours used on glass (mirrors :root in styles.css). */
export const TEXT = Object.freeze({
  ink: '#111111',
  ink2: '#3a362f',
  ink3: '#5a554c',
  danger: '#b42318',
  ok: '#1d6b3e',
  caution: '#8a5100',
  move: '#1d4ed8',
});

/** The palest a glass surface's white tint gets, as a fraction (mirrors styles.css). */
export const GLASS = Object.freeze({
  panel: 0.44, // section sheets over the page backdrop
  tabbar: 0.68, // floating tab bar, over anything that scrolls under it
});

/** The floating tab bar: its tint and label colour (mirrors .tabbar and .tab in styles.css). */
export const TABBAR = Object.freeze({ tint: '#faf9f6', alpha: GLASS.tabbar, label: '#2b2822' });

/** The most of the sky colour the bare page backdrop may take (header, footer). */
export const ATMOSPHERE_MAX = 0.55;
/** Behind the glass sheets only, the colour may run deeper. */
export const GLOW_MAX = 0.9;

/** Lays `top` at opacity `alpha` over `bottom` (sRGB, like the browser). */
export const composite = (top, alpha, bottom) => mix(bottom, top, alpha);

/** The palest a sheet of glass gets over a backdrop colour. */
export const panelSurface = (backdrop) => composite('#ffffff', GLASS.panel, backdrop);

/** Lowest contrast any of `colours` makes on `surface`. */
export const worstText = (surface, colours) => Math.min(...colours.map((c) => contrastRatio(c, surface)));

/** Text that sits straight on the page backdrop, and text that sits on glass. */
export const BARE_TEXT = Object.freeze([TEXT.ink, TEXT.ink2, TEXT.ink3]);
export const GLASS_TEXT = Object.freeze(Object.values(TEXT));

/**
 * A sky colour washed into the paper: as much as possible while the text
 * over it still reads at AA. Bare backdrop (header, footer) is checked
 * directly; `underGlass` backdrop is checked through a sheet of glass.
 */
export function atmosphereTint(colour, { underGlass = false } = {}) {
  const top = Math.round((underGlass ? GLOW_MAX : ATMOSPHERE_MAX) * 20);
  const readable = (tint) => (underGlass
    ? worstText(panelSurface(tint), GLASS_TEXT)
    : worstText(tint, BARE_TEXT)) >= MIN_CONTRAST + 0.1;
  // Try the strongest wash first, then back off in 5 % steps.
  const tints = Array.from({ length: top }, (_, i) => mix(PAPER, colour, (top - i) / 20));
  return tints.find(readable) ?? PAPER;
}

/**
 * The page backdrop for a grade from gradeFor(): the upper sky behind the
 * header, the light of the hour (blue at midday, the low sun otherwise)
 * glowing behind the glass sheets, and the mid sky behind the footer.
 */
export function atmosphereFor(grade) {
  const v = grade.vars;
  const glow = grade.phase === 'afternoon' ? v['--sky-1'] : v['--sky-3'];
  return {
    '--atmo-1': atmosphereTint(v['--sky-1']),
    '--atmo-2': atmosphereTint(glow, { underGlass: true }),
    '--atmo-3': atmosphereTint(v['--sky-2']),
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
