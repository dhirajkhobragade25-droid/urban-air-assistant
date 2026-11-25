/**
 * View builders: turn computed data into DOM nodes.
 * They read nothing from the page and change nothing outside the nodes they
 * return, so app.js decides where each piece goes.
 */
import { el } from './dom.js';
import { aqiScalePosition, headlineFor, pollutantRatios } from './engine.js';
import { forecastSeries, buildCurve } from './chart.js';
import { describeAdvice } from './assistant.js';
import { describeRoutineItem, formatHour } from './routine.js';
import { formatNumber, formatClock } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with attributes. */
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

const hourOf = (iso) => Number.parseInt(iso.slice(11, 13), 10);

const SCALE_TICKS = ['0', '50', '100', '150', '200', '300', '500'];

/** Colour scale with a marker. Decorative: the band is also given as text. */
export function aqiScale(aqi) {
  const marker = el('span', { class: 'aqi-marker' });
  marker.style.setProperty('--pos', `${aqiScalePosition(aqi)}%`);
  return el('div', { class: 'aqi-scale', 'aria-hidden': 'true' }, [
    el('div', { class: 'aqi-scale-bar' }, Array.from({ length: 6 }, () => el('span'))),
    marker,
    el('div', { class: 'aqi-ticks' }, SCALE_TICKS.map((n) => el('span', { text: n }))),
  ]);
}

/**
 * The editorial hero copy: place and time, oversized AQI numeral, band name
 * and a one-line forecast ("Thick smog now. Cleaner air around 4 PM.").
 */
export function heroNodes(view, T, lang, phase = 'afternoon') {
  if (!view) {
    return [
      el('p', { class: 'hero-meta', text: T('app.title') }),
      el('p', { class: 'hero-line hero-idle', text: T('hero.idle') }),
      el('p', { class: 'hero-sub', text: T('air.empty') }),
    ];
  }
  const { risk, snapshot, window } = view;
  const head = headlineFor({ band: risk.band, snapshot, window });
  const when = T(`phase.${phase}`);
  const meta = snapshot ? `${view.place} · ${when} · ${snapshot.time.slice(11, 16)}` : `${T('hero.whatIf')} · ${when}`;
  const next = head.next
    ? T(head.next.key, head.next.hour === undefined ? {} : { clock: formatClock(lang, head.next.hour), nextDay: head.next.nextDay })
    : '';
  return [
    el('p', { class: 'hero-meta', text: meta }),
    el('p', { class: 'hero-num' }, [
      el('span', { class: 'num', text: String(view.aqi) }),
      el('span', { class: 'unit', text: T('hero.unit') }),
    ]),
    el('p', { class: 'hero-band', dataset: { band: risk.band.key }, text: T(`band.${risk.band.key}`) }),
    el('p', { class: 'hero-line' }, [T(head.nowKey, { when: T(`when.${phase}`) }), next ? ' ' : '', next ? el('span', { text: next }) : null]),
  ];
}

/** 24-hour PM2.5 curve with thresholds, the cleanest window and a scrubber. */
export function forecastChart(view, T, lang) {
  const series = view.snapshot ? forecastSeries(view.snapshot.hourly, view.snapshot.time) : [];
  const W = 320;
  const H = 120;
  const curve = buildCurve(series, { width: W, height: H });
  if (!curve) return el('p', { class: 'empty', text: T('chart.empty') });

  const { points } = curve;
  const min = points.reduce((a, b) => (b.pm25 < a.pm25 ? b : a));
  const max = points.reduce((a, b) => (b.pm25 > a.pm25 ? b : a));
  const valueText = (p) => T('chart.value', { clock: formatClock(lang, hourOf(p.time)), pm: Math.round(p.pm25) });

  const layers = [];
  // Reference lines, highest first; a label is skipped when it would collide with the one above.
  let lastLabelY = -Infinity;
  for (const [value, label] of [[55.5, 'AQI 150'], [35.5, 'AQI 100'], [15, T('chart.who')]]) {
    if (value >= curve.yMax) continue;
    const y = curve.y(value);
    layers.push(svg('line', { class: 'chart-rule', x1: 0, x2: W, y1: y, y2: y }));
    if (y - lastLabelY >= 11) {
      layers.push(svg('text', { class: 'chart-rule-label', x: W, y: y - 3, 'text-anchor': 'end', text: label }));
      lastLabelY = y;
    }
  }
  const best = view.window && points.find((p) => p.time === view.window.start);
  if (best) {
    const x0 = curve.x(best.offset);
    const x1 = curve.x(Math.min(best.offset + view.window.hours - 1, 23));
    layers.push(svg('rect', { class: 'chart-best', x: x0 - 4, y: 0, width: Math.max(x1 - x0 + 8, 8), height: H }));
    layers.push(svg('text', { class: 'chart-best-label', x: (x0 + x1) / 2, y: 11, 'text-anchor': 'middle', text: T('chart.best') }));
  }
  layers.push(svg('path', { class: 'chart-area', d: curve.area }));
  layers.push(svg('path', { class: 'chart-line', d: curve.line }));
  for (const offset of [0, 6, 12, 18, 23]) {
    const p = points.find((pt) => pt.offset === offset);
    if (!p) continue;
    const anchor = offset === 0 ? 'start' : offset === 23 ? 'end' : 'middle';
    layers.push(svg('text', {
      class: 'chart-x', x: p.x, y: H + 18, 'text-anchor': anchor, text: offset === 0 ? T('chart.now') : formatClock(lang, hourOf(p.time)),
    }));
  }
  const cursorDot = svg('circle', { class: 'chart-dot', cx: 0, cy: points[0].y, r: 4.5 });
  const cursor = svg('g', { class: 'chart-cursor' }, [svg('line', { class: 'chart-cursor-line', x1: 0, x2: 0, y1: 0, y2: H }), cursorDot]);
  layers.push(cursor);

  const chart = svg('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H + 24}`, role: 'img',
    'aria-label': T('chart.summary', {
      now: Math.round(points[0].pm25), min: Math.round(min.pm25), minClock: formatClock(lang, hourOf(min.time)),
      max: Math.round(max.pm25), maxClock: formatClock(lang, hourOf(max.time)),
    }),
  }, layers);

  const readout = el('p', { class: 'chart-readout', 'aria-hidden': 'true', text: valueText(points[0]) });
  const scrub = el('input', {
    class: 'chart-scrub', type: 'range', min: '0', max: String(points.length - 1), step: '1', value: '0',
    'aria-label': T('chart.scrub'), 'aria-valuetext': valueText(points[0]),
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
  return el('ul', { class: 'bars' }, rows.map((r) => {
    const fill = el('span', { class: 'bar-fill' });
    fill.style.setProperty('--w', `${Math.min(r.ratio / 4, 1) * 100}%`);
    return el('li', { class: `bar${r.ratio > 1 ? ' is-over' : ''}` }, [
      el('span', { class: 'bar-name', text: T(`air.${r.key}`) }),
      el('span', { class: 'bar-track', 'aria-hidden': 'true' }, [fill, el('span', { class: 'bar-guide' })]),
      el('span', {
        class: 'bar-value',
        text: r.ratio > 1
          ? T('bars.over', { value: formatNumber(lang, r.value), x: formatNumber(lang, r.ratio) })
          : T('bars.ok', { value: formatNumber(lang, r.value) }),
      }),
    ]);
  }));
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
  if (snapshot) nodes.push(el('p', { class: 'updated', text: T('air.updated', { time: snapshot.time.slice(11, 16) }) }));
  else nodes.push(el('p', { class: 'hint', text: T('air.simulated') }));
  return nodes;
}

/** One recommendation card with its impact line. */
export function adviceCard(rec, T) {
  const text = describeAdvice(rec, T);
  return el('li', { class: 'advice', dataset: { priority: String(rec.priority) } }, [
    el('div', { class: 'advice-head' }, [
      el('p', { class: 'advice-title', text: text.title }),
      el('span', { class: 'prio-tag', text: T(`priority.${rec.priority}`) }),
    ]),
    el('p', { class: 'advice-action', text: text.action }),
    el('p', { class: 'advice-why' }, [el('strong', { text: T('plan.why') }), text.why]),
  ]);
}

/** Collapsible group of recommendations. */
export function planGroup({ category, items, open }, T) {
  const urgent = items.some((rec) => rec.priority === 1);
  const group = el('details', { class: 'plan-group', dataset: { category } }, [
    el('summary', {}, [
      el('h3', { id: `plan-${category}`, text: T(`plan.cat.${category}`) }),
      el('span', { class: `plan-count${urgent ? ' has-urgent' : ''}`, text: String(items.length) }),
    ]),
    items.length
      ? el('ul', {}, items.map((rec) => adviceCard(rec, T)))
      : el('p', { class: 'empty', text: T('plan.empty') }),
  ]);
  group.open = open;
  return group;
}

/** Green "do" and red "don't" lists. */
export function dosDontsSection({ dos, donts }, T) {
  const column = (kind, list) => el('div', { class: `dd-col dd-${kind}` }, [
    el('h4', { text: T(`dd.${kind}`) }),
    el('ul', {}, list.map((item) => el('li', { text: T(`${kind}.${item.id}`, item.params) }))),
  ]);
  return el('section', { class: 'dd', 'aria-labelledby': 'dd-heading' }, [
    el('h3', { id: 'dd-heading', text: T('dd.heading') }),
    el('div', { class: 'dd-cols' }, [column('do', dos), column('dont', donts)]),
  ]);
}

/** "Your day, re-planned": one row per activity in the family's routine. */
export function dayPlanSection(items, live, T) {
  const body = items.length
    ? el('ol', { class: 'day-list' }, items.map((item) => {
      const text = describeRoutineItem(item, T);
      return el('li', { class: 'day-item', dataset: { status: item.status } }, [
        el('span', { class: 'day-time', text: formatHour(item.status === 'move' ? item.bestHour : item.hour) }),
        el('div', { class: 'day-body' }, [
          el('p', { class: 'day-name' }, [text.name, el('span', { class: 'day-tag', text: text.tag })]),
          el('p', { class: 'day-text', text: text.text }),
          text.note ? el('p', { class: 'day-note', text: text.note }) : null,
        ]),
      ]);
    }))
    : el('p', { class: 'empty', text: T('day.empty') });
  return el('section', { class: 'day', 'aria-labelledby': 'day-heading' }, [
    el('h3', { id: 'day-heading', text: T('day.heading') }),
    el('p', { class: 'hint', text: T(live ? 'day.intro.live' : 'day.intro.sim') }),
    body,
  ]);
}

/** Headline impact tiles. */
export function impactSection(summary, T, lang) {
  const tiles = [];
  if (summary.weeklyCo2Kg > 0) {
    tiles.push(['co2', T('impact.co2', { kg: formatNumber(lang, summary.weeklyCo2Kg) }), T('impact.co2.label')]);
  }
  if (summary.movedCount > 0) {
    tiles.push(['exposure', T('impact.exposure', { pct: summary.avgReductionPct }), T('impact.exposure.label', { n: summary.movedCount })]);
  }
  if (summary.indoorsCount > 0) {
    tiles.push(['indoors', T('impact.indoors', { n: summary.indoorsCount }), T('impact.indoors.label')]);
  }
  return el('section', { class: 'impact', 'aria-labelledby': 'impact-heading' }, [
    el('h3', { id: 'impact-heading', text: T('impact.heading') }),
    tiles.length
      ? el('ul', { class: 'impact-tiles' }, tiles.map(([kind, value, label]) => el('li', { class: `impact-tile impact-${kind}` }, [
        el('strong', { text: value }),
        el('span', { text: label }),
      ])))
      : el('p', { class: 'empty', text: T('impact.none') }),
  ]);
}
