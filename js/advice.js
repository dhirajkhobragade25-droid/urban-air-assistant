/**
 * Rule-based recommendation engine.
 *
 * Each rule looks at the context (AQI, personal risk, household profile and
 * forecast window) and either returns a recommendation or `null`.
 * Recommendations carry an i18n id plus numeric params; wording lives in
 * i18n.js so the same logic serves every language.
 */
import { assessRisk, normalizeProfile, weeklyCo2SavedKg, formatRange } from './engine.js';

export const CATEGORIES = Object.freeze(['health', 'routine', 'indoor', 'alternative']);
export const MAX_PER_CATEGORY = 4;

/** Priority: 1 = do now, 2 = important, 3 = good habit. */
const item = (id, category, priority, params = {}, extra = {}) => ({ id, category, priority, params, ...extra });

const VEHICLE_MODES = ['car', 'two_wheeler'];

/** Ordered list of rules. Order breaks ties inside the same priority. */
export const RULES = Object.freeze([
  // ── Protect yourself ───────────────────────────────────────────────
  ({ aqi }) => (aqi > 300 ? item('emergency', 'health', 1) : null),

  ({ aqi, risk }) => (aqi > 150 || risk.level >= 3 ? item('mask', 'health', risk.level >= 4 ? 1 : 2) : null),

  ({ risk }) => (risk.sensitive && risk.level >= 2 ? item('sensitive', 'health', 1) : null),

  ({ aqi, profile }) => (profile.respiratory && aqi > 100 ? item('meds', 'health', 1) : null),

  ({ profile, risk }) => (profile.children && risk.level >= 2 ? item('children', 'health', 2) : null),

  // ── Low-emission routines ──────────────────────────────────────────
  ({ aqi, profile }) => {
    if (!profile.outdoorExercise || aqi <= 100) return null;
    return aqi > 150 ? item('exercise-indoor', 'routine', 1) : item('exercise-shift', 'routine', 2);
  },

  ({ aqi }) => (aqi <= 50 ? item('outdoor-go', 'routine', 3) : null),

  ({ aqi, window }) => {
    if (!window || aqi <= 50 || window.reductionPct < 10) return null;
    return item('best-window', 'routine', 2, {
      range: formatRange(window.start, window.hours),
      worstRange: formatRange(window.worstStart, window.hours),
      nextDay: window.nextDay,
      worstNextDay: window.worstNextDay,
      best: window.best,
      worst: window.worst,
      pct: window.reductionPct,
    });
  },

  ({ aqi, profile }) => {
    if (profile.commute !== 'car' || aqi <= 100) return null;
    const kg = weeklyCo2SavedKg({ km: profile.commuteKm, from: 'car', to: 'public', daysPerWeek: 1 });
    return item('commute-today', 'routine', aqi > 200 ? 1 : 2, { km: profile.commuteKm, kg });
  },

  ({ aqi, profile }) => (profile.commute === 'two_wheeler' && aqi > 150 ? item('rider', 'routine', 1) : null),

  ({ aqi, profile }) => (profile.commute === 'walk_cycle' && aqi > 150 ? item('walker', 'routine', 2) : null),

  ({ aqi, profile }) => {
    if (aqi <= 200 || profile.commute === 'wfh') return null;
    if (VEHICLE_MODES.includes(profile.commute)) {
      const kg = weeklyCo2SavedKg({ km: profile.commuteKm, from: profile.commute, to: 'wfh', daysPerWeek: 1 });
      return item('wfh', 'routine', 2, { kg }, { whyId: 'wfh-vehicle' });
    }
    return item('wfh', 'routine', 2);
  },

  ({ aqi }) => (aqi > 100 ? item('no-burning', 'routine', 2) : null),

  ({ profile }) => (VEHICLE_MODES.includes(profile.commute) ? item('idling', 'routine', 3) : null),

  // ── Indoor air hacks ───────────────────────────────────────────────
  ({ aqi }) => (aqi > 100 ? item('windows', 'indoor', aqi > 200 ? 1 : 2) : null),

  ({ aqi }) => (aqi <= 50 ? item('ventilate', 'indoor', 3) : null),

  ({ aqi, profile }) => (profile.purifier && aqi > 50 ? item('purifier', 'indoor', 2) : null),

  ({ aqi, profile }) => (!profile.purifier && aqi > 150 ? item('diy-purifier', 'indoor', 2) : null),

  ({ profile }) =>
    profile.cooking !== 'induction' ? item('cooking-vent', 'indoor', profile.cooking === 'biomass' ? 1 : 3) : null,

  ({ aqi }) => (aqi > 100 ? item('smoke-sources', 'indoor', 2) : null),

  ({ aqi }) => (aqi > 50 ? item('dust', 'indoor', 3) : null),

  // ── Sustainable switches ───────────────────────────────────────────
  ({ profile }) => (profile.cooking === 'biomass' ? item('clean-fuel', 'alternative', 1) : null),

  ({ profile }) => {
    if (!VEHICLE_MODES.includes(profile.commute)) return null;
    const kg = weeklyCo2SavedKg({ km: profile.commuteKm, from: profile.commute, to: 'public', daysPerWeek: 3 });
    return item('transit-default', 'alternative', 2, { km: profile.commuteKm, kg });
  },

  ({ aqi }) => (aqi > 100 ? item('warmth', 'alternative', 2) : null),

  ({ profile }) => (profile.cooking === 'lpg' ? item('induction', 'alternative', 3) : null),

  ({ aqi }) => (aqi > 150 ? item('community', 'alternative', 3) : null),
]);

/**
 * Builds the full context used by the rules.
 * @param {{aqi:number, profile?:object, window?:object|null}} input
 */
export function buildContext({ aqi, profile, window = null }) {
  const clean = normalizeProfile(profile);
  return { aqi, profile: clean, risk: assessRisk(aqi, clean), window };
}

/**
 * Runs every rule and groups the results by category, most urgent first,
 * capped at MAX_PER_CATEGORY per group.
 * @returns {Record<'health'|'routine'|'indoor'|'alternative', Array<object>>}
 */
export function buildPlan(context) {
  const plan = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  RULES.forEach((rule, order) => {
    const rec = rule(context);
    if (rec) plan[rec.category].push({ ...rec, order });
  });
  for (const category of CATEGORIES) {
    plan[category] = plan[category]
      .sort((a, b) => a.priority - b.priority || a.order - b.order)
      .slice(0, MAX_PER_CATEGORY);
  }
  return plan;
}

/** Flattens a plan into one list ordered by priority. */
export function flattenPlan(plan) {
  return CATEGORIES.flatMap((c) => plan[c] || []).sort((a, b) => a.priority - b.priority || a.order - b.order);
}

/** All advice ids that can be produced (used to check translations). */
export const ADVICE_IDS = Object.freeze([
  'emergency',
  'mask',
  'sensitive',
  'meds',
  'children',
  'exercise-indoor',
  'exercise-shift',
  'outdoor-go',
  'best-window',
  'commute-today',
  'rider',
  'walker',
  'wfh',
  'no-burning',
  'idling',
  'windows',
  'ventilate',
  'purifier',
  'diy-purifier',
  'cooking-vent',
  'smoke-sources',
  'dust',
  'clean-fuel',
  'transit-default',
  'warmth',
  'induction',
  'community',
]);

/* ── Quick do's and don'ts ──────────────────────────────────────────
 * Short one-liners for a glance. Each list is in priority order; the
 * first MAX_DD entries whose condition holds are shown.
 */
export const MAX_DD = 6;

const usesVehicle = (ctx) => VEHICLE_MODES.includes(ctx.profile.commute);
const hasGoodWindow = ({ aqi, window }) => Boolean(window) && aqi > 50 && window.reductionPct >= 10;

export const DO_RULES = Object.freeze([
  { id: 'stay-in', when: ({ aqi }) => aqi > 300 },
  { id: 'see-doctor', when: ({ risk }) => risk.level >= 4 },
  { id: 'n95', when: ({ aqi, risk }) => aqi > 150 || risk.level >= 3 },
  { id: 'meds', when: ({ aqi, profile }) => profile.respiratory && aqi > 100 },
  { id: 'clean-room', when: ({ aqi }) => aqi > 200 },
  { id: 'windows-shut', when: ({ aqi }) => aqi > 100 },
  {
    id: 'best-hours',
    when: hasGoodWindow,
    params: ({ window }) => ({ range: formatRange(window.start, window.hours), nextDay: window.nextDay }),
  },
  { id: 'wfh', when: ({ aqi, profile }) => aqi > 200 && profile.commute !== 'wfh' },
  { id: 'walk-cycle', when: ({ aqi }) => aqi <= 50 },
  { id: 'air-out', when: ({ aqi }) => aqi <= 50 },
  { id: 'play-out', when: ({ aqi }) => aqi <= 50 },
  { id: 'indoor-exercise', when: ({ aqi }) => aqi > 150 },
  { id: 'transit', when: (ctx) => ctx.aqi > 50 && usesVehicle(ctx) },
  { id: 'damp-mop', when: ({ aqi }) => aqi > 50 },
  { id: 'chimney', when: ({ profile }) => profile.cooking !== 'induction' },
  { id: 'check-aqi', when: ({ aqi }) => aqi <= 100 },
]);

export const DONT_RULES = Object.freeze([
  { id: 'miss-out', when: ({ aqi }) => aqi <= 50 },
  { id: 'travel', when: ({ aqi }) => aqi > 300 },
  { id: 'hard-exercise', when: ({ aqi }) => aqi > 150 },
  { id: 'kids-out', when: ({ aqi, profile }) => (profile.children && aqi > 100) || aqi > 200 },
  { id: 'cloth-mask', when: ({ aqi }) => aqi > 150 },
  { id: 'open-windows', when: ({ aqi }) => aqi > 100 },
  { id: 'busy-roads', when: ({ aqi }) => aqi > 100 },
  { id: 'angithi', when: ({ aqi }) => aqi > 50 },
  { id: 'incense', when: ({ aqi }) => aqi > 100 },
  { id: 'sweep', when: ({ aqi }) => aqi > 100 },
  { id: 'plants', when: ({ aqi }) => aqi > 150 },
  { id: 'burn', when: () => true },
  { id: 'smoke', when: () => true },
  { id: 'idle', when: usesVehicle },
]);

export const DO_IDS = Object.freeze(DO_RULES.map((r) => r.id));
export const DONT_IDS = Object.freeze(DONT_RULES.map((r) => r.id));

const pick = (rules, ctx) =>
  rules
    .filter((rule) => rule.when(ctx))
    .slice(0, MAX_DD)
    .map((rule) => ({ id: rule.id, params: rule.params ? rule.params(ctx) : {} }));

/** @returns {{dos: Array<{id:string, params:object}>, donts: Array<{id:string, params:object}>}} */
export function buildDosDonts(context) {
  return { dos: pick(DO_RULES, context), donts: pick(DONT_RULES, context) };
}
