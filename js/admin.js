'use strict';

const sessionKey = 'pignusDiceSession';
let sessionToken = localStorage.getItem(sessionKey) || '';
let dashboardData = null;

const byId = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const formatDate = value => value ? new Date(value).toLocaleString() : 'Never';
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
  byId('databaseStatus').textContent = `Local database · last saved ${formatDate(data.database.updatedAt)}`;
  const cards = [
    ['Users', data.summary.totalUsers],
    ['Active in 24h', data.summary.activeUsers24h],
    ['Games saved', data.summary.totalGames],
    ['Live rooms', data.summary.liveRooms],
    ['Tokens in circulation', data.summary.totalTokens],
  ];
  byId('summaryCards').innerHTML = cards.map(([label, value]) =>
    `<article class="summary-card"><span class="value">${formatNumber(value)}</span><span class="label">${escapeHtml(label)}</span></article>`
  ).join('');
  renderUsers(data.users);
  renderGames(data.games);
  renderEvents(data.events);
  renderRooms(data.liveRooms);
}

function renderUsers(users) {
  const query = byId('userSearch').value.trim().toLowerCase();
  const filtered = users.filter(user => !query || user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query));
  byId('usersTable').innerHTML = filtered.length ? filtered.map(user => `
    <tr>
      <td><div class="user-name">${escapeHtml(user.username)}</div><div class="user-email">${escapeHtml(user.email)}</div></td>
      <td><span class="pill ${user.role === 'admin' ? 'admin' : ''}">${escapeHtml(user.role)}</span></td>
      <td><span class="pill ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td>
      <td>${formatNumber(user.tokens)}</td>
      <td>${formatNumber(user.stats?.gamesPlayed)}</td>
      <td>${escapeHtml(formatDate(user.lastSeenAt))}</td>
      <td>${escapeHtml(formatDate(user.createdAt))}</td>
      <td><div class="row-actions">
        <button data-user-id="${user.id}" data-action="tokens">Set tokens</button>
        <button class="disable" data-user-id="${user.id}" data-action="status">${user.status === 'active' ? 'Disable' : 'Enable'}</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty">No matching users</td></tr>';
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
    <article class="room-card"><h3>${escapeHtml(room.code)}</h3><p>${escapeHtml(room.mode)} · ${room.started ? `Round ${room.round}` : 'Lobby'}</p>
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
