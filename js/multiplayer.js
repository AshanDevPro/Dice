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
  tokens:       null,
  isGuest:      false,
};

// ── Sound toggle ──────────────────────────────────────────────────────────────
function toggleSoundBtn() {
  const muted = window.SFX && window.SFX.toggleMute();
  document.getElementById('soundToggleBtn').textContent = muted ? '🔇' : '🔊';
}
// Reflect stored mute state on load
(function () {
  if (window.SFX && window.SFX.isMuted())
    document.getElementById('soundToggleBtn').textContent = '🔇';
})();

// ── Auth screen logic ─────────────────────────────────────────────────────────
function authShowError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function authShowLobby() {
  document.getElementById('authScreen').style.display  = 'none';
  document.getElementById('lobbyScreen').style.display = '';
  // Pre-fill name input
  const nameEl = document.getElementById('lobbyName');
  if (auth.username) {
    nameEl.value    = auth.username;
    nameEl.readOnly = true;
    nameEl.style.opacity = '0.6';
  } else {
    nameEl.readOnly = false;
    nameEl.style.opacity = '';
  }
  // Show account badge
  updateAccountBadge();
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
  if (!badge) return;
  if (auth.username) {
    if (text) text.textContent = '👤 ' + auth.username + ' — 💰 ' + (auth.tokens !== null ? auth.tokens : '—') + ' tokens';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.flexWrap = 'wrap';
    badge.style.gap = '8px';
  } else {
    badge.style.display = 'none';
  }
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

function authLogout() {
  auth.sessionToken = null;
  auth.username     = null;
  auth.tokens       = null;
  auth.isGuest      = false;
  localStorage.removeItem('pignusDiceSession');
  disconnectWS();
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('authScreen').style.display  = '';
  // Reset auth form fields
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
}

// Check saved session on load
async function authInit() {
  if (auth.sessionToken) {
    try {
      const res  = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + auth.sessionToken } });
      if (res.ok) {
        const data      = await res.json();
        auth.username   = data.username;
        auth.tokens     = data.tokens;
        auth.isGuest    = false;
        mp.myName       = data.username;
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
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) { authShowError('Enter username and password'); return; }
  try {
    const res  = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { authShowError(data.error || 'Login failed'); return; }
    auth.sessionToken = data.sessionToken;
    auth.username     = data.username;
    auth.tokens       = data.tokens;
    auth.isGuest      = false;
    mp.myName         = data.username;
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
  const password = document.getElementById('regPassword').value;
  if (!username || !password) { authShowError('Enter a username and password'); return; }
  try {
    const res  = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { authShowError(data.error || 'Registration failed'); return; }
    auth.sessionToken = data.sessionToken;
    auth.username     = data.username;
    auth.tokens       = data.tokens;
    auth.isGuest      = false;
    mp.myName         = data.username;
    localStorage.setItem('pignusDiceSession', data.sessionToken);
    authShowLobby();
  } catch { authShowError('Cannot connect to server'); }
});
document.getElementById('regPassword').addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('registerBtn').click();
});

// Guest
document.getElementById('guestBtn').addEventListener('click', () => {
  auth.isGuest      = true;
  auth.username     = null;
  auth.tokens       = null;
  auth.sessionToken = null;
  authShowLobby();
});

// ── Screen helpers ────────────────────────────────────────────────────────────
function showScreen(id) {
  ['lobbyScreen','gameScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
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
        mp.serverUrl = document.getElementById('lobbyServer').value.trim() || _wsDefault;
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
  mp.serverUrl = document.getElementById('lobbyServer').value.trim() || _wsDefault;
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
  mp.serverUrl = document.getElementById('lobbyServer').value.trim() || _wsDefault;
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
  mp.serverUrl = document.getElementById('lobbyServer').value.trim() || _wsDefault;
  connectWS(() => {
    mp.ws.send(JSON.stringify({
      type: 'create_room', name: mp.myName,
      startTokens: 500, sessionToken: auth.sessionToken || null,
      vsComputer: true,
    }));
  });
});

document.getElementById('lobbyBackBtn').addEventListener('click', () => {
  disconnectWS();
  document.getElementById('lobbyConnect').style.display = 'block';
  document.getElementById('lobbyWaiting').style.display = 'none';
  lobbyError('');
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

function disconnectWS() {
  if (mp.ws) {
    mp.ws.onclose = null;
    mp.ws.onerror = null;
    mp.ws.close();
    mp.ws = null;
  }
  mp.connected  = false;
  mp.connecting = false;
  mp.myId       = null;
  mp.roomCode   = null;
  setLobbyButtons(false);
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
      document.getElementById('lobbyScreen').style.display  = 'none';
      document.getElementById('gameScreen').style.display   = 'block';
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
      document.getElementById('activeBoard').style.display  = 'block';
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

function renderLobbyPlayers(players) {
  const COLORS = ['#e63e6d','#06d6a0','#f59e1b','#5cc8f5','#b06dff','#ff9a3c'];
  const list = document.getElementById('lobbyPlayerList');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lobby-player-entry';
    el.innerHTML =
      '<span class="online-indicator"></span>' +
      '<span class="lobby-player-dot" style="background:' + COLORS[i % COLORS.length] + '"></span>' +
      '<span class="lobby-player-name">' + p.name + '</span>' +
      '<span class="lobby-player-tag">' + (p.id === mp.myId ? '(You)' : '') + '</span>';
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

  btn.textContent = '🔄 NEW GAME';
  btn.onclick = () => { disconnectWS(); location.reload(); };
  document.getElementById('resultsOverlay').style.display = 'flex';
  releaseWakeLock();

  if (window.SFX) {
    if (!msg.isSinglePlayer && sorted[0].id === mp.myId) window.SFX.gameWin();
    else if (msg.isSinglePlayer) window.SFX.gameWin(); // always celebrate practice
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
function tokenPackBuy(tokens, price) {
  if (!auth.sessionToken) {
    alert('Please sign in to purchase token packs.');
    closeTokenPacks();
    return;
  }
  alert('🚧 Payment coming soon!\n\nThis will add ' + tokens.toLocaleString() + ' tokens to your account for ' + price + '.');
}

// Hide the guest-facing Buy Tokens button for logged-in users (already in badge)
(function () {
  const guestBtn = document.getElementById('guestBuyBtn');
  if (guestBtn && auth.username) guestBtn.style.display = 'none';
})();

// ANTE, ROLL_COST, MAX_ROLLS, COLORS defined in game.js (loaded before this file)
