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
    sentRequests: [],      // ids we sent  to
    receivedRequests: [],  // ids that requested us
    connections: [],       // { id, dir:'sent'|'received', ts }
    dismissed: [],
    showDismissed: false,
    newConnBanner: null,
    pendingTimers: {},     // id -> scheduledAt timestamp (persisted so reload survives)
    _bootstrapped: false,
  };
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();

// ─── Simulated inbound bootstrap ─────────────────────────────────────────────

function maybeBootstrapInbound() {
  if (!state.profile || state._bootstrapped) return;
  state._bootstrapped = true;
  ['p001', 'p009'].forEach(id => {
    if (!state.receivedRequests.includes(id) &&
        !state.connections.find(c => c.id === id) &&
        !state.sentRequests.includes(id)) {
      state.receivedRequests.push(id);
    }
  });
  saveState();
}

// ─── Pending timer management ─────────────────────────────────────────────────
// We store the scheduled-at time in state so timers survive page reload.
// On init we check for any overdue pending timers and re-schedule them.

function schedulePendingAccept(id) {
  const delay = 3000 + Math.random() * 4000;
  const scheduledAt = Date.now();
  state.pendingTimers[id] = { scheduledAt, delay };
  saveState();
  setTimeout(() => resolvePending(id), delay);
}

function resolvePending(id) {
  // Guard: only resolve if still pending
  if (!state.sentRequests.includes(id)) return;
  if (state.connections.find(c => c.id === id)) return;
  delete state.pendingTimers[id];
  state.sentRequests = state.sentRequests.filter(x => x !== id);
  state.connections.push({ id, dir: 'sent', ts: Date.now() });
  const p = DUMMY_PROFILES.find(x => x.id === id);
  state.newConnBanner = p ? `${p.name} accepted your request!` : 'A new connection accepted your request!';
  saveState();
  updateBadges();
  // Refresh whichever tab is visible
  if (document.getElementById('tab-connections').classList.contains('active')) renderConnections();
  if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
}

function rehydrateTimers() {
  // Re-schedule any timers that were pending when the page last closed
  const timers = state.pendingTimers || {};
  Object.entries(timers).forEach(([id, info]) => {
    if (!state.sentRequests.includes(id)) {
      // Already resolved somehow, clean up
      delete state.pendingTimers[id];
      return;
    }
    const elapsed = Date.now() - info.scheduledAt;
    const remaining = Math.max(0, info.delay - elapsed);
    setTimeout(() => resolvePending(id), remaining);
  });
}

// ─── Matching ────────────────────────────────────────────────────────────────

const MAX_SCORE = 115;

function scoreMatch(user, candidate) {
  let score = 0;
  const breakdown = [];

  // Grade: same = 40pts, ±1 = 25, ±2 = 10
  const uIdx = GRADE_IDX[user.grade] ?? 0;
  const cIdx = GRADE_IDX[candidate.grade] ?? 0;
  const gradeDiff = Math.abs(uIdx - cIdx);
  let gradeScore = 0;
  if (gradeDiff === 0) gradeScore = 40;
  else if (gradeDiff === 1) gradeScore = 25;
  else if (gradeDiff === 2) gradeScore = 10;
  score += gradeScore;
  breakdown.push({
    label: 'Grade',
    score: gradeScore,
    max: 40,
    note: gradeDiff === 0 ? 'Same grade' : gradeDiff === 1 ? '1 grade apart' : gradeDiff === 2 ? '2 grades apart' : 'Very different grades'
  });

  // Role overlap: 25pts if any shared
  const roleOverlap = user.roles.filter(r => candidate.roles.includes(r));
  const roleScore = roleOverlap.length > 0 ? 25 : 0;
  score += roleScore;
  breakdown.push({
    label: 'Role fit',
    score: roleScore,
    max: 25,
    note: roleOverlap.length > 0 ? roleOverlap.slice(0,2).join(', ') : 'No roles in common'
  });

  // Directorate: 20pts base + 5 bonus for multiple
  const dirOverlap = user.directorates.filter(d =>
    d === 'Open to any' || candidate.directorates.includes(d) || candidate.directorates.includes('Open to any')
  );
  let dirScore = 0;
  if (dirOverlap.length > 0) { dirScore = 20; if (dirOverlap.length > 1) dirScore = 25; }
  score += dirScore;
  const displayDirs = dirOverlap.filter(d => d !== 'Open to any');
  breakdown.push({
    label: 'Directorate',
    score: dirScore,
    max: 25,
    note: displayDirs.length > 0 ? displayDirs.slice(0,2).join(', ') : dirOverlap.includes('Open to any') ? 'Open to any' : 'No overlap'
  });

  // Days complementarity
  const userDays = new Set(user.days);
  const candDays = new Set(candidate.days);
  const overlapCount = [...userDays].filter(d => candDays.has(d)).length;
  const totalCoverage = new Set([...userDays, ...candDays]).size;
  let dayScore = 0;
  let dayNote = '';
  if (overlapCount === 0 && totalCoverage >= 4) { dayScore = 15; dayNote = 'Excellent coverage'; }
  else if (overlapCount <= 1 && totalCoverage >= 4) { dayScore = 10; dayNote = 'Good coverage'; }
  else if (overlapCount <= 2) { dayScore = 5; dayNote = 'Partial overlap'; }
  else { dayNote = 'Heavy day overlap'; }
  score += dayScore;
  breakdown.push({ label: 'Day pattern', score: dayScore, max: 15, note: dayNote });

  // Style: 10pts same, 5pts if flexible
  let styleScore = 0;
  let styleNote = '';
  if (user.style && candidate.style) {
    if (user.style === candidate.style) { styleScore = 10; styleNote = 'Same style'; }
    else if (user.style === 'flexible' || candidate.style === 'flexible' || user.style === 'unsure' || candidate.style === 'unsure') {
      styleScore = 5; styleNote = 'Flexible';
    } else { styleNote = 'Different styles'; }
  } else { styleNote = 'Not specified'; }
  score += styleScore;
  breakdown.push({ label: 'Working style', score: styleScore, max: 10, note: styleNote });

  // Matched tags for card display
  const matched = [];
  if (roleOverlap.length > 0) roleOverlap.slice(0,2).forEach(r => matched.push({ label: r, type: 'role' }));
  if (displayDirs.length > 0) matched.push({ label: displayDirs[0], type: 'dir' });
  if (dayScore >= 10) matched.push({ label: candidate.days.join(' '), type: 'days' });
  if (styleScore === 10) matched.push({ label: styleLabel(candidate.style), type: 'style' });

  return { score: Math.min(score, MAX_SCORE), breakdown, matched };
}

function scoreToPercent(score) {
  return Math.round(Math.min((score / MAX_SCORE) * 100, 100));
}

function scoreClass(pct) {
  if (pct >= 65) return 'score-high';
  if (pct >= 40) return 'score-med';
  return 'score-low';
}

function styleLabel(s) {
  return { clean: 'Clean handover', collaborative: 'Collaborative', flexible: 'Flexible', unsure: 'Not sure yet' }[s] || s;
}

function locationShort(loc, overseas) {
  if (loc === 'Overseas' && overseas) return overseas;
  return loc || '—';
}

function locTagStyle(loc) {
  if (loc === 'London - KCS') return 'background:#EEEDFE;color:#3C3489;';
  if (loc === 'East Kilbride') return 'background:#FAEEDA;color:#633806;';
  if (loc === 'Remote') return 'background:#E1F5EE;color:#085041;';
  if (loc === 'Overseas') return 'background:#FAECE7;color:#712B13;';
  return 'background:#f0f0ee;color:#555;';
}

function getMatches() {
  if (!state.profile) return [];
  return DUMMY_PROFILES.map(p => ({ profile: p, ...scoreMatch(state.profile, p) }))
    .filter(m => m.score >= 10)
    .sort((a, b) => b.score - a.score);
}

// ─── Filter state ─────────────────────────────────────────────────────────────

const filters = { days: [], loc: null, style: null, minScore: 0 };

function applyFilters(matches) {
  return matches.filter(m => {
    const p = m.profile;
    if (filters.days.length > 0 && !filters.days.every(d => p.days.includes(d))) return false;
    if (filters.loc && p.location !== filters.loc) return false;
    if (filters.style && p.style !== filters.style && p.style !== 'flexible' && p.style !== 'unsure') return false;
    if (filters.minScore > 0 && scoreToPercent(m.score) < filters.minScore) return false;
    return true;
  });
}

function hasActiveFilters() {
  return filters.days.length > 0 || filters.loc || filters.style || filters.minScore > 0;
}

// ─── Build a match/connection card ───────────────────────────────────────────

function buildCard(matchObj, context) {
  // context: 'inbound' | 'match' | 'sent-pending' | 'connected'
  const p = matchObj.profile;
  const pct = matchObj.score !== undefined ? scoreToPercent(matchObj.score) : null;
  const sClass = pct !== null ? scoreClass(pct) : 'score-low';
  const locDisplay = locationShort(p.location, p.overseas);
  const matched = matchObj.matched || [];

  const card = document.createElement('div');
  card.className = 'match-card';
  card.dataset.id = p.id;
  if (context === 'inbound') card.classList.add('card-inbound');
  if (context === 'connected') card.classList.add('card-connected');

  // Build tag chips from matched array (no duplication with name row)
  const tagChips = matched.slice(0, 4).map(m => {
    const cls = (m.type === 'role' || m.type === 'dir' || m.type === 'days') ? 'tag-match' : 'tag-neutral';
    return `<span class="tag ${cls}">${m.label}</span>`;
  }).join('');

  // Location tag always shown
  const locTag = `<span class="tag" style="${locTagStyle(p.location)}">${locDisplay}</span>`;

  // Name row extras
  let nameRowExtra = '';
  if (context === 'inbound') nameRowExtra = `<span class="inbound-label">Requested you</span>`;
  if (context === 'sent-pending') nameRowExtra = `<span class="pending-label">Request sent</span>`;

  // Status line
  let statusLine = '';
  if (context === 'inbound') {
    statusLine = `<div class="card-status"><span class="status-dot dot-received"></span>Waiting for your response</div>`;
  } else if (context === 'sent-pending') {
    statusLine = `<div class="card-status"><span class="status-dot dot-sent"></span>Awaiting their response</div>`;
  } else if (context === 'connected') {
    const conn = state.connections.find(c => c.id === p.id);
    const dirText = conn && conn.dir === 'sent' ? 'You requested · they accepted' : 'They requested · you accepted';
    const dateStr = conn ? relativeDate(conn.ts) : '';
    statusLine = `<div class="conn-footer"><span>${dateStr}</span><span class="conn-dir">${dirText}</span></div>`;
  }

  // Right-column buttons
  let rightButtons = '';
  if (context === 'inbound') {
    rightButtons = `
      <button class="card-btn card-btn-accept" onclick="acceptRequest('${p.id}')">Accept</button>
      <button class="card-btn card-btn-ignore" onclick="ignoreRequest('${p.id}')">Ignore</button>
      ${pct !== null ? `<button class="score-pill ${sClass}" onclick="openScoreModal('${p.id}')">${pct}% match</button>` : ''}
      <button class="card-btn-more" onclick="openProfileModal('${p.id}')">Full profile…</button>`;
  } else if (context === 'match') {
    rightButtons = `
      <button class="card-btn card-btn-primary" onclick="sendRequest('${p.id}')">Request</button>
      <button class="card-btn card-btn-dismiss" onclick="dismiss('${p.id}')">Dismiss</button>
      ${pct !== null ? `<button class="score-pill ${sClass}" onclick="openScoreModal('${p.id}')">${pct}% match</button>` : ''}
      <button class="card-btn-more" onclick="openProfileModal('${p.id}')">Full profile…</button>`;
  } else if (context === 'sent-pending') {
    rightButtons = `
      <button class="card-btn card-btn-withdraw" onclick="withdrawRequest('${p.id}')">Withdraw request</button>
      ${pct !== null ? `<button class="score-pill ${sClass}" onclick="openScoreModal('${p.id}')">${pct}% match</button>` : ''}
      <button class="card-btn-more" onclick="openProfileModal('${p.id}')">Full profile…</button>`;
  } else if (context === 'connected') {
    rightButtons = `
      <a class="card-btn card-btn-email" href="mailto:${p.name}">
        <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><rect x="1" y="2.5" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 4l5.5 3.5L12 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        Send email
      </a>
      ${pct !== null ? `<button class="score-pill ${sClass}" onclick="openScoreModal('${p.id}')">${pct}% match</button>` : ''}
      <button class="card-btn-more" onclick="openProfileModal('${p.id}')">Full profile…</button>`;
  }

  card.innerHTML = `
    <div class="card-layout">
      <div class="card-left">
        <div class="card-name-row">
          <span class="card-name">${p.name}</span>
          <span class="card-grade">${p.grade}</span>
          ${nameRowExtra}
        </div>
        <div class="card-tags">${tagChips}${locTag}</div>
        ${statusLine}
      </div>
      <div class="card-right">${rightButtons}</div>
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
  const roleTags = p.roles.map(r => `<span class="modal-tag">${r}</span>`).join('');
  const dirTags = p.directorates.map(d => `<span class="modal-tag">${d}</span>`).join('');
  const dayTags = p.days.map(d => `<span class="modal-tag">${d}</span>`).join('');
  const styleStr = styleLabel(p.style) || 'Not specified';

  openModal(`
    <button class="modal-close" onclick="closeModal()">×</button>
    <div class="modal-name">${p.name}</div>
    <div class="modal-grade-loc">${p.grade} · ${locDisplay}</div>
    <div class="modal-section">
      <div class="modal-section-label">Roles they'd consider</div>
      <div class="modal-tags">${roleTags}</div>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Directorates</div>
      <div class="modal-tags">${dirTags}</div>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Working days</div>
      <div class="modal-tags">${dayTags}</div>
    </div>
    <div class="modal-section">
      <div class="modal-section-label">Working style</div>
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
      Match breakdown
      <span class="score-pill ${sClass} modal-score-pct">${pct}% match</span>
    </div>
    <div class="score-breakdown">${rows}</div>
    <div style="margin-top:12px;font-size:11px;color:#bbb;line-height:1.6;">
      Score based on grade compatibility, shared roles, directorate overlap, day pattern, and working style.
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

function buildAccordion() {
  const acc = document.getElementById('roleAccordion');
  acc.innerHTML = '';
  ROLE_GROUPS.forEach(group => {
    const grp = document.createElement('div');
    grp.className = 'acc-group';
    grp.dataset.groupId = group.id;

    const header = document.createElement('div');
    header.className = 'acc-header';
    header.innerHTML = `
      <span class="acc-emoji">${group.emoji}</span>
      <span class="acc-label">${group.label}</span>
      <span class="acc-count" id="count-${group.id}"></span>
      <span class="acc-arrow">▶</span>`;
    header.addEventListener('click', () => {
      grp.classList.toggle('open');
      header.classList.toggle('open');
    });

    const body = document.createElement('div');
    body.className = 'acc-body';

    const note = document.createElement('div');
    note.className = 'acc-grade-note';
    note.textContent = 'Some roles are dashed — they\'re typically for higher grades, but you can still select them if relevant to your situation.';
    body.appendChild(note);

    const selAll = document.createElement('span');
    selAll.className = 'acc-sel-all';
    selAll.textContent = 'Select all in group';
    selAll.addEventListener('click', (e) => {
      e.stopPropagation();
      body.querySelectorAll('.role-chip').forEach(c => c.classList.add('selected'));
      updateRoleSummary();
      updateCompleteness();
    });
    body.appendChild(selAll);

    const chips = document.createElement('div');
    chips.className = 'role-chips';

    group.roles.forEach(role => {
      const chip = document.createElement('button');
      chip.className = 'role-chip';
      chip.textContent = role.label;
      chip.dataset.role = role.label;
      chip.dataset.minGrade = role.minGrade;
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        updateRoleSummary();
        updateCompleteness();
      });
      chips.appendChild(chip);
    });

    body.appendChild(chips);
    grp.appendChild(header);
    grp.appendChild(body);
    acc.appendChild(grp);
  });
}

function updateGradeFilter() {
  const grade = getSelectedSingle('gradeChips');
  let anyGreyed = false;
  document.querySelectorAll('.acc-group').forEach(grp => {
    let groupHasGreyed = false;
    grp.querySelectorAll('.role-chip').forEach(chip => {
      const minG = chip.dataset.minGrade;
      const aboveGrade = grade && !gradeAllowed(minG, grade);
      chip.classList.toggle('greyed', aboveGrade);
      if (aboveGrade) { groupHasGreyed = true; anyGreyed = true; }
    });
    grp.classList.toggle('has-greyed', groupHasGreyed);
  });
  updateGroupCounts();
  updateRoleSummary();
}

function updateGroupCounts() {
  ROLE_GROUPS.forEach(group => {
    const count = document.querySelectorAll(`[data-group-id="${group.id}"] .role-chip.selected`).length;
    const el = document.getElementById('count-' + group.id);
    if (el) el.textContent = count > 0 ? `${count} selected` : '';
  });
}

function updateRoleSummary() {
  updateGroupCounts();
  const selected = [...document.querySelectorAll('.role-chip.selected')].map(c => c.dataset.role);
  const wrap = document.getElementById('selectedRolesSummary');
  const tags = document.getElementById('summaryTags');
  if (selected.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  tags.innerHTML = selected.map(r => `<span class="sum-tag">${r}</span>`).join('');
}

function getSelectedSingle(containerId) {
  const sel = document.querySelector(`#${containerId} .selected`);
  return sel ? sel.dataset.val : null;
}

function getSelectedMulti(containerId) {
  return [...document.querySelectorAll(`#${containerId} .selected`)].map(c => c.dataset.val);
}

function updateCompleteness() {
  const name = document.getElementById('userName').value.trim();
  const grade = getSelectedSingle('gradeChips');
  const roles = [...document.querySelectorAll('.role-chip.selected')].length;
  const dirs = getSelectedMulti('dirChips').length;
  const days = getSelectedMulti('dayChips').length;
  const style = getSelectedSingle('styleChips');

  let filled = 0;
  if (name) filled++;
  if (grade) filled++;
  if (roles > 0) filled++;
  if (dirs > 0) filled++;
  if (days > 0) filled++;
  if (style) filled++;

  const pct = Math.round((filled / 6) * 100);
  document.getElementById('complFill').style.width = pct + '%';
  const labels = ['Profile incomplete', 'Getting started', 'Keep going…', 'Half way there', 'Almost there', 'Almost there', 'Profile complete'];
  document.getElementById('complLabel').textContent = labels[filled] || 'Profile complete';
  document.getElementById('complFill').style.background = pct === 100 ? '#27500A' : '#185FA5';
}

function loadProfileIntoForm() {
  const p = state.profile;
  if (!p) return;
  document.getElementById('userName').value = p.name || '';

  document.querySelectorAll('#gradeChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.grade);
  });
  updateGradeFilter();

  document.querySelectorAll('.role-chip').forEach(c => {
    if ((p.roles || []).includes(c.dataset.role)) c.classList.add('selected');
  });
  document.querySelectorAll('#dirChips .chip').forEach(c => {
    c.classList.toggle('selected', (p.directorates || []).includes(c.dataset.val));
  });
  document.querySelectorAll('#dayChips .chip').forEach(c => {
    c.classList.toggle('selected', (p.days || []).includes(c.dataset.val));
  });
  document.querySelectorAll('#styleChips .style-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.style);
  });
  document.querySelectorAll('#locChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.location);
  });
  toggleOverseas();
  if (p.overseas) document.getElementById('overseasSelect').value = p.overseas;
  updateRoleSummary();
  updateCompleteness();
  document.getElementById('deleteProfile').style.display = 'inline-block';
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

// ─── Save / delete profile ────────────────────────────────────────────────────

document.getElementById('saveProfile').addEventListener('click', () => {
  const name = document.getElementById('userName').value.trim();
  if (!name) { showSaveStatus('Please enter your name.', 'error'); return; }
  const grade = getSelectedSingle('gradeChips');
  if (!grade) { showSaveStatus('Please select your grade.', 'error'); return; }
  const roles = [...document.querySelectorAll('.role-chip.selected')].map(c => c.dataset.role);
  if (roles.length === 0) { showSaveStatus('Please select at least one role.', 'error'); return; }
  const directorates = getSelectedMulti('dirChips');
  if (directorates.length === 0) { showSaveStatus('Please select at least one directorate.', 'error'); return; }
  const days = getSelectedMulti('dayChips');
  if (days.length === 0) { showSaveStatus('Please select your working days.', 'error'); return; }
  const style = document.querySelector('#styleChips .selected')?.dataset.val || null;
  if (!style) { showSaveStatus('Please select a working style.', 'error'); return; }
  const location = getSelectedSingle('locChips');
  const overseas = location === 'Overseas' ? document.getElementById('overseasSelect').value : '';

  state.profile = { name, grade, roles, directorates, days, style, location, overseas };
  maybeBootstrapInbound();
  saveState();
  updateBadges();
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
  // ~60% acceptance rate
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

function dismiss(id) {
  state.dismissed.push(id);
  saveState();
  renderMatches();
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

  // Banner
  const banner = document.getElementById('newConnBanner');
  if (state.newConnBanner) {
    banner.style.display = 'flex';
    banner.innerHTML = `<span style="font-size:16px;flex-shrink:0;">🎉</span>
      <span>${state.newConnBanner}</span>
      <button onclick="clearBanner()" style="margin-left:auto;background:none;border:none;cursor:pointer;color:#27500A;font-size:18px;line-height:1;">×</button>`;
    state.newConnBanner = null;
    saveState();
  } else {
    banner.style.display = 'none';
  }

  // Connected
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

  // Pending
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

function clearBanner() {
  document.getElementById('newConnBanner').style.display = 'none';
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

document.getElementById('filterToggleBtn').addEventListener('click', () => {
  const bar = document.getElementById('filterBar');
  const btn = document.getElementById('filterToggleBtn');
  bar.classList.toggle('open');
  btn.classList.toggle('active');
});

document.getElementById('filterClearBtn').addEventListener('click', () => {
  filters.days = []; filters.loc = null; filters.style = null; filters.minScore = 0;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('selected'));
  document.querySelector('#filterScore [data-val="0"]').classList.add('selected');
  document.getElementById('filterClearBtn').style.display = 'none';
  renderMatches();
});

function setupFilterChips(containerId, onSelect) {
  document.querySelectorAll(`#${containerId} .filter-chip`).forEach(chip => {
    chip.addEventListener('click', () => {
      onSelect(chip);
      document.getElementById('filterClearBtn').style.display = hasActiveFilters() ? 'inline' : 'none';
      renderMatches();
    });
  });
}

setupFilterChips('filterDays', chip => {
  chip.classList.toggle('selected');
  filters.days = [...document.querySelectorAll('#filterDays .filter-chip.selected')].map(c => c.dataset.val);
});

setupFilterChips('filterLoc', chip => {
  const was = chip.classList.contains('selected');
  document.querySelectorAll('#filterLoc .filter-chip').forEach(c => c.classList.remove('selected'));
  if (!was) { chip.classList.add('selected'); filters.loc = chip.dataset.val; }
  else filters.loc = null;
});

setupFilterChips('filterStyle', chip => {
  const was = chip.classList.contains('selected');
  document.querySelectorAll('#filterStyle .filter-chip').forEach(c => c.classList.remove('selected'));
  if (!was) { chip.classList.add('selected'); filters.style = chip.dataset.val; }
  else filters.style = null;
});

setupFilterChips('filterScore', chip => {
  document.querySelectorAll('#filterScore .filter-chip').forEach(c => c.classList.remove('selected'));
  chip.classList.add('selected');
  filters.minScore = parseInt(chip.dataset.val, 10);
});

// ─── Refresh button ───────────────────────────────────────────────────────────

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
    updateGradeFilter();
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

// ─── Periodic poll for accepted requests while on connections tab ─────────────
// Catches the case where user is sitting on connections tab when a timer fires

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
buildAccordion();
setupMultiChips('dirChips');
setupMultiChips('dayChips');
setupSingleChips('locChips', (val) => { if (val === 'Overseas') toggleOverseas(); else document.getElementById('overseasWrap').style.display = 'none'; });
document.querySelectorAll('#styleChips .style-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('#styleChips .style-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    updateCompleteness();
  });
});

document.getElementById('userName').addEventListener('input', updateCompleteness);

if (state.profile) {
  loadProfileIntoForm();
  maybeBootstrapInbound();
}

rehydrateTimers();
updateBadges();
updateCompleteness();
