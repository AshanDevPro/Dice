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

See [SELF_HOSTING.md](SELF_HOSTING.md) for production setup and backups.
