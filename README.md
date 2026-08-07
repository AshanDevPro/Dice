# PignusDice

Self-hosted 1·4·24 multiplayer dice game with local accounts and an owner dashboard.

## Run locally

```powershell
npm install
$env:ADMIN_USERNAME="owner"
$env:ADMIN_EMAIL="owner@example.com"
$env:ADMIN_PASSWORD="use-a-long-unique-password"
npm run create-admin
Remove-Item Env:ADMIN_PASSWORD
npm start
```

Open `http://localhost:3000` for the game or `http://localhost:3000/admin.html` for the admin dashboard.

User accounts, sessions, activity, game history, and balances are stored in `data/database.json`. The `data` directory is ignored by Git so production user data is never committed. Set `DATA_DIR` to store the database on a persistent server disk outside the repository.

## Rewards

This hosted build does not require a payment API. Token purchases are disabled by default, and the game can run with only local accounts, room play, admin tools, and reward codes.

Admins can create token reward codes from `http://localhost:3000/admin.html` under the Rewards tab. Signed-in players can redeem those codes from the game lobby.

Room invites use `https://your-domain.com/join?room=CODE`; the server routes `/join` to the game page and the browser joins with `wss://` when opened over HTTPS.

See [SELF_HOSTING.md](SELF_HOSTING.md) for production setup and backups.
