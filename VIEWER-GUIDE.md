# ARGUS — Viewer Guide

Someone is hosting an ARGUS command center and shared a link with you. You don't
need to install anything, sign up for anything, or have any keys. **Just open the
link in a normal web browser** — Chrome, Edge, Firefox, or Safari.

---

## Getting in

1. Open the link you were given. It looks like:
   ```
   http://192.168.1.42:8787/?token=aB3xYz...
   ```
   (Yours will have different numbers and a different token.)

2. That's it. The globe loads and you're looking at the same live picture as the
   host. The `?token=…` part signs you in automatically; after the first load it
   tidies itself out of the address bar, but you stay signed in on that browser.

**Tip:** bookmark the page *after* it loads — the bookmark keeps you signed in.
If you clear your browser data you'll need the original link again.

---

## What you're seeing

A 3D globe fusing live data — ships, aircraft, satellites, earthquakes, weather,
conflict news, and more. The host controls what feeds are running; you can look
around freely.

### Moving around
- **Drag** to spin the globe. **Scroll** to zoom in and out.
- **Zoomed in close**, **right-drag** tilts the camera toward the horizon so you
  can see buildings in 3D; left-drag then slides across the ground. Scroll back
  out to return to the flat map view.
- **Click** any ship, plane, or satellite to open its detail panel.
- **Double-click** an object to lock the camera onto it; double-click empty space
  to let go.
- **Click empty ocean or land** for the local weather there.

### Finding things
- The **search box** (top) finds a ship, aircraft, airport, or satellite by name,
  callsign, or ID — press Enter to fly to it.
- The **region dropdown** (top) jumps the camera to hotspots like the Strait of
  Hormuz or the Taiwan Strait.

### The panels
- **Left sidebar** — turn layers on/off (ships, aircraft, satellites…), and each
  row has a small chip to change its colour, icon, and size.
- Handy header buttons: **⛆ RADAR** (weather), **⌂ 3D** (buildings when zoomed in),
  **☾ NIGHT** (day/night shading), **⤢ MEASURE** (click two points for the
  distance between them), **⚙ UNITS** (switch between miles/km, °F/°C, etc.).
- **Alerts** appear top-right — click one to fly the camera to it.

**Anything you customize is yours alone.** Your layer colours, watchlist, and
measurements are saved in *your* browser and don't affect the host or other
viewers. Likewise, you can't change what anyone else sees.

---

## If something's wrong

| What you see | What to do |
|---|---|
| **"ACCESS TOKEN REQUIRED"** | You opened the page without the full link. Go back to the original link (the one with `?token=…`) and open that. |
| **Page won't load / spins forever** | The host's server may be off, or you're not on the right network. Check with them. If they're on a different Wi-Fi than you, they need to set up internet access (their side). |
| **Globe loads but a layer is empty** | That feed may be off or unavailable right now — the host controls which are running. Each layer row shows a small status: **LIVE**, **SIM**, **OFF**, or **ERR**. |
| **Your browser warns "not secure"** | Expected if the host is using a plain `http://` link — it just means the connection isn't encrypted. Fine on a home/trusted network. |

Everything runs through the host's machine, so if the whole thing goes dark, it's
almost always their server rather than anything on your end. A refresh (F5) fixes
most momentary hiccups.
