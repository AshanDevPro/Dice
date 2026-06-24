'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATABASE_VERSION = 1;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 10000;
const MAX_GAMES = 5000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function usernameKey(value) {
  return normalizeUsername(value).toLowerCase();
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function securePasswordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex');
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left), 'hex');
    const b = Buffer.from(String(right), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

class LocalDatabase {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'database.json');
    this.legacyUsersFile = path.join(dataDir, 'users.json');
    this.data = this.load();
    this.pruneSessions();
  }

  emptyData() {
    return {
      version: DATABASE_VERSION,
      users: {},
      sessions: {},
      events: [],
      games: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      parsed.users ||= {};
      parsed.sessions ||= {};
      parsed.events ||= [];
      parsed.games ||= [];
      return parsed;
    }

    const data = this.emptyData();
    if (fs.existsSync(this.legacyUsersFile)) {
      const legacy = JSON.parse(fs.readFileSync(this.legacyUsersFile, 'utf8'));
      Object.entries(legacy).forEach(([key, oldUser]) => {
        const createdAt = nowIso();
        data.users[key] = {
          id: crypto.randomUUID(),
          username: oldUser.username || key,
          email: oldUser.email || '',
          passwordHash: oldUser.passwordHash,
          passwordSalt: oldUser.salt,
          passwordAlgo: 'pbkdf2-legacy',
          role: oldUser.role === 'admin' ? 'admin' : 'player',
          status: 'active',
          tokens: Number.isFinite(oldUser.tokens) ? oldUser.tokens : 500,
          lastDailyBonus: oldUser.lastDailyBonus || 0,
          createdAt,
          updatedAt: createdAt,
          lastLoginAt: null,
          lastSeenAt: null,
          stats: { logins: 0, gamesPlayed: 0, gamesWon: 0, roundsPlayed: 0, roundsWon: 0 },
        };
      });
      data.events.push({
        id: crypto.randomUUID(),
        type: 'database.migrated',
        userId: null,
        username: 'System',
        details: { usersImported: Object.keys(data.users).length },
        createdAt: nowIso(),
      });
    }
    this.write(data);
    return data;
  }

  write(data = this.data) {
    data.updatedAt = nowIso();
    const tempFile = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, this.file);
  }

  save() {
    this.write(this.data);
  }

  validateRegistration({ username, email, password }) {
    const cleanUsername = normalizeUsername(username);
    const cleanEmail = normalizeEmail(email);
    if (!/^[A-Za-z0-9_]{3,20}$/.test(cleanUsername)) {
      return 'Username must be 3–20 letters, numbers, or underscores';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
      return 'Enter a valid email address';
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return 'Password must be 8–128 characters';
    }
    return null;
  }

  findUserByIdentifier(identifier) {
    const value = String(identifier || '').trim().toLowerCase();
    if (!value) return null;
    if (this.data.users[value]) return { key: value, user: this.data.users[value] };
    const entry = Object.entries(this.data.users).find(([, user]) => normalizeEmail(user.email) === value);
    return entry ? { key: entry[0], user: entry[1] } : null;
  }

  findUserById(id) {
    const entry = Object.entries(this.data.users).find(([, user]) => user.id === id);
    return entry ? { key: entry[0], user: entry[1] } : null;
  }

  createUser({ username, email, password, role = 'player' }) {
    const error = this.validateRegistration({ username, email, password });
    if (error) return { error };

    const cleanUsername = normalizeUsername(username);
    const cleanEmail = normalizeEmail(email);
    const key = usernameKey(cleanUsername);
    if (this.data.users[key]) return { error: 'Username already taken' };
    if (Object.values(this.data.users).some(user => normalizeEmail(user.email) === cleanEmail)) {
      return { error: 'Email address already registered' };
    }

    const createdAt = nowIso();
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      email: cleanEmail,
      passwordHash: securePasswordHash(password, salt),
      passwordSalt: salt,
      passwordAlgo: 'scrypt-v1',
      role: role === 'admin' ? 'admin' : 'player',
      status: 'active',
      tokens: 500,
      lastDailyBonus: 0,
      createdAt,
      updatedAt: createdAt,
      lastLoginAt: null,
      lastSeenAt: null,
      stats: { logins: 0, gamesPlayed: 0, gamesWon: 0, roundsPlayed: 0, roundsWon: 0 },
    };
    this.data.users[key] = user;
    this.recordEvent('account.registered', key, { role: user.role }, false);
    this.save();
    return { key, user };
  }

  setPassword(user, password) {
    const salt = crypto.randomBytes(16).toString('hex');
    user.passwordSalt = salt;
    user.passwordHash = securePasswordHash(password, salt);
    user.passwordAlgo = 'scrypt-v1';
    user.updatedAt = nowIso();
  }

  verifyPassword(found, password) {
    if (!found || !found.user || typeof password !== 'string') return false;
    const { user } = found;
    let valid = false;
    if (user.passwordAlgo === 'scrypt-v1') {
      valid = safeEqualHex(securePasswordHash(password, user.passwordSalt), user.passwordHash);
    } else if (user.passwordAlgo === 'pbkdf2-legacy') {
      const legacyHash = crypto.pbkdf2Sync(password, user.passwordSalt, 10000, 32, 'sha256').toString('hex');
      valid = safeEqualHex(legacyHash, user.passwordHash);
      if (valid) {
        this.setPassword(user, password);
        this.save();
      }
    }
    return valid;
  }

  issueSession(key) {
    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = nowIso();
    const user = this.data.users[key];
    if (user) user.lastSeenAt = createdAt;
    this.data.sessions[tokenHash(token)] = {
      userKey: key,
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    this.save();
    return token;
  }

  getSession(token, touch = true) {
    if (!token) return null;
    const hash = tokenHash(token);
    const session = this.data.sessions[hash];
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      delete this.data.sessions[hash];
      this.save();
      return null;
    }
    const user = this.data.users[session.userKey];
    if (!user || user.status !== 'active') return null;
    if (touch && Date.now() - Date.parse(session.lastSeenAt || 0) > 5 * 60 * 1000) {
      session.lastSeenAt = nowIso();
      user.lastSeenAt = session.lastSeenAt;
      this.save();
    }
    return { key: session.userKey, user, session, tokenHash: hash };
  }

  revokeSession(token) {
    const hash = tokenHash(token);
    if (!this.data.sessions[hash]) return false;
    delete this.data.sessions[hash];
    this.save();
    return true;
  }

  revokeUserSessions(key) {
    Object.entries(this.data.sessions).forEach(([hash, session]) => {
      if (session.userKey === key) delete this.data.sessions[hash];
    });
  }

  pruneSessions() {
    let changed = false;
    Object.entries(this.data.sessions).forEach(([hash, session]) => {
      if (!this.data.users[session.userKey] || Date.parse(session.expiresAt) <= Date.now()) {
        delete this.data.sessions[hash];
        changed = true;
      }
    });
    if (changed) this.save();
  }

  recordEvent(type, key, details = {}, save = true) {
    const user = key ? this.data.users[key] : null;
    this.data.events.unshift({
      id: crypto.randomUUID(),
      type,
      userId: user?.id || null,
      username: user?.username || 'System',
      details,
      createdAt: nowIso(),
    });
    this.data.events = this.data.events.slice(0, MAX_EVENTS);
    if (save) this.save();
  }

  createGame(room, mode) {
    const game = {
      id: crypto.randomUUID(),
      roomCode: room.code,
      mode,
      status: 'active',
      rounds: 0,
      totalPot: 0,
      players: room.clients.map(client => {
        const user = client.userKey ? this.data.users[client.userKey] : null;
        return { userId: user?.id || null, username: client.name || user?.username || 'Player' };
      }),
      winnerUserIds: [],
      startedAt: nowIso(),
      endedAt: null,
    };
    this.data.games.unshift(game);
    this.data.games = this.data.games.slice(0, MAX_GAMES);
    this.save();
    return game;
  }

  updateGame(gameId, updates) {
    const game = this.data.games.find(item => item.id === gameId);
    if (!game) return null;
    Object.assign(game, updates);
    this.save();
    return game;
  }

  publicUser(user) {
    return {
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
      stats: user.stats || {},
    };
  }
}

module.exports = { LocalDatabase, normalizeEmail, usernameKey };
