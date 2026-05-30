'use strict';

// ══════════════════════════════════════════
//  MULTIPLAYER CLIENT
//  Handles WebSocket connection, lobby, and
//  online game rendering (server-authoritative)
// ══════════════════════════════════════════

let mp = {
  ws:           null,
  myId:         null,
  roomCode:     null,
  isHost:       false,
  serverUrl:    'ws://pignusdice.com',
  myName:       'Player',
  gameState:    null,
  connected:    false,
  connecting:   false,   // guard against rapid clicks
};

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

// Lobby is the only entry point — no mode select needed

// ── Create / Join buttons ────────────────────────────────────────────────────
document.getElementById('lobbyJoinBtn').addEventListener('click', () => {
  const row = document.getElementById('lobbyJoinRow');
  row.style.display = row.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('lobbyCreateBtn').addEventListener('click', () => {
  if (mp.connecting) return;
  mp.myName    = document.getElementById('lobbyName').value.trim() || 'Player';
  mp.serverUrl = document.getElementById('lobbyServer').value.trim() || 'ws://pignusdice.com';
  connectWS(() => {
    mp.ws.send(JSON.stringify({ type: 'create_room', name: mp.myName, startTokens: 500 }));
  });
});

document.getElementById('lobbyJoinConfirmBtn').addEventListener('click', () => {
  if (mp.connecting) return;
  mp.myName    = document.getElementById('lobbyName').value.trim() || 'Player';
  mp.serverUrl = document.getElementById('lobbyServer').value.trim() || 'ws://pignusdice.com';
  const code   = document.getElementById('lobbyCode').value.trim().toUpperCase();
  if (!code) { lobbyError('Enter a room code'); return; }
  connectWS(() => {
    mp.ws.send(JSON.stringify({ type: 'join_room', code, name: mp.myName }));
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

// ── WebSocket connection ─────────────────────────────────────────────────────
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

  // Kill any existing socket cleanly without triggering its onclose
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
    if (mp.ws !== socket) return; // superseded
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

// ── Server message handler ───────────────────────────────────────────────────
function handleServerMsg(msg) {
  switch (msg.type) {

    case 'room_created':
      mp.myId    = msg.playerId;
      mp.roomCode = msg.code;
      mp.isHost  = true;
      showLobbyWaiting(msg.code, true);
      break;

    case 'room_joined':
      mp.myId    = msg.playerId;
      mp.roomCode = msg.code;
      mp.isHost  = false;
      showLobbyWaiting(msg.code, false);
      break;

    case 'player_joined':
      renderLobbyPlayers(msg.players);
      if (mp.isHost) {
        document.getElementById('lobbyStatusMsg').textContent =
          msg.players.length >= 2
            ? `${msg.players.length} players ready — you can start!`
            : 'Waiting for players to join...';
        document.getElementById('lobbyStartBtn').style.display = msg.players.length >= 2 ? '' : 'none';
      } else {
        document.getElementById('lobbyStatusMsg').textContent =
          `${msg.players.length} player${msg.players.length>1?'s':''} in room — waiting for host to start...`;
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
      showMsg(`Round ${msg.round} started! Ante collected.`);
      break;

    case 'snapshot':
      mp.gameState = msg;
      renderOnlineGame(msg);
      break;

    case 'your_turn':
      if (msg.playerId === mp.myId) {
        showMsg(`Your turn! Roll the dice.`);
        setOnlineButtonsEnabled(true);
      } else {
        showMsg(`Waiting for ${msg.playerName} to play...`);
        setOnlineButtonsEnabled(false);
      }
      break;

    case 'bet_action_needed':
      if (msg.playerId === mp.myId) {
        showOnlineBetting(msg.currentBet);
      }
      break;

    case 'betting_done':
      document.getElementById('bettingPanel').style.display = 'none';
      document.getElementById('activeBoard').style.display  = 'block';
      break;

    case 'phase_change':
      if (msg.phase === 'roll2') {
        showMsg('⚔️ PHASE 2 — Second Roll! You must lock at least 1 die before ending your turn.');
      }
      break;

    case 'round_over':
      renderOnlineResults(msg);
      break;

    case 'game_over':
      renderOnlineGameOver(msg);
      break;

    case 'player_left':
      showMsg(`${msg.playerName} disconnected.`, 'warn');
      break;

    case 'error':
      showMsg(msg.msg, 'error');
      break;
  }
}

// ── Lobby UI ─────────────────────────────────────────────────────────────────
function showLobbyWaiting(code, isHost) {
  document.getElementById('lobbyConnect').style.display = 'none';
  document.getElementById('lobbyWaiting').style.display = 'block';
  document.getElementById('lobbyRoomCode').textContent  = code;
  document.getElementById('lobbyStartBtn').style.display = 'none';
  document.getElementById('lobbyStatusMsg').textContent =
    isHost ? 'You are the host. Waiting for players to join...' : 'Joined! Waiting for host to start...';
}

function renderLobbyPlayers(players) {
  const COLORS = ['#e63e6d','#06d6a0','#f59e1b','#5cc8f5','#b06dff','#ff9a3c'];
  const list = document.getElementById('lobbyPlayerList');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'lobby-player-entry';
    el.innerHTML = `
      <span class="online-indicator"></span>
      <span class="lobby-player-dot" style="background:${COLORS[i%COLORS.length]}"></span>
      <span class="lobby-player-name">${p.name}</span>
      <span class="lobby-player-tag">${p.id === mp.myId ? '(You)' : ''}</span>
    `;
    list.appendChild(el);
  });
}

// ── Online game render ────────────────────────────────────────────────────────
function renderOnlineGame(snap) {
  const me = snap.players.find(p => p.id === mp.myId);
  if (!me) return;

  // Update pot display
  document.getElementById('potAmount').textContent = snap.pot;
  document.getElementById('roundInfo').textContent = `Round ${snap.round}`;

  // Render players strip
  const strip = document.getElementById('playersStrip');
  strip.innerHTML = '';
  snap.players.forEach(p => {
    const tab = document.createElement('div');
    tab.className = 'player-tab' +
      (p.id === snap.turnPlayerId ? ' active-turn' : '') +
      (p.folded  ? ' folded'      : '') +
      (p.tokens <= 0 ? ' eliminated' : '');
    tab.innerHTML = `
      <div class="tab-name" style="color:${p.color}">${p.name}${p.id===mp.myId?' (You)':''}</div>
      <div class="tab-tokens">💰 ${p.tokens}</div>
      <div class="tab-score">${p.finalScore>0?'✅ '+p.finalScore:p.folded?'❌':p.rollsUsed>0?'🎲...':'—'}</div>
      <div class="turn-arrow">▼</div>`;
    strip.appendChild(tab);
  });

  // Render opponent cards
  const grid = document.getElementById('opponentsGrid');
  grid.innerHTML = '';
  snap.players.filter(p => p.id !== mp.myId).forEach(p => {
    const card = document.createElement('div');
    card.className = `opp-card color-${p.colorIdx}${p.folded?' folded':''}${p.finalScore>0?' winner':''}`;
    const allDice = [...p.qualifyHand, ...p.scoringHand];
    let diceHTML = '';
    for (let j = 0; j < 6; j++) {
      const v = allDice[j];
      const isQ = j < p.qualifyHand.length;
      const tmp = document.createElement('div');
      setDieImg(tmp, v||0, false, isQ && !!v);
      diceHTML += `<div class="small-die" style="background-image:${tmp.style.backgroundImage}"></div>`;
    }
    card.innerHTML = `
      <div class="opp-card-header">
        <div class="opp-dot" style="background:${p.color}"></div>
        <div class="opp-name">${p.name}</div>
      </div>
      <div class="opp-score-line">🏆 ${p.finalScore||0}</div>
      <div class="opp-dice-row">${diceHTML}</div>
      <div class="opp-status ${p.finalScore>0?'qualified':'no14'}">${p.folded?'❌ Folded':p.finalScore>0?'✅ Qualified':p.rollsUsed>0?'⚠ Playing...':'⏳ Waiting'}</div>`;
    grid.appendChild(card);
  });

  // Render active board (my board)
  renderOnlineMyBoard(me, snap);
}

function renderOnlineMyBoard(me, snap) {
  const isMyTurn = snap.turnPlayerId === mp.myId;
  document.getElementById('activeName').textContent      = `${me.name.toUpperCase()} (YOU)`;
  document.getElementById('activeTokensVal').textContent = me.tokens;
  document.getElementById('anteRollTag').textContent     = `ANTE: ${ANTE} | ROLL COST: ${ROLL_COST}`;
  document.getElementById('rollCounter').textContent     = `rolls: ${me.rollsUsed}/${MAX_ROLLS}`;
  document.getElementById('rollSavePill').textContent    = me.rollsUsed===0 ? '(perfect save!)' : '';
  document.getElementById('rollCostPill').textContent    = `Cost ${ROLL_COST}`;
  const isRoll2 = snap.phase === 'roll2';
  document.getElementById('lockHint').style.display = me.mustLockBeforeRoll ? '' : 'none';
  document.getElementById('rollZoneLabel').innerHTML = isRoll2
    ? `<span class="zone-icon">🎲</span> PHASE 2 — SECOND ROLL (lock ≥1 die to end turn) | rolls: ${me.rollsUsed}/${MAX_ROLLS} | Cost: ${ROLL_COST}`
    : `<span class="zone-icon">🎲</span> CURRENT ROLL (rolls: ${me.rollsUsed}/${MAX_ROLLS}) | Cost: ${ROLL_COST}`;

  // Qualify row
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

  // Scoring row
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
      sRow.insertAdjacentHTML('beforeend',`<span class="zone-hint" style="font-size:0.85rem;margin-left:8px">= ${me.scoringHand.reduce((a,b)=>a+b,0)}</span>`);
  }

  // Roll row — server has assigned currentDice; we render them with selection state
  const rRow = document.getElementById('rollRow');
  rRow.innerHTML = '';
  if (!me.currentDice || !me.currentDice.length) {
    rRow.innerHTML = `<span class="zone-hint">⚡ ${me.rollsUsed===0?'Press ROLL (cost '+ROLL_COST+')':'Press ROLL DICE for next roll'}</span>`;
    document.getElementById('lockHintLine').style.display = 'none';
  } else {
    // Track local selection separate from server state
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
      d.addEventListener('touchend', toggle, {passive:false});
      rRow.appendChild(d);
    });
    document.getElementById('lockHintLine').style.display = 'block';
  }

  const midOpen  = document.getElementById('midRollBetting').style.display !== 'none';
  const handFull = me.qualifyHand.includes(1) && me.qualifyHand.includes(4) && me.scoringHand.length===4;
  // In roll2, player must lock ≥1 die before ending turn (unless hand was already full from roll1)
  const canEndRoll2 = !isRoll2 || handFull || me.lockedInRoll2;
  document.getElementById('rollBtn').disabled    = !isMyTurn || midOpen || me.rollsUsed>=MAX_ROLLS || me.tokens<ROLL_COST || handFull || !!me.mustLockBeforeRoll;
  document.getElementById('lockBtn').disabled    = !isMyTurn || midOpen || !(window._onlineSelected && window._onlineSelected.size);
  document.getElementById('endTurnBtn').disabled = !isMyTurn || midOpen || (!handFull && me.rollsUsed===0) || !canEndRoll2;
  // Reset selection when a new snapshot arrives and dice changed
  if (!me.currentDice || me.currentDice.length === 0) window._onlineSelected = new Set();
}

function setOnlineButtonsEnabled(enabled) {
  document.getElementById('rollBtn').disabled    = !enabled;
  document.getElementById('lockBtn').disabled    = true; // needs selection
  document.getElementById('endTurnBtn').disabled = !enabled;
}

// ── Online betting ────────────────────────────────────────────────────────────
function showOnlineBetting(currentBet) {
  const me = mp.gameState ? mp.gameState.players.find(p => p.id === mp.myId) : null;
  if (!me) return;
  const callAmt = Math.max(0, currentBet - (me.roundBet||0));

  document.getElementById('bettingPanel').style.display = 'block';
  document.getElementById('activeBoard').style.display  = 'none';
  document.getElementById('bettingPlayerName').textContent = 'Your Bet';

  let betAmt = Math.max(10, callAmt);
  document.getElementById('betDisplay').textContent = betAmt;

  document.getElementById('betMinus').onclick = () => {
    betAmt = Math.max(10, betAmt-10);
    document.getElementById('betDisplay').textContent = betAmt;
  };
  document.getElementById('betPlus').onclick = () => {
    betAmt = Math.min(me.tokens, betAmt+10);
    document.getElementById('betDisplay').textContent = betAmt;
  };

  const pre = document.getElementById('betPresets');
  pre.innerHTML = '';
  [10,25,50,100].forEach(v => {
    if (v > me.tokens) return;
    const b = document.createElement('button');
    b.className='preset-btn'; b.textContent=v;
    b.onclick=()=>{ betAmt=v; document.getElementById('betDisplay').textContent=betAmt; };
    pre.appendChild(b);
  });

  document.getElementById('callBtn').textContent = callAmt > 0 ? `CALL (−${callAmt})` : 'CALL';
  document.getElementById('checkBtn').onclick = () => {
    if (callAmt>0){showMsg('Cannot check — must call or fold!','error');return;}
    sendBet('check',0);
  };
  document.getElementById('callBtn').onclick  = () => sendBet('call',  callAmt);
  document.getElementById('raiseBtn').onclick = () => sendBet('raise', betAmt);
  document.getElementById('foldBtn').onclick  = () => sendBet('fold',  0);
}

function sendBet(action, amount) {
  if (mp.ws) mp.ws.send(JSON.stringify({ type:'bet', action, amount }));
}

// ── Online results ────────────────────────────────────────────────────────────
function renderOnlineResults(msg) {
  const bar    = document.getElementById('resultsBar');
  const scores = document.getElementById('resultsBarScores');
  const winEl  = document.getElementById('resultsBarWinner');
  scores.innerHTML = '';
  msg.players.forEach(p => {
    const pill = document.createElement('div');
    pill.className = 'results-pill';
    const score = p.folded ? '—' : !p.qualified ? '—' : p.finalScore;
    pill.innerHTML = `<span style="color:${p.color||'#fff'}">●</span> ${p.name}${p.id===mp.myId?' (You)':''}: ${score}`;
    scores.appendChild(pill);
  });
  const winners = msg.players.filter(p => msg.winners.includes(p.id));
  if (winners.length) {
    const w = winners[0];
    winEl.innerHTML = `👑 WINNER: ${w.name} 👑<br>Score: ${w.finalScore}`;
  } else {
    winEl.textContent = 'No winner this round';
  }
  bar.style.display = 'block';
  showMsg('Round over! Next round starting in 5 seconds...');
}

function renderOnlineGameOver(msg) {
  const sorted = [...msg.players].sort((a,b) => b.tokens - a.tokens);
  const title  = document.getElementById('resultsTitle');
  const body   = document.getElementById('resultsBody');
  const btn    = document.getElementById('nextRoundBtn');
  title.textContent = '🎮 GAME OVER';
  body.innerHTML = sorted.map(p => `
    <div class="score-row ${p.tokens===sorted[0].tokens?'winner-row':''}">
      <div class="score-name">${p.name}${p.id===mp.myId?' (You)':''}</div>
      <div class="score-val">${p.tokens}</div>
    </div>`).join('');
  btn.textContent = '🔄 NEW GAME';
  btn.onclick = () => { disconnectWS(); location.reload(); };
  document.getElementById('resultsOverlay').style.display = 'flex';
}

// ── Wire online roll/lock/end to server ──────────────────────────────────────
// Override local handlers when in online mode
function isOnlineMode() { return mp.ws && mp.connected; }

// Wrap the existing button handlers to route to server when online
const _origRollBtn  = document.getElementById('rollBtn');
const _origLockBtn  = document.getElementById('lockBtn');
const _origEndBtn   = document.getElementById('endTurnBtn');

_origRollBtn.addEventListener('click', () => {
  if (!isOnlineMode()) return; // local handler in game.js takes over
  mp.ws.send(JSON.stringify({ type: 'roll' }));
});

_origLockBtn.addEventListener('click', () => {
  if (!isOnlineMode()) return;
  const sel = window._onlineSelected ? [...window._onlineSelected] : [];
  if (!sel.length) { showMsg('Select at least one die!', 'error'); return; }
  mp.ws.send(JSON.stringify({ type: 'lock', selectedIdx: sel }));
  window._onlineSelected = new Set();
});

_origEndBtn.addEventListener('click', () => {
  if (!isOnlineMode()) return;
  mp.ws.send(JSON.stringify({ type: 'end_turn' }));
});

// ANTE, ROLL_COST, MAX_ROLLS, COLORS defined in game.js (loaded first)
