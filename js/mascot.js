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

/** Motion-design easing: fast start, long soft landing (easeOutExpo-like). */
export const GLIDE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const GLIDE_MS = 700;

/**
 * Reads the pose each figure is in right now (mid-bounce, fallen over...).
 * Returns [] when the environment cannot animate (tests, old browsers).
 */
function capturePoses(stage) {
  if (typeof getComputedStyle !== 'function') return [];
  return Array.from(stage.querySelectorAll('.m-figure, .m-ride'))
    .filter((node) => typeof node.animate === 'function')
    .map((node) => ({ node, transform: getComputedStyle(node).transform }))
    .filter((pose) => pose.transform && pose.transform !== 'none');
}

/**
 * Glides each figure from its old pose back to rest. The new mood's loop
 * starts after GLIDE_MS (see the CSS animation-delay), from rest, so the
 * hand-over between two moods has no jump.
 */
function glideFromPoses(poses) {
  for (const { node, transform } of poses) {
    node.animate([{ transform }, { transform: 'none' }], { duration: GLIDE_MS, easing: GLIDE_EASING });
  }
}

/**
 * Shows the chosen buddy in the given mood.
 * @param {HTMLElement} stage
 * @param {{character:string, mood:string, quip:string, label:string}} view
 * @param {{smooth?:boolean}} options  smooth=false skips the glide (paused or reduced motion)
 */
export function renderMascot(stage, { character, mood, quip, label }, { smooth = true } = {}) {
  const buddy = resolveCharacter(character);
  const moodChanged = stage.dataset.mood !== mood;
  const changed = moodChanged || stage.dataset.character !== buddy;
  const poses = smooth && moodChanged ? capturePoses(stage) : [];
  stage.dataset.mood = mood;
  stage.dataset.character = buddy;
  stage.querySelectorAll('[data-buddy]').forEach((node) => { node.hidden = node.dataset.buddy !== buddy; });
  stage.querySelectorAll('[data-role="mascot-title"]').forEach((node) => { node.textContent = label; });
  glideFromPoses(poses);
  const bubble = stage.querySelector('[data-role="bubble"]');
  if (bubble && bubble.textContent !== quip) {
    bubble.textContent = quip;
    if (changed) {
      stage.classList.remove('is-changing');
      // Force a reflow so the caption's fade-in restarts.
      void stage.offsetWidth;
      stage.classList.add('is-changing');
    }
  }
}
