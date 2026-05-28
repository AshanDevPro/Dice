# PigNusDice — Hosting & Online Play Guide
## Deploy to Railway (Free, No VPS Needed)

Railway runs your Node.js server for free — no server management, no SSH, no VPS.

---

## 1. Put Your Code on GitHub

1. Go to **github.com** and create a free account if you don't have one
2. Click **New repository** → name it `pignusdice` → click **Create repository**
3. Download and install **GitHub Desktop** from desktop.github.com
4. Open GitHub Desktop → **Add Existing Repository** → point it to `F:\Webgames\Dice`
5. Click **Publish repository** → uncheck "Keep this code private" if you want free tier → **Publish**

---

## 2. Add a Railway Config File

Add this file to your project so Railway knows how to start the server.

Create `F:\Webgames\Dice\railway.toml` with this content:

```toml
[deploy]
startCommand = "node server.js"
```

Go back to GitHub Desktop → you'll see the new file → write a commit message → **Commit** → **Push origin**

---

## 3. Deploy on Railway

1. Go to **railway.app** and sign in with your GitHub account
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `pignusdice` repository
4. Railway automatically detects Node.js and deploys — takes about 1 minute
5. Click your deployment → go to **Settings** → **Networking** → click **Generate Domain**
6. You'll get a free URL like `pignusdice-production.up.railway.app`

---

## 4. Point PigNusDice.com to Railway

1. In your IONOS control panel go to **Domains & SSL → PigNusDice.com → DNS**
2. Add a **CNAME record**:
   - Name: `@` (or leave blank)
   - Value: your Railway domain e.g. `pignusdice-production.up.railway.app`
3. Save — DNS propagates in 15–30 minutes

---

## 5. Update the WebSocket URL in the Game

Once you have your Railway domain, update the default server address in [js/multiplayer.js](js/multiplayer.js) line 14:

```js
serverUrl: 'wss://pignusdice-production.up.railway.app',
```

Note: use `wss://` (secure) not `ws://` when the site is on a real domain.

Commit and push that change — Railway redeploys automatically within seconds.

---

## 6. Future Updates

Whenever you change game files:
1. Make your changes in VSCode
2. Open GitHub Desktop → commit the changes → **Push origin**
3. Railway redeploys automatically — no manual steps needed

---

---

## How to Play Online (Step-by-Step for Players)

### Host (the person starting the game)

1. Open **http://PigNusDice.com** in a browser
2. Enter your name
3. The Server field should already be filled in — leave it as-is
4. Tap **CREATE ROOM**
5. You'll see a **4-letter room code** (e.g. `AB3X`) — share this with friends
6. Wait for friends to join — their names appear in the list
7. When everyone is ready, tap **START GAME**

### Guest (joining an existing game)

1. Open **http://PigNusDice.com** in your browser
2. Enter your name
3. Tap **JOIN ROOM**
4. Type the **4-letter code** the host gave you
5. Tap **JOIN** — you'll appear in the host's player list
6. Wait for the host to start

### During the Game

- **Your turn**: your board lights up — Roll, select dice to keep, Lock, then End Round
- **Others' turns**: watch opponent cards update with their locked dice in real time
- **Betting**: use Check / Call / Raise / Fold between turns
- Rounds auto-advance after results are shown
- If someone disconnects they are folded for that round

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Room not found" | Check the 4-letter code — must match exactly |
| Can't connect | Make sure the Server field starts with `wss://` on a live domain, `ws://` locally |
| Railway deploy fails | Check the **Logs** tab in Railway — usually a missing `package.json` or typo in `server.js` |
| Domain not working yet | DNS can take up to 30 min — use the Railway URL directly in the meantime |
| Game works locally but not live | Confirm you changed `ws://` to `wss://` in multiplayer.js |
