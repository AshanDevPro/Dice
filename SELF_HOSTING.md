# Self-hosting PignusDice

PignusDice does not use Google sign-in, Firebase, Supabase, or any hosted database. Authentication and data storage run inside the Node.js server. The only npm runtime dependency is `ws`, which provides multiplayer WebSockets.

## 1. Install and choose a persistent data directory

On an Ubuntu server, clone the project and install dependencies:

```bash
git clone https://github.com/AshanDevPro/Dice.git /opt/pignusdice
cd /opt/pignusdice
npm ci
sudo install -d -m 700 -o "$USER" -g "$USER" /var/lib/pignusdice
```

`/var/lib/pignusdice/database.json` will be your private database. Do not place this file in Git or in a public web directory.

## 2. Create the owner account once

Use a unique username, real owner email, and a long password:

```bash
cd /opt/pignusdice
DATA_DIR=/var/lib/pignusdice \
ADMIN_USERNAME=owner \
ADMIN_EMAIL=owner@example.com \
ADMIN_PASSWORD='replace-with-a-long-unique-password' \
npm run create-admin
```

The password is hashed with Node's `scrypt` before storage. The plain password is not saved. To promote an existing user and reset that user's password, run the same command with `RESET_ADMIN_PASSWORD=true`.

## 3. Run with PM2

```bash
cd /opt/pignusdice
DATA_DIR=/var/lib/pignusdice PORT=3000 pm2 start server.js --name pignusdice
pm2 save
```

Only the running app needs `DATA_DIR`; it does not need the admin password in its environment after the owner account has been created.

## 4. Put HTTPS in front of the app

Use Nginx or another reverse proxy and enable TLS. The proxy must forward WebSocket upgrade headers:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Configure a valid TLS certificate before exposing accounts on the internet. Never send passwords over plain HTTP on a public network.

## 5. Back up your database

Stop writes briefly, copy the database, and restart:

```bash
pm2 stop pignusdice
cp /var/lib/pignusdice/database.json "/var/backups/pignusdice-$(date +%F-%H%M).json"
pm2 start pignusdice
```

Keep backups outside the web root and restrict permissions. Test restoring a backup before relying on it.

## Admin dashboard

Visit `https://your-domain.example/admin.html`. Administrators can view registered users, balances, recent games, activity, and live rooms. They can also change token balances or disable an account. Password hashes and session tokens are never returned by the admin API.
