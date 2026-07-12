# ARGUS — Getting Started (Beginner's Guide)

This is the no-experience-required guide. It assumes you have never used a
"terminal" or run a "command" before. Follow it top to bottom and you'll have
ARGUS running in your web browser.

If a word looks unfamiliar (terminal, command, npm…), there's a plain-English
glossary at the very bottom.

**The whole process is three ideas:**
1. Install one free program called **Node.js** (you do this once, ever).
2. Open a **terminal** — a window where you type commands — inside the project
   folder.
3. Type **two commands**. Then open your web browser.

That's it. Everything below is just those three ideas in detail, plus how to add
keys later and what to do if something goes wrong.

> Throughout, look for **"On Windows"** and **"On Mac"** — do the one that matches
> your computer and ignore the other.

---

## Step 1 — Install Node.js (once)

Node.js is the engine that runs ARGUS. It's free and made by a non-profit.

1. Go to **https://nodejs.org** in your web browser.
2. You'll see a big download button. Click the one labeled **"LTS"** (it stands for
   "Long-Term Support" — the stable version). Do **not** pick the one that says
   "Current".
3. Open the file you just downloaded and click through the installer:
   - **On Windows:** it's a file ending in `.msi`. Double-click it. Keep clicking
     **Next**, accept the license, and **Install**. Click **Finish** at the end. If
     Windows asks "Do you want to allow this app to make changes?", click **Yes**.
   - **On Mac:** it's a file ending in `.pkg`. Double-click it. Keep clicking
     **Continue**, then **Install**. Enter your Mac password if asked.
4. **Restart your computer.** (Not strictly required, but it saves you from a common
   "npm is not recognized" hiccup — the computer needs to notice the new program.)

You don't need to open Node.js or find it anywhere. It works quietly in the
background when you type commands. We'll confirm it installed in Step 3.

---

## Step 2 — Put the project folder somewhere you can find it

You downloaded a file called **`sentinel.zip`**. A `.zip` is a compressed folder;
you need to "unzip" (extract) it first.

1. Find `sentinel.zip` (probably in your **Downloads** folder).
2. Unzip it:
   - **On Windows:** right-click it → **Extract All…** → **Extract**.
   - **On Mac:** double-click it. It unzips automatically.
3. You now have a folder called **`sentinel`**. Move it somewhere easy to find —
   your **Desktop** is perfect. Just drag it there.

From now on, "the project folder" means this `sentinel` folder on your Desktop.

> **How to know you have the right folder:** open it. You should see files named
> `README.md`, `package.json`, and folders named `server` and `web`. If instead you
> see *another* folder called `sentinel` inside it, go into that one — that's the
> real project folder.

---

## Step 3 — Open a terminal *inside* the project folder

A **terminal** is just a window where you type commands instead of clicking buttons.
The tricky part for beginners is opening it *in the right place* (inside the
`sentinel` folder). Here's the easiest way for each system.

### On Windows

1. Open the `sentinel` folder in File Explorer (double-click it) so you can see
   `README.md`, `server`, `web`, etc.
2. Click once in the **address bar** at the top (the strip that shows the folder
   path). It will highlight.
3. Type the word **`cmd`** and press **Enter**.

A black window opens. That's your terminal, and it's already pointing at the
`sentinel` folder. 

### On Mac

1. Open the **Terminal** app: press **Cmd + Space**, type **Terminal**, press
   **Enter**. A window opens.
2. In that window, type **`cd `** — that's c, d, then a **space**. Don't press Enter
   yet.
3. Now drag the `sentinel` folder from your Desktop **into the Terminal window** and
   let go. It pastes the folder's location for you.
4. Press **Enter**.

You're now "inside" the folder.

### Confirm Node.js is installed (both systems)

In the terminal, type this and press Enter:

```
node --version
```

You should see something like `v20.11.0` (any v18 or higher is fine). Then type:

```
npm --version
```

You should see a number like `10.2.4`.

**If instead you see an error** like *"node is not recognized"* or *"command not
found"*: Node.js didn't finish installing, or you opened the terminal before
restarting. Close the terminal, restart your computer, redo Step 1 if needed, then
try Step 3 again.

---

## Step 4 — Run the two commands

You'll be in the terminal from Step 3, sitting inside the `sentinel` folder.

### Command 1: install the building blocks

Type this exactly and press Enter:

```
npm install
```

**What it does:** downloads the pieces ARGUS needs from the internet (so you must
be online for this). **This takes a few minutes** and prints a lot of text — that's
normal.

**How to know it worked:** it stops on its own and you get your normal prompt back
(the blinking cursor waiting for input), often with a line like *"added 180
packages"*. Some **yellow** "warn" messages are completely fine and expected. Only a
**red** message containing the word **`error`** that stops everything is a problem —
see Troubleshooting if that happens.

You only ever run `npm install` **once** (and again only if you download a new
version of the project).

### Command 2: start ARGUS

Type this and press Enter:

```
npm run dev
```

**What it does:** starts the two halves of ARGUS (the "backend" and the
"frontend"). It does **not** stop — it keeps running to keep the app alive. That's
correct. **Leave this window open.**

**How to know it worked:** you'll see lines mentioning web addresses, something like:

```
web    ➜  Local:   http://localhost:5173/
server ARGUS backend on :8787
```

### Open it in your browser

Open your web browser (Chrome, Edge, Safari, Firefox — any) and go to:

```
http://localhost:5173
```

The globe appears and the layers start filling in. 🎉

> **`localhost` just means "this computer."** Nothing is on the public internet —
> you're viewing something running on your own machine.

---

## Step 5 — Using it, stopping it, and starting it again

**While you're using ARGUS, leave the terminal window open.** If you close it,
the app stops (the browser page will go blank or stop updating).

**To stop ARGUS:** click on the terminal window, then press **Ctrl + C** (hold
Ctrl, press C). On Mac it's also **Control + C** (the Control key, not Command). The
app stops and you get your prompt back.

**To start it again another day** (you do *not* need `npm install` again):
1. Open a terminal inside the `sentinel` folder (Step 3).
2. Type `npm run dev` and press Enter.
3. Open `http://localhost:5173` in your browser.

That's your everyday routine from now on: open terminal in folder → `npm run dev` →
open the browser.

---

## Step 6 — (Optional, later) Adding keys to unlock live data

ARGUS works immediately, but some layers show simulated or limited data until you
add free "keys" (like passwords that let ARGUS talk to data providers). **You can
skip this entirely and come back later.** The maritime (ships) layer is the best
first one to make live.

Keys go in a small settings file called **`.env`**. Here's the beginner-proof way to
create and edit it, using the terminal you already know how to open.

1. Open a terminal inside the `sentinel` folder (Step 3), and **stop the app first**
   if it's running (Ctrl + C).
2. Make your own copy of the example settings file by typing one command:
   - **On Windows:**
     ```
     copy .env.example .env
     ```
   - **On Mac:**
     ```
     cp .env.example .env
     ```
   (This creates a file named `.env` from the template. Nothing appears to happen —
   that's fine, it worked silently. The file lands in the `sentinel` folder, right
   next to `package.json` — that's exactly where it belongs.)
3. Open that new `.env` file in a simple text editor:
   - **On Windows:**
     ```
     notepad .env
     ```
   - **On Mac:**
     ```
     open -e .env
     ```
4. You'll see lines like `AISSTREAM_KEY=`. To turn on live ship tracking, get a free
   key from **https://aisstream.io** (sign in with a GitHub account — also free),
   copy the key, and paste it right after the `=` sign, no spaces:
   ```
   AISSTREAM_KEY=paste_your_key_here
   ```
5. **Save the file** (in Notepad: File → Save, or Ctrl + S. In TextEdit: Cmd + S).
6. Start the app again: `npm run dev`. The ships layer switches from simulated to
   live.

Which keys do what, and where to get each one, is listed in **`SETUP.md`** (the
fuller guide). The pattern is always the same: get a free key, paste it after the
matching `=` in `.env`, save, restart.

> **Good to know:** the `.env` file holds your private keys and is deliberately kept
> off the internet. Don't share it or post it anywhere.

---

## Step 7 — (Optional, later) Changing frontend settings

A few settings — like a NASA fire-map key, or pointing at your own radio receiver —
live in a different file: **`web/src/config.js`**. This is a normal file (not
hidden), so you can open it however you like:

- **On Windows:** `notepad web\src\config.js`
- **On Mac:** `open -e web/src/config.js`

Inside, you're only ever changing the text **between the quote marks**. For example,
to add a NASA fire-map key, find the line that looks like this:

```js
    MAP_KEY: "", source: "VIIRS_SNPP_NRT", days: 1, refreshMs: 30 * 60e3,
```

and put your key between the empty quotes:

```js
    MAP_KEY: "your-key-here", source: "VIIRS_SNPP_NRT", days: 1, refreshMs: 30 * 60e3,
```

Save the file. If `npm run dev` is running, the browser page reloads by itself — no
restart needed for these frontend settings. (Changes to `.env` in Step 6 *do* need a
restart, because those belong to the backend.)

---

## Troubleshooting

| What you see | What it means / what to do |
|---|---|
| **"npm is not recognized"** (Windows) or **"command not found: npm"** (Mac) | Node.js isn't installed yet, or the terminal opened before it finished. Restart your computer, confirm Step 1, then reopen the terminal. |
| **`npm install` prints red text with "error" and stops** | Usually no internet, or a flaky download. Check your connection and run `npm install` again — it's safe to re-run. |
| **The browser page is blank or says "can't connect"** | Is the `npm run dev` terminal still open and running? It must stay open. And make sure the address is exactly `http://localhost:5173`. |
| **"Port 5173 is already in use"** (or 8787) | Another copy is already running. Close any other terminal windows running ARGUS, or just restart your computer, then `npm run dev` again. |
| **The globe loads but some layers stay empty/amber** | That's expected for layers that need a key (Step 6) or that are marked SIM/STUB. The green dots are live; amber = simulated; grey = needs a key. |
| **The terminal isn't in the `sentinel` folder** (commands say "cannot find package.json") | You opened the terminal in the wrong place. Redo Step 3 carefully. To check where you are, type `dir` (Windows) or `ls` (Mac) and press Enter — you should see `package.json` in the list. |
| **I closed the terminal by accident** | No harm done. Just reopen it in the folder (Step 3) and run `npm run dev` again. |

If you get an error message you don't recognize, copy the exact text and search for
it, or ask for help and paste it in — error messages are meant to be read, and the
fix is usually a quick one.

---

## Glossary (plain English)

- **Terminal** (also "command line", "command prompt", "console"): a window where you
  type commands instead of clicking. On Windows the black `cmd` window; on Mac the
  Terminal app.
- **Command:** a line of text you type and run by pressing Enter (e.g. `npm install`).
- **Node.js:** the free engine that runs ARGUS. Installed once in Step 1.
- **npm:** "Node Package Manager" — a helper that comes *with* Node.js. It's the
  `npm` at the start of the commands; it fetches the building blocks and starts the
  app.
- **Folder / directory:** the same thing. Your `sentinel` folder is a directory.
- **localhost:** "this computer." `http://localhost:5173` is a web address that only
  works on your own machine — nothing is public.
- **Port** (the `:5173` / `:8787` numbers): like an apartment number for programs on
  your computer, so two programs don't collide. You don't need to manage these.
- **.env file:** a small private settings file holding your keys. Created in Step 6.
- **Key / API key:** a free password-like code that lets ARGUS pull data from a
  provider (like ship positions). You paste these into `.env`.
- **Backend / frontend:** ARGUS has two halves. The **frontend** is the globe you
  see in the browser; the **backend** quietly handles live data and secrets. `npm run
  dev` starts both.

---

You're done. Everyday use is just: open a terminal in the `sentinel` folder, run
`npm run dev`, and open `http://localhost:5173`. Everything else in this guide is
optional polish you can add whenever you're ready.
