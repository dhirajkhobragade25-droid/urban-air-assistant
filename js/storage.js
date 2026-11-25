/**
 * Browser storage that never throws (private mode, quota, disabled cookies).
 * Values are stored as JSON.
 */

export const KEYS = Object.freeze({
  lang: 'uaqa.lang',
  profile: 'uaqa.profile',
  place: 'uaqa.place',
  ai: 'uaqa.ai',
  buddy: 'uaqa.buddy',
  routine: 'uaqa.routine',
  setup: 'uaqa.setup',
});

/**
 * Returns `scope[name]` (localStorage / sessionStorage) if it works, else null.
 * @param {'localStorage'|'sessionStorage'} name
 */
export function openStorage(name, scope = globalThis) {
  try {
    const area = scope[name];
    const probe = '__uaqa__';
    area.setItem(probe, probe);
    area.removeItem(probe);
    return area;
  } catch {
    return null;
  }
}

/** JSON read/write helpers; every call is safe with a null or failing area. */
export const store = Object.freeze({
  get(area, key) {
    try {
      return area ? JSON.parse(area.getItem(key)) : null;
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      if (area) area.setItem(key, JSON.stringify(value));
    } catch {
      /* quota exceeded or storage disabled: the app keeps working without it */
    }
  },
  remove(area, key) {
    try {
      if (area) area.removeItem(key);
    } catch {
      /* ignore */
    }
  },
});
