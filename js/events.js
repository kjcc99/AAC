/**
 * events.js
 * Loads source JSON, generates the unified event collection for a given
 * academic year, and provides filtering/sorting helpers.
 *
 * JSON is the source of truth. This module never hardcodes a date.
 */

const AAEvents = (function () {
  const OWNER_LABELS = {
    'academic-calendar': 'Academic Calendar',
    'academic-affairs': 'Academic Affairs',
    'academic-divisions': 'Academic Divisions',
    'student-services': 'Student Services'
  };

  const CATEGORY_LABELS = {
    term: 'Term',
    holiday: 'Holiday',
    registration: 'Registration',
    scheduling: 'Scheduling',
    other: 'Other'
  };

  const AUDIENCE_LABELS = {
    'academic-affairs': 'Academic Affairs',
    'academic-divisions': 'Academic Divisions',
    'student-services': 'Student Services',
    'general-campus': 'General Campus'
  };

  async function fetchJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  async function loadAcademicYears() {
    const data = await fetchJSON('data/academic-years.json');
    return data.years;
  }

  async function loadAcademicCalendar(fileName) {
    return fetchJSON(`data/academic-calendars/${fileName}`);
  }

  async function loadSchedulingCycle() {
    return fetchJSON('data/scheduling-cycles/2026-27.json');
  }

  /**
   * Generate the unified event collection for one academic year.
   * Combines absolute academic-calendar events with relative scheduling-cycle
   * events resolved against that year's term dates.
   */
  function generateEvents(academicCalendar, schedulingCycle) {
    const termsByID = {};
    for (const t of academicCalendar.terms) termsByID[t.id] = t;

    const blockedSet = AACal.buildBlockedDateSet(academicCalendar.calendarEvents);

    const events = [];

    // 1. Absolute academic-calendar events pass through unchanged.
    for (const ce of academicCalendar.calendarEvents) {
      events.push({
        ...ce,
        academicYear: academicCalendar.academicYear,
        source: 'academic-calendar',
        scheduleTerm: null,
        week: null,
        timing: null,
        relatedTerms: [],
        cycle: null
      });
    }

    // 2. Relative scheduling-cycle events are resolved to absolute dates.
    for (const se of schedulingCycle.events) {
      const term = termsByID[se.scheduleTerm];
      if (!term) continue; // term not present in this year's calendar; skip rather than guess

      const { start: weekStart, end: weekEnd } = AACal.weekRangeForTerm(term.start, se.week);
      let placedDate;
      if (se.timing === 'start') {
        placedDate = AACal.firstBusinessDayOnOrAfter(weekStart, blockedSet);
      } else if (se.timing === 'end') {
        placedDate = AACal.lastBusinessDayOnOrBefore(weekEnd, blockedSet);
      } else {
        // unspecified -> first business day of the week
        placedDate = AACal.firstBusinessDayOnOrAfter(weekStart, blockedSet);
      }
      // Safety: if business-day search overshot the week bounds (edge case of
      // an entirely closed week), clamp back to the raw week start/end.
      if (placedDate < weekStart || placedDate > AACal.addDays(weekEnd, 3)) {
        placedDate = se.timing === 'end' ? weekEnd : weekStart;
      }

      const iso = AACal.toISO(placedDate);

      events.push({
        id: se.id,
        title: se.title,
        start: iso,
        end: iso,
        owner: se.owner,
        audience: se.audience || [],
        category: se.category || 'scheduling',
        cycle: se.cycle || null,
        scheduleTerm: se.scheduleTerm,
        week: se.week,
        timing: se.timing,
        relatedTerms: se.relatedTerms || [],
        academicYear: academicCalendar.academicYear,
        source: 'scheduling-cycle',
        description: se.description || null,
        notes: se.notes || null,
        relative: { scheduleTerm: se.scheduleTerm, week: se.week, timing: se.timing }
      });
    }

    events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)));
    return events;
  }

  function filterEvents(events, filters) {
    return events.filter((e) => {
      if (filters.owners && filters.owners.size && !filters.owners.has(e.owner)) return false;
      if (filters.categories && filters.categories.size && !filters.categories.has(e.category)) return false;
      if (filters.terms && filters.terms.size) {
        const relevant = e.scheduleTerm ? [e.scheduleTerm, ...(e.relatedTerms || [])] : deriveCalendarTerm(e);
        const list = Array.isArray(relevant) ? relevant : [relevant];
        // Events with no determinable term at all (e.g. Fall Opening Day,
        // which lands before Fall's own start date, or holidays that fall
        // in the gap between two terms like Christmas/New Year's) aren't
        // "about" any term, so the term filter shouldn't apply to them —
        // only exclude events that DO have term info but none of it matches.
        const hasTermInfo = list.some((t) => t);
        if (hasTermInfo && !list.some((t) => t && filters.terms.has(t))) return false;
      }
      return true;
    });
  }

  // Best-effort: tag an absolute calendar event with a term id if its date
  // falls within a known term, purely for the term filter (not stored on the event).
  function deriveCalendarTerm(event) {
    return event._term || null;
  }

  function eventsOnDate(events, dateISO) {
    return events.filter((e) => dateISO >= e.start && dateISO <= e.end);
  }

  function eventsInRange(events, startISO, endISO) {
    return events.filter((e) => e.start <= endISO && e.end >= startISO);
  }

  function eventsForCycle(events, cycleId) {
    return events
      .filter((e) => e.cycle === cycleId)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  return {
    OWNER_LABELS, CATEGORY_LABELS, AUDIENCE_LABELS,
    loadAcademicYears, loadAcademicCalendar, loadSchedulingCycle,
    generateEvents, filterEvents, eventsOnDate, eventsInRange, eventsForCycle
  };
})();
