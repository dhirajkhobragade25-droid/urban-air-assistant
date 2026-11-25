/**
 * View builders: turn computed data into DOM nodes. They read nothing from
 * the page and change nothing outside the nodes they return, so the UI
 * modules decide where each piece goes.
 */
export { heroNodes, gaugeNode, animateGauge } from './views/hero.js';
export { aqiScale, forecastChart, pollutantBars, readoutNodes } from './views/readout.js';
export { adviceCard, planGroup, dosDontsSection, dayPlanSection, impactSection } from './views/plan.js';
