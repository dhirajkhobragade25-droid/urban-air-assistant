/**
 * The household step: who is more sensitive, how you travel and cook, and
 * your usual day outdoors. Saved on every change.
 */
import { DEFAULT_PROFILE, normalizeProfile } from '../engine.js';
import { ACTIVITY_IDS, ROUTINE_HOURS, normalizeRoutine, formatHour } from '../routine.js';
import { el } from '../dom.js';
import { KEYS, store } from '../storage.js';
import { els } from './elements.js';
import { state, local } from './state.js';
import { scheduleRender } from './render.js';

const CHECKBOXES = Object.freeze(['children', 'elderly', 'respiratory', 'pregnant', 'purifier', 'outdoorExercise']);

const field = (name) => els.profileForm.elements.namedItem(name);

function fillTimeOptions() {
  ACTIVITY_IDS.forEach((id) => {
    field(`time-${id}`).replaceChildren(
      ...ROUTINE_HOURS.map((h) => el('option', { value: String(h), text: formatHour(h) })),
    );
  });
}

function readProfile() {
  const raw = Object.fromEntries(CHECKBOXES.map((name) => [name, field(name).checked]));
  raw.commute = field('commute').value;
  raw.cooking = field('cooking').value;
  raw.commuteKm = Number(field('commuteKm').value);
  return normalizeProfile(raw);
}

function readRoutine() {
  return normalizeRoutine(
    Object.fromEntries(
      ACTIVITY_IDS.map((id) => [id, field(`act-${id}`).checked ? Number(field(`time-${id}`).value) : null]),
    ),
  );
}

function writeProfile(profile, routine) {
  CHECKBOXES.forEach((name) => {
    field(name).checked = profile[name];
  });
  field('commute').value = profile.commute;
  field('cooking').value = profile.cooking;
  field('commuteKm').value = String(profile.commuteKm);
  ACTIVITY_IDS.forEach((id) => {
    const hour = routine[id];
    field(`act-${id}`).checked = hour !== null;
    field(`time-${id}`).value = String(hour === null ? ROUTINE_HOURS[0] : hour);
  });
  syncDisabledFields();
}

/** Inputs that make no sense in the current state are disabled, not hidden. */
function syncDisabledFields() {
  const wfh = field('commute').value === 'wfh';
  field('commuteKm').disabled = wfh;
  field('act-commute').disabled = wfh;
  ACTIVITY_IDS.forEach((id) => {
    const activity = field(`act-${id}`);
    field(`time-${id}`).disabled = !activity.checked || activity.disabled;
  });
}

/** Loads the saved household and day into the form. */
export function restoreHousehold() {
  state.profile = normalizeProfile(store.get(local, KEYS.profile) || DEFAULT_PROFILE);
  state.routine = normalizeRoutine(store.get(local, KEYS.routine));
  fillTimeOptions();
  writeProfile(state.profile, state.routine);
}

/** Any change in the form: read it, save it and redraw. */
export function onProfileChange() {
  state.profile = readProfile();
  state.routine = readRoutine();
  syncDisabledFields();
  store.set(local, KEYS.profile, state.profile);
  store.set(local, KEYS.routine, state.routine);
  scheduleRender();
}
