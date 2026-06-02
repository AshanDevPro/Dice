'use strict';

// ══════════════════════════════════════════
//  MULTIPLAYER CLIENT
// ══════════════════════════════════════════

const _wsProto   = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const _wsDefault = _wsProto + '//' + window.location.host;

let mp = {
  ws:         null,
  myId:       null,
  roomCode:   null,
  isHost:     false,
  serverUrl:  _wsDefault,
  myName:     'Player',
  gameState:  null,
  connected:  false,
  connecting: false,
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
    codeEl.value = roomParam.toUpperCase();
    document.getElementById('lobbyJoinRow').style.display = 'block';
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
  } else {
    badge.style.display = 'none';
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
  row.style.display = row.style.display === 'none' ? 'block' : 'none';
});

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
      mp.myId     = msg.playerId;
      mp.roomCode = msg.code;
      mp.isHost   = true;
      showLobbyWaiting(msg.code, true);
      break;

    case 'room_joined':
      mp.myId     = msg.playerId;
      mp.roomCode = msg.code;
      mp.isHost   = false;
      showLobbyWaiting(msg.code, false);
      break;

    case 'player_joined':
      renderLobbyPlayers(msg.players);
      if (mp.isHost) {
        document.getElementById('lobbyStatusMsg').textContent =
          msg.players.length >= 2
            ? msg.players.length + ' players ready — you can start!'
            : 'Waiting for players to join...';
        document.getElementById('lobbyStartBtn').style.display = msg.players.length >= 2 ? '' : 'none';
      } else {
        document.getElementById('lobbyStatusMsg').textContent =
          msg.players.length + ' player' + (msg.players.length > 1 ? 's' : '') + ' in room — waiting for host to start...';
      }
      break;

    case 'game_starting':
      document.getElementById('lobbyStatusMsg').textContent = 'Game starting...';
      document.getElementById('lobbyStartBtn').style.display = 'none';
      break;

    case 'round_start':
      document.getElementById('lobbyScreen').style.display  = 'none';
      document.getElementById('gameScreen').style.display   = 'block';
      document.getElementById('resultsBar').style.display   = 'none';
      document.getElementById('resultsOverlay').style.display = 'none';
      showMsg('Round ' + msg.round + ' started! Ante collected.');
      break;

    case 'snapshot':
      mp.gameState = msg;
      renderOnlineGame(msg);
      break;

    case 'your_turn':
      if (msg.playerId === mp.myId) {
        showMsg('Your turn! Roll the dice.');
        setOnlineButtonsEnabled(true);
        if (window.SFX) window.SFX.yourTurn();
      } else {
        showMsg('Waiting for ' + msg.playerName + ' to play...');
        setOnlineButtonsEnabled(false);
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

    case 'player_left':
      showMsg(msg.playerName + ' disconnected.', 'warn');
      break;

    case 'error':
      showMsg(msg.msg, 'error');
      break;
  }
}

// ── Lobby UI ──────────────────────────────────────────────────────────────────
function showLobbyWaiting(code, isHost) {
  document.getElementById('lobbyConnect').style.display = 'none';
  document.getElementById('lobbyWaiting').style.display = 'block';
  document.getElementById('lobbyRoomCode').textContent  = code;
  document.getElementById('lobbyStartBtn').style.display = 'none';
  document.getElementById('shareFeedback').textContent  = '';
  document.getElementById('lobbyStatusMsg').textContent =
    isHost ? 'You are the host. Waiting for players to join...' : 'Joined! Waiting for host to start...';
}

function shareRoomLink() {
  const code = mp.roomCode;
  if (!code) return;
  const base = window.location.href.split('?')[0];
  const url  = base + '?room=' + code;
  const text = 'Join my PignusDice game! Room code: ' + code;
  const fb   = document.getElementById('shareFeedback');
  if (navigator.share) {
    navigator.share({ title: 'PignusDice', text, url }).catch(() => {});
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
function renderOnlineGame(snap) {
  const me = snap.players.find(p => p.id === mp.myId);
  if (!me) return;

  document.getElementById('potAmount').textContent = snap.pot;
  document.getElementById('roundInfo').textContent = 'Round ' + snap.round;

  const strip = document.getElementById('playersStrip');
  strip.innerHTML = '';
  snap.players.forEach(p => {
    const tab = document.createElement('div');
    tab.className = 'player-tab' +
      (p.id === snap.turnPlayerId ? ' active-turn' : '') +
      (p.folded  ? ' folded'      : '') +
      (p.tokens <= 0 ? ' eliminated' : '');
    tab.innerHTML =
      '<div class="tab-name" style="color:' + p.color + '">' + p.name + (p.id === mp.myId ? ' (You)' : '') + '</div>' +
      '<div class="tab-tokens">💰 ' + p.tokens + '</div>' +
      '<div class="tab-score">' + (p.finalScore > 0 ? '✅ ' + p.finalScore : p.folded ? '❌' : p.rollsUsed > 0 ? '🎲...' : '—') + '</div>' +
      '<div class="turn-arrow">▼</div>';
    strip.appendChild(tab);
  });

  const grid = document.getElementById('opponentsGrid');
  grid.innerHTML = '';
  snap.players.filter(p => p.id !== mp.myId).forEach(p => {
    const card = document.createElement('div');
    card.className = 'opp-card color-' + p.colorIdx + (p.folded ? ' folded' : '') + (p.finalScore > 0 ? ' winner' : '');
    const allDice = [...p.qualifyHand, ...p.scoringHand];
    let diceHTML = '';
    for (let j = 0; j < 6; j++) {
      const v   = allDice[j];
      const isQ = j < p.qualifyHand.length;
      const tmp = document.createElement('div');
      setDieImg(tmp, v || 0, false, isQ && !!v);
      diceHTML += '<div class="small-die" style="background-image:' + tmp.style.backgroundImage + '"></div>';
    }
    card.innerHTML =
      '<div class="opp-card-header">' +
        '<div class="opp-dot" style="background:' + p.color + '"></div>' +
        '<div class="opp-name">' + p.name + '</div>' +
      '</div>' +
      '<div class="opp-score-line">🏆 ' + (p.finalScore || 0) + '</div>' +
      '<div class="opp-dice-row">' + diceHTML + '</div>' +
      '<div class="opp-status ' + (p.finalScore > 0 ? 'qualified' : 'no14') + '">' +
        (p.folded ? '❌ Folded' : p.finalScore > 0 ? '✅ Qualified' : p.rollsUsed > 0 ? '⚠ Playing...' : '⏳ Waiting') +
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
      sRow.insertAdjacentHTML('beforeend', '<span class="zone-hint" style="font-size:0.85rem;margin-left:8px">= ' + me.scoringHand.reduce((a,b) => a+b, 0) + '</span>');
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

  const midOpen     = document.getElementById('midRollBetting').style.display === 'block';
  const handFull    = me.qualifyHand.includes(1) && me.qualifyHand.includes(4) && me.scoringHand.length === 4;
  const scoringFull = me.scoringHand.length === 4;
  // ONE roll per turn — blocked after first roll, also blocked when scoring is full or hand full
  const rollBlocked = !isMyTurn || midOpen || me.rollsUsed >= 1 || me.tokens < ROLL_COST
                    || handFull || !!me.mustLockBeforeRoll || scoringFull;
  // End turn: must roll first (unless scoring/hand full), must lock if rolled but not locked
  const mustRollFirst    = !handFull && !scoringFull && me.rollsUsed === 0;
  const mustLockAfterRoll = me.rollsUsed > 0 && !!me.mustLockBeforeRoll;
  document.getElementById('rollBtn').disabled    = rollBlocked;
  document.getElementById('lockBtn').disabled    = !isMyTurn || midOpen || !(window._onlineSelected && window._onlineSelected.size);
  document.getElementById('endTurnBtn').disabled = !isMyTurn || midOpen || mustRollFirst || mustLockAfterRoll;
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

  let betAmt = Math.max(10, callAmt);
  document.getElementById('betDisplay').textContent = betAmt;

  document.getElementById('betMinus').onclick = () => {
    betAmt = Math.max(10, betAmt - 10);
    document.getElementById('betDisplay').textContent = betAmt;
  };
  document.getElementById('betPlus').onclick = () => {
    betAmt = Math.min(me.tokens, betAmt + 10);
    document.getElementById('betDisplay').textContent = betAmt;
  };

  const pre = document.getElementById('betPresets');
  pre.innerHTML = '';
  [10, 25, 50, 100].forEach(v => {
    if (v > me.tokens) return;
    const b = document.createElement('button');
    b.className = 'preset-btn'; b.textContent = v;
    b.onclick = () => { betAmt = v; document.getElementById('betDisplay').textContent = betAmt; };
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
  document.getElementById('raiseBtn').onclick = () => { if (window.SFX) window.SFX.bet(); sendBet('raise', betAmt); };
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
  if (winners.length) {
    const w = winners[0];
    winEl.innerHTML = '👑 WINNER: ' + w.name + ' 👑<br>Score: ' + w.finalScore;
  } else {
    winEl.textContent = 'No winner this round';
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
  const sorted = [...msg.players].sort((a, b) => b.tokens - a.tokens);
  const title  = document.getElementById('resultsTitle');
  const body   = document.getElementById('resultsBody');
  const btn    = document.getElementById('nextRoundBtn');
  title.textContent = '🎮 GAME OVER';
  body.innerHTML = sorted.map(p =>
    '<div class="score-row ' + (p.tokens === sorted[0].tokens ? 'winner-row' : '') + '">' +
      '<div class="score-name">' + p.name + (p.id === mp.myId ? ' (You)' : '') + '</div>' +
      '<div class="score-val">' + p.tokens + '</div>' +
    '</div>'
  ).join('');
  btn.textContent = '🔄 NEW GAME';
  btn.onclick = () => { disconnectWS(); location.reload(); };
  document.getElementById('resultsOverlay').style.display = 'flex';

  if (window.SFX && sorted[0].id === mp.myId) window.SFX.gameWin();

  // Update saved balance
  const me = msg.players.find(p => p.id === mp.myId);
  if (me && auth.sessionToken) {
    auth.tokens = me.tokens;
    updateAccountBadge();
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

// ANTE, ROLL_COST, MAX_ROLLS, COLORS defined in game.js (loaded before this file)
