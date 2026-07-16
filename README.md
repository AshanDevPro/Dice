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

## Payments and rewards

Token purchases use Stripe Checkout when these environment variables are set:

```powershell
$env:STRIPE_SECRET_KEY="sk_live_or_test_..."
$env:STRIPE_WEBHOOK_SECRET="whsec_..."
$env:PUBLIC_URL="https://your-domain.com"
$env:FORCE_HTTPS="true"
```

Configure Stripe to send `checkout.session.completed` webhooks to:

```text
https://your-domain.com/api/stripe/webhook
```

Admins can create token reward codes from `http://localhost:3000/admin.html` under the Rewards tab. Signed-in players can redeem those codes from the game lobby.

Room invites use `https://your-domain.com/join?room=CODE`; the server routes `/join` to the game page and the browser joins with `wss://` when opened over HTTPS.

See [SELF_HOSTING.md](SELF_HOSTING.md) for production setup and backups.
