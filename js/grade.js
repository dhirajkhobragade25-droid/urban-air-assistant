/**
 * Atmospheric colour grade for the hero scene.
 *
 * Two inputs decide the look: the time of day (morning, afternoon, evening,
 * night) sets the light, and the AQI band lays a smog film over it. The text
 * colour is then chosen, and the sky nudged if needed, so the copy always
 * meets WCAG AA (4.5 : 1) — every combination is checked in the tests.
 *
 * Pure functions only; app.js writes the result into CSS custom properties.
 */

export const PHASES = Object.freeze(['morning', 'afternoon', 'evening', 'night']);

/** Morning 05–10, afternoon 11–15, evening 16–19, night 20–04. */
export function phaseForHour(hour) {
  const h = ((Math.trunc(Number(hour)) % 24) + 24) % 24;
  if (!Number.isFinite(h)) return 'afternoon';
  if (h >= 5 && h <= 10) return 'morning';
  if (h >= 11 && h <= 15) return 'afternoon';
  if (h >= 16 && h <= 19) return 'evening';
  return 'night';
}

/** Clean-air light for each part of the day. */
const LIGHT = Object.freeze({
  morning: {
    sky1: '#a7c4d8',
    sky2: '#e6dfcf',
    sky3: '#f4d6ae',
    bloom: '#ffd9a8',
    bloomAlpha: 0.55,
    skyline: '#8e989d',
    far: '#bcc4c4',
    verge: '#6f8f4a',
    road: '#3f4144',
  },
  afternoon: {
    sky1: '#7fb2d8',
    sky2: '#cde1ea',
    sky3: '#ecefe6',
    bloom: '#fff6e0',
    bloomAlpha: 0.45,
    skyline: '#87929a',
    far: '#b4c0c7',
    verge: '#5f8a3f',
    road: '#3a3c3f',
  },
  evening: {
    sky1: '#2b3454',
    sky2: '#6a4c68',
    sky3: '#e0955a',
    bloom: '#ffad66',
    bloomAlpha: 0.55,
    skyline: '#241f29',
    far: '#4e3e4d',
    verge: '#3b4426',
    road: '#262629',
  },
  night: {
    sky1: '#05060a',
    sky2: '#0c0f17',
    sky3: '#1a2030',
    bloom: '#ffb46e',
    bloomAlpha: 0.1,
    skyline: '#000000',
    far: '#141720',
    verge: '#121710',
    road: '#17181b',
  },
});

/** How thick the smog film is per band, and its colour by day and by night. */
const SMOG = Object.freeze({
  'good': { amount: 0, day: '#c9a46c', night: '#3a2c18' },
  'moderate': { amount: 0.18, day: '#c9a46c', night: '#3a2c18' },
  'sensitive': { amount: 0.34, day: '#b38657', night: '#432a14' },
  'unhealthy': { amount: 0.52, day: '#8c7257', night: '#4a2a16' },
  'very-unhealthy': { amount: 0.68, day: '#4d3a30', night: '#4a1f12' },
  'hazardous': { amount: 0.82, day: '#26150f', night: '#521409' },
});

export const INK_DARK = '#111111';
export const INK_LIGHT = '#f3efe8';
export const MIN_CONTRAST = 4.5;

/* ---------- colour maths (sRGB) ---------- */
const toRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Mixes two hex colours: t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a, b, t) {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return toHex(ca.map((c, i) => c + (cb[i] - c) * t));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const rgba = (hex, alpha) => {
  const [r, g, b] = toRgb(hex);
  return `rgb(${r} ${g} ${b} / ${Math.round(Math.min(Math.max(alpha, 0), 1) * 100)}%)`;
};

/** The sky colours that text sits on: top, middle and just below the middle. */
const textBackdrops = (sky) => [sky.sky1, sky.sky2, mix(sky.sky2, sky.sky3, 0.3)];
const worstContrast = (ink, sky) => Math.min(...textBackdrops(sky).map((c) => contrastRatio(ink, c)));

/**
 * The full grade for a time of day and an AQI band.
 * @param {string} phase   one of PHASES
 * @param {string} bandKey an AQI band key ('good' … 'hazardous')
 * @returns {{phase:string, ink:string, contrast:number, vars:Record<string,string>}}
 */
/** Smog settles low: the horizon takes the most, the top of the sky the least. */
function smoggySky(light, tint, a, night) {
  if (night) return { sky1: light.sky1, sky2: mix(light.sky2, tint, a * 0.35), sky3: mix(light.sky3, tint, a) };
  return {
    sky1: mix(light.sky1, tint, a * 0.6),
    sky2: mix(light.sky2, tint, a * 0.85),
    sky3: mix(light.sky3, tint, a),
  };
}

/** Picks the ink that reads best, then deepens or lifts the sky (in place) until it passes AA. */
function inkFor(sky) {
  const ink = worstContrast(INK_DARK, sky) >= worstContrast(INK_LIGHT, sky) ? INK_DARK : INK_LIGHT;
  const towards = ink === INK_DARK ? '#ffffff' : '#000000';
  for (let step = 0; step < 12 && worstContrast(ink, sky) < MIN_CONTRAST + 0.1; step += 1) {
    sky.sky1 = mix(sky.sky1, towards, 0.1);
    sky.sky2 = mix(sky.sky2, towards, 0.1);
  }
  if (worstContrast(ink, sky) >= MIN_CONTRAST) return ink;
  return ink === INK_DARK ? INK_LIGHT : INK_DARK;
}

export function gradeFor(phase, bandKey) {
  const p = PHASES.includes(phase) ? phase : 'afternoon';
  const light = LIGHT[p];
  const smog = SMOG[bandKey] || SMOG.good;
  const night = p === 'night';
  const tint = night ? smog.night : smog.day;
  const a = smog.amount;
  const sky = smoggySky(light, tint, a, night);
  const ink = inkFor(sky);

  const bloomColour = night ? mix(light.bloom, '#ff5a2a', a) : mix(light.bloom, tint, a * 0.5);
  const bloomAlpha = night ? light.bloomAlpha + a * 0.25 : light.bloomAlpha * (1 - a * 0.55);
  return {
    phase: p,
    ink,
    contrast: Math.round(worstContrast(ink, sky) * 10) / 10,
    vars: {
      '--sky-1': sky.sky1,
      '--sky-2': sky.sky2,
      '--sky-3': sky.sky3,
      '--bloom': rgba(bloomColour, bloomAlpha),
      '--haze': rgba(tint, night ? a * 0.55 : a * 0.75),
      '--skyline': mix(light.skyline, night ? '#000000' : '#2a221c', a * 0.6),
      '--skyline-far': mix(light.far, tint, a * 0.5),
      '--verge': mix(light.verge, tint, a * 0.5),
      '--road': mix(light.road, '#111111', a * 0.4),
      '--hero-ink': ink,
    },
  };
}
