/**
 * View builders: turn computed data into DOM nodes.
 * They read nothing from the page and change nothing outside the nodes they
 * return, so app.js decides where each piece goes.
 */
import { el } from './dom.js';
import { formatRange, whoMultiple, aqiScalePosition } from './engine.js';
import { describeAdvice } from './assistant.js';
import { describeRoutineItem, formatHour } from './routine.js';
import { formatNumber } from './i18n.js';

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
 * Nodes for the "your air right now" readout.
 * @param {object|null} view  computed view (see app.js computeView)
 * @param {Function} T        translator
 * @param {string} lang
 */
export function readoutNodes(view, T, lang) {
  if (!view) return [el('p', { class: 'empty', text: T('air.empty') })];
  const { risk, snapshot, window } = view;
  const nodes = [
    el('div', { class: 'aqi-big' }, [
      el('span', { class: 'aqi-number', text: String(view.aqi) }),
      el('span', { class: 'aqi-unit', text: T('air.aqiLabel') }),
    ]),
    el('span', { class: 'band-chip', dataset: { band: risk.band.key }, text: T(`band.${risk.band.key}`) }),
    el('p', { class: 'personal' }, [
      el('span', {
        class: 'band-chip',
        dataset: { band: risk.personal.key },
        text: T('air.personal', { label: T(`band.${risk.personal.key}`) }),
      }),
    ]),
  ];
  if (risk.raised) nodes.push(el('p', { class: 'raised', text: T('air.raised') }));
  nodes.push(aqiScale(view.aqi));

  if (!snapshot) {
    nodes.push(el('p', { class: 'hint', text: T('air.simulated') }));
    return nodes;
  }

  const readings = [['air.pm25', snapshot.pm25], ['air.pm10', snapshot.pm10], ['air.no2', snapshot.no2], ['air.o3', snapshot.o3]]
    .filter(([, value]) => value !== null)
    .map(([key, value]) => el('div', {}, [el('dt', { text: T(key) }), el('dd', { text: formatNumber(lang, Math.round(value)) })]));
  if (readings.length) {
    nodes.push(el('p', { class: 'hint', text: T('air.pollutants') }), el('dl', { class: 'pollutants' }, readings));
  }

  const multiple = whoMultiple(snapshot.pm25);
  if (multiple !== null) {
    nodes.push(el('p', { text: multiple > 1 ? T('air.who', { x: formatNumber(lang, multiple) }) : T('air.whoOk') }));
  }
  if (window) {
    nodes.push(el('ul', { class: 'windows' }, [
      el('li', { class: 'is-best', text: T('air.best', { range: formatRange(window.start, window.hours), nextDay: window.nextDay }) }),
      el('li', { class: 'is-worst', text: T('air.worst', { range: formatRange(window.worstStart, window.hours), nextDay: window.worstNextDay }) }),
    ]));
  }
  nodes.push(el('p', { class: 'updated', text: T('air.updated', { time: snapshot.time.slice(11, 16) }) }));
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
