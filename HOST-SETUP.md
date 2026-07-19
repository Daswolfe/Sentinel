# ARGUS — Host Setup (running the shared server)

This is the guide for **you**, the person hosting ARGUS so others can view it.
Your machine runs the backend and holds all the API keys; viewers just open a
link in their browser. Nobody else needs Node, the code, or any keys.

> New to this? The one-time install (Node.js + `npm install` + `.env`) is
> covered in **`GETTING-STARTED.md`**. Come back here once `npm run dev` works.

---

## One-time prep

1. **Have the app running in dev at least once** (`npm run dev` → globe loads).
   That confirms Node, the install, and your keys are good.

2. **Set an access token.** Open `.env` and add a long random string:
   ```
   BACKEND_TOKEN=paste-a-long-random-string-here
   ```
   Generate one in PowerShell:
   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
   ```
   Anyone with this token can view your instance, so treat it like a password.
   Without it, **anyone who can reach the port sees everything** — always set it
   before opening the firewall.

3. **Build the frontend** (once, and again after any code update):
   ```
   npm run build
   ```
   This produces `web/dist`, which the backend serves itself — no separate web
   server needed.

---

## Start the server

```
npm start
```

That runs the backend on port **8787**, serving both the UI and the live data
from one origin. Leave this terminal window open — closing it stops the server.
You'll see `ARGUS backend on :8787`.

Confirm it's healthy: open **http://localhost:8787/** on the host machine. The
globe should load exactly like the dev version.

---

## Let others reach it (same building / Wi-Fi)

1. **Find your machine's LAN address.** In PowerShell:
   ```
   ipconfig
   ```
   Look for **IPv4 Address** under your active adapter — something like
   `192.168.1.42`. That's your LAN IP.

2. **Open the firewall** for the port (run PowerShell **as Administrator**):
   ```
   netsh advfirewall firewall add rule name="ARGUS" dir=in action=allow protocol=TCP localport=8787
   ```
   (To undo later: `netsh advfirewall firewall delete rule name="ARGUS"`.)

3. **Share the link** — LAN IP + port + token:
   ```
   http://192.168.1.42:8787/?token=paste-your-token-here
   ```
   That's the whole thing a viewer needs. Hand it to `VIEWER-GUIDE.md` readers.

---

## Let others reach it from anywhere (over the internet)

Only do this if viewers aren't on your network.

1. **Forward the port on your router.** In your router admin, forward external
   **TCP 8787** to your host machine's LAN IP (`192.168.1.42` above). Every
   router's menu differs — look for "Port Forwarding" / "Virtual Server".
2. **Find your public IP**: visit `https://ifconfig.me` (or Google "my IP") on
   the host.
3. **Share** `http://<public-IP>:8787/?token=…`.

Two cautions for internet exposure:

- **Plain HTTP sends the token unencrypted.** Fine among people you trust on
  a home connection; risky over public/shared networks. For real protection,
  put a TLS reverse proxy in front — **[Caddy](https://caddyserver.com)** does
  automatic HTTPS in about two lines:
  ```
  yourname.duckdns.org {
      reverse_proxy localhost:8787
  }
  ```
  Then share `https://yourname.duckdns.org/?token=…` and forward **443** instead
  of 8787. (A free dynamic-DNS name like DuckDNS gives you a stable hostname if
  your home IP changes.)
- **Your home IP may change.** Dynamic DNS (DuckDNS, No-IP) keeps the link stable.

---

## What's already protecting you

These are on by default — no action needed, but good to know the knobs (all in
`.env`):

| Guard | Default | Env var |
|---|---|---|
| Access token on every request + the websocket | required once set | `BACKEND_TOKEN` |
| Per-IP request cap (per minute) | 300 | `RATE_LIMIT_PER_MIN` (0 = off) |
| Max simultaneous websockets per viewer | 4 | `WS_MAX_PER_IP` |
| Shared upstream cache | on | — (N viewers cost ~1 viewer's API quota) |
| Behind a reverse proxy? read real client IPs | off | `TRUST_PROXY=1` |

Your keys never leave the server — viewers only ever talk to your backend, which
makes the upstream calls on their behalf.

---

## Keeping it running

- The server runs as long as the `npm start` terminal is open. Closing the
  window, logging out, or sleeping the machine stops it.
- To run it without a babysitter terminal, install **PM2** once:
  ```
  npm install -g pm2
  pm2 start "npm start" --name argus
  pm2 save
  ```
  `pm2 stop argus` / `pm2 restart argus` to control it; `pm2 logs argus` to watch.
- After pulling code changes: `npm install` (if dependencies changed) →
  `npm run build` → restart (`pm2 restart argus`, or Ctrl-C and `npm start`).

---

## Quick troubleshooting

| Symptom | Fix |
|---|---|
| Viewer sees "ACCESS TOKEN REQUIRED" | They opened the link without `?token=…`, or with the wrong token. Re-send the full link. |
| Viewer's page won't load at all | Firewall rule missing, wrong IP, or the server isn't running. Confirm `http://localhost:8787/` works on the host first, then the firewall rule, then the IP. |
| Works on LAN, not from outside | Port-forwarding not set (or ISP blocks inbound) — see the internet section. |
| Globe loads but no ships/aircraft | That's about your **keys** in `.env`, not the sharing setup — see README "Going live". |
| Slow with several viewers | Each viewer streams the AIS websocket. Use **Region Focus** to shrink the picture, or lower `broadcastMs` in `server/config.js`. |
