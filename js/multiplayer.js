'use strict';

// ══════════════════════════════════════════
//  MULTIPLAYER CLIENT
// ══════════════════════════════════════════

// ── Wake Lock (keeps phone screen on while waiting) ───────────────────────────
let _wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch {}
}
function releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mp && mp.gameState) requestWakeLock();
});

const _wsProto   = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const _wsDefault = _wsProto + '//' + window.location.host;

function normalizeWebSocketUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return _wsDefault;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + url.host + url.pathname + url.search;
    } catch {
      return raw;
    }
  }
  if (/^ws:\/\//i.test(raw) && window.location.protocol === 'https:') {
    return raw.replace(/^ws:\/\//i, 'wss://');
  }
  if (/^wss?:\/\//i.test(raw)) return raw;
  return _wsProto + '//' + raw.replace(/^\/+/, '');
}

let mp = {
  ws:            null,
  myId:          null,
  roomCode:      null,
  isHost:        false,
  serverUrl:     _wsDefault,
  myName:        'Player',
  gameState:     null,
  connected:     false,
  connecting:    false,
  isSinglePlayer: false,
};

// ── Auth state ────────────────────────────────────────────────────────────────
const auth = {
  sessionToken: localStorage.getItem('pignusDiceSession') || null,
  username:     null,
  email:        null,
  role:         null,
  tokens:       null,
};

// ── Sound toggle ──────────────────────────────────────────────────────────────
function toggleSoundBtn() {
  if (!window.SFX) return;
  const muted = window.SFX.toggleMute();
  updateSoundControls();
  if (!muted && window.SFX.yourTurn) {
    window.SFX.startBackground?.();
    window.SFX.yourTurn();
  }
}

function updateSoundControls() {
  const btn = document.getElementById('menuSoundBtn');
  if (!window.SFX) return;
  const muted = window.SFX.isMuted();
  if (btn) {
    btn.textContent = muted ? 'Unmute Audio' : 'Mute Audio';
    btn.setAttribute('aria-pressed', String(!muted));
  }
  const slider = document.getElementById('menuVolumeRange');
  const value = document.getElementById('menuVolumeValue');
  const percent = Math.round((window.SFX.getVolume ? window.SFX.getVolume() : 0.7) * 100);
  if (slider && document.activeElement !== slider) slider.value = String(percent);
  if (value) value.textContent = percent + '%';
}

// Reflect stored mute state on load
updateSoundControls();

// ── Auth screen logic ─────────────────────────────────────────────────────────
function authShowError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function authShowLobby() {
  document.getElementById('authScreen').style.display  = 'none';
  document.getElementById('lobbyScreen').style.display = '';
  setGameActive(false);
  // Pre-fill name input
  const nameEl = document.getElementById('lobbyName');
  if (auth.username) {
    nameEl.value    = auth.username;
    nameEl.readOnly = true;
    nameEl.style.opacity = '0.6';
  }
  // Show account badge
  updateAccountBadge();
  updateMenuState();
  showPaymentReturnMessage();
  // Set server URL
  document.getElementById('lobbyServer').value = _wsDefault;
  // Auto-fill room code if arriving from a share link (?room=XXXX)
  const roomParam = new URLSearchParams(window.location.search).get('room');
  if (roomParam) {
    const codeEl = document.getElementById('lobbyCode');
    if (codeEl) codeEl.value = roomParam.toUpperCase();
    document.getElementById('lobbyJoinRow').style.display = 'block';
    const manualRow = document.getElementById('manualCodeRow');
    if (manualRow) manualRow.style.display = 'block';
    fetchAndShowRooms();
  }
}

function updateAccountBadge() {
  const badge = document.getElementById('accountBadge');
  const text  = document.getElementById('accountBadgeText');
  if (!badge) {
    updateMenuState();
    return;
  }
  if (auth.username) {
    if (text) text.textContent = '👤 ' + auth.username + ' — 💰 ' + (auth.tokens !== null ? auth.tokens : '—') + ' tokens';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.flexWrap = 'wrap';
    badge.style.gap = '8px';
    const adminLink = document.getElementById('adminPanelLink');
    if (adminLink) adminLink.style.display = auth.role === 'admin' ? '' : 'none';
  } else {
    badge.style.display = 'none';
  }
  updateMenuState();
}

function showPaymentReturnMessage() {
  const payment = new URLSearchParams(window.location.search).get('payment');
  if (!payment) return;
  const fbEl = document.getElementById('dailyBonusFeedback');
  if (!fbEl) return;
  if (payment === 'success') {
    fbEl.textContent = 'Payment received. Tokens will appear after Stripe confirms the payment.';
    fbEl.style.color = '#06d6a0';
  } else if (payment === 'cancelled') {
    fbEl.textContent = 'Checkout cancelled.';
    fbEl.style.color = '#f59e1b';
  }
  setTimeout(() => { fbEl.textContent = ''; }, 8000);
}

async function claimDailyBonus() {
  if (!auth.sessionToken) return;
  const btn = document.getElementById('dailyBonusBtn');
  if (btn) btn.disabled = true;
  try {
    const res  = await fetch('/api/daily-bonus', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + auth.sessionToken },
    });
    const data = await res.json();
    const fbEl = document.getElementById('dailyBonusFeedback');
    if (res.ok) {
      auth.tokens = data.tokens;
      updateAccountBadge();
      if (window.SFX) window.SFX.token();
      if (fbEl) { fbEl.textContent = '✅ +' + data.tokensAdded + ' tokens claimed!'; fbEl.style.color = '#06d6a0'; }
    } else if (res.status === 429) {
      if (fbEl) { fbEl.textContent = '⏳ Next bonus in ' + data.hoursLeft + 'h'; fbEl.style.color = '#f59e1b'; }
      if (btn) btn.disabled = false;
    } else {
      if (fbEl) { fbEl.textContent = data.error || 'Error'; fbEl.style.color = '#ff6b6b'; }
      if (btn) btn.disabled = false;
    }
    if (fbEl) setTimeout(() => { fbEl.textContent = ''; }, 5000);
  } catch {
    const fbEl = document.getElementById('dailyBonusFeedback');
    if (fbEl) { fbEl.textContent = 'Connection error'; fbEl.style.color = '#ff6b6b'; }
    if (btn) btn.disabled = false;
  }
}

async function authLogout() {
  if (mp.roomCode && !confirmLeaveActiveRoom('Log out and leave the current game?')) return;
  const oldToken = auth.sessionToken;
  auth.sessionToken = null;
  auth.username     = null;
  auth.email        = null;
  auth.role         = null;
  auth.tokens       = null;
  localStorage.removeItem('pignusDiceSession');
  if (oldToken) {
    fetch('/api/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + oldToken },
    }).catch(() => {});
  }
  leaveCurrentRoom({ confirm: false, closeSocket: true, resetLobby: false });
  setGameActive(false);
  closeGameMenu();
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('authScreen').style.display  = '';
  // Reset auth form fields
  document.getElementById('loginIdentifier').value = '';
  document.getElementById('loginPassword').value = '';
}

// Check saved session on load
async function authInit() {
  if (auth.sessionToken) {
    try {
      const res  = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + auth.sessionToken } });
      if (res.ok) {
        const data      = await res.json();
        auth.username   = data.user.username;
        auth.email      = data.user.email;
        auth.role       = data.user.role;
        auth.tokens     = data.user.tokens;
        mp.myName       = data.user.username;
        authShowLobby();
        return;
      }
    } catch {}
    auth.sessionToken = null;
    localStorage.removeItem('pignusDiceSession');
  }
  // No valid session — show auth screen
  document.getElementById('authScreen').style.display = '';
}

authInit();

// Tab switching
document.getElementById('loginTabBtn').addEventListener('click', () => {
  document.getElementById('loginForm').style.display    = '';
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginTabBtn').classList.add('active');
  document.getElementById('registerTabBtn').classList.remove('active');
  authShowError('');
});
document.getElementById('registerTabBtn').addEventListener('click', () => {
  document.getElementById('loginForm').style.display    = 'none';
  document.getElementById('registerForm').style.display = '';
  document.getElementById('loginTabBtn').classList.remove('active');
  document.getElementById('registerTabBtn').classList.add('active');
  authShowError('');
});

// Login
document.getElementById('loginBtn').addEventListener('click', async () => {
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!identifier || !password) { authShowError('Enter your email/username and password'); return; }
  try {
    const res  = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json();
    if (!res.ok) { authShowError(data.error || 'Login failed'); return; }
    auth.sessionToken = data.sessionToken;
    auth.username     = data.user.username;
    auth.email        = data.user.email;
    auth.role         = data.user.role;
    auth.tokens       = data.user.tokens;
    mp.myName         = data.user.username;
    localStorage.setItem('pignusDiceSession', data.sessionToken);
    authShowLobby();
  } catch { authShowError('Cannot connect to server'); }
});
document.getElementById('loginPassword').addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

// Register
document.getElementById('registerBtn').addEventListener('click', async () => {
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  if (!username || !email || !password) { authShowError('Enter a username, email, and password'); return; }
  try {
    const res  = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) { authShowError(data.error || 'Registration failed'); return; }
    auth.sessionToken = data.sessionToken;
    auth.username     = data.user.username;
    auth.email        = data.user.email;
    auth.role         = data.user.role;
    auth.tokens       = data.user.tokens;
    mp.myName         = data.user.username;
    localStorage.setItem('pignusDiceSession', data.sessionToken);
    authShowLobby();
  } catch { authShowError('Cannot connect to server'); }
});
document.getElementById('regPassword').addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('registerBtn').click();
});

// ── Screen helpers ────────────────────────────────────────────────────────────
function setGameActive(active) {
  document.body.classList.toggle('game-active', !!active);
}

function showScreen(id) {
  ['lobbyScreen','gameScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
  setGameActive(id === 'gameScreen');
  updateMenuState();
}

function lobbyError(msg) {
  const el = document.getElementById('lobbyError');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ── Create / Join buttons ─────────────────────────────────────────────────────
document.getElementById('lobbyJoinBtn').addEventListener('click', () => {
  const row = document.getElementById('lobbyJoinRow');
  if (row.style.display === 'none') {
    row.style.display = 'block';
    fetchAndShowRooms();
  } else {
    row.style.display = 'none';
  }
});

function toggleManualCode() {
  const row = document.getElementById('manualCodeRow');
  row.style.display = row.style.display === 'none' ? 'block' : 'none';
}

async function fetchAndShowRooms() {
  const listEl = document.getElementById('roomsList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:0.82rem;padding:10px;">Loading rooms...</div>';
  try {
    const res  = await fetch('/api/rooms');
    const data = await res.json();
    const rooms = data.rooms || [];
    if (!rooms.length) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:0.82rem;padding:12px;">No rooms available — create one!</div>';
      return;
    }
    listEl.innerHTML = '';
    rooms.forEach(r => {
      const card = document.createElement('div');
      card.className = 'room-browser-card';
      const statusLabel = r.started
        ? '<span class="room-status-ingame">IN GAME · ROUND ' + r.round + '</span>'
        : '<span class="room-status-waiting">WAITING</span>';
      const btnLabel = r.started ? 'JOIN NEXT ROUND' : 'JOIN';
      const totalPlayers = r.playerCount + r.pendingCount;
      card.innerHTML =
        '<div class="room-browser-info">' +
          '<span class="room-browser-code">' + r.code + '</span>' +
          '<span class="room-browser-players">👥 ' + totalPlayers + '/' + r.maxPlayers + '</span>' +
          statusLabel +
        '</div>' +
        '<button class="room-browser-join-btn">' + btnLabel + '</button>';
      card.querySelector('.room-browser-join-btn').onclick = () => {
        if (mp.connecting) return;
        mp.myName    = auth.username || document.getElementById('lobbyName').value.trim() || 'Player';
        mp.serverUrl = normalizeWebSocketUrl(document.getElementById('lobbyServer').value);
        connectWS(() => {
          mp.ws.send(JSON.stringify({
            type: 'join_room', code: r.code, name: mp.myName,
            sessionToken: auth.sessionToken || null,
          }));
        });
      };
      listEl.appendChild(card);
    });
  } catch {
    listEl.innerHTML = '<div style="text-align:center;color:#ff6b6b;font-size:0.82rem;padding:10px;">Could not load rooms</div>';
  }
}

document.getElementById('lobbyCreateBtn').addEventListener('click', () => {
  if (mp.connecting) return;
  mp.myName    = auth.username || document.getElementById('lobbyName').value.trim() || 'Player';
  mp.serverUrl = normalizeWebSocketUrl(document.getElementById('lobbyServer').value);
  connectWS(() => {
    mp.ws.send(JSON.stringify({
      type: 'create_room', name: mp.myName,
      startTokens: 500, sessionToken: auth.sessionToken || null,
    }));
  });
});

document.getElementById('lobbyJoinConfirmBtn').addEventListener('click', () => {
  if (mp.connecting) return;
  mp.myName    = auth.username || document.getElementById('lobbyName').value.trim() || 'Player';
  mp.serverUrl = normalizeWebSocketUrl(document.getElementById('lobbyServer').value);
  const code   = document.getElementById('lobbyCode').value.trim().toUpperCase();
  if (!code) { lobbyError('Enter a room code'); return; }
  connectWS(() => {
    mp.ws.send(JSON.stringify({
      type: 'join_room', code, name: mp.myName,
      sessionToken: auth.sessionToken || null,
    }));
  });
});

document.getElementById('lobbyStartBtn').addEventListener('click', () => {
  if (mp.ws) mp.ws.send(JSON.stringify({ type: 'start_game' }));
});

document.getElementById('vsComputerBtn').addEventListener('click', () => {
  if (mp.connecting) return;
  mp.myName    = auth.username || document.getElementById('lobbyName').value.trim() || 'Player';
  mp.serverUrl = normalizeWebSocketUrl(document.getElementById('lobbyServer').value);
  connectWS(() => {
    mp.ws.send(JSON.stringify({
      type: 'create_room', name: mp.myName,
      startTokens: 500, sessionToken: auth.sessionToken || null,
      vsComputer: true,
    }));
  });
});

document.getElementById('lobbyBackBtn').addEventListener('click', () => {
  returnToLobby();
});

// ── WebSocket connection ──────────────────────────────────────────────────────
function setLobbyButtons(disabled) {
  ['lobbyCreateBtn','lobbyJoinConfirmBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function connectWS(onOpen) {
  if (mp.connecting) return;
  mp.serverUrl = normalizeWebSocketUrl(mp.serverUrl);
  const serverInput = document.getElementById('lobbyServer');
  if (serverInput) serverInput.value = mp.serverUrl;
  mp.connecting = true;
  lobbyError('');
  setLobbyButtons(true);

  if (mp.ws) {
    mp.ws.onclose = null;
    mp.ws.onerror = null;
    mp.ws.close();
    mp.ws = null;
  }

  let socket;
  try {
    socket = new WebSocket(mp.serverUrl);
  } catch(e) {
    mp.connecting = false;
    setLobbyButtons(false);
    lobbyError('Invalid server address');
    return;
  }

  mp.ws = socket;

  socket.onopen = () => {
    if (mp.ws !== socket) return;
    mp.connected  = true;
    mp.connecting = false;
    setLobbyButtons(false);
    onOpen();
  };

  socket.onclose = () => {
    if (mp.ws !== socket) return;
    mp.connected  = false;
    mp.connecting = false;
    setLobbyButtons(false);
    const game = document.getElementById('gameScreen');
    if (game && game.style.display !== 'none') {
      showMsg('Connection lost — game ended.', 'error');
    }
  };

  socket.onerror = () => {
    if (mp.ws !== socket) return;
    mp.connecting = false;
    setLobbyButtons(false);
    lobbyError('Cannot connect to server. Check the address and try again.');
    mp.ws = null;
  };

  socket.onmessage = evt => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleServerMsg(msg);
  };
}

function disconnectWS(options = {}) {
  const notifyServer = options.notifyServer !== false;
  if (mp.ws) {
    if (notifyServer && mp.roomCode && mp.ws.readyState === WebSocket.OPEN) {
      try { mp.ws.send(JSON.stringify({ type: 'leave_room' })); } catch {}
    }
    mp.ws.onclose = null;
    mp.ws.onerror = null;
    mp.ws.close();
    mp.ws = null;
  }
  mp.connected  = false;
  mp.connecting = false;
  mp.myId       = null;
  mp.roomCode   = null;
  mp.gameState  = null;
  mp.isSinglePlayer = false;
  window._onlineSelected = new Set();
  releaseWakeLock();
  setLobbyButtons(false);
  updateMenuState();
}

// ── Server message handler ────────────────────────────────────────────────────
function handleServerMsg(msg) {
  switch (msg.type) {

    case 'room_created':
      mp.myId           = msg.playerId;
      mp.roomCode       = msg.code;
      mp.isHost         = true;
      mp.isSinglePlayer = !!msg.isSinglePlayer;
      showLobbyWaiting(msg.code, true, msg.isSinglePlayer);
      break;

    case 'room_joined':
      mp.myId     = msg.playerId;
      mp.roomCode = msg.code;
      mp.isHost   = false;
      showLobbyWaiting(msg.code, false);
      break;

    case 'waiting_for_round':
      mp.myId     = msg.playerId;
      mp.roomCode = msg.code;
      mp.isHost   = false;
      showLobbyWaiting(msg.code, false, false);
      document.getElementById('lobbyStatusMsg').textContent =
        '⏳ Waiting for Round ' + msg.round + ' to finish — you\'ll join next round!';
      document.getElementById('shareRoomBtn').style.display = 'none';
      document.getElementById('lobbyStartBtn').style.display = 'none';
      break;

    case 'player_joined':
      renderLobbyPlayers(msg.players);
      if (mp.isHost && !mp.isSinglePlayer) {
        document.getElementById('lobbyStatusMsg').textContent =
          msg.players.length >= 2
            ? msg.players.length + ' players ready — you can start!'
            : 'Waiting for players to join...';
        document.getElementById('lobbyStartBtn').style.display = msg.players.length >= 2 ? '' : 'none';
      } else if (!mp.isSinglePlayer) {
        document.getElementById('lobbyStatusMsg').textContent =
          msg.players.length + ' player' + (msg.players.length > 1 ? 's' : '') + ' in room — waiting for host to start...';
      }
      break;

    case 'game_starting':
      document.getElementById('lobbyStatusMsg').textContent = 'Game starting...';
      document.getElementById('lobbyStartBtn').style.display = 'none';
      mp.isSinglePlayer = !!msg.isSinglePlayer;
      break;

    case 'round_start':
      showScreen('gameScreen');
      document.getElementById('resultsBar').style.display   = 'none';
      document.getElementById('resultsOverlay').style.display = 'none';
      showMsg('Round ' + msg.round + ' started! Ante collected.');
      requestWakeLock();
      break;

    case 'snapshot':
      mp.gameState = msg;
      renderOnlineGame(msg);
      break;

    case 'your_turn':
      if (msg.playerId === mp.myId) {
        if (msg.cantAffordRoll) {
          showMsg("⚠️ Not enough tokens to roll! End your turn with your current hand.", 'warn');
        } else {
          showMsg('Your turn! Roll the dice.');
        }
        setOnlineButtonsEnabled(true);
        if (window.SFX) window.SFX.yourTurn();
      } else {
        const isAI = mp.gameState && mp.gameState.players.find(p => p.id === msg.playerId)?.isAI;
        showMsg(isAI ? '🤖 Computer is thinking...' : 'Waiting for ' + msg.playerName + ' to play...');
        setOnlineButtonsEnabled(false);
      }
      break;

    case 'bust':
      if (msg.playerId === mp.myId) {
        showMsg("💸 Not enough tokens to roll and you haven't qualified — Auto-folding...", 'error');
        if (window.SFX) window.SFX.roundLose();
      } else {
        showMsg(msg.playerName + " can't afford to roll — auto-folding.", 'warn');
      }
      break;

    case 'bet_action_needed':
      if (msg.playerId === mp.myId) {
        showOnlineBetting(msg.currentBet, msg.bettingPhase);
      }
      break;

    case 'betting_done':
      document.getElementById('bettingPanel').style.display = 'none';
      document.getElementById('activeBoard').style.display  = '';
      break;

    case 'phase_change':
      if (msg.subRound >= 2) {
        showMsg('⚔️ SUB-ROUND ' + msg.subRound + ' — Roll your remaining dice!');
        if (window.SFX) window.SFX.phase2();
      }
      break;

    case 'round_over':
      renderOnlineResults(msg);
      break;

    case 'game_over':
      renderOnlineGameOver(msg);
      break;

    case 'qualify_failed':
      if (msg.playerId === mp.myId) {
        showMsg('You rolled a ' + msg.rolledValue + ' — needed a ' + msg.neededQual + '. You did not qualify! Auto-folding...', 'error');
      } else {
        showMsg(msg.playerName + ' did not qualify — auto-folding.', 'warn');
      }
      if (window.SFX) window.SFX.roundLose();
      break;

    case 'player_left':
      showMsg(msg.playerName + ' disconnected.', 'warn');
      break;

    case 'host_changed':
      mp.isHost = msg.playerId === mp.myId;
      if (mp.isHost && isVisible('lobbyWaiting')) {
        const players = msg.players || [];
        document.getElementById('lobbyStatusMsg').textContent =
          players.length >= 2
            ? 'You are now the host. You can start the game.'
            : 'You are now the host. Waiting for players to join...';
        document.getElementById('lobbyStartBtn').style.display = players.length >= 2 ? '' : 'none';
      }
      updateMenuState();
      break;

    case 'room_left':
      returnToLobby({ confirm: false, alreadyDisconnected: true });
      break;

    case 'error':
      showMsg(msg.msg, 'error');
      break;
  }
}

// ── Lobby UI ──────────────────────────────────────────────────────────────────
function showLobbyWaiting(code, isHost, isSinglePlayer) {
  document.getElementById('lobbyConnect').style.display = 'none';
  document.getElementById('lobbyWaiting').style.display = 'block';
  document.getElementById('lobbyRoomCode').textContent  = isSinglePlayer ? 'VS AI' : code;
  document.getElementById('lobbyStartBtn').style.display = 'none';
  document.getElementById('shareFeedback').textContent  = '';
  document.getElementById('shareRoomBtn').style.display = isSinglePlayer ? 'none' : '';
  document.getElementById('lobbyStatusMsg').textContent =
    isSinglePlayer ? '🤖 Practice mode — starting shortly...'
    : isHost ? 'You are the host. Waiting for players to join...'
    : 'Joined! Waiting for host to start...';
}

function shareRoomLink() {
  const code = mp.roomCode;
  if (!code) return;
  const base = window.location.href.split('?')[0];
  const url  = base + '?room=' + code;
  const text = "You've been invited to PignusDice! Room: " + code + "\nJoin at: " + url;
  const fb   = document.getElementById('shareFeedback');
  if (navigator.share) {
    navigator.share({ title: 'PignusDice — Room ' + code, text, url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      fb.textContent = '✅ Link copied to clipboard!';
      setTimeout(() => { fb.textContent = ''; }, 3000);
    }).catch(() => {
      fb.textContent = 'Link: ' + url;
    });
  } else {
    fb.textContent = 'Code: ' + code;
  }
}

function currentInvitePayload() {
  const code = mp.roomCode;
  const inviteUrl = code ? new URL('/join', window.location.origin) : new URL('/', window.location.origin);
  if (code) inviteUrl.searchParams.set('room', code);
  const url = inviteUrl.toString();
  return {
    title: code ? 'PignusDice - Room ' + code : 'PignusDice',
    url,
    text: code
      ? "You've been invited to PignusDice. Room: " + code + "\nJoin here: " + url
      : "Join me on PignusDice: " + url,
  };
}

function copyInviteText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    try {
      if (document.execCommand('copy')) resolve();
      else reject(new Error('copy failed'));
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(area);
    }
  });
}

function showShareFallback(feedbackEl, text, message) {
  if (!feedbackEl) return;
  feedbackEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'share-fallback-card';
  const note = document.createElement('div');
  note.textContent = message;
  const field = document.createElement('textarea');
  field.className = 'share-text';
  field.readOnly = true;
  field.value = text;
  field.addEventListener('focus', () => field.select());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'share-copy-btn';
  btn.textContent = 'Copy Invite';
  btn.addEventListener('click', async () => {
    try {
      await copyInviteText(text);
      note.textContent = 'Invite copied.';
    } catch {
      field.focus();
      field.select();
      note.textContent = 'Select and copy the invite below.';
    }
  });
  const actions = document.createElement('div');
  actions.className = 'share-quick-actions';
  const whatsapp = document.createElement('a');
  whatsapp.href = 'https://wa.me/?text=' + encodeURIComponent(text);
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener';
  whatsapp.textContent = 'WhatsApp';
  const email = document.createElement('a');
  email.href = 'mailto:?subject=' + encodeURIComponent('PignusDice invite') + '&body=' + encodeURIComponent(text);
  email.textContent = 'Email';
  actions.append(whatsapp, email);
  wrap.append(note, field, btn);
  wrap.appendChild(actions);
  feedbackEl.appendChild(wrap);
  field.focus();
  field.select();
}

shareRoomLink = async function shareRoomLink(feedbackId = 'shareFeedback') {
  const payload = currentInvitePayload();
  const fb = document.getElementById(feedbackId) || document.getElementById('shareFeedback');
  if (fb) {
    fb.textContent = '';
    fb.style.color = '#06d6a0';
  }

  if (navigator.share && window.isSecureContext) {
    try {
      await navigator.share(payload);
      if (fb) fb.textContent = 'Invite ready.';
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }

  try {
    await copyInviteText(payload.text);
    if (fb) {
      fb.textContent = 'Invite copied to clipboard.';
      setTimeout(() => { if (fb.textContent === 'Invite copied to clipboard.') fb.textContent = ''; }, 3000);
    }
  } catch {
    showShareFallback(
      fb,
      payload.text,
      window.isSecureContext ? 'Copy this invite:' : 'Sharing is limited on HTTP. Copy this invite manually:'
    );
  }
};

function isVisible(id) {
  const el = document.getElementById(id);
  return !!el && getComputedStyle(el).display !== 'none' && !el.hidden;
}

function confirmLeaveActiveRoom(message) {
  const overlay = document.getElementById('resultsOverlay');
  const gameOverVisible = overlay && getComputedStyle(overlay).display !== 'none';
  const activeGame = isVisible('gameScreen') && !gameOverVisible;
  const waitingRoom = isVisible('lobbyWaiting');
  if (!activeGame && !waitingRoom && !mp.roomCode) return true;
  return window.confirm(message || (activeGame
    ? 'Leave this active game and return to the lobby?'
    : 'Leave this room and return to the lobby?'));
}

function resetLobbyView() {
  const resultsOverlay = document.getElementById('resultsOverlay');
  const resultsBar = document.getElementById('resultsBar');
  const bettingPanel = document.getElementById('bettingPanel');
  const activeBoard = document.getElementById('activeBoard');
  if (resultsOverlay) resultsOverlay.style.display = 'none';
  if (resultsBar) resultsBar.style.display = 'none';
  if (bettingPanel) bettingPanel.style.display = 'none';
  if (activeBoard) activeBoard.style.display = '';

  document.getElementById('lobbyConnect').style.display = 'block';
  document.getElementById('lobbyWaiting').style.display = 'none';
  document.getElementById('lobbyPlayerList').innerHTML = '';
  document.getElementById('lobbyStatusMsg').textContent = 'Waiting for players...';
  document.getElementById('shareFeedback').textContent = '';
  lobbyError('');
  showScreen('lobbyScreen');
  closeGameMenu();
}

function leaveCurrentRoom(options = {}) {
  const confirmFirst = options.confirm !== false;
  if (confirmFirst && !confirmLeaveActiveRoom()) return false;
  if (!options.alreadyDisconnected) {
    disconnectWS({ notifyServer: true });
  } else {
    if (mp.ws) {
      mp.ws.onclose = null;
      mp.ws.onerror = null;
      try { mp.ws.close(); } catch {}
    }
    mp.connected = false;
    mp.connecting = false;
    mp.myId = null;
    mp.roomCode = null;
    mp.ws = null;
  }
  releaseWakeLock();
  mp.gameState = null;
  mp.isSinglePlayer = false;
  mp.isHost = false;
  window._onlineSelected = new Set();
  if (options.resetLobby !== false) resetLobbyView();
  return true;
}

function returnToLobby(options = {}) {
  if (options && options.type) options = {};
  return leaveCurrentRoom(options);
}

function updateMenuState() {
  const menuButton = document.getElementById('menuButton');
  const roomInfo = document.getElementById('menuRoomInfo');
  const leaveBtn = document.getElementById('menuLeaveBtn');
  const returnBtn = document.getElementById('menuReturnLobbyBtn');
  const shareBtn = document.getElementById('menuShareBtn');
  const resumeBtn = document.getElementById('menuResumeBtn');
  const exitBtn = document.getElementById('menuExitBtn');
  if (!menuButton || !roomInfo) return;

  const inGame = isVisible('gameScreen');
  const inLobby = isVisible('lobbyScreen');
  const inWaitingRoom = isVisible('lobbyWaiting');
  const canLeaveRoom = inGame || inWaitingRoom || mp.connected || mp.roomCode;
  const roomLabel = mp.roomCode
    ? (mp.isSinglePlayer ? 'Practice game' : 'Room ' + mp.roomCode)
    : inGame ? 'Game in progress'
    : inLobby ? 'Lobby'
    : 'Signed out';

  roomInfo.textContent = roomLabel;
  if (resumeBtn) resumeBtn.disabled = !(inGame || inWaitingRoom);
  if (leaveBtn) leaveBtn.disabled = !canLeaveRoom;
  if (returnBtn) returnBtn.disabled = !canLeaveRoom && !inLobby;
  if (shareBtn) shareBtn.textContent = mp.roomCode ? 'Share Room Invite' : 'Share Game Link';
  if (exitBtn) exitBtn.disabled = !auth.sessionToken;
  updateSoundControls();
}

function openGameMenu() {
  const panel = document.getElementById('gameMenuPanel');
  const backdrop = document.getElementById('menuBackdrop');
  const button = document.getElementById('menuButton');
  if (!panel || !backdrop || !button) return;
  updateMenuState();
  panel.hidden = false;
  backdrop.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  const feedback = document.getElementById('menuFeedback');
  if (feedback) feedback.textContent = '';
}

function closeGameMenu() {
  const panel = document.getElementById('gameMenuPanel');
  const backdrop = document.getElementById('menuBackdrop');
  const button = document.getElementById('menuButton');
  if (panel) panel.hidden = true;
  if (backdrop) backdrop.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

function initGameMenu() {
  const menuButton = document.getElementById('menuButton');
  const closeBtn = document.getElementById('menuCloseBtn');
  const backdrop = document.getElementById('menuBackdrop');
  const resumeBtn = document.getElementById('menuResumeBtn');
  const leaveBtn = document.getElementById('menuLeaveBtn');
  const returnBtn = document.getElementById('menuReturnLobbyBtn');
  const shareBtn = document.getElementById('menuShareBtn');
  const buyBtn = document.getElementById('menuBuyTokensBtn');
  const redeemBtn = document.getElementById('menuRedeemBtn');
  const soundBtn = document.getElementById('menuSoundBtn');
  const volumeRange = document.getElementById('menuVolumeRange');
  const exitBtn = document.getElementById('menuExitBtn');

  if (menuButton) menuButton.addEventListener('click', () => {
    const panel = document.getElementById('gameMenuPanel');
    if (panel && !panel.hidden) closeGameMenu();
    else openGameMenu();
  });
  if (closeBtn) closeBtn.addEventListener('click', closeGameMenu);
  if (backdrop) backdrop.addEventListener('click', closeGameMenu);
  if (resumeBtn) resumeBtn.addEventListener('click', closeGameMenu);
  if (leaveBtn) leaveBtn.addEventListener('click', returnToLobby);
  if (returnBtn) returnBtn.addEventListener('click', returnToLobby);
  if (shareBtn) shareBtn.addEventListener('click', () => shareRoomLink('menuFeedback'));
  if (buyBtn) buyBtn.addEventListener('click', () => {
    closeGameMenu();
    openTokenPacks();
  });
  if (redeemBtn) redeemBtn.addEventListener('click', () => {
    closeGameMenu();
    openRewardRedeem();
  });
  if (soundBtn) soundBtn.addEventListener('click', toggleSoundBtn);
  if (volumeRange) volumeRange.addEventListener('input', () => {
    if (!window.SFX) return;
    window.SFX.setVolume(Number(volumeRange.value) / 100);
    updateSoundControls();
  });
  if (exitBtn) exitBtn.addEventListener('click', authLogout);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeGameMenu();
  });
  updateMenuState();
}

initGameMenu();

function renderLobbyPlayers(players) {
  const COLORS = ['#e63e6d','#06d6a0','#f59e1b','#5cc8f5','#b06dff','#ff9a3c'];
  const list = document.getElementById('lobbyPlayerList');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lobby-player-entry';
    const online = document.createElement('span');
    online.className = 'online-indicator';
    const dot = document.createElement('span');
    dot.className = 'lobby-player-dot';
    dot.style.background = p.color || COLORS[i % COLORS.length];
    const name = document.createElement('span');
    name.className = 'lobby-player-name';
    name.textContent = p.name || 'Player';
    const tag = document.createElement('span');
    tag.className = 'lobby-player-tag';
    tag.textContent = p.id === mp.myId ? '(You)' : '';
    el.append(online, dot, name, tag);
    list.appendChild(el);
  });
}

// ── Online game render ────────────────────────────────────────────────────────
function hasCompletedQualifyingHand(player) {
  return Array.isArray(player.qualifyHand) &&
    player.qualifyHand.includes(1) &&
    player.qualifyHand.includes(4);
}

function qualifyingHandStatus(player, compact) {
  if (player.folded)
    return compact ? '&#10060;' : '&#10060; Folded';

  if (hasCompletedQualifyingHand(player))
    return compact ? '&#9989; Qualified' : '&#9989; Qualifying hand complete';

  if (player.rollsUsed > 0)
    return compact ? 'Not qualified' : 'Qualifying hand incomplete';

  return compact ? '&mdash;' : '&#9203; Waiting';
}

function renderOnlineGame(snap) {
  const me = snap.players.find(p => p.id === mp.myId);
  if (!me) return;

  document.getElementById('potAmount').textContent = snap.pot;
  document.getElementById('roundInfo').textContent = 'Round ' + snap.round;

  // Live pot & round display
  const potVal = document.getElementById('potInfoDisplay');
  if (potVal) potVal.textContent = snap.pot;
  const roundVal = document.getElementById('roundInfoDisplay');
  if (roundVal) roundVal.textContent = snap.round;
  const spBadge = document.getElementById('singlePlayerBadge');
  if (spBadge) spBadge.style.display = snap.isSinglePlayer ? '' : 'none';

  const strip = document.getElementById('playersStrip');
  strip.innerHTML = '';
  snap.players.forEach(p => {
    const tab = document.createElement('div');
    tab.className = 'player-tab' +
      (p.id === snap.turnPlayerId ? ' active-turn' : '') +
      (p.folded  ? ' folded'      : '') +
      (p.tokens <= 0 ? ' eliminated' : '');
    const tabQual = hasCompletedQualifyingHand(p) ? '✅' : p.folded ? '❌' : p.rollsUsed > 0 ? '⚠' : '—';
    tab.innerHTML =
      '<div class="tab-name" style="color:' + p.color + '">' + p.name + (p.id === mp.myId ? ' (You)' : '') + '</div>' +
      '<div class="tab-tokens">💰 ' + p.tokens + '</div>' +
      '<div class="tab-score">' + tabQual + '</div>' +
      '<div class="turn-arrow">▼</div>';
    strip.appendChild(tab);
  });

  const grid = document.getElementById('opponentsGrid');
  grid.innerHTML = '';
  snap.players.filter(p => p.id !== mp.myId).forEach(p => {
    const card = document.createElement('div');
    const hasQualified = hasCompletedQualifyingHand(p);
    card.className = 'opp-card color-' + p.colorIdx + (p.folded ? ' folded' : '') + (hasQualified ? ' qualified-hand' : '');

    // Only show the two qualifier slots — scoring dice are hidden until round reveal
    let qualHTML = '';
    const needs1 = !p.qualifyHand.includes(1);
    const needs4 = !p.qualifyHand.includes(4);
    const tmp1 = document.createElement('div');
    const tmp4 = document.createElement('div');
    setDieImg(tmp1, needs1 ? 0 : 1, false, !needs1);
    setDieImg(tmp4, needs4 ? 0 : 4, false, !needs4);
    qualHTML =
      '<div class="small-die" style="background-image:' + tmp1.style.backgroundImage + '" title="1"></div>' +
      '<div class="small-die" style="background-image:' + tmp4.style.backgroundImage + '" title="4"></div>';

    card.innerHTML =
      '<div class="opp-card-header">' +
        '<div class="opp-dot" style="background:' + p.color + '"></div>' +
        '<div class="opp-name">' + p.name + '</div>' +
      '</div>' +
      '<div class="opp-qual-slots">' + qualHTML + '</div>' +
      '<div class="opp-status ' + (hasQualified ? 'qualified' : p.folded ? '' : 'no14') + '">' +
        (p.folded ? '❌ Folded' : hasQualified ? '✅ Qualified' : p.rollsUsed > 0 ? '⚠ Playing...' : '⏳ Waiting') +
      '</div>';
    grid.appendChild(card);
  });

  renderOnlineMyBoard(me, snap);
}

function renderOnlineMyBoard(me, snap) {
  const isMyTurn = snap.turnPlayerId === mp.myId;
  document.getElementById('activeName').textContent      = me.name.toUpperCase() + ' (YOU)';
  document.getElementById('activeTokensVal').textContent = me.tokens;
  document.getElementById('anteRollTag').textContent     = 'ANTE: ' + ANTE + ' | ROLL COST: ' + ROLL_COST;
  document.getElementById('rollCounter').textContent     = 'rolls: ' + me.rollsUsed + '/' + MAX_ROLLS;
  document.getElementById('rollSavePill').textContent    = me.rollsUsed === 0 ? '(perfect save!)' : '';
  document.getElementById('rollCostPill').textContent    = 'Cost ' + ROLL_COST;
  const subRound = snap.subRound || 1;
  document.getElementById('lockHint').style.display = me.mustLockBeforeRoll ? '' : 'none';
  document.getElementById('rollZoneLabel').innerHTML = subRound > 1
    ? '<span class="zone-icon">🎲</span> SUB-ROUND ' + subRound + ' — Roll remaining dice, lock ≥1, then bet | Cost: ' + ROLL_COST
    : '<span class="zone-icon">🎲</span> ROUND ' + subRound + ' — Roll, select dice to keep, then bet | Cost: ' + ROLL_COST;

  const qRow = document.getElementById('qualifyRow');
  qRow.innerHTML = '';
  if (!me.qualifyHand.length) {
    qRow.innerHTML = '<span class="zone-hint">⚡ Lock a 1 and a 4 (any number per roll)</span>';
  } else {
    me.qualifyHand.forEach(v => {
      const d = document.createElement('div');
      d.className = 'die locked'; setDieImg(d, v, false, true); qRow.appendChild(d);
    });
  }

  const sRow = document.getElementById('scoringRow');
  sRow.innerHTML = '';
  if (!me.scoringHand.length) {
    sRow.innerHTML = '<span class="zone-hint-dim">🎲 Lock up to 4 scoring dice here</span>';
  } else {
    me.scoringHand.forEach(v => {
      const d = document.createElement('div');
      d.className = 'die locked'; setDieImg(d, v, false, false); sRow.appendChild(d);
    });
    const qc = me.qualifyHand.includes(1) && me.qualifyHand.includes(4);
    if (qc)
      sRow.insertAdjacentHTML('beforeend', '<span class="zone-hint" style="font-size:0.85rem;margin-left:8px">&#9989; Qualified</span>');
  }

  const rRow = document.getElementById('rollRow');
  rRow.innerHTML = '';
  if (!me.currentDice || !me.currentDice.length) {
    rRow.innerHTML = '<span class="zone-hint">⚡ ' + (me.rollsUsed === 0 ? 'Press ROLL (cost ' + ROLL_COST + ')' : 'Press ROLL DICE for next roll') + '</span>';
    document.getElementById('lockHintLine').style.display = 'none';
  } else {
    if (!window._onlineSelected) window._onlineSelected = new Set();
    me.currentDice.forEach((v, i) => {
      const d   = document.createElement('div');
      const sel = window._onlineSelected.has(i);
      d.className = 'die selectable' + (sel ? ' selected' : '');
      setDieImg(d, v, sel, false);
      const toggle = e => {
        e.preventDefault();
        if (window._onlineSelected.has(i)) window._onlineSelected.delete(i);
        else window._onlineSelected.add(i);
        renderOnlineMyBoard(me, snap);
        document.getElementById('lockBtn').disabled = !window._onlineSelected.size || !isMyTurn;
      };
      d.addEventListener('click', toggle);
      d.addEventListener('touchend', toggle, { passive: false });
      rRow.appendChild(d);
    });
    document.getElementById('lockHintLine').style.display = 'block';
  }

  const midOpen  = document.getElementById('midRollBetting').style.display === 'block';
  const handFull = me.qualifyHand.includes(1) && me.qualifyHand.includes(4) && me.scoringHand.length === 4;
  const pendingFold = !!me.pendingAutoFold;
  const hasQualifier = me.qualifyHand.includes(1) && me.qualifyHand.includes(4);
  const brokeButQualified = me.tokens < ROLL_COST && hasQualifier;
  // ONE roll per turn — blocked after first roll or when hand is completely full
  const rollBlocked = !isMyTurn || midOpen || me.rollsUsed >= 1 || me.tokens < ROLL_COST
                    || handFull || !!me.mustLockBeforeRoll || pendingFold;
  // End turn: must roll first unless hand is full, broke-but-qualified, or already rolled
  const mustRollFirst     = !handFull && me.rollsUsed === 0 && !brokeButQualified;
  const mustLockAfterRoll = me.rollsUsed > 0 && !!me.mustLockBeforeRoll;
  document.getElementById('rollBtn').disabled    = rollBlocked;
  document.getElementById('lockBtn').disabled    = !isMyTurn || midOpen || pendingFold || !(window._onlineSelected && window._onlineSelected.size);
  document.getElementById('endTurnBtn').disabled = !isMyTurn || midOpen || pendingFold || mustRollFirst || mustLockAfterRoll;
  if (!me.currentDice || me.currentDice.length === 0) window._onlineSelected = new Set();
}

function setOnlineButtonsEnabled(enabled) {
  document.getElementById('rollBtn').disabled    = !enabled;
  document.getElementById('lockBtn').disabled    = true;
  document.getElementById('endTurnBtn').disabled = !enabled;
}

// ── Online betting ────────────────────────────────────────────────────────────
function showOnlineBetting(currentBet, bettingPhase) {
  const me = mp.gameState ? mp.gameState.players.find(p => p.id === mp.myId) : null;
  if (!me) return;
  const callAmt    = Math.max(0, currentBet - (me.roundBet || 0));
  const isAfterRoll = bettingPhase === 'after_roll';

  document.getElementById('bettingPanel').style.display = 'block';
  document.getElementById('activeBoard').style.display  = 'none';
  document.getElementById('bettingPlayerName').textContent = isAfterRoll ? 'Place Your Bet' : 'Your Action';

  // Hand status reminder — how many dice slots remain to fill
  const qualLeft  = (me.qualifyHand.includes(1) ? 0 : 1) + (me.qualifyHand.includes(4) ? 0 : 1);
  const scoreLeft = 4 - (me.scoringHand ? me.scoringHand.length : 0);
  const slotsLeft = qualLeft + scoreLeft;
  const handStatusEl = document.getElementById('betHandStatus');
  if (handStatusEl) {
    const qualStr = me.qualifyHand.includes(1) && me.qualifyHand.includes(4)
      ? '✅ Qualified'
      : (me.qualifyHand.includes(1) ? '🔑 Have 1 — need 4' : me.qualifyHand.includes(4) ? '🔑 Have 4 — need 1' : '🔑 Need 1 and 4');
    handStatusEl.textContent = qualStr + ' · Scoring: ' + (me.scoringHand ? me.scoringHand.length : 0) + '/4 · ' + slotsLeft + ' dice slot' + (slotsLeft !== 1 ? 's' : '') + ' remaining';
  }

  let betAmt = Math.max(10, callAmt);

  const betInput = document.getElementById('betDisplay');
  betInput.value = betAmt;
  betInput.max   = me.tokens;

  const syncBet = () => {
    const raw = parseInt(betInput.value) || 10;
    betAmt = Math.max(10, Math.min(me.tokens, Math.round(raw / 10) * 10));
    betInput.value = betAmt;
  };
  betInput.oninput = () => {
    const raw = parseInt(betInput.value);
    if (!isNaN(raw)) betAmt = Math.max(10, Math.min(me.tokens, raw));
  };
  betInput.onblur = syncBet;

  document.getElementById('betMinus').onclick = () => {
    betAmt = Math.max(10, betAmt - 10);
    betInput.value = betAmt;
  };
  document.getElementById('betPlus').onclick = () => {
    betAmt = Math.min(me.tokens, betAmt + 10);
    betInput.value = betAmt;
  };

  const pre = document.getElementById('betPresets');
  pre.innerHTML = '';
  [10, 50, 100, 250, 500, 1000].forEach(v => {
    if (v > me.tokens) return;
    const b = document.createElement('button');
    b.className = 'preset-btn'; b.textContent = v;
    b.onclick = () => { betAmt = v; betInput.value = betAmt; };
    pre.appendChild(b);
  });

  // After rolling: only CHECK or RAISE (no fold/call — player already committed)
  // Before rolling: CALL / RAISE / FOLD (or CHECK if nothing to call)
  document.getElementById('foldBtn').style.display  = isAfterRoll ? 'none' : '';
  document.getElementById('callBtn').style.display  = (!isAfterRoll && callAmt > 0) ? '' : 'none';
  document.getElementById('checkBtn').style.display = (isAfterRoll || callAmt === 0) ? '' : 'none';
  document.getElementById('callBtn').textContent    = 'CALL (−' + callAmt + ')';

  document.getElementById('checkBtn').onclick = () => { if (window.SFX) window.SFX.bet(); sendBet('check', 0); };
  document.getElementById('callBtn').onclick  = () => { if (window.SFX) window.SFX.bet(); sendBet('call',  callAmt); };
  document.getElementById('raiseBtn').onclick = () => { syncBet(); if (window.SFX) window.SFX.bet(); sendBet('raise', betAmt); };
  document.getElementById('foldBtn').onclick  = () => sendBet('fold', 0);
}

function sendBet(action, amount) {
  if (mp.ws) mp.ws.send(JSON.stringify({ type: 'bet', action, amount }));
}

// ── Online results ────────────────────────────────────────────────────────────
function renderOnlineResults(msg) {
  const bar    = document.getElementById('resultsBar');
  const scores = document.getElementById('resultsBarScores');
  const winEl  = document.getElementById('resultsBarWinner');
  scores.innerHTML = '';
  msg.players.forEach(p => {
    const pill  = document.createElement('div');
    pill.className = 'results-pill';
    const score = p.folded ? '—' : !p.qualified ? '—' : p.finalScore;
    pill.innerHTML = '<span style="color:' + (p.color || '#fff') + '">●</span> ' + p.name + (p.id === mp.myId ? ' (You)' : '') + ': ' + score;
    scores.appendChild(pill);
  });
  const winners = msg.players.filter(p => msg.winners.includes(p.id));
  if (msg.potWentToHouse) {
    winEl.innerHTML = '🏦 No one qualified — pot forfeit to the house!';
  } else if (winners.length) {
    const w = winners[0];
    const potShare = Math.floor(msg.pot / winners.length);
    const iWonThis = w.id === mp.myId;
    const wonTag   = iWonThis ? (msg.isSinglePlayer ? ' (+' + potShare + ' practice tokens)' : ' +' + potShare + ' tokens!') : '';
    winEl.innerHTML = '👑 WINNER: ' + w.name + ' — Score: ' + w.finalScore + wonTag + ' 👑';
  } else {
    winEl.textContent = 'No winner this round';
  }
  if (msg.isSinglePlayer) {
    winEl.innerHTML += '<br><span style="font-size:0.75rem;color:rgba(255,255,255,0.6)">Practice mode — tokens not saved</span>';
  }
  bar.style.display = 'block';
  showMsg('Round over! Next round starting in 5 seconds...');

  // Sound feedback
  const iWon = msg.winners.includes(mp.myId);
  if (window.SFX) {
    if (iWon) window.SFX.roundWin();
    else      window.SFX.roundLose();
  }

  // Update account token balance
  const myPlayer = msg.players.find(p => p.id === mp.myId);
  if (myPlayer && auth.sessionToken) {
    auth.tokens = myPlayer.tokens;
    updateAccountBadge();
  }
}

function renderOnlineGameOver(msg) {
  const humanPlayers = msg.players.filter(p => !p.isAI);
  const sorted = [...msg.players].sort((a, b) => b.tokens - a.tokens);
  const title  = document.getElementById('resultsTitle');
  const body   = document.getElementById('resultsBody');
  const btn    = document.getElementById('nextRoundBtn');

  if (msg.isSinglePlayer) {
    title.textContent = '🤖 PRACTICE COMPLETE';
  } else {
    title.textContent = '🎮 GAME OVER';
  }

  let bodyHtml = sorted.map(p =>
    '<div class="score-row ' + (p.tokens === sorted[0].tokens ? 'winner-row' : '') + '">' +
      '<div class="score-name">' + p.name + (p.id === mp.myId ? ' (You)' : p.isAI ? ' 🤖' : '') + '</div>' +
      '<div class="score-val">' + p.tokens + '</div>' +
    '</div>'
  ).join('');

  if (msg.isSinglePlayer) {
    bodyHtml += '<p style="text-align:center;color:var(--muted);margin-top:10px;font-size:0.82rem;">Practice mode — your account balance is unchanged</p>';
  }
  body.innerHTML = bodyHtml;

  btn.textContent = 'NEW GAME';
  btn.onclick = () => returnToLobby({ confirm: false });
  document.getElementById('resultsOverlay').style.display = 'flex';
  releaseWakeLock();

  if (window.SFX) {
    if (msg.isSinglePlayer) window.SFX.gameWin(); // always celebrate practice
    else if (sorted[0] && sorted[0].id === mp.myId) window.SFX.gameWin();
    else window.SFX.gameLose?.();
  }

  // Update saved balance (only for real multiplayer)
  if (!msg.isSinglePlayer) {
    const me = msg.players.find(p => p.id === mp.myId);
    if (me && auth.sessionToken) {
      auth.tokens = me.tokens;
      updateAccountBadge();
    }
  }
}

// ── Wire online roll/lock/end to server ───────────────────────────────────────
function isOnlineMode() { return mp.ws && mp.connected; }

const _origRollBtn = document.getElementById('rollBtn');
const _origLockBtn = document.getElementById('lockBtn');
const _origEndBtn  = document.getElementById('endTurnBtn');

_origRollBtn.addEventListener('click', () => {
  if (!isOnlineMode()) return;
  mp.ws.send(JSON.stringify({ type: 'roll' }));
  if (window.SFX) window.SFX.roll();
});

_origLockBtn.addEventListener('click', () => {
  if (!isOnlineMode()) return;
  const sel = window._onlineSelected ? [...window._onlineSelected] : [];
  if (!sel.length) { showMsg('Select at least one die!', 'error'); return; }
  mp.ws.send(JSON.stringify({ type: 'lock', selectedIdx: sel }));
  window._onlineSelected = new Set();
  if (window.SFX) window.SFX.lock();
});

_origEndBtn.addEventListener('click', () => {
  if (!isOnlineMode()) return;
  mp.ws.send(JSON.stringify({ type: 'end_turn' }));
});

// ── Token packs ───────────────────────────────────────────────────────────────
function openTokenPacks() {
  const modal = document.getElementById('tokenPacksModal');
  if (!modal) return;
  const note = document.getElementById('tokenPacksLoginNote');
  if (note) note.style.display = (!auth.sessionToken) ? 'block' : 'none';
  modal.style.display = 'flex';
}
function closeTokenPacks() {
  const modal = document.getElementById('tokenPacksModal');
  if (modal) modal.style.display = 'none';
}
async function tokenPackBuy(packId) {
  if (!auth.sessionToken) {
    alert('Please sign in to purchase token packs.');
    closeTokenPacks();
    return;
  }
  const selectorPackId = String(packId).replace(/"/g, '');
  const btn = document.querySelector('.token-pack-btn[data-pack-id="' + selectorPackId + '"]');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.sessionToken,
      },
      body: JSON.stringify({ packId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to start checkout');
    window.location.href = data.url;
  } catch (error) {
    alert(error.message);
    if (btn) btn.disabled = false;
  }
}

function openRewardRedeem() {
  if (!auth.sessionToken) {
    alert('Please sign in to redeem reward codes.');
    return;
  }
  const modal = document.getElementById('rewardRedeemModal');
  const input = document.getElementById('rewardCodeInput');
  const feedback = document.getElementById('rewardRedeemFeedback');
  if (feedback) feedback.textContent = '';
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 0);
  }
  if (modal) modal.style.display = 'flex';
}

function closeRewardRedeem() {
  const modal = document.getElementById('rewardRedeemModal');
  if (modal) modal.style.display = 'none';
}

async function redeemRewardCode() {
  if (!auth.sessionToken) return;
  const input = document.getElementById('rewardCodeInput');
  const feedback = document.getElementById('rewardRedeemFeedback');
  const btn = document.getElementById('rewardRedeemBtn');
  const code = input ? input.value.trim() : '';
  if (!code) {
    if (feedback) { feedback.textContent = 'Enter a reward code.'; feedback.style.color = '#ff6b6b'; }
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/rewards/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.sessionToken,
      },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to redeem reward');
    auth.tokens = data.tokens;
    updateAccountBadge();
    if (window.SFX) window.SFX.reward();
    if (feedback) {
      feedback.textContent = '+' + data.tokensAdded.toLocaleString() + ' tokens added!';
      feedback.style.color = '#06d6a0';
    }
    setTimeout(closeRewardRedeem, 1200);
  } catch (error) {
    if (feedback) {
      feedback.textContent = error.message;
      feedback.style.color = '#ff6b6b';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

const rewardCodeInput = document.getElementById('rewardCodeInput');
if (rewardCodeInput) {
  rewardCodeInput.addEventListener('keypress', event => {
    if (event.key === 'Enter') redeemRewardCode();
  });
}

// ANTE, ROLL_COST, MAX_ROLLS, COLORS defined in game.js (loaded before this file)
