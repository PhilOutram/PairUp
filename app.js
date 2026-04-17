// ─── State ───────────────────────────────────────────────────────────────────

const STATE_KEY = 'pairup_v2';

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : defaultState();
  } catch (e) { return defaultState(); }
}

function defaultState() {
  return {
    profile: null,
    sentRequests: [],      // ids we sent to
    receivedRequests: [],  // ids that requested us
    connections: [],       // { id, dir:'sent'|'received', ts }
    dismissed: [],
    showDismissed: false,
    newConnBanner: null,
    pendingTimers: {},     // id -> scheduledAt timestamp (persisted so reload survives)
    hiddenSuggested: [],   // ids currently hidden from suggested matches (revealed by refresh)
    activeOverrides: {},   // id -> timestamp, overrides the dummy's baked-in lastActive
    _bootstrapped: false,
    _hiddenBootstrapped: false,
  };
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();

const DEFAULT_VISIBILITY = () => ({
  grade: 'must', directorates: 'must', location: 'open', days: 'open',
});

// Migrate any pre-existing profile to the new schema so old localStorage doesn't crash.
if (state.profile) {
  const p = state.profile;
  if (Array.isArray(p.days)) {
    const arr = p.days;
    p.days = { Mon: 'non', Tue: 'non', Wed: 'non', Thu: 'non', Fri: 'non' };
    arr.forEach(d => { if (p.days[d] !== undefined) p.days[d] = 'full'; });
  }
  if (p.roles) delete p.roles;
  if (!p.lastActive) p.lastActive = Date.now();
  if (!p.visibility) p.visibility = DEFAULT_VISIBILITY();
  ['availability', 'fte', 'daysNegotiable', 'skills', 'workingPatternNotes', 'otherInfo']
    .forEach(k => { if (p[k] === undefined) p[k] = ''; });
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const EMPTY_DAYS = () => ({ Mon: 'non', Tue: 'non', Wed: 'non', Thu: 'non', Fri: 'non' });

// ─── Simulated inbound bootstrap ─────────────────────────────────────────────

function maybeBootstrapInbound() {
  if (!state.profile || state._bootstrapped) return;
  state._bootstrapped = true;
  state.activeOverrides = state.activeOverrides || {};
  const user = state.profile;
  // Seed the inbound pile with up to two plausible, high-match candidates
  // who the user's own visibility rules would actually expose them to.
  const seeds = DUMMY_PROFILES.filter(p => {
    if (state.receivedRequests.includes(p.id)) return false;
    if (state.connections.find(c => c.id === p.id)) return false;
    if (state.sentRequests.includes(p.id)) return false;
    if (!userVisibleToCandidate(user, p)) return false;
    if (!candidateVisibleToSearcher(user, p)) return false;
    const { score } = scoreMatch(user, p);
    return score >= 50;
  });
  seeds.sort((a, b) => {
    const sa = scoreMatch(user, a).score;
    const sb = scoreMatch(user, b).score;
    return sb - sa;
  });
  seeds.slice(0, 2).forEach(p => {
    state.receivedRequests.push(p.id);
    state.activeOverrides[p.id] = Date.now();
  });
  saveState();
}

// Hide roughly 40% of the pool on first save so refresh feels dynamic
// without leaving the initial Suggested view empty.
function maybeBootstrapHiddenSuggested() {
  if (!state.profile || state._hiddenBootstrapped) return;
  state._hiddenBootstrapped = true;
  state.hiddenSuggested = DUMMY_PROFILES
    .filter(() => Math.random() < 0.4)
    .map(p => p.id);
  saveState();
}

// ─── Pending timer management ─────────────────────────────────────────────────

function schedulePendingAccept(id) {
  const delay = 3000 + Math.random() * 4000;
  const scheduledAt = Date.now();
  state.pendingTimers[id] = { scheduledAt, delay };
  saveState();
  setTimeout(() => resolvePending(id), delay);
}

function resolvePending(id) {
  if (!state.sentRequests.includes(id)) return;
  if (state.connections.find(c => c.id === id)) return;
  delete state.pendingTimers[id];
  state.sentRequests = state.sentRequests.filter(x => x !== id);
  state.connections.push({ id, dir: 'sent', ts: Date.now() });
  const p = DUMMY_PROFILES.find(x => x.id === id);
  state.newConnBanner = p ? `${p.name} accepted your request!` : 'A new connection accepted your request!';
  saveState();
  updateBadges();
  renderConnectionBanner();
  if (document.getElementById('tab-connections').classList.contains('active')) renderConnections();
  if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
}

function rehydrateTimers() {
  const timers = state.pendingTimers || {};
  Object.entries(timers).forEach(([id, info]) => {
    if (!state.sentRequests.includes(id)) {
      delete state.pendingTimers[id];
      return;
    }
    const elapsed = Date.now() - info.scheduledAt;
    const remaining = Math.max(0, info.delay - elapsed);
    setTimeout(() => resolvePending(id), remaining);
  });
}

// ─── Admin weights (grade penalty mode only) ─────────────────────────────────

const WEIGHTS_KEY = 'pairup_weights_v1';
const DEFAULT_WEIGHTS = {
  gradePenalty: 'heavy',  // 'hard'|'heavy'|'light'|'none' — for relaxed (Preferred) grade search
};

function loadWeights() {
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    return raw ? { ...DEFAULT_WEIGHTS, ...JSON.parse(raw) } : { ...DEFAULT_WEIGHTS };
  } catch (e) { return { ...DEFAULT_WEIGHTS }; }
}

function saveWeights(w) {
  localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w));
}

let W = loadWeights();

// ─── Search preferences (Change 19) ──────────────────────────────────────────

const SEARCH_PREFS_KEY = 'pairup_searchPrefs';
const DEFAULT_SEARCH_PREFS = {
  grade: 'definite',
  directorates: 'definite',
  location: 'preferred',
  days: 'preferred',
};

function loadSearchPrefs() {
  try {
    const raw = localStorage.getItem(SEARCH_PREFS_KEY);
    return raw ? { ...DEFAULT_SEARCH_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_SEARCH_PREFS };
  } catch (e) { return { ...DEFAULT_SEARCH_PREFS }; }
}

function saveSearchPrefs() {
  localStorage.setItem(SEARCH_PREFS_KEY, JSON.stringify(searchPrefs));
}

let searchPrefs = loadSearchPrefs();

// Ensures a candidate's visibility field is present and filled.
function visibilityOf(candidate) {
  return { ...DEFAULT_VISIBILITY(), ...(candidate.visibility || {}) };
}

// ─── Day complementarity ─────────────────────────────────────────────────────

const DAY_PAIR_SCORES = {
  'full+non': 1.0, 'non+full': 1.0,
  'full+flexible': 0.8, 'flexible+full': 0.8,
  'part+non': 0.6, 'non+part': 0.6,
  'part+flexible': 0.5, 'flexible+part': 0.5,
  'flexible+flexible': 0.4,
  'part+part': 0.3,
  'non+non': 0.2,
  'full+full': 0.0,
  'full+part': 0.1, 'part+full': 0.1,
  'non+flexible': 0.3, 'flexible+non': 0.3,
};

function dayComplementarityScore(userDays, candDays) {
  userDays = userDays || EMPTY_DAYS();
  candDays = candDays || EMPTY_DAYS();
  const total = DAYS_OF_WEEK.reduce((sum, d) => {
    const key = `${userDays[d] || 'non'}+${candDays[d] || 'non'}`;
    return sum + (DAY_PAIR_SCORES[key] ?? 0.2);
  }, 0);
  return total / DAYS_OF_WEEK.length;
}

// ─── Matching ────────────────────────────────────────────────────────────────

function sharedDirectorates(userDirs, candDirs) {
  const u = (userDirs || []).filter(d => d !== 'Open to any');
  const c = (candDirs || []).filter(d => d !== 'Open to any');
  const userOpen = (userDirs || []).includes('Open to any');
  const candOpen = (candDirs || []).includes('Open to any');
  // Either side being "Open to any" means they overlap with everything the
  // other party picked, so count all of those as shared directorates.
  if (candOpen && userOpen) return Array.from(new Set([...u, ...c]));
  if (candOpen) return u;
  if (userOpen) return c;
  return u.filter(d => c.includes(d));
}

function directorateOverlapAny(userDirs, candDirs) {
  const u = userDirs || [];
  const c = candDirs || [];
  if (u.includes('Open to any') || c.includes('Open to any')) return true;
  return u.some(d => c.includes(d));
}

function rankScore(user, candidate, prefs) {
  prefs = prefs || searchPrefs;
  let score = 0;
  const breakdown = [];

  // Day complementarity (0–40pts)
  const dayComp = dayComplementarityScore(user.days, candidate.days);
  const dayPts = Math.round(dayComp * 40);
  score += dayPts;
  breakdown.push({
    label: 'Day pattern',
    score: dayPts, max: 40,
    note: dayComp >= 0.7 ? 'Strong complementarity'
        : dayComp >= 0.4 ? 'Partial complementarity'
        : 'Weak complementarity',
  });

  // Additional directorate overlap (0–20pts)
  const sharedDirs = sharedDirectorates(user.directorates, candidate.directorates);
  const dirPts = Math.min(sharedDirs.length * 7, 20);
  score += dirPts;
  breakdown.push({
    label: 'Directorate overlap',
    score: dirPts, max: 20,
    note: sharedDirs.length > 0 ? sharedDirs.slice(0, 2).join(', ') : 'Minimum overlap',
  });

  // Recency (0–20pts)
  const ageDays = (Date.now() - (effectiveLastActive(candidate) || 0)) / 86400000;
  let recencyPts = 0;
  let recencyNote = '';
  if (ageDays < 14) { recencyPts = 20; recencyNote = 'Active recently'; }
  else if (ageDays < 90) { recencyPts = 15; recencyNote = 'Active this quarter'; }
  else if (ageDays < 180) { recencyPts = 5; recencyNote = 'Active a few months ago'; }
  else { recencyNote = 'Not active for 6+ months'; }
  score += recencyPts;
  breakdown.push({ label: 'Recency', score: recencyPts, max: 20, note: recencyNote });

  // Location match (0–10pts)
  let locPts = 0;
  if (user.location && candidate.location === user.location) locPts = 10;
  score += locPts;
  breakdown.push({
    label: 'Location',
    score: locPts, max: 10,
    note: locPts > 0 ? 'Same location' : 'Different location',
  });

  // Preferred criteria bonuses (0–30pts)
  let prefBonus = 0;
  if (prefs.grade === 'preferred' && candidate.grade === user.grade) prefBonus += 10;
  if (prefs.directorates === 'preferred' && sharedDirs.length > 0) prefBonus += 8;
  if (prefs.location === 'preferred' && candidate.location === user.location) prefBonus += 5;
  if (prefs.days === 'preferred' && dayComp > 0.5) prefBonus += 7;
  if (prefBonus > 0) {
    score += prefBonus;
    breakdown.push({ label: 'Preferred bonuses', score: prefBonus, max: 30, note: 'From your search preferences' });
  }

  // Grade-penalty adjustment (only when grade is in Preferred mode and grades differ)
  if (prefs.grade === 'preferred' && candidate.grade !== user.grade) {
    const uIdx = GRADE_IDX[user.grade] ?? 0;
    const cIdx = GRADE_IDX[candidate.grade] ?? 0;
    if (Math.abs(uIdx - cIdx) === 1) {
      const penalty = { hard: 1.0, heavy: 0.5, light: 0.25, none: 0 }[W.gradePenalty] ?? 0.5;
      score = Math.round(score * (1 - penalty));
    }
  }

  // Days negotiable bonus (0–3pts)
  if (candidate.daysNegotiable === 'yes') score += 3;
  else if (candidate.daysNegotiable === 'possibly') score += 1;

  return { score: Math.min(Math.round(score), 100), breakdown };
}

function scoreMatch(user, candidate, prefs) {
  const { score, breakdown } = rankScore(user, candidate, prefs);
  return { score, breakdown };
}

// ─── Visibility gate checks ──────────────────────────────────────────────────

function candidateVisibleToSearcher(user, candidate) {
  const v = visibilityOf(candidate);
  if (v.grade === 'must' && candidate.grade !== user.grade) return false;
  if (v.directorates === 'must' &&
      !directorateOverlapAny(user.directorates, candidate.directorates)) return false;
  if (v.location === 'must' && candidate.location !== user.location) return false;
  if (v.days === 'must' &&
      dayComplementarityScore(user.days, candidate.days) < 0.3) return false;
  return true;
}

// Given the USER's own visibility rules, can this candidate see the user?
// Used to gate simulated inbound requests — a candidate can only "have sent a
// request" if the user's own must-match rules would have let the candidate find them.
function userVisibleToCandidate(user, candidate) {
  const v = { ...DEFAULT_VISIBILITY(), ...(user.visibility || {}) };
  if (v.grade === 'must' && candidate.grade !== user.grade) return false;
  if (v.directorates === 'must' &&
      !directorateOverlapAny(user.directorates, candidate.directorates)) return false;
  if (v.location === 'must' && candidate.location !== user.location) return false;
  if (v.days === 'must' &&
      dayComplementarityScore(user.days, candidate.days) < 0.3) return false;
  return true;
}

function searcherInvisibleToCandidate(user, candidate) {
  // Would the searcher's own profile fail the candidate's must-match rules if roles
  // were reversed? Used to show a warning on cards for one-way visibility.
  const v = visibilityOf(candidate);
  if (v.grade === 'must' && candidate.grade !== user.grade) return true;
  if (v.directorates === 'must' &&
      !directorateOverlapAny(user.directorates, candidate.directorates)) return true;
  if (v.location === 'must' && candidate.location !== user.location) return true;
  if (v.days === 'must' &&
      dayComplementarityScore(user.days, candidate.days) < 0.3) return true;
  return false;
}

function candidateSatisfiesSearcherGates(user, candidate, prefs) {
  if (prefs.grade === 'definite' && candidate.grade !== user.grade) return false;
  if (prefs.directorates === 'definite' &&
      !directorateOverlapAny(user.directorates, candidate.directorates)) return false;
  if (prefs.location === 'definite' && candidate.location !== user.location) return false;
  if (prefs.days === 'definite' &&
      dayComplementarityScore(user.days, candidate.days) < 0.3) return false;
  return true;
}

function scoreToPercent(score) {
  return Math.max(0, Math.min(Math.round(score), 100));
}

function scoreClass(pct) {
  if (pct >= 65) return 'score-high';
  if (pct >= 40) return 'score-med';
  return 'score-low';
}

function accentColor(pct) {
  if (pct >= 65) return '#639922';
  if (pct >= 40) return '#EF9F27';
  return '#E24B4A';
}

function matchTextColor(pct) {
  if (pct >= 65) return '#27500A';
  if (pct >= 40) return '#633806';
  return '#A32D2D';
}

function styleLabel(s) {
  return { clean: 'Clean handover', collaborative: 'Collaborative', flexible: 'Flexible', unsure: 'Not sure yet' }[s] || s;
}

function locationShort(loc, overseas) {
  if (loc === 'Overseas' && overseas) return overseas;
  return loc || '—';
}

function daysSummary(days) {
  if (!days) return '';
  return DAYS_OF_WEEK.map(d => {
    const v = days[d] || 'non';
    const pip = v === 'full' ? '●' : v === 'part' ? '◑' : v === 'flexible' ? '~' : '○';
    return `${d[0]}${pip}`;
  }).join(' ');
}

function getMatches() {
  if (!state.profile) return [];
  const user = state.profile;
  const hidden = new Set(state.hiddenSuggested || []);
  return DUMMY_PROFILES
    .filter(candidate => {
      if (hidden.has(candidate.id)) return false;
      if (!candidateVisibleToSearcher(user, candidate)) return false;
      if (!candidateSatisfiesSearcherGates(user, candidate, searchPrefs)) return false;
      return true;
    })
    .map(p => {
      const sm = scoreMatch(user, p, searchPrefs);
      // Hide name if the candidate is only visible because user relaxed their own
      // grade or directorate criteria (i.e. candidate doesn't pass user's own must).
      const gradeGateFails = p.grade !== user.grade;
      const dirGateFails = !directorateOverlapAny(user.directorates, p.directorates);
      const hideName = (gradeGateFails && searchPrefs.grade !== 'definite')
                    || (dirGateFails && searchPrefs.directorates !== 'definite');
      return {
        profile: p,
        ...sm,
        hideName,
        oneWayWarning: searcherInvisibleToCandidate(user, p),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Filter state ─────────────────────────────────────────────────────────────
// Simple secondary filters that layer on top of the main hard gates.

const filters = { days: [], loc: null, activeWithin: null };

function applyFilters(matches) {
  return matches.filter(m => {
    const p = m.profile;
    // Day filter: candidate must have 'full', 'part', or 'flexible' on each selected day
    if (filters.days.length > 0) {
      const ok = filters.days.every(d => {
        const v = (p.days || {})[d];
        return v === 'full' || v === 'part' || v === 'flexible';
      });
      if (!ok) return false;
    }
    if (filters.loc && p.location !== filters.loc) return false;
    if (filters.activeWithin) {
      const ts = effectiveLastActive(p);
      if (!ts) return false;
      const ageDays = (Date.now() - ts) / 86400000;
      if (ageDays > filters.activeWithin) return false;
    }
    return true;
  });
}

function hasActiveFilters() {
  return filters.days.length > 0 || filters.loc || filters.activeWithin;
}

// ─── Build a match/connection card ───────────────────────────────────────────

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[s]));
}

// Extract initials from a name (e.g. "Kate Binns" -> "K.B.", "A. Rahman" -> "A.R.").
function initialsOf(name) {
  if (!name) return '';
  const letters = name.match(/[A-Z]/g) || [];
  return letters.slice(0, 3).map(l => l + '.').join('');
}

// Returns the effective last-active timestamp, honouring any override
// applied when a request is simulated (so "just sent a request" profiles
// always appear recently active).
function effectiveLastActive(p) {
  const override = (state.activeOverrides || {})[p.id];
  if (override) return override;
  return p.lastActive;
}

// Staleness display: shown on every card. Three-colour scale: fresh (<2m),
// amber (2-6m), red (6m+).
function stalenessInfo(lastActive) {
  if (!lastActive) return { text: 'Last active unknown', klass: 'stale-amber' };
  const ageDays = (Date.now() - lastActive) / 86400000;
  if (ageDays < 1) return { text: 'Active today', klass: 'stale-fresh' };
  if (ageDays < 2) return { text: 'Active yesterday', klass: 'stale-fresh' };
  if (ageDays < 14) {
    const days = Math.round(ageDays);
    return { text: `Active ${days} days ago`, klass: 'stale-fresh' };
  }
  if (ageDays < 60) {
    const weeks = Math.max(2, Math.round(ageDays / 7));
    return { text: `Active ${weeks} weeks ago`, klass: 'stale-fresh' };
  }
  if (ageDays < 180) {
    const months = Math.max(2, Math.round(ageDays / 30));
    return { text: `Active ${months} months ago`, klass: 'stale-amber' };
  }
  return { text: 'Active 6+ months ago', klass: 'stale-red', tooltip: 'This profile may be out of date' };
}

function buildCard(matchObj, context) {
  const p = matchObj.profile;
  const pct = matchObj.score !== undefined ? scoreToPercent(matchObj.score) : null;
  const locDisplay = locationShort(p.location, p.overseas);

  const accent = pct !== null ? accentColor(pct) : '#ccc';
  const matchColor = pct !== null ? matchTextColor(pct) : '#888';

  // Name display: initials if the candidate is visible only because the searcher
  // relaxed their own criteria (Change 11). Flag set by getMatches in relaxed mode.
  const hideName = !!matchObj.hideName;
  const displayName = hideName
    ? `<span class="ccard-name-initials">${escapeHtml(initialsOf(p.name))}</span> <span class="ccard-name-hint">[Name visible once criteria are met]</span>`
    : `<span class="ccard-name">${escapeHtml(p.name)}</span>`;

  // Grade tag: green if same as searcher, grey otherwise
  const gradeMatch = state.profile && p.grade === state.profile.grade;
  const gradeBadge = `<span class="ctag ${gradeMatch ? 'ctag-green' : 'ctag-grey'}">${p.grade}</span>`;

  // Directorate tags: green if matches searcher's directorates
  const dirTags = (p.directorates || []).filter(d => d !== 'Open to any').slice(0, 2).map(d => {
    const isMatch = state.profile && (
      state.profile.directorates.includes(d) ||
      state.profile.directorates.includes('Open to any') ||
      (p.directorates || []).includes('Open to any')
    );
    return `<span class="ctag ${isMatch ? 'ctag-green' : 'ctag-grey'}">${d}</span>`;
  }).join('');

  // Availability line (truncated, omit row if empty)
  const availabilityRow = p.availability
    ? `<div class="ccard-availability" title="${escapeHtml(p.availability)}">${escapeHtml(truncate(p.availability, 80))}</div>`
    : '';

  // FTE + day pattern on a single row, with optional Negotiable pill
  const fteHtml = p.fte ? `<span class="cfte">${escapeHtml(p.fte)}</span>` : '';
  const dayPatternHtml = `<span class="cdays">${daysSummary(p.days)}</span>`;
  let negotiableTag = '';
  if (p.daysNegotiable === 'yes') negotiableTag = `<span class="ctag ctag-green">Negotiable</span>`;
  else if (p.daysNegotiable === 'possibly') negotiableTag = `<span class="ctag ctag-amber">Possibly</span>`;
  const patternRow = `<div class="ccard-pattern-row">${fteHtml}${dayPatternHtml}${negotiableTag}</div>`;

  // One-way visibility warning (Change 18)
  let warnRow = '';
  if (matchObj.oneWayWarning && state.profile) {
    const v = visibilityOf(p);
    const reasons = [];
    if (v.grade === 'must' && p.grade !== state.profile.grade) reasons.push('grade');
    if (v.directorates === 'must' && !directorateOverlapAny(state.profile.directorates, p.directorates)) reasons.push('directorate');
    if (v.location === 'must' && p.location !== state.profile.location) reasons.push('location');
    if (v.days === 'must') reasons.push('day pattern');
    if (reasons.length > 0) {
      const what = reasons.join(' / ');
      warnRow = `<div class="ccard-warn-row">This person requires a ${what} match to see your profile</div>`;
    }
  }

  // Location tag — always grey (display only)
  const locTag = `<span class="ctag ctag-grey">${locDisplay}</span>`;

  let statusText = '';
  if (context === 'inbound') statusText = `<span class="cstatus-inbound">· Requested you</span>`;
  else if (context === 'sent-pending') statusText = `<span class="cstatus-pending">· Request sent</span>`;

  const stale = stalenessInfo(effectiveLastActive(p));
  const staleHtml = stale.text
    ? `<span class="cstale ${stale.klass}"${stale.tooltip ? ` title="${escapeHtml(stale.tooltip)}"` : ''}>${stale.text}</span>`
    : '';

  let bottomInfo = '';
  if (pct !== null) {
    let awaitText = '';
    if (context === 'inbound') awaitText = `<span class="cawait"> · Awaiting your response</span>`;
    if (context === 'sent-pending') awaitText = `<span class="cawait"> · Awaiting their response</span>`;
    bottomInfo = `<div class="ccard-bottom">
      <span class="cmatch" style="color:${matchColor};" onclick="openScoreModal('${p.id}')">${pct}% match</span>
      ${awaitText}
      ${staleHtml ? ` · ${staleHtml}` : ''}
      <a class="cfp" onclick="openProfileModal('${p.id}')">Full profile…</a>
    </div>`;
  }

  let connFooter = '';
  if (context === 'connected') {
    const conn = state.connections.find(c => c.id === p.id);
    const dirText = conn && conn.dir === 'sent' ? 'You requested · they accepted' : 'They requested · you accepted';
    const dateStr = conn ? relativeDate(conn.ts) : '';
    connFooter = `<div class="cconn-footer"><span>${dateStr}</span><span class="cconn-dir">${dirText}</span></div>`;
  }

  const btnBlue = `background:#185FA5;color:#fff;`;
  const btnGhost = `background:transparent;color:#999;border:0.5px solid #ccc;`;
  const btnBase = `all:unset;display:block;width:100%;box-sizing:border-box;text-align:center;font-size:12px;font-weight:500;padding:5px 0;border-radius:7px;cursor:pointer;`;

  let rightCol = '';
  if (context === 'inbound') {
    rightCol = `
      <button type="button" style="${btnBase}${btnBlue}" data-action="accept" data-id="${p.id}">Accept</button>
      <button type="button" style="${btnBase}${btnGhost}" data-action="ignore" data-id="${p.id}">Ignore</button>`;
  } else if (context === 'match') {
    rightCol = `
      <button type="button" style="${btnBase}${btnBlue}" data-action="send" data-id="${p.id}">Request</button>
      <button type="button" style="${btnBase}${btnGhost}" data-action="dismiss" data-id="${p.id}">Dismiss</button>`;
  } else if (context === 'sent-pending') {
    rightCol = `
      <button type="button" style="${btnBase}${btnGhost}" data-action="withdraw" data-id="${p.id}">Withdraw</button>`;
  } else if (context === 'connected') {
    rightCol = `
      <a style="${btnBase}${btnBlue}text-decoration:none;display:flex;align-items:center;justify-content:center;gap:5px;" href="mailto:${p.name}">
        <svg width="11" height="11" viewBox="0 0 13 13" fill="none"><rect x="1" y="2.5" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 4l5.5 3.5L12 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Email
      </a>
      <button type="button" style="${btnBase}${btnGhost}" data-action="remove-connection" data-id="${p.id}">Remove</button>`;
  }

  const card = document.createElement('div');
  card.className = 'ccard';
  card.dataset.id = p.id;
  card.innerHTML = `
    <div class="ccard-accent" style="background:${accent};"></div>
    <div class="ccard-inner">
      <div class="ccard-left">
        <div class="ccard-name-row">
          ${displayName}
          ${statusText}
        </div>
        ${availabilityRow}
        <div class="ccard-tags">${gradeBadge}${dirTags}${locTag}</div>
        ${patternRow}
        ${warnRow}
        ${bottomInfo}
        ${connFooter}
      </div>
      <div class="ccard-right">${rightCol}</div>
    </div>`;

  return card;
}

function relativeDate(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

function closeModalIfBg(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

function openProfileModal(id) {
  const p = DUMMY_PROFILES.find(x => x.id === id);
  if (!p) return;
  const locDisplay = locationShort(p.location, p.overseas);
  const dirTags = (p.directorates || []).map(d => `<span class="modal-tag">${escapeHtml(d)}</span>`).join('');
  const dayEntries = DAYS_OF_WEEK.map(d => {
    const v = (p.days || {})[d] || 'non';
    const label = v === 'full' ? 'Full' : v === 'part' ? 'Part' : v === 'flexible' ? 'Flex' : 'Non';
    return `<span class="modal-tag">${d}: ${label}</span>`;
  }).join('');
  const styleStr = p.style ? styleLabel(p.style) : 'Not specified';

  const negLabel = p.daysNegotiable === 'yes' ? 'Yes'
                 : p.daysNegotiable === 'possibly' ? 'Possibly'
                 : p.daysNegotiable === 'no' ? 'No' : 'Not specified';

  const availSection = p.availability
    ? `<div class="modal-section">
        <div class="modal-section-label">Availability</div>
        <div class="modal-text">${escapeHtml(p.availability)}</div>
      </div>` : '';

  const fteSection = p.fte
    ? `<div class="modal-section">
        <div class="modal-section-label">FTE / hours</div>
        <div class="modal-tags"><span class="modal-tag">${escapeHtml(p.fte)}</span></div>
      </div>` : '';

  const skillsSection = p.skills
    ? `<div class="modal-section">
        <div class="modal-section-label">Skills and experience</div>
        <div class="modal-text">${escapeHtml(p.skills)}</div>
      </div>` : '';

  const patternSection = p.workingPatternNotes
    ? `<div class="modal-section">
        <div class="modal-section-label">Additional working pattern notes</div>
        <div class="modal-text">${escapeHtml(p.workingPatternNotes)}</div>
      </div>` : '';

  const otherSection = p.otherInfo
    ? `<div class="modal-section">
        <div class="modal-section-label">Other information</div>
        <div class="modal-text">${escapeHtml(p.otherInfo)}</div>
      </div>` : '';

  openModal(`
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-name">${escapeHtml(p.name)}</div>
    <div class="modal-grade-loc">${p.grade} · ${locDisplay}</div>
    ${availSection}
    <div class="modal-section">
      <div class="modal-section-label">Directorates</div>
      <div class="modal-tags">${dirTags}</div>
    </div>
    ${fteSection}
    <div class="modal-section">
      <div class="modal-section-label">Working days</div>
      <div class="modal-tags">${dayEntries}</div>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Working pattern negotiable?</div>
      <div class="modal-tags"><span class="modal-tag">${negLabel}</span></div>
    </div>
    ${patternSection}
    ${skillsSection}
    ${otherSection}
    <div class="modal-section">
      <div class="modal-section-label">Working style (reference only)</div>
      <div class="modal-tags"><span class="modal-tag">${styleStr}</span></div>
    </div>
  `);
}

function openScoreModal(id) {
  if (!state.profile) return;
  const p = DUMMY_PROFILES.find(x => x.id === id);
  if (!p) return;
  const result = scoreMatch(state.profile, p);
  const pct = scoreToPercent(result.score);
  const sClass = scoreClass(pct);

  const rows = result.breakdown.map(b => {
    const barPct = Math.round((b.score / b.max) * 100);
    const fillClass = barPct >= 70 ? 'fill-good' : barPct >= 30 ? 'fill-ok' : 'fill-low';
    return `
      <div class="score-row">
        <span class="score-row-label">${b.label}</span>
        <div class="score-row-bar"><div class="score-row-fill ${fillClass}" style="width:${barPct}%"></div></div>
        <span class="score-row-note">${b.note}</span>
      </div>`;
  }).join('');

  openModal(`
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-name">${p.name}</div>
    <div class="modal-grade-loc">${p.grade} · ${locationShort(p.location, p.overseas)}</div>
    <hr class="modal-divider">
    <div class="modal-score-title">
      Ranking breakdown
      <span class="score-pill ${sClass} modal-score-pct">${pct}% match</span>
    </div>
    <div class="score-breakdown">${rows}</div>
    <div style="margin-top:12px;font-size:11px;color:#bbb;line-height:1.6;">
      Grade and directorate are already matched (hard gates). This score ranks remaining profiles by day complementarity, recency, overlap and location.
    </div>
  `);
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  if (name === 'matches') renderMatches();
  if (name === 'connections') renderConnections();
}

document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ─── Profile form ─────────────────────────────────────────────────────────────

function getSelectedSingle(containerId) {
  const sel = document.querySelector(`#${containerId} .selected`);
  return sel ? sel.dataset.val : null;
}

function getSelectedMulti(containerId) {
  return [...document.querySelectorAll(`#${containerId} .selected`)].map(c => c.dataset.val);
}

// Per-day selection state for the day matrix.
const dayState = EMPTY_DAYS();

function setDay(day, val) {
  dayState[day] = val;
  document.querySelectorAll(`#dayMatrix .day-opt[data-day="${day}"]`).forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.val === val);
  });
}

function daysComplete() {
  return DAYS_OF_WEEK.some(d => dayState[d] === 'full' || dayState[d] === 'part' || dayState[d] === 'flexible');
}

function updateCompleteness() {
  const name = document.getElementById('userName').value.trim();
  const grade = getSelectedSingle('gradeChips');
  const dirs = getSelectedMulti('dirChips').length;
  const location = getSelectedSingle('locChips');

  let filled = 0;
  if (name) filled++;
  if (grade) filled++;
  if (dirs > 0) filled++;
  if (daysComplete()) filled++;
  if (location) filled++;

  const pct = Math.round((filled / 5) * 100);
  document.getElementById('complFill').style.width = pct + '%';
  const labels = ['Profile incomplete', 'Getting started', 'Keep going…', 'Half way there', 'Almost there', 'Profile complete'];
  document.getElementById('complLabel').textContent = labels[filled] || 'Profile complete';
  document.getElementById('complFill').style.background = pct === 100 ? '#27500A' : '#185FA5';
}

function loadProfileIntoForm() {
  const p = state.profile;
  if (!p) return;
  document.getElementById('userName').value = p.name || '';
  document.getElementById('userAvailability').value = p.availability || '';
  document.getElementById('userFte').value = p.fte || '';
  document.getElementById('userPatternNotes').value = p.workingPatternNotes || '';
  document.getElementById('userSkills').value = p.skills || '';
  document.getElementById('userOtherInfo').value = p.otherInfo || '';

  document.querySelectorAll('#gradeChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.grade);
  });
  document.querySelectorAll('#dirChips .chip').forEach(c => {
    c.classList.toggle('selected', (p.directorates || []).includes(c.dataset.val));
  });

  // Days matrix
  DAYS_OF_WEEK.forEach(d => {
    const val = (p.days && p.days[d]) || 'non';
    setDay(d, val);
  });

  document.querySelectorAll('#negotiableChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.daysNegotiable);
  });

  // Visibility state
  Object.assign(visibilityState, DEFAULT_VISIBILITY(), p.visibility || {});
  syncVisibilityButtons();

  document.querySelectorAll('#styleChips .style-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.style);
  });
  document.querySelectorAll('#locChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.location);
  });
  toggleOverseas();
  if (p.overseas) document.getElementById('overseasSelect').value = p.overseas;
  updateAvailabilityCount();
  updateSkillsWordCount();
  updateCompleteness();
  document.getElementById('deleteProfile').style.display = 'inline-block';
}

// ─── Field helpers: availability char count, skills word cap ────────────────

function updateAvailabilityCount() {
  const input = document.getElementById('userAvailability');
  const out = document.getElementById('availabilityCount');
  if (!input || !out) return;
  out.textContent = input.value.length;
}

function countWords(s) {
  const trimmed = (s || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const SKILLS_WORD_CAP = 50;

function updateSkillsWordCount() {
  const input = document.getElementById('userSkills');
  const out = document.getElementById('skillsWordCount');
  const wrap = out ? out.parentElement : null;
  if (!input || !out) return;
  const n = countWords(input.value);
  const remaining = SKILLS_WORD_CAP - n;
  out.textContent = Math.max(remaining, 0);
  if (wrap) wrap.classList.toggle('over', remaining < 0);
}

function enforceSkillsWordCap() {
  const input = document.getElementById('userSkills');
  if (!input) return;
  const words = input.value.split(/(\s+)/); // keep separators
  let count = 0;
  let kept = [];
  for (const tok of words) {
    if (/^\s+$/.test(tok)) { kept.push(tok); continue; }
    if (tok.length === 0) continue;
    if (count >= SKILLS_WORD_CAP) break;
    kept.push(tok);
    count++;
  }
  const trimmed = kept.join('').replace(/\s+$/, input.value.endsWith(' ') && count < SKILLS_WORD_CAP ? ' ' : '');
  if (trimmed !== input.value) input.value = trimmed;
  updateSkillsWordCount();
}

function toggleOverseas() {
  const loc = getSelectedSingle('locChips');
  document.getElementById('overseasWrap').style.display = loc === 'Overseas' ? 'block' : 'none';
}

// ─── Setup chip interactions ──────────────────────────────────────────────────

function setupMultiChips(containerId) {
  document.querySelectorAll(`#${containerId} .chip`).forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      updateCompleteness();
    });
  });
}

function setupSingleChips(containerId, onChange) {
  document.querySelectorAll(`#${containerId} .chip`).forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll(`#${containerId} .chip`).forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      updateCompleteness();
      if (onChange) onChange(chip.dataset.val);
    });
  });
}

function setupDayMatrix() {
  document.querySelectorAll('#dayMatrix .day-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      setDay(btn.dataset.day, btn.dataset.val);
      updateCompleteness();
    });
  });
}

// ─── Save / delete profile ────────────────────────────────────────────────────

document.getElementById('saveProfile').addEventListener('click', () => {
  const name = document.getElementById('userName').value.trim();
  if (!name) { showSaveStatus('Please enter your name.', 'error'); return; }
  const grade = getSelectedSingle('gradeChips');
  if (!grade) { showSaveStatus('Please select your grade.', 'error'); return; }
  const directorates = getSelectedMulti('dirChips');
  if (directorates.length === 0) { showSaveStatus('Please select at least one directorate.', 'error'); return; }
  if (!daysComplete()) { showSaveStatus('Please set at least one working day (full, part or flex).', 'error'); return; }
  const location = getSelectedSingle('locChips');
  if (!location) { showSaveStatus('Please select a location.', 'error'); return; }
  const style = document.querySelector('#styleChips .selected')?.dataset.val || '';
  const overseas = location === 'Overseas' ? document.getElementById('overseasSelect').value : '';

  const availability = document.getElementById('userAvailability').value.trim();
  const fte = document.getElementById('userFte').value.trim();
  const workingPatternNotes = document.getElementById('userPatternNotes').value.trim();
  const skills = document.getElementById('userSkills').value.trim();
  const otherInfo = document.getElementById('userOtherInfo').value.trim();
  const daysNegotiable = document.querySelector('#negotiableChips .selected')?.dataset.val || '';

  state.profile = {
    name, grade, directorates,
    days: { ...dayState },
    fte, daysNegotiable,
    availability, skills, workingPatternNotes, otherInfo,
    style, location, overseas,
    lastActive: Date.now(),
    visibility: { ...visibilityState },
  };
  maybeBootstrapInbound();
  maybeBootstrapHiddenSuggested();
  saveState();
  updateBadges();
  colourFilterChips();
  document.getElementById('deleteProfile').style.display = 'inline-block';
  showSaveStatus('Profile saved! Finding your matches…', 'ok');
  setTimeout(() => switchTab('matches'), 1200);
});

document.getElementById('deleteProfile').addEventListener('click', () => {
  if (!confirm('Delete your profile? This will remove all your data including connections.')) return;
  localStorage.removeItem(STATE_KEY);
  location.reload();
});

function showSaveStatus(msg, type) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.className = 'save-status ' + type;
  el.style.display = 'block';
  if (type === 'ok') setTimeout(() => el.style.display = 'none', 3000);
}

// ─── Render matches ───────────────────────────────────────────────────────────

function renderMatches() {
  if (!state.profile) {
    document.getElementById('matchesNoProfile').style.display = 'block';
    document.getElementById('matchesContent').style.display = 'none';
    return;
  }
  document.getElementById('matchesNoProfile').style.display = 'none';
  document.getElementById('matchesContent').style.display = 'block';

  // Inbound requests
  const inboundIds = state.receivedRequests.filter(id => !state.connections.find(c => c.id === id));
  const inboundSec = document.getElementById('inboundSection');
  const inboundCards = document.getElementById('inboundCards');
  inboundCards.innerHTML = '';
  if (inboundIds.length > 0) {
    inboundSec.style.display = 'block';
    inboundIds.forEach(id => {
      const p = DUMMY_PROFILES.find(x => x.id === id);
      if (!p) return;
      inboundCards.appendChild(buildCard({ profile: p, ...scoreMatch(state.profile, p) }, 'inbound'));
    });
  } else {
    inboundSec.style.display = 'none';
  }

  // Suggested matches
  const allMatches = getMatches();
  let visible = allMatches.filter(m => {
    const id = m.profile.id;
    if (state.connections.find(c => c.id === id)) return false;
    if (state.receivedRequests.includes(id)) return false;
    if (!state.showDismissed && state.dismissed.includes(id)) return false;
    return true;
  });

  visible = applyFilters(visible);

  const cards = document.getElementById('matchCards');
  cards.innerHTML = '';

  if (visible.length === 0 && inboundIds.length === 0) {
    document.getElementById('noMatches').style.display = 'block';
  } else {
    document.getElementById('noMatches').style.display = 'none';
  }

  visible.forEach(m => {
    const ctx = state.sentRequests.includes(m.profile.id) ? 'sent-pending' : 'match';
    cards.appendChild(buildCard(m, ctx));
  });

  const hasDismissed = allMatches.some(m =>
    state.dismissed.includes(m.profile.id) && !state.connections.find(c => c.id === m.profile.id)
  );
  const showDRow = document.getElementById('showDismissedRow');
  showDRow.style.display = hasDismissed ? 'block' : 'none';
  document.getElementById('showDismissedBtn').textContent =
    state.showDismissed ? 'Hide dismissed profiles' : 'Show hidden profiles';

  updateBadges();
}

// ─── Match actions ────────────────────────────────────────────────────────────

function sendRequest(id) {
  if (state.sentRequests.includes(id)) return;
  state.sentRequests.push(id);
  saveState();
  renderMatches();
  if (Math.random() > 0.4) schedulePendingAccept(id);
}

function withdrawRequest(id) {
  state.sentRequests = state.sentRequests.filter(x => x !== id);
  delete state.pendingTimers[id];
  saveState();
  renderMatches();
  if (document.getElementById('tab-connections').classList.contains('active')) renderConnections();
}

function acceptRequest(id) {
  state.receivedRequests = state.receivedRequests.filter(x => x !== id);
  state.connections.push({ id, dir: 'received', ts: Date.now() });
  saveState();
  updateBadges();
  renderMatches();
  if (document.getElementById('tab-connections').classList.contains('active')) renderConnections();
}

function ignoreRequest(id) {
  state.receivedRequests = state.receivedRequests.filter(x => x !== id);
  state.dismissed.push(id);
  saveState();
  renderMatches();
}

function dismissMatch(id) {
  if (!Array.isArray(state.dismissed)) state.dismissed = [];
  if (!state.dismissed.includes(id)) state.dismissed.push(id);
  // Always re-hide dismissed cards after a dismiss action so the click has a
  // visible effect, even if the user previously toggled "Show hidden profiles".
  state.showDismissed = false;
  saveState();
  renderMatches();
}

// Delegated listener — catches clicks on any card button by data-action.
// Covers inbound / suggested / pending / connected contexts on both tabs.
function handleCardClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  switch (action) {
    case 'accept':            acceptRequest(id); break;
    case 'ignore':            ignoreRequest(id); break;
    case 'send':              sendRequest(id); break;
    case 'dismiss':           dismissMatch(id); break;
    case 'withdraw':          withdrawRequest(id); break;
    case 'remove-connection': removeConnection(id); break;
  }
}

['matchCards', 'inboundCards', 'connectedCards', 'pendingCards'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handleCardClick);
});

function removeConnection(id) {
  const p = DUMMY_PROFILES.find(x => x.id === id);
  const name = p ? p.name : 'this connection';
  if (!confirm(`Remove ${name} from your connections? They won't be notified. You can always re-connect via Matches later.`)) return;
  state.connections = state.connections.filter(c => c.id !== id);
  // Push into dismissed so they don't immediately reappear as a suggested match.
  // The regeneration logic will eventually cycle them back if the pool runs low.
  if (!state.dismissed.includes(id)) state.dismissed.push(id);
  saveState();
  updateBadges();
  renderConnections();
  if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
}

document.getElementById('showDismissedBtn').addEventListener('click', () => {
  state.showDismissed = !state.showDismissed;
  saveState();
  renderMatches();
});

// ─── Render connections ───────────────────────────────────────────────────────

function renderConnections() {
  if (!state.profile) {
    document.getElementById('connNoProfile').style.display = 'block';
    document.getElementById('connContent').style.display = 'none';
    return;
  }
  document.getElementById('connNoProfile').style.display = 'none';
  document.getElementById('connContent').style.display = 'block';

  renderConnectionBanner();

  const connSec = document.getElementById('connectedSection');
  const connCards = document.getElementById('connectedCards');
  connCards.innerHTML = '';
  if (state.connections.length > 0) {
    connSec.style.display = 'block';
    state.connections.slice().reverse().forEach(conn => {
      const p = DUMMY_PROFILES.find(x => x.id === conn.id);
      if (!p) return;
      connCards.appendChild(buildCard({ profile: p, ...scoreMatch(state.profile, p), conn }, 'connected'));
    });
  } else {
    connSec.style.display = 'none';
  }

  const pendSec = document.getElementById('pendingSection');
  const pendCards = document.getElementById('pendingCards');
  pendCards.innerHTML = '';
  const pending = state.sentRequests.filter(id => !state.connections.find(c => c.id === id));
  if (pending.length > 0) {
    pendSec.style.display = 'block';
    pending.forEach(id => {
      const p = DUMMY_PROFILES.find(x => x.id === id);
      if (!p) return;
      pendCards.appendChild(buildCard({ profile: p, ...scoreMatch(state.profile, p) }, 'sent-pending'));
    });
  } else {
    pendSec.style.display = 'none';
  }

  const empty = state.connections.length === 0 && pending.length === 0;
  document.getElementById('connEmptyState').style.display = empty ? 'block' : 'none';
}

function renderConnectionBanner() {
  const banner = document.getElementById('newConnBanner');
  if (!banner) return;
  if (state.newConnBanner) {
    banner.style.display = 'flex';
    banner.innerHTML = `<span style="font-size:16px;flex-shrink:0;">🎉</span>
      <span>${state.newConnBanner}</span>
      <button onclick="clearBanner()" style="margin-left:auto;background:none;border:none;cursor:pointer;color:#27500A;font-size:18px;line-height:1;padding:0 4px;">×</button>`;
  } else {
    banner.style.display = 'none';
  }
}

function clearBanner() {
  document.getElementById('newConnBanner').style.display = 'none';
  state.newConnBanner = null;
  saveState();
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function updateBadges() {
  const matchBadge = document.getElementById('matchBadge');
  const connBadge = document.getElementById('connBadge');
  if (!state.profile) {
    matchBadge.style.display = 'none';
    connBadge.style.display = 'none';
    return;
  }
  const inbound = state.receivedRequests.filter(id => !state.connections.find(c => c.id === id)).length;
  matchBadge.textContent = inbound;
  matchBadge.style.display = inbound > 0 ? 'inline-flex' : 'none';

  const total = state.connections.length;
  connBadge.textContent = total;
  connBadge.style.display = total > 0 ? 'inline-flex' : 'none';
}

// ─── Filter UI ────────────────────────────────────────────────────────────────

function colourFilterChips() {
  if (!state.profile) return;
  const p = state.profile;
  const GREEN = '#E9FAE6';
  const GREY  = '#EDEDED';

  // Days — green if user works that day (any value other than 'non')
  document.querySelectorAll('#filterDays .filter-chip').forEach(chip => {
    const v = (p.days || {})[chip.dataset.val];
    chip.dataset.profileBg = (v && v !== 'non') ? GREEN : GREY;
  });

  // Location — green if matches user's location
  document.querySelectorAll('#filterLoc .filter-chip').forEach(chip => {
    chip.dataset.profileBg = chip.dataset.val === p.location ? GREEN : GREY;
  });

  applyFilterChipColours();
}

function applyFilterChipColours() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    if (chip.classList.contains('selected')) {
      chip.style.background = '';  // clear inline — let CSS class take over
      chip.style.color = '';
    } else if (chip.dataset.profileBg) {
      chip.style.background = chip.dataset.profileBg;
      chip.style.color = '';
    } else {
      chip.style.background = '';
      chip.style.color = '';
    }
  });
}

document.getElementById('filterToggleBtn').addEventListener('click', () => {
  const bar = document.getElementById('filterBar');
  const btn = document.getElementById('filterToggleBtn');
  bar.classList.toggle('open');
  btn.classList.toggle('active');
  if (bar.classList.contains('open')) colourFilterChips();
});

document.getElementById('filterClearBtn').addEventListener('click', () => {
  filters.days = []; filters.loc = null; filters.activeWithin = null;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('filterClearBtn').style.display = 'none';
  applyFilterChipColours();
  renderMatches();
});

function setupFilterChips(containerId, onSelect) {
  document.querySelectorAll(`#${containerId} .filter-chip`).forEach(chip => {
    chip.addEventListener('click', () => {
      onSelect(chip);
      document.getElementById('filterClearBtn').style.display = hasActiveFilters() ? 'inline' : 'none';
      applyFilterChipColours();
      renderMatches();
    });
  });
}

// Note: grade / style / score filters remain in the DOM for now — they're removed
// in Change 16. We just don't wire them up. Days and Location are the only active ones.
if (document.getElementById('filterDays')) {
  setupFilterChips('filterDays', chip => {
    chip.classList.toggle('selected');
    filters.days = [...document.querySelectorAll('#filterDays .filter-chip.selected')].map(c => c.dataset.val);
  });
}
if (document.getElementById('filterLoc')) {
  setupFilterChips('filterLoc', chip => {
    const was = chip.classList.contains('selected');
    document.querySelectorAll('#filterLoc .filter-chip').forEach(c => c.classList.remove('selected'));
    if (!was) { chip.classList.add('selected'); filters.loc = chip.dataset.val; }
    else filters.loc = null;
  });
}
if (document.getElementById('filterActive')) {
  setupFilterChips('filterActive', chip => {
    const was = chip.classList.contains('selected');
    document.querySelectorAll('#filterActive .filter-chip').forEach(c => c.classList.remove('selected'));
    if (!was) { chip.classList.add('selected'); filters.activeWithin = parseInt(chip.dataset.val, 10); }
    else filters.activeWithin = null;
  });
}

// ─── Refresh button ───────────────────────────────────────────────────────────

function maybeAddSimulatedRequest() {
  if (!state.profile) return;
  const pending = state.receivedRequests.filter(id => !state.connections.find(c => c.id === id));
  if (pending.length >= 2) return;
  const prob = pending.length === 0 ? 0.8 : 0.3;
  if (Math.random() > prob) return;
  const user = state.profile;
  const isFree = (p) =>
    !state.receivedRequests.includes(p.id) &&
    !state.connections.find(c => c.id === p.id) &&
    !state.sentRequests.includes(p.id);
  const isPlausible = (p) => {
    if (!isFree(p)) return false;
    if (!userVisibleToCandidate(user, p)) return false;
    if (!candidateVisibleToSearcher(user, p)) return false;
    const { score } = scoreMatch(user, p);
    return score >= 50;
  };
  // First try candidates who already pass everything; otherwise pick any free
  // candidate and mutate them so they match. That way the pool never dries up.
  let eligible = DUMMY_PROFILES.filter(p =>
    !state.dismissed.includes(p.id) && isPlausible(p));
  let picked;
  if (eligible.length > 0) {
    picked = eligible[Math.floor(Math.random() * eligible.length)];
  } else {
    const fallback = DUMMY_PROFILES.filter(p => !state.dismissed.includes(p.id) && isFree(p));
    const pool = fallback.length > 0 ? fallback
                : (regenerateFromDismissed()
                    ? DUMMY_PROFILES.filter(p => isFree(p))
                    : []);
    if (pool.length === 0) return;
    picked = pool[Math.floor(Math.random() * pool.length)];
    ensureMustHaveMatch(picked, user);
  }
  state.receivedRequests.push(picked.id);
  state.activeOverrides = state.activeOverrides || {};
  state.activeOverrides[picked.id] = Date.now();
  saveState();
  updateBadges();
}

// Count visible suggested matches (same filtering as renderMatches).
function visibleSuggestedCount() {
  if (!state.profile) return 0;
  const all = getMatches();
  const visible = all.filter(m => {
    const id = m.profile.id;
    if (state.connections.find(c => c.id === id)) return false;
    if (state.receivedRequests.includes(id)) return false;
    if (!state.showDismissed && state.dismissed.includes(id)) return false;
    return true;
  });
  return applyFilters(visible).length;
}

// Mutate a candidate in place so that they pass every must-have gate (both the
// user's Definite search prefs and the candidate's own must-match visibility).
// Used when the pool runs thin so revealed / simulated profiles are always
// actually visible to the user — no "useless" cards sitting hidden forever.
function ensureMustHaveMatch(candidate, user) {
  if (!candidate || !user) return;
  const visibility = visibilityOf(candidate);
  const prefs = searchPrefs;

  // Grade
  if ((prefs.grade === 'definite' || visibility.grade === 'must')
      && candidate.grade !== user.grade) {
    candidate.grade = user.grade;
  }

  // Directorates — ensure at least one overlap
  const dirGate = prefs.directorates === 'definite' || visibility.directorates === 'must';
  if (dirGate && !directorateOverlapAny(user.directorates, candidate.directorates)) {
    const userRealDirs = (user.directorates || []).filter(d => d !== 'Open to any');
    if (userRealDirs.length > 0) {
      // Keep candidate's first directorate for some variety, add one of user's.
      const kept = (candidate.directorates || []).filter(d => d !== 'Open to any').slice(0, 1);
      candidate.directorates = Array.from(new Set([userRealDirs[0], ...kept]));
    } else if (!(candidate.directorates || []).includes('Open to any')) {
      candidate.directorates = [...(candidate.directorates || []), 'Open to any'];
    }
  }

  // Location (only if user has set it to Definite or candidate requires it as Must)
  const locGate = prefs.location === 'definite' || visibility.location === 'must';
  if (locGate && candidate.location !== user.location) {
    candidate.location = user.location;
    candidate.overseas = user.overseas || '';
  }

  // Days pattern — make it at least passably complementary (score >= 0.3)
  const daysGate = prefs.days === 'definite' || visibility.days === 'must';
  if (daysGate && dayComplementarityScore(user.days, candidate.days) < 0.3) {
    const newDays = {};
    DAYS_OF_WEEK.forEach(d => {
      const u = (user.days || {})[d] || 'non';
      newDays[d] = u === 'full' ? 'non' : u === 'non' ? 'full' : 'flexible';
    });
    candidate.days = newDays;
  }
}

// When the hidden pool has no eligible candidates to reveal, recycle any
// previously-dismissed profiles back into the hidden pool so the demo feels
// replenishing rather than running out.
function regenerateFromDismissed() {
  const dismissed = state.dismissed || [];
  if (dismissed.length === 0) return false;
  state.hiddenSuggested = [...(state.hiddenSuggested || []), ...dismissed];
  state.dismissed = [];
  return true;
}

function eligibleForReveal(ids, user) {
  return (ids || []).filter(id => {
    const p = DUMMY_PROFILES.find(x => x.id === id);
    if (!p) return false;
    return candidateVisibleToSearcher(user, p) && candidateSatisfiesSearcherGates(user, p, searchPrefs);
  });
}

function maybeRevealSuggestedMatch() {
  if (!state.profile) return;
  const visible = visibleSuggestedCount();
  // Probability table: 0→100%, 1→75%, 2→50%, 3→25%, 4+→30% (keep chance alive
  // so users who keep clicking can still grow the list).
  const probTable = [1.0, 0.75, 0.5, 0.25];
  const prob = visible < probTable.length ? probTable[visible] : 0.3;
  const user = state.profile;
  let hidden = state.hiddenSuggested || [];
  if (hidden.length === 0) {
    if (!regenerateFromDismissed()) return;
    hidden = state.hiddenSuggested || [];
  }
  if (hidden.length === 0) return;
  if (Math.random() > prob) return;
  // Prefer a profile that already passes the gates; otherwise pick any hidden
  // profile and mutate them so they do — no useless invisible cards left over.
  const user_ = user;
  const already = eligibleForReveal(hidden, user_);
  const pickedId = already.length > 0
    ? already[Math.floor(Math.random() * already.length)]
    : hidden[Math.floor(Math.random() * hidden.length)];
  const picked = DUMMY_PROFILES.find(x => x.id === pickedId);
  if (!picked) return;
  ensureMustHaveMatch(picked, user_);
  state.hiddenSuggested = hidden.filter(id => id !== pickedId);
  saveState();
}

document.getElementById('refreshSearchBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshSearchBtn');
  btn.classList.add('spinning');
  btn.disabled = true;
  setTimeout(() => {
    btn.classList.remove('spinning');
    btn.disabled = false;
    maybeAddSimulatedRequest();
    maybeRevealSuggestedMatch();
    renderMatches();
  }, 500);
});

document.getElementById('refreshBtn').addEventListener('click', () => {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  btn.disabled = true;
  setTimeout(() => {
    btn.classList.remove('spinning');
    btn.disabled = false;
    const active = document.querySelector('.tab-content.active');
    if (active.id === 'tab-matches') renderMatches();
    if (active.id === 'tab-connections') renderConnections();
  }, 700);
});

// ─── Grade chip setup ─────────────────────────────────────────────────────────

document.querySelectorAll('#gradeChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#gradeChips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    updateCompleteness();
  });
});

// ─── Overseas offices ─────────────────────────────────────────────────────────

function populateOverseas() {
  const sel = document.getElementById('overseasSelect');
  OVERSEAS_OFFICES.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  });
}

// ─── Periodic poll ────────────────────────────────────────────────────────────

setInterval(() => {
  if (document.getElementById('tab-connections').classList.contains('active')) {
    renderConnections();
  }
  if (document.getElementById('tab-matches').classList.contains('active')) {
    updateBadges();
  }
}, 2000);

// ─── Init ─────────────────────────────────────────────────────────────────────

populateOverseas();
setupMultiChips('dirChips');
setupDayMatrix();
setupSingleChips('locChips', (val) => { if (val === 'Overseas') toggleOverseas(); else document.getElementById('overseasWrap').style.display = 'none'; });
setupSingleChips('negotiableChips');
document.querySelectorAll('#styleChips .style-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('#styleChips .style-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    updateCompleteness();
  });
});

document.getElementById('userName').addEventListener('input', updateCompleteness);
document.getElementById('userAvailability').addEventListener('input', updateAvailabilityCount);
document.getElementById('userSkills').addEventListener('input', enforceSkillsWordCap);
updateAvailabilityCount();
updateSkillsWordCount();

// ─── Test fill (for demo / testing) ─────────────────────────────────────────

const TEST_FILL_DATA = {
  name: 'Test User',
  availability: 'Looking for roles in stage 2, open to discuss from May',
  grade: 'G7',
  directorates: ['Economic & Trade', 'Climate & Environment'],
  days: { Mon: 'full', Tue: 'full', Wed: 'part', Thu: 'non', Fri: 'non' },
  fte: '0.6 FTE',
  daysNegotiable: 'yes',
  workingPatternNotes: 'Can be flexible around school hours if needed',
  skills: '8 years FCDO, policy and programme lead, trade and climate specialism, team management experience',
  otherInfo: 'Open to considering any team where the work aligns',
  style: 'flexible',
  location: 'London - KCS',
  overseas: '',
};

function selectChipByVal(containerId, val) {
  document.querySelectorAll(`#${containerId} .chip`).forEach(c => {
    c.classList.toggle('selected', c.dataset.val === val);
  });
}

function selectMultiChipsByVals(containerId, vals) {
  document.querySelectorAll(`#${containerId} .chip`).forEach(c => {
    c.classList.toggle('selected', vals.includes(c.dataset.val));
  });
}

function fillTestData() {
  const d = TEST_FILL_DATA;
  document.getElementById('userName').value = d.name;
  document.getElementById('userAvailability').value = d.availability;
  document.getElementById('userFte').value = d.fte;
  document.getElementById('userPatternNotes').value = d.workingPatternNotes;
  document.getElementById('userSkills').value = d.skills;
  document.getElementById('userOtherInfo').value = d.otherInfo;

  selectChipByVal('gradeChips', d.grade);
  selectMultiChipsByVals('dirChips', d.directorates);
  DAYS_OF_WEEK.forEach(day => setDay(day, d.days[day] || 'non'));
  selectChipByVal('negotiableChips', d.daysNegotiable);
  document.querySelectorAll('#styleChips .style-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === d.style);
  });
  selectChipByVal('locChips', d.location);
  toggleOverseas();

  updateAvailabilityCount();
  updateSkillsWordCount();
  updateCompleteness();
}

document.getElementById('testFillBtn').addEventListener('click', fillTestData);

// ─── Collapsible sections (visibility + search prefs) ───────────────────────

function setupCollapsible(headerId, sectionId) {
  const header = document.getElementById(headerId);
  const section = document.getElementById(sectionId);
  if (!header || !section) return;
  header.addEventListener('click', () => section.classList.toggle('open'));
}

setupCollapsible('visibilityToggle', 'visibilitySection');
setupCollapsible('prefsToggle', 'prefsSection');

// ─── Visibility toggle state (Change 18) ────────────────────────────────────

let visibilityState = DEFAULT_VISIBILITY();

function syncVisibilityButtons() {
  document.querySelectorAll('#visibilityGrid .toggle-btn').forEach(btn => {
    const key = btn.dataset.vis;
    btn.classList.toggle('selected', visibilityState[key] === btn.dataset.val);
  });
}

document.querySelectorAll('#visibilityGrid .toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    visibilityState[btn.dataset.vis] = btn.dataset.val;
    syncVisibilityButtons();
  });
});

syncVisibilityButtons();

// ─── Search preferences toggle (Change 19) ──────────────────────────────────

function syncSearchPrefButtons() {
  document.querySelectorAll('[data-pref]').forEach(btn => {
    const key = btn.dataset.pref;
    btn.classList.toggle('selected', searchPrefs[key] === btn.dataset.val);
  });
}

document.querySelectorAll('[data-pref]').forEach(btn => {
  btn.addEventListener('click', () => {
    searchPrefs[btn.dataset.pref] = btn.dataset.val;
    saveSearchPrefs();
    syncSearchPrefButtons();
    if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
  });
});

syncSearchPrefButtons();

if (state.profile) {
  loadProfileIntoForm();
  maybeBootstrapInbound();
}

rehydrateTimers();
updateBadges();
updateCompleteness();
renderConnectionBanner();

// ─── Privacy modal ────────────────────────────────────────────────────────────

document.getElementById('privacyBtn').addEventListener('click', () => {
  document.getElementById('privacyOverlay').classList.add('open');
});

function closePrivacy() {
  document.getElementById('privacyOverlay').classList.remove('open');
}

function closePrivacyIfBg(e) {
  if (e.target === document.getElementById('privacyOverlay')) closePrivacy();
}

// ─── About modal ──────────────────────────────────────────────────────────────

document.getElementById('aboutBtn').addEventListener('click', () => {
  document.getElementById('aboutOverlay').classList.add('open');
});

function closeAbout() { document.getElementById('aboutOverlay').classList.remove('open'); }
function closeAboutIfBg(e) { if (e.target === document.getElementById('aboutOverlay')) closeAbout(); }

// ─── Admin modal ──────────────────────────────────────────────────────────────

const ADMIN_PASS = 'pairup-admin';

function isAdminUnlocked() { return sessionStorage.getItem('pairup_admin') === '1'; }

function checkAndShowAdmin() {
  if (isAdminUnlocked()) {
    openAdminPanel();
  } else {
    document.getElementById('adminUnlockOverlay').classList.add('open');
    document.getElementById('adminPassInput').value = '';
    document.getElementById('adminPassError').style.display = 'none';
    setTimeout(() => document.getElementById('adminPassInput').focus(), 100);
  }
}

document.getElementById('adminBtn').addEventListener('click', checkAndShowAdmin);

document.getElementById('adminPassSubmit').addEventListener('click', () => {
  const val = document.getElementById('adminPassInput').value.trim();
  if (val === ADMIN_PASS) {
    sessionStorage.setItem('pairup_admin', '1');
    closeUnlock();
    openAdminPanel();
  } else {
    document.getElementById('adminPassError').style.display = 'block';
    document.getElementById('adminPassInput').value = '';
  }
});

document.getElementById('adminPassInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('adminPassSubmit').click();
});

function closeUnlock() { document.getElementById('adminUnlockOverlay').classList.remove('open'); }
function closeUnlockIfBg(e) { if (e.target === document.getElementById('adminUnlockOverlay')) closeUnlock(); }

function openAdminPanel() {
  syncGradePenaltyRadios();
  document.getElementById('adminOverlay').classList.add('open');
}

function closeAdmin() { document.getElementById('adminOverlay').classList.remove('open'); }
function closeAdminIfBg(e) { if (e.target === document.getElementById('adminOverlay')) closeAdmin(); }

function syncGradePenaltyRadios() {
  const val = W.gradePenalty || 'heavy';
  const radio = document.querySelector(`input[name="gradePenalty"][value="${val}"]`);
  if (radio) radio.checked = true;
  document.querySelectorAll('input[name="gradePenalty"]').forEach(r => {
    r.addEventListener('change', () => { W.gradePenalty = r.value; });
  });
}

const saveBtn = document.getElementById('adminSaveBtn');
if (saveBtn) saveBtn.addEventListener('click', () => {
  saveWeights(W);
  closeAdmin();
  const active = document.querySelector('.tab-content.active');
  if (active.id === 'tab-matches') renderMatches();
  if (active.id === 'tab-connections') renderConnections();
});

const resetBtn = document.getElementById('adminResetBtn');
if (resetBtn) resetBtn.addEventListener('click', () => {
  Object.assign(W, DEFAULT_WEIGHTS);
  syncGradePenaltyRadios();
});

const lockBtn = document.getElementById('adminLockBtn');
if (lockBtn) lockBtn.addEventListener('click', () => {
  sessionStorage.removeItem('pairup_admin');
  closeAdmin();
});

if (isAdminUnlocked()) {
  document.getElementById('adminBtn').style.display = 'flex';
}

document.querySelector('.app-version').addEventListener('click', () => {
  document.getElementById('adminBtn').style.display = 'flex';
  document.getElementById('adminBtn').title = 'Admin settings (click to unlock)';
});

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key === 'A') {
    document.getElementById('adminBtn').style.display = 'flex';
    checkAndShowAdmin();
  }
});
