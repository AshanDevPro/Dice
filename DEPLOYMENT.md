# PigNusDice VPS Deployment Guide

This guide deploys the game to the VPS at `74.208.242.39` from:

```text
https://github.com/AshanDevPro/Dice.git
```

The app is self-hosted. It does not use Firebase, Supabase, Google login, or an external database. Accounts, sessions, activity, saved games, tokens, and admin metadata are stored in a private JSON database file on the VPS.

## Important Security Rules

- Do not send or paste your GitHub account password anywhere.
- GitHub no longer accepts normal account passwords for Git over HTTPS.
- If the repository is public, `git clone https://github.com/AshanDevPro/Dice.git` needs no username or password.
- If GitHub asks for credentials, use:
  - Username: `AshanDevPro`
  - Password: a GitHub Personal Access Token, not your GitHub password.
- Do not commit `data/database.json` to GitHub.
- Do not run real user logins over public plain HTTP. Use HTTPS before real users register or sign in.

## 1. Push Your Latest Code To GitHub

Run these commands on your Windows computer inside the project folder:

```powershell
git status
git add .
git commit -m "Prepare VPS deployment"
git push origin main
```

If `git commit` says there is nothing to commit, that is fine. Continue to the VPS steps.

## 2. Connect To VPS

Open Windows PowerShell:

```powershell
ssh root@74.208.242.39
```

Enter your VPS root password when SSH asks for it.

All commands below are run inside the VPS SSH terminal.

## 3. Install Server Packages

```bash
apt update
apt upgrade -y
apt install -y curl git nginx ufw
```

Install Node.js 20 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v
npm -v
```

Expected Node version starts with `v20`.

Install PM2:

```bash
npm install -g pm2
```

## 4. Download The Game

Use `/opt/pignusdice` as the app folder:

```bash
cd /opt
git clone https://github.com/AshanDevPro/Dice.git pignusdice
cd /opt/pignusdice
npm ci
```

If `/opt/pignusdice` already exists, update it instead:

```bash
cd /opt/pignusdice
git pull origin main
npm ci
```

## 5. Create Private Database Folder

The production database should live outside the Git repo:

```bash
install -d -m 700 /var/lib/pignusdice
ls -ld /var/lib/pignusdice
```

Important: do not type `/var/lib/pignusdice/database.json` as a command. That is only the file location. The file is created later by `npm run create-admin`. If you already typed it and saw `No such file or directory`, ignore that error and continue to step 6.

## 6. Create The Admin Account

Choose your real admin username, email, and a long unique password. Username must be 3-20 letters, numbers, or underscores. Password must be at least 8 characters. Change `owner` and `owner@example.com` before running if you want different admin login details.

```bash
cd /opt/pignusdice
export DATA_DIR=/var/lib/pignusdice
export ADMIN_USERNAME=owner
export ADMIN_EMAIL=owner@example.com
read -r -s -p "Admin password: " ADMIN_PASSWORD
echo
export ADMIN_PASSWORD
npm run create-admin
unset ADMIN_PASSWORD ADMIN_USERNAME ADMIN_EMAIL
```

When `Admin password:` appears, type your password and press Enter. It will not show on screen.

Expected result will look like one of these:

```text
Administrator created: owner
Database: /var/lib/pignusdice/database.json
```

Or:

```text
Administrator ready: owner
Database: /var/lib/pignusdice/database.json
```

Now verify the database file exists:

```bash
ls -l /var/lib/pignusdice
```

You should see `database.json`.

If the user already exists, the command promotes it to admin. To reset that admin password later:

```bash
cd /opt/pignusdice
export DATA_DIR=/var/lib/pignusdice
export ADMIN_USERNAME=owner
export ADMIN_EMAIL=owner@example.com
export RESET_ADMIN_PASSWORD=true
read -r -s -p "New admin password: " ADMIN_PASSWORD
echo
export ADMIN_PASSWORD
npm run create-admin
unset ADMIN_PASSWORD ADMIN_USERNAME ADMIN_EMAIL RESET_ADMIN_PASSWORD
```

## 7. Start App With PM2

Create a PM2 config:

```bash
cd /opt/pignusdice
nano ecosystem.config.cjs
```

Paste this:

```js
module.exports = {
  apps: [
    {
      name: 'pignusdice',
      script: 'server.js',
      cwd: '/opt/pignusdice',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        DATA_DIR: '/var/lib/pignusdice',
      },
    },
  ],
};
```

Save in nano: `Ctrl+O`, `Enter`, `Ctrl+X`.

Start the app:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` prints one command. Copy and run that exact command. Then run:

```bash
pm2 save
pm2 status
```

## 8. Configure Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
ufw status
```

Do not block SSH, or you may lose VPS access.

## 9. Configure Nginx Reverse Proxy

Create the site config:

```bash
nano /etc/nginx/sites-available/pignusdice
```

Paste this:

```nginx
server {
    listen 80;
    server_name 74.208.242.39;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/pignusdice /etc/nginx/sites-enabled/pignusdice
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
systemctl enable nginx
```

`nginx -t` must say the syntax is OK.

Temporary test URLs:

```text
http://74.208.242.39/
http://74.208.242.39/admin.html
```

## 10. Add HTTPS Before Real Users Login

For HTTPS, point a domain to `74.208.242.39` first. Example DNS:

```text
A record: your-domain.com -> 74.208.242.39
```

Then update the Nginx `server_name`:

```bash
nano /etc/nginx/sites-available/pignusdice
```

Change:

```nginx
server_name 74.208.242.39;
```

To:

```nginx
server_name your-domain.com www.your-domain.com;
```

Reload Nginx:

```bash
nginx -t
systemctl reload nginx
```

Install Certbot:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com -d www.your-domain.com
```

After this, use:

```text
https://your-domain.com/
https://your-domain.com/admin.html
```

## 11. Admin Dashboard Check

Open:

```text
http://74.208.242.39/admin.html
```

Or after HTTPS:

```text
https://your-domain.com/admin.html
```

Login with the admin username and password from step 6.

The admin dashboard can view:

- All registered users
- User email, role, status, token balance, and account ID
- User account metadata
- Active session count and session last-seen time
- Recent games for each user
- Live rooms
- Saved game history
- Activity/events
- Total users, active users, active sessions, saved games, live rooms, and total tokens

The admin dashboard can also:

- Set a user's token balance
- Disable or enable user accounts

The admin API does not return password hashes, password salts, or session-token hashes.

## 12. Update Game Later

After pushing new code to GitHub:

```bash
ssh root@74.208.242.39
cd /opt/pignusdice
git pull origin main
npm ci
pm2 restart pignusdice --update-env
pm2 status
```

## 13. Backup Database

Create backup folder:

```bash
mkdir -p /var/backups/pignusdice
chmod 700 /var/backups/pignusdice
```

Backup:

```bash
pm2 stop pignusdice
cp /var/lib/pignusdice/database.json "/var/backups/pignusdice/database-$(date +%F-%H%M).json"
pm2 start pignusdice
ls -lh /var/backups/pignusdice
```

Restore a backup:

```bash
pm2 stop pignusdice
cp /var/backups/pignusdice/database-YYYY-MM-DD-HHMM.json /var/lib/pignusdice/database.json
chmod 600 /var/lib/pignusdice/database.json
pm2 start pignusdice
```

## 14. Useful Commands

```bash
pm2 status
pm2 logs pignusdice
pm2 restart pignusdice
pm2 stop pignusdice
systemctl status nginx --no-pager
nginx -t
tail -f /var/log/nginx/error.log
```

## 15. Troubleshooting

If the website does not open:

```bash
pm2 status
pm2 logs pignusdice
nginx -t
systemctl status nginx --no-pager
ufw status
```

If login works but multiplayer disconnects, check that Nginx includes:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

If admin login says not administrator, run the admin creation command again with the same username/email.

If GitHub asks for a password during clone or pull:

- Public repo: it should not ask; check the URL.
- Private repo: username is `AshanDevPro`; password is a GitHub Personal Access Token.
- Never use or share your GitHub account password.
