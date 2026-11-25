import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPRINGS, FRAME, JELLY_LAG, MAX_STRETCH, dampingRatio, springAt, sampleSpring,
  pressDepth, pressKeyframes, releaseKeyframes, glideKeyframes,
} from '../js/spring.js';
import {
  PAPER, TEXT, GLASS, TABBAR, BARE_TEXT, GLASS_TEXT, composite, panelSurface, worstText,
  atmosphereTint, atmosphereFor, heroGlassFor,
} from '../js/glass.js';
import { PHASES, gradeFor, contrastRatio, MIN_CONTRAST } from '../js/grade.js';
import { AQI_BANDS } from '../js/engine.js';

const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scaleOf = (transform) => transform.match(/scale\(([\d.]+), ([\d.]+)\)/).slice(1).map(Number);
const BANDS = AQI_BANDS.map((b) => b.key);

/* ---------- Spring physics ---------- */

test('springs: release bounces, press and glide settle firmly', () => {
  assert.ok(dampingRatio(SPRINGS.release) < 0.5, 'release should be bouncy');
  assert.ok(dampingRatio(SPRINGS.press) > 0.8, 'press should barely overshoot');
  assert.ok(dampingRatio(SPRINGS.glide) > 0.5 && dampingRatio(SPRINGS.glide) < 1);
});

test('springAt starts at x0 and decays to rest in every damping regime', () => {
  for (const damping of [8, 2 * Math.sqrt(300), 60]) {
    const spring = { stiffness: 300, damping, mass: 1 };
    assert.equal(springAt(0, spring, 1, 0), 1);
    assert.ok(Math.abs(springAt(3, spring, 1, 0)) < 0.01, `damping ${damping} should come to rest`);
  }
  // Under-damped crosses zero; critically and over-damped never do.
  const crosses = (spring) => Array.from({ length: 120 }, (_, i) => springAt(i * FRAME, spring, 1, 0)).some((x) => x < -1e-6);
  assert.equal(crosses({ stiffness: 300, damping: 8 }), true);
  assert.equal(crosses({ stiffness: 300, damping: 2 * Math.sqrt(300) }), false);
  assert.equal(crosses({ stiffness: 300, damping: 60 }), false);
});

test('sampleSpring lands exactly on the target and stops once at rest', () => {
  const { values, duration } = sampleSpring(SPRINGS.glide, { from: 0, to: 1 });
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 1);
  assert.ok(duration > 0.2 && duration < 1.2, `duration ${duration}`);
  assert.ok(Math.max(...values) > 1, 'glide overshoots a little');
  assert.ok(Math.max(...values) < 1.12, 'but not by much');
});

test('pressDepth sinks every control by about the same few pixels', () => {
  assert.equal(pressDepth(60, 40), 0.92); // small chip: capped
  assert.equal(pressDepth(700, 46), 0.98); // full-width row: floor
  const mid = pressDepth(140, 46);
  assert.ok(mid > 0.94 && mid < 0.96, `mid ${mid}`);
  assert.equal(pressDepth(0, 0), 0.92);
});

test('press keyframes go down to the depth without bouncing below it', () => {
  const { keyframes, duration } = pressKeyframes(0.93);
  assert.deepEqual(scaleOf(keyframes[0].transform), [1, 1]);
  assert.deepEqual(scaleOf(keyframes.at(-1).transform), [0.93, 0.93]);
  assert.equal(keyframes[0].offset, 0);
  assert.equal(keyframes.at(-1).offset, 1);
  const lowest = Math.min(...keyframes.map((k) => scaleOf(k.transform)[0]));
  assert.ok(lowest > 0.93 - 0.003, `lowest ${lowest}`);
  assert.ok(duration < 400);
});

test('release keyframes spring back past full size with a jelly lag', () => {
  const { keyframes, duration } = releaseKeyframes(0.92);
  const xs = keyframes.map((k) => scaleOf(k.transform)[0]);
  const ys = keyframes.map((k) => scaleOf(k.transform)[1]);
  assert.deepEqual([xs[0], ys[0]], [0.92, 0.92]);
  assert.deepEqual([xs.at(-1), ys.at(-1)], [1, 1]);
  assert.ok(Math.max(...xs) > 1.01, 'overshoots: the bounce');
  const lag = Math.round(JELLY_LAG / FRAME);
  assert.ok(ys.slice(0, lag).every((y) => y === 0.92), 'y waits while x starts');
  assert.ok(xs[lag] > ys[lag], 'x leads y: the wobble');
  assert.ok(duration > 400 && duration < 1200, `duration ${duration}`);
  // Nonsense input is clamped, never NaN.
  assert.deepEqual(scaleOf(releaseKeyframes('x').keyframes.at(-1).transform), [1, 1]);
});

test('glide keyframes start at the old box, stretch with speed and end at rest', () => {
  const { keyframes } = glideKeyframes({ left: 0, width: 60 }, { left: 240, width: 60 });
  assert.match(keyframes[0].transform, /^translateX\(-240px\) scale\(1, 1\)$/);
  assert.equal(keyframes.at(-1).transform, 'translateX(0px) scale(1, 1)');
  const stretches = keyframes.map((k) => scaleOf(k.transform)[0]);
  assert.ok(Math.max(...stretches) > 1.1, 'stretches while moving');
  assert.ok(Math.max(...stretches) <= 1 + MAX_STRETCH + 1e-9);
  const offsets = keyframes.map((k) => k.offset);
  assert.ok(offsets.every((o, i) => i === 0 || o >= offsets[i - 1]));
  // A wider target starts squeezed to the old width.
  const grow = glideKeyframes({ left: 0, width: 40 }, { left: 100, width: 80 });
  assert.match(grow.keyframes[0].transform, /scale\(0\.5, 1\)$/);
});

/* ---------- Glass stays readable ---------- */

test('bare page backdrop keeps header and footer text at AA for every hour and smog level', () => {
  for (const phase of PHASES) {
    for (const band of BANDS) {
      const atmo = atmosphereFor(gradeFor(phase, band));
      for (const key of ['--atmo-1', '--atmo-3']) {
        const worst = worstText(atmo[key], BARE_TEXT);
        assert.ok(worst >= MIN_CONTRAST, `${phase}/${band} ${key}: ${worst.toFixed(2)}`);
      }
    }
  }
});

test('every text colour on a glass sheet reads at AA over every backdrop', () => {
  for (const phase of PHASES) {
    for (const band of BANDS) {
      for (const colour of [PAPER, ...Object.values(atmosphereFor(gradeFor(phase, band)))]) {
        const worst = worstText(panelSurface(colour), GLASS_TEXT);
        assert.ok(worst >= MIN_CONTRAST, `${phase}/${band} over ${colour}: ${worst.toFixed(2)}`);
      }
    }
  }
});

test('the backdrop takes visible colour from the sky behind the glass', () => {
  const noon = atmosphereFor(gradeFor('afternoon', 'good'))['--atmo-2'];
  const dusk = atmosphereFor(gradeFor('evening', 'good'))['--atmo-2'];
  assert.notEqual(noon, PAPER);
  assert.notEqual(dusk, PAPER);
  const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(noon.slice(i, i + 2), 16));
  assert.ok(b > r + 30, `midday glow should be blue, got ${noon}`);
  const [r2, , b2] = [1, 3, 5].map((i) => Number.parseInt(dusk.slice(i, i + 2), 16));
  assert.ok(r2 > b2 + 30, `dusk glow should be warm, got ${dusk}`);
  assert.equal(atmosphereTint('#000000'), atmosphereTint('#000000')); // deterministic
});

test('tab bar labels read at AA even over the darkest scene scrolling under it', () => {
  for (const under of ['#000000', '#ffffff', '#c62828', '#05060a']) {
    const surface = composite(TABBAR.tint, TABBAR.alpha, under);
    assert.ok(contrastRatio(TABBAR.label, surface) >= MIN_CONTRAST, `over ${under}`);
  }
});

test('the glass speech bubble keeps the hero ink readable in every grade', () => {
  for (const phase of PHASES) {
    for (const band of BANDS) {
      const grade = gradeFor(phase, band);
      const glass = heroGlassFor(grade.ink);
      const v = grade.vars;
      for (const behind of [v['--sky-1'], v['--sky-2'], v['--sky-3'], v['--skyline'], v['--skyline-far']]) {
        const surface = composite(glass.colour, glass.alpha, behind);
        const ratio = contrastRatio(grade.ink, surface);
        assert.ok(ratio >= MIN_CONTRAST, `${phase}/${band} over ${behind}: ${ratio.toFixed(2)}`);
      }
      assert.match(glass.css, /^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
      assert.ok(['light', 'smoked'].includes(glass.tone));
    }
  }
});

/* ---------- styles.css and index.html use the same numbers ---------- */

test('styles.css mirrors the colours and glass tints the checks use', () => {
  assert.match(css, new RegExp(`--paper: ${PAPER};`));
  assert.match(css, new RegExp(`--ink-2: ${TEXT.ink2};`));
  assert.match(css, new RegExp(`--ink-3: ${TEXT.ink3};`));
  assert.match(css, new RegExp(`--danger: ${TEXT.danger};`));
  assert.match(css, new RegExp(`--ok: ${TEXT.ok};`));
  assert.match(css, new RegExp(`--caution: ${TEXT.caution};`));
  assert.match(css, new RegExp(`--move: ${TEXT.move};`));
  assert.match(css, new RegExp(`--glass-panel: ${Math.round(GLASS.panel * 100)}%;`));
  assert.match(css, new RegExp(`--glass-tabbar: ${Math.round(GLASS.tabbar * 100)}%;`));
  assert.match(css, /background: rgb\(250 249 246 \/ var\(--glass-tabbar\)\);/);
  assert.equal(TABBAR.tint, '#faf9f6');
  assert.match(css, new RegExp(`\\.tab \\{[^}]*color: ${TABBAR.label};`));
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /prefers-contrast: more/);
});

test('every tab points at a live-screen section with a focusable heading, plus a Settings tab', () => {
  const tabs = [...html.matchAll(/class="tab" href="#([\w-]+)" data-section="([\w-]+)"/g)];
  assert.deepEqual(tabs.map((t) => t[2]), ['sec-air', 'sec-plan', 'sec-ask']);
  for (const [, href, section] of tabs) {
    assert.equal(href, section);
    assert.match(html, new RegExp(`<section class="panel[^"]*" id="${section}"[^>]*>\\s*<h2 id="[\\w-]+"[^>]*tabindex="-1"`));
  }
  assert.match(html, /<button id="tab-settings" type="button" class="tab" aria-haspopup="dialog" aria-controls="settings">/);
  assert.match(html, /<dialog id="settings" class="sheet" aria-labelledby="settings-title">/);
});

test('the AQI slider and time-of-day picker exist only inside the demo panel', () => {
  const demo = html.slice(html.indexOf('<div id="demo-panel"'), html.indexOf('<div id="readout"'));
  assert.match(demo, /id="sim-range"/);
  assert.match(demo, /name="phase"/);
  assert.equal((html.match(/id="sim-range"/g) || []).length, 1);
  assert.equal((html.match(/name="phase"/g) || []).length, 5);
  assert.match(html, /<div id="demo-panel" class="demo-panel" hidden>/);
});

test('every switch is a labelled checkbox with role="switch"', () => {
  const switches = [...html.matchAll(/<input[^>]*class="switch"[^>]*>/g)].map((m) => m[0]);
  assert.ok(switches.length >= 12, `found ${switches.length}`);
  for (const tag of switches) {
    assert.match(tag, /type="checkbox"/);
    assert.match(tag, /role="switch"/);
  }
});
