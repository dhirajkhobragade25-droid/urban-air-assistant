/**
 * The buddy picker and the scene's pause button.
 */
import { resolveCharacter } from '../mascot.js';
import { KEYS, store } from '../storage.js';
import { els } from './elements.js';
import { state, local } from './state.js';
import { renderMascotView } from './render.js';

/** Loads the saved buddy and ticks it in the picker. */
export function restoreBuddy() {
  state.character = resolveCharacter(store.get(local, KEYS.buddy));
  els.buddyPicker.querySelectorAll('input[name="buddy"]').forEach((input) => {
    input.checked = input.value === state.character;
  });
}

/** A different buddy was picked. */
export function onBuddyChange(event) {
  if (event.target.name !== 'buddy') return;
  state.character = resolveCharacter(event.target.value);
  store.set(local, KEYS.buddy, state.character);
  renderMascotView(state.view);
}

/** Reflects the paused state on the scene and the button. */
export function updateMotionButton() {
  els.stage.classList.toggle('is-paused', state.paused);
  els.motionBtn.setAttribute('aria-pressed', String(state.paused));
}

/** The pause / play button on the scene. */
export function toggleMotion() {
  state.paused = !state.paused;
  updateMotionButton();
}
