/**
 * "Lungs buddy" mascot: maps personal risk to a mood and a funny line.
 * The animation itself is pure CSS (see css/styles.css), driven by the
 * `data-mood` attribute, so it costs almost no JavaScript.
 */
import { MAX_LEVEL } from './engine.js';

export const MOODS = Object.freeze(['happy', 'meh', 'cough', 'mask', 'gasmask', 'faint']);
export const QUIPS_PER_MOOD = 2;

/** Mood for a personal risk level (0–5); out-of-range values are clamped. */
export function moodForLevel(level) {
  const n = Number.isFinite(level) ? Math.round(level) : 0;
  return MOODS[Math.min(Math.max(n, 0), MAX_LEVEL)];
}

/** i18n key of the quip to show; `seed` rotates through the lines. */
export function quipKey(mood, seed = 0) {
  const index = Math.abs(Math.trunc(seed)) % QUIPS_PER_MOOD;
  return `quip.${MOODS.includes(mood) ? mood : 'happy'}.${index}`;
}

/**
 * Applies a mood to the stage. Re-triggers the "gasp" pop only when the
 * mood actually changes.
 * @param {HTMLElement} stage
 * @param {{mood:string, quip:string, label:string}} view
 */
export function renderMascot(stage, { mood, quip, label }) {
  const changed = stage.dataset.mood !== mood;
  stage.dataset.mood = mood;
  const bubble = stage.querySelector('[data-role="bubble"]');
  const title = stage.querySelector('[data-role="mascot-title"]');
  if (bubble) bubble.textContent = quip;
  if (title) title.textContent = label;
  if (changed) {
    stage.classList.remove('is-changing');
    // Force a reflow so the CSS animation restarts.
    void stage.offsetWidth;
    stage.classList.add('is-changing');
  }
}
