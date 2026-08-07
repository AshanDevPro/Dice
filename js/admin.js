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
    ['Bonus codes', data.summary.activeRewards],
    ['Catalog rewards', data.summary.catalogRewards],
    ['Pending redemptions', data.summary.pendingRewardRedemptions],
  ];
  byId('summaryCards').innerHTML = cards.map(([label, value]) =>
    `<article class="summary-card"><span class="value">${formatNumber(value)}</span><span class="label">${escapeHtml(label)}</span></article>`
  ).join('');
  if (!selectedUserId || !data.users.some(user => user.id === selectedUserId)) {
    selectedUserId = data.users[0]?.id || null;
  }
  renderUsers(data.users);
  renderCatalogRewards(data.catalogRewards || []);
  renderCatalogRedemptions(data.rewardRedemptions || []);
  renderRewards(data.rewards || []);
  renderTransactions(data.transactions || []);
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

function renderRewards(rewards) {
  const table = byId('rewardsTable');
  if (!table) return;
  table.innerHTML = rewards.length ? rewards.map(reward => `
    <tr>
      <td><strong>${escapeHtml(reward.code)}</strong></td>
      <td>${escapeHtml(reward.title)}</td>
      <td>${formatNumber(reward.tokens)}</td>
      <td>${formatNumber(reward.redemptionCount)} / ${formatNumber(reward.maxRedemptions)}</td>
      <td><span class="pill ${reward.active ? 'active' : 'disabled'}">${reward.active ? 'active' : 'inactive'}</span></td>
      <td>${escapeHtml(reward.expiresAt ? formatDate(reward.expiresAt) : 'Never')}</td>
      <td>${escapeHtml(formatDate(reward.createdAt))}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No reward codes created yet</td></tr>';
}

function renderCatalogRewards(rewards) {
  const table = byId('catalogRewardsTable');
  if (!table) return;
  table.innerHTML = rewards.length ? rewards.map(reward => `
    <tr>
      <td><div class="user-name">${escapeHtml(reward.title)}</div><div class="user-email">${escapeHtml(reward.description || 'No description')}</div></td>
      <td>${formatNumber(reward.tokenCost)}</td>
      <td>${formatNumber(reward.redeemedCount)} / ${formatNumber(reward.quantity)} (${formatNumber(reward.available)} left)</td>
      <td><span class="pill ${reward.archived ? 'disabled' : reward.active ? 'active' : ''}">${reward.archived ? 'archived' : reward.active ? 'active' : 'inactive'}</span></td>
      <td>${escapeHtml(formatDate(reward.updatedAt || reward.createdAt))}</td>
      <td><div class="row-actions">
        <button data-catalog-id="${reward.id}" data-action="edit">Edit</button>
        <button data-catalog-id="${reward.id}" data-action="toggle">${reward.active ? 'Deactivate' : 'Activate'}</button>
        <button class="disable" data-catalog-id="${reward.id}" data-action="archive">Archive</button>
      </div></td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No catalog rewards created yet</td></tr>';
}

function renderCatalogRedemptions(redemptions) {
  const table = byId('catalogRedemptionsTable');
  if (!table) return;
  table.innerHTML = redemptions.length ? redemptions.map(redemption => `
    <tr>
      <td>${escapeHtml(formatDate(redemption.requestedAt))}</td>
      <td>${escapeHtml(redemption.username)}</td>
      <td><div class="user-name">${escapeHtml(redemption.rewardTitle)}</div><div class="user-email">${escapeHtml(redemption.id)}</div></td>
      <td>${formatNumber(redemption.tokenCost)}</td>
      <td><span class="pill ${redemption.status === 'fulfilled' || redemption.status === 'approved' ? 'active' : redemption.status === 'rejected' || redemption.status === 'cancelled' ? 'disabled' : ''}">${escapeHtml(redemption.status)}</span></td>
      <td><div class="row-actions">
        <button data-redemption-id="${redemption.id}" data-status="approved">Approve</button>
        <button data-redemption-id="${redemption.id}" data-status="fulfilled">Fulfil</button>
        <button class="disable" data-redemption-id="${redemption.id}" data-status="rejected">Reject</button>
        <button class="disable" data-redemption-id="${redemption.id}" data-status="cancelled">Cancel</button>
      </div></td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No catalog redemptions yet</td></tr>';
}

function renderEvents(events) {
  byId('eventsTable').innerHTML = events.length ? events.map(event => `
    <tr><td>${escapeHtml(formatDate(event.createdAt))}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.username)}</td>
    <td class="details" title="${escapeHtml(JSON.stringify(event.details))}">${escapeHtml(JSON.stringify(event.details))}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No activity recorded yet</td></tr>';
}

function renderTransactions(transactions) {
  const table = byId('transactionsTable');
  if (!table) return;
  table.innerHTML = transactions.length ? transactions.map(tx => `
    <tr>
      <td>${escapeHtml(formatDate(tx.createdAt))}</td>
      <td><span class="pill">${escapeHtml(tx.type)}</span></td>
      <td>${escapeHtml(tx.username)}</td>
      <td>${Number(tx.amount || 0) > 0 ? '+' : ''}${formatNumber(tx.amount)}</td>
      <td>${formatNumber(tx.balanceAfter)}</td>
      <td class="details" title="${escapeHtml(JSON.stringify(tx.details || {}))}">${escapeHtml(JSON.stringify(tx.details || {}))}</td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="empty">No token transactions recorded yet</td></tr>';
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

function catalogPayload() {
  return {
    title: byId('catalogTitle').value.trim(),
    tokenCost: Number(byId('catalogTokenCost').value),
    quantity: Number(byId('catalogQuantity').value),
    imageUrl: byId('catalogImageUrl').value.trim(),
    description: byId('catalogDescription').value.trim(),
    instructions: byId('catalogInstructions').value.trim(),
    active: byId('catalogActive').checked,
  };
}

function resetCatalogForm() {
  byId('catalogRewardId').value = '';
  byId('catalogRewardForm').reset();
  byId('catalogTokenCost').value = '1000';
  byId('catalogQuantity').value = '10';
  byId('catalogActive').checked = true;
  byId('catalogSubmitBtn').textContent = 'Save reward';
  byId('catalogRewardMessage').textContent = '';
  byId('catalogRewardMessage').classList.remove('error');
}

byId('catalogRewardForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = byId('catalogRewardId').value;
  const submit = byId('catalogSubmitBtn');
  const message = byId('catalogRewardMessage');
  submit.disabled = true;
  message.textContent = '';
  message.classList.remove('error');
  try {
    const data = await api(id ? `/api/admin/catalog-rewards/${id}` : '/api/admin/catalog-rewards', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(catalogPayload()),
    });
    message.textContent = `Saved reward ${data.reward.title}.`;
    resetCatalogForm();
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
  } finally {
    submit.disabled = false;
  }
});

byId('catalogCancelEdit').addEventListener('click', resetCatalogForm);

byId('catalogRewardsTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-catalog-id]');
  if (!button || !dashboardData) return;
  const reward = (dashboardData.catalogRewards || []).find(item => item.id === button.dataset.catalogId);
  if (!reward) return;

  if (button.dataset.action === 'edit') {
    byId('catalogRewardId').value = reward.id;
    byId('catalogTitle').value = reward.title || '';
    byId('catalogTokenCost').value = reward.tokenCost || 1;
    byId('catalogQuantity').value = reward.quantity || 0;
    byId('catalogImageUrl').value = reward.imageUrl || '';
    byId('catalogDescription').value = reward.description || '';
    byId('catalogInstructions').value = reward.instructions || '';
    byId('catalogActive').checked = !!reward.active;
    byId('catalogSubmitBtn').textContent = 'Update reward';
    byId('catalogTitle').focus();
    return;
  }

  const patch = button.dataset.action === 'archive'
    ? { archived: true }
    : { active: !reward.active };
  if (button.dataset.action === 'archive' && !window.confirm(`Archive ${reward.title}?`)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/catalog-rewards/${reward.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadDashboard();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
});

byId('catalogRedemptionsTable').addEventListener('click', async event => {
  const button = event.target.closest('button[data-redemption-id]');
  if (!button) return;
  const status = button.dataset.status;
  const note = ['fulfilled', 'rejected', 'cancelled'].includes(status)
    ? window.prompt('Optional fulfilment note:', '') || ''
    : '';
  if (['rejected', 'cancelled'].includes(status) && !window.confirm(`${status} this redemption? Tokens will be refunded.`)) return;
  button.disabled = true;
  try {
    await api(`/api/admin/reward-redemptions/${button.dataset.redemptionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, fulfilmentNote: note }),
    });
    await loadDashboard();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
});

byId('rewardCreateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const message = byId('rewardCreateMessage');
  submit.disabled = true;
  message.textContent = '';
  message.classList.remove('error');
  try {
    const payload = {
      code: byId('rewardCode').value.trim(),
      title: byId('rewardTitle').value.trim(),
      tokens: Number(byId('rewardTokens').value),
      maxRedemptions: Number(byId('rewardMaxRedemptions').value),
      expiresAt: byId('rewardExpiresAt').value || null,
    };
    const data = await api('/api/admin/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    message.textContent = `Created reward ${data.reward.code}.`;
    form.reset();
    byId('rewardTokens').value = '1000';
    byId('rewardMaxRedemptions').value = '1';
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
  } finally {
    submit.disabled = false;
  }
});

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
