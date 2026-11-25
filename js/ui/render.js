/**
 * Turns the state into the page: the scene and its colour grade, the reading,
 * the buddy and today's plan. All the decisions come from the pure modules.
 */
import { findBestWindow, categorize } from '../engine.js';
import { CATEGORIES, buildContext, buildPlan, buildDosDonts } from '../advice.js';
import { planRoutine, summarizeImpact } from '../routine.js';
import { phaseForHour, gradeFor } from '../grade.js';
import { skyFor, heroGlassFor } from '../glass.js';
import { shortPlace } from '../flow.js';
import { moodForLevel, quipKey, renderMascot } from '../mascot.js';
import { el, prefersReducedMotion } from '../dom.js';
import {
  heroNodes,
  animateGauge,
  readoutNodes,
  planGroup,
  dosDontsSection,
  dayPlanSection,
  impactSection,
} from '../views.js';
import { els } from './elements.js';
import { state, T, placeName } from './state.js';

/** Everything the page shows, worked out from the live reading or the demo AQI. */
export function computeView() {
  const simulated = state.demo && state.simulatedAqi !== null;
  if (!simulated && !state.live) return null;
  const snapshot = simulated ? null : state.live.snapshot;
  const aqi = simulated ? state.simulatedAqi : snapshot.aqi;
  const window = snapshot ? findBestWindow(snapshot.hourly, snapshot.time) : null;
  const context = buildContext({ aqi, profile: state.profile, window });
  const routinePlan = planRoutine({
    routine: state.routine,
    aqi,
    hourly: snapshot ? snapshot.hourly : [],
    fromTime: snapshot ? snapshot.time : null,
    commute: state.profile.commute,
  });
  return {
    aqi,
    snapshot,
    window,
    risk: context.risk,
    plan: buildPlan(context),
    dosDonts: buildDosDonts(context),
    routinePlan,
    impact: summarizeImpact({ profile: state.profile, routinePlan }),
    place: simulated || !state.live ? null : placeName(state.live.place),
  };
}

/** Redraws the whole page from the state. */
export function render() {
  state.view = computeView();
  renderHero(state.view);
  els.readout.replaceChildren(...readoutNodes(state.view, T, state.lang));
  renderMascotView(state.view);
  renderPlan(state.view);
  renderSetupPreview();
  els.setCityValue.textContent = state.live ? shortPlace(placeName(state.live.place)) : T('settings.notSet');
}

/** Coalesces rapid slider and form input into one render per animation frame. */
export function scheduleRender() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    render();
  });
}

/** On the household step, a one-line reminder of the city's air ("Delhi · AQI 312 · Hazardous"). */
function renderSetupPreview() {
  const live = state.live;
  els.setupPreview.hidden = !live;
  if (!live) return;
  const band = categorize(live.snapshot.aqi).key;
  els.setupPreview.dataset.band = band;
  els.setupPreview.textContent = T('setup.preview', {
    place: shortPlace(placeName(live.place)),
    aqi: live.snapshot.aqi,
    band: T(`band.${band}`),
  });
}

/** Local hour of the reading (or of the device in demo mode). */
function localHour(view) {
  return view?.snapshot ? Number.parseInt(view.snapshot.time.slice(11, 13), 10) : new Date().getHours();
}

/** Writes CSS custom properties on an element. */
function setVars(node, vars) {
  for (const [name, value] of Object.entries(vars)) node.style.setProperty(name, value);
}

/**
 * The hero copy plus the scene's colour grade: the time of day sets the
 * light, the outdoor AQI band lays the smog over it (see grade.js).
 */
export function renderHero(view) {
  const phase = state.phase === 'auto' ? phaseForHour(localHour(view)) : state.phase;
  const band = view ? view.risk.band.key : 'good';
  const grade = gradeFor(phase, band);
  setVars(els.stage, grade.vars);
  const glass = heroGlassFor(grade.ink);
  els.stage.style.setProperty('--hero-glass', glass.css);
  els.stage.dataset.glass = glass.tone;
  // The whole page takes one sky colour for the time of day only: the AQI
  // changes the scene above, never the page or the cards below it.
  const sky = skyFor(grade.phase);
  setVars(document.documentElement, sky.vars);
  els.themeColour?.setAttribute('content', state.screen === 'main' ? grade.vars['--sky-1'] : sky.stops[0]);
  Object.assign(els.stage.dataset, {
    band,
    phase: grade.phase,
    night: String(grade.phase === 'night'),
    demo: String(state.demo),
  });
  els.heroCopy.replaceChildren(...heroNodes(view, T, state.lang, grade.phase, { demo: state.demo }));
  // The ring glides from the last reading to this one (and counts the number up).
  const gauge = els.heroCopy.querySelector('.gauge');
  state.lastGauge = gauge ? animateGauge(gauge, state.lastGauge, { reducedMotion: prefersReducedMotion() }) : null;
  if (!view) {
    els.heroCopy.append(
      el('button', {
        type: 'button',
        class: 'btn btn-primary hero-cta',
        dataset: { action: 'choose-city' },
        text: T('home.choose'),
      }),
    );
  }
}

/** The buddy's mood, speech and accessible label. */
export function renderMascotView(view) {
  const mood = moodForLevel(view ? view.risk.level : 0);
  if (mood !== state.mood) {
    state.mood = mood;
    state.quipSeed += 1;
  }
  renderMascot(
    els.stage,
    {
      character: state.character,
      mood,
      quip: T(view ? quipKey(mood, state.quipSeed) : 'quip.idle'),
      label: T('mascot.label', { name: T(`char.${state.character}`), mood: T(`mood.${mood}`) }),
    },
    { smooth: !state.paused && !prefersReducedMotion() },
  );
}

/** Today's plan: impact, the re-planned day, do's and don'ts, then the advice groups. */
function renderPlan(view) {
  if (!view) {
    els.plan.replaceChildren(el('p', { class: 'empty', text: T('plan.needData') }));
    return;
  }
  const total = CATEGORIES.reduce((sum, c) => sum + view.plan[c].length, 0);
  const groups = CATEGORIES.map((category) => {
    const items = view.plan[category];
    // Open groups that need action now (or all of them when the plan is
    // short), unless the user has opened or closed the group themselves.
    const fallback = items.some((rec) => rec.priority === 1) || total <= 6;
    const open = state.openGroups.has(category) ? state.openGroups.get(category) : fallback;
    return planGroup({ category, items, open }, T);
  });
  els.plan.replaceChildren(
    impactSection(view.impact, T, state.lang),
    dayPlanSection(view.routinePlan, Boolean(view.snapshot), T),
    dosDontsSection(view.dosDonts, T),
    ...groups,
  );
}

/**
 * Remembers groups the user opens or closes. Uses the summary click (fired for
 * mouse, touch and keyboard) because "toggle" also fires when code opens a group.
 */
export function onPlanSummaryClick(event) {
  const summary = event.target.closest('details.plan-group > summary');
  if (!summary) return;
  const group = summary.parentElement;
  state.openGroups.set(group.dataset.category, !group.open);
}
