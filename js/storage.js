/**
 * storage.js
 * Local, per-browser UI preferences. No accounts, no sync, no server.
 */

const AAStorage = (function () {
  const KEY = 'aa-planning-calendar:prefs:v1';

  const DEFAULTS = {
    defaultView: 'today',
    academicYear: null, // resolved at runtime to the current/latest year
    visibleOwners: ['academic-calendar', 'academic-affairs', 'academic-divisions'],
    visibleCategories: ['term', 'holiday', 'registration', 'scheduling', 'other'],
    visibleTerms: ['fall', 'intersession', 'spring', 'summer']
  };

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function save(prefs) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (e) {
      // localStorage unavailable (e.g. private browsing) — fail silently,
      // the app still works, it just won't remember preferences.
    }
  }

  return { load, save, DEFAULTS };
})();
