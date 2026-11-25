/**
 * The hero over the scene: the city (or a Demo badge), the AQI ring and
 * numeral, the band and a one-line forecast.
 */
import { el } from '../dom.js';
import { aqiScalePosition, headlineFor, whoMultiple } from '../engine.js';
import { GAUGE, gaugeSegments, gaugeAngle, gaugeFills } from '../chart.js';
import { sampleSpring, SPRINGS } from '../spring.js';
import { formatNumber, formatClock } from '../i18n.js';
import { shortPlace } from '../flow.js';
import { svg } from './svg.js';

/**
 * The hero copy over the scene: the city in small type (or a Demo badge),
 * the oversized AQI numeral, the band name and a one-line forecast
 * ("Thick smog now. Cleaner air around 4 PM.").
 */
export function heroNodes(view, T, lang, phase = 'afternoon', { demo = false } = {}) {
  if (!view) return [el('p', { class: 'hero-line hero-idle', text: T('hero.idle') })];
  const { risk, snapshot, window } = view;
  const head = headlineFor({ band: risk.band, snapshot, window });
  const next = head.next
    ? T(
        head.next.key,
        head.next.hour === undefined ? {} : { clock: formatClock(lang, head.next.hour), nextDay: head.next.nextDay },
      )
    : '';
  const place =
    demo || !snapshot
      ? el('p', { class: 'hero-place' }, [
          el('span', { class: 'demo-badge', text: T('demo.badge') }),
          el('span', { text: T(`phase.${phase}`) }),
        ])
      : el('p', { class: 'hero-place' }, [
          svg('svg', { 'class': 'place-icon', 'viewBox': '0 0 24 24', 'aria-hidden': 'true', 'focusable': 'false' }, [
            svg('path', { d: 'M20.5 3.5L3.8 10.6a.5.5 0 0 0 .05.94l6.9 1.7 1.7 6.9a.5.5 0 0 0 .94.05z' }),
          ]),
          el('span', { class: 'place-name', text: shortPlace(view.place) }),
          el('span', { class: 'place-time', text: snapshot.time.slice(11, 16) }),
        ]);
  const who = snapshot ? whoMultiple(snapshot.pm25) : null;
  return [
    place,
    el('div', { class: 'hero-gauge' }, [
      gaugeNode(view.aqi, risk.band.key, T),
      el('div', { class: 'hero-side' }, [
        el('p', { class: 'hero-band', dataset: { band: risk.band.key } }, [
          el('span', { class: 'band-dot' }),
          T(`band.${risk.band.key}`),
        ]),
        who !== null && who >= 1
          ? el('p', { class: 'hero-who', text: T('hero.who', { times: formatNumber(lang, who) }) })
          : null,
      ]),
    ]),
    el('p', { class: 'hero-line' }, [
      T(head.nowKey, { when: T(`when.${phase}`) }),
      next ? ' ' : '',
      next ? el('span', { text: next }) : null,
    ]),
  ];
}

/**
 * The AQI ring: six band arcs around the reading, lit up to the current
 * value, with a glowing glass marker at the reading. The number inside is
 * real text; the ring itself is decoration (the band is also written out).
 */
export function gaugeNode(aqi, bandKey, T) {
  const position = aqiScalePosition(aqi);
  const segments = gaugeSegments();
  const fills = gaugeFills(position);
  const knobX = GAUGE.cx + GAUGE.r;
  const marker = svg('g', { class: 'gauge-marker' }, [
    svg('circle', { class: 'gauge-glow', cx: knobX, cy: GAUGE.cy, r: 15 }),
    svg('circle', { class: 'gauge-knob', cx: knobX, cy: GAUGE.cy, r: 9.5 }),
  ]);
  marker.style.transform = `rotate(${gaugeAngle(position)}deg)`;
  const ring = svg(
    'svg',
    { 'class': 'gauge-ring', 'viewBox': '0 0 200 200', 'aria-hidden': 'true', 'focusable': 'false' },
    [
      ...segments.map((seg, i) => svg('path', { class: `gauge-track b${i}`, d: seg.d })),
      ...segments.map((seg, i) =>
        svg('path', {
          'class': `gauge-fill b${i}`,
          'd': seg.d,
          'pathLength': 1,
          'stroke-dasharray': '1 1',
          'stroke-dashoffset': 1 - fills[i],
          'data-empty': String(fills[i] === 0),
        }),
      ),
      marker,
    ],
  );
  const node = el('div', { class: 'gauge', dataset: { band: bandKey, position: String(position) } }, [
    ring,
    el('p', { class: 'gauge-num' }, [
      el('span', { class: 'num', text: String(aqi) }),
      el('span', { class: 'unit', text: T('hero.unit') }),
    ]),
  ]);
  return node;
}

/**
 * Brings a freshly drawn gauge in from the last reading: the marker springs
 * along the ring, the arcs fill, and the number counts to the new value.
 * `from` is {aqi, position} of the previous gauge, or null for the first one.
 */
export function animateGauge(node, from, { reducedMotion = false } = {}) {
  const to = { aqi: Number(node.querySelector('.num').textContent), position: Number(node.dataset.position) };
  if (reducedMotion || !from || (from.aqi === to.aqi && from.position === to.position)) return to;
  const { values, duration } = sampleSpring(SPRINGS.glide, {
    from: gaugeAngle(from.position),
    to: gaugeAngle(to.position),
  });
  node.querySelector('.gauge-marker').animate(
    values.map((angle) => ({ transform: `rotate(${angle}deg)` })),
    { duration: duration * 1000, easing: 'linear' },
  );
  const before = gaugeFills(from.position);
  node.querySelectorAll('.gauge-fill').forEach((path, i) => {
    path.animate(
      [{ strokeDashoffset: 1 - before[i] }, { strokeDashoffset: Number(path.getAttribute('stroke-dashoffset')) }],
      { duration: 900, easing: 'cubic-bezier(.16, 1, .3, 1)' },
    );
  });
  const num = node.querySelector('.num');
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / 700, 1);
    const eased = 1 - (1 - t) ** 3;
    num.textContent = String(Math.round(from.aqi + (to.aqi - from.aqi) * eased));
    if (t < 1 && num.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return to;
}
