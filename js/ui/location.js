/**
 * Finding the user's place: typed search, one-tap cities and GPS, then
 * loading its live air.
 */
import { createAirClient } from '../api.js';
import { afterPlace, placeToStore } from '../flow.js';
import { el } from '../dom.js';
import { KEYS, store } from '../storage.js';
import { els } from './elements.js';
import { state, local } from './state.js';
import { setStatus, errorParams } from './status.js';
import { render } from './render.js';
import { showScreen } from './screens.js';

const client = createAirClient();
const GPS_OPTIONS = Object.freeze({ enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });

function setLocating(busy, button = els.searchBtn) {
  [els.searchBtn, els.gpsBtn, ...els.quickCities.querySelectorAll('button')].forEach((btn) => {
    btn.disabled = busy;
    if (!busy) btn.classList.remove('is-loading');
  });
  if (busy) button.classList.add('is-loading');
  els.readout.setAttribute('aria-busy', String(busy));
}

/**
 * Fetches the live air for a place, saves the place and moves setup on.
 * @param {{label?: string, labelKey?: string, latitude: number, longitude: number}} place
 */
export async function loadPlace(place) {
  const id = ++state.requestId;
  setStatus('status.loading');
  const snapshot = await client.fetchAirQuality(place);
  if (id !== state.requestId) return; // a newer request won
  state.live = { place, snapshot };
  store.set(local, KEYS.place, placeToStore(place));
  setStatus(''); // the city now shows on the scene itself
  els.placeResults.hidden = true;
  render();
  if (state.screen === 'setup-place') {
    showScreen(afterPlace({ setupDone: state.setupDone, editing: state.editing }), { focus: true });
  }
}

/** Runs a location task with the busy state and error reporting handled. */
export async function withLocating(button, task) {
  setLocating(true, button);
  try {
    await task();
  } catch (error) {
    setStatus('status.error', errorParams(error), true);
  } finally {
    setLocating(false);
  }
}

function showPlaceChoices(places) {
  els.placeList.replaceChildren(
    ...places.map((place) =>
      el('li', {}, [
        el('button', {
          type: 'button',
          class: 'btn',
          dataset: { lat: String(place.latitude), lon: String(place.longitude), label: place.label },
          text: place.label,
        }),
      ]),
    ),
  );
  els.placeResults.hidden = places.length < 2;
}

/**
 * Typed search lists the matches when there is more than one, so the user
 * picks the right town; a one-tap city chip takes the first match.
 */
function searchPlace(query, { pickFirst = false } = {}) {
  withLocating(els.searchBtn, async () => {
    setStatus('status.searching');
    const places = await client.searchPlaces(query, state.lang);
    if (!places.length) {
      showPlaceChoices([]);
      setStatus('status.noPlace', {}, true);
      return;
    }
    if (places.length === 1 || pickFirst) {
      await loadPlace(places[0]);
      return;
    }
    showPlaceChoices(places);
    setStatus('');
  });
}

/** Submit of the city search form. */
export function onSearch(event) {
  event.preventDefault();
  const query = els.cityInput.value.trim();
  if (!query) {
    setStatus('status.emptyQuery', {}, true);
    els.cityInput.focus();
    return;
  }
  searchPlace(query);
}

/** Tap on one of several matching places. */
export function onPlaceChoice(event) {
  const btn = event.target.closest('button[data-lat]');
  if (!btn) return;
  withLocating(els.searchBtn, () =>
    loadPlace({
      label: btn.dataset.label,
      latitude: Number(btn.dataset.lat),
      longitude: Number(btn.dataset.lon),
    }),
  );
}

/** "Use my location". */
export function onGps() {
  if (!('geolocation' in navigator)) {
    setStatus('status.gpsUnsupported', {}, true);
    return;
  }
  setLocating(true, els.gpsBtn);
  setStatus('status.loading');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) =>
      withLocating(els.gpsBtn, () =>
        loadPlace({
          labelKey: 'loc.myLocation',
          latitude: coords.latitude,
          longitude: coords.longitude,
        }),
      ),
    () => {
      setStatus('status.gpsDenied', {}, true);
      setLocating(false);
    },
    GPS_OPTIONS,
  );
}

/** Tap on a popular city chip. */
export function onQuickCity(event) {
  const chip = event.target.closest('button[data-city]');
  if (!chip) return;
  els.cityInput.value = chip.dataset.city;
  searchPlace(chip.dataset.city, { pickFirst: true });
}
