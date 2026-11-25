import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPRINGS, FRAME, JELLY_LAG, MAX_STRETCH, dampingRatio, springAt, sampleSpring,
  pressDepth, pressKeyframes, releaseKeyframes, glideKeyframes,
} from '../js/spring.js';
import {
  TEXT, BARE_TEXT, GLASS_TEXT, TAB_TEXT, CONTROL_FILL, composite, worstText,
  SKY, skyFor, heroGlassFor, GLASS_FROST, pickAlpha,
} from '../js/glass.js';
import { existsSync, statSync } from 'node:fs';
import { PHASES, gradeFor, contrastRatio, MIN_CONTRAST } from '../js/grade.js';
import { AQI_BANDS } from '../js/engine.js';
import { GAUGE, polarPoint, arcPath, gaugeSegments, gaugeAngle, gaugeFills } from '../js/chart.js';

const round = (n) => Math.round(n * 100) / 100;

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

const PHASE_KEYS = Object.keys(SKY);

test('every text colour reads at AA on the glass cards, over every part of the page, with frost and buttons', () => {
  for (const phase of PHASE_KEYS) {
    const sky = skyFor(phase);
    assert.ok(sky.card > 0 && sky.card <= 1);
    for (const stop of sky.stops) {
      const card = composite(sky.deep, sky.card, stop);
      for (const surface of [card, composite(GLASS_FROST.colour, GLASS_FROST.alpha, card)]) {
        const worst = worstText(surface, GLASS_TEXT);
        assert.ok(worst >= MIN_CONTRAST, `${phase} card over ${stop}: ${worst.toFixed(2)}`);
        const onButton = contrastRatio(TEXT.ink, composite('#ffffff', CONTROL_FILL, surface));
        assert.ok(onButton >= MIN_CONTRAST, `${phase} button text: ${onButton.toFixed(2)}`);
      }
    }
  }
});

test('footer text reads straight on the deepest page colour', () => {
  for (const phase of PHASE_KEYS) {
    const worst = worstText(skyFor(phase).stops[2], BARE_TEXT);
    assert.ok(worst >= MIN_CONTRAST, `${phase}: ${worst.toFixed(2)}`);
  }
});

test('tab bar labels read at AA even over the brightest or darkest scene scrolling under it', () => {
  for (const phase of PHASE_KEYS) {
    const sky = skyFor(phase);
    for (const under of ['#ffffff', '#000000', '#ffd166', ...sky.stops]) {
      const worst = worstText(composite(sky.deep, sky.tab, under), TAB_TEXT);
      assert.ok(worst >= MIN_CONTRAST, `${phase} over ${under}: ${worst.toFixed(2)}`);
    }
  }
});

test('each time of day has its own colour, deepening down the page', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const lum = (hex) => contrastRatio(hex, '#000000');
  for (const phase of PHASE_KEYS) {
    const { stops } = skyFor(phase);
    assert.ok(lum(stops[0]) > lum(stops[1]) && lum(stops[1]) > lum(stops[2]), `${phase} deepens`);
  }
  const [r1, , b1] = rgb(skyFor('afternoon').stops[0]);
  assert.ok(b1 > r1, 'midday is sky blue');
  const [r2, , b2] = rgb(skyFor('morning').stops[0]);
  assert.ok(r2 > b2, 'dawn is warm');
  assert.ok(lum(skyFor('night').stops[0]) < lum(skyFor('afternoon').stops[0]), 'night is darker than midday');
  assert.deepEqual(skyFor('unknown').stops, skyFor('afternoon').stops);
  assert.match(skyFor('evening').vars['--card'], /^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
  // Glass stays see-through.
  for (const phase of PHASE_KEYS) assert.ok(skyFor(phase).card < 0.8, `${phase} card is see-through`);
});

test('the card tint is the lightest that passes, and solid when none does', () => {
  assert.equal(pickAlpha(() => true), 0.3);
  assert.equal(pickAlpha((a) => a >= 0.62), 0.65);
  assert.equal(pickAlpha(() => false), 1);
});

test('the AQI changes only the scene: the page, the cards and the frost stay put', () => {
  // skyFor takes the time of day alone, so no reading can reach it.
  for (const phase of PHASE_KEYS) {
    assert.deepEqual(skyFor(phase, 400), skyFor(phase), `${phase} ignores any extra argument`);
  }
  // The scene above still changes with the band.
  const clean = gradeFor('afternoon', 'good').vars['--sky-1'];
  const smog = gradeFor('afternoon', 'hazardous').vars['--sky-1'];
  assert.notEqual(clean, smog, 'the scene turns smoggy');
  // The frost is a constant in CSS and nothing in app.js sets it per reading.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /--frost/);
  assert.doesNotMatch(app, /skyFor\([^)]*,/);
  assert.match(css, new RegExp(`@property --frost \\{[^}]*initial-value: ${GLASS_FROST.amount};`));
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(GLASS_FROST.colour.slice(i, i + 2), 16));
  assert.match(css, new RegExp(`@property --frost-tint \\{[^}]*initial-value: rgb\\(${r} ${g} ${b} / ${Math.round(GLASS_FROST.alpha * 100)}%\\);`));
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
  assert.match(css, new RegExp(`--ink: ${TEXT.ink};`));
  assert.match(css, new RegExp(`--ink-2: ${TEXT.ink2};`));
  assert.match(css, new RegExp(`--ink-3: ${TEXT.ink3};`));
  assert.match(css, new RegExp(`--danger: ${TEXT.danger};`));
  assert.match(css, new RegExp(`--ok: ${TEXT.ok};`));
  assert.match(css, new RegExp(`--caution: ${TEXT.caution};`));
  assert.match(css, new RegExp(`--move: ${TEXT.move};`));
  assert.match(css, new RegExp(`--glacier: ${TEXT.glacier};`));
  assert.match(css, new RegExp(`--control-fill: ${Math.round(CONTROL_FILL * 100)}%;`));
  assert.match(css, /\.tabbar \{ background: var\(--tab\); \}/);
  assert.match(css, /\.tab \{ color: var\(--ink-2\); \}/);
  assert.match(css, /\.panel, \.readout \{ background: var\(--cut-glint\), var\(--card\);/);
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

test('Poppins is self-hosted, licensed, and allowed by the content security policy', () => {
  for (const w of [300, 400, 500, 700]) {
    const file = new URL(`../fonts/poppins-${w}.woff`, import.meta.url);
    assert.ok(existsSync(file), `poppins-${w}.woff`);
    assert.ok(statSync(file).size < 90_000, 'subset stays small');
    assert.match(css, new RegExp(`url\\("\\.\\./fonts/poppins-${w}\\.woff"\\)`));
  }
  assert.ok(existsSync(new URL('../fonts/OFL.txt', import.meta.url)));
  assert.match(html, /font-src 'self'/);
  assert.match(css, /--font-sans: "Poppins"/);
});

test('the big glass sheets are cut like ice; controls stay softly rounded', () => {
  assert.match(css, /:is\(\.panel, \.sheet, \.stage\) \{ border-top-right-radius: var\(--cut\); corner-top-right-shape: bevel; \}/);
  assert.match(css, /@supports not \(corner-shape: bevel\)/);
  assert.match(css, /\.btn, \.chip, \.lang-switch, \.lang-btn, \.phase-options, \.phase-option, \.lens, \.tabbar, \.tab,\n\.search-field input, \.status, \.setup-preview, \.setup-actions, \.demo-badge \{ border-radius: 999px; \}/);
});

/* ---------- AQI ring gauge ---------- */

test('the ring is a 270° dial of six band arcs with gaps, opening at the bottom', () => {
  const segs = gaugeSegments();
  assert.equal(segs.length, 6);
  assert.equal(segs[0].a0, GAUGE.start + GAUGE.gap / 2);
  assert.equal(segs[5].a1, GAUGE.start + GAUGE.sweep - GAUGE.gap / 2);
  for (let i = 1; i < segs.length; i += 1) {
    assert.equal(segs[i].a0 - segs[i - 1].a1, GAUGE.gap, 'equal gaps between bands');
  }
  for (const s of segs) assert.match(s.d, /^M[\d.]+ [\d.]+A84 84 0 0 1 [\d.]+ [\d.]+$/);
  // Start and end sit below the centre, symmetric about it: the opening faces down.
  const a = polarPoint(GAUGE.start);
  const b = polarPoint(GAUGE.start + GAUGE.sweep);
  assert.ok(a.y > GAUGE.cy && b.y > GAUGE.cy);
  assert.equal(round(a.x + b.x), 2 * GAUGE.cx);
  assert.deepEqual(polarPoint(0), { x: GAUGE.cx + GAUGE.r, y: GAUGE.cy });
  assert.match(arcPath(0, 200), /A84 84 0 1 1 /, 'arcs over 180° take the long way');
});

test('the marker angle and band fills follow the scale position, clamped to the dial', () => {
  assert.equal(gaugeAngle(0), GAUGE.start);
  assert.equal(gaugeAngle(100), GAUGE.start + GAUGE.sweep);
  assert.equal(gaugeAngle(50), GAUGE.start + GAUGE.sweep / 2);
  assert.equal(gaugeAngle(-20), GAUGE.start);
  assert.equal(gaugeAngle(140), GAUGE.start + GAUGE.sweep);
  assert.equal(gaugeAngle('x'), GAUGE.start);
  assert.deepEqual(gaugeFills(0), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(gaugeFills(100), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(gaugeFills(25), [1, 0.5, 0, 0, 0, 0]);
  // Always lit from the first band up, never with a hole.
  for (let pos = 0; pos <= 100; pos += 5) {
    const fills = gaugeFills(pos);
    for (let i = 1; i < fills.length; i += 1) assert.ok(fills[i] <= fills[i - 1], `pos ${pos}`);
  }
});
