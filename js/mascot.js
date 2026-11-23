/**
 * Animated buddies (Phephde Brothers, Badal, Tulsi): maps personal risk to
 * a mood and a funny line. The animation itself is pure CSS (see
 * css/styles.css), driven by the `data-mood` and `data-character`
 * attributes, so it costs almost no JavaScript.
 */
import { MAX_LEVEL } from './engine.js';

export const MOODS = Object.freeze(['happy', 'meh', 'cough', 'mask', 'gasmask', 'faint']);
export const CHARACTERS = Object.freeze(['twins', 'cloud', 'tulsi']);
export const DEFAULT_CHARACTER = 'twins';
export const QUIPS_PER_MOOD = 2;

/** Normalises any value to a supported character id. */
export function resolveCharacter(id) {
  return CHARACTERS.includes(id) ? id : DEFAULT_CHARACTER;
}

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
 * Shows the chosen buddy in the given mood. Re-triggers the "gasp" pop
 * only when the mood or the buddy actually changes.
 * @param {HTMLElement} stage
 * @param {{character:string, mood:string, quip:string, label:string}} view
 */
export function renderMascot(stage, { character, mood, quip, label }) {
  const buddy = resolveCharacter(character);
  const changed = stage.dataset.mood !== mood || stage.dataset.character !== buddy;
  stage.dataset.mood = mood;
  stage.dataset.character = buddy;
  stage.querySelectorAll('[data-buddy]').forEach((node) => { node.hidden = node.dataset.buddy !== buddy; });
  stage.querySelectorAll('[data-role="mascot-title"]').forEach((node) => { node.textContent = label; });
  const bubble = stage.querySelector('[data-role="bubble"]');
  if (bubble) bubble.textContent = quip;
  if (changed) {
    stage.classList.remove('is-changing');
    // Force a reflow so the CSS animation restarts.
    void stage.offsetWidth;
    stage.classList.add('is-changing');
  }
}
