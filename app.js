// ─── State ───────────────────────────────────────────────────────────────────

const STATE_KEY = 'pairup_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : defaultState();
  } catch (e) { return defaultState(); }
}

function defaultState() {
  return {
    profile: null,
    sentRequests: [],
    receivedRequests: [],
    connections: [],
    dismissed: [],
    showDismissed: false,
    newConnBanner: null,
  };
}

function saveState() {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();

// Simulate some inbound requests on first load if profile exists
function maybeBootstrapInbound() {
  if (!state.profile) return;
  if (state._bootstrapped) return;
  state._bootstrapped = true;
  // Two dummy profiles have proactively "requested" the user
  const inbound = ['p001', 'p009'];
  inbound.forEach(id => {
    if (!state.receivedRequests.includes(id) &&
        !state.connections.find(c => c.id === id) &&
        !state.sentRequests.includes(id)) {
      state.receivedRequests.push(id);
    }
  });
  saveState();
}

// ─── Matching ────────────────────────────────────────────────────────────────

function scoreMatch(user, candidate) {
  let score = 0;
  let matched = [];

  // Grade match: same or adjacent (±1) = 40 pts, ±2 = 20 pts
  const uIdx = GRADE_IDX[user.grade] ?? 0;
  const cIdx = GRADE_IDX[candidate.grade] ?? 0;
  const gradeDiff = Math.abs(uIdx - cIdx);
  if (gradeDiff === 0) { score += 40; matched.push({ label: candidate.grade, type: 'grade' }); }
  else if (gradeDiff === 1) { score += 25; matched.push({ label: candidate.grade, type: 'grade' }); }
  else if (gradeDiff === 2) { score += 10; }

  // Role overlap: 25 pts per shared role, max 25
  const roleOverlap = user.roles.filter(r => candidate.roles.includes(r));
  if (roleOverlap.length > 0) {
    score += 25;
    roleOverlap.slice(0, 2).forEach(r => matched.push({ label: r, type: 'role' }));
  }

  // Directorate overlap: 20 pts if any shared, +5 if multiple
  const dirOverlap = user.directorates.filter(d =>
    d === 'Open to any' || candidate.directorates.includes(d) || candidate.directorates.includes('Open to any')
  );
  if (dirOverlap.length > 0) {
    score += 20;
    if (dirOverlap.length > 1) score += 5;
    const displayDir = dirOverlap.filter(d => d !== 'Open to any').slice(0, 1);
    displayDir.forEach(d => matched.push({ label: d, type: 'dir' }));
  }

  // Day complementarity: non-overlapping days = ideal for job share
  const userDays = new Set(user.days);
  const candDays = new Set(candidate.days);
  const overlap = [...userDays].filter(d => candDays.has(d)).length;
  const total = new Set([...userDays, ...candDays]).size;
  const coverage = total / 5; // fraction of week covered between them
  if (overlap === 0 && coverage >= 0.8) { score += 15; matched.push({ label: candidate.days.join(' '), type: 'days' }); }
  else if (overlap <= 1 && coverage >= 0.6) { score += 10; matched.push({ label: candidate.days.join(' '), type: 'days' }); }
  else if (overlap <= 2) { score += 5; }

  // Style compatibility: same = 10, flexible = 5
  if (user.style && candidate.style) {
    if (user.style === candidate.style) { score += 10; matched.push({ label: styleLabel(candidate.style), type: 'style' }); }
    else if (user.style === 'flexible' || candidate.style === 'flexible') { score += 5; }
  }

  // Location: same location = small bonus, surfaces it as tag
  if (user.location && candidate.location && user.location === candidate.location) {
    matched.push({ label: locationShort(candidate.location, candidate.overseas), type: 'loc' });
  }

  return { score: Math.min(score, 115), matched };
}

function styleLabel(s) {
  return { clean: 'Clean handover', collaborative: 'Collaborative', flexible: 'Flexible' }[s] || s;
}

function locationShort(loc, overseas) {
  if (loc === 'Overseas' && overseas) return overseas;
  return loc;
}

function getMatches() {
  if (!state.profile) return [];
  return DUMMY_PROFILES
    .filter(p => p.id !== 'user')
    .map(p => ({ profile: p, ...scoreMatch(state.profile, p) }))
    .filter(m => m.score >= 15)
    .sort((a, b) => b.score - a.score);
}

function scoreToPercent(score) {
  return Math.round(Math.min((score / 115) * 100, 100));
}

// ─── Avatar colours ──────────────────────────────────────────────────────────

const AV_COLORS = [
  { bg: '#E6F1FB', fg: '#0C447C' },
  { bg: '#E1F5EE', fg: '#085041' },
  { bg: '#FAEEDA', fg: '#633806' },
  { bg: '#EEEDFE', fg: '#3C3489' },
  { bg: '#FAECE7', fg: '#712B13' },
  { bg: '#FBEAF0', fg: '#72243E' },
  { bg: '#EAF3DE', fg: '#27500A' },
];

function avatarColor(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return AV_COLORS[n % AV_COLORS.length];
}

function initials(name) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function avatarEl(profile) {
  const c = avatarColor(profile.id);
  const div = document.createElement('div');
  div.className = 'avatar';
  div.style.background = c.bg;
  div.style.color = c.fg;
  div.textContent = initials(profile.name);
  return div;
}

// ─── Location tag colour ─────────────────────────────────────────────────────

function locTagStyle(loc) {
  if (loc === 'London - KCS') return 'background:#EEEDFE;color:#3C3489;';
  if (loc === 'East Kilbride') return 'background:#FAEEDA;color:#633806;';
  if (loc === 'Remote') return 'background:#E1F5EE;color:#085041;';
  if (loc === 'Overseas') return 'background:#FAECE7;color:#712B13;';
  return 'background:#F1EFE8;color:#444441;';
}

// ─── Build a match card ──────────────────────────────────────────────────────

function buildMatchCard(matchObj, context) {
  // context: 'inbound' | 'match' | 'connected' | 'pending'
  const p = matchObj.profile || matchObj;
  const pct = matchObj.score !== undefined ? scoreToPercent(matchObj.score) : null;
  const matched = matchObj.matched || [];

  const card = document.createElement('div');
  card.className = 'match-card';
  card.dataset.id = p.id;

  if (context === 'inbound') card.classList.add('card-inbound');
  if (context === 'connected') card.classList.add('card-connected');

  // Score pill colour
  let scoreClass = 'score-low';
  if (pct >= 75) scoreClass = 'score-high';
  else if (pct >= 50) scoreClass = 'score-med';

  const locDisplay = locationShort(p.location, p.overseas);

  // Tags
  const tagHTML = matched.slice(0, 5).map(m => {
    if (m.type === 'loc') return `<span class="tag tag-loc" style="${locTagStyle(p.location)}">${m.label}</span>`;
    if (m.type === 'grade') return `<span class="tag tag-match">${m.label}</span>`;
    if (m.type === 'role') return `<span class="tag tag-match">${m.label}</span>`;
    if (m.type === 'dir') return `<span class="tag tag-match">${m.label}</span>`;
    if (m.type === 'days') return `<span class="tag tag-match">${m.label}</span>`;
    if (m.type === 'style') return `<span class="tag tag-neutral">${m.label}</span>`;
    return `<span class="tag tag-neutral">${m.label}</span>`;
  }).join('');

  // Location tag (always show)
  const locTag = `<span class="tag tag-loc" style="${locTagStyle(p.location)}">${locDisplay}</span>`;

  let actionsHTML = '';
  let statusHTML = '';
  let footerHTML = '';

  if (context === 'inbound') {
    actionsHTML = `
      <div class="card-actions">
        <button class="btn btn-accept" onclick="acceptRequest('${p.id}')">Accept connection</button>
        <button class="btn btn-ghost" onclick="declineRequest('${p.id}')">Decline</button>
      </div>`;
    statusHTML = `<div class="status-row"><span class="status-dot dot-received"></span><span class="status-text">Requested to connect with you</span></div>`;
  } else if (context === 'match') {
    actionsHTML = `
      <div class="card-actions">
        <button class="btn btn-primary" onclick="sendRequest('${p.id}')">Request connection</button>
        <button class="btn btn-dismiss" onclick="dismiss('${p.id}')">Dismiss</button>
      </div>`;
  } else if (context === 'sent-pending') {
    actionsHTML = `
      <div class="card-actions">
        <button class="btn btn-ghost" onclick="withdrawRequest('${p.id}')">Withdraw request</button>
      </div>`;
    statusHTML = `<div class="status-row"><span class="status-dot dot-sent"></span><span class="status-text">You sent a request — awaiting response</span></div>`;
  } else if (context === 'connected') {
    const conn = state.connections.find(c => c.id === p.id);
    const dirText = conn && conn.dir === 'sent' ? 'You requested · they accepted' : 'They requested · you accepted';
    const dateStr = conn ? relativeDate(conn.ts) : '';
    footerHTML = `
      <div class="conn-footer">
        <span>${dateStr}</span>
        <span class="conn-dir">${dirText}</span>
      </div>`;
    actionsHTML = `
      <div class="card-actions">
        <a class="btn btn-email" href="mailto:${p.name}" title="Open email to ${p.name}">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="margin-right:5px;flex-shrink:0;">
            <rect x="1" y="2.5" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 4l5.5 3.5L12 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          Send email
        </a>
      </div>`;
  }

  card.innerHTML = `
    <div class="card-top">
      <div class="card-avatar" id="av-${p.id}"></div>
      <div class="card-info">
        <div class="card-name">${p.name}</div>
        <div class="card-sub">${p.grade} · ${p.directorates.filter(d=>d!=='Open to any').slice(0,1).join('') || 'Various'} · ${locDisplay}</div>
      </div>
      ${pct !== null ? `<div class="score-pill ${scoreClass}">${pct}%</div>` : ''}
    </div>
    <div class="card-tags">${tagHTML}${locTag}</div>
    ${actionsHTML}
    ${statusHTML}
    ${footerHTML}
  `;

  // Insert avatar element
  const avSlot = card.querySelector(`#av-${p.id}`);
  if (avSlot) avSlot.replaceWith(avatarEl(p));

  return card;
}

function relativeDate(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
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
      <span class="acc-arrow">▶</span>
    `;
    header.addEventListener('click', () => {
      grp.classList.toggle('open');
      header.classList.toggle('open');
    });

    const body = document.createElement('div');
    body.className = 'acc-body';

    const selAll = document.createElement('span');
    selAll.className = 'acc-sel-all';
    selAll.textContent = 'Select available';
    selAll.addEventListener('click', (e) => {
      e.stopPropagation();
      body.querySelectorAll('.role-chip:not(.greyed)').forEach(c => c.classList.add('selected'));
      updateRoleSummary();
      updateCompleteness();
    });
    body.appendChild(selAll);

    const chips = document.createElement('div');
    chips.className = 'role-chips';

    group.roles.forEach(role => {
      const chip = document.createElement('button');
      chip.className = 'role-chip chip';
      chip.textContent = role.label;
      chip.dataset.role = role.label;
      chip.dataset.minGrade = role.minGrade;
      chip.addEventListener('click', () => {
        if (chip.classList.contains('greyed')) return;
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
  document.querySelectorAll('.role-chip').forEach(chip => {
    const minG = chip.dataset.minGrade;
    const allowed = !grade || gradeAllowed(minG, grade);
    chip.classList.toggle('greyed', !allowed);
    if (!allowed) chip.classList.remove('selected');
  });
  updateGroupCounts();
  updateRoleSummary();
  updateCompleteness();
}

function updateGroupCounts() {
  ROLE_GROUPS.forEach(group => {
    const chips = document.querySelectorAll(`[data-group-id="${group.id}"] .role-chip.selected`);
    const el = document.getElementById('count-' + group.id);
    if (el) el.textContent = chips.length > 0 ? `${chips.length} selected` : '';
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
  const sel = document.querySelector(`#${containerId} .chip.selected`);
  return sel ? sel.dataset.val : null;
}

function getSelectedMulti(containerId) {
  return [...document.querySelectorAll(`#${containerId} .chip.selected`)].map(c => c.dataset.val);
}

function setupMultiChips(containerId) {
  document.querySelectorAll(`#${containerId} .chip:not(.chip-single)`).forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      updateCompleteness();
    });
  });
}

function setupSingleChips(containerId) {
  document.querySelectorAll(`#${containerId} .chip-single, #${containerId} .chip.chip-single`).forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll(`#${containerId} .chip`).forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      updateCompleteness();
      if (containerId === 'locChips') toggleOverseas();
    });
  });
}

function setupSingleStyleCards() {
  document.querySelectorAll('#styleChips .style-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#styleChips .style-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updateCompleteness();
    });
  });
}

function toggleOverseas() {
  const loc = getSelectedSingle('locChips');
  document.getElementById('overseasWrap').style.display = loc === 'Overseas' ? 'block' : 'none';
}

function updateCompleteness() {
  const name = document.getElementById('userName').value.trim();
  const grade = getSelectedSingle('gradeChips');
  const roles = [...document.querySelectorAll('.role-chip.selected')].length;
  const dirs = getSelectedMulti('dirChips').length;
  const days = getSelectedMulti('dayChips').length;

  let filled = 0;
  if (name) filled++;
  if (grade) filled++;
  if (roles > 0) filled++;
  if (dirs > 0) filled++;
  if (days > 0) filled++;

  const pct = Math.round((filled / 5) * 100);
  document.getElementById('complFill').style.width = pct + '%';
  const labels = ['Profile incomplete', 'Good start', 'Almost there', 'Almost there', 'Profile complete', 'Profile complete'];
  document.getElementById('complLabel').textContent = labels[filled] || 'Profile complete';
  document.getElementById('complFill').style.background = pct === 100 ? '#27500A' : '#185FA5';
}

// ─── Load profile into form ───────────────────────────────────────────────────

function loadProfileIntoForm() {
  const p = state.profile;
  if (!p) return;

  document.getElementById('userName').value = p.name || '';

  // Grade
  document.querySelectorAll('#gradeChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.grade);
  });
  updateGradeFilter();

  // Roles
  document.querySelectorAll('.role-chip').forEach(c => {
    if ((p.roles || []).includes(c.dataset.role)) c.classList.add('selected');
  });

  // Directorates
  document.querySelectorAll('#dirChips .chip').forEach(c => {
    c.classList.toggle('selected', (p.directorates || []).includes(c.dataset.val));
  });

  // Days
  document.querySelectorAll('#dayChips .chip').forEach(c => {
    c.classList.toggle('selected', (p.days || []).includes(c.dataset.val));
  });

  // Style
  document.querySelectorAll('#styleChips .style-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.style);
  });

  // Location
  document.querySelectorAll('#locChips .chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === p.location);
  });
  toggleOverseas();
  if (p.overseas) document.getElementById('overseasSelect').value = p.overseas;

  updateRoleSummary();
  updateCompleteness();
  document.getElementById('deleteProfile').style.display = 'inline-block';
}

// ─── Save profile ─────────────────────────────────────────────────────────────

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
  const style = getSelectedSingle('styleChips') || document.querySelector('#styleChips .style-card.selected')?.dataset.val || null;
  const location = getSelectedSingle('locChips');
  const overseas = location === 'Overseas' ? document.getElementById('overseasSelect').value : '';

  state.profile = { name, grade, roles, directorates, days, style, location, overseas };
  maybeBootstrapInbound();
  saveState();
  updateBadges();
  document.getElementById('deleteProfile').style.display = 'inline-block';
  showSaveStatus('Profile saved! Switching to your matches…', 'ok');
  setTimeout(() => switchTab('matches'), 1200);
});

document.getElementById('deleteProfile').addEventListener('click', () => {
  if (!confirm('Delete your profile? This will remove all your data including connections.')) return;
  state = defaultState();
  saveState();
  location.reload();
});

function showSaveStatus(msg, type) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.className = 'save-status ' + type;
  el.style.display = 'block';
  if (type === 'ok') setTimeout(() => el.style.display = 'none', 3000);
}

// ─── Matches ──────────────────────────────────────────────────────────────────

function renderMatches() {
  if (!state.profile) {
    document.getElementById('matchesNoProfile').style.display = 'block';
    document.getElementById('matchesContent').style.display = 'none';
    return;
  }
  document.getElementById('matchesNoProfile').style.display = 'none';
  document.getElementById('matchesContent').style.display = 'block';

  // Inbound requests
  const inboundIds = state.receivedRequests.filter(id =>
    !state.connections.find(c => c.id === id)
  );
  const inboundSec = document.getElementById('inboundSection');
  const inboundCards = document.getElementById('inboundCards');
  inboundCards.innerHTML = '';
  if (inboundIds.length > 0) {
    inboundSec.style.display = 'block';
    inboundIds.forEach(id => {
      const p = DUMMY_PROFILES.find(x => x.id === id);
      if (!p) return;
      const m = { profile: p, ...scoreMatch(state.profile, p) };
      inboundCards.appendChild(buildMatchCard(m, 'inbound'));
    });
  } else {
    inboundSec.style.display = 'none';
  }

  // Regular matches
  const matches = getMatches();
  const cards = document.getElementById('matchCards');
  cards.innerHTML = '';

  const visible = matches.filter(m => {
    const id = m.profile.id;
    if (state.connections.find(c => c.id === id)) return false;
    if (state.receivedRequests.includes(id)) return false;
    if (!state.showDismissed && state.dismissed.includes(id)) return false;
    return true;
  });

  const showDRow = document.getElementById('showDismissedRow');
  const hasDismissed = matches.some(m => state.dismissed.includes(m.profile.id) &&
    !state.connections.find(c => c.id === m.profile.id));

  showDRow.style.display = hasDismissed ? 'block' : 'none';
  document.getElementById('showDismissedBtn').textContent =
    state.showDismissed ? 'Hide dismissed profiles' : 'Show dismissed profiles';

  if (visible.length === 0 && inboundIds.length === 0) {
    document.getElementById('noMatches').style.display = 'block';
  } else {
    document.getElementById('noMatches').style.display = 'none';
  }

  visible.forEach(m => {
    const id = m.profile.id;
    let ctx = 'match';
    if (state.sentRequests.includes(id)) ctx = 'sent-pending';
    cards.appendChild(buildMatchCard(m, ctx));
  });

  updateBadges();
}

function sendRequest(id) {
  if (state.sentRequests.includes(id)) return;
  state.sentRequests.push(id);
  saveState();
  renderMatches();

  // Simulate ~50% acceptance after 3s
  const willAccept = Math.random() > 0.45;
  if (willAccept) {
    setTimeout(() => {
      if (state.sentRequests.includes(id) && !state.connections.find(c => c.id === id)) {
        state.sentRequests = state.sentRequests.filter(x => x !== id);
        state.connections.push({ id, dir: 'sent', ts: Date.now() });
        const p = DUMMY_PROFILES.find(x => x.id === id);
        state.newConnBanner = p ? `${p.name} accepted your request!` : 'A new connection accepted your request!';
        saveState();
        updateBadges();
        // If currently on connections tab, refresh it
        if (document.getElementById('tab-connections').classList.contains('active')) renderConnections();
        if (document.getElementById('tab-matches').classList.contains('active')) renderMatches();
      }
    }, 3000 + Math.random() * 2000);
  }
}

function withdrawRequest(id) {
  state.sentRequests = state.sentRequests.filter(x => x !== id);
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

function declineRequest(id) {
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

// ─── Connections ──────────────────────────────────────────────────────────────

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
    banner.innerHTML = `<span style="font-size:16px;flex-shrink:0;">🎉</span><span>${state.newConnBanner}</span>
      <button onclick="clearBanner()" style="margin-left:auto;background:none;border:none;cursor:pointer;color:#27500A;font-size:16px;">×</button>`;
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
      const m = { profile: p, ...scoreMatch(state.profile, p) };
      m.conn = conn;
      connCards.appendChild(buildMatchCard(m, 'connected'));
    });
  } else {
    connSec.style.display = 'none';
  }

  // Pending (sent, not yet accepted)
  const pendSec = document.getElementById('pendingSection');
  const pendCards = document.getElementById('pendingCards');
  pendCards.innerHTML = '';
  const pending = state.sentRequests.filter(id => !state.connections.find(c => c.id === id));
  if (pending.length > 0) {
    pendSec.style.display = 'block';
    pending.forEach(id => {
      const p = DUMMY_PROFILES.find(x => x.id === id);
      if (!p) return;
      const m = { profile: p, ...scoreMatch(state.profile, p) };
      pendCards.appendChild(buildMatchCard(m, 'sent-pending'));
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

  if (state.profile) {
    const inbound = state.receivedRequests.filter(id => !state.connections.find(c => c.id === id)).length;
    if (inbound > 0) {
      matchBadge.textContent = inbound;
      matchBadge.style.display = 'inline-flex';
    } else {
      matchBadge.style.display = 'none';
    }

    const newConns = state.connections.length;
    if (newConns > 0) {
      connBadge.textContent = newConns;
      connBadge.style.display = 'inline-flex';
    } else {
      connBadge.style.display = 'none';
    }
  } else {
    matchBadge.style.display = 'none';
    connBadge.style.display = 'none';
  }
}

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
  }, 800);
});

// ─── Overseas select ──────────────────────────────────────────────────────────

function populateOverseas() {
  const sel = document.getElementById('overseasSelect');
  OVERSEAS_OFFICES.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });
}

// ─── Grade chip: single select ────────────────────────────────────────────────

document.querySelectorAll('#gradeChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#gradeChips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    updateGradeFilter();
    updateCompleteness();
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

populateOverseas();
buildAccordion();
setupMultiChips('dirChips');
setupMultiChips('dayChips');
setupSingleChips('locChips');
setupSingleStyleCards();

document.getElementById('userName').addEventListener('input', updateCompleteness);

if (state.profile) {
  loadProfileIntoForm();
  maybeBootstrapInbound();
}

updateBadges();
updateCompleteness();
