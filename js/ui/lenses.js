/**
 * Glass lenses (the bubble that marks the chosen option) and the tab bar.
 */
import { createLens } from '../press.js';
import { prefersReducedMotion } from '../dom.js';
import { els } from './elements.js';

const SPY_PAUSE_MS = 1200; // let a tab's scroll finish before the section spy takes over

const lensOptions = { reducedMotion: prefersReducedMotion };
const pressedLang = (group) => () => group.querySelector('.lang-btn[aria-pressed="true"]');

export const lenses = {
  langHead: createLens(els.langHead, pressedLang(els.langHead), lensOptions),
  langSettings: createLens(els.langSettings, pressedLang(els.langSettings), lensOptions),
  phase: createLens(
    els.phaseOptions,
    () => els.phaseOptions.querySelector('input:checked')?.closest('.phase-option'),
    lensOptions,
  ),
  tabs: createLens(els.tabbar, () => els.tabbar.querySelector('.tab[aria-current]'), lensOptions),
};

let spyPausedUntil = 0;

/**
 * Marks the tab of a section as current and glides the lens to it.
 * @param {string} sectionId
 * @param {boolean} [animate]
 */
export function setActiveTab(sectionId, animate = true) {
  els.tabbar.querySelectorAll('.tab').forEach((tab) => {
    if (tab.dataset.section === sectionId) tab.setAttribute('aria-current', 'location');
    else tab.removeAttribute('aria-current');
  });
  lenses.tabs.update(animate);
}

/** Tab tap: glide the lens, scroll to the section and move focus to its heading. */
export function goToSection(section) {
  setActiveTab(section.id);
  spyPausedUntil = performance.now() + SPY_PAUSE_MS;
  section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  section.querySelector('h2')?.focus({ preventScroll: true });
}

/** Lights the tab of whichever section crosses the upper middle of the screen. */
export function watchSections() {
  if (typeof IntersectionObserver !== 'function') return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (performance.now() < spyPausedUntil) return;
      const hit = entries.find((entry) => entry.isIntersecting);
      if (hit) setActiveTab(hit.target.id);
    },
    { rootMargin: '-35% 0px -60% 0px' },
  );
  els.home.querySelectorAll(':scope > section[id]').forEach((section) => observer.observe(section));
}
