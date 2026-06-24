# PigNusDice — IONOS Ubuntu 24 Deployment Guide

> Important: this older server guide does not include the new local account database setup. Before deploying, read [SELF_HOSTING.md](SELF_HOSTING.md), create the administrator with `npm run create-admin`, set a persistent `DATA_DIR`, and enable HTTPS. User passwords must never be sent over public plain HTTP.

> **Server IP:** `74.208.242.39`
> **GitHub Repo:** `https://github.com/AshanDevPro/Dice.git`
> **Stack:** Node.js + WebSocket (`ws` package)
> **Default Port:** `3000`
> **Access Method:** Windows PowerShell → SSH

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Windows PowerShell | 5.1+ (built-in on Windows 10/11) |
| Ubuntu on Server | 24 LTS |
| Node.js | 20 LTS |
| npm | 10.x |
| PM2 | latest |
| Nginx | latest (optional) |

---

## Phase A — From Your Windows PowerShell

> Run these commands on **your local machine** before touching the server.

### A1 — Check SSH is available in PowerShell

```powershell
ssh -V
```

If you see a version number, you are ready. If not, enable it:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

### A2 — Connect to the server

```powershell
ssh root@74.208.242.39
```

Enter your IONOS root password when prompted. You are now inside the Linux server.

---

## Phase B — Inside the Server (Linux terminal via SSH)

> All commands below are run **inside the SSH session** in your PowerShell window.

### B1 — Update the system

```bash
apt update && apt upgrade -y
```

### B2 — Install Node.js (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
```

Expected: `v20.x.x` and `10.x.x`

### B3 — Install Git

```bash
apt install -y git
```

### B4 — Clone the repository

```bash
cd ~
git clone https://github.com/AshanDevPro/Dice.git pignusdice
cd pignusdice
```

> The `pignusdice` argument names the folder. This avoids path confusion if you're already inside a folder called `Dice`.

### B5 — Install dependencies

```bash
npm install
```

### B6 — Test the server manually

```bash
node server.js
```

Expected output:

```
PigNusDice server running on http://localhost:3000
```

Press `Ctrl+C` to stop it. Next step makes it run permanently.

### B7 — Install PM2 (keeps server running 24/7)

```bash
npm install -g pm2
```

Start the server with PM2:

```bash
pm2 start server.js --name "pignusdice"
```

Auto-start on reboot:

```bash
pm2 startup
```

> PM2 prints a command — **copy and run that exact command** it gives you.

Save the process list:

```bash
pm2 save
```

### B8 — Configure the firewall

```bash
ufw allow 22
ufw allow 3000
ufw enable
ufw status
```

> Port 22 = SSH. Never close this or you will lose access to the server.

---

## Phase C — Test in Browser

Open your browser and go to:

```
http://74.208.242.39:3000
```

The game should load. Share this link with other players.

---

## Phase D — Nginx Reverse Proxy (Recommended)

Removes the `:3000` from the URL so players just visit `http://74.208.242.39`.

### D1 — Install Nginx

```bash
apt install -y nginx
```

### D2 — Create the config file

```bash
nano /etc/nginx/sites-available/dice
```

Paste this exactly:

```nginx
server {
    listen 80;
    server_name 74.208.242.39;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Save: `Ctrl+O` → `Enter` → `Ctrl+X`

### D3 — Enable the site

```bash
ln -s /etc/nginx/sites-available/dice /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
systemctl enable nginx
```

`nginx -t` must print `syntax is ok` before you continue.

### D4 — Open port 80

```bash
ufw allow 80
```

Players now visit:

```
http://74.208.242.39
```

---

## Updating the Game

When you push new code to GitHub, open PowerShell and run:

```powershell
ssh root@74.208.242.39
```

Then inside the SSH session:

```bash
cd ~/pignusdice
git pull
npm install
pm2 restart pignusdice
```

---

## PM2 Command Reference

| Command | What it does |
|---------|-------------|
| `pm2 status` | Show if server is running |
| `pm2 logs pignusdice` | Live log output |
| `pm2 restart pignusdice` | Restart the server |
| `pm2 stop pignusdice` | Stop the server |
| `pm2 delete pignusdice` | Remove from PM2 |

---

## Troubleshooting

### Cannot connect via SSH from PowerShell

```powershell
# Check SSH client is installed
ssh -V

# Try verbose mode to see what fails
ssh -v root@74.208.242.39
```

### Server not starting

```bash
pm2 logs pignusdice
```

### Port 3000 already in use

```bash
lsof -i :3000
kill -9 <PID>
```

### Nginx not working

```bash
nginx -t
journalctl -u nginx --no-pager
```

### Game loads but WebSocket disconnects

Make sure Nginx config includes the `Upgrade` and `Connection` headers exactly as shown in Phase D.

### Firewall locked you out

Contact IONOS support to reset via their control panel — do not disable ufw before allowing port 22.

---

## Quick Reference

| What | Value |
|------|-------|
| Server IP | `74.208.242.39` |
| SSH command | `ssh root@74.208.242.39` |
| Game URL (with Nginx) | `http://74.208.242.39` |
| Game URL (direct) | `http://74.208.242.39:3000` |
| App directory on server | `~/pignusdice` (`/root/pignusdice`) |
| Node port | `3000` |
| PM2 process name | `pignusdice` |
