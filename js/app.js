/**
 * app.js
 * Wires calendar.js + events.js + storage.js to the DOM.
 * Renders five views (Today / Week / Month / Year / Scheduling Cycle),
 * a filter panel, and an event-detail modal.
 */

(function () {
  'use strict';

  const TERM_ORDER = ['fall', 'intersession', 'spring', 'summer'];
  const TERM_LABELS = { fall: 'Fall', intersession: 'Intersession', spring: 'Spring', summer: 'Summer' };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const state = {
    years: [],
    currentYearId: null,
    calendar: null,
    schedulingCycle: null,
    events: [],
    filters: null, // { owners:Set, categories:Set, terms:Set }
    view: 'today',
    weekAnchor: null,  // Date, any day within the shown week
    monthAnchor: null, // Date, first-of-month
    today: AACal.stripTime(new Date()),
    lastFocused: null,
    navigating: false // guards against overlapping async year-flip loads
  };

  const el = {
    yearSelect: document.getElementById('year-select'),
    filtersToggle: document.getElementById('filters-toggle'),
    filtersCount: document.getElementById('filters-count'),
    filtersPanel: document.getElementById('filters-panel'),
    filtersCollapse: document.getElementById('filters-collapse'),
    ownerFilters: document.getElementById('owner-filters'),
    categoryFilters: document.getElementById('category-filters'),
    termFilters: document.getElementById('term-filters'), // null while term filter UI is disabled
    filtersReset: document.getElementById('filters-reset'),
    viewTabs: document.getElementById('view-tabs'),
    viewRoot: document.getElementById('view-root'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalClose: document.getElementById('modal-close')
  };

  // ------------------------------------------------------------------
  // Icons — shape encodes owner, independent of color, for colorblind users
  // ------------------------------------------------------------------

  function ownerIcon(owner, size) {
    size = size || 12;
    const common = `width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"`;
    if (owner === 'academic-calendar') {
      return `<svg ${common}><circle cx="8" cy="8" r="6.5" fill="currentColor"/></svg>`;
    }
    if (owner === 'academic-affairs') {
      return `<svg ${common}><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" transform="rotate(45 8 8)" fill="currentColor"/></svg>`;
    }
    if (owner === 'academic-divisions') {
      return `<svg ${common}><polygon points="8,1.5 14.5,13.5 1.5,13.5" fill="currentColor"/></svg>`;
    }
    return `<svg ${common}><rect x="2" y="2" width="12" height="12" fill="currentColor"/></svg>`;
  }

  const STAR_POINTS = '8,0.8 10.1,5.5 15.2,6.1 11.4,9.6 12.4,14.7 8,12.1 3.6,14.7 4.6,9.6 0.8,6.1 5.9,5.5';

  function holidayIcon(size) {
    size = size || 13;
    return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><polygon points="${STAR_POINTS}" fill="currentColor"/></svg>`;
  }

  function ownerClass(owner) {
    return `owner-${owner || 'other'}`;
  }

  function isHoliday(e) {
    return e.category === 'holiday';
  }

  // ------------------------------------------------------------------
  // Formatting helpers
  // ------------------------------------------------------------------

  function fmtLong(iso) {
    const d = AACal.parseDate(iso);
    return `${DOW_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function fmtMed(iso) {
    const d = AACal.parseDate(iso);
    return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function fmtRange(startISO, endISO) {
    if (startISO === endISO) return fmtLong(startISO);
    const s = AACal.parseDate(startISO), e = AACal.parseDate(endISO);
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return `${MONTHS[s.getMonth()]} ${s.getDate()}\u2013${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${fmtMed(startISO)} \u2013 ${fmtMed(endISO)}`;
  }

  function ownerLabel(o) { return AAEvents.OWNER_LABELS[o] || o; }
  function categoryLabel(c) { return AAEvents.CATEGORY_LABELS[c] || c; }
  function audienceLabel(a) { return AAEvents.AUDIENCE_LABELS[a] || a; }

  function getSelectedYearBounds() {
    const y = state.years.find(yy => yy.id === state.currentYearId);
    return { y, start: AACal.parseDate(y.start), end: AACal.parseDate(y.end) };
  }

  /** The actual date range covered by the currently loaded calendar file's
   * events (earliest event start through latest event end). Used to bound
   * Week/Month "Previous"/"Next" navigation, because a calendar file's real
   * coverage (roughly mid-Aug \u2013 early Aug, per its own terms) doesn't line
   * up with the generic July\u2013June window declared in academic-years.json.
   * That declared window is left alone and still used for "which year
   * contains today" (see getSelectedYearBounds) \u2014 this is only for nav. */
  function getLoadedCalendarBounds() {
    let min = null, max = null;
    for (const e of state.events) {
      const s = AACal.parseDate(e.start);
      const en = AACal.parseDate(e.end || e.start);
      if (!min || s < min) min = s;
      if (!max || en > max) max = en;
    }
    if (!min || !max) {
      const b = getSelectedYearBounds();
      return { start: b.start, end: b.end };
    }
    return { start: min, end: max };
  }

  /** The academic year adjacent to the current one in the dropdown's list
   * order (direction -1 = previous, +1 = next), or null if there isn't one
   * \u2014 i.e. no calendar file is loaded for that direction. */
  function getAdjacentYear(direction) {
    const idx = state.years.findIndex((y) => y.id === state.currentYearId);
    if (idx === -1) return null;
    return state.years[idx + direction] || null;
  }

  /** Load a different year's calendar data mid-navigation (clicking past
   * the edge of the currently loaded file's coverage) and land on a
   * specific month or week, rather than resetting to the new year's start
   * the way switchToYear (triggered by the dropdown) does. Clamps to the
   * nearest edge of the newly loaded data if the target date somehow isn't
   * covered by it, so navigation never lands somewhere with nothing loaded. */
  async function switchToYearAndAnchor(yearId, targetDate, anchorKind) {
    if (state.navigating) return;
    state.navigating = true;
    try {
      state.currentYearId = yearId;
      el.yearSelect.value = yearId;
      persistPrefs();
      await loadYearData(yearId);
      const bounds = getLoadedCalendarBounds();
      let clamped = targetDate;
      if (clamped < bounds.start) clamped = bounds.start;
      if (clamped > bounds.end) clamped = bounds.end;
      if (anchorKind === 'week') {
        state.weekAnchor = new Date(clamped);
      } else {
        state.monthAnchor = new Date(clamped.getFullYear(), clamped.getMonth(), 1);
      }
      render();
    } finally {
      state.navigating = false;
    }
  }

  /** Step the Month view by one month, flipping to the adjacent year's
   * calendar file (and updating the dropdown) if the step would move past
   * the edge of what's currently loaded and another year's data covers it. */
  async function stepMonth(delta) {
    if (state.navigating) return;
    const anchor = state.monthAnchor;
    const target = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
    const bounds = getLoadedCalendarBounds();
    const earliestMonth = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), 1);
    const latestMonth = new Date(bounds.end.getFullYear(), bounds.end.getMonth(), 1);

    if (target < earliestMonth) {
      const prevYear = getAdjacentYear(-1);
      if (!prevYear) return;
      await switchToYearAndAnchor(prevYear.id, target, 'month');
      return;
    }
    if (target > latestMonth) {
      const nextYear = getAdjacentYear(1);
      if (!nextYear) return;
      await switchToYearAndAnchor(nextYear.id, target, 'month');
      return;
    }
    state.monthAnchor = target;
    render();
  }

  /** Step the Week view by one week (7 days), flipping to the adjacent
   * year's calendar file the same way stepMonth does. */
  async function stepWeek(deltaDays) {
    if (state.navigating) return;
    const anchor = state.weekAnchor;
    const weekStart = AACal.addDays(anchor, -anchor.getDay());
    const targetStart = AACal.addDays(weekStart, deltaDays);
    const bounds = getLoadedCalendarBounds();

    if (targetStart < bounds.start) {
      const prevYear = getAdjacentYear(-1);
      if (!prevYear) return;
      await switchToYearAndAnchor(prevYear.id, targetStart, 'week');
      return;
    }
    const targetEnd = AACal.addDays(targetStart, 6);
    if (targetEnd > bounds.end) {
      const nextYear = getAdjacentYear(1);
      if (!nextYear) return;
      await switchToYearAndAnchor(nextYear.id, targetStart, 'week');
      return;
    }
    state.weekAnchor = targetStart;
    render();
  }

  /** Switch academic year, reload its data, and (by default) jump the
   * Week/Month anchors to the start of that year so the person isn't left
   * looking at a month that belongs to a different academic year. */
  async function switchToYear(yearId) {
    state.currentYearId = yearId;
    el.yearSelect.value = yearId;
    persistPrefs();
    await loadYearData(yearId);
    const { start } = getSelectedYearBounds();
    state.weekAnchor = new Date(start);
    state.monthAnchor = new Date(start.getFullYear(), start.getMonth(), 1);
    render();
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  async function init() {
    const prefs = AAStorage.load();
    try {
      state.years = await AAEvents.loadAcademicYears();
    } catch (err) {
      renderFatalError(err);
      return;
    }

    populateYearSelect();

    // Always resolve to the academic year containing today, regardless of
    // any year a person previously switched to. A fresh visit — including a
    // plain reload — should start from "today," not wherever the dropdown
    // happened to be left. Mid-session switching (see switchToYear) is
    // still fully supported; it just doesn't leak into the next visit.
    const containingToday = AACal.findAcademicYear(state.years, state.today);
    state.currentYearId = containingToday ? containingToday.id : state.years[state.years.length - 1].id;

    el.yearSelect.value = state.currentYearId;

    state.filters = {
      owners: new Set(prefs.visibleOwners && prefs.visibleOwners.length ? prefs.visibleOwners : Object.keys(AAEvents.OWNER_LABELS)),
      categories: (() => {
        const cleaned = (prefs.visibleCategories || []).filter(c => Object.prototype.hasOwnProperty.call(AAEvents.CATEGORY_LABELS, c));
        return new Set(cleaned.length ? cleaned : Object.keys(AAEvents.CATEGORY_LABELS));
      })(),
      terms: new Set(TERM_ORDER) // term filtering UI is currently disabled — always show all terms
    };

    state.view = ['today', 'week', 'month', 'year', 'cycle'].includes(prefs.defaultView) ? prefs.defaultView : 'today';
    setActiveTab(state.view);

    // Anchor Week/Month on today whenever today falls within the resolved
    // year; otherwise fall back to the start of that year (mirrors the
    // fallback used when explicitly switching years).
    if (containingToday) {
      state.weekAnchor = new Date(state.today);
      state.monthAnchor = new Date(state.today.getFullYear(), state.today.getMonth(), 1);
    } else {
      const fallbackStart = AACal.parseDate(state.years[state.years.length - 1].start);
      state.weekAnchor = new Date(fallbackStart);
      state.monthAnchor = new Date(fallbackStart.getFullYear(), fallbackStart.getMonth(), 1);
    }

    // On narrow screens, start with the filter panel collapsed so the
    // person sees the view content first rather than a long checkbox list.
    if (window.matchMedia('(max-width: 900px)').matches) {
      el.filtersPanel.setAttribute('hidden', '');
      el.filtersToggle.setAttribute('aria-expanded', 'false');
    }
    syncFiltersToggleLabel();

    await loadYearData(state.currentYearId);
    buildFilterUI();
    render();

    bindGlobalEvents();
  }

  async function loadYearData(yearId) {
    el.viewRoot.innerHTML = '<div class="loading-state">Loading calendar data\u2026</div>';
    const yearMeta = state.years.find(y => y.id === yearId);
    try {
      const [calendar, cycle] = await Promise.all([
        AAEvents.loadAcademicCalendar(yearMeta.calendarFile),
        AAEvents.loadSchedulingCycle()
      ]);
      state.calendar = calendar;
      state.schedulingCycle = cycle;
      state.events = AAEvents.generateEvents(calendar, cycle);
      annotateCalendarEventTerms();
    } catch (err) {
      renderFatalError(err);
    }
  }

  // Tag absolute academic-calendar events with the term they fall within,
  // purely so the Term filter can include/exclude them. Never used for
  // owner/category inference — those stay explicit in the source JSON.
  function annotateCalendarEventTerms() {
    for (const e of state.events) {
      if (e.source !== 'academic-calendar') continue;
      const term = AACal.findCurrentTerm(state.calendar.terms, AACal.parseDate(e.start));
      e._term = term ? term.id : null;
    }
  }

  function populateYearSelect() {
    el.yearSelect.innerHTML = state.years.map(y => `<option value="${y.id}">${y.label}</option>`).join('');
  }

  function renderFatalError(err) {
    console.error(err);
    el.viewRoot.innerHTML = `<div class="error-state"><strong>Couldn\u2019t load calendar data.</strong><br>${escapeHTML(err.message || String(err))}</div>`;
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  function buildFilterUI() {
    el.ownerFilters.innerHTML = Object.entries(AAEvents.OWNER_LABELS).map(([id, label]) => filterRow('owner', id, label)).join('');
    el.categoryFilters.innerHTML = Object.keys(AAEvents.CATEGORY_LABELS)
      .map(id => filterRow('category', id, categoryLabel(id))).join('');

    // Term filter UI is disabled for now (see index.html) — el.termFilters
    // may be null since its markup is commented out. Guard defensively so
    // re-enabling it later is a one-line change.
    if (el.termFilters) {
      el.termFilters.innerHTML = TERM_ORDER.map(id => filterRow('term', id, TERM_LABELS[id])).join('');
    }

    el.filtersPanel.addEventListener('change', onFilterChange);
    updateFilterChecks();
    updateFiltersCount();
  }

  function filterRow(group, id, label) {
    return `<label class="filter-row"><input type="checkbox" data-group="${group}" value="${id}"> ${escapeHTML(label)}</label>`;
  }

  function updateFilterChecks() {
    el.filtersPanel.querySelectorAll('input[data-group="owner"]').forEach(cb => cb.checked = state.filters.owners.has(cb.value));
    el.filtersPanel.querySelectorAll('input[data-group="category"]').forEach(cb => cb.checked = state.filters.categories.has(cb.value));
    // Term checkboxes don't exist while the term filter UI is disabled; the
    // querySelectorAll below simply matches nothing and is a no-op.
    el.filtersPanel.querySelectorAll('input[data-group="term"]').forEach(cb => cb.checked = state.filters.terms.has(cb.value));
  }

  function onFilterChange(evt) {
    const t = evt.target;
    if (!t.matches('input[type="checkbox"]')) return;
    const group = t.dataset.group;
    const set = group === 'owner' ? state.filters.owners : group === 'category' ? state.filters.categories : state.filters.terms;
    if (t.checked) set.add(t.value); else set.delete(t.value);
    persistPrefs();
    updateFiltersCount();
    render();
  }

  function updateFiltersCount() {
    const totalPossible = Object.keys(AAEvents.OWNER_LABELS).length + Object.keys(AAEvents.CATEGORY_LABELS).length;
    const active = state.filters.owners.size + state.filters.categories.size;
    if (active >= totalPossible) {
      el.filtersCount.hidden = true;
    } else {
      el.filtersCount.hidden = false;
      el.filtersCount.textContent = active;
    }
  }

  function persistPrefs() {
    // Note: the selected academic year is intentionally NOT persisted here.
    // Every fresh visit should resolve to "today's" year (see init()); only
    // view/filter preferences carry over between visits.
    AAStorage.save({
      defaultView: state.view,
      visibleOwners: Array.from(state.filters.owners),
      visibleCategories: Array.from(state.filters.categories),
      visibleTerms: Array.from(state.filters.terms)
    });
  }

  function getFilteredEvents() {
    return AAEvents.filterEvents(state.events, state.filters);
  }

  // ------------------------------------------------------------------
  // Global event bindings
  // ------------------------------------------------------------------

  function bindGlobalEvents() {
    el.yearSelect.addEventListener('change', () => {
      switchToYear(el.yearSelect.value);
    });

    el.filtersToggle.addEventListener('click', () => {
      const willShow = el.filtersPanel.hasAttribute('hidden');
      if (willShow) el.filtersPanel.removeAttribute('hidden'); else el.filtersPanel.setAttribute('hidden', '');
      el.filtersToggle.setAttribute('aria-expanded', String(willShow));
      syncFiltersToggleLabel();
    });

    el.filtersReset.addEventListener('click', () => {
      state.filters.owners = new Set(Object.keys(AAEvents.OWNER_LABELS));
      state.filters.categories = new Set(Object.keys(AAEvents.CATEGORY_LABELS));
      state.filters.terms = new Set(TERM_ORDER);
      updateFilterChecks();
      updateFiltersCount();
      persistPrefs();
      render();
    });

    el.viewTabs.addEventListener('click', (evt) => {
      const btn = evt.target.closest('.nav-tab');
      if (!btn) return;
      setActiveTab(btn.dataset.view);
      state.view = btn.dataset.view;
      persistPrefs();
      render();
    });

    el.filtersCollapse.addEventListener('click', () => {
      el.filtersPanel.setAttribute('hidden', '');
      el.filtersToggle.setAttribute('aria-expanded', 'false');
      syncFiltersToggleLabel();
      el.filtersToggle.focus();
    });

    el.modalClose.addEventListener('click', closeModal);
    el.modalBackdrop.addEventListener('click', (evt) => {
      if (evt.target === el.modalBackdrop) closeModal();
    });
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape' && !el.modalBackdrop.hidden) closeModal();
    });
    el.modal.addEventListener('keydown', trapFocus);
  }

  function setActiveTab(view) {
    el.viewTabs.querySelectorAll('.nav-tab').forEach(btn => {
      btn.setAttribute('aria-selected', String(btn.dataset.view === view));
    });
  }

  function syncFiltersToggleLabel() {
    const expanded = el.filtersToggle.getAttribute('aria-expanded') === 'true';
    el.filtersToggle.childNodes[0].textContent = expanded ? 'Hide filters ' : 'Show filters ';
  }

  // ------------------------------------------------------------------
  // Render dispatcher
  // ------------------------------------------------------------------

  function render() {
    const events = getFilteredEvents();
    if (state.view === 'today') renderToday(events);
    else if (state.view === 'week') renderWeek(events);
    else if (state.view === 'month') renderMonth(events);
    else if (state.view === 'year') renderYear(events);
    else if (state.view === 'cycle') renderCycle(events);
    el.viewRoot.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------
  // TODAY view
  // ------------------------------------------------------------------

  function renderToday(events) {
    const today = state.today;
    const todayISO = AACal.toISO(today);
    const { y, start: yStart, end: yEnd } = getSelectedYearBounds();
    const todayInSelectedYear = AACal.dateInRange(today, y.start, y.end);

    if (!todayInSelectedYear) {
      renderTodayOutOfRange(y);
      return;
    }

    const term = AACal.findCurrentTerm(state.calendar.terms, today);
    const week = term ? AACal.weekNumberForDate(term.start, today) : null;

    const todaysEvents = AAEvents.eventsOnDate(events, todayISO);
    const weekStart = AACal.addDays(today, -today.getDay());
    const weekEnd = AACal.addDays(weekStart, 6);
    const weekEvents = AAEvents.eventsInRange(events, AACal.toISO(weekStart), AACal.toISO(weekEnd))
      .filter(e => e.start !== todayISO);

    const positionLine = term
      ? `<strong>${escapeHTML(term.name)}</strong> &middot; <strong>Week ${week}</strong>`
      : `<strong>Between terms</strong>`;

    el.viewRoot.innerHTML = `
      <div class="today-hero">
        <div class="today-date">${DOW_LONG[today.getDay()]}, ${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}</div>
        <div class="today-position">${positionLine}</div>
        ${renderMiniRibbon(today, y)}
      </div>
      <div class="view-heading">
        <h1>What's happening now</h1>
        <span class="subtitle">Today's items, plus the rest of this week</span>
      </div>
      <div class="today-columns">
        ${['academic-calendar', 'academic-affairs', 'academic-divisions'].map(owner => ownerColumn(owner, todaysEvents, weekEvents)).join('')}
      </div>
    `;
    bindEventRowClicks(events);
  }

  function renderTodayOutOfRange(y) {
    const today = state.today;
    const otherYear = state.years.find(other => other.id !== y.id && AACal.dateInRange(today, other.start, other.end));
    el.viewRoot.innerHTML = `
      <div class="today-hero">
        <div class="today-date">${DOW_LONG[today.getDay()]}, ${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}</div>
        <div class="today-position">Outside the ${escapeHTML(y.label)} academic year</div>
      </div>
      <div class="view-heading">
        <h1>What's happening now</h1>
        <span class="subtitle">You're viewing ${escapeHTML(y.label)}, which doesn't include today's date.</span>
      </div>
      ${otherYear ? `
        <div class="cycle-intro">
          Today falls within <strong>${escapeHTML(otherYear.label)}</strong>.
          <button type="button" class="filters-collapse-btn" id="jump-to-current-year" style="margin-left:8px;">Switch to ${escapeHTML(otherYear.label)}</button>
        </div>
      ` : ''}
    `;
    const jumpBtn = document.getElementById('jump-to-current-year');
    if (jumpBtn) jumpBtn.addEventListener('click', () => switchToYear(otherYear.id));
  }

  function ownerColumn(owner, todaysEvents, weekEvents) {
    const todayList = todaysEvents.filter(e => e.owner === owner);
    const weekList = weekEvents.filter(e => e.owner === owner);
    const hasAny = todayList.length || weekList.length;
    return `
      <div class="owner-column">
        <div class="owner-column-head ${owner}">
          <span class="owner-glyph">${ownerIcon(owner, 13)}</span> ${escapeHTML(ownerLabel(owner))}
        </div>
        <div class="owner-column-body">
          ${!hasAny ? `<div class="owner-column-empty">Nothing today or later this week.</div>` : ''}
          ${todayList.map(e => eventRow(e, { showDate: false, tag: 'Today' })).join('')}
          ${weekList.map(e => eventRow(e, { showDate: true })).join('')}
        </div>
      </div>
    `;
  }

  function renderMiniRibbon(today, y) {
    const yStart = AACal.parseDate(y.start), yEnd = AACal.parseDate(y.end);
    const total = AACal.daysBetween(yStart, yEnd) || 1;
    const segs = buildTermSegments(yStart, yEnd, total);
    const todayPct = clampPct(AACal.daysBetween(yStart, today) / total * 100);
    return `
      <div class="ribbon-mini" aria-hidden="true">
        ${segs.map(s => `<div class="seg ${s.cls}" style="width:${s.widthPct}%"><span>${s.label}</span></div>`).join('')}
        <div class="today-pin" style="left:${todayPct}%"></div>
      </div>
    `;
  }

  /** Jump the Week or Month view straight to today's actual date,
   * regardless of which academic year is currently selected \u2014 loading the
   * correct year's data first (and updating the dropdown) if needed, the
   * same way the Month/Week click-through flip does. If no loaded year's
   * calendar contains today at all, there's nothing to jump to; callers
   * should disable the button in that case (see getTodayYear). */
  async function jumpToToday(anchorKind) {
    const todayYear = getTodayYear();
    if (!todayYear) return;
    if (todayYear.id === state.currentYearId) {
      if (anchorKind === 'week') state.weekAnchor = new Date(state.today);
      else state.monthAnchor = new Date(state.today.getFullYear(), state.today.getMonth(), 1);
      render();
    } else {
      await switchToYearAndAnchor(todayYear.id, state.today, anchorKind);
    }
  }

  /** Which loaded academic year (if any) today's date falls within, per
   * academic-years.json's declared July\u2013June windows \u2014 used only to
   * decide whether a Today button has anywhere to jump to. */
  function getTodayYear() {
    return AACal.findAcademicYear(state.years, state.today);
  }

  // ------------------------------------------------------------------
  // WEEK view
  // ------------------------------------------------------------------

  function renderWeek(events) {
    const anchor = state.weekAnchor;
    const weekStart = AACal.addDays(anchor, -anchor.getDay());
    const days = Array.from({ length: 7 }, (_, i) => AACal.addDays(weekStart, i));
    const weekEnd = days[6];

    const bounds = getLoadedCalendarBounds();
    const disablePrev = weekStart <= bounds.start && !getAdjacentYear(-1);
    const disableNext = weekEnd >= bounds.end && !getAdjacentYear(1);

    const todayYear = getTodayYear();

    el.viewRoot.innerHTML = `
      <div class="view-heading">
        <h1>Week of ${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}</h1>
        <span class="subtitle">${fmtRange(AACal.toISO(weekStart), AACal.toISO(weekEnd))}</span>
      </div>
      <div class="week-nav">
        <button class="step" id="week-prev" type="button" ${disablePrev ? 'disabled' : ''}>\u2190 Previous week</button>
        <button class="step" id="week-today" type="button" ${todayYear ? '' : 'disabled title="No calendar data loaded for today\u2019s date"'}>Today</button>
        <button class="step" id="week-next" type="button" ${disableNext ? 'disabled' : ''}>Next week \u2192</button>
      </div>
      <div class="week-grid">
        ${days.map(d => weekDayBlock(d, events)).join('')}
      </div>
    `;

    if (!disablePrev) document.getElementById('week-prev').addEventListener('click', () => stepWeek(-7));
    if (!disableNext) document.getElementById('week-next').addEventListener('click', () => stepWeek(7));
    if (todayYear) document.getElementById('week-today').addEventListener('click', () => jumpToToday('week'));
    bindEventRowClicks(events);
  }

  function weekDayBlock(date, events) {
    const iso = AACal.toISO(date);
    const isToday = AACal.sameDate(date, state.today);
    const dayEvents = AAEvents.eventsOnDate(events, iso);
    return `
      <div class="week-day ${isToday ? 'is-today' : ''}">
        <div class="week-day-head">
          ${DOW_LONG[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}
          ${isToday ? '<span class="today-flag">TODAY</span>' : ''}
        </div>
        <div>
          ${dayEvents.length ? dayEvents.map(e => eventRow(e, { showDate: false })).join('') : '<div class="owner-column-empty">Nothing scheduled.</div>'}
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // MONTH view
  // ------------------------------------------------------------------

  function renderMonth(events) {
    const anchor = state.monthAnchor;
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const gridStart = AACal.addDays(firstOfMonth, -firstOfMonth.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => AACal.addDays(gridStart, i));

    const bounds = getLoadedCalendarBounds();
    const earliestMonth = new Date(bounds.start.getFullYear(), bounds.start.getMonth(), 1);
    const latestMonth = new Date(bounds.end.getFullYear(), bounds.end.getMonth(), 1);
    const disablePrev = anchor.getTime() <= earliestMonth.getTime() && !getAdjacentYear(-1);
    const disableNext = anchor.getTime() >= latestMonth.getTime() && !getAdjacentYear(1);

    const todayYear = getTodayYear();

    el.viewRoot.innerHTML = `
      <div class="view-heading">
        <h1>${MONTHS[m]} ${y}</h1>
        <span class="subtitle">Click any item for details</span>
      </div>
      <div class="month-nav">
        <button class="step" id="month-prev" type="button" ${disablePrev ? 'disabled' : ''}>\u2190 Previous month</button>
        <button class="step" id="month-today" type="button" ${todayYear ? '' : 'disabled title="No calendar data loaded for today\u2019s date"'}>Today</button>
        <button class="step" id="month-next" type="button" ${disableNext ? 'disabled' : ''}>Next month \u2192</button>
      </div>
      <div class="month-grid">
        ${DOW.map(d => `<div class="month-dow">${d}</div>`).join('')}
        ${cells.map(d => monthCell(d, m, events)).join('')}
      </div>
    `;

    if (!disablePrev) document.getElementById('month-prev').addEventListener('click', () => stepMonth(-1));
    if (!disableNext) document.getElementById('month-next').addEventListener('click', () => stepMonth(1));
    if (todayYear) document.getElementById('month-today').addEventListener('click', () => jumpToToday('month'));
    bindEventRowClicks(events);
    bindMonthOverflowToggle();
  }

  function monthCell(date, currentMonth, events) {
    const iso = AACal.toISO(date);
    const outside = date.getMonth() !== currentMonth;
    const isToday = AACal.sameDate(date, state.today);
    const dayEvents = AAEvents.eventsOnDate(events, iso);
    const MAX_SHOWN = 3;
    const shown = dayEvents.slice(0, MAX_SHOWN);
    const overflow = dayEvents.length - shown.length;
    return `
      <div class="month-cell ${outside ? 'outside' : ''} ${isToday ? 'is-today' : ''}">
        <span class="cell-date">${date.getDate()}</span>
        ${shown.map(e => monthPill(e)).join('')}
        ${overflow > 0 ? `<button class="month-more" data-more-date="${iso}" type="button">+${overflow} more</button>` : ''}
      </div>
    `;
  }

  function monthPill(e) {
    const holiday = isHoliday(e);
    if (holiday) {
      return `<button class="month-pill is-holiday" data-event-id="${escapeAttr(e.id)}" title="${escapeAttr(e.title)}"><span class="holiday-star">${holidayIcon(10)}</span><span class="label">${escapeHTML(e.title)}</span></button>`;
    }
    return `<button class="month-pill" data-event-id="${escapeAttr(e.id)}" title="${escapeAttr(e.title)}"><span class="swatch" style="background:${ownerSwatch(e.owner)}"></span><span class="label">${escapeHTML(e.title)}</span></button>`;
  }

  function bindMonthOverflowToggle() {
    el.viewRoot.querySelectorAll('.month-more').forEach(btn => {
      btn.addEventListener('click', () => {
        const iso = btn.dataset.moreDate;
        const events = AAEvents.eventsOnDate(getFilteredEvents(), iso);
        openDayList(iso, events);
      });
    });
  }

  function openDayList(iso, events) {
    openModalShell(fmtLong(iso));
    el.modalBody.innerHTML = events.map(e => eventRow(e, { showDate: false })).join('');
    bindEventRowClicks(events, el.modalBody);
  }

  // ------------------------------------------------------------------
  // YEAR (annual timeline) view — signature element
  // ------------------------------------------------------------------

  function buildTermSegments(yStart, yEnd, total) {
    const terms = state.calendar.terms;
    const segs = [];
    let cursor = yStart;
    for (const t of terms) {
      const tStart = AACal.parseDate(t.start), tEnd = AACal.parseDate(t.end);
      if (tStart > cursor) {
        segs.push({ cls: 'gap', label: '', widthPct: AACal.daysBetween(cursor, tStart) / total * 100 });
      }
      segs.push({ cls: t.id, label: TERM_LABELS[t.id] || t.name, widthPct: (AACal.daysBetween(tStart, tEnd) + 1) / total * 100 });
      cursor = AACal.addDays(tEnd, 1);
    }
    if (cursor < yEnd) {
      segs.push({ cls: 'gap', label: '', widthPct: AACal.daysBetween(cursor, yEnd) / total * 100 });
    }
    return segs;
  }

  // True only for events that mark a term's literal start or end date
  // (e.g. "Fall Semester Start"/"Fall Semester End"), determined by matching
  // against state.calendar.terms rather than by id or category, so it stays
  // correct even if term ids or event ids change.
  function isTermBoundaryEvent(e) {
    if (e.category !== 'term' || e.start !== e.end) return false;
    return state.calendar.terms.some((t) => t.start === e.start || t.end === e.start);
  }

  function renderYear(events) {
    const y = state.years.find(y => y.id === state.currentYearId);
    const yStart = AACal.parseDate(y.start), yEnd = AACal.parseDate(y.end);
    const total = AACal.daysBetween(yStart, yEnd) || 1;
    const segs = buildTermSegments(yStart, yEnd, total);

    const todayInRange = AACal.dateInRange(state.today, y.start, y.end);
    const todayPct = todayInRange ? clampPct(AACal.daysBetween(yStart, state.today) / total * 100) : null;

    // Ticks: every event except the literal term start/end boundary markers
    // (those are already represented by the ribbon segments themselves).
    // Matched by date against state.calendar.terms rather than by category,
    // since other single-day milestones (e.g. Fall Opening Day) also carry
    // category "term" but aren't boundary markers and should still get a tick.
    const tickEvents = events.filter(e => !isTermBoundaryEvent(e));

    el.viewRoot.innerHTML = `
      <div class="view-heading">
        <h1>${escapeHTML(y.label)} at a glance</h1>
        <span class="subtitle">July through June &middot; hover or select a marker for details</span>
      </div>
      <div class="year-ribbon-wrap">
        <div class="year-ribbon">
          ${segs.map(s => `<div class="term-block ${s.cls}" style="width:${s.widthPct}%">${s.label ? `<span>${s.label}</span>` : ''}</div>`).join('')}
          ${todayPct !== null ? `<div class="today-marker" style="left:${todayPct}%"></div>` : ''}
        </div>
        <div class="ribbon-ticks">
          ${tickEvents.map(e => {
            const mid = midDateISO(e);
            const pct = clampPct(AACal.daysBetween(yStart, AACal.parseDate(mid)) / total * 100);
            const holiday = isHoliday(e);
            return `<button class="ribbon-tick ${holiday ? 'is-holiday' : ''}" style="left:${pct}%;${holiday ? '' : `background:${ownerSwatch(e.owner)}`}" data-event-id="${escapeAttr(e.id)}" aria-label="${escapeAttr(e.title)}, ${escapeAttr(fmtMed(e.start))}"></button>`;
          }).join('')}
        </div>
        <div class="ribbon-legend">
          <span class="legend-item"><span class="swatch" style="background:var(--carmine-600)"></span>Academic Calendar</span>
          <span class="legend-item"><span class="swatch" style="background:var(--purple-700)"></span>Academic Affairs</span>
          <span class="legend-item"><span class="swatch" style="background:var(--gold-500)"></span>Academic Divisions</span>
          <span class="legend-item"><span class="holiday-star" style="color:var(--gold-500)">${holidayIcon(13)}</span>Holiday</span>
        </div>
      </div>
      <div class="view-heading"><h2>All events, ${escapeHTML(y.label)}</h2></div>
      <div class="owner-column">
        <div class="owner-column-body">
          ${events.map(e => eventRow(e, { showDate: true, showMonth: true })).join('') || '<div class="owner-column-empty">No events match the current filters.</div>'}
        </div>
      </div>
    `;

    el.viewRoot.querySelectorAll('.ribbon-tick').forEach(btn => {
      btn.addEventListener('click', () => openEventDetail(btn.dataset.eventId, events));
    });
    bindEventRowClicks(events);
  }

  function midDateISO(e) {
    if (e.start === e.end) return e.start;
    const s = AACal.parseDate(e.start), en = AACal.parseDate(e.end);
    return AACal.toISO(AACal.addDays(s, Math.floor(AACal.daysBetween(s, en) / 2)));
  }

  // ------------------------------------------------------------------
  // SCHEDULING CYCLE view
  // ------------------------------------------------------------------

  function renderCycle(events) {
    const cycleEvents = AAEvents.eventsForCycle(events, 'scheduling-cycle');
    const byTerm = {};
    for (const t of TERM_ORDER) byTerm[t] = [];
    for (const e of cycleEvents) {
      if (byTerm[e.scheduleTerm]) byTerm[e.scheduleTerm].push(e);
    }

    const cycleMeta = (state.schedulingCycle.cycles || []).find(c => c.id === 'scheduling-cycle');

    el.viewRoot.innerHTML = `
      <div class="view-heading">
        <h1>Scheduling Cycle</h1>
        <span class="subtitle">Term-relative process, resolved to ${escapeHTML(state.years.find(y => y.id === state.currentYearId).label)} dates</span>
      </div>
      <div class="cycle-intro">${escapeHTML((cycleMeta && cycleMeta.description) || 'The recurring process of building, staffing, and publishing each term\u2019s schedule.')}</div>
      <div class="cycle-columns">
        ${TERM_ORDER.map(t => cycleColumn(t, byTerm[t])).join('')}
      </div>
    `;
    bindEventRowClicks(events, el.viewRoot, '.cycle-step');
  }

  function cycleColumn(termId, items) {
    return `
      <div class="cycle-column">
        <div class="cycle-column-head ${termId}">${TERM_LABELS[termId]}</div>
        <div>
          ${items.length ? items.map(e => `
            <button class="cycle-step" data-event-id="${escapeAttr(e.id)}" type="button">
              <div class="step-week">Week ${e.week} \u00b7 ${fmtMed(e.start)}</div>
              <div class="step-title">${escapeHTML(e.title)}</div>
            </button>
          `).join('') : '<div class="owner-column-empty">No scheduling milestones this term.</div>'}
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Shared event row renderer
  // ------------------------------------------------------------------

  function eventRow(e, opts) {
    opts = opts || {};
    const d = AACal.parseDate(e.start);
    const holiday = isHoliday(e);
    return `
      <button class="event-row ${holiday ? 'is-holiday' : ''}" data-event-id="${escapeAttr(e.id)}" type="button">
        ${opts.showDate !== false ? `
          <span class="event-date-col">
            <span class="dow">${DOW[d.getDay()]}</span>
            <span class="dom">${d.getDate()}</span>
            ${opts.showMonth ? `<span class="moy">${MONTHS[d.getMonth()].slice(0, 3)}</span>` : ''}
          </span>` : ''}
        <span class="event-main">
          <span class="event-title">${holiday ? `<span class="holiday-star">${holidayIcon(12)}</span>` : ''}${escapeHTML(e.title)}</span>
          <span class="event-meta">
            <span class="chip chip--${ownerClass(e.owner)}"><span class="owner-glyph">${ownerIcon(e.owner, 9)}</span>${escapeHTML(ownerLabel(e.owner))}</span>
            ${holiday ? `<span class="chip chip--holiday">Holiday</span>` : ''}
            ${e.week ? `<span class="week-badge">Wk ${e.week}${e.timing && e.timing !== 'unspecified' ? ' \u00b7 ' + e.timing : ''}</span>` : ''}
            ${opts.tag ? `<span class="week-badge">${escapeHTML(opts.tag)}</span>` : ''}
          </span>
        </span>
      </button>
    `;
  }

  function bindEventRowClicks(events, root, selector) {
    (root || el.viewRoot).querySelectorAll(selector || '.event-row, .month-pill').forEach(node => {
      node.addEventListener('click', () => openEventDetail(node.dataset.eventId, events));
    });
  }

  // ------------------------------------------------------------------
  // Event detail modal
  // ------------------------------------------------------------------

  function openModalShell(title) {
    state.lastFocused = document.activeElement;
    el.modalTitle.textContent = title;
    el.modalBackdrop.hidden = false;
    el.modalClose.focus();
  }

  function closeModal() {
    el.modalBackdrop.hidden = true;
    if (state.lastFocused && typeof state.lastFocused.focus === 'function') state.lastFocused.focus();
  }

  function trapFocus(evt) {
    if (evt.key !== 'Tab') return;
    const focusables = el.modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (evt.shiftKey && document.activeElement === first) { last.focus(); evt.preventDefault(); }
    else if (!evt.shiftKey && document.activeElement === last) { first.focus(); evt.preventDefault(); }
  }

  function openEventDetail(id, contextEvents) {
    const e = state.events.find(ev => ev.id === id);
    if (!e) return;
    state.lastFocused = document.activeElement;
    el.modalTitle.textContent = e.title;

    const relatedTermsLabel = (e.relatedTerms || []).map(t => TERM_LABELS[t] || t).join(', ');
    const audienceLabelStr = (e.audience || []).map(audienceLabel).join(', ');

    let timingLabel = '\u2014';
    if (e.scheduleTerm) {
      const t = e.timing === 'start' ? 'Beginning of week' : e.timing === 'end' ? 'End of week' : 'Placed on first business day of the week';
      timingLabel = `Week ${e.week} \u2014 ${t}`;
    }

    const provenance = e.source === 'academic-calendar'
      ? 'Official academic calendar (absolute date)'
      : `Generated from the scheduling cycle: ${TERM_LABELS[e.scheduleTerm] || e.scheduleTerm} Week ${e.week}, ${e.timing}`;

    let navHTML = '';
    if (e.cycle) {
      const cycleEvents = AAEvents.eventsForCycle(state.events, e.cycle);
      const idx = cycleEvents.findIndex(ev => ev.id === e.id);
      const prev = idx > 0 ? cycleEvents[idx - 1] : null;
      const next = idx >= 0 && idx < cycleEvents.length - 1 ? cycleEvents[idx + 1] : null;
      navHTML = `
        <div class="detail-nav">
          <button type="button" ${prev ? `data-event-id="${escapeAttr(prev.id)}"` : 'disabled'}>${prev ? `<small>\u2190 Previous</small>${escapeHTML(prev.title)}` : '<small>\u2190 Previous</small>None'}</button>
          <button type="button" ${next ? `data-event-id="${escapeAttr(next.id)}"` : 'disabled'}>${next ? `<small>Next \u2192</small>${escapeHTML(next.title)}` : '<small>Next \u2192</small>None'}</button>
        </div>
      `;
    }

    el.modalBody.innerHTML = `
      <dl class="detail-grid">
        <dt>Date</dt><dd>${escapeHTML(fmtRange(e.start, e.end))}</dd>
        ${e.description ? `<dt>Description</dt><dd>${escapeHTML(e.description)}</dd>` : ''}
        <dt>Owner</dt><dd><span class="chip chip--${ownerClass(e.owner)}"><span class="owner-glyph">${ownerIcon(e.owner, 9)}</span>${escapeHTML(ownerLabel(e.owner))}</span></dd>
        <!-- <dt>Audience</dt><dd>${escapeHTML(audienceLabelStr || ownerLabel(e.owner))}</dd> -->
        <dt>Category</dt><dd>${escapeHTML(categoryLabel(e.category))}</dd>
        ${e.scheduleTerm ? `<dt>Schedule term</dt><dd>${escapeHTML(TERM_LABELS[e.scheduleTerm] || e.scheduleTerm)}</dd>` : ''}
        ${relatedTermsLabel ? `<dt>Related term(s)</dt><dd>${escapeHTML(relatedTermsLabel)}</dd>` : ''}
        ${e.scheduleTerm ? `<dt>Relative timing</dt><dd>${escapeHTML(timingLabel)}</dd>` : ''}
        <!-- <dt>Source</dt><dd>${escapeHTML(provenance)}</dd> -->
        ${e.notes ? `<dt>Notes</dt><dd>${escapeHTML(e.notes)}</dd>` : ''}
      </dl>
      ${navHTML}
    `;

    el.modalBackdrop.hidden = false;
    el.modalClose.focus();

    el.modalBody.querySelectorAll('.detail-nav button[data-event-id]').forEach(btn => {
      btn.addEventListener('click', () => openEventDetail(btn.dataset.eventId, contextEvents));
    });
  }

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------

  function ownerSwatch(owner) {
    if (owner === 'academic-calendar') return 'var(--carmine-600)';
    if (owner === 'academic-affairs') return 'var(--purple-700)';
    if (owner === 'academic-divisions') return 'var(--gold-500)';
    return 'var(--ink-faint)';
  }

  function clampPct(n) { return Math.max(0, Math.min(100, n)); }

  function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(str) { return escapeHTML(str); }

  document.addEventListener('DOMContentLoaded', init);
})();
