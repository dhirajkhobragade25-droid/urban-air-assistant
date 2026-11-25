/**
 * Spring physics for the "Glacier" touch feel.
 *
 * Every press squishes the control and every release springs it back with a
 * small jelly wobble, the way a real soft object would. The motion comes from
 * a damped harmonic oscillator (no library), sampled into Web Animations
 * keyframes so it runs on the compositor in every modern browser.
 *
 * Pure functions only; press.js puts the keyframes on the page.
 */

/** Tuned by feel: press is firm, release is bouncy, glide is a soft lens. */
export const SPRINGS = Object.freeze({
  press: Object.freeze({ stiffness: 900, damping: 52, mass: 1 }),
  release: Object.freeze({ stiffness: 340, damping: 12, mass: 1 }),
  glide: Object.freeze({ stiffness: 260, damping: 21, mass: 1 }),
});

/** One frame at 60 fps, in seconds. */
export const FRAME = 1 / 60;
/** How far a control sinks under the finger, in CSS pixels on its long side. */
export const PRESS_PX = 7;
/** The y axis follows the x axis this much later (seconds): that lag is the jelly. */
export const JELLY_LAG = 0.045;

/** Damping ratio ζ: below 1 the spring overshoots, at 1 it just settles. */
export function dampingRatio({ stiffness, damping, mass = 1 }) {
  return damping / (2 * Math.sqrt(stiffness * mass));
}

/**
 * Displacement from rest at time t (seconds), starting at `x0` with
 * velocity `v0`. Closed-form for under-, critically and over-damped springs.
 */
export function springAt(t, spring, x0 = 1, v0 = 0) {
  const { stiffness, mass = 1 } = spring;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = dampingRatio(spring);
  if (t <= 0) return x0;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
  const root = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - root);
  const r2 = -w0 * (zeta + root);
  const c2 = (v0 - r1 * x0) / (r2 - r1);
  return (x0 - c2) * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
}

/**
 * Samples a spring moving `from` → `to` once per frame until it is at rest.
 * @returns {{values:number[], duration:number}} duration in seconds
 */
export function sampleSpring(spring, { from = 0, to = 1, velocity = 0, rest = 0.002, maxDuration = 2 } = {}) {
  const span = Math.abs(to - from) || 1;
  const x0 = from - to;
  const values = [];
  let lastMoving = 0;
  const steps = Math.ceil(maxDuration / FRAME);
  for (let i = 0; i <= steps; i += 1) {
    const x = springAt(i * FRAME, spring, x0, velocity);
    values.push(to + x);
    if (Math.abs(x) / span > rest) lastMoving = i;
  }
  const end = Math.min(lastMoving + 1, steps);
  const out = values.slice(0, end + 1);
  out[out.length - 1] = to; // land exactly on the target
  return { values: out, duration: end * FRAME };
}

const round = (n) => Math.round(n * 10000) / 10000;
const scale = (sx, sy) => `scale(${round(sx)}, ${round(sy)})`;

/**
 * Scale a control sinks to when pressed: about PRESS_PX on its long side,
 * so a small chip and a full-width button feel equally deep.
 */
export function pressDepth(width, height) {
  const long = Math.max(Number(width) || 0, Number(height) || 0, 1);
  const sink = Math.min(Math.max(PRESS_PX / long, 0.02), 0.08);
  return round(1 - sink);
}

const offsets = (count) => (i) => (count <= 1 ? 1 : round(i / (count - 1)));

/** Keyframes for the press: from the current scale down to `depth`, firm, no wobble. */
export function pressKeyframes(depth, from = 1) {
  const { values, duration } = sampleSpring(SPRINGS.press, { from, to: depth });
  const at = offsets(values.length);
  return {
    keyframes: values.map((s, i) => ({ offset: at(i), transform: scale(s, s) })),
    duration: Math.max(duration, FRAME) * 1000,
  };
}

/**
 * Keyframes for the release: back to full size with an overshoot, the y axis
 * trailing the x axis by JELLY_LAG so the control wobbles like jelly.
 */
export function releaseKeyframes(from) {
  const start = Math.min(Math.max(Number(from) || 1, 0.5), 1);
  const lagFrames = Math.round(JELLY_LAG / FRAME);
  const { values } = sampleSpring(SPRINGS.release, { from: start, to: 1, rest: 0.01 });
  const ys = [...Array(lagFrames).fill(start), ...values];
  const xs = [...values, ...Array(lagFrames).fill(1)];
  const at = offsets(xs.length);
  return {
    keyframes: xs.map((sx, i) => ({ offset: at(i), transform: scale(sx, ys[i]) })),
    duration: (xs.length - 1) * FRAME * 1000,
  };
}

/** The most a moving lens may stretch along its path (and thin across it). */
export const MAX_STRETCH = 0.22;

/**
 * Keyframes for a selection lens (segmented control, tab bar) gliding from
 * one box to another. The element already sits at `to`; the animation starts
 * it at `from` and springs it home, stretching with speed like a droplet.
 * Boxes are {left, width} in the same coordinate space.
 */
export function glideKeyframes(fromBox, toBox) {
  const dx = (fromBox.left + fromBox.width / 2) - (toBox.left + toBox.width / 2);
  const s0 = toBox.width > 0 ? fromBox.width / toBox.width : 1;
  const { values, duration } = sampleSpring(SPRINGS.glide, { from: 0, to: 1 });
  const travel = Math.abs(dx) || 1;
  const at = offsets(values.length);
  const keyframes = values.map((p, i) => {
    const prev = values[Math.max(i - 1, 0)];
    const next = values[Math.min(i + 1, values.length - 1)];
    // px per second; the spring starts from rest, so the first frame is unstretched.
    const speed = i === 0 ? 0 : (Math.abs(next - prev) * travel) / (2 * FRAME);
    const stretch = Math.min(speed / 3000, MAX_STRETCH);
    const sx = (s0 + (1 - s0) * p) * (1 + stretch);
    const sy = 1 - stretch / 2;
    return { offset: at(i), transform: `translateX(${round(dx * (1 - p))}px) ${scale(sx, sy)}` };
  });
  keyframes[keyframes.length - 1].transform = 'translateX(0px) scale(1, 1)';
  return { keyframes, duration: Math.max(duration, FRAME) * 1000 };
}
