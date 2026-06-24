'use strict';

const path = require('path');
const { LocalDatabase } = require('../lib/database');

const username = process.env.ADMIN_USERNAME;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');

if (!username || !email || !password) {
  console.error('Set ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD before running this command.');
  process.exitCode = 1;
} else {
  try {
    const database = new LocalDatabase(dataDir);
    const existing = database.findUserByIdentifier(username) || database.findUserByIdentifier(email);
    if (existing) {
      existing.user.role = 'admin';
      if (process.env.RESET_ADMIN_PASSWORD === 'true') database.setPassword(existing.user, password);
      existing.user.updatedAt = new Date().toISOString();
      database.recordEvent('account.promoted', existing.key, { role: 'admin' });
      console.log(`Administrator ready: ${existing.user.username}`);
    } else {
      const created = database.createUser({ username, email, password, role: 'admin' });
      if (created.error) throw new Error(created.error);
      console.log(`Administrator created: ${created.user.username}`);
    }
    console.log(`Database: ${path.join(dataDir, 'database.json')}`);
  } catch (error) {
    console.error(`Could not create administrator: ${error.message}`);
    process.exitCode = 1;
  }
}
