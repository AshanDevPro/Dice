'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalDatabase } = require('../lib/database');

function temporaryDatabase(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pignusdice-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new LocalDatabase(dir);
}

test('registers a local user and signs in with username or email', t => {
  const database = temporaryDatabase(t);
  const created = database.createUser({
    username: 'DicePlayer',
    email: 'player@example.com',
    password: 'a-long-password',
  });

  assert.equal(created.error, undefined);
  assert.equal(database.findUserByIdentifier('diceplayer').user.id, created.user.id);
  assert.equal(database.findUserByIdentifier('PLAYER@example.com').user.id, created.user.id);
  assert.equal(database.verifyPassword(created, 'a-long-password'), true);
  assert.equal(database.verifyPassword(created, 'wrong-password'), false);
});

test('enforces unique usernames and email addresses', t => {
  const database = temporaryDatabase(t);
  database.createUser({ username: 'PlayerOne', email: 'one@example.com', password: 'password-one' });

  assert.match(database.createUser({ username: 'playerone', email: 'two@example.com', password: 'password-two' }).error, /Username/);
  assert.match(database.createUser({ username: 'PlayerTwo', email: 'ONE@example.com', password: 'password-two' }).error, /Email/);
});

test('persists sessions without exposing secrets in public user data', t => {
  const database = temporaryDatabase(t);
  const created = database.createUser({ username: 'OwnerOne', email: 'owner@example.com', password: 'owner-password', role: 'admin' });
  const token = database.issueSession(created.key);
  const reopened = new LocalDatabase(database.dataDir);

  assert.equal(reopened.getSession(token).user.role, 'admin');
  assert.equal(reopened.publicUser(created.user).passwordHash, undefined);
  assert.equal(JSON.stringify(reopened.data.sessions).includes(token), false);
});

test('admin user metadata includes activity without exposing secrets', t => {
  const database = temporaryDatabase(t);
  const created = database.createUser({ username: 'MetaUser', email: 'meta@example.com', password: 'meta-password' });
  const token = database.issueSession(created.key);
  const sessionHash = Object.keys(database.data.sessions)[0];
  database.data.games.unshift({
    id: 'game-one',
    roomCode: 'ABCD',
    mode: 'multiplayer',
    status: 'completed',
    rounds: 3,
    totalPot: 450,
    players: [{ userId: created.user.id, username: created.user.username }],
    winnerUserIds: [created.user.id],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
  database.save();

  const view = database.adminUser(created.key, created.user);

  assert.equal(view.meta.activeSessions, 1);
  assert.equal(view.meta.recentGames[0].roomCode, 'ABCD');
  assert.equal(view.meta.recentGames[0].won, true);
  assert.equal(view.passwordHash, undefined);
  assert.equal(view.passwordSalt, undefined);
  assert.equal(JSON.stringify(view).includes(created.user.passwordHash), false);
  assert.equal(JSON.stringify(view).includes(created.user.passwordSalt), false);
  assert.equal(JSON.stringify(view).includes(sessionHash), false);
  assert.equal(JSON.stringify(view).includes(token), false);
});

test('disabled accounts cannot use an existing session', t => {
  const database = temporaryDatabase(t);
  const created = database.createUser({ username: 'PlayerTwo', email: 'two@example.com', password: 'password-two' });
  const token = database.issueSession(created.key);
  created.user.status = 'disabled';
  database.save();

  assert.equal(database.getSession(token), null);
});

test('registration role is player unless trusted server code explicitly sets admin', t => {
  const database = temporaryDatabase(t);
  const player = database.createUser({ username: 'RegularUser', email: 'regular@example.com', password: 'regular-password' });
  const admin = database.createUser({ username: 'AdminUser', email: 'admin@example.com', password: 'admin-password', role: 'admin' });

  assert.equal(player.user.role, 'player');
  assert.equal(admin.user.role, 'admin');
});
