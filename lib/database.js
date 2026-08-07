'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATABASE_VERSION = 1;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 10000;
const MAX_GAMES = 5000;
const MAX_TRANSACTIONS = 20000;
const MAX_REDEMPTIONS = 10000;

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

function latestIso(items, field) {
  const latest = items
    .map(item => Date.parse(item?.[field] || 0))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

function dateIso(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
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
      rewards: {},
      catalogRewards: {},
      rewardRedemptions: [],
      transactions: [],
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
      parsed.rewards ||= {};
      parsed.catalogRewards ||= {};
      parsed.rewardRedemptions ||= [];
      parsed.transactions ||= [];
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

  recordTokenTransaction(key, type, amount, balanceAfter, details = {}, save = true) {
    const user = key ? this.data.users[key] : null;
    this.data.transactions ||= [];
    const transaction = {
      id: crypto.randomUUID(),
      type: String(type || 'unknown').slice(0, 80),
      amount: Number(amount) || 0,
      balanceAfter: Number(balanceAfter) || 0,
      userId: user?.id || null,
      username: user?.username || 'System',
      details,
      createdAt: nowIso(),
    };
    this.data.transactions.unshift(transaction);
    this.data.transactions = this.data.transactions.slice(0, MAX_TRANSACTIONS);
    if (save) this.save();
    return transaction;
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

  normalizeRewardCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  adminReward(reward) {
    return {
      code: reward.code,
      title: reward.title,
      tokens: reward.tokens,
      maxRedemptions: reward.maxRedemptions,
      redemptionCount: reward.redemptions ? Object.keys(reward.redemptions).length : 0,
      active: reward.active,
      expiresAt: reward.expiresAt,
      createdAt: reward.createdAt,
      createdBy: reward.createdBy,
    };
  }

  listRewards() {
    return Object.values(this.data.rewards || {})
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .map(reward => this.adminReward(reward));
  }

  publicCatalogReward(reward) {
    const quantity = Number.isInteger(reward.quantity) ? reward.quantity : 0;
    const redeemedCount = Number.isInteger(reward.redeemedCount) ? reward.redeemedCount : 0;
    return {
      id: reward.id,
      title: reward.title,
      description: reward.description,
      imageUrl: reward.imageUrl,
      tokenCost: reward.tokenCost,
      quantity,
      redeemedCount,
      available: Math.max(0, quantity - redeemedCount),
      active: !!reward.active && !reward.archived,
      instructions: reward.instructions,
      createdAt: reward.createdAt,
      updatedAt: reward.updatedAt,
    };
  }

  adminCatalogReward(reward) {
    return {
      ...this.publicCatalogReward(reward),
      archived: !!reward.archived,
      createdBy: reward.createdBy || null,
    };
  }

  publicRewardRedemption(redemption) {
    return {
      id: redemption.id,
      rewardId: redemption.rewardId,
      rewardTitle: redemption.rewardTitle,
      rewardImageUrl: redemption.rewardImageUrl || '',
      tokenCost: redemption.tokenCost,
      status: redemption.status,
      instructions: redemption.instructions || '',
      fulfilmentNote: redemption.fulfilmentNote || '',
      requestedAt: redemption.requestedAt,
      updatedAt: redemption.updatedAt,
    };
  }

  adminRewardRedemption(redemption) {
    return {
      ...this.publicRewardRedemption(redemption),
      userId: redemption.userId,
      username: redemption.username,
    };
  }

  listCatalogRewards({ includeInactive = false, includeArchived = false, admin = false } = {}) {
    return Object.values(this.data.catalogRewards || {})
      .filter(reward => includeArchived || !reward.archived)
      .filter(reward => includeInactive || reward.active)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .map(reward => admin ? this.adminCatalogReward(reward) : this.publicCatalogReward(reward));
  }

  cleanRewardUrl(value) {
    const clean = String(value || '').trim().slice(0, 500);
    if (!clean) return '';
    if (/^\s*javascript:/i.test(clean)) return '';
    return clean;
  }

  catalogRewardPayload(data, existing = null) {
    const title = String(data.title ?? existing?.title ?? '').trim().slice(0, 90);
    if (title.length < 3) return { error: 'Reward title must be at least 3 characters' };

    const tokenCost = Number(data.tokenCost ?? existing?.tokenCost);
    if (!Number.isInteger(tokenCost) || tokenCost < 1 || tokenCost > 1000000000) {
      return { error: 'Token cost must be a whole number from 1 to 1,000,000,000' };
    }

    const quantity = Number(data.quantity ?? existing?.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1000000) {
      return { error: 'Quantity must be a whole number from 0 to 1,000,000' };
    }

    return {
      title,
      description: String(data.description ?? existing?.description ?? '').trim().slice(0, 600),
      imageUrl: this.cleanRewardUrl(data.imageUrl ?? existing?.imageUrl),
      tokenCost,
      quantity,
      instructions: String(data.instructions ?? existing?.instructions ?? '').trim().slice(0, 600),
      active: data.active === undefined ? !!(existing ? existing.active : true) : !!data.active,
    };
  }

  createCatalogReward(data = {}, createdBy = null) {
    const payload = this.catalogRewardPayload(data);
    if (payload.error) return payload;
    const id = crypto.randomUUID();
    const reward = {
      id,
      ...payload,
      redeemedCount: 0,
      archived: false,
      createdBy,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.catalogRewards[id] = reward;
    this.save();
    return { reward };
  }

  updateCatalogReward(id, data = {}) {
    const reward = this.data.catalogRewards?.[id];
    if (!reward) return { error: 'Reward not found' };
    const payload = this.catalogRewardPayload(data, reward);
    if (payload.error) return payload;
    Object.assign(reward, payload);
    if (data.archived !== undefined) {
      reward.archived = !!data.archived;
      if (reward.archived) reward.active = false;
    }
    reward.updatedAt = nowIso();
    this.save();
    return { reward };
  }

  redeemCatalogReward(rewardId, userKey) {
    const reward = this.data.catalogRewards?.[rewardId];
    const user = this.data.users[userKey];
    if (!reward || reward.archived || !reward.active) return { error: 'Reward is not available' };
    if (!user) return { error: 'User not found' };
    const available = Math.max(0, Number(reward.quantity || 0) - Number(reward.redeemedCount || 0));
    if (available <= 0) return { error: 'Reward is out of stock' };
    if (user.tokens < reward.tokenCost) return { error: 'Not enough tokens for this reward' };

    user.tokens -= reward.tokenCost;
    user.updatedAt = nowIso();
    reward.redeemedCount = Number(reward.redeemedCount || 0) + 1;
    reward.updatedAt = nowIso();

    this.data.rewardRedemptions ||= [];
    const redemption = {
      id: crypto.randomUUID(),
      rewardId: reward.id,
      rewardTitle: reward.title,
      rewardImageUrl: reward.imageUrl || '',
      tokenCost: reward.tokenCost,
      status: 'pending',
      instructions: reward.instructions || '',
      fulfilmentNote: '',
      userId: user.id,
      userKey,
      username: user.username,
      requestedAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.rewardRedemptions.unshift(redemption);
    this.data.rewardRedemptions = this.data.rewardRedemptions.slice(0, MAX_REDEMPTIONS);
    this.recordTokenTransaction(userKey, 'reward_redemption', -reward.tokenCost, user.tokens, {
      rewardId: reward.id,
      rewardTitle: reward.title,
      redemptionId: redemption.id,
    }, false);
    this.recordEvent('reward.catalog_redeemed', userKey, {
      rewardId: reward.id,
      rewardTitle: reward.title,
      tokenCost: reward.tokenCost,
      redemptionId: redemption.id,
    }, false);
    this.save();
    return {
      reward: this.publicCatalogReward(reward),
      redemption: this.publicRewardRedemption(redemption),
      tokens: user.tokens,
    };
  }

  listUserRewardRedemptions(userKey) {
    return (this.data.rewardRedemptions || [])
      .filter(redemption => redemption.userKey === userKey)
      .map(redemption => this.publicRewardRedemption(redemption));
  }

  listAdminRewardRedemptions() {
    return (this.data.rewardRedemptions || [])
      .map(redemption => this.adminRewardRedemption(redemption));
  }

  updateRewardRedemptionStatus(redemptionId, data = {}, adminKey = null) {
    const redemption = (this.data.rewardRedemptions || []).find(item => item.id === redemptionId);
    if (!redemption) return { error: 'Redemption not found' };
    const allowed = ['pending', 'approved', 'fulfilled', 'rejected', 'cancelled'];
    const nextStatus = String(data.status || redemption.status).toLowerCase();
    if (!allowed.includes(nextStatus)) return { error: 'Invalid redemption status' };
    if (redemption.status === 'fulfilled' && nextStatus !== 'fulfilled') {
      return { error: 'Fulfilled redemptions cannot be changed' };
    }

    const wasFinalRefund = ['rejected', 'cancelled'].includes(redemption.status);
    const willFinalRefund = ['rejected', 'cancelled'].includes(nextStatus);
    if (wasFinalRefund && !willFinalRefund) {
      return { error: 'Refunded redemptions cannot be reopened' };
    }
    if (!wasFinalRefund && willFinalRefund) {
      const user = this.data.users[redemption.userKey];
      const reward = this.data.catalogRewards?.[redemption.rewardId];
      if (user) {
        user.tokens += redemption.tokenCost;
        user.updatedAt = nowIso();
        this.recordTokenTransaction(redemption.userKey, 'refund', redemption.tokenCost, user.tokens, {
          rewardId: redemption.rewardId,
          redemptionId: redemption.id,
          reason: nextStatus,
        }, false);
      }
      if (reward) {
        reward.redeemedCount = Math.max(0, Number(reward.redeemedCount || 0) - 1);
        reward.updatedAt = nowIso();
      }
    }

    redemption.status = nextStatus;
    redemption.fulfilmentNote = String(data.fulfilmentNote ?? redemption.fulfilmentNote ?? '').trim().slice(0, 600);
    redemption.updatedAt = nowIso();
    this.recordEvent('admin.reward_redemption_updated', adminKey, {
      redemptionId,
      status: nextStatus,
      userId: redemption.userId,
      rewardId: redemption.rewardId,
    }, false);
    this.save();
    return { redemption };
  }

  createReward({ code, title, tokens, maxRedemptions = 1, expiresAt = null, createdBy = null }) {
    const cleanCode = this.normalizeRewardCode(code);
    if (!/^[A-Z0-9_-]{3,40}$/.test(cleanCode)) {
      return { error: 'Reward code must be 3-40 letters, numbers, underscores, or dashes' };
    }
    if (this.data.rewards[cleanCode]) return { error: 'Reward code already exists' };
    const tokenAmount = Number(tokens);
    if (!Number.isInteger(tokenAmount) || tokenAmount < 1 || tokenAmount > 1000000000) {
      return { error: 'Reward tokens must be a whole number from 1 to 1,000,000,000' };
    }
    const redemptionLimit = Number(maxRedemptions);
    if (!Number.isInteger(redemptionLimit) || redemptionLimit < 1 || redemptionLimit > 1000000) {
      return { error: 'Max redemptions must be a whole number from 1 to 1,000,000' };
    }
    const expiry = expiresAt ? dateIso(expiresAt) : null;
    if (expiresAt && !expiry) return { error: 'Expiration date is invalid' };
    const reward = {
      code: cleanCode,
      title: String(title || 'Token reward').trim().slice(0, 80) || 'Token reward',
      tokens: tokenAmount,
      maxRedemptions: redemptionLimit,
      active: true,
      expiresAt: expiry,
      redemptions: {},
      createdBy,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.rewards[cleanCode] = reward;
    this.save();
    return { reward };
  }

  redeemReward(code, userKey) {
    const cleanCode = this.normalizeRewardCode(code);
    const reward = this.data.rewards[cleanCode];
    const user = this.data.users[userKey];
    if (!reward || !reward.active) return { error: 'Reward code is not valid' };
    if (!user) return { error: 'User not found' };
    if (reward.expiresAt && Date.parse(reward.expiresAt) <= Date.now()) {
      return { error: 'Reward code has expired' };
    }
    reward.redemptions ||= {};
    if (reward.redemptions[userKey]) return { error: 'You already redeemed this reward' };
    if (Object.keys(reward.redemptions).length >= reward.maxRedemptions) {
      return { error: 'Reward code has already been fully redeemed' };
    }
    user.tokens += reward.tokens;
    user.updatedAt = nowIso();
    reward.redemptions[userKey] = { userId: user.id, username: user.username, redeemedAt: nowIso() };
    reward.updatedAt = nowIso();
    this.recordEvent('tokens.reward_redeemed', userKey, {
      code: cleanCode,
      title: reward.title,
      amount: reward.tokens,
      balance: user.tokens,
    }, false);
    this.recordTokenTransaction(userKey, 'reward_code', reward.tokens, user.tokens, {
      code: cleanCode,
      title: reward.title,
    }, false);
    this.save();
    return { reward: this.adminReward(reward), tokensAdded: reward.tokens, tokens: user.tokens };
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

  userSessionMeta(key) {
    const sessions = Object.values(this.data.sessions).filter(session => session.userKey === key);
    return {
      activeSessions: sessions.length,
      sessionLastSeenAt: latestIso(sessions, 'lastSeenAt'),
      sessionExpiresAt: latestIso(sessions, 'expiresAt'),
    };
  }

  userGameMeta(userId, limit = 10) {
    return this.data.games
      .filter(game => (game.players || []).some(player => player.userId === userId))
      .slice(0, limit)
      .map(game => ({
        id: game.id,
        roomCode: game.roomCode,
        mode: game.mode,
        status: game.status,
        rounds: game.rounds,
        totalPot: game.totalPot,
        startedAt: game.startedAt,
        endedAt: game.endedAt,
        won: Array.isArray(game.winnerUserIds) && game.winnerUserIds.includes(userId),
        players: (game.players || []).map(player => player.username),
      }));
  }

  adminUser(key, user, extras = {}) {
    return {
      ...this.publicUser(user),
      meta: {
        accountKey: key,
        passwordAlgo: user.passwordAlgo || 'unknown',
        lastDailyBonusAt: dateIso(user.lastDailyBonus),
        ...this.userSessionMeta(key),
        recentGames: this.userGameMeta(user.id),
        liveRooms: extras.liveRooms || [],
      },
    };
  }
}

module.exports = { LocalDatabase, normalizeEmail, usernameKey };
