/* ============================================================================
 * redesign.js — UI redesign port helpers for Scholarship Finder
 *
 * Loaded AFTER the inline <script> block in index.new.html.
 * Reads top-level identifiers declared in the inline script:
 *   - currentScholarships, currentColleges, currentFilter (let, script-scoped)
 *   - renderScholarships, renderColleges, findAll, assessColleges
 *   - escHtml, escUrl
 *
 * Exposes hooks called BY the inline script after each render:
 *   - window.redesignOnScholarshipsRendered(scholarships, opts)
 *   - window.redesignOnCollegesRendered(colleges, opts)
 *
 * All new behavior degrades gracefully — if a new selector is missing,
 * existing flows still work.
 * ========================================================================= */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  var coordsData    = null;   // loaded async from /data/college-coords.json
  var lastScholList = [];     // unfiltered set, captured from first render
  var lastColleges  = [];
  var selectedCollegeName = null;

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    // already past DOMContentLoaded
    setTimeout(boot, 0);
  }

  function boot() {
    bindHeroCtas();
    fetch('/data/college-coords.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { coordsData = j || { schools: {}, cities: {} }; })
      .catch(function () { coordsData = { schools: {}, cities: {} }; });
  }

  // ── Hero CTA wiring ───────────────────────────────────────────────────────
  function bindHeroCtas() {
    var searchBtn = document.getElementById('heroSearchBtn');
    var assessBtn = document.getElementById('heroAssessBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', function (e) {
        e.preventDefault();
        // findAll() is defined in the inline script and is the existing
        // primary action behind the big "Find Scholarships & Assess My
        // Colleges" button in the profile panel.
        if (typeof findAll === 'function') {
          try { findAll(); } catch (err) { console.warn('[redesign] findAll threw', err); }
        } else {
          var grid = document.getElementById('scholarship-grid');
          if (grid) grid.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
    if (assessBtn) {
      assessBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof assessColleges === 'function') {
          try { assessColleges(); } catch (err) { console.warn('[redesign] assessColleges threw', err); }
        }
      });
    }
  }

  // ── Hero stats ────────────────────────────────────────────────────────────
  function populateHeroStats(scholarships) {
    var countEl = document.getElementById('heroStatCount');
    var totalEl = document.getElementById('heroStatTotal');
    if (countEl) countEl.textContent = (scholarships && scholarships.length) ? scholarships.length.toLocaleString() : '0';

    if (!totalEl) return;
    if (!scholarships || !scholarships.length) { totalEl.textContent = '—'; return; }

    // Parse "$X,XXX" / "$X,XXX/yr" / "$5,000 – $20,000" style strings.
    // Take the first numeric token found. Mixed formats are normal here, so
    // we report a conservative sum and prefix with "$".
    var total = 0;
    var parsed = 0;
    for (var i = 0; i < scholarships.length; i++) {
      var raw = scholarships[i] && scholarships[i].amount;
      if (typeof raw !== 'string') continue;
      var m = raw.replace(/,/g, '').match(/\d{3,}/);
      if (m) { total += parseInt(m[0], 10); parsed++; }
    }
    if (parsed === 0) { totalEl.textContent = '—'; return; }
    totalEl.textContent = '$' + total.toLocaleString() + '+';
  }

  // ── Category flow ─────────────────────────────────────────────────────────
  var CATEGORY_DEFS = [
    { key: 'all',          label: 'All',           icon: '✦' },
    { key: 'in-state',     label: 'In-State',      icon: '🏠' },
    { key: 'national',     label: 'National',      icon: '🌎' },
    { key: 'out-of-state', label: 'Out-of-State',  icon: '✈️' }
  ];

  function buildCategoryPills(scholarships) {
    var host = document.getElementById('category-flow-scroller');
    if (!host) return;

    var active = (typeof currentFilter === 'string' && currentFilter) ? currentFilter : 'all';
    if (!scholarships || !scholarships.length) {
      host.innerHTML = '<button class="category-pill is-active" data-category="all" role="tab" aria-selected="true">All</button>';
      return;
    }

    var counts = { 'in-state': 0, 'national': 0, 'out-of-state': 0 };
    for (var i = 0; i < scholarships.length; i++) {
      var s = scholarships[i].scope;
      if (s && Object.prototype.hasOwnProperty.call(counts, s)) counts[s]++;
    }

    var html = '';
    for (var j = 0; j < CATEGORY_DEFS.length; j++) {
      var def = CATEGORY_DEFS[j];
      var c = def.key === 'all' ? scholarships.length : counts[def.key] || 0;
      if (def.key !== 'all' && c === 0) continue; // hide empty buckets
      var isActive = def.key === active;
      html += '<button class="category-pill' + (isActive ? ' is-active' : '') + '"' +
              ' data-category="' + def.key + '" role="tab" aria-selected="' + (isActive ? 'true' : 'false') + '">' +
              '<span class="category-pill__icon" aria-hidden="true">' + def.icon + '</span>' +
              '<span class="category-pill__label">' + def.label + '</span>' +
              '<span class="category-pill__count">' + c + '</span>' +
              '</button>';
    }
    host.innerHTML = html;

    // Click + keyboard handlers
    var pills = host.querySelectorAll('.category-pill');
    for (var k = 0; k < pills.length; k++) {
      pills[k].addEventListener('click', onPillClick);
      pills[k].addEventListener('keydown', onPillKey);
    }
  }

  function onPillClick(e) {
    var pill = e.currentTarget;
    var key  = pill.getAttribute('data-category') || 'all';
    applyScholarshipFilter(key);
  }

  function onPillKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPillClick(e);
    }
  }

  /**
   * applyScholarshipFilter — thin filter step.
   * There is no pre-existing filter function in the codebase (Phase 1
   * inventory confirmed this). This helper filters the captured full set
   * and re-calls the EXISTING renderScholarships(filtered). Single render
   * path, no parallel renderer.
   */
  function applyScholarshipFilter(key) {
    if (typeof currentFilter !== 'undefined') {
      // Update the inline-script's let var via the global write-shim below.
      window.__setCurrentFilter && window.__setCurrentFilter(key);
    }
    var source = (lastScholList && lastScholList.length) ? lastScholList : (typeof currentScholarships !== 'undefined' ? currentScholarships : []);
    var filtered = (key === 'all') ? source.slice() : source.filter(function (s) { return s && s.scope === key; });

    if (typeof renderScholarships === 'function') {
      renderScholarships(filtered, { __fromFilter: true });
    }
    // Update pill active state without rebuilding (preserves focus order)
    var host = document.getElementById('category-flow-scroller');
    if (!host) return;
    var pills = host.querySelectorAll('.category-pill');
    for (var i = 0; i < pills.length; i++) {
      var p = pills[i];
      var isActive = p.getAttribute('data-category') === key;
      p.classList.toggle('is-active', isActive);
      p.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    // Empty-state message
    var grid = document.getElementById('scholarship-grid');
    if (grid && filtered.length === 0) {
      grid.innerHTML = '<div class="rd-empty"><span class="rd-empty__icon">🔍</span>' +
        '<h3>No scholarships in this category</h3>' +
        '<p>Try a different category or clear the filter.</p>' +
        '<button class="btn btn--ghost" onclick="(function(){ var b=document.querySelector(\'.category-pill[data-category=\\\'all\\\']\'); if(b){ b.click(); } })()">Show all</button></div>';
    }
  }

  // ── Render hook from inline renderScholarships ───────────────────────────
  window.redesignOnScholarshipsRendered = function (scholarships, opts) {
    opts = opts || {};
    if (!opts.__fromFilter) {
      lastScholList = Array.isArray(scholarships) ? scholarships.slice() : [];
      // reset filter on a fresh fetch
      if (window.__setCurrentFilter) window.__setCurrentFilter('all');
    }
    populateHeroStats(lastScholList);
    if (!opts.__fromFilter) {
      buildCategoryPills(lastScholList);
    }
  };

  // ── Render hook from inline renderColleges ───────────────────────────────
  window.redesignOnCollegesRendered = function (colleges) {
    lastColleges = Array.isArray(colleges) ? colleges.slice() : [];
    selectedCollegeName = lastColleges[0] && lastColleges[0].name || null;
    renderCollegeMap(lastColleges);
    renderCollegeDetail(findCollegeByName(selectedCollegeName));
    wireCollegeListRows();
  };

  // ── Map: projection + render ─────────────────────────────────────────────
  // Equirectangular projection of the continental US onto the viewBox.
  // Bounds: lng -125..-66, lat 24..50.
  var MAP_VIEW = { w: 800, h: 480, lngMin: -125, lngMax: -66, latMin: 24, latMax: 50 };

  function project(lat, lng) {
    var x = ((lng - MAP_VIEW.lngMin) / (MAP_VIEW.lngMax - MAP_VIEW.lngMin)) * MAP_VIEW.w;
    var y = MAP_VIEW.h - ((lat - MAP_VIEW.latMin) / (MAP_VIEW.latMax - MAP_VIEW.latMin)) * MAP_VIEW.h;
    return { x: x, y: y };
  }

  function lookupCoords(college) {
    if (!coordsData) return null;
    var name = (college.name || '').toLowerCase().trim();
    if (!name) return null;
    // Exact
    if (coordsData.schools && coordsData.schools[name]) return coordsData.schools[name];
    // Contains
    if (coordsData.schools) {
      var keys = Object.keys(coordsData.schools);
      for (var i = 0; i < keys.length; i++) {
        if (name.indexOf(keys[i]) !== -1 || keys[i].indexOf(name) !== -1) {
          return coordsData.schools[keys[i]];
        }
      }
    }
    // City fallback
    var loc = (college.location || '').toLowerCase().trim();
    if (loc && coordsData.cities && coordsData.cities[loc]) return coordsData.cities[loc];
    return null;
  }

  function tierColorVar(tier) {
    switch (tier) {
      case 'safety':   return 'var(--rd-safety)';
      case 'target':   return 'var(--rd-target)';
      case 'reach':    return 'var(--rd-reach)';
      case 'longshot': return 'var(--rd-longshot)';
      default:         return 'var(--rd-target)';
    }
  }

  function renderCollegeMap(colleges) {
    var host = document.getElementById('rd-college-map');
    if (!host) return;
    var unplaced = 0;
    var pins = '';
    for (var i = 0; i < colleges.length; i++) {
      var c = colleges[i];
      var coords = lookupCoords(c);
      if (!coords) { unplaced++; continue; }
      var p = project(coords[0], coords[1]);
      // Clamp to viewBox (rare overflow for AK/HI/PR — most are excluded already)
      if (p.x < 0 || p.x > MAP_VIEW.w || p.y < 0 || p.y > MAP_VIEW.h) { unplaced++; continue; }
      var fill  = tierColorVar(c.tier);
      var safeName = (c.name || '').replace(/"/g, '&quot;');
      pins += '<g class="rd-pin' + (selectedCollegeName === c.name ? ' is-selected' : '') + '" data-college="' + safeName + '" tabindex="0" role="button" aria-label="' + safeName + ' — ' + (c.tier || '') + '">' +
              '<circle class="rd-pin__halo" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="14" fill="' + fill + '" opacity="0.18" />' +
              '<circle class="rd-pin__dot"  cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="6"  fill="' + fill + '" stroke="#fff" stroke-width="2" />' +
              '<title>' + safeName + ' — ' + (c.tier || 'target') + '</title>' +
              '</g>';
    }

    host.innerHTML =
      '<svg viewBox="0 0 ' + MAP_VIEW.w + ' ' + MAP_VIEW.h + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="US college map">' +
        '<rect x="0" y="0" width="' + MAP_VIEW.w + '" height="' + MAP_VIEW.h + '" fill="#fafaf7" />' +
        US_OUTLINE_PATH +
        pins +
      '</svg>' +
      (unplaced > 0 ? '<div class="rd-map-note">📍 ' + unplaced + ' school' + (unplaced === 1 ? '' : 's') + ' without map coordinates — see the list for details.</div>' : '');

    // Pin click + keyboard
    var pinEls = host.querySelectorAll('.rd-pin');
    for (var k = 0; k < pinEls.length; k++) {
      pinEls[k].addEventListener('click', onPinActivate);
      pinEls[k].addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPinActivate(e); }
      });
    }
  }

  function onPinActivate(e) {
    var el = e.currentTarget;
    var name = el.getAttribute('data-college');
    if (!name) return;
    selectCollege(name);
  }

  // Simplified US continental outline. A single concatenated path; intent is
  // contextual silhouette, not cartographic accuracy. ~50 vertices.
  var US_OUTLINE_PATH =
    '<path d="' +
    'M 60 200 L 90 170 L 130 150 L 180 140 L 230 130 L 290 130 L 340 140 L ' +
    '380 150 L 430 145 L 470 130 L 490 110 L 510 100 L 540 95 L 570 100 L ' +
    '600 120 L 620 145 L 640 165 L 670 175 L 700 185 L 730 195 L 750 215 L ' +
    '755 245 L 750 275 L 735 305 L 720 335 L 700 360 L 670 380 L 630 395 L ' +
    '590 405 L 545 410 L 500 415 L 460 410 L 415 405 L 370 400 L 330 400 L ' +
    '290 395 L 250 385 L 215 370 L 180 355 L 150 340 L 125 320 L 105 295 L ' +
    '85 265 L 70 235 Z" ' +
    'fill="#f1efe7" stroke="#d6d3c4" stroke-width="1.5" stroke-linejoin="round" />';

  // ── College list + detail wiring ─────────────────────────────────────────
  function wireCollegeListRows() {
    var rows = document.querySelectorAll('.rd-college-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].addEventListener('click', onRowActivate);
      rows[i].addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowActivate(e); }
      });
    }
    // Initial selected highlight
    applySelectedHighlight();
  }

  function onRowActivate(e) {
    var row = e.currentTarget;
    var name = row.getAttribute('data-college');
    if (!name) return;
    selectCollege(name);
  }

  function selectCollege(name) {
    selectedCollegeName = name;
    var college = findCollegeByName(name);
    renderCollegeDetail(college);
    applySelectedHighlight();
  }

  function applySelectedHighlight() {
    // Rows
    var rows = document.querySelectorAll('.rd-college-row');
    for (var i = 0; i < rows.length; i++) {
      var match = rows[i].getAttribute('data-college') === selectedCollegeName;
      rows[i].classList.toggle('is-selected', match);
      rows[i].setAttribute('aria-selected', match ? 'true' : 'false');
    }
    // Pins
    var pins = document.querySelectorAll('.rd-pin');
    for (var j = 0; j < pins.length; j++) {
      var pmatch = pins[j].getAttribute('data-college') === selectedCollegeName;
      pins[j].classList.toggle('is-selected', pmatch);
    }
  }

  function findCollegeByName(name) {
    if (!name) return null;
    for (var i = 0; i < lastColleges.length; i++) {
      if (lastColleges[i].name === name) return lastColleges[i];
    }
    return null;
  }

  // ── College detail panel ─────────────────────────────────────────────────
  function renderCollegeDetail(c) {
    var host = document.getElementById('rd-college-detail');
    if (!host) return;
    if (!c) {
      host.innerHTML = '<div class="rd-detail__empty">Select a school to see the full detail.</div>';
      return;
    }
    var eh = (typeof escHtml === 'function') ? escHtml : function (s) { return String(s == null ? '' : s); };
    var tier = c.tier || 'target';
    var tierLbl = { safety: 'Safety', target: 'Target', reach: 'Reach', longshot: 'Long Shot' }[tier] || 'Target';

    // Build chip row
    var chips = '';
    if (c.universityRank)     chips += '<span class="rd-chip">🏛️ ' + eh(c.universityRank) + '</span>';
    if (c.businessSchoolRank) chips += '<span class="rd-chip">🏆 ' + eh(c.businessSchoolRank) + '</span>';
    if (c.topSpecialties)     chips += '<span class="rd-chip">🎯 ' + eh(c.topSpecialties) + '</span>';
    if (c.admittedGPARange)   chips += '<span class="rd-chip">📊 GPA ' + eh(c.admittedGPARange) + '</span>';
    if (c.admittedSATRange && c.admittedSATRange !== 'N/A') chips += '<span class="rd-chip">📝 SAT ' + eh(c.admittedSATRange) + '</span>';
    if (c.admittedACTRange && c.admittedACTRange !== 'N/A') chips += '<span class="rd-chip">📝 ACT ' + eh(c.admittedACTRange) + '</span>';
    if (c.edBoost && c.edBoost !== 'N/A (public)' && c.edBoost !== 'N/A') chips += '<span class="rd-chip">⚡ ' + eh(c.edBoost) + '</span>';

    // Deadlines block
    var dl = c.applicationDeadlines || {};
    var dlBits = [];
    if (dl.earlyDecision)   dlBits.push('<div class="rd-dl"><strong>Early Decision</strong>' + eh(dl.earlyDecision) + '</div>');
    if (dl.earlyAction)     dlBits.push('<div class="rd-dl"><strong>Early Action</strong>' + eh(dl.earlyAction) + '</div>');
    if (dl.regularDecision) dlBits.push('<div class="rd-dl"><strong>Regular Decision</strong>' + eh(dl.regularDecision) + '</div>');
    if (dl.rolling === true) dlBits.push('<div class="rd-dl rd-dl--rolling"><strong>Rolling</strong>Open</div>');

    // Milestones
    var milestones = '';
    if (Array.isArray(c.keyMilestones) && c.keyMilestones.length) {
      milestones = '<div class="rd-section"><div class="rd-section__head">Key milestones</div><ul class="rd-list-mile">' +
        c.keyMilestones.map(function (m) { return '<li>' + eh(m) + '</li>'; }).join('') +
      '</ul></div>';
    }

    // Tips
    var tips = '';
    if (Array.isArray(c.tips) && c.tips.length) {
      tips = '<div class="rd-section"><div class="rd-section__head">Tips for you</div><ul class="rd-list-mile">' +
        c.tips.map(function (t) { return '<li>' + eh(t) + '</li>'; }).join('') +
      '</ul></div>';
    }

    // Net price
    var price = '';
    if (c.netPriceInState || c.netPriceOutState) {
      var bits = [];
      if (c.netPriceInState)  bits.push('In-state ' + eh(c.netPriceInState));
      if (c.netPriceOutState) bits.push('Out-of-state ' + eh(c.netPriceOutState));
      price = '<div class="rd-pricing">💵 ' + bits.join(' · ') + '</div>';
    }

    // Apply button — reuse existing getCollegeApplyUrl for parity with old card
    var applyHtml = '';
    if (typeof getCollegeApplyUrl === 'function') {
      try {
        var ap = getCollegeApplyUrl(c) || {};
        if (ap.url) {
          applyHtml = '<a class="btn btn--primary rd-detail__apply" href="' + ap.url + '" target="_blank" rel="noopener noreferrer">' +
                      (ap.isReal ? '🔗 Apply' : '🔍 Find application') + ' →</a>';
        }
      } catch (e) { /* fall through */ }
    }

    host.innerHTML =
      '<div class="rd-detail__band rd-tier--' + tier + '">' +
        '<div class="rd-detail__band-eyebrow">' + tierLbl.toUpperCase() + '</div>' +
        '<div class="rd-detail__band-title">' + eh(c.name || '') + '</div>' +
        '<div class="rd-detail__band-sub">' + eh(c.location || '') + '</div>' +
      '</div>' +
      '<div class="rd-detail__tiles">' +
        tile(c.overallAcceptRate, 'Overall admit') +
        tile(c.inStateRate, 'In-state') +
        tile(c.outStateRate, 'Out-of-state') +
      '</div>' +
      (chips ? '<div class="rd-detail__chips">' + chips + '</div>' : '') +
      (c.fitNote ? '<div class="rd-detail__callout rd-tier--' + tier + '">💡 ' + eh(c.fitNote) + '</div>' : '') +
      (c.programNote ? '<div class="rd-detail__callout">📚 ' + eh(c.programNote) + '</div>' : '') +
      (dlBits.length ? '<div class="rd-section"><div class="rd-section__head">Application deadlines</div><div class="rd-dls">' + dlBits.join('') + '</div>' +
        (c.idealStartDate ? '<div class="rd-ideal">🗓 Start by: <strong>' + eh(c.idealStartDate) + '</strong></div>' : '') + '</div>' : '') +
      milestones + tips +
      (price || applyHtml ? '<div class="rd-detail__footer">' + price + applyHtml + '</div>' : '');
  }

  function tile(value, label) {
    var eh = (typeof escHtml === 'function') ? escHtml : function (s) { return String(s == null ? '' : s); };
    var v = (value == null || value === '') ? '—' : value;
    return '<div class="rd-tile">' +
             '<div class="rd-tile__value">' + eh(v) + '</div>' +
             '<div class="rd-tile__label">' + label + '</div>' +
           '</div>';
  }
})();
