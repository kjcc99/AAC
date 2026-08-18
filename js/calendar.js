/**
 * calendar.js
 * Date, term, and business-day calculation utilities.
 * No event generation lives here — only pure date math.
 */

const AACal = (function () {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  /** Parse a "YYYY-MM-DD" string as a local calendar date (no timezone drift). */
  function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(date, n) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function daysBetween(a, b) {
    return Math.round((stripTime(b) - stripTime(a)) / MS_PER_DAY);
  }

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function sameDate(a, b) {
    return stripTime(a).getTime() === stripTime(b).getTime();
  }

  function dateInRange(date, startISO, endISO) {
    const t = stripTime(date).getTime();
    return t >= parseDate(startISO).getTime() && t <= parseDate(endISO).getTime();
  }

  /**
   * Build a set of ISO date strings that are non-business days due to the
   * official academic calendar (holidays / closures marked businessDayBlocking).
   */
  function buildBlockedDateSet(calendarEvents) {
    const blocked = new Set();
    for (const ev of calendarEvents) {
      if (!ev.businessDayBlocking) continue;
      let cur = parseDate(ev.start);
      const end = parseDate(ev.end || ev.start);
      while (cur.getTime() <= end.getTime()) {
        blocked.add(toISO(cur));
        cur = addDays(cur, 1);
      }
    }
    return blocked;
  }

  function isBusinessDay(date, blockedSet) {
    if (isWeekend(date)) return false;
    if (blockedSet.has(toISO(date))) return false;
    return true;
  }

  /** First business day on/after a given date. */
  function firstBusinessDayOnOrAfter(date, blockedSet) {
    let cur = new Date(date);
    let guard = 0;
    while (!isBusinessDay(cur, blockedSet) && guard < 30) {
      cur = addDays(cur, 1);
      guard++;
    }
    return cur;
  }

  /** Last business day on/before a given date. */
  function lastBusinessDayOnOrBefore(date, blockedSet) {
    let cur = new Date(date);
    let guard = 0;
    while (!isBusinessDay(cur, blockedSet) && guard < 30) {
      cur = addDays(cur, -1);
      guard++;
    }
    return cur;
  }

  /**
   * Week 1 begins on the first calendar day of the term.
   * weekStart = termStart + (week-1)*7, weekEnd = weekStart + 6
   */
  function weekRangeForTerm(termStartISO, week) {
    const start = addDays(parseDate(termStartISO), (week - 1) * 7);
    const end = addDays(start, 6);
    return { start, end };
  }

  /** Given a term start date and today's date, compute the 1-based term week (or null if before term). */
  function weekNumberForDate(termStartISO, date) {
    const start = parseDate(termStartISO);
    const diff = daysBetween(start, date);
    if (diff < 0) return null;
    return Math.floor(diff / 7) + 1;
  }

  /** Determine which term (if any) contains a given date. Returns term object or null. */
  function findCurrentTerm(terms, date) {
    for (const term of terms) {
      if (dateInRange(date, term.start, term.end)) return term;
    }
    return null;
  }

  /** Determine the academic year containing a given date, from academic-years.json data. */
  function findAcademicYear(years, date) {
    for (const y of years) {
      if (dateInRange(date, y.start, y.end)) return y;
    }
    return null;
  }

  return {
    parseDate, toISO, addDays, daysBetween, stripTime, isWeekend, sameDate,
    dateInRange, buildBlockedDateSet, isBusinessDay,
    firstBusinessDayOnOrAfter, lastBusinessDayOnOrBefore,
    weekRangeForTerm, weekNumberForDate, findCurrentTerm, findAcademicYear
  };
})();
