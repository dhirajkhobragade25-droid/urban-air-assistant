/**
 * Demo mode: the only place where the AQI and the time of day can be set by
 * hand. Outside it, the scene, the buddy and the plan follow the live
 * reading and the city's own clock.
 */
import { PHASES } from '../grade.js';
import { demoStartAqi } from '../flow.js';
import { els } from './elements.js';
import { state } from './state.js';
import { lenses } from './lenses.js';
import { render, renderHero, scheduleRender } from './render.js';

/** Turns demo mode on (starting from the live AQI, if any) or off. */
export function setDemo(on) {
  state.demo = Boolean(on);
  els.demoToggle.checked = state.demo;
  els.demoPanel.hidden = !state.demo;
  if (state.demo) {
    const start = demoStartAqi(state.live ? state.live.snapshot.aqi : null);
    els.simRange.value = String(start);
    els.simOutput.value = String(start);
    state.simulatedAqi = start;
  } else {
    state.simulatedAqi = null;
    state.phase = 'auto';
    els.phaseOptions.querySelectorAll('input[name="phase"]').forEach((input) => {
      input.checked = input.value === 'auto';
    });
  }
  render();
  lenses.phase.update(false);
}

/** The demo AQI slider. */
export function onSimulate() {
  if (!state.demo) return;
  const value = Number(els.simRange.value);
  els.simOutput.value = String(value);
  state.simulatedAqi = value;
  scheduleRender();
}

/** The demo time-of-day picker. */
export function onPhaseChange(event) {
  if (event.target.name !== 'phase') return;
  state.phase = PHASES.includes(event.target.value) ? event.target.value : 'auto';
  lenses.phase.update();
  renderHero(state.view);
}
