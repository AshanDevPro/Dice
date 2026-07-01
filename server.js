/**
 * PigNusDice — WebSocket Game Server
 * Run with: node server.js
 * Requires: npm install ws
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { WebSocketServer } = require('ws');
const { LocalDatabase } = require('./lib/database');

const PORT        = process.env.PORT || 3000;
const ANTE        = 50;
const ROLL_COST   = 10;
const MAX_ROLLS   = 6;
const START_TOKENS = 500;
const DAILY_BONUS  = 200;

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

// ── Self-hosted database and authentication ──────────────────────────────────
const database = new LocalDatabase(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'));
const users = database.data.users;
const authAttempts = new Map();

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function authenticatedUser(req) {
  return database.getSession(bearerToken(req));
}

function websocketUser(token) {
  return database.getSession(token, false);
}

function isRateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  recent.push(now);
  authAttempts.set(key, recent);
  return recent.length > 20;
}

function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!username && !email && !password) return;
  if (!username || !email || !password) {
    console.warn('Admin not created: set ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD together.');
    return;
  }
  let found = database.findUserByIdentifier(username) || database.findUserByIdentifier(email);
  if (!found) {
    const created = database.createUser({ username, email, password, role: 'admin' });
    if (created.error) console.warn(`Admin not created: ${created.error}`);
    else console.log(`Admin account created: ${created.user.username}`);
    return;
  }
  if (found.user.role !== 'admin') {
    found.user.role = 'admin';
    found.user.updatedAt = new Date().toISOString();
    database.recordEvent('account.promoted', found.key, { role: 'admin' });
  }
}

bootstrapAdmin();

function liveRoomsForUser(key) {
  return Object.values(rooms).flatMap(room => room.clients
    .filter(client => client.userKey === key)
    .map(client => {
      const activePlayer = room.players.find(player => player.id === client.id);
      const pendingPlayer = (room.pendingPlayers || []).find(player => player.id === client.id);
      const player = activePlayer || pendingPlayer;
      return {
        code: room.code,
        mode: room.isSinglePlayer ? 'practice' : 'multiplayer',
        started: room.started,
        round: room.round,
        pending: Boolean(pendingPlayer && !activePlayer),
        playerName: player?.name || client.name || 'Player',
        tokens: player?.tokens ?? null,
        folded: Boolean(player?.folded),
      };
    }));
}

// ── HTTP server ──────────────────────────────────────────────────────────────
function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 65536) req.destroy(); });
  req.on('end',  () => { try { cb(JSON.parse(body)); } catch { cb(null); } });
}

const httpServer = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  const pathname = requestUrl.pathname;
  const json = (code, obj) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(obj));
  };

  // ── POST /api/register ───────────────────────────────────────────────────
  if (pathname === '/api/register' && req.method === 'POST') {
    if (isRateLimited(req)) return json(429, { error: 'Too many attempts. Try again later.' });
    readBody(req, data => {
      if (!data) return json(400, { error: 'Bad request' });
      const created = database.createUser({
        username: data.username,
        email: data.email,
        password: data.password,
      });
      if (created.error) {
        const conflict = /taken|registered/.test(created.error);
        return json(conflict ? 409 : 400, { error: created.error });
      }
      const token = database.issueSession(created.key);
      json(201, { sessionToken: token, user: database.publicUser(created.user) });
    });
    return;
  }

  // ── POST /api/login ──────────────────────────────────────────────────────
  if (pathname === '/api/login' && req.method === 'POST') {
    if (isRateLimited(req)) return json(429, { error: 'Too many attempts. Try again later.' });
    readBody(req, data => {
      if (!data) return json(400, { error: 'Bad request' });
      const found = database.findUserByIdentifier(data.identifier || data.username);
      if (!found || !database.verifyPassword(found, data.password || '')) {
        return json(401, { error: 'Invalid email, username, or password' });
      }
      if (found.user.status !== 'active') return json(403, { error: 'This account is disabled' });
      found.user.lastLoginAt = new Date().toISOString();
      found.user.lastSeenAt = found.user.lastLoginAt;
      found.user.stats ||= {};
      found.user.stats.logins = (found.user.stats.logins || 0) + 1;
      database.recordEvent('account.login', found.key, {}, false);
      const token = database.issueSession(found.key);
      json(200, { sessionToken: token, user: database.publicUser(found.user) });
    });
    return;
  }

  // ── POST /api/logout ─────────────────────────────────────────────────────
  if (pathname === '/api/logout' && req.method === 'POST') {
    database.revokeSession(bearerToken(req));
    json(200, { ok: true });
    return;
  }

  // ── GET /api/me ──────────────────────────────────────────────────────────
  if (pathname === '/api/me' && req.method === 'GET') {
    const auth = authenticatedUser(req);
    if (!auth) return json(401, { error: 'Not authenticated' });
    json(200, { user: database.publicUser(auth.user) });
    return;
  }

  // ── GET /api/rooms ───────────────────────────────────────────────────────
  if (pathname === '/api/rooms' && req.method === 'GET') {
    const publicRooms = Object.values(rooms)
      .filter(r => !r.isSinglePlayer)
      .map(r => ({
        code: r.code,
        playerCount: r.players.filter(p => !p.isAI).length,
        maxPlayers: 6,
        started: r.started,
        round: r.round,
        pendingCount: r.pendingPlayers ? r.pendingPlayers.length : 0,
      }));
    json(200, { rooms: publicRooms });
    return;
  }

  // ── POST /api/daily-bonus ────────────────────────────────────────────────
  if (pathname === '/api/daily-bonus' && req.method === 'POST') {
    const auth = authenticatedUser(req);
    if (!auth) return json(401, { error: 'Not authenticated' });
    const { key, user } = auth;
    const now     = Date.now();
    const last    = user.lastDailyBonus || 0;
    const msLeft  = (last + 24 * 60 * 60 * 1000) - now;
    if (msLeft > 0) {
      const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
      return json(429, { error: 'Already claimed', hoursLeft });
    }
    user.tokens += DAILY_BONUS;
    user.lastDailyBonus = now;
    user.updatedAt = new Date().toISOString();
    database.recordEvent('tokens.daily_bonus', key, { amount: DAILY_BONUS, balance: user.tokens });
    json(200, { tokensAdded: DAILY_BONUS, tokens: user.tokens });
    return;
  }

  // ── Admin API ────────────────────────────────────────────────────────────
  if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
    const auth = authenticatedUser(req);
    if (!auth) return json(401, { error: 'Not authenticated' });
    if (auth.user.role !== 'admin') return json(403, { error: 'Administrator access required' });
    const allUsers = Object.entries(users).map(([key, user]) =>
      database.adminUser(key, user, { liveRooms: liveRoomsForUser(key) })
    );
    const activeSince = Date.now() - 24 * 60 * 60 * 1000;
    const liveRooms = Object.values(rooms).map(room => ({
      code: room.code,
      mode: room.isSinglePlayer ? 'practice' : 'multiplayer',
      started: room.started,
      round: room.round,
      playerCount: room.players.length,
      players: room.players.map(player => player.name),
    }));
    json(200, {
      summary: {
        totalUsers: allUsers.length,
        activeUsers24h: allUsers.filter(user => Date.parse(user.lastSeenAt || 0) >= activeSince).length,
        totalGames: database.data.games.length,
        liveRooms: liveRooms.length,
        totalTokens: allUsers.reduce((sum, user) => sum + (user.tokens || 0), 0),
        activeSessions: allUsers.reduce((sum, user) => sum + (user.meta?.activeSessions || 0), 0),
      },
      users: allUsers.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      games: database.data.games.slice(0, 100),
      events: database.data.events.slice(0, 200),
      liveRooms,
      database: { type: 'local-json', updatedAt: database.data.updatedAt },
    });
    return;
  }

  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)$/i);
  if (adminUserMatch && req.method === 'PATCH') {
    const auth = authenticatedUser(req);
    if (!auth) return json(401, { error: 'Not authenticated' });
    if (auth.user.role !== 'admin') return json(403, { error: 'Administrator access required' });
    const found = database.findUserById(adminUserMatch[1]);
    if (!found) return json(404, { error: 'User not found' });
    readBody(req, data => {
      if (!data) return json(400, { error: 'Bad request' });
      if (data.tokens !== undefined) {
        const tokens = Number(data.tokens);
        if (!Number.isInteger(tokens) || tokens < 0 || tokens > 1000000000) {
          return json(400, { error: 'Tokens must be a whole number from 0 to 1,000,000,000' });
        }
        found.user.tokens = tokens;
      }
      if (data.status !== undefined) {
        if (!['active', 'disabled'].includes(data.status)) return json(400, { error: 'Invalid status' });
        if (found.user.id === auth.user.id && data.status === 'disabled') {
          return json(400, { error: 'You cannot disable your own admin account' });
        }
        found.user.status = data.status;
        if (data.status === 'disabled') database.revokeUserSessions(found.key);
      }
      found.user.updatedAt = new Date().toISOString();
      database.recordEvent('admin.user_updated', auth.key, {
        targetUserId: found.user.id,
        targetUsername: found.user.username,
        tokens: found.user.tokens,
        status: found.user.status,
      });
      json(200, { user: database.publicUser(found.user) });
    });
    return;
  }

  // ── Static files ─────────────────────────────────────────────────────────
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }
  let requestedFile;
  try {
    requestedFile = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  const filePath = path.resolve(__dirname, requestedFile);
  const privateRoots = ['data', 'lib', '.git'];
  const firstPart = requestedFile.split(/[\\/]/)[0];
  if (!filePath.startsWith(`${path.resolve(__dirname)}${path.sep}`) || privateRoots.includes(firstPart)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext    = path.extname(filePath);
  const mime   = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else {
      res.writeHead(200, {
        'Content-Type': `${mime}${['.html', '.css', '.js'].includes(ext) ? '; charset=utf-8' : ''}`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'X-Frame-Options': 'DENY',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    }
  });
});

// ── Room management ──────────────────────────────────────────────────────────
const rooms = {};

function saveRoomTokens(room) {
  let dirty = false;
  room.clients.forEach(c => {
    if (!c.userKey || !users[c.userKey]) return;
    const p = room.players.find(pl => pl.id === c.id);
    if (p) {
      users[c.userKey].tokens = Math.max(p.tokens, 0);
      users[c.userKey].updatedAt = new Date().toISOString();
      dirty = true;
    }
  });
  if (dirty) database.save();
}

function startGameRecord(room, mode) {
  if (room.gameId) return;
  const game = database.createGame(room, mode);
  room.gameId = game.id;
  room.recordedPot = 0;
  room.clients.forEach(client => {
    const user = client.userKey && users[client.userKey];
    if (!user) return;
    user.stats ||= {};
    user.stats.gamesPlayed = (user.stats.gamesPlayed || 0) + 1;
  });
  database.recordEvent('game.started', null, { gameId: game.id, roomCode: room.code, mode });
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
    type: 'snapshot',
    players: room.players.map(p => ({
      id: p.id, name: p.name, tokens: p.tokens, color: p.color, colorIdx: p.colorIdx,
      qualifyHand: p.qualifyHand, scoringHand: p.scoringHand, currentDice: p.currentDice,
      rollsUsed: p.rollsUsed, mustLockBeforeRoll: p.mustLockBeforeRoll,
      finalScore: p.finalScore, folded: p.folded, qualified: p.qualified, roundBet: p.roundBet,
      phaseDone: p.phaseDone || false,
      lastDiceAttempted: p.lastDiceAttempted || false,
      pendingAutoFold: p.pendingAutoFold || false,
      isAI: p.isAI || false,
    })),
    pot: room.pot, round: room.round, turnPlayerId: room.turnPlayerId,
    phase: room.phase, currentBet: room.currentBet, startTokens: room.startTokens,
    subRound: room.subRound || 1, bettingPhase: room.bettingPhase || 'before_roll',
    isSinglePlayer: room.isSinglePlayer || false,
  };
}

// ── Game logic (server-authoritative) ───────────────────────────────────────
const COLORS = ['#e63e6d','#06d6a0','#f59e1b','#5cc8f5','#b06dff','#ff9a3c'];

function createRoom(code, hostClient, startTokens) {
  return {
    code, clients: [], players: [], pendingPlayers: [], pot: 0, round: 1, turnPlayerId: null,
    phase: 'lobby', currentBet: 0, startTokens: startTokens || START_TOKENS,
    bettingQueue: [], bettingPhase: 'before_roll', started: false, subRound: 1,
    isSinglePlayer: false,
  };
}

function getPlayer(room, id) { return room.players.find(p => p.id === id); }

function isHandFull(p) {
  const q = (p.qualifyHand.includes(1)?0:1)+(p.qualifyHand.includes(4)?0:1);
  return q + (4 - p.scoringHand.length) === 0;
}

function canStillRoll(p) {
  // False once the player has used their one shot on the final die slot
  if (p.lastDiceAttempted) return false;
  return !isHandFull(p);
}

function startRound(room) {
  // Promote any pending players who joined during the last round
  if (room.pendingPlayers && room.pendingPlayers.length > 0) {
    room.pendingPlayers.forEach(p => {
      room.players.push(p);
      const c = room.clients.find(cl => cl.id === p.id);
      if (c) sendTo(c, { type: 'room_joined', code: room.code, playerId: p.id });
    });
    room.pendingPlayers = [];
    broadcast(room, { type: 'player_joined', players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, isAI: p.isAI || false })) });
  }

  room.pot = 0; room.currentBet = 0; room.phase = 'roll1';
  room.subRound = 1; room.bettingPhase = 'before_roll';
  const active = room.players.filter(p => p.tokens > 0);
  if (active.length < 2) { endGame(room); return; }

  room.players.forEach(p => {
    if (p.tokens <= 0) return;
    p.qualifyHand = []; p.scoringHand = []; p.currentDice = [];
    p.rollsUsed = 0; p.mustLockBeforeRoll = false; p.phaseDone = false;
    p.finalScore = 0; p.folded = false; p.qualified = false; p.roundBet = 0;
    p.selectedIdx = []; p.lastDiceAttempted = false; p.pendingAutoFold = false;
    const ante = Math.min(ANTE, p.tokens);
    p.tokens -= ante; p.roundBet += ante; room.pot += ante;
  });

  room.turnPlayerId = active[0].id;
  broadcast(room, { type: 'round_start', round: room.round });
  broadcast(room, roomSnapshot(room));
  broadcastTurnNotice(room);
}

function broadcastTurnNotice(room) {
  const p = getPlayer(room, room.turnPlayerId);
  if (!p) return;

  const hasQualifier = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
  const handFull     = isHandFull(p);
  const cantRoll     = !handFull && !p.lastDiceAttempted && p.tokens < ROLL_COST;

  // Human player who can't roll and hasn't qualified → auto-bust
  if (cantRoll && !hasQualifier && !p.isAI) {
    broadcast(room, { type: 'bust', playerId: p.id, playerName: p.name });
    setTimeout(() => autoBust(room, p.id), 2500);
    return;
  }

  broadcast(room, {
    type: 'your_turn', playerId: p.id, playerName: p.name,
    cantAffordRoll: cantRoll && hasQualifier,
  });

  // AI takes turn automatically after a short "thinking" delay
  if (p.isAI) {
    setTimeout(() => aiTakeTurn(room, p.id), 1200);
  }
}

function startNextSubRound(room) {
  room.subRound++;
  room.phase = 'roll' + room.subRound;
  room.bettingPhase = 'before_roll';
  const active = room.players.filter(p => p.tokens > 0 && !p.folded);

  active.forEach(p => {
    // Players who already used their last-die attempt are auto-done this sub-round
    p.phaseDone = p.lastDiceAttempted || false;
    p.currentDice = []; p.rollsUsed = 0; p.mustLockBeforeRoll = false;
  });

  broadcast(room, roomSnapshot(room));
  broadcast(room, { type: 'phase_change', phase: room.phase, subRound: room.subRound });

  // Find first player with something left to do
  const first = active[0];
  room.turnPlayerId = first.id;

  // If first player owes a call from a previous raise, prompt them first
  if (room.currentBet > first.roundBet) {
    room.bettingQueue = [first.id];
    serveBettingQueue(room);
  } else {
    broadcastTurnNotice(room);
  }
}

function advanceTurnInPhase(room) {
  const active = room.players.filter(p => p.tokens > 0 && !p.folded);

  if (active.every(p => p.phaseDone)) {
    // All players have acted this sub-round — check if any can still progress
    if (active.every(p => isHandFull(p)) || active.every(p => !canStillRoll(p))) {
      resolveRound(room);
    } else {
      startNextSubRound(room);
    }
    return;
  }

  const curIdx = active.findIndex(p => p.id === room.turnPlayerId);
  let next = null;
  for (let i = 1; i <= active.length; i++) {
    const c = active[(curIdx + i) % active.length];
    if (!c.phaseDone) { next = c; break; }
  }
  if (!next) {
    // Shouldn't happen, but resolve as fallback
    if (active.every(p => isHandFull(p)) || active.every(p => !canStillRoll(p))) resolveRound(room);
    else startNextSubRound(room);
    return;
  }

  room.turnPlayerId = next.id;
  room.bettingPhase = 'before_roll';
  room.bettingQueue = [next.id];
  broadcast(room, roomSnapshot(room));
  serveBettingQueue(room);
}

function rollDice(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || room.turnPlayerId !== playerId) return { error: 'Not your turn' };
  // One roll per turn — lock dice then end your turn
  if (p.rollsUsed >= 1)          return { error: 'One roll per turn — lock dice then end your turn' };
  if (p.tokens < ROLL_COST)      return { error: 'Not enough tokens' };

  const qualSlots  = (p.qualifyHand.includes(1)?0:1)+(p.qualifyHand.includes(4)?0:1);
  const scoreSlots = 4 - p.scoringHand.length;
  const total      = qualSlots + scoreSlots;
  if (!total)                    return { error: 'Hand full — end your turn' };

  // Mark that this player has used their one shot on the last remaining slot
  if (total === 1) p.lastDiceAttempted = true;

  p.tokens -= ROLL_COST; room.pot += ROLL_COST;
  p.rollsUsed++;
  p.currentDice        = Array.from({ length: total }, () => Math.floor(Math.random()*6)+1);
  p.selectedIdx        = [];
  p.mustLockBeforeRoll = true;

  broadcast(room, roomSnapshot(room));

  // Auto-fail: last die slot was a qualifier and the rolled value can't fill it
  if (total === 1 && scoreSlots === 0 && qualSlots === 1) {
    const neededQual = !p.qualifyHand.includes(1) ? 1 : 4;
    const rolledValue = p.currentDice[0];
    if (rolledValue !== neededQual) {
      p.pendingAutoFold = true;
      broadcast(room, roomSnapshot(room));
      broadcast(room, {
        type: 'qualify_failed',
        playerId: p.id, playerName: p.name,
        rolledValue, neededQual,
      });
      setTimeout(() => autoFailQualify(room, p.id), 2000);
    }
  }

  return { ok: true };
}

function autoFailQualify(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || p.phaseDone || p.folded) return; // already handled
  p.folded          = true;
  p.pendingAutoFold = false;
  p.currentDice     = [];
  p.mustLockBeforeRoll = false;
  p.phaseDone       = true;
  room.bettingPhase = 'before_roll';
  broadcast(room, roomSnapshot(room));
  advanceTurnInPhase(room);
}

function autoBust(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || p.folded || p.phaseDone) return;
  p.folded = true;
  p.pendingAutoFold = false;
  p.currentDice = [];
  p.mustLockBeforeRoll = false;
  p.phaseDone = true;
  broadcast(room, roomSnapshot(room));
  advanceTurnInPhase(room);
}

function lockDice(room, playerId, selectedIdx) {
  const p = getPlayer(room, playerId);
  if (!p || room.turnPlayerId !== playerId) return { error: 'Not your turn' };
  if (p.pendingAutoFold)                    return { error: 'Qualifying failed — auto-folding' };
  if (!selectedIdx || !selectedIdx.length)  return { error: 'Select at least one die' };

  const vals = selectedIdx.map(i => p.currentDice[i]).filter(v => v !== undefined);
  let m1 = !p.qualifyHand.includes(1);
  let m4 = !p.qualifyHand.includes(4);

  for (const v of vals) {
    const qf = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
    if (!qf && v===1 && m1)          { p.qualifyHand.push(1); m1=false; }
    else if (!qf && v===4 && m4)     { p.qualifyHand.push(4); m4=false; }
    else if (p.scoringHand.length<4) { p.scoringHand.push(v); }
    // Wrong value for qualifier, scoring full → die discarded, player won't qualify
  }

  // Sort descending so high indices are spliced first — prevents index-shift bugs
  // when dice are selected in non-ascending tap order.
  [...selectedIdx].sort((a, b) => b - a).forEach(i => p.currentDice.splice(i, 1));
  p.selectedIdx        = [];
  p.mustLockBeforeRoll = false;

  broadcast(room, roomSnapshot(room));
  return { ok: true };
}

function endTurn(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || room.turnPlayerId !== playerId) return { error: 'Not your turn' };

  const qualSlots  = (p.qualifyHand.includes(1)?0:1)+(p.qualifyHand.includes(4)?0:1);
  const scoreSlots = 4 - p.scoringHand.length;
  const handFull   = qualSlots + scoreSlots === 0;
  const scoringFull = scoreSlots === 0;

  // Must roll first unless: hand is already full, OR broke but already has both qualifiers
  const hasQualifier    = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
  const brokeCannotRoll = p.tokens < ROLL_COST;
  if (!handFull && p.rollsUsed === 0 && !(brokeCannotRoll && hasQualifier)) {
    return { error: 'Must roll at least once' };
  }
  // Rolled but haven't locked yet
  if (p.mustLockBeforeRoll) return { error: 'Lock at least one die before ending turn' };

  p.qualified  = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
  p.finalScore = p.qualified ? p.scoringHand.reduce((a,b) => a+b, 0) : 0;
  p.currentDice = [];
  p.phaseDone   = true;

  broadcast(room, roomSnapshot(room));

  // Prompt current player to place their bet (check or raise — not fold)
  room.bettingPhase = 'after_roll';
  room.bettingQueue = [playerId];
  serveBettingQueue(room);

  return { ok: true };
}

// ── AI player logic ──────────────────────────────────────────────────────────
function aiTakeTurn(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || p.folded || p.pendingAutoFold || room.turnPlayerId !== playerId) return;

  const handFull    = isHandFull(p);
  const hasQualifier = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
  const cantRoll    = !handFull && p.tokens < ROLL_COST;

  if (cantRoll) {
    if (!hasQualifier) { autoBust(room, playerId); }
    else               { endTurn(room, playerId); }
    return;
  }
  if (handFull) { endTurn(room, playerId); return; }

  const result = rollDice(room, playerId);
  if (result.error) {
    // If we failed to roll but need to lock first, go straight to lock+end
    if (p.mustLockBeforeRoll) {
      setTimeout(() => aiLockAndEnd(room, playerId), 500);
    } else {
      endTurn(room, playerId);
    }
    return;
  }
  setTimeout(() => aiLockAndEnd(room, playerId), 1000);
}

function aiLockAndEnd(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || p.folded) return;
  if (p.pendingAutoFold) return; // autoFailQualify timer will handle it

  if (!p.currentDice || !p.currentDice.length) { endTurn(room, playerId); return; }

  const needs1      = !p.qualifyHand.includes(1);
  const needs4      = !p.qualifyHand.includes(4);
  const scoreSlots  = 4 - p.scoringHand.length;
  const selectedIdx = [];
  const usedIdx     = new Set();

  if (needs1) {
    const idx = p.currentDice.findIndex((v, i) => v === 1 && !usedIdx.has(i));
    if (idx !== -1) { selectedIdx.push(idx); usedIdx.add(idx); }
  }
  if (needs4) {
    const idx = p.currentDice.findIndex((v, i) => v === 4 && !usedIdx.has(i));
    if (idx !== -1) { selectedIdx.push(idx); usedIdx.add(idx); }
  }
  if (scoreSlots > 0) {
    p.currentDice
      .map((v, i) => ({ v, i }))
      .filter(d => !usedIdx.has(d.i))
      .sort((a, b) => b.v - a.v)
      .slice(0, scoreSlots)
      .forEach(d => selectedIdx.push(d.i));
  }

  if (selectedIdx.length > 0) {
    lockDice(room, playerId, selectedIdx);
    setTimeout(() => endTurn(room, playerId), 700);
  } else if (p.mustLockBeforeRoll && p.currentDice && p.currentDice.length > 0) {
    // No useful dice (scoring full, no qualifier rolled) — must lock something before ending.
    // Lock the first die as a discard so the turn can close properly.
    lockDice(room, playerId, [0]);
    setTimeout(() => endTurn(room, playerId), 700);
  } else {
    endTurn(room, playerId);
  }
}

function aiBet(room, playerId) {
  const p = getPlayer(room, playerId);
  if (!p || p.folded) return;
  const callAmt = Math.max(0, room.currentBet - (p.roundBet || 0));
  if (callAmt > 0 && callAmt <= p.tokens) {
    placeBet(room, playerId, 'call', callAmt);
  } else if (callAmt > 0) {
    placeBet(room, playerId, 'fold', 0);
  } else {
    placeBet(room, playerId, 'check', 0);
  }
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
  // check: no token change
  broadcast(room, roomSnapshot(room));
  serveBettingQueue(room);
}

function serveBettingQueue(room) {
  if (!room.bettingQueue.length) {
    broadcast(room, { type: 'betting_done' });
    if (room.bettingPhase === 'after_roll') {
      // Player just placed their end-of-turn bet → advance to next player's turn
      room.bettingPhase = 'before_roll';
      advanceTurnInPhase(room);
    } else {
      // before_roll: player called/folded → give them their roll turn (or advance if folded)
      const p = getPlayer(room, room.turnPlayerId);
      if (!p || p.folded) {
        advanceTurnInPhase(room);
      } else {
        broadcastTurnNotice(room);
      }
    }
    return;
  }
  const pid = room.bettingQueue.shift();
  const p   = room.players.find(pl => pl.id === pid);
  if (!p || p.folded || p.tokens <= 0) { serveBettingQueue(room); return; }
  // AI auto-bets
  if (p.isAI) {
    setTimeout(() => aiBet(room, pid), 700);
    return;
  }
  broadcast(room, {
    type: 'bet_action_needed', playerId: pid,
    currentBet: room.currentBet, pot: room.pot,
    bettingPhase: room.bettingPhase,
  });
}

function resolveRound(room) {
  room.players.forEach(p => {
    if (!p.folded) {
      p.qualified  = p.qualifyHand.includes(1) && p.qualifyHand.includes(4);
      p.finalScore = p.qualified ? p.scoringHand.reduce((a,b) => a+b, 0) : 0;
    }
  });

  const eligible = room.players
    .filter(p => !p.folded && p.qualified)
    .sort((a,b) => b.finalScore - a.finalScore);

  let winners = [];
  const potWentToHouse = eligible.length === 0;
  const resolvedPot = room.pot;

  if (eligible.length) {
    const best = eligible[0].finalScore;
    winners = eligible.filter(p => p.finalScore === best);
    const share = Math.floor(room.pot / winners.length);
    winners.forEach(p => { p.tokens += share; });
  }

  broadcast(room, {
    type: 'round_over', winners: winners.map(p => p.id),
    players: room.players.map(p => ({ id:p.id, name:p.name, color:p.color, finalScore:p.finalScore, qualified:p.qualified, folded:p.folded, tokens:p.tokens, isAI: p.isAI || false })),
    pot: room.pot, potWentToHouse, isSinglePlayer: room.isSinglePlayer || false,
  });

  if (room.gameId) {
    room.recordedPot = (room.recordedPot || 0) + resolvedPot;
    const game = database.data.games.find(item => item.id === room.gameId);
    database.updateGame(room.gameId, {
      rounds: room.round,
      totalPot: room.recordedPot,
      lastRoundAt: new Date().toISOString(),
    });
    room.clients.forEach(client => {
      const user = client.userKey && users[client.userKey];
      if (!user) return;
      user.stats ||= {};
      user.stats.roundsPlayed = (user.stats.roundsPlayed || 0) + 1;
      if (winners.some(winner => winner.id === client.id)) {
        user.stats.roundsWon = (user.stats.roundsWon || 0) + 1;
      }
    });
    if (game) database.save();
  }

  room.pot = 0;
  room.round++;
  if (!room.isSinglePlayer) saveRoomTokens(room);
  setTimeout(() => startRound(room), 5000);
}

function endGame(room) {
  if (!room.isSinglePlayer) saveRoomTokens(room);
  if (room.gameId) {
    const highest = Math.max(...room.players.map(player => player.tokens));
    const winnerUserIds = room.clients
      .filter(client => room.players.some(player => player.id === client.id && player.tokens === highest))
      .map(client => users[client.userKey]?.id)
      .filter(Boolean);
    room.clients.forEach(client => {
      const user = client.userKey && users[client.userKey];
      if (user && winnerUserIds.includes(user.id)) {
        user.stats ||= {};
        user.stats.gamesWon = (user.stats.gamesWon || 0) + 1;
      }
    });
    database.updateGame(room.gameId, {
      status: 'completed',
      rounds: Math.max(0, room.round - 1),
      winnerUserIds,
      endedAt: new Date().toISOString(),
    });
    database.recordEvent('game.completed', null, { gameId: room.gameId, roomCode: room.code, winnerUserIds });
  }
  broadcast(room, {
    type: 'game_over',
    players: room.players.map(p => ({ id:p.id, name:p.name, tokens:p.tokens, isAI: p.isAI || false })),
    isSinglePlayer: room.isSinglePlayer || false,
  });
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
        const authUser = websocketUser(msg.sessionToken);
        if (!authUser) { sendTo(client, { type:'error', msg:'Please sign in again' }); break; }
        const uKey     = authUser.key;
        const acct     = authUser.user;
        const name     = acct.username;
        const startTok = Math.max(acct.tokens, 100);
        const vsComp   = !!msg.vsComputer;

        const code = makeCode();
        const room = createRoom(code, client, startTok);
        if (vsComp) room.isSinglePlayer = true;
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
        sendTo(client, { type:'room_created', code, playerId: client.id, isSinglePlayer: vsComp });
        broadcast(room, { type:'player_joined', players: room.players.map(p=>({id:p.id,name:p.name,color:p.color,isAI:p.isAI||false})) });
        database.recordEvent('room.created', uKey, { roomCode: code, mode: vsComp ? 'practice' : 'multiplayer' });

        if (vsComp) {
          // Add AI opponent and start immediately
          const aiColorIdx = 1;
          const aiId = 'AI_' + makeCode();
          room.players.push({
            id: aiId, name: 'Computer',
            tokens: startTok, color: COLORS[aiColorIdx], colorIdx: aiColorIdx,
            qualifyHand:[], scoringHand:[], currentDice:[], selectedIdx:[],
            rollsUsed:0, mustLockBeforeRoll:false,
            finalScore:0, folded:false, qualified:false, roundBet:0,
            isAI: true,
          });
          broadcast(room, { type:'player_joined', players: room.players.map(p=>({id:p.id,name:p.name,color:p.color,isAI:p.isAI||false})) });
          room.started = true;
          startGameRecord(room, 'practice');
          broadcast(room, { type:'game_starting', isSinglePlayer: true });
          setTimeout(() => startRound(room), 1500);
        }
        break;
      }

      case 'join_room': {
        const room = rooms[msg.code];
        if (!room)               { sendTo(client, { type:'error', msg:'Room not found' }); break; }
        if (room.isSinglePlayer) { sendTo(client, { type:'error', msg:'That is a private practice game' }); break; }

        const authUser = websocketUser(msg.sessionToken);
        if (!authUser) { sendTo(client, { type:'error', msg:'Please sign in again' }); break; }
        const uKey     = authUser.key;
        const acct     = authUser.user;
        const name     = acct.username;
        const startTok = Math.max(acct.tokens, 100);

        client.roomCode = room.code;
        client.name     = name;
        client.userKey  = uKey || null;

        if (room.started) {
          // Game in progress — add as pending (joins at next round)
          const totalSlots = room.players.length + (room.pendingPlayers ? room.pendingPlayers.length : 0);
          if (totalSlots >= 6) { sendTo(client, { type:'error', msg:'Room full' }); break; }
          if (!room.pendingPlayers) room.pendingPlayers = [];
          const colorIdx = (room.players.length + room.pendingPlayers.length) % COLORS.length;
          room.pendingPlayers.push({
            id: client.id, name,
            tokens: startTok, color: COLORS[colorIdx], colorIdx,
            qualifyHand:[], scoringHand:[], currentDice:[], selectedIdx:[],
            rollsUsed:0, mustLockBeforeRoll:false,
            finalScore:0, folded:false, qualified:false, roundBet:0,
          });
          room.clients.push(client);
          sendTo(client, { type:'waiting_for_round', code: room.code, playerId: client.id, round: room.round });
          broadcast(room, { type:'player_pending', playerName: name });
        } else {
          if (room.players.length >= 6) { sendTo(client, { type:'error', msg:'Room full' }); break; }
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
          broadcast(room, { type:'player_joined', players: room.players.map(p=>({id:p.id,name:p.name,color:p.color,isAI:p.isAI||false})) });
        }
        database.recordEvent('room.joined', uKey, { roomCode: room.code, pending: room.started });
        break;
      }

      case 'start_game': {
        const room = rooms[client.roomCode];
        if (!room || room.players[0].id !== client.id) break; // only host
        if (room.players.length < 2) { sendTo(client, { type:'error', msg:'Need at least 2 players' }); break; }
        room.started = true;
        startGameRecord(room, 'multiplayer');
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
