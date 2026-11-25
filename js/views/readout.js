/**
 * The data column: personal risk, the AQI scale, the 24-hour forecast curve
 * and each pollutant against its WHO guideline.
 */
import { el } from '../dom.js';
import { aqiScalePosition, pollutantRatios } from '../engine.js';
import { forecastSeries, buildCurve } from '../chart.js';
import { formatNumber, formatClock } from '../i18n.js';
import { svg, hourOf } from './svg.js';

const SCALE_TICKS = ['0', '50', '100', '150', '200', '300', '500'];

/** Colour scale with a marker. Decorative: the band is also given as text. */
export function aqiScale(aqi) {
  const marker = el('span', { class: 'aqi-marker' });
  marker.style.setProperty('--pos', `${aqiScalePosition(aqi)}%`);
  return el('div', { 'class': 'aqi-scale', 'aria-hidden': 'true' }, [
    el(
      'div',
      { class: 'aqi-scale-bar' },
      Array.from({ length: 6 }, () => el('span')),
    ),
    marker,
    el(
      'div',
      { class: 'aqi-ticks' },
      SCALE_TICKS.map((n) => el('span', { text: n })),
    ),
  ]);
}

const CHART_W = 320;
const CHART_H = 120;
const RULE_LABEL_GAP = 11; // px between two reference labels before the lower one is dropped
const X_TICKS = Object.freeze([0, 6, 12, 18, 23]);

/** Reference lines, highest first; a label is skipped when it would collide with the one above. */
function ruleLayers(curve, T) {
  const layers = [];
  let lastLabelY = -Infinity;
  for (const [value, label] of [
    [55.5, 'AQI 150'],
    [35.5, 'AQI 100'],
    [15, T('chart.who')],
  ]) {
    if (value >= curve.yMax) continue;
    const y = curve.y(value);
    layers.push(svg('line', { class: 'chart-rule', x1: 0, x2: CHART_W, y1: y, y2: y }));
    if (y - lastLabelY >= RULE_LABEL_GAP) {
      layers.push(
        svg('text', { 'class': 'chart-rule-label', 'x': CHART_W, 'y': y - 3, 'text-anchor': 'end', 'text': label }),
      );
      lastLabelY = y;
    }
  }
  return layers;
}

/** The band behind the cleanest window, labelled "cleanest". */
function bestWindowLayers(view, curve, T) {
  const best = view.window && curve.points.find((p) => p.time === view.window.start);
  if (!best) return [];
  const x0 = curve.x(best.offset);
  const x1 = curve.x(Math.min(best.offset + view.window.hours - 1, 23));
  return [
    svg('rect', { class: 'chart-best', x: x0 - 4, y: 0, width: Math.max(x1 - x0 + 8, 8), height: CHART_H }),
    svg('text', {
      'class': 'chart-best-label',
      'x': (x0 + x1) / 2,
      'y': 11,
      'text-anchor': 'middle',
      'text': T('chart.best'),
    }),
  ];
}

/** Hour labels under the curve: "Now", then every six hours, then the last hour. */
function axisLabels(points, T, lang) {
  const anchorFor = (offset) => ({ 0: 'start', 23: 'end' })[offset] || 'middle';
  return X_TICKS.map((offset) => points.find((pt) => pt.offset === offset))
    .filter(Boolean)
    .map((p) =>
      svg('text', {
        'class': 'chart-x',
        'x': p.x,
        'y': CHART_H + 18,
        'text-anchor': anchorFor(p.offset),
        'text': p.offset === 0 ? T('chart.now') : formatClock(lang, hourOf(p.time)),
      }),
    );
}

/** 24-hour PM2.5 curve with thresholds, the cleanest window and a scrubber. */
export function forecastChart(view, T, lang) {
  const series = view.snapshot ? forecastSeries(view.snapshot.hourly, view.snapshot.time) : [];
  const W = CHART_W;
  const H = CHART_H;
  const curve = buildCurve(series, { width: W, height: H });
  if (!curve) return el('p', { class: 'empty', text: T('chart.empty') });

  const { points } = curve;
  const min = points.reduce((a, b) => (b.pm25 < a.pm25 ? b : a));
  const max = points.reduce((a, b) => (b.pm25 > a.pm25 ? b : a));
  const valueText = (p) => T('chart.value', { clock: formatClock(lang, hourOf(p.time)), pm: Math.round(p.pm25) });

  const layers = [
    ...ruleLayers(curve, T),
    ...bestWindowLayers(view, curve, T),
    svg('path', { class: 'chart-area', d: curve.area }),
    svg('path', { class: 'chart-line', d: curve.line }),
    ...axisLabels(points, T, lang),
  ];
  const cursorDot = svg('circle', { class: 'chart-dot', cx: 0, cy: points[0].y, r: 4.5 });
  const cursor = svg('g', { class: 'chart-cursor' }, [
    svg('line', { class: 'chart-cursor-line', x1: 0, x2: 0, y1: 0, y2: H }),
    cursorDot,
  ]);
  layers.push(cursor);

  const chart = svg(
    'svg',
    {
      'class': 'chart',
      'viewBox': `0 0 ${W} ${H + 24}`,
      'role': 'img',
      'aria-label': T('chart.summary', {
        now: Math.round(points[0].pm25),
        min: Math.round(min.pm25),
        minClock: formatClock(lang, hourOf(min.time)),
        max: Math.round(max.pm25),
        maxClock: formatClock(lang, hourOf(max.time)),
      }),
    },
    layers,
  );

  const readout = el('p', { 'class': 'chart-readout', 'aria-hidden': 'true', 'text': valueText(points[0]) });
  const scrub = el('input', {
    'class': 'chart-scrub',
    'type': 'range',
    'min': '0',
    'max': String(points.length - 1),
    'step': '1',
    'value': '0',
    'aria-label': T('chart.scrub'),
    'aria-valuetext': valueText(points[0]),
  });
  scrub.addEventListener('input', () => {
    const p = points[Number(scrub.value)] || points[0];
    cursor.setAttribute('transform', `translate(${p.x} 0)`);
    cursorDot.setAttribute('cy', String(p.y));
    readout.textContent = valueText(p);
    scrub.setAttribute('aria-valuetext', valueText(p));
  });

  return el('div', { class: 'chart-wrap' }, [readout, el('div', { class: 'chart-box' }, [chart, scrub])]);
}

/** Thin bars: each pollutant as a multiple of its WHO guideline (scale 0–4×). */
export function pollutantBars(snapshot, T, lang) {
  const rows = pollutantRatios(snapshot);
  if (!rows.length) return null;
  return el(
    'ul',
    { class: 'bars' },
    rows.map((r) => {
      const fill = el('span', { class: 'bar-fill' });
      fill.style.setProperty('--w', `${Math.min(r.ratio / 4, 1) * 100}%`);
      return el('li', { class: `bar${r.ratio > 1 ? ' is-over' : ''}` }, [
        el('span', { class: 'bar-name', text: T(`air.${r.key}`) }),
        el('span', { 'class': 'bar-track', 'aria-hidden': 'true' }, [fill, el('span', { class: 'bar-guide' })]),
        el('span', {
          class: 'bar-value',
          text:
            r.ratio > 1
              ? T('bars.over', { value: formatNumber(lang, r.value), x: formatNumber(lang, r.ratio) })
              : T('bars.ok', { value: formatNumber(lang, r.value) }),
        }),
      ]);
    }),
  );
}

/**
 * Nodes for the data column: personal risk, the forecast curve, pollutant
 * bars and the AQI scale.
 */
export function readoutNodes(view, T, lang) {
  if (!view) return [el('p', { class: 'empty', text: T('air.empty') })];
  const { risk, snapshot } = view;
  const nodes = [
    el('p', { class: 'personal' }, [
      el('span', { class: 'personal-label', text: T('air.personal', { label: T(`band.${risk.personal.key}`) }) }),
    ]),
  ];
  if (risk.raised) nodes.push(el('p', { class: 'raised', text: T('air.raised') }));
  nodes.push(aqiScale(view.aqi));
  nodes.push(el('h3', { class: 'data-heading', text: T('chart.heading') }), forecastChart(view, T, lang));
  const bars = pollutantBars(snapshot, T, lang);
  if (bars) nodes.push(el('h3', { class: 'data-heading', text: T('bars.heading') }), bars);
  const footnote = snapshot
    ? el('p', { class: 'updated', text: T('air.updated', { time: snapshot.time.slice(11, 16) }) })
    : el('p', { class: 'hint', text: T('air.simulated') });
  nodes.push(footnote);
  return nodes;
}
