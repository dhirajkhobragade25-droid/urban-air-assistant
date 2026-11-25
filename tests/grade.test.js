import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, phaseForHour, gradeFor, contrastRatio, mix, INK_DARK, INK_LIGHT, MIN_CONTRAST,
} from '../js/grade.js';
import { AQI_BANDS } from '../js/engine.js';

const HEX = /^#[0-9a-f]{6}$/;

test('phaseForHour splits the day into morning, afternoon, evening and night', () => {
  const expected = {
    0: 'night', 4: 'night', 5: 'morning', 10: 'morning', 11: 'afternoon', 15: 'afternoon',
    16: 'evening', 19: 'evening', 20: 'night', 23: 'night', 24: 'night', [-1]: 'night',
  };
  for (const [hour, phase] of Object.entries(expected)) assert.equal(phaseForHour(Number(hour)), phase, `hour ${hour}`);
  assert.equal(phaseForHour('x'), 'afternoon');
});

test('every time of day × AQI band keeps the hero text at WCAG AA or better', () => {
  for (const phase of PHASES) {
    for (const band of AQI_BANDS) {
      const grade = gradeFor(phase, band.key);
      assert.ok(grade.contrast >= MIN_CONTRAST, `${phase}/${band.key}: ${grade.contrast}`);
      assert.ok([INK_DARK, INK_LIGHT].includes(grade.ink));
      for (const key of ['--sky-1', '--sky-2', '--sky-3', '--skyline', '--skyline-far', '--verge', '--road']) {
        assert.match(grade.vars[key], HEX, `${phase}/${band.key} ${key}`);
      }
      assert.match(grade.vars['--bloom'], /^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
      assert.match(grade.vars['--haze'], /^rgb\(\d+ \d+ \d+ \/ \d+%\)$/);
    }
  }
});

test('the light reads as its time of day', () => {
  assert.equal(gradeFor('afternoon', 'good').ink, INK_DARK, 'bright clear afternoon: dark text');
  assert.equal(gradeFor('morning', 'good').ink, INK_DARK);
  assert.equal(gradeFor('evening', 'good').ink, INK_LIGHT, 'dusk: light text');
  assert.equal(gradeFor('night', 'good').ink, INK_LIGHT);
  assert.equal(gradeFor('night', 'hazardous').vars['--sky-1'], gradeFor('night', 'good').vars['--sky-1'], 'night sky stays obsidian');
  assert.notEqual(gradeFor('night', 'hazardous').vars['--sky-3'], gradeFor('night', 'good').vars['--sky-3'], 'smog glows on the night horizon');
});

test('thicker smog makes the same sky darker and murkier', () => {
  const luminanceOrder = AQI_BANDS.map((b) => contrastRatio(gradeFor('afternoon', b.key).vars['--sky-3'], '#000000'));
  for (let i = 1; i < luminanceOrder.length; i += 1) assert.ok(luminanceOrder[i] <= luminanceOrder[i - 1], `band ${i} not darker`);
  assert.equal(gradeFor('afternoon', 'good').vars['--haze'].endsWith('/ 0%)'), true, 'no haze in clean air');
});

test('unknown inputs fall back safely, and colour helpers behave', () => {
  assert.equal(gradeFor('teatime', 'unknown').phase, 'afternoon');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#123456', '#abcdef', 0), '#123456');
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
});
