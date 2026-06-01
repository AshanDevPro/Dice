/**
 * PigNusDice — WebSocket Game Server
 * Run with: node server.js
 * Requires: npm install ws
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT        = process.env.PORT || 3000;
const ANTE        = 50;
const ROLL_COST   = 10;
const MAX_ROLLS   = 6;
const START_TOKENS = 500;

// ── Static file server ──────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ── User accounts (file-backed) ──────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

let users    = {};   // lowerKey → { username, passwordHash, salt, tokens }
let sessions = {};   // sessionToken → lowerKey (in-memory; resets on restart)

function loadUsers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { users = {}; }
}
function saveUsers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) { console.error('saveUsers:', e.message); }
}
function hashPwd(pwd, salt) {
  return crypto.pbkdf2Sync(pwd, salt, 10000, 32, 'sha256').toString('hex');
}
function makeToken() { return crypto.randomBytes(20).toString('hex'); }

loadUsers();

// ── HTTP server ──────────────────────────────────────────────────────────────
function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 8192) req.destroy(); });
  req.on('end',  () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
}

const httpServer = http.createServer((req, res) => {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // ── POST /api/register ───────────────────────────────────────────────────
  if (req.url === '/api/register' && req.method === 'POST') {
    readBody(req, data => {
      if (!data) return json(400, { error: 'Bad request' });
      const key = data.username?.trim().toLowerCase();
      if (!key || key.length < 2 || key.length > 20 || !data.password)
        return json(400, { error: 'Username (2–20 chars) and password required' });
      if (users[key]) return json(409, { error: 'Username already taken' });
      const salt = crypto.randomBytes(16).toString('hex');
      const user = { username: data.username.trim(), passwordHash: hashPwd(data.password, salt), salt, tokens: START_TOKENS };
      users[key] = user;
      const token = makeToken();
      sessions[token] = key;
      saveUsers();
      json(200, { sessionToken: token, username: user.username, tokens: user.tokens });
    });
    return;
  }

  // ── POST /api/login ──────────────────────────────────────────────────────
  if (req.url === '/api/login' && req.method === 'POST') {
    readBody(req, data => {
      if (!data) return json(400, { error: 'Bad request' });
      const key  = data.username?.trim().toLowerCase();
      const user = key && users[key];
      if (!user || hashPwd(data.password || '', user.salt) !== user.passwordHash)
        return json(401, { error: 'Invalid username or password' });
      const token = makeToken();
      sessions[token] = key;
      json(200, { sessionToken: token, username: user.username, tokens: user.tokens });
    });
    return;
  }

  // ── GET /api/me ──────────────────────────────────────────────────────────
  if (req.url === '/api/me' && req.method === 'GET') {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const key   = token && sessions[token];
    const user  = key && users[key];
    if (!user) return json(401, { error: 'Not authenticated' });
    json(200, { username: user.username, tokens: user.tokens });
    return;
  }

  // ── Static files ─────────────────────────────────────────────────────────
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  const ext    = path.extname(filePath);
  const mime   = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else     { res.writeHead(200, { 'Content-Type': mime }); res.end(data); }
  });
});

// ── Room management ──────────────────────────────────────────────────────────
const rooms = {};

function saveRoomTokens(room) {
  let dirty = false;
  room.clients.forEach(c => {
    if (!c.userKey || !users[c.userKey]) return;
    const p = room.players.find(pl => pl.id === c.id);
    if (p) { users[c.userKey].tokens = Math.max(p.tokens, 0); dirty = true; }
  });
  if (dirty) saveUsers();
}

function makeCode() {
  return Math.random().toString(36).slice(2,6).toUpperCase();
}

function broadcast(room, msg) {
  const str = JSON.stringify(msg);
  room.clients.forEach(c => { if (c.ws.readyState === 1) c.ws.send(str); });
}

function sendTo(client, msg) {
  if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
}

function roomSnapshot(room) {
  return {
    type:       'snapshot',
    players:    room.players.map(p => ({
      id:                 p.id,
      name:               p.name,
      tokens:             p.tokens,
      color:              p.color,
      colorIdx:           p.colorIdx,
      qualifyHand:        p.qualifyHand,
      scoringHand:        p.scoringHand,
      currentDice:        p.currentDice,
      rollsUsed:          p.rollsUsed,
      mustLockBeforeRoll: p.mustLockBeforeRoll,
      finalScore:         p.finalScore,
      folded:             p.folded,
      qualified:          p.qualified,
      roundBet:           p.roundBet,
      roll1Done:          p.roll1Done      || false,
      roll2Done:          p.roll2Done      || false,
      lockedInRoll2:      p.lockedInRoll2  || false,
    })),
    pot:         room.pot,
    round:       room.round,
    turnPlayerId: room.turnPlayerId,
    phase:       room.phase,
    currentBet:  room.currentBet,
    startTokens: room.startTokens,
  };
}

// ── Game logic (server-authoritative) ───────────────────────────────────────
const COLORS = ['#e63e6d','#06d6a0','#f59e1b','#5cc8f5','#b06dff','#ff9a3c'];

function createRoom(code, hostClient, startTokens) {
  return {
    code,
    clients:      [],   // { ws, id }
    players:      [],   // authoritative game state per player
    pot:          0,
    round:        1,
    turnPlayerId: null,
    phase:        'lobby',
    currentBet:   0,
    startTokens:  startTokens || 500,
    bettingQueue: [],
    started:      false,
  };
}

function getPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function nonFolded(room) {
  return room.players.filter(p => !p.folded);
}

function startRound(room) {
  room.pot = 0; room.currentBet = 0; room.phase = 'roll1';
  const active = room.players.filter(p => p.tokens > 0);
  if (active.length < 2) { endGame(room); return; }

  room.players.forEach(p => {
    if (p.tokens <= 0) return;
    p.qualifyHand = []; p.scoringHand = []; p.currentDice = [];
    p.rollsUsed = 0; p.mustLockBeforeRoll = false;
    p.finalScore = 0; p.folded = false; p.qualified = false; p.roundBet = 0;
    p.selectedIdx = [];
    p.roll1Done = false; p.roll2Done = false; p.lockedInRoll2 = false;
    // Collect ante
    const ante = Math.min(ANTE, p.tokens);
    p.tokens  -= ante; p.roundBet += ante; room.pot += ante;
  });

  const turnIdx = 0;
  room.turnPlayerId = active[turnIdx].id;
  broadcast(room, { type:'round_start', round: room.round });
  broadcast(room, roomSnapshot(room));
  broadcastTurnNotice(room);
}

function broadcastTurnNotice(room) {
  const p = getPlayer(room, room.turnPlayerId);
  if (!p) return;
  broadcast(room, { type:'your_turn', playerId: room.turnPlayerId, playerName: p.name });
}

function startRoll2(room) {
  room.phase = 'roll2';
  const active = room.players.filter(p => p.tokens > 0 && !p.folded);
  active.forEach(p => {
    p.roll2Done         = false;
    p.lockedInRoll2     = false;
    p.currentDice       = [];
    p.rollsUsed         = 0;
    p.mustLockBeforeRoll = false;
  });
  room.turnPlayerId = active[0].id;
  broadcast(room, roomSnapshot(room));
  broadcast(room, { type: 'phase_change', phase: 'roll2' });
  broadcastTurnNotice(room);
  // First player of roll2 gets no pre-turn bet prompt — they're the opener
}

function advanceTurnInPhase(room) {
  const active = room.players.filter(p => p.tokens > 0 && !p.folded);

  if (room.phase === 'roll1') {
    if (active.every(p => p.roll1Done)) { startRoll2(room); return; }
    const curIdx = active.findIndex(p => p.id === room.turnPlayerId);
    let next = null;
    for (let i = 1; i <= active.length; i++) {
      const c = active[(curIdx + i) % active.length];
      if (!c.roll1Done) { next = c; break; }
    }
    if (!next) { startRoll2(room); return; }
    room.turnPlayerId = next.id;
    room.bettingQueue = [next.id];
    broadcast(room, roomSnapshot(room));
    serveBettingQueue(room);

  } else if (room.phase === 'roll2') {
    if (active.every(p => p.roll2Done)) { resolveRound(room); return; }
    const curIdx = active.findIndex(p => p.id === room.turnPlayerId);
    let next = null;
    for (let i = 1; i <= active.length; i++) {
      const c = active[(curIdx + i) % active.length];
      if (!c.roll2Done) { next = c; break; }
    }
    if (!next) { resolveRound(room); return; }
    room.turnPlayerId = next.id;
    room.bettingQueue = [next.id];
    broadcast(room, roomSnapshot(room));
    serveBettingQueue(room);
  }
}

function rollDice(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || room.turnPlayerId !== playerId) return { error: 'Not your turn' };
  if (p.rollsUsed >= MAX_ROLLS) return { error: 'Max rolls reached' };
  if (p.tokens < ROLL_COST)     return { error: 'Not enough tokens' };
  if (p.rollsUsed > 0 && p.mustLockBeforeRoll) return { error: 'Lock a die first' };

  const qualSlots  = (p.qualifyHand.includes(1)?0:1)+(p.qualifyHand.includes(4)?0:1);
  const scoreSlots = 4 - p.scoringHand.length;
  const total      = qualSlots + scoreSlots;
  if (!total) return { error: 'Hand full' };

  p.tokens  -= ROLL_COST; room.pot += ROLL_COST;
  p.rollsUsed++;
  p.currentDice        = Array.from({length:total}, () => Math.floor(Math.random()*6)+1);
  p.selectedIdx        = [];
  p.mustLockBeforeRoll = true;

  broadcast(room, roomSnapshot(room));
  return { ok: true };
}

function lockDice(room, playerId, selectedIdx) {
  const p = getPlayer(room, playerId);
  if (!p || room.turnPlayerId !== playerId) return { error: 'Not your turn' };
  if (!selectedIdx || !selectedIdx.length) return { error: 'Select at least one die' };

  const vals = selectedIdx.map(i => p.currentDice[i]).filter(v => v !== undefined);
  let m1 = !p.qualifyHand.includes(1);
  let m4 = !p.qualifyHand.includes(4);

  for (const v of vals) {
    const qf = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
    if (!qf && v===1 && m1)          { p.qualifyHand.push(1); m1=false; }
    else if (!qf && v===4 && m4)     { p.qualifyHand.push(4); m4=false; }
    else if (p.scoringHand.length<4) { p.scoringHand.push(v); }
    else if (!qf) {
      // Scoring hand full and wrong value for qualifier — force into the open
      // qualifier slot so the hand fills and infinite rerolling is prevented.
      if (m1)      { p.qualifyHand.push(v); m1=false; }
      else if (m4) { p.qualifyHand.push(v); m4=false; }
    }
  }

  for (let i=selectedIdx.length-1; i>=0; i--) p.currentDice.splice(selectedIdx[i],1);
  p.selectedIdx        = [];
  p.mustLockBeforeRoll = false;
  if (room.phase === 'roll2') p.lockedInRoll2 = true;

  broadcast(room, roomSnapshot(room));
  return { ok: true };
}

function endTurn(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || room.turnPlayerId !== playerId) return { error: 'Not your turn' };

  // Determine if hand is already full (both qualifiers + 4 scoring dice)
  const qualSlots  = (p.qualifyHand.includes(1)?0:1)+(p.qualifyHand.includes(4)?0:1);
  const scoreSlots = 4 - p.scoringHand.length;
  const handFull   = qualSlots + scoreSlots === 0;

  if (!handFull && p.rollsUsed === 0) return { error: 'Must roll at least once' };
  if (room.phase === 'roll2' && !handFull && !p.lockedInRoll2) return { error: 'Must lock at least one die this phase' };

  // Auto-bet 10 tokens when ending turn (sets minimum stake for next player to call)
  const bet = Math.min(10, p.tokens);
  if (bet > 0) {
    p.tokens -= bet; p.roundBet += bet; room.pot += bet;
    room.currentBet = Math.max(room.currentBet, p.roundBet);
  }

  p.qualified  = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
  p.finalScore = p.qualified ? p.scoringHand.reduce((a,b)=>a+b,0) : 0;
  p.currentDice = [];

  if (room.phase === 'roll1') p.roll1Done = true;
  else if (room.phase === 'roll2') p.roll2Done = true;

  broadcast(room, roomSnapshot(room));
  advanceTurnInPhase(room);
  return { ok: true };
}

function placeBet(room, playerId, action, amount) {
  const p = getPlayer(room, playerId);
  if (!p) return;
  const callAmt = Math.max(0, room.currentBet - p.roundBet);
  if (action === 'fold') {
    p.folded = true;
  } else if (action === 'call') {
    const c = Math.min(callAmt, p.tokens);
    p.tokens -= c; p.roundBet += c; room.pot += c;
  } else if (action === 'raise') {
    const pay = Math.min(amount, p.tokens);
    p.tokens -= pay; p.roundBet += pay; room.pot += pay;
    room.currentBet = Math.max(room.currentBet, p.roundBet);
  }
  // check/skip: do nothing
  broadcast(room, roomSnapshot(room));
  serveBettingQueue(room);
}

function serveBettingQueue(room) {
  if (!room.bettingQueue.length) {
    broadcast(room, { type:'betting_done' });
    broadcastTurnNotice(room);
    return;
  }
  const pid = room.bettingQueue.shift();
  const p   = room.players.find(pl => pl.id === pid);
  if (!p || p.folded || p.tokens <= 0) { serveBettingQueue(room); return; }
  broadcast(room, { type:'bet_action_needed', playerId: pid, currentBet: room.currentBet, pot: room.pot });
}

function resolveRound(room) {
  room.players.forEach(p => {
    if (!p.folded) {
      p.qualified  = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
      p.finalScore = p.qualified ? p.scoringHand.reduce((a,b)=>a+b,0) : 0;
    }
  });

  const eligible = room.players
    .filter(p => !p.folded && p.qualified)
    .sort((a,b) => b.finalScore - a.finalScore);

  let winners = [];
  if (eligible.length) {
    const best = eligible[0].finalScore;
    winners    = eligible.filter(p => p.finalScore === best);
    const share = Math.floor(room.pot / winners.length);
    winners.forEach(p => { p.tokens += share; });
  }

  broadcast(room, {
    type:    'round_over',
    winners: winners.map(p => p.id),
    players: room.players.map(p => ({ id:p.id, name:p.name, finalScore:p.finalScore, qualified:p.qualified, folded:p.folded, tokens:p.tokens })),
    pot:     room.pot,
  });

  room.pot = 0;
  room.round++;
  saveRoomTokens(room);
  setTimeout(() => startRound(room), 5000);
}

function endGame(room) {
  saveRoomTokens(room);
  broadcast(room, { type:'game_over', players: room.players.map(p=>({id:p.id,name:p.name,tokens:p.tokens})) });
}

// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  const client = { ws, id: makeCode(), roomCode: null, userKey: null };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        const uKey     = msg.sessionToken && sessions[msg.sessionToken];
        const acct     = uKey && users[uKey];
        const name     = acct ? acct.username : (msg.name || 'Player');
        const startTok = acct ? Math.max(acct.tokens, 100) : (msg.startTokens || START_TOKENS);

        const code = makeCode();
        const room = createRoom(code, client, startTok);
        rooms[code]     = room;
        client.roomCode = code;
        client.name     = name;
        client.userKey  = uKey || null;
        room.clients.push(client);
        const colorIdx = 0;
        room.players.push({
          id: client.id, name,
          tokens: startTok, color: COLORS[colorIdx], colorIdx,
          qualifyHand:[], scoringHand:[], currentDice:[], selectedIdx:[],
          rollsUsed:0, mustLockBeforeRoll:false,
          finalScore:0, folded:false, qualified:false, roundBet:0,
        });
        sendTo(client, { type:'room_created', code, playerId: client.id });
        broadcast(room, { type:'player_joined', players: room.players.map(p=>({id:p.id,name:p.name,color:p.color})) });
        break;
      }

      case 'join_room': {
        const room = rooms[msg.code];
        if (!room)                    { sendTo(client, { type:'error', msg:'Room not found' }); break; }
        if (room.started)             { sendTo(client, { type:'error', msg:'Game already started' }); break; }
        if (room.players.length >= 6) { sendTo(client, { type:'error', msg:'Room full' }); break; }

        const uKey     = msg.sessionToken && sessions[msg.sessionToken];
        const acct     = uKey && users[uKey];
        const name     = acct ? acct.username : (msg.name || `Player ${room.players.length+1}`);
        const startTok = acct ? Math.max(acct.tokens, 100) : room.startTokens;

        client.roomCode = room.code;
        client.name     = name;
        client.userKey  = uKey || null;
        room.clients.push(client);
        const colorIdx = room.players.length % COLORS.length;
        room.players.push({
          id: client.id, name,
          tokens: startTok, color: COLORS[colorIdx], colorIdx,
          qualifyHand:[], scoringHand:[], currentDice:[], selectedIdx:[],
          rollsUsed:0, mustLockBeforeRoll:false,
          finalScore:0, folded:false, qualified:false, roundBet:0,
        });
        sendTo(client, { type:'room_joined', code: room.code, playerId: client.id });
        broadcast(room, { type:'player_joined', players: room.players.map(p=>({id:p.id,name:p.name,color:p.color})) });
        break;
      }

      case 'start_game': {
        const room = rooms[client.roomCode];
        if (!room || room.players[0].id !== client.id) break; // only host
        if (room.players.length < 2) { sendTo(client, { type:'error', msg:'Need at least 2 players' }); break; }
        room.started = true;
        broadcast(room, { type:'game_starting' });
        setTimeout(() => startRound(room), 1000);
        break;
      }

      case 'roll': {
        const room = rooms[client.roomCode];
        if (!room) break;
        const result = rollDice(room, client.id);
        if (result.error) sendTo(client, { type:'error', msg: result.error });
        break;
      }

      case 'lock': {
        const room = rooms[client.roomCode];
        if (!room) break;
        const result = lockDice(room, client.id, msg.selectedIdx || []);
        if (result.error) sendTo(client, { type:'error', msg: result.error });
        break;
      }

      case 'end_turn': {
        const room = rooms[client.roomCode];
        if (!room) break;
        const result = endTurn(room, client.id);
        if (result.error) sendTo(client, { type:'error', msg: result.error });
        break;
      }

      case 'bet': {
        const room = rooms[client.roomCode];
        if (!room) break;
        placeBet(room, client.id, msg.action, msg.amount || 0);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms[client.roomCode];
    if (!room) return;
    room.clients = room.clients.filter(c => c !== client);
    const p = getPlayer(room, client.id);
    if (p) p.folded = true;
    broadcast(room, { type:'player_left', playerId: client.id, playerName: client.name });
    if (room.clients.length === 0) { delete rooms[client.roomCode]; }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n🎲 PigNusDice server running on http://localhost:${PORT}`);
  console.log(`   Share your IP or domain so players can connect.\n`);
});
