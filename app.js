// ─── State ───────────────────────────────────────────────────────────────────

const STATE_KEY = 'pairup_v2';
const CONSENT_KEY = 'pairup_consent_v1';
const SEEN_MATCHES_KEY = 'pairup_seenMatches_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : defaultState();
  } catch (e) { return defaultState(); }
}

function defaultState() {
  return {
    profile: null,
    dismissed: [],
    showDismissed: false,
    activelyLooking: true,
  };
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();

const DEFAULT_VISIBILITY = () => ({
  grade: 'must', directorates: 'must', location: 'open', days: 'open',
});

// Migrate any pre-existing profile from an older schema (working style field,
// "Open to any" directorate, days as array) so old localStorage doesn't crash.
if (state.profile) {
  const p = state.profile;
  if (Array.isArray(p.days)) {
    const arr = p.days;
    p.days = { Mon: 'non', Tue: 'non', Wed: 'non', Thu: 'non', Fri: 'non' };
    arr.forEach(d => { if (p.days[d] !== undefined) p.days[d] = 'full'; });
  }
  if (p.roles) delete p.roles;
  if (p.style) delete p.style;
  if (Array.isArray(p.directorates)) {
    p.directorates = p.directorates.map(d => d === 'Open to any' ? 'Match to any' : d);
  }
  if (!p.lastActive) p.lastActive = Date.now();
  if (!p.visibility) p.visibility = DEFAULT_VISIBILITY();
  ['availability', 'fte', 'daysNegotiable', 'skills', 'workingPatternNotes', 'otherInfo']
    .forEach(k => { if (p[k] === undefined) p[k] = ''; });
}
if (state.activelyLooking === undefined) state.activelyLooking = true;
// Drop leftover request/connection fields from older state schema.
['sentRequests', 'receivedRequests', 'connections', 'newConnBanner',
 'pendingTimers', 'hiddenSuggested', 'activeOverrides',
 '_bootstrapped', '_hiddenBootstrapped'].forEach(k => {
  if (state[k] !== undefined) delete state[k];
});

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const EMPTY_DAYS = () => ({ Mon: 'non', Tue: 'non', Wed: 'non', Thu: 'non', Fri: 'non' });

// Consent: once ticked, sticky across sessions.
function hasConsent() { return localStorage.getItem(CONSENT_KEY) === '1'; }
function setConsent() { localStorage.setItem(CONSENT_KEY, '1'); }

// Track which profile ids the user has already seen, so fresh refreshes can
// pin a small "New" pill against genuinely new cards.
function loadSeenMatches() {
  try {
    const raw = localStorage.getItem(SEEN_MATCHES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) { return new Set(); }
}
function saveSeenMatches(set) {
  localStorage.setItem(SEEN_MATCHES_KEY, JSON.stringify([...set]));
}
let seenMatches = loadSeenMatches();
// The set of ids flagged as "new" on the current render. Populated by
// renderMatches and cleared when the user leaves the tab.
let currentNewIds = new Set();

// Refresh-button churn (in-memory only, resets on reload). Each refresh hides
// one currently-visible profile and reveals one previously-hidden profile,
// simulating people joining and leaving the pool.
let refreshHiddenIds = new Set();
let refreshJustAddedId = null;
let refreshSeeded = false;

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

// ─── Search preferences ─────────────────────────────────────────────────────

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

function visibilityOf(candidate) {
  return { ...DEFAULT_VISIBILITY(), ...(candidate.visibility || {}) };
}

// ─── Day complementarity ─────────────────────────────────────────────────────

// Flexible is treated as "no constraint": pairing flexible with anything
// scores 0.8 regardless of the other side. The remaining values lean toward
// rewarding usable cover (full+non = perfect, full+full = useless overlap).
const DAY_PAIR_SCORES = {
  'full+non': 1.0, 'non+full': 1.0,
  'full+flexible': 0.8, 'flexible+full': 0.8,
  'flexible+flexible': 0.8,
  'flexible+part': 0.8, 'part+flexible': 0.8,
  'flexible+non': 0.8, 'non+flexible': 0.8,
  'part+non': 0.6, 'non+part': 0.6,
  'part+part': 0.7,
  'full+part': 0.5, 'part+full': 0.5,
  'non+non': 0.2,
  'full+full': 0.0,
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

const ANY_DIR = 'Match to any';

function sharedDirectorates(userDirs, candDirs) {
  const u = (userDirs || []).filter(d => d !== ANY_DIR);
  const c = (candDirs || []).filter(d => d !== ANY_DIR);
  const userOpen = (userDirs || []).includes(ANY_DIR);
  const candOpen = (candDirs || []).includes(ANY_DIR);
  if (candOpen && userOpen) return Array.from(new Set([...u, ...c]));
  if (candOpen) return u;
  if (userOpen) return c;
  return u.filter(d => c.includes(d));
}

function directorateOverlapAny(userDirs, candDirs) {
  const u = userDirs || [];
  const c = candDirs || [];
  if (u.includes(ANY_DIR) || c.includes(ANY_DIR)) return true;
  return u.some(d => c.includes(d));
}

// Directorate overlap is always at least 50% once gating has passed (the
// gate guarantees at least one shared directorate, so a "minimum" match
// is the floor, not a partial fail). The remaining 50% is split evenly
// across the user's *additional* directorate choices, so e.g. with 3
// chosen and 2 matched the score is 50 + (1/2)*50 = 75%.
function directorateScorePercent(userDirs, sharedCount) {
  if (sharedCount <= 0) return 0;
  const userTotal = (userDirs || []).filter(d => d !== ANY_DIR).length;
  if (userTotal <= 1) return 50;
  const extras = userTotal - 1;
  const extrasMatched = Math.max(0, sharedCount - 1);
  return 50 + (Math.min(extrasMatched, extras) / extras) * 50;
}

function rankScore(user, candidate, prefs) {
  prefs = prefs || searchPrefs;
  let score = 0;
  const breakdown = [];

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

  const sharedDirs = sharedDirectorates(user.directorates, candidate.directorates);
  const userDirCount = (user.directorates || []).filter(d => d !== ANY_DIR).length;
  const dirPct = directorateScorePercent(user.directorates, sharedDirs.length);
  const dirPts = Math.round((dirPct / 100) * 20);
  score += dirPts;
  let dirNote;
  if (sharedDirs.length === 0) {
    dirNote = 'No overlap';
  } else if (userDirCount <= 1) {
    dirNote = sharedDirs[0] || 'Open match';
  } else {
    dirNote = `${sharedDirs.length} of ${userDirCount} shared`;
  }
  breakdown.push({
    label: 'Directorate overlap',
    score: dirPts, max: 20,
    note: dirNote,
    fillOverride: sharedDirs.length > 0 ? 'fill-good' : null,
  });

  const ageDays = (Date.now() - (candidate.lastActive || 0)) / 86400000;
  let recencyPts = 0;
  let recencyNote = '';
  if (ageDays < 14) { recencyPts = 20; recencyNote = 'Active recently'; }
  else if (ageDays < 90) { recencyPts = 15; recencyNote = 'Active this quarter'; }
  else if (ageDays < 180) { recencyPts = 5; recencyNote = 'Active a few months ago'; }
  else { recencyNote = 'Not active for 6+ months'; }
  score += recencyPts;
  breakdown.push({ label: 'Recency', score: recencyPts, max: 20, note: recencyNote });

  let locPts = 0;
  if (user.location && candidate.location === user.location) locPts = 10;
  score += locPts;
  breakdown.push({
    label: 'Location',
    score: locPts, max: 10,
    note: locPts > 0 ? 'Same location' : 'Different location',
  });

  let prefBonus = 0;
  if (prefs.grade === 'preferred' && candidate.grade === user.grade) prefBonus += 10;
  if (prefs.directorates === 'preferred' && sharedDirs.length > 0) prefBonus += 8;
  if (prefs.location === 'preferred' && candidate.location === user.location) prefBonus += 5;
  if (prefs.days === 'preferred' && dayComp > 0.5) prefBonus += 7;
  if (prefBonus > 0) {
    score += prefBonus;
    breakdown.push({ label: 'Preferred bonuses', score: prefBonus, max: 30, note: 'From your search preferences' });
  }

  if (prefs.grade === 'preferred' && candidate.grade !== user.grade) {
    const uIdx = GRADE_IDX[user.grade] ?? 0;
    const cIdx = GRADE_IDX[candidate.grade] ?? 0;
    if (Math.abs(uIdx - cIdx) === 1) {
      const penalty = { hard: 1.0, heavy: 0.5, light: 0.25, none: 0 }[W.gradePenalty] ?? 0.5;
      score = Math.round(score * (1 - penalty));
    }
  }

  if (candidate.daysNegotiable === 'yes') score += 3;
  else if (candidate.daysNegotiable === 'possibly') score += 1;

  return { score: Math.min(Math.round(score), 100), breakdown };
}

function scoreMatch(user, candidate, prefs) {
  return rankScore(user, candidate, prefs);
}

// ─── Visibility gates ────────────────────────────────────────────────────────

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

function searcherInvisibleToCandidate(user, candidate) {
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
  return DUMMY_PROFILES
    .filter(candidate => {
      if (!candidateVisibleToSearcher(user, candidate)) return false;
      if (!candidateSatisfiesSearcherGates(user, candidate, searchPrefs)) return false;
      return true;
    })
    .map(p => {
      const sm = scoreMatch(user, p, searchPrefs);
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

// ─── Filters ─────────────────────────────────────────────────────────────────

const filters = { days: [], loc: null, activeWithin: null };

function applyFilters(matches) {
  return matches.filter(m => {
    const p = m.profile;
    if (filters.days.length > 0) {
      const ok = filters.days.every(d => {
        const v = (p.days || {})[d];
        return v === 'full' || v === 'part' || v === 'flexible';
      });
      if (!ok) return false;
    }
    if (filters.loc && p.location !== filters.loc) return false;
    if (filters.activeWithin) {
      const ts = p.lastActive;
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

// ─── Build a match card ──────────────────────────────────────────────────────

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

function initialsOf(name) {
  if (!name) return '';
  const letters = name.match(/[A-Z]/g) || [];
  return letters.slice(0, 3).map(l => l + '.').join('');
}

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

function userDaysSummaryText(days) {
  if (!days) return '—';
  const parts = DAYS_OF_WEEK.map(d => {
    const v = days[d] || 'non';
    const label = v === 'full' ? 'Full' : v === 'part' ? 'Part' : v === 'flexible' ? 'Flex' : 'Non';
    return `${d} ${label}`;
  });
  return parts.join(', ');
}

function buildMailto(candidate) {
  const user = state.profile;
  if (!user) return '#';
  const subject = `Possible job share: ${user.name} (${user.grade}) ↔ ${candidate.name} (${candidate.grade})`;
  const locUser = locationShort(user.location, user.overseas);
  const locCand = locationShort(candidate.location, candidate.overseas);
  const sharedDirs = sharedDirectorates(user.directorates, candidate.directorates);

  const lines = [];
  lines.push(`Hi ${candidate.name.split(' ')[0] || candidate.name},`);
  lines.push('');
  lines.push('I found you on FCDO PairUp and thought we might be a possible job share fit. A quick snapshot of me so you have the context:');
  lines.push('');
  lines.push(`- Name: ${user.name}`);
  lines.push(`- Grade: ${user.grade}`);
  lines.push(`- Directorates I'd consider: ${(user.directorates || []).join(', ')}`);
  lines.push(`- Location: ${locUser}`);
  lines.push(`- Working days: ${userDaysSummaryText(user.days)}`);
  if (user.fte) lines.push(`- FTE / hours: ${user.fte}`);
  if (user.daysNegotiable) {
    const neg = user.daysNegotiable === 'yes' ? 'Yes' : user.daysNegotiable === 'possibly' ? 'Possibly' : 'No';
    lines.push(`- Working pattern negotiable: ${neg}`);
  }
  if (user.availability) lines.push(`- Availability: ${user.availability}`);
  if (user.skills) lines.push(`- Skills / experience: ${user.skills}`);
  if (user.workingPatternNotes) lines.push(`- Working pattern notes: ${user.workingPatternNotes}`);
  if (user.otherInfo) lines.push(`- Other info (inc. working style): ${user.otherInfo}`);
  lines.push('');
  lines.push('From your profile I could see we might complement each other on:');
  if (sharedDirs.length > 0) lines.push(`- Shared directorate interest: ${sharedDirs.join(', ')}`);
  lines.push(`- Your days: ${userDaysSummaryText(candidate.days)}`);
  if (candidate.location === user.location) lines.push(`- We're both based in ${locCand}`);
  lines.push('');
  lines.push('Would you be up for a quick chat to see whether it’s worth exploring further?');
  lines.push('');
  lines.push('Thanks,');
  lines.push(user.name);

  const body = lines.join('\n');
  // mailto: addresses are not in the dummy data — leave blank so the user can paste
  // in the candidate's real internal email from the FCDO directory.
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function buildCard(matchObj, context) {
  const p = matchObj.profile;
  const pct = matchObj.score !== undefined ? scoreToPercent(matchObj.score) : null;
  const locDisplay = locationShort(p.location, p.overseas);

  const accent = pct !== null ? accentColor(pct) : '#ccc';
  const matchColor = pct !== null ? matchTextColor(pct) : '#888';

  const hideName = !!matchObj.hideName;
  const isNew = !hideName && currentNewIds.has(p.id);
  const newPill = isNew ? `<span class="ccard-new-pill" title="New since your last refresh">New</span>` : '';
  const displayName = hideName
    ? `<span class="ccard-name-initials">${escapeHtml(initialsOf(p.name))}</span> <span class="ccard-name-hint">[Name visible once criteria are met]</span>`
    : `<span class="ccard-name">${escapeHtml(p.name)}</span>${newPill}`;

  const gradeMatch = state.profile && p.grade === state.profile.grade;
  const gradeBadge = `<span class="ctag ${gradeMatch ? 'ctag-green' : 'ctag-grey'}">${p.grade}</span>`;

  // Only show directorates that actually overlap with the user's, so cards
  // expose less information about the candidate than before.
  const overlap = state.profile
    ? sharedDirectorates(state.profile.directorates, p.directorates).slice(0, 3)
    : [];
  const dirTags = overlap.map(d =>
    `<span class="ctag ctag-green">${escapeHtml(d)}</span>`).join('');

  const availabilityRow = p.availability
    ? `<div class="ccard-availability" title="${escapeHtml(p.availability)}">${escapeHtml(truncate(p.availability, 80))}</div>`
    : '';

  const fteHtml = p.fte ? `<span class="cfte">${escapeHtml(p.fte)}</span>` : '';
  const dayPatternHtml = `<span class="cdays">${daysSummary(p.days)}</span>`;
  let negotiableTag = '';
  if (p.daysNegotiable === 'yes') negotiableTag = `<span class="ctag ctag-green">Negotiable</span>`;
  else if (p.daysNegotiable === 'possibly') negotiableTag = `<span class="ctag ctag-amber">Possibly</span>`;
  const patternRow = `<div class="ccard-pattern-row">${fteHtml}${dayPatternHtml}${negotiableTag}</div>`;

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

  const locTag = `<span class="ctag ctag-grey">${locDisplay}</span>`;

  const stale = stalenessInfo(p.lastActive);
  const staleHtml = stale.text
    ? `<span class="cstale ${stale.klass}"${stale.tooltip ? ` title="${escapeHtml(stale.tooltip)}"` : ''}>${stale.text}</span>`
    : '';

  let bottomInfo = '';
  if (pct !== null) {
    bottomInfo = `<div class="ccard-bottom">
      <span class="cmatch" style="color:${matchColor};" onclick="openScoreModal('${p.id}')">${pct}% match</span>
      ${staleHtml ? ` · ${staleHtml}` : ''}
      <a class="cfp" onclick="openProfileModal('${p.id}')">Full profile…</a>
    </div>`;
  }

  const btnBlue = `background:var(--btn-primary);color:var(--btn-primary-text);`;
  const btnGhost = `background:transparent;color:#999;border:0.5px solid #ccc;`;
  const btnBase = `all:unset;display:block;width:100%;box-sizing:border-box;text-align:center;font-size:12px;font-weight:500;padding:6px 0;border-radius:7px;cursor:pointer;`;

  const mailto = hideName ? '#' : buildMailto(p);
  const mailAttrs = hideName ? 'aria-disabled="true" onclick="return false;"' : `href="${escapeHtml(mailto)}"`;

  const rightCol = `
    <a ${mailAttrs} style="${btnBase}${btnBlue}text-decoration:none;display:flex;align-items:center;justify-content:center;gap:5px;">
      <svg width="11" height="11" viewBox="0 0 13 13" fill="none"><rect x="1" y="2.5" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 4l5.5 3.5L12 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      Email
    </a>
    <button type="button" style="${btnBase}${btnGhost}" data-action="dismiss" data-id="${p.id}">Dismiss</button>`;

  const card = document.createElement('div');
  card.className = 'ccard';
  card.dataset.id = p.id;
  card.innerHTML = `
    <div class="ccard-accent" style="background:${accent};"></div>
    <div class="ccard-inner">
      <div class="ccard-left">
        <div class="ccard-name-row">
          ${displayName}
        </div>
        ${availabilityRow}
        <div class="ccard-tags">${gradeBadge}${dirTags}${locTag}</div>
        ${patternRow}
        ${warnRow}
        ${bottomInfo}
      </div>
      <div class="ccard-right">${rightCol}</div>
    </div>`;

  return card;
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
        <div class="modal-section-label">Other information (including working style)</div>
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
    const fillClass = b.fillOverride
      || (barPct >= 70 ? 'fill-good' : barPct >= 30 ? 'fill-ok' : 'fill-low');
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
    <div class="modal-score-note">
      This score ranks profiles that already pass the gates (grade, directorate, and any other &ldquo;Definite&rdquo; criteria in your search settings). See <em>How matching works</em> on the Potential matches tab for the full logic.
    </div>
  `);
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(name) {
  // If we're leaving the matches tab, mark all "new" ids as seen so they stop
  // being flagged on the next render.
  const wasMatches = document.getElementById('tab-matches').classList.contains('active');
  if (wasMatches && name !== 'matches' && currentNewIds.size > 0) {
    currentNewIds.forEach(id => seenMatches.add(id));
    saveSeenMatches(seenMatches);
    currentNewIds = new Set();
  }
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  window.scrollTo(0, 0);
  if (name === 'matches') renderMatches();
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
  const fill = document.getElementById('complFill');
  fill.style.width = pct + '%';
  fill.classList.toggle('complete', pct === 100);
  const labels = ['Profile incomplete', 'Getting started', 'Keep going…', 'Half way there', 'Almost there', 'Profile complete'];
  document.getElementById('complLabel').textContent = labels[filled] || 'Profile complete';

  updateSaveButtonState();
}

function updateSaveButtonState() {
  const btn = document.getElementById('saveProfile');
  const check = document.getElementById('consentCheck');
  if (!btn || !check) return;
  const active = state.activelyLooking !== false;
  btn.disabled = !check.checked || !active;
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

  DAYS_OF_WEEK.forEach(d => {
    const val = (p.days && p.days[d]) || 'non';
    setDay(d, val);
  });

  document.querySelectorAll('#negotiableChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.daysNegotiable);
  });

  Object.assign(visibilityState, DEFAULT_VISIBILITY(), p.visibility || {});
  syncVisibilityButtons();

  document.querySelectorAll('#locChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.location);
  });
  toggleOverseas();
  if (p.overseas) document.getElementById('overseasSelect').value = p.overseas;
  updateAvailabilityCount();
  updateSkillsWordCount();
  updateCompleteness();
  document.getElementById('deleteGroup').style.display = 'inline-flex';
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
  const words = input.value.split(/(\s+)/);
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

// ─── Chip interactions ──────────────────────────────────────────────────────

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

// ─── Save / delete profile ──────────────────────────────────────────────────

document.getElementById('saveProfile').addEventListener('click', () => {
  if (!document.getElementById('consentCheck').checked) {
    showSaveStatus('Please tick the consent box before saving.', 'error');
    return;
  }
  const name = document.getElementById('userName').value.trim();
  if (!name) { showSaveStatus('Please enter your name.', 'error'); return; }
  const grade = getSelectedSingle('gradeChips');
  if (!grade) { showSaveStatus('Please select your grade.', 'error'); return; }
  const directorates = getSelectedMulti('dirChips');
  if (directorates.length === 0) { showSaveStatus('Please select at least one directorate (or "Match to any").', 'error'); return; }
  if (!daysComplete()) { showSaveStatus('Please set at least one working day (full, part or flex).', 'error'); return; }
  const location = getSelectedSingle('locChips');
  if (!location) { showSaveStatus('Please select a location.', 'error'); return; }
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
    location, overseas,
    lastActive: Date.now(),
    visibility: { ...visibilityState },
  };
  setConsent();
  saveState();
  colourFilterChips();
  document.getElementById('deleteGroup').style.display = 'inline-flex';
  showSaveStatus('Profile saved! Finding your matches…', 'ok');
  setTimeout(() => switchTab('matches'), 1200);
});

document.getElementById('deleteProfile').addEventListener('click', () => {
  if (!confirm('Delete your profile? This will remove all your data from this browser.')) return;
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(SEEN_MATCHES_KEY);
  location.reload();
});

function showSaveStatus(msg, type) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.className = 'save-status ' + type;
  el.style.display = 'block';
  if (type === 'ok') setTimeout(() => el.style.display = 'none', 3000);
}

// Consent checkbox gates the save button.
document.getElementById('consentCheck').addEventListener('change', updateSaveButtonState);

// ─── Actively-looking toggle ────────────────────────────────────────────────

function applyActiveLookingState() {
  const active = state.activelyLooking !== false;
  document.body.classList.toggle('profile-form-disabled', !active);
  const tab = document.getElementById('tab-profile');
  if (tab) {
    // Block keyboard input on form fields when inactive. The toggle itself
    // sits outside .form-group / .form-actions so it stays enabled.
    tab.querySelectorAll('input:not(#activeToggle), textarea, select, button:not(#activeToggle)')
      .forEach(el => {
        if (el.closest('.active-toggle-row')) return;
        el.disabled = !active;
      });
  }
  updateSaveButtonState();
}

document.getElementById('activeToggle').addEventListener('change', e => {
  state.activelyLooking = e.target.checked;
  saveState();
  applyActiveLookingState();
  if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
});

// ─── Render matches ──────────────────────────────────────────────────────────

function renderMatches() {
  const noProfileEl = document.getElementById('matchesNoProfile');
  const inactiveEl = document.getElementById('matchesInactive');
  const contentEl = document.getElementById('matchesContent');

  if (!state.profile) {
    noProfileEl.style.display = 'block';
    inactiveEl.style.display = 'none';
    contentEl.style.display = 'none';
    currentNewIds = new Set();
    updateBadges();
    return;
  }
  if (!state.activelyLooking) {
    noProfileEl.style.display = 'none';
    inactiveEl.style.display = 'block';
    contentEl.style.display = 'none';
    currentNewIds = new Set();
    updateBadges();
    return;
  }
  noProfileEl.style.display = 'none';
  inactiveEl.style.display = 'none';
  contentEl.style.display = 'block';

  seedRefreshHiddenIfNeeded();

  const allMatches = getMatches();
  let visible = allMatches.filter(m => {
    const id = m.profile.id;
    if (!state.showDismissed && state.dismissed.includes(id)) return false;
    if (refreshHiddenIds.has(id)) return false;
    return true;
  });

  visible = applyFilters(visible);

  // Compute which ids are "new" vs. already seen.
  currentNewIds = new Set();
  visible.forEach(m => {
    if (!m.hideName && !seenMatches.has(m.profile.id)) {
      currentNewIds.add(m.profile.id);
    }
  });
  if (refreshJustAddedId && visible.some(m => m.profile.id === refreshJustAddedId)) {
    currentNewIds.add(refreshJustAddedId);
  }

  const cards = document.getElementById('matchCards');
  cards.innerHTML = '';

  document.getElementById('noMatches').style.display = visible.length === 0 ? 'block' : 'none';

  visible.forEach(m => cards.appendChild(buildCard(m, 'match')));

  const prefsCount = document.getElementById('prefsCount');
  if (prefsCount) {
    const total = allMatches.length;
    prefsCount.textContent = `${total} match${total === 1 ? '' : 'es'}`;
  }

  const hasDismissed = allMatches.some(m => state.dismissed.includes(m.profile.id));
  const showDRow = document.getElementById('showDismissedRow');
  showDRow.style.display = hasDismissed ? 'block' : 'none';
  document.getElementById('showDismissedBtn').textContent =
    state.showDismissed ? 'Hide dismissed profiles' : 'Show hidden profiles';

  updateBadges();
}

// ─── Dismiss action ──────────────────────────────────────────────────────────

function dismissMatch(id) {
  if (!Array.isArray(state.dismissed)) state.dismissed = [];
  if (!state.dismissed.includes(id)) state.dismissed.push(id);
  state.showDismissed = false;
  saveState();
  renderMatches();
}

function handleCardClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'dismiss') dismissMatch(id);
}

document.getElementById('matchCards').addEventListener('click', handleCardClick);

document.getElementById('showDismissedBtn').addEventListener('click', () => {
  state.showDismissed = !state.showDismissed;
  saveState();
  renderMatches();
});

// ─── Badges ──────────────────────────────────────────────────────────────────

function updateBadges() {
  const matchBadge = document.getElementById('matchBadge');
  if (!matchBadge) return;
  if (!state.profile) { matchBadge.style.display = 'none'; return; }
  // Badge shows the count of "new since last refresh" matches on the tab.
  const n = currentNewIds.size;
  matchBadge.textContent = n;
  matchBadge.style.display = n > 0 ? 'inline-flex' : 'none';
}

// ─── Filter UI ───────────────────────────────────────────────────────────────

function colourFilterChips() {
  if (!state.profile) return;
  const p = state.profile;
  const GREEN = '#E9FAE6';
  const GREY  = '#EDEDED';

  document.querySelectorAll('#filterDays .filter-chip').forEach(chip => {
    const v = (p.days || {})[chip.dataset.val];
    chip.dataset.profileBg = (v && v !== 'non') ? GREEN : GREY;
  });

  document.querySelectorAll('#filterLoc .filter-chip').forEach(chip => {
    chip.dataset.profileBg = chip.dataset.val === p.location ? GREEN : GREY;
  });

  applyFilterChipColours();
}

function applyFilterChipColours() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    if (chip.classList.contains('selected')) {
      // Clear inline style so the .selected CSS class can take over.
      chip.style.background = '';
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

// ─── Refresh button ──────────────────────────────────────────────────────────
// Each refresh hides one random visible profile and unhides one previously-
// hidden one (which gets a "New" pill), so the list churns a little to
// simulate a live pool.

function eligibleMatchIds() {
  if (!state.profile || !state.activelyLooking) return [];
  return getMatches()
    .filter(m => !state.dismissed.includes(m.profile.id))
    .map(m => m.profile.id);
}

function seedRefreshHiddenIfNeeded() {
  if (refreshSeeded) return;
  const eligible = eligibleMatchIds();
  if (eligible.length < 4) return;
  refreshSeeded = true;
  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  shuffled.slice(0, 2).forEach(id => refreshHiddenIds.add(id));
}

function performRefreshSwap() {
  const eligible = eligibleMatchIds();
  if (eligible.length === 0) { refreshJustAddedId = null; return; }

  const visibleIds = eligible.filter(id => !refreshHiddenIds.has(id));
  if (visibleIds.length > 1) {
    const idToHide = visibleIds[Math.floor(Math.random() * visibleIds.length)];
    refreshHiddenIds.add(idToHide);
  }

  const hidden = [...refreshHiddenIds].filter(id => eligible.includes(id));
  if (hidden.length > 0) {
    const idToShow = hidden[Math.floor(Math.random() * hidden.length)];
    refreshHiddenIds.delete(idToShow);
    refreshJustAddedId = idToShow;
  } else {
    refreshJustAddedId = null;
  }
}

function triggerRefresh(btn) {
  btn.classList.add('spinning');
  btn.disabled = true;
  const onMatchesTab = document.getElementById('tab-matches').classList.contains('active');
  if (onMatchesTab) performRefreshSwap();
  setTimeout(() => {
    btn.classList.remove('spinning');
    btn.disabled = false;
    if (onMatchesTab) renderMatches();
  }, 500);
}

document.getElementById('refreshSearchBtn').addEventListener('click', e => triggerRefresh(e.currentTarget));
document.getElementById('refreshBtn').addEventListener('click', e => triggerRefresh(e.currentTarget));

// ─── Grade chip setup ────────────────────────────────────────────────────────

document.querySelectorAll('#gradeChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#gradeChips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    updateCompleteness();
  });
});

// ─── Overseas offices ────────────────────────────────────────────────────────

function populateOverseas() {
  const sel = document.getElementById('overseasSelect');
  OVERSEAS_OFFICES.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────

populateOverseas();
setupMultiChips('dirChips');
setupDayMatrix();
setupSingleChips('locChips', (val) => { if (val === 'Overseas') toggleOverseas(); else document.getElementById('overseasWrap').style.display = 'none'; });
setupSingleChips('negotiableChips');

document.getElementById('userName').addEventListener('input', updateCompleteness);
document.getElementById('userAvailability').addEventListener('input', updateAvailabilityCount);
document.getElementById('userSkills').addEventListener('input', enforceSkillsWordCap);
updateAvailabilityCount();
updateSkillsWordCount();

// Sticky consent: if the user has already accepted in a previous session,
// pre-tick the box so Save isn't blocked for them every time.
if (hasConsent()) {
  document.getElementById('consentCheck').checked = true;
}
updateSaveButtonState();

// ─── Test fill (demo / QA) ──────────────────────────────────────────────────

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
  otherInfo: 'Prefer a clean-handover working style, happy to have a weekly overlap call. Open to considering any team where the work aligns.',
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
  selectChipByVal('locChips', d.location);
  toggleOverseas();

  updateAvailabilityCount();
  updateSkillsWordCount();
  updateCompleteness();
}

document.getElementById('testFillBtn').addEventListener('click', fillTestData);

// ─── Collapsible sections (visibility + search prefs + how matching works) ──

function setupCollapsible(headerId, sectionId) {
  const header = document.getElementById(headerId);
  const section = document.getElementById(sectionId);
  if (!header || !section) return;
  header.addEventListener('click', () => section.classList.toggle('open'));
}

setupCollapsible('visibilityToggle', 'visibilitySection');
setupCollapsible('prefsToggle', 'prefsSection');
setupCollapsible('howToggle', 'howSection');

// ─── Visibility toggle state ────────────────────────────────────────────────

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

// ─── Search preferences toggle ──────────────────────────────────────────────

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
}

document.getElementById('activeToggle').checked = state.activelyLooking !== false;
applyActiveLookingState();

updateBadges();
updateCompleteness();

// ─── Privacy modal ───────────────────────────────────────────────────────────

document.getElementById('privacyBtn').addEventListener('click', () => {
  document.getElementById('privacyOverlay').classList.add('open');
});

function closePrivacy() {
  document.getElementById('privacyOverlay').classList.remove('open');
}

function closePrivacyIfBg(e) {
  if (e.target === document.getElementById('privacyOverlay')) closePrivacy();
}

// ─── About modal ─────────────────────────────────────────────────────────────

document.getElementById('aboutBtn').addEventListener('click', () => {
  document.getElementById('aboutOverlay').classList.add('open');
});

function closeAbout() { document.getElementById('aboutOverlay').classList.remove('open'); }
function closeAboutIfBg(e) { if (e.target === document.getElementById('aboutOverlay')) closeAbout(); }

// ─── Delete-profile help modal ──────────────────────────────────────────────

document.getElementById('deleteHelpBtn').addEventListener('click', () => {
  document.getElementById('deleteHelpOverlay').classList.add('open');
});

function closeDeleteHelp() { document.getElementById('deleteHelpOverlay').classList.remove('open'); }
function closeDeleteHelpIfBg(e) { if (e.target === document.getElementById('deleteHelpOverlay')) closeDeleteHelp(); }

// ─── Theme toggle (Modern / Classic / Frontier) ─────────────────────────────

const THEME_KEY = 'pairup_theme_v1';
const THEMES = [
  { id: 'modern',         label: 'Modern',        className: '' },
  { id: 'classic',        label: 'Classic',       className: 'theme-classic' },
  { id: 'simple',         label: 'Simple',        className: 'theme-simple' },
  { id: 'frontier',       label: 'Frontier',      className: 'theme-frontier' },
  { id: 'frontier-bold',  label: 'Frontier Bold', className: 'theme-frontier-bold' },
];

function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  THEMES.forEach(t => { if (t.className) document.body.classList.remove(t.className); });
  if (theme.className) document.body.classList.add(theme.className);
  const label = document.getElementById('themeBtnLabel');
  if (label) label.textContent = theme.label;
  localStorage.setItem(THEME_KEY, theme.id);
}

function cycleTheme() {
  const current = localStorage.getItem(THEME_KEY) || THEMES[0].id;
  const idx = THEMES.findIndex(t => t.id === current);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next.id);
}

const savedTheme = localStorage.getItem(THEME_KEY);
applyTheme(savedTheme || THEMES[Math.floor(Math.random() * THEMES.length)].id);
document.getElementById('themeBtn').addEventListener('click', cycleTheme);

// ─── Version / what's new modal ─────────────────────────────────────────────

document.getElementById('versionBtn').addEventListener('click', () => {
  document.getElementById('versionOverlay').classList.add('open');
});

function closeVersion() { document.getElementById('versionOverlay').classList.remove('open'); }
function closeVersionIfBg(e) { if (e.target === document.getElementById('versionOverlay')) closeVersion(); }

// ─── Matches intro modal ────────────────────────────────────────────────────

document.getElementById('matchesIntroBtn').addEventListener('click', () => {
  document.getElementById('matchesIntroOverlay').classList.add('open');
});

function closeMatchesIntro() {
  document.getElementById('matchesIntroOverlay').classList.remove('open');
}
function closeMatchesIntroIfBg(e) {
  if (e.target === document.getElementById('matchesIntroOverlay')) closeMatchesIntro();
}

// ─── Optional-info help modal ───────────────────────────────────────────────

document.getElementById('optionalHelpBtn').addEventListener('click', () => {
  document.getElementById('helpOverlay').classList.add('open');
});

function closeHelp() { document.getElementById('helpOverlay').classList.remove('open'); }
function closeHelpIfBg(e) { if (e.target === document.getElementById('helpOverlay')) closeHelp(); }

// ─── Admin modal ─────────────────────────────────────────────────────────────

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
  if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
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
