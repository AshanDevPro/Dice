'use strict';

const sessionKey = 'pignusDiceSession';
let sessionToken = localStorage.getItem(sessionKey) || '';
let dashboardData = null;
let selectedUserId = null;

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const formatDate = value => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : 'Never';
};
const formatNumber = value => Number(value || 0).toLocaleString();

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
  return data;
}

function showLogin(message = '') {
  byId('dashboard').hidden = true;
  byId('adminLogin').hidden = false;
  byId('adminLoginError').textContent = message;
}

function showDashboard() {
  byId('adminLogin').hidden = true;
  byId('dashboard').hidden = false;
}

async function loadDashboard() {
  try {
    const data = await api('/api/admin/dashboard');
    dashboardData = data;
    showDashboard();
    renderDashboard(data);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      if (error.status === 401) {
        sessionToken = '';
        localStorage.removeItem(sessionKey);
      }
      showLogin(error.status === 403 ? 'This account is not an administrator.' : 'Sign in to continue.');
    } else {
      byId('dashboardError').hidden = false;
      byId('dashboardError').textContent = error.message;
    }
  }
}

function renderDashboard(data) {
  byId('dashboardError').hidden = true;
  byId('databaseStatus').textContent = `Local database - last saved ${formatDate(data.database.updatedAt)}`;
  const cards = [
    ['Users', data.summary.totalUsers],
    ['Active in 24h', data.summary.activeUsers24h],
    ['Active sessions', data.summary.activeSessions],
    ['Games saved', data.summary.totalGames],
    ['Live rooms', data.summary.liveRooms],
    ['Tokens in circulation', data.summary.totalTokens],
  ];
  byId('summaryCards').innerHTML = cards.map(([label, value]) =>
    `<article class="summary-card"><span class="value">${formatNumber(value)}</span><span class="label">${escapeHtml(label)}</span></article>`
  ).join('');
  if (!selectedUserId || !data.users.some(user => user.id === selectedUserId)) {
    selectedUserId = data.users[0]?.id || null;
  }
  renderUsers(data.users);
  renderGames(data.games);
  renderEvents(data.events);
  renderRooms(data.liveRooms);
}

function renderMetricGrid(items) {
  return items.map(([label, value]) => `
    <div class="meta-kv">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join('');
}

function renderMiniList(items, emptyMessage) {
  return items.length ? `<ul class="meta-list">${items.join('')}</ul>` : `<p class="empty compact">${escapeHtml(emptyMessage)}</p>`;
}

function renderUserMeta(user) {
  const panel = byId('userMetaPanel');
  if (!user) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }

  const meta = user.meta || {};
  const stats = user.stats || {};
  const profileRows = [
    ['User ID', user.id],
    ['Email', user.email],
    ['Account key', meta.accountKey || 'Unknown'],
    ['Password algorithm', meta.passwordAlgo || 'Unknown'],
    ['Created', formatDate(user.createdAt)],
    ['Updated', formatDate(user.updatedAt)],
    ['Last login', formatDate(user.lastLoginAt)],
    ['Last seen', formatDate(user.lastSeenAt)],
    ['Last daily bonus', formatDate(meta.lastDailyBonusAt)],
  ];
  const sessionRows = [
    ['Active sessions', formatNumber(meta.activeSessions)],
    ['Last session seen', formatDate(meta.sessionLastSeenAt)],
    ['Session expires', formatDate(meta.sessionExpiresAt)],
  ];
  const statRows = [
    ['Logins', formatNumber(stats.logins)],
    ['Games played', formatNumber(stats.gamesPlayed)],
    ['Games won', formatNumber(stats.gamesWon)],
    ['Rounds played', formatNumber(stats.roundsPlayed)],
    ['Rounds won', formatNumber(stats.roundsWon)],
  ];
  const roomItems = (meta.liveRooms || []).map(room => `
    <li>
      <strong>${escapeHtml(room.code)}</strong>
      <span>${escapeHtml(room.mode)} - ${room.started ? `round ${room.round}` : 'lobby'}${room.pending ? ' - pending' : ''}${room.folded ? ' - folded' : ''}${room.tokens === null ? '' : ` - ${formatNumber(room.tokens)} tokens`}</span>
    </li>
  `);
  const gameItems = (meta.recentGames || []).map(game => `
    <li>
      <strong>${escapeHtml(game.roomCode || game.id)}</strong>
      <span>${escapeHtml(game.mode)} - ${escapeHtml(game.status)} - ${formatNumber(game.rounds)} rounds - ${formatNumber(game.totalPot)} pot${game.won ? ' - won' : ''}</span>
    </li>
  `);
  const safeRaw = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    tokens: user.tokens,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    lastSeenAt: user.lastSeenAt,
    stats,
    meta,
  };

  panel.innerHTML = `
    <div class="meta-header">
      <div>
        <p class="eyebrow">Selected user</p>
        <h3>${escapeHtml(user.username)}</h3>
        <p>${escapeHtml(user.email)} - ${escapeHtml(user.role)} - ${escapeHtml(user.status)}</p>
      </div>
      <strong>${formatNumber(user.tokens)} tokens</strong>
    </div>
    <div class="meta-layout">
      <section>
        <h4>Account meta</h4>
        <div class="meta-grid">${renderMetricGrid(profileRows)}</div>
      </section>
      <section>
        <h4>Sessions</h4>
        <div class="meta-grid">${renderMetricGrid(sessionRows)}</div>
      </section>
      <section>
        <h4>Game stats</h4>
        <div class="meta-grid">${renderMetricGrid(statRows)}</div>
      </section>
      <section>
        <h4>Live rooms</h4>
        ${renderMiniList(roomItems, 'This user is not in a live room.')}
      </section>
      <section>
        <h4>Recent games</h4>
        ${renderMiniList(gameItems, 'No saved games for this user yet.')}
      </section>
      <section class="raw-meta">
        <h4>Safe raw user data</h4>
        <pre>${escapeHtml(JSON.stringify(safeRaw, null, 2))}</pre>
      </section>
    </div>
  `;
  panel.hidden = false;
}

function renderUsers(users) {
  const query = byId('userSearch').value.trim().toLowerCase();
  const filtered = users.filter(user => !query
    || user.username.toLowerCase().includes(query)
    || user.email.toLowerCase().includes(query)
    || user.id.toLowerCase().includes(query));
  if (filtered.length && !filtered.some(user => user.id === selectedUserId)) {
    selectedUserId = filtered[0].id;
  }
  if (!filtered.length) {
    renderUserMeta(null);
    byId('usersTable').innerHTML = '<tr><td colspan="9" class="empty">No matching users</td></tr>';
    return;
  }

  renderUserMeta(users.find(user => user.id === selectedUserId) || filtered[0]);
  byId('usersTable').innerHTML = filtered.map(user => `
    <tr class="${user.id === selectedUserId ? 'selected' : ''}">
      <td><div class="user-name">${escapeHtml(user.username)}</div><div class="user-email">${escapeHtml(user.email)}</div></td>
      <td><span class="pill ${user.role === 'admin' ? 'admin' : ''}">${escapeHtml(user.role)}</span></td>
      <td><span class="pill ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td>
      <td>${formatNumber(user.tokens)}</td>
      <td>${formatNumber(user.meta?.activeSessions)}</td>
      <td>${formatNumber(user.stats?.gamesPlayed)}</td>
      <td>${escapeHtml(formatDate(user.lastLoginAt))}</td>
      <td>${escapeHtml(formatDate(user.createdAt))}</td>
      <td><div class="row-actions">
        <button data-user-id="${user.id}" data-action="details">View meta</button>
        <button data-user-id="${user.id}" data-action="tokens">Set tokens</button>
        <button class="disable" data-user-id="${user.id}" data-action="status">${user.status === 'active' ? 'Disable' : 'Enable'}</button>
      </div></td>
    </tr>`).join('');
}

function renderGames(games) {
  byId('gamesTable').innerHTML = games.length ? games.map(game => `
    <tr><td>${escapeHtml(formatDate(game.startedAt))}</td><td>${escapeHtml(game.roomCode)}</td>
    <td><span class="pill">${escapeHtml(game.mode)}</span></td><td>${escapeHtml(game.status)}</td>
    <td>${escapeHtml(game.players.map(player => player.username).join(', '))}</td><td>${formatNumber(game.rounds)}</td><td>${formatNumber(game.totalPot)}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">No games recorded yet</td></tr>';
}

function renderEvents(events) {
  byId('eventsTable').innerHTML = events.length ? events.map(event => `
    <tr><td>${escapeHtml(formatDate(event.createdAt))}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.username)}</td>
    <td class="details" title="${escapeHtml(JSON.stringify(event.details))}">${escapeHtml(JSON.stringify(event.details))}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No activity recorded yet</td></tr>';
}

function renderRooms(rooms) {
  byId('roomsGrid').innerHTML = rooms.length ? rooms.map(room => `
    <article class="room-card"><h3>${escapeHtml(room.code)}</h3><p>${escapeHtml(room.mode)} - ${room.started ? `Round ${room.round}` : 'Lobby'}</p>
    <p>${room.playerCount} player${room.playerCount === 1 ? '' : 's'}: ${escapeHtml(room.players.join(', '))}</p></article>`).join('')
    : '<p class="empty">No rooms are live right now</p>';
}

byId('adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button');
  submit.disabled = true;
  byId('adminLoginError').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: byId('adminIdentifier').value.trim(), password: byId('adminPassword').value }),
    });
    if (data.user.role !== 'admin') throw Object.assign(new Error('This account is not an administrator.'), { status: 403 });
    sessionToken = data.sessionToken;
    localStorage.setItem(sessionKey, sessionToken);
    byId('adminPassword').value = '';
    await loadDashboard();
  } catch (error) {
    byId('adminLoginError').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

byId('adminLogout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  sessionToken = '';
  localStorage.removeItem(sessionKey);
  showLogin('Signed out.');
});
byId('refreshDashboard').addEventListener('click', loadDashboard);
byId('userSearch').addEventListener('input', () => dashboardData && renderUsers(dashboardData.users));

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
  document.querySelectorAll('.panel').forEach(panel => { panel.hidden = panel.id !== tab.dataset.panel; });
}));

byId('usersTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-user-id]');
  if (!button || !dashboardData) return;
  const user = dashboardData.users.find(item => item.id === button.dataset.userId);
  if (!user) return;
  if (button.dataset.action === 'details') {
    selectedUserId = user.id;
    renderUsers(dashboardData.users);
    return;
  }
  let update;
  if (button.dataset.action === 'tokens') {
    const answer = window.prompt(`Set token balance for ${user.username}:`, user.tokens);
    if (answer === null) return;
    update = { tokens: Number(answer) };
  } else {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    if (!window.confirm(`${nextStatus === 'disabled' ? 'Disable' : 'Enable'} ${user.username}?`)) return;
    update = { status: nextStatus };
  }
  button.disabled = true;
  try {
    await api(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    await loadDashboard();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
});

if (sessionToken) loadDashboard(); else showLogin();
