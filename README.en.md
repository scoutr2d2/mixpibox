# MixPiBox

*Deutsche Fassung: [README.md](README.md)*

<img src="NewDesign/bilder/mixpi-hoert.png" alt="A MixPi with headphones" width="160" align="right">

**A music box for children on a Raspberry Pi.** Touchscreen, speaker,
no keyboard. A child taps a cover, and it plays — from Spotify, from
Jellyfin, from the disk, from a media library or from a radio stream.

> **This is a hard fork of [MuPiBox](https://mupibox.de) by *splitti* and *nero*.**
> Compatibility with the original is broken on purpose and is not being restored.
> If you are looking for the original project, go to
> **https://github.com/splitti/MuPiBox** — not here.
> This file is the English edition; the German README.md is the primary one
> (see *Why the German file leads* at the bottom). Credits and license of the
> original are kept below.

![Der Kinderschirm](screenshots/01-kinderschirm.png)

---

## 1. This is a fork — and what that means

The MixPiBox is a fork of the [MuPiBox](https://mupibox.de) by
*splitti* and *nero*; the own work starts on 23.07.2026 from a state
around upstream 4.2.4. **The fork is hard:** compatibility with the origin is
not pursued and is broken (BACKLOG.md, section *Fork-Status*).
Maintenance and breakage are handled here.

| | |
|---|---|
| **You want a finished music box with releases and a community** | → https://mupibox.de |
| **You are looking for this fork** | → You are in the right place. No support, no releases — but an **installation guide from scratch** (section 5). |

The origin now runs two lines — **Classic** (release 5.0.1 from
21.09.2026) and the announced, not yet published **NG**. This fork is
neither of them, but a separate rebuild from the same idea. What NG
announces and what does not exist here: RFID, buttons as a control path, an app. What
exists here is listed in section 3; the comparison in section 4 measures against the
state at the fork point, not against Classic 5.

Bugs in this fork belong in this repo — not in the channels of the origin,
whose people have never seen this code.

---
## 2. What was added most recently

From the commit log, not from memory. Which of this is half-done is in 3.9.

* **21.09.** Messages to the child — only from senders on the list, shown
  where the child is looking.
* **20.09.** A **network share** (SMB or WebDAV) as storage for backups
  and recordings, with a certificate warning instead of silently waving it through.
* **20.09.** **Reward videos**: a page where parents let videos be earned;
  the core keeps a ledger per child; a 25-minute video can be cut into
  pieces. Plus the **second media library** (ZDF, KiKA, 3sat, arte, funk).
* **20.09.** The **game corner** has four games instead of one, parents enable
  each one individually, and the game voice announces cards and colors. A tap on
  the clock says the time.
* **20.09.** The box is **discoverable** on the network (`<name>.local`) — on two of
  the three rollout paths; the monolith lags behind.
* **20.09.** Start mode: **continue on power-on** instead of asking, without
  skipping the lock.
* **06.09.** **Remote control and Xbox controller** drive the box — exclusive
  grab on the input device, device profiles with schemes, the game corner on the
  Share button. Merging becomes the default.
* **05.09.** The **stage** above the play buttons: lyrics that scroll along (LRCLIB),
  a toggle in the player and a button on the controller.
* **August:** profiles with a lock, child time per child, play statistics (since
  15.08.), recording from Spotify, systemd instead of pm2, covers on the box, the
  plugin system with an admin (Verwaltung) area.

---
## 3. What the box can do

Everything here is read off the codebase or measured on the device, not promised.
What is only half there is in 3.9 — and only there.

### 3.1 For the child — the screen

* **Tiles instead of text.** Tap a cover, it plays. Whoever cannot read still
  gets everywhere.
* **Sources side by side:** Spotify (librespot or Soloist, the official client),
  Jellyfin, files on the box, radio streams, podcasts, Archive.org, Subsonic
  and the **media libraries** of ARD, ZDF, KiKA, 3sat, arte and funk. Everything
  outside the core is a **plugin** (section 7).
* **The same album from several services becomes ONE tile.** Since
  06.09.2026 this is the default: measured on the device, 44 tiles became 35 —
  nine works sat twice on the shelf, one six times. Title, artist and image
  are assembled by the box field by field (Spotify → Jellyfin → local); **playback**
  goes in the reverse order (local → Jellyfin → Spotify), so an
  outage does not strike through. Merging happens only at the push of a button, every
  merge can be split individually, and a split pair stays split.
* **Resume listening** — "where did I leave off?", the question nobody else
  answers. Plus **artist pages**: all albums of an artist, not
  just the ones that happen to be in a playlist.
* **The stage above the playback buttons** has four states: off · waves ·
  **lyrics** (scrolling song text with time marks, source LRCLIB via a
  plugin) · album title. Default is *off*. For audio plays there is
  usually no text — that is the normal case and is reported as such
  (measured 05.09.2026: pop 5/5, children's song 3/5, audio play 0/5).
* **Read aloud.** A tap on a tile reads the name aloud, in **learning mode**
  syllable by syllable. Computed on the box (Piper), without network — but see
  the limitation in 3.9.
* **Profiles.** Up to twelve children, each with name, character, birthday and
  their own stores (history, resume, lists, media selection, appearance,
  video approvals, time used). Sign-in works without a keyboard: a
  "Who's listening?" window with large character tiles, optionally with a lock made of
  characters, digits, colour dots, a pattern or **pictures** — checked on the server
  (bcrypt), with growing wait time against trial and error. The **guest** is
  a switchable account; as long as it is on (default), the box starts without
  asking.
* **Appearance:** colour sets, five freely selectable colours, light/dark — per profile.
* **Three display places** for the same track: the pillow at the bottom edge, the
  expanded player and the full-format cover.
* **The parents' area** sits behind a long press and a number gate, so
  nobody opens it by accident — the essentials directly on the box, everything
  else in the admin (Verwaltung) (3.3).

![Der große Spieler](screenshots/02-spieler.png)
![Der Eltern-Bereich an der Box](screenshots/04-eltern.png)

### 3.2 Playing and learning

Two separate places to play, and that is intentional: the **drawer** on the touchscreen
(for the finger) and the **game corner** in full screen (for D-pad or
controller, see 3.7).

| Place | Game | What the child practises |
|---|---|---|
| Drawer | **Memory** | Remembering; four game modes, also for two players — playable without a single track (6 bundled card sets, 53 CC0 images from museums) |
| Drawer | **Puzzle** | Spatial thinking; 3×3 sliding puzzle from a cover of the own library, shuffled with real moves (a randomly rolled board would be unsolvable every second time) |
| Drawer | **Maths** | Mental arithmetic up to 10, plus and minus, three answers to choose from — recognising digits is enough |
| Drawer | **Clock** | Reading the time (full and half hours, "halb 4" = 3:30); a tap reads the answer aloud |
| Drawer | **Reading** | First reading: one word large, read aloud syllable by syllable on tap — the words are the titles of the own library |
| Drawer | **Painting** | Nothing. The only app without right and wrong — for the child that does not want a task right now |
| Game corner | **Snake** | Hand-eye coordination, steering ahead |
| Game corner | **Pairs** | Remembering and, with game voice, vocabulary — the box announces every card |
| Game corner | **Three in a row** | Rules, thinking ahead, being able to lose |
| Game corner | **Remember colours** | Memory span and colour words |

Parents switch **each game individually** on and off (admin → Games), plus
the whole game area and the game voice. All ten run **without network**.

![Die Schublade mit den Apps](screenshots/03-schublade.png)
![Die Spiele-Seite der Verwaltung](screenshots/13-verwaltung-spiele.png)

### 3.3 For the parents — the admin under `/admin`

27 pages plus login, with a **search across all settings**. It is
the only admin of the box — the inherited PHP admin was removed on 19.08.2026.

![Die Verwaltung](screenshots/10-verwaltung.png)

| Area | Pages |
|---|---|
| What is there | Profiles · Media · Streaming services · Recording |
| What one sees and hears | Appearance · Read aloud · Videos · Games |
| What the box is | Configuration · Network · VPN · Network drive · Messages · Bluetooth · Sound · MuPiHAT · Plugins |
| When something is stuck | System services · System · Performance · Logs · Update · Backup |


The table shows the header bar; on top of that come the overview and three
subpages (Doppelte, Interpreten, Erweiterung) reached from their parent page.

![Die Profilseite](screenshots/12-verwaltung-profile.png)
### 3.4 Sound

Sound runs through PipeWire along a chain of two skippable stations:
**Sources → Sound engine (Klangwerk) → Equalizer → Target**.

* **Several Bluetooth sinks at once.** The combined sink "Everywhere" (Überall)
  plays on all connected speakers at the same time, the built-in one may join
  in, and per device you can tick whether it comes along. PipeWire aligns the
  latencies; in addition, an offset of 0–1000 ms can be adjusted per speaker.
* **Five-band equalizer** as its own filter chain (shelf 100 Hz, bells
  250/1000/4000 Hz, shelf 10 kHz), adjustable at runtime, with a computed
  frequency response and a clipping warning from +1 dB in the admin (Verwaltung).
  **It does not calibrate anything automatically** — there is no auto-EQ.
* **Sound engine** in front of it: **stereo width/spread** (100 = unchanged
  down to 0 = mono — the lever against sideways-radiating speakers that no
  equalizer offers), high-/low-pass, shelves, pre-gain, **compressor and
  limiter** against the jump from a whisper to a bang and to protect the 3-W
  drivers. The chain is described by sound plugins from a closed list — no
  free-form PipeWire text.
* **Volume per source** (Spotify, mpv, browser) and **per output**, plus a
  maximum level and a pinned level per Bluetooth speaker; a guard restores both
  after a reconnect and a restart.
* **Music steps back** while something is being read aloud (everything except
  the voice at 45 % — quieter instead of pausing).
* The target is the built-in MuPiHAT amplifier (MAX98357A over I²S, **not**
  hifiberry), a specific Bluetooth speaker, or "Everywhere".

![Die Ton-Seite](screenshots/14-verwaltung-ton.png)

### 3.5 Time, reward, statistics — and without network

* **Kids' time.** Per weekday free or locked, a time window from–to and a
  daily duration in minutes. Deciding and counting happen **server-side**;
  only what actually sounds is counted. At the end the running title may finish
  for up to five more minutes, then the box stops on its own. Parents can gift
  minutes for today or reset the day. A broken configuration does **not** lock
  out, it is bent toward the friendly side.
* **Reward videos.** Parents approve individual Mediathek videos, with a
  count; the child sees only what has been approved — no search, no browsing.
  A video is used up only at around 90 % watched; aborting costs nothing. A
  video can be cut into **pieces**, each with its own counter. Video time is
  **not** deducted from the listening allowance.
* **Playback statistics.** What played when, for how long and via which
  service — measured by the heartbeat of the UI, not from start to stop. Period
  today/7/30/365 days, per child or across all. Has been recording since
  15.08.2026; there are no numbers retroactively, and the page says so.
* **Boot statistics.** The "Performance" (Leistung) page shows kernel and
  userland startup duration, the ten biggest slowdowns and a timeline of the
  boot. These are the numbers of the **last** boot, not an average over several.
* **Without network** the box stays usable: a service swaps the media list for
  a filtered one (Spotify, radio, podcasts and the ARD Audiothek drop out, local
  files and Jellyfin stay), the **covers live on the box** (measured 1.69 s cold
  → 0.03 s afterwards), and the box speaks the announcements itself.

![Belohnungs-Videos und Aufnahmen](screenshots/15-verwaltung-aufzeichnen.png)

### 3.6 Recording

The plugin `mixpi-mitschnitt` taps the sound at the PipeWire node of the
Spotify player and stores it as FLAC in the media folder — the recording
becomes a perfectly normal local tile. Instead of recording passively, the box
**earmarks** titles that were started and records them in full later while
idle.

This is explicitly a **test feature**: off by default, a separate switch per
service, and without a second checkbox on the legal situation nothing records
at all. Today only Spotify can be recorded. See also 3.9.

### 3.7 Operating without touch — remote control and controller

The box can be operated via paired **Bluetooth input devices** without
touching the screen. A
dedicated service reads `/dev/input/event*` with the Python standard library,
**without X and without the kiosk browser**, and grabs the device exclusively
(otherwise Chromium swallows the keys).

* Four device profiles: **Fire TV** (Alexa remote and Basic), **Google TV
  /Chromecast** and the **Xbox Wireless Controller** — the latter measured on
  the actual device (06.09.2026). The bundled mapping covers Fire TV and the
  controller; Google TV is mapped by hand (3.9).
* 16 box actions with a stable identifier (play/pause, track change, stop,
  louder/quieter, up/down/left/right, select, home, back, shut down, advance
  the stage, open the game corner).
* Shipped controller mapping: A = select, B = back, X = play/pause, Y and
  Menu = home, LB/RB = track change, View = next stage, **Share = open the game
  corner** (the only way to get there).
* Recognition is by **name**, never by the event number — that one is
  different after every reconnect. Debouncing is separate: buttons 250 ms, axes
  50 ms.
* **Limit:** only *one* device controls at a time, and a new device is
  assigned by hand today (see 3.9).
### 3.8 Under the hood

* **Two backends in TypeScript:** `src/backend-api` (media, configuration,
  admin (Verwaltung), serves the user interface, port 8200, 142 test files) and
  `src/backend-player` (mpv for local/Jellyfin, Spotify control, port 5005,
  15 test files).
* **42 systemd units** in `config/services` (35 `.service`, 6 `.timer`,
  1 `.path`) — instead of pm2. The app is ready 20 s earlier as a result.
* **14 plugins** in the tree, in their own worker threads with memory and
  time limits (section 7).
* **Backup** with a way back that needs no SSH: a text file on the FAT
  partition of the card is enough.
* **Messages to the box** (Matrix, Signal, Telegram) and an MQTT service for
  Home Assistant — inherited and in operation.

### 3.9 What is half finished

So that nobody builds on it — the long version is in
`dokumentation/mixpibox.md`, section 9:

* **Read-aloud does not make it onto every card.** Only
  `autosetup/autosetup.sh` and the update path set up Piper; the one-button
  path described in section 5 does **not** — a box written that way falls back
  to the browser voice (espeak-ng).
* **The recording's null sink is installed by no rollout path**
  (`config/templates/62-mixpi-mitschnitt.conf` is in none of the three paths).
  On a freshly set-up box it is missing; recording needs it.
* **Screen-time (Kinderzeit) rules per child** — the server has long been able
  to do them (house rule plus exceptions per profile), but the admin page still
  writes only the house rule. Account, bonus and reset already work per child.
* **Login only takes effect with the guest switched off.** As long as the
  guest is on — the default — the box starts silently in the last active
  profile, and the start mode has no effect.
* **Assigning a new input device is manual work.** The admin page for it is
  missing; two routes and the SVG schematics are ready.
* **Remote and controller are missing on the recipe path.** The recipes create
  neither `/etc/mupibox/fernbedienung.json` nor the device profiles and do not
  enable `mixpi-fernbedienung.service` — only `autosetup.sh` and the update
  path do. On a card from 5.4 both have to be added by hand.
* **The setup wizard** for the very first start (QR, own Wi-Fi, page for the
  phone) exists as a scaffold but is not wired up yet.
* **The admin** has witnesses for the login path, screen time, search and a
  few more pages — far from every page. The box UI has behaviour tests for the
  playback path and states, **not** for the appearance.
* **The volume jump when switching sources** is real and not compensated:
  local files run through ReplayGain, Spotify does not.

---
## 4. What this branch does differently

The comparison is against the state it branched off from (upstream 4.2.4,
05.05.2026) — not against Classic 5, which has gone its own way since 20.09.2026.
The third column is the important one: it forces half-finished things to be
named as half-finished, instead of leaving them out (then they are missing) or
counting them in (then the list lies).

| What | Where | Status |
|---|---|---|
| **A new box interface** — pure HTML/CSS/JS, no bundler, no dependency, no external address. Served under `/neu/`. | `NewDesign/` (around 50 000 shipped lines) | in use |
| **ONE box interface.** The trial switch went with E118/1d, the old Angular/Ionic interface was **deleted** with E118/1e on 05.09.2026; the kiosk loads `/neu/` fixed. Only one straggler module plus `LIESMICH.md` remains in `src/frontend-box/`. | `scripts/chromium-autostart.sh`, catch-all in `src/backend-api/src/server.ts` | done |
| **New admin (Verwaltung)** in Angular, 27 pages + sign-in, under `/admin`, with search across all settings. | `src/frontend-admin/` | replaces the PHP admin (removed 19.08.2026); witnesses for the sign-in path, screen time, search and a few more pages |
| **Backends in TypeScript** instead of grown JS/PHP. | `src/backend-api/` (142 test files), `src/backend-player/` (15) | in use |
| **Profiles for several children** — up to twelve, with character, birthday, lock in five input modes and own storage per child. | `src/backend-api/src/profile.ts`, `NewDesign/app.js` | done; sign-in only takes effect with guest switched off (3.9) |
| **Kinderzeit** — how long, when and on which days; counted server-side, not in the browser. | `src/backend-api/src/kinderzeit.ts` | done; per-child rules: the server can, the admin cannot yet (3.9) |
| **Reward videos** — parents release individual Mediathek videos, in pieces, with a counter. | `NewDesign/video.js`, admin page „Videos" | done |
| **Games and learning** — six apps in the drawer, four games in the game corner, each individually switchable off. | `NewDesign/apps.js`, `NewDesign/app.js`, `src/backend-api/src/spiele.ts` | done |
| **Control via remote/controller** — four device profiles, 16 actions, without X. | `scripts/box/fernbedienung.py`, `config/fernbedienungen/` | done; the mapping page is missing (3.9) |
| **Merging of several sources** — the same album from Spotify *and* Jellyfin becomes ONE tile, the default since 06.09.2026. | `src/backend-api/src/verschmelzung.ts` | done, measured on the device (44 → 35 tiles) |
| **Artist pages** and **Continue listening** — all albums of an artist; „where did I leave off?". | `src/backend-api/src/interpretenseite.ts`, `weiterhoeren.ts` | done, tested |
| **An audio chain you can adjust** — several Bluetooth sinks at once, five-band equalizer, stereo width, compressor/limiter, volume per source. | `config/templates/61-entzerrer.conf`, plugin `mixpi-klang`, admin page „Ton" | done; no auto-EQ, loudness between the services still open (3.9) |
| **Covers live on the box.** Measured: 1.69 s cold → 0.03 s afterwards. | `src/backend-api/src/server.ts` (`coverspeicher`) | done (Classic has this too since 5.0.0) |
| **systemd instead of pm2** — ready 20 s earlier; on **all** paths since 14.08.2026. | `config/services/` | switched over |
| **A plugin system** — everything beyond the core is a plugin, no build step, in its own worker thread. | `plugins/` (14 of them) | in use; a dedicated area in the child screen is deliberately missing (section 7) |
| **Own installation path** — the old monolith froze at ~69 %, with no way to abort. Replaced by a step-by-step remote installer that has lived **in this tree** since 08.08.2026 ([ZUGEZOGEN.md](ZUGEZOGEN.md)). | `remote-step-installer/` | in use; `autosetup/autosetup.sh` lives on alongside it, and `scripts/make-boot-sd.sh` has, since 23.09.2026, packed only what autosetup reads — 14 MB instead of 164, librespot included (until then it excluded `bin/librespot`, on which autosetup now aborts hard) |

### The base system — at the fork point and today

Measured against the fork point's `autosetup/autosetup.sh` (upstream 4.2.4, 605
lines) and against today's recipes:

| Building block | Origin 4.2.4 | MixPiBox today |
|---|---|---|
| Operating system | DietPi | DietPi on Debian 13 „Trixie" |
| Node.js | 22 (nodesource) | **26** (nodesource) |
| Processes | pm2 | **systemd**, 42 units |
| Audio system | PulseAudio | **PipeWire + WirePlumber**, LADSPA stages |
| Player local/Jellyfin | mplayer | **mpv** |
| Spotify | librespot (development state 0.6, 08/2025) | **librespot 0.8.0** or **Soloist** |
| Admin | PHP on lighttpd | **Angular**, served by the Node backend |
| Child interface | Angular/Ionic, with build step | **HTML/CSS/JS** without bundler |
| Kiosk | Chromium | Chromium, **Cog/WPE** as an option |
| Installation | one monolith script | **Recipes**, step by step; self-run from the card |
| Speech output | — | **Piper** on the box |
| Extensions | — | **Plugin system**, 14 plugins |

### Measured — what the rebuild delivered

All figures on the device, with date; spread between two identical starts around
one second. The measurements are in the knowledge pack
(`mupi-startzeiten-gemessen`, `mupi-boot-32s-auf-13s`,
`grundmessung-zeit-bis-zum-bild`).

| What | before | after | Device, date |
|---|---|---|---|
| **App ready** (backend answers on :8200) | ~23.5 s with pm2 | **3.3 s** with systemd | Pi 4 and Pi 5, 29.07.2026 |
| **Boot** (kernel + userspace), Pi 4 | 31.8 s | **~15 s** | 29.07.2026 — the DHCP fallback alone cost 18 s |
| **Boot**, Pi 5 | 18.2 s | **13.4 s** | 29.07.2026 |
| **Window up**, Pi 4 | 34.9 s | **25.1 s** | 29.07.2026 |
| **Cover load** | 1.69 s cold from the network | **0.03 s** from the box | cover store |
| **Kiosk memory** (PSS) | Chromium + X: 458–540 MB depending on the moment | **Cog: 331 MB** (−180 to −230 MB) | Pi 5, 19.09.2026 |
| **Time to picture**, cold start Pi 5 | — | 19–24 s, of which 4–9 s waiting for DHCP | 04.08.2026 |

What did **not** get better is stated honestly alongside: the roughly 9 s that
Chromium needs from process start to the finished picture are real work and
remain; and the volume jump between the services is not evened out
(3.9).

---
## 5. Installation from scratch

> **No guarantee.** This fork has no support (section 1). This guide
> describes the path the maintainer takes himself — it is no promise
> that it will run through on someone else's hardware.

### 5.1 What you need

**On the device:**

* **Raspberry Pi 5** or **Pi 4** (both arm64). DietPi knows no "RPi4" —
  the image for Pi 2/3/4/Zero 2 is called `RPi234` there; the installer picks it
  itself.
* **SD card** (the boot partition must hold the installation package:
  measured 13.8 MB with 94 MB free).
* **DSI touchscreen 800 × 480.** This resolution is the default for every
  image created on the box.
* **Sound:** MuPiHAT (MAX98357A via I²S — *not* hifiberry) or a
  Bluetooth speaker.

**On the computer that writes the card:** Python 3 with Tkinter, **PyYAML**
(more on that shortly), administrator or root rights and network.

### 5.2 Step 1 — get the repo

```bash
git clone https://github.com/scoutr2d2/mixpibox.git
cd mixpibox
```

**The path is arbitrary.** The recipes fetch the app's files from
`${MUPI_REPO:-$HOME/Downloads/mixpibox}`, and the installer finds the folder
itself: it lives *inside* it (`remote-step-installer/` is part of this tree).
The search order is — `--fork <pfad>`, `$MUPI_REPO`, the installer's
parent folder, `~/Downloads/mixpibox`, `~/mixpibox`, last
`~/Downloads/MuPiBox` —, and the first one that really looks like this
repo (`config/templates/…`, `scripts/`, `plugins/`) is taken. Which one it was
is stated by the log when writing the card.

This applies to **both** paths: the written card and the remote-controlled
run. Whoever wants a different folder sets `export MUPI_REPO=…` — it wins, provided
the folder looks like the fork; otherwise the log says it was passed over.

### 5.3 Step 2 — is the package as new as the tree?

The app comes to the card as a checked-in `bin/nodejs/deploy.zip`. That is
a **hand-built** artifact: a fresh card carries the state of the
last build, not that of the tree.

```bash
python3 tools/mixpi-paketfrische-pruefen.py   # meldet, wie viele Commits fehlen
bash src/deploy.sh                            # baut es neu, wenn es hinterherhinkt
```

### 5.4 Step 3 — write the card

```bash
cd remote-step-installer
./sdstart                 # Linux/macOS
./sdstart --board RPi4    # Board vorwählen — überspringt auch WLAN und Name (nur am Kabel)
./sdstart --probe         # nur ansehen: Attrappen-Karte, kein Netz, kein Schreiben
```

Windows: `sdstart.cmd` **with the right mouse button → "Run as
administrator"** (see 5.6).

Seven pages, each already filled in: Welcome · Which Pi · Wi-Fi · Name and
password (default `mixpi` / `mupibox`) · the card · it's running · done. Set
and not asked: **DietPi Trixie** (not "the latest") and a screen
that is on from the first boot.

![Der SD-Assistent](screenshots/24-sd-karte.png)

Before writing there is **one** confirmation prompt. Only removable drives are
offered; if several are plugged in, the button stays locked. Nothing has to be
typed, the erasing button is red, says what it does, and is **not** the
default one.

![Die Rückfrage vor dem Löschen](screenshots/25-sd-rueckfrage.png)

Whoever wants more control (image, hostname, phone setup, individual checkboxes)
uses `./sdgui` (graphical) or `./sdtui` (terminal).
### 5.5 Step 4 — setting up the box

**The normal case: it does it itself.** The card carries the recipe as JSON
plus all the files (30 + 24 steps from `recipes/mupibox.yaml` and
`recipes/mupibox-app.yaml`). Insert the card, apply power — the run survives
the reboots that are in the recipe, writes its state to disk before every step
and **stops** when a step fails, instead of carrying on half finished.

**The remote-controlled way** (if PyYAML was missing, something is stuck or you
want to watch): a controller on the laptop drives the box step by step, every
step abortable, repeatable, skippable.

```bash
cd remote-step-installer
./setup-controller.sh                                   # holt, was dem Controller fehlt
scp -r agent dietpi@<box-ip>:/tmp/                      # Agent hinbringen …
ssh dietpi@<box-ip> 'sudo bash /tmp/agent/install-agent.sh'   # … er zeigt den Pair-Code
ssh -N -L 8099:localhost:8099 dietpi@<box-ip> &         # Tunnel
./tui --recipe recipes/mupibox.yaml --pair <CODE>       # TUI …
./stepctl --recipe recipes/mupibox.yaml --pair <CODE>   # … oder CLI
```

The agent is pure Python 3 stdlib (no pip), runs as root, accepts commands only
after a six-digit pair code, listens on localhost and **removes itself** when it
is done. Then the same with `recipes/mupibox-app.yaml` for the app and
optionally `recipes/perf-tune.yaml` for start-up time and memory.

### 5.6 Does this run on Windows?

**Writing the card: yes.** The path is built deliberately, not runnable by
accident — Windows ships neither `dd` nor `xz`, so the installer unpacks and
writes itself (`lzma` from the standard library, raw to
`\\.\PhysicalDriveN`, only in whole sectors — odd lengths otherwise end in
`ERROR_INVALID_PARAMETER`). It finds the cards via PowerShell `Get-Disk`
instead of `lsblk`, and the FAT partition gets a drive letter instead of
being mounted.

| | Windows |
|---|---|
| `sdstart.cmd` / `sdgui.cmd` | **yes** — check for administrator rights themselves and find Python via `py` or `python` |
| Write card, populate boot partition | **yes**, own branch in the code |
| Take over Wi-Fi + key automatically | **no** — that is read by `nmcli`, so Linux only. On Windows type it in by hand |
| Installation package for the self-run | **only with `pip install pyyaml`** — otherwise the card is written without it, and the remote-controlled way remains |
| Clone path ≠ `~/Downloads/MuPiBox` | **yes** — the installer finds the folder itself (see 5.2) |
| Remote-controlled run (`./tui`, `./stepctl`, `./connect`) | **not set up** — the launchers are bash, and the path requires an SSH tunnel |

**Only half of this is measured:** the pure parts of the Windows branch have
tests (`tests/geraete_test.py`, 35 green); nothing so far records a real run
on a Windows machine.

### 5.7 Step 5 — the first start

* `http://<box>:8200/neu/` — the child screen (the kiosk shows it itself),
* `http://<box>:8200/admin` — the admin (Verwaltung): sign in streaming
  services, create media, set child time, configure sound and screen.

If the Wi-Fi is not up, the box is mute and blind. For that there is the
self-diagnosis via the card (llmwiki `mupi-wlan-selbstdiagnose-per-karte`)
and the way back without SSH (`sicherung-rueckweg-ueber-die-karte`).

---
## 6. Project structure

```
NewDesign/             die Box-Oberfläche (HTML/CSS/JS, kein Bau-Schritt)   → /neu/
src/frontend-admin/    die Verwaltung (Angular)                             → /admin
src/backend-api/       Medien, Konfiguration, Verwaltung; liefert aus       (:8200)
src/backend-player/    Abspieldienst: mpv für lokal/Jellyfin, Spotify       (:5005)
src/frontend-box/      Rest der gelöschten Angular-Oberfläche — siehe LIESMICH.md
plugins/               14 Erweiterungen, Musterplugins, Prüfstand, Anleitung
remote-step-installer/ Karten schreiben und Boxen aufsetzen (Abschnitt 5)
autosetup/             der alte Monolith — zweiter, noch lebender Frisch-Karten-Weg
update/                der geerbte Update-Weg (verriegelt: er führte zurück zum Original)
config/                42 systemd-Einheiten, 26 Vorlagen, 4 Fernbedienungs-Profile
scripts/               was auf der Box läuft: MuPiHAT-Monitor, Lüfter, Kiosk,
                       Fernbedienung, Touch-Brücke, librespot-Wächter (Python/Shell)
bin/                   mitgelieferte Binärstände: librespot (arm64), fbv,
                       und deploy.zip — das fertig gebaute App-Bündel
media/                 Systemmedien der Box: Startbild, Logo, Start-/Abschalttöne
harness/ · mupictl ·   die Entwicklungs-Simulation: der ganze Stapel ohne Pi
docker/ · Dockerfile   und ohne MuPiHAT auf dem Entwicklungsrechner
dokumentation/         die eigene Doku: die Karte mixpibox.md, das Benutzerhandbuch
documentation/         geerbte Fremdanleitungen des Ursprungs (nicht gepflegt)
llmwiki/               das Wissenspaket: Fallen, Messungen, Entscheidungen
tools/                 über 560 Werkzeuge: messen, ohne Box ansehen, Wachen
screenshots/           die Bilder dieser README (erzeugt, siehe Abschnitt 8)
.github/workflows/     die fortlaufende Integration (Lint · Tests · Bau)
```

Not every folder on the disk belongs to the project: `AdminInterface/`,
`server/` and `src/deploy/` are leftovers of a machine and are not versioned.
**The tree is what `git ls-files` says.**

---

## 7. The Plugin Structure

**Everything beyond the core is a plugin.** A plugin is a folder
`plugins/<kennung>/` with the manifest `plugin.json` and an entry file —
no `npm install`, no build step, no third-party dependency (measured:
none of the 30 plugin files imports anything except `node:*` and relative
paths).

```jsonc
{
  "kennung": "mixpi-meinequelle",   // = Ordnername, Namensraum und Route
  "name":    "Meine Quelle",
  "fassung": "0.1.0",
  "haupt":   "index.mjs",
  "rechte":  ["medienquelle", "netz"],   // was der Kontext mitbringt
  "felder":  [ { "art": "text", "kennung": "adresse", "name": "Adresse" } ]
}
```

* **Four fields are mandatory** (`kennung`, `name`, `fassung`, `haupt`); everything
  else is optional: `rechte`, `felder`, `sektion`, `icon`, `aktionen`,
  `konfig`.
* **Seven rights**, and whatever is not in the manifest is simply
  `undefined` in the context: `medienquelle`, `ereignisse`, `netz`, `aufnahme`, `klang`,
  `geraetestand`, `songtext`.
* **Nine contract methods, all optional:** `aufloesen`, `suchen`, `inhalt`,
  `befinden`, `ereignis`, `klangkette`, `aktion`, `http`, `songtext`.
* **Settings are declarative:** the admin (Verwaltung) builds the inputs from
  `felder` (`text`, `zahl`, `schalter`, `geheim`) — a `geheim` field is never
  returned.
* **A plugin gets no `spielen`.** It delivers a source; whether that turns into
  sound is decided by the core — that is where kids' time hangs. A convenient
  playback path of its own would bypass it without anyone noticing.
* **Three hard locks:** `kontext.holen` refuses 127.0.0.0/8, `localhost`,
  `::1` and the box's own LAN addresses; a source may only be `http`/`https`;
  a file only below the media root.
* **Every plugin runs in its own `worker_thread`** with 48 MB of memory,
  an 8 s deadline per call and at most three restart attempts. That is
  **crash and consumption isolation, explicitly not security isolation** —
  a worker may import `node:fs`. So it matters where a plugin comes from.
* **`UiExtension` — third-party JS in the child screen — does not exist**, and
  deliberately so: a faulty widget could take the off switch away from the child.
  A plugin shows itself in the admin (icon, `befinden()`, `aktionen`,
  `felder`) and via `http()` behind the admin's gate — GET/POST only, JSON only,
  at most 256 KB.

```bash
node tools/plugin-geruest.mjs <kennung>              # legt eines an, das läuft
node --test plugins/<kennung>/*.spec.mjs             # eigene Zeugen
npx tsx tools/plugin-pruefen.mjs plugins/<kennung>   # das maßgebliche Urteil
```

The last command is the authoritative one: it loads the plugin in a **real**
worker with the real locks. The full guide — including the rejection rules
verbatim and a section "For LLMs" — is in
**[`plugins/README.md`](plugins/README.md)**. The 14 plugins in the tree are
tested along with it: 20 test files, 657 tests (`npm run test:plugins`).

| Plugin | What it does |
|---|---|
| `mixpi-archive` | public-domain radio plays and readings from the Internet Archive |
| `mixpi-ardsounds` | ARD Audiothek: shelves, collections, programmes, radio stations |
| `mixpi-mediathek` · `mixpi-mediathekview` | videos: ARD or ZDF/KiKA/3sat/arte/funk |
| `mixpi-jellyfin` | Jellyfin as a media source (address and key stay in the core) |
| `mupibox-podcast` · `mupibox-subsonic` | sample plugins: feed or source with credentials |
| `mixpi-lrclib` | lyrics with timestamps (LRCLIB) for the stage |
| `mixpi-similar` | similar artists from Deezer, Last.fm, ListenBrainz |
| `mixpi-klang` | describes the filter chain (stereo width, shelving filters, compressor) |
| `mixpi-librespot` · `mixpi-soloist` | the two Spotify sound engines as information providers |
| `mixpi-mitschnitt` | the recording (test function, see 3.6) |
| `mupibox-wled` | sample plugin for events: light follows playback |

---

## 8. Way of working

Why this is here: this project is built to a large extent in LLM sessions,
and the rules below are not a matter of taste but what was left over after a
few expensive detours. Whoever changes something here — human or model —
sticks to them. The binding version is in
[AGENTS.md](AGENTS.md).

**Six steps, in this order:**

1. **Ask the knowledge pack first**, then the code. The most expensive minute
   is the one in which someone finds out something that has long been in there.
2. **Check the state of things outside**, wherever something outside changes
   (third-party interfaces, libraries, hardware). Whoever skips this says why.
3. **Look in `tools/`** whether the tool already exists.
4. **If one is missing, it gets built** — and it stays, with the header comment
   "WOZU" (what for) and "WAS ES NICHT TUT" (what it does not do). A tool costs
   once, a rebuilt one-liner costs anew every time.
5. **Only then build** — and document what was built. Statements about the
   current state get a date so that a later reader re-measures them instead of
   believing them.
6. **The finding goes into the knowledge pack**, in the same go as the commit.
   What is meant to go in "later" never goes in.

**Two runners, and only two:**

```bash
tools/pruefen.sh --schnell   # nur die Kerntests
tools/pruefen.sh             # + Typen + alle Baue      ← vor jedem Ausliefern
tools/pruefen.sh --box       # + Messungen am Gerät
tools/doku-luecken-probe.sh  # der Baum gegen die Handbücher
```

`pruefen.sh` checks the code (146 steps), `doku-luecken-probe.sh` checks whether
the manuals are still right — **including this README**: a tool checks its
paths, numbers, offered commands and named knowledge-pack entries against
the tree (`tools/readme-behauptungen-pruefen.sh`). Numbers are checked as a
band, not to the exact digit.

> **Pitfall:** `auth.integration.spec.ts` never ends on its own. The run stands
> still after "Kerntests backend-api" until one calls `pkill -f "tsx --test"`;
> after that it runs normally to the end. Wiki:
> `pruefen-sh-haengt-auf-auth-integration`.

**Green tests prove nothing as long as they cannot also turn red.** Every
new test is mutation-checked: deliberately bend one line in the production code
and watch whether exactly the right test fails.

**Working without a box.** The mock answers everything the UI
needs; it talks to no box and writes no file.

```bash
node tools/neu-vorschau.mjs                  # der Kinderschirm → :8299/neu/
npm run build:frontend-admin                 # einmal bauen …
node tools/admin-vorschau.mjs                # … dann die Verwaltung → :8298/admin/
node tools/schirmbilder-readme.mjs           # die Bilder dieser README neu aufnehmen
node tools/schirmbilder-verwaltung.mjs       # dito für die Verwaltung
```

**Once per clone: hook in the commit hooks.**

```bash
git config core.hooksPath tools/git-hooks
```

Without this command the hooks sit in the tree but **never** run —
`core.hooksPath` is local configuration and is not cloned along.

**Where the knowledge is.** The dearly bought details — which measurement
refuted which assumption, which workaround was necessary and why — are
neither in the code nor in this file but in the knowledge pack
**`llmwiki/pack.yaml`** (1113 entries, version 615). It is deliberately data,
not code, and is never executed. It is not read by hand:

```bash
python3 tools/wiki-suche.py --text <suchwort>     # auch --tag, --kind, --id … --lang
```

Searching goes by the keywords, not by the entry kind. Where this README
or the documentation names an entry by name, the answer is there —
and only there. Two truths about the same thing are worse than one
incomplete one, and the second one always goes stale first.

**Where to start:** `dokumentation/mixpibox.md` — the map: how the parts
hang together, which services run, how it is installed and shipped,
and explicitly what is currently under construction. Whoever reads only one
file reads this one. Then `BACKLOG.md` (what is pending and why).

---
## 9. Contributing

There is no open collaboration on this fork. What is **broken** here still
belongs here (issues in this repo) — see section 1.

Development uses the npm scripts of the root directory (`npm run
serve:backend-api`, `serve:frontend-admin`, `serve:backend-player`);
details in `dokumentation/mixpibox.md`, section 7.

### What is on GitHub — and what is not

This repo on GitHub is a **curated state**, not a dump of the working tree:
everything needed to **set up and operate a box, build the app and understand
the project** — and none of it is missing. A guard checks before every
publication that every source the installation recipes fetch from the repo is
actually included.

Held back is **source material and unused things**: the CAD/print files of the
enclosures, the raw AI renders from which figures and characters were cut (the
tool brings the ones used by name back, measured), the templates for keyboard
and progress bar, six old librespot binary builds that no path calls anymore,
the snapshots of individual audit sessions (`AUDIT-*.md`) and everything that
reveals the home environment. Which patterns those are and **why** is listed
line by line in
[`tools/github-ausschluss.txt`](tools/github-ausschluss.txt); the publication
is built with `python3 tools/github-veroeffentlichen.py` (dry run without
switches).

The **complete history** lives on the own repositories, not here — this branch
starts with a parentless commit and gets one more per publication. Whoever
reads `git log` sees the publications, not the genesis.

---
## 10. Origin and License

MIT license, copyright *MuPiBox.de* — see [`LICENSE.md`](LICENSE.md); the
copyright notice stays, as the license requires. Origin:
**[MuPiBox](https://github.com/splitti/MuPiBox)** by splitti and nero.

### Built on

What really runs on the box today — not what the origin once
used:

* **DietPi** on Debian 13 "Trixie" (https://dietpi.com/)
* **Node.js 26**, **TypeScript**, **Express 5**, **esbuild** — the two backends;
  **Angular** — the admin (Verwaltung); **Biome** — the linter
* **mpv** — local files and Jellyfin
* **librespot** 0.8.0 (https://github.com/librespot-org/librespot) and
  **Soloist**, Spotify's official headless client — two sound engines, the
  configuration (`spotify.engine`) decides which one runs
* **PipeWire** and **WirePlumber** — the audio chain, with LADSPA links for
  compressor and limiter
* **Piper** (https://github.com/rhasspy/piper) — speech output on the box,
  without network
* **Chromium** as kiosk (Cog/WPE as an option)
* **Jellyfin**, **LRCLIB**, **MediathekView**, **ARD Audiothek**,
  **Internet Archive**, Deezer/Last.fm/ListenBrainz — services that plugins
  dock onto
* **fbv** (https://github.com/godspeed1989/fbv) and the initramfs splash by
  DarkElvenAngel — the boot image; **jq**; **WLED** via the sample plugin

Bundled so the box needs no external address:

* Fonts **Baloo 2** (https://github.com/EkType/Baloo2) and **Nunito**
  (https://github.com/googlefonts/nunito), both SIL Open Font License 1.1
* the images of the memory game — CC0, Cleveland Museum of Art and Metropolitan
  Museum of Art
* start-up and shutdown sound by Zeraora and Leszek_Szary (freesound.org)

---
## Why the German file leads

This file is translated from [README.md](README.md), which is the primary
edition. When the two disagree, the German one is right and this one is behind.

The reason is consistency, not convenience: identifiers and comments in this
fork are German, the knowledge pack is German, the BACKLOG is German, the
documentation is German. Whoever steps from this English README into the tree
is one click away from German text; the German edition reaches into every file
it describes. The English edition exists since 23.09.2026 so that nobody bounces
off the repo for lack of German — and a tool keeps both editions congruent
wherever it can be checked (numbers, paths, commands, images):
`python3 tools/readme-paritaet-pruefen.py`.

So that nobody lands here by mistake anyway, the pointer to the origin sits at
the very top — in English.
