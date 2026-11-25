/**
 * Touch feel. Every control sinks under the finger and springs back with a
 * small jelly wobble; selection lenses glide between options like a drop of
 * glass; a soft light follows the finger; phones that support it give a
 * short haptic tick on release.
 *
 * One set of delegated listeners on the document, so controls added later
 * (plan, chat, place results) get the same feel without extra wiring.
 * Reduced motion keeps the light and drops the movement.
 * The spring maths lives in spring.js and is unit-tested.
 */
import { pressDepth, pressKeyframes, releaseKeyframes, glideKeyframes } from './spring.js';

export const PRESSABLE = [
  '.btn', '.chip', '.lang-btn', '.tab', '.phase-option', '.buddy-option',
  '.plan-group > summary', '.ai-settings > summary', '.check',
].join(', ');

const HAPTIC_MS = 8;

const isDisabled = (node) => node.matches(':disabled, [aria-disabled="true"]');
const pressableFrom = (target) => (target instanceof Element ? target.closest(PRESSABLE) : null);

/** Current horizontal scale of a node, including a running animation. */
function currentScale(node) {
  const transform = getComputedStyle(node).transform;
  if (!transform || transform === 'none') return 1;
  try {
    return new DOMMatrixReadOnly(transform).a;
  } catch {
    return 1;
  }
}

/**
 * Turns on press feedback for every pressable control under `root`.
 * @param {Document|Element} root
 * @param {{reducedMotion?:() => boolean, vibrate?:(ms:number) => void}} options
 */
export function enablePress(root, {
  reducedMotion = () => false,
  vibrate = (ms) => navigator.vibrate?.(ms),
} = {}) {
  const running = new WeakMap();
  const depths = new WeakMap();
  const pointers = new Map();
  const keyed = new Set();

  const play = (node, { keyframes, duration }, fill) => {
    running.get(node)?.cancel();
    running.set(node, node.animate(keyframes, { duration, easing: 'linear', fill }));
  };

  function press(node, event) {
    const box = node.getBoundingClientRect();
    if (event && Number.isFinite(event.clientX) && box.width && box.height) {
      node.style.setProperty('--px', `${Math.round(((event.clientX - box.left) / box.width) * 100)}%`);
      node.style.setProperty('--py', `${Math.round(((event.clientY - box.top) / box.height) * 100)}%`);
    }
    node.classList.add('is-pressed');
    if (reducedMotion()) return;
    const depth = pressDepth(box.width, box.height);
    depths.set(node, depth);
    play(node, pressKeyframes(depth, currentScale(node)), 'forwards');
  }

  function release(node, { cancelled = false, haptic = false } = {}) {
    node.classList.remove('is-pressed');
    if (reducedMotion()) return;
    if (cancelled) {
      // A scroll took the finger away: settle back quietly, no wobble.
      play(node, pressKeyframes(1, currentScale(node)), 'none');
      return;
    }
    const depth = depths.get(node) ?? 0.95;
    // Even a very quick tap gets most of the squish, so it always bounces.
    const from = Math.min(currentScale(node), 1 - (1 - depth) * 0.7);
    play(node, releaseKeyframes(from), 'none');
    if (haptic) vibrate(HAPTIC_MS);
  }

  root.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    const node = pressableFrom(event.target);
    if (!node || isDisabled(node)) return;
    pointers.set(event.pointerId, node);
    press(node, event);
  }, { passive: true });

  const end = (event) => {
    const node = pointers.get(event.pointerId);
    if (!node) return;
    pointers.delete(event.pointerId);
    release(node, {
      cancelled: event.type === 'pointercancel',
      haptic: event.type === 'pointerup' && event.pointerType === 'touch',
    });
  };
  root.addEventListener('pointerup', end, { passive: true });
  root.addEventListener('pointercancel', end, { passive: true });

  // Keyboard presses get the same feel (Space and Enter activate controls).
  root.addEventListener('keydown', (event) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return;
    const node = pressableFrom(event.target);
    if (!node || isDisabled(node) || keyed.has(node)) return;
    keyed.add(node);
    press(node);
  });
  const releaseKeys = () => {
    keyed.forEach((node) => release(node));
    keyed.clear();
  };
  root.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') releaseKeys();
  });
  root.addEventListener('focusout', releaseKeys);
}

/**
 * A glass lens that glides to whichever option is active inside `track`.
 * The lens is the track's `.lens` child; `findActive` returns the option.
 * @returns {{update:(animate?:boolean) => void}}
 */
export function createLens(track, findActive, { reducedMotion = () => false } = {}) {
  const lens = track.querySelector(':scope > .lens');
  let glide = null;

  function update(animate = true) {
    if (!lens) return;
    const active = findActive();
    if (!active) {
      lens.hidden = true;
      return;
    }
    // Start from where the lens is drawn now, even mid-glide.
    let from = null;
    if (!lens.hidden && animate && !reducedMotion()) {
      const t = track.getBoundingClientRect();
      const l = lens.getBoundingClientRect();
      from = { left: l.left - t.left - track.clientLeft, width: l.width };
    }
    const to = { left: active.offsetLeft, width: active.offsetWidth };
    glide?.cancel();
    glide = null;
    lens.hidden = false;
    lens.style.setProperty('--lens-x', `${to.left}px`);
    lens.style.setProperty('--lens-w', `${to.width}px`);
    track.classList.add('has-lens');
    if (from && (Math.abs(from.left - to.left) > 0.5 || Math.abs(from.width - to.width) > 0.5)) {
      const { keyframes, duration } = glideKeyframes(from, to);
      glide = lens.animate(keyframes, { duration, easing: 'linear' });
    }
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(() => update(false)).observe(track);
  return { update };
}
