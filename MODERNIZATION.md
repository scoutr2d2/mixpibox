# MuPiBox — Modernization Analysis & Roadmap

> Status: **analysis + plan** (no code changed yet). This document is the shared
> reference for the modernization effort. It is derived from a full read-through
> of the frontend, both Node backends, the PHP admin, and the system/OS layer.

> **ÜBERHOLT AM 26.08.2026 — Zustandsaussagen gelten nicht mehr, der Plan schon.**
>
> Dieser Text ist eine Momentaufnahme aus der Zeit **vor** dem Umbau. Die
> *Vorhaben* (§2–§7) sind weiter der gemeinsame Bezug; die *Zustandsaussagen*
> („heute ist X so") sind an fünf Stellen belegt falsch und unten am Ort
> korrigiert. `AUDIT-2026-08-23.md` §6.3 und `BACKLOG.md` A4 haben genau das am
> 23.08. angemeldet — drei Tage lang stand der Text unverändert weiter, weil
> `tools/doku-widerruf-probe.sh` nur die fünf Handbücher liest und die neun
> Analyse-MDs der Wurzel für keine Wache existieren. Seit dem 26.08. deckt
> `tools/analyse-md-stand-pruefen.py` sie ab.
>
> Nachgemessen am 26.08.2026 (nicht aus den Audits übernommen):
>
> | Behauptung im Text | gemessen am 26.08.2026 |
> |---|---|
> | „no CI" (Z. 51) | `.github/workflows/ci.yml` gibt es seit 26.08. |
> | `AdminInterface/` als lebende PHP-Komponente (Z. 49) | **null** versionierte Dateien darunter, **null** `.php` im ganzen Baum — abgelöst durch `src/frontend-admin` |
> | `backend-player` „Plain JS, CommonJS, no types, no tests" (Z. 48) | 20 `.ts`, **null** `.js`, Testdatei neben jedem Modul |
> | „~61 shell + ~22 python" (Z. 50) | 69 Shell + 35 Python in `scripts/` + `autosetup/` |
> | „`Dockerfile`/`.devcontainer` already assemble a working box container" (§5) | die Wurzel-`Dockerfile` **baut seit 22 Monaten nicht** — zwei `cp`-Quellen wurden am 23.10.2024 verschoben (`tools/abbild-pfade-pruefen.py`) |
>
> Die letzte Zeile ist die teure: §5 ist das Kapitel, das einem Leser sagt,
> Tier A laufe „einfach über den Dockerfile" — und genau das ist der eine Weg,
> der nachweislich nicht geht.
>
> **Nachtrag 26.08.2026, zweiter Lauf — „am Ort korrigiert" war halb.** Zwei
> dieser fünf Behauptungen stehen im Text **zweimal**: einmal in der Tabelle in
> §2 (dort am 26.08. durchgestrichen) und einmal im **Architekturbild in §1**
> (`backend-player (Express 4 / JS, legacy)`, `PHP admin (lighttpd) :80/443`).
> Im Bild blieben beide unangetastet, weil ein Code-Block kein
> `~~durchgestrichen~~` trägt — jede Korrektur, die mit Markdown-Auszeichnung
> arbeitet, endet an der Zäunung. Jetzt im Bild selbst nachgezogen, mit einem
> Kasten darunter. **Die Regel:** wer eine Behauptung widerruft, greppt nach
> ihr im ganzen Text und sieht in die Code-Blöcke; ein Bild wird zuerst
> angesehen und nie durchgestrichen.
>
> Dieselben zwei Sätze standen außerdem in `harness/README.md` und
> `harness/docker-compose.yml` — eine **sechste Sorte Datei** nach der
> Bauanleitung (24.08.) und der Momentaufnahme (26.08.): das
> **Simulationsrezept**. Keine der 33 Wachen liest es.

## Goals (owner)

1. **More music services** beyond Spotify (today: Spotify + local files + streams).
2. **Fresher / leaner UI.**
3. **Smaller Linux / OS footprint.**
4. **Desktop app** for music-list / playlist management.
5. **Spotify recorder** integration (existing `spotcap` project).
6. **Technical base**: `backend-player` JS→TypeScript; PHP admin; CI.

**Hard constraint:** MuPiHAT hardware compatibility must not break.

---

## 1. Current architecture

```
Touch display → Chromium kiosk (X11) → Angular/Ionic UI            :8200
     │  GET /api/data (library)   GET /api/spotify/* (metadata)
     ▼
 backend-api (Express 5 / TS, modern) :8200 ──reads/writes──▶ data.json · mupiboxconfig.json · resume.json
     │  (frontend discovers the player via /api/sonos)                ▲  (THE SAME files)
     ▼                                                                │
 backend-player (Express 4 / TS) :5005                       [PHP admin: WEG seit E47]
     ├─ "spotify:" → Web-API REMOTE CONTROL → librespot / Web-SDK (Spotify Connect) → ALSA
     └─ library/radio/rss/say → ONE generic mplayer process (plays ANY url/file) → ALSA
                                                                      ▲
 MuPiHAT: BQ25792 charger (I²C 0x6b) → mupihat.py → /tmp/mupihat.json ──(read by everyone)
          MAX98357A (I²S amp) = at the same time THE audio path
```

> **Am Bild nachgezogen 26.08.2026.** Hier stand bis heute `backend-player
> (Express 4 / JS, legacy)` und `PHP admin (lighttpd) :80/443` — **beides** hat
> der Kasten ganz oben schon am 26.08. als falsch gemessen und in der Tabelle in
> §2 durchgestrichen. Im Bild blieb es stehen: **ein Code-Block trägt kein
> `~~durchgestrichen~~`**, also endet dort jede Korrektur, die mit Markdown
> arbeitet — und §1 ist die Stelle, die ein Leser als erste ansieht. Gemessen:
> `src/backend-player/src` hat 20 `.ts` und **null** `.js`; `AdminInterface/`
> hat **null** versionierte Dateien, der PHP-Admin ist mit E47 (19.08.2026)
> ausgebaut. Was bleibt: Express **4** stimmt (`package.json` `^4.17.1`),
> `backend-api` steht auf `^5.1.0`.

The components do **not** talk to each other over an API — they share a handful
of on-disk **JSON files** (`data.json` = media library, `mupiboxconfig.json` =
device config, `resume.json` = playback positions, `/tmp/mupihat.json` = HAT
state). That is both the main risk (write races) and the clean extension point.

### Component inventory

| Component | Stack | State |
|---|---|---|
| `src/frontend-box` | Angular 20.3 + Ionic 8.7, TS 5.8, standalone components + signals | Modern; thin test coverage; TS not strict |
| `src/backend-api` | Express 5, TS, ESM, tsx/esbuild, `@spotify/web-api-ts-sdk` | Modern; **no auth**; index-based CRUD |
| `src/backend-player` | ~~Plain JS, CommonJS~~ → **TypeScript, ESM** (26.08.: 20 `.ts`, 0 `.js`), Express 4, `spotify-web-api-node` (unmaintained), nodemon | ~~Legacy island; no types; no tests~~ → portiert, Testdatei neben jedem Modul; offen bleibt nur `spotify-web-api-node` (B1) |
| ~~`AdminInterface/`~~ | ~~PHP + lighttpd, jQuery, Bootstrap 3+4+5, CodeMirror~~ | **Ausgebaut.** 26.08.: null versionierte Dateien, null `.php` im Baum — ersetzt durch `src/frontend-admin`. §4 unten beschreibt die Lücken des **entfernten** Codes und gilt nur noch historisch |
| `scripts/`, `autosetup/` | 69 shell + 35 python (26.08.; im Text stand „~61/~22") | Hardware/OS glue on DietPi |
| Tooling | Biome, esbuild, Docker, devcontainer, npm workspaces | Modern; ~~no CI~~ → `.github/workflows/ci.yml` seit 26.08. |

---

## 2. Key strategic insight — Spotify is the special case, not the norm

- **Spotify audio does not flow through Node.** It is played by an external
  Spotify Connect device (**librespot/spotifyd**, or possibly the in-browser Web
  Playback SDK — see §6 open question). `backend-player` only *remote-controls*
  it via the Spotify Web API (`transferMyPlayback`, `play`, `pause`, …).
- **Everything else (local / radio / rss) goes through one generic `mplayer`
  process** driven over stdin — `player.play(urlOrFile)` streams any HTTP URL.
  Radio and RSS already work exactly this way.

**Consequence for "more music services":** any service that yields a **direct
stream URL** (Jellyfin, Subsonic/Navidrome, a self-hosted resolver, or the
recorder's local files) is the *easy* case — no new player, just routing +
metadata + a new `type` value. Services requiring a browser SDK / DRM (YouTube
Music, TIDAL, Apple Music) are each a large effort.

### The provider seam (the central, but clean, refactor)

Provider dispatch is hard-coded in three places today; none is abstracted:

- **Frontend** — `Media.type` is a free `string` (`'spotify'|'library'|'rss'|'radio'`), branched at:
  - metadata resolution: `media.service.ts` `updateMedia()` (~L445–566, an `iif()` chain)
  - playback launch: `player.service.ts` `playMedia()` (~L87–153, a `switch` — the clean extension point)
  - now-playing: the `CurrentSpotify` vs `CurrentMPlayer` fork all over `player/player.page.ts`
- **Backend-player** — every transport verb branches on
  `currentMeta.currentPlayer === 'spotify'` vs `'mplayer'` (`spotify-control.ts`).

**Target abstraction:**
```ts
// frontend
interface MediaProvider {
  readonly type: string
  resolve(entry: Media): Observable<Media[]>   // replaces the iif() arm
  play(media: Media): Observable<void>         // replaces the switch arm
  resume(media: Media): Observable<void>
  nowPlaying$(): Observable<NowPlaying>        // unifies CurrentSpotify/CurrentMPlayer
}
```
```ts
// backend-player
interface Player { play; pause; next; previous; seek; stop; getState }
// SpotifyConnectPlayer (Web API) + MplayerPlayer (generic url/file — already exists)
```
A unified `NowPlaying` view-model is the single biggest enabler — it deletes the
Spotify-vs-local fork in `player.page.ts`. URL-stream providers then reuse the
existing `MplayerPlayer` + the `local$` channel and cost almost nothing.

### The shared media-item contract (`data.json`)

```jsonc
{
  "type": "spotify" | "library" | "radio" | "rss",   // provider discriminator (→ union)
  "category": "audiobook" | "music" | "other" | "resume",
  "id" | "playlistid" | "showid" | "audiobookid" | "artistid" | "query": "…",
  "artist": "…", "title": "…", "cover": "…", "artistcover": "…",
  "index": 0, "shuffle": false,
  "resumespotify*" | "resumelocal*" | "resumerss*": …   // resume, mirrored in resume.json (by id)
}
```
A new provider = a new `type` value understood by (i) the frontend, (ii)
backend-api metadata, (iii) backend-player routing.

---

## 3. Hard constraint — the MuPiHAT boundary (do not break)

MuPiHAT is **battery charger (TI BQ25792, I²C bus 1 @ 0x6b)** *and* the
**audio amplifier (MAX98357A, I²S)** in one board — so **audio and HAT overlap**;
they cannot be treated independently.

Untouchable / must be preserved verbatim:

- The I²C stack: `/boot/config.txt` `dtparam=i2c_arm/i2c1`, module `i2c-dev`, `python3-smbus2`/`i2c-tools`.
- `scripts/mupihat/mupihat.py` + the BQ25792 driver `mupihat_bq25792.py`.
- The systemd units `mupi_hat.service` + `mupi_hat_control.service`.
- The I²S audio path: `dtoverlay=max98357a,sdmode-pin=16` + `i2s-mmap`, ALSA soundcard `MAX98357A…`.
- **The `/tmp/mupihat.json` schema** — the contract every consumer reads:
  `{Charger_Status, Vbat, Vbus, Ibat, IBus, Temp, BatteryConnected, Bat_SOC, Bat_Stat, Bat_Type}`.
- The `mupiboxconfig.json.mupihat.*` gating (`hat_active` default **false**, `battery_types`, `selected_battery`, `current_limit`) and its mirror `www.json.node-sonos-http-api.hat_active`.
- Consumers that must keep working: `backend-api` `/api/mupihat`, the frontend `mupihat-icon` component + `mupihat$` + `Mupihat` model, `fan_control.py`, the admin battery icons.

Any refactor must keep the `/tmp/mupihat.json` schema and the config keys stable.
For testing without hardware, **mock** the HAT by writing a synthetic
`/tmp/mupihat.json` (see §5) — do not try to emulate I²C.

### Auto-detection (B10) — the robust, portable replacement for manual `hat_active`

Today the HAT is gated by a **manual** `mupihat.hat_active` flag the user flips
in the admin — easy to misconfigure. Because the owner runs (or may run) several
boards (Pi 4/5/CM4, **Odroid**), the software should **detect** the HAT instead:
probe I²C for the BQ25792 charger (@ 0x6b) and auto-default `hat_active`, while
keeping the manual override. This also carries the **platform abstraction** the
multi-board goal needs — the I²C **bus number differs per board** (Pi = bus 1;
Odroid differs), so detection must enumerate `/dev/i2c-*` rather than assume bus 1.

Two scripts exist (both additive, no change to the existing HAT flow):
- [`scripts/hwdetect/hwdetect.sh`](scripts/hwdetect/hwdetect.sh) (`./mupictl hwinfo`,
  or `--device <host> hwinfo` over SSH) — reports `{platform, arch, i2c_buses,
  mupihat{present,address,bus,method}, hat_active_recommended, source}`, probes
  with `i2cget`/`i2cdetect`, degrades to `present:false` on x86/sim.
- [`scripts/hwdetect/hat-apply.sh`](scripts/hwdetect/hat-apply.sh) (`./mupictl
  hwapply [--apply]`) — reconciles the recommendation with `mupihat.hat_active`.
  **Safety policy:** a manual `true`/`false` always wins; detection decides only
  when the flag is the sentinel `"auto"` (or `MUPIBOX_HAT_AUTO=1`); **dry-run by
  default**; it writes **only** the config flag and deliberately does **not** run
  `enable_mupihat.sh` or touch the I²C/MAX98357A overlays (that stays an
  install/boot concern — the hard constraint), printing a reboot note instead.

Remaining B10 step: an optional boot-time service that runs `hwapply` (auto mode)
so a box images once and adapts to whether a HAT is plugged in.

**Nuance:** detection has two levels — (a) *runtime* "is the charger answering on
I²C" (easy, drives battery features + the icon), and (b) *boot-time* I²S audio
(the MAX98357A device-tree overlay), which needs a reboot to change. B10 targets
(a) first; (b) stays an install/boot concern.

---

## 4. Security findings (shape the B0 work)

Acceptable for the historical "offline box on home WiFi" model, but a hard
blocker for anything network-exposed (e.g. the desktop app):

- `backend-api` has **no authentication** (open CORS; only `/api/monitor` is localhost-gated).
- Admin CRUD writes `data.json`/`resume.json` **ignoring** backend-api's `/tmp/.data.lock`; edit/delete address entries **by array index**, not stable id → concurrent-edit clobbering.
- Several PHP endpoints run `sudo`/stream files **without the auth gate** (`backup.php`, `fullbackup.php`, `backend.php`, `update_*.php`); in `admin.php` the restore handler runs **before** the login `exit`.
- Restore = `sudo unzip -o -a <upload> -d /` (extension check only) → arbitrary root file overwrite.
- Updates = `curl …githubusercontent…/*.sh | sudo bash`.
- `spotify.php` interpolates `$_GET['code']` into a `curl` `exec` (command-injection shape).
- `www-data ALL=(ALL:ALL) NOPASSWD: ALL` sudoers + `Xwrapper allowed_users=anybody`.

---

## 5. Testing & simulation strategy (answers "can we run this on the dev machine?")

**Short answer: yes — and mostly WITHOUT QEMU.** The whole app stack is plain
Node + Angular + a browser + mplayer + librespot, all of which run natively on
x86-64. The bundled `librespot-64bit`/`fbv_64` binaries and the existing
`Dockerfile`/`.devcontainer` already assemble a working box container.
**Stimmt seit dem 23.10.2024 nicht** (gemessen 26.08.2026): die Wurzel-`Dockerfile`
bricht ab, weil zwei `RUN cp`-Quellen beim Arbeitsbereichs-Umbau `5f5ea724`
umgezogen sind — `tools/abbild-pfade-pruefen.py` weist beide nach. Tier A läuft
heute nativ per npm-Skripten; wer den Container-Weg will, repariert zuerst die
zwei Pfade. `.devcontainer/` provisioniert weiterhin PHP 8.3 + Composer + die
PHP-Erweiterung für einen Baum mit **null** `.php`-Dateien — seit dem 27.08.2026
nachgemessen von `tools/entwicklerabbild-pruefen.py` (BACKLOG A4b), das dort auch
jede `COPY`-Quelle gegen den Bau-Kontext hält. Dass er **baut**, stand hier einen
Tag lang ungemessen: es wurde nie ein Container gebaut, und es gilt weiter nur,
dass keine tote Quelle nachweisbar ist. QEMU-ARM
adds value only for the OS/boot layer, and it **cannot** emulate the MuPiHAT
hardware anyway — so the HAT is mocked at the `/tmp/mupihat.json` boundary.

### Tier A — native / Docker on x86 (the workhorse, ~90% of the work)
Runs `frontend-box` + `backend-api` + `backend-player` + a **MuPiHAT mock** +
seed config on this machine (docker-compose or npm scripts). Covers B0–B6 and the
B4 desktop app. `mplayer` + `librespot` run natively; Spotify Connect works with
real credentials. The HAT is a tiny fake process writing a varying
`/tmp/mupihat.json`. **This is where nearly all modernization is tested.**
~~Starting point: the existing `Dockerfile` + README dev scripts
(`npm run serve:backend-api`, `serve:frontend-box`, `php -S` for admin).~~
**Einstieg heute (26.08.2026):** `./mupictl up` (`harness/docker-compose.yml`,
siehe [`harness/README.md`](harness/README.md)) oder direkt `npm run
serve:backend-api` / `serve:backend-player` / `serve:frontend-box` — die drei
gibt es in der Wurzel-`package.json`. **Nicht** über die Wurzel-`Dockerfile`:
sie baut seit dem 23.10.2024 nicht (zwölf Zeilen weiter oben belegt). Und
`php -S for admin` führt ins Leere — der PHP-Admin ist mit E47 ausgebaut, das
`admin`-Profil des harness mountet ein `../AdminInterface/www`, das es nicht
mehr gibt (`AUDIT-2026-08-25.md` §10).

### Tier B — QEMU aarch64 (full DietPi ARM image, the OS/integration layer)
For `autosetup.sh`, the systemd units, the boot/update chain, ARM-specific
package issues, and the pm2→systemd migration (B7). Boot a DietPi / Raspberry Pi
OS **arm64** image with `qemu-system-aarch64 -M virt` (kernel + initrd) or the
`raspi3b`/`raspi4b` machine models. **No** real HAT, I²S audio, GPIO, or GPU —
Chromium kiosk is impractical here. Optional; mainly release validation for B7.

### Tier C — real Pi + MuPiHAT (final hardware-in-the-loop)
The only true validation of I²C/I²S/GPIO/touch. Needed at the end of each
hardware-touching change, not for day-to-day modernization.

### Implemented — Tier-A dev harness + `mupictl` (DONE)

The Tier-A harness now lives in [`harness/`](harness/) and is driven by the
[`mupictl`](mupictl) CLI (the B8 tool). It runs the two backends + the MuPiHAT
mock on x86 with no Pi:

```bash
./mupictl up              # backends + HAT mock
./mupictl up --frontend   # + Angular dev server on :4200
./mupictl state           # simulated battery + /api/mupihat
./mupictl api /api/data   # seed media library
```

Verified end-to-end: `GET :8200/api/data` serves the seed library (all four
provider types), `GET :8200/api/mupihat` reflects the mock's **live** battery
SOC (proving the `/tmp/mupihat.json` contract works without hardware), and the
player answers on `:5005` (`/local`).

**Finding (→ B2):** `backend-player` **hard-crashes on boot** if the Spotify
token refresh fails (empty/invalid credentials) — an uncaught promise rejection
that Node 22 turns into a process exit, so local/radio/rss playback dies with
Spotify misconfig. The harness works around it with `--unhandled-rejections=warn`;
the real fix (catch + degrade gracefully) belongs to the B2 TypeScript rework.

### The control-from-PC spectrum (B8 → B9)

`mupictl` is the near end of a spectrum that ends at B9:
`app-deploy` (`deploy_on_device.sh`) → `OS-update` (`install.mjs`-style) →
**full re-flash** (B9 recovery loader). B9's concrete mechanism depends on the
Raspberry Pi model + storage (A/B recovery partition on any Pi · netboot/PXE on
Pi 4/5 · `rpiboot`/USB on CM4/CM5 · the bootloader's network-install) — so the
Pi model is the gating input for B9.

---

## 6. RESOLVED — the Spotify audio path is a runtime-gated hybrid

**Both paths ship; the frontend picks one per request via `isLocalhost()`.** The
earlier "divergence" was not a contradiction — the box uses *both*, selected at
runtime:

- **On the box's own kiosk → the in-browser Web Playback SDK is PRIMARY.** The
  kiosk launches `chromium … --homepage "http://localhost:8200"`
  (`scripts/chromium-autostart.sh:70`); `backend-api` serves the built frontend
  there (`server.ts:102` `express.static('www')`, `:1105` `listen(8200)`). The
  frontend gate `spotify-player.service.ts` `shouldUsePlayer() → isLocalhost()`
  is therefore **true** on the kiosk, so `SpotifyPlayerService` registers an
  **in-browser Spotify Connect device** via the Web Playback SDK. `player.service.ts`
  `sendRequest()` then stamps that device onto **every** player command —
  `const room = isPlayerReady() ? getDeviceId() : 'current'` → `…/player/<room>/…`
  — and the backend `spotify-control.ts` `play({device_id})` / `transferMyPlayback`
  targets it. `libwidevinecdm0` is apt-installed (`autosetup.sh:40`) precisely so
  Chromium's EME can decrypt the protected stream → **audio comes out of Chromium**.
- **Remote controllers (phone/tablet on the box's hostname/IP), or SDK-not-ready →
  librespot is the FALLBACK.** There `isLocalhost()` is false → `room = 'current'`,
  and the backend `setActiveDevice()` transfers to `availableDevices[0]` — the
  **librespot** Connect device (installed + `librespot.service` enabled/restarted,
  `autosetup.sh:546/581`, named after the host). `spotifyd.service` also exists but
  its config wiring is commented out (`setting_update.sh`) → librespot is the live
  Connect daemon.

**Consequences (both were the point of asking):**

- **(a) Chromium replacement (B7 stage 3) is NOT free** — the box's *own* Spotify
  audio currently **requires Chromium + Widevine EME**. A lighter engine
  (WPE/`cog`/`cage`) would need a working Widevine CDM, which is fragile on ARM.
  **The clean enabler is to make librespot PRIMARY on the box too** (force
  `shouldUsePlayer()` = false on localhost / drop the in-browser SDK): librespot
  already plays headless to ALSA, so that removes the browser from the audio path
  entirely and *then* B7-s3 becomes viable. → **B7-s3 must be paired with an
  "SDK→librespot primary" switch**, tracked as a B7-s3 prerequisite.
- **(b) The Spotify provider stays doubly special:** two sub-backends (in-browser
  SDK + librespot Connect) chosen by `isLocalhost()`. For the B1 abstraction, a
  single `SpotifyConnectPlayer` ("transfer to whichever Connect device the frontend
  named, else the first available") already covers both — the SDK-vs-librespot
  choice is a **frontend** concern (device registration), not a backend branch.
- **(c) Sim caveat:** in Tier A the frontend runs at `localhost:4200` → `isLocalhost()`
  true → it also tries the Web Playback SDK, which needs real Spotify **Premium**
  creds + Widevine in the dev browser. Without creds Spotify won't play in the sim
  regardless (matches the observed token-refresh failures); local/radio/rss via
  mplayer are unaffected. To exercise the **librespot** path in the sim, open the UI
  via the host IP (not localhost) so the gate falls back.

### 6.1 Spotify platform watch (librespot + Web API) — as of 2026-07

Checked against what the two backends **actually call** (not just the headlines).
Re-verify periodically — Spotify has been changing the platform aggressively.

**librespot — works; the auth just moved.** The dead thing is the anonymous
`open.spotify.com/get_access_token` scrape (March 2025 "Invalid TOTP" → later
"not permitted under the Developer Terms"; C&D letters to the scraper projects by
Oct 2025). librespot itself moved off it: **0.5/0.6 acquire the token via
`login5`**, and 0.6 added a choice of zeroconf backend (avahi/dnssd/libmdns) for
Spotify-Connect discovery. **MuPiBox is already current** — `autosetup.sh` fetches
`librespot dev_0.6_20250806` (a post-fix Aug-2025 0.6 build), so the Connect
fallback path (phone discovers the box via zeroconf, transfers playback — the §6
fallback) is on the modern `login5` stack. No action beyond occasionally
refreshing the binary. Model change to note: **password-in-config login is gone**;
the modern flow is zeroconf **or** a one-time OAuth (auth-code + PKCE) that seeds
cached credentials.

**Web API deprecation (2024-11-27) does NOT break MuPiBox.** Spotify axed (for
*new* apps, no notice) recommendations, audio-features/analysis, related-artists,
featured/category playlists, 30-s previews, new-releases, artist-top-tracks, bulk
metadata, etc. But MuPiBox calls **none** of them:
- `backend-api` (metadata, already on `@spotify/web-api-ts-sdk`): only `search`,
  `albums.get`, `artists.get`/`artists.albums`, `playlists.*`, `shows.*`,
  `episodes.get`, `audiobooks.get` — direct ID lookups + search, all survived.
- `backend-player` (control): only `play/pause/seek/setVolume/setShuffle/
  transferMyPlayback/getMyDevices/skipTo*` — Connect playback control, untouched.

**The real, NEW risk is operational — Development-Mode tightening (2026-02-06):**
Dev Mode now **requires a Premium account** and cuts **test users 25 → 5**;
"extended quota" needs a registered business + 250 k MAU (unreachable for a box).
Spotify: Dev Mode "should not be relied on as a foundation for building or
scaling." → **Every box owner must register their own Spotify app, be Premium,
and add ≤5 listeners as test users.** This is a box-owner **onboarding** concern
(document it in setup), and it strengthens the case for a robust librespot/Connect
path (Connect playback depends less on the fragile Web-API quota than metadata does).

**Library / B2 confirmation:** `spotify-web-api-node` (used by `backend-player`)
is **abandoned** (last release 4.0.0, ~2+ yr). `backend-api` already uses the
official **`@spotify/web-api-ts-sdk`**. → **B2's SDK swap target is confirmed =
`@spotify/web-api-ts-sdk`** (unify both backends); every control method maps 1:1
(`player.startResumePlayback`/`pausePlayback`/`seekToPosition`/`setPlaybackVolume`/
`togglePlaybackShuffle`/`transferPlayback`/`getAvailableDevices`/`skipToNext`).
It's a **maintenance/consistency** upgrade — *not* forced by the endpoint changes.

Sources: [TechCrunch 2026-02](https://techcrunch.com/2026/02/06/spotify-changes-developer-mode-api-to-require-premium-accounts-limits-test-users/),
[TechCrunch 2024-11](https://techcrunch.com/2024/11/27/spotify-cuts-developer-access-to-several-of-its-recommendation-features/),
[Spotify blog 2024-11](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api),
[librespot releases](https://github.com/librespot-org/librespot/releases),
[librespot #1562](https://github.com/librespot-org/librespot/discussions/1562),
[spotify-web-api-node (npm)](https://www.npmjs.com/package/spotify-web-api-node).

---

## 7. Roadmap — building blocks

| # | Block | Goal | Effort | Risk | Depends on |
|---|-------|------|--------|------|-----------|
| **B0** | **Foundation**: CI (Biome + tests + build); `backend-api` **auth/token** + **id-based, locked, validated** CRUD | tech / security | M | low | — |
| **B1** | **Provider abstraction**: `Media.type`→union, `MediaProvider` registry, unified `NowPlaying`; `Player` interface in backend-player | more services | M–L | med¹ | B2 |
| **B2** | **backend-player → TypeScript/ESM**: drop dead deps (`http`/`path`/`body-parser`/`nodemon`), `spotify-web-api-node`→`@spotify/web-api-ts-sdk`, first tests | tech | M | med | — |
| **B3** | **First new service** (Jellyfin/Subsonic/Navidrome) via the generic mplayer path | more services | S–M | low | B1 |
| **B4** | **Desktop app** (Electron playlist manager) against `backend-api`; holds no secrets | desktop app | M | low² | B0 |
| **B5** | **Spotify recorder** (`spotcap`): recordings as a local library via the generic path; trigger from admin/desktop | recorder | M | low³ | B1/B3 |
| **B6** | **UI**: near-term a branded default theme (CSS vars, no rebuild); mid-term refactor `player.page`/`add.page` | fresher UI | S / M | low | (B1 for refactor) |
| **B7** | **Leaner Linux** — staged (below) | smaller OS | S→L | low→high | (B0 for stage 2) |
| **B8** | **`mupictl` dev CLI (ADB-style)** — one tool, two targets: the local sim (`--local`) and a real box (`--device <host>`: shell / logs / forward / state / deploy) | tooling | S–M | low | — |
| **B9** | **PC-driven recovery re-flash loader** — an A/B or recovery partition so the box is "always re-flashable from the PC" (fastboot/recovery analogue), with fallback on a bad update | ops / smaller OS | L | med | **hardware model** |
| **B10** | **Hardware / MuPiHAT auto-detection + platform abstraction** — probe I²C for the BQ25792 → auto-default `hat_active`; detect the board (Pi 4/5/CM · **Odroid**) + abstract the I²C bus number; keep the manual override | portability / MuPiHAT | S–M | low (additive) | — |

¹ needs a test net first (only smoke tests today). ² needs B0 auth to be "safe".
³ technically easy (reuses the generic path); **legal grey area** (DRM/ToS) —
defensible for private use, sensitive as a shipped box feature.

**B7 stages:**
- **Stage 1 (now, low risk):** drop optional subsystems (telegram, mqtt, wled, vnc/novnc, samba, proftpd, preload, dietpi-dashboard); remove the MuPiHAT Flask `:5000` debug server; ~~**pm2 → plain systemd** for the three node apps~~ — **done 14.08.2026.** Units in `config/services/mupibox-{server,player}.service`, laid out by `autosetup.sh`; `update/start_mupibox_update.sh`, `docker/entrypoint.sh` and `scripts/mupibox/spotify_restart.sh` no longer call pm2, and it is no longer installed anywhere. Measured on the running box: pm2 absent, `pm2-dietpi.service` `not-found`, both units `enabled`/`active` (`tools/pm2-bestand.sh`). Remaining pm2 references are in the **PHP admin** (`AdminInterface/`), which Stage 2 drops anyway.
- **Stage 2 (after admin rework):** drop PHP + lighttpd (fold admin into the node backend) → also removes the blanket `www-data NOPASSWD: ALL` sudoers rule.
- **Stage 3 (risk, gated by §6):** Chromium → WPE/`cog` or `cage` (Wayland kiosk) — the biggest single saving, **only if** Spotify does not require the Web Playback SDK/Widevine.

### Recommended sequence

1. **Tier-A dev harness** (§5) + resolve the §6 Spotify question — unblocks safe testing of everything.
2. **Quick wins in parallel:** CI (part of B0), a branded default theme (part of B6), B7 stage 1.
3. **Strategic core:** B2 then B1, adding real unit tests around `updateMedia()` dispatch and `playMedia()` URL-building first.
4. **Harvest:** B3 (first new service) and/or B4 (desktop app, after B0 auth) and/or B5 (recorder).
5. **Deeper cuts:** B0 auth completion, admin rework, B7 stages 2–3.

---

## 8. Decisive code references

- Provider seam (frontend): `src/frontend-box/src/app/media.ts`, `media.service.ts` (~L445–566), `player.service.ts` (~L87–153), `current.spotify.ts` + `current.mplayer.ts` + `player/player.page.ts`, write-side `add/add.page.ts` (~L355–431).
- Playback engine (backend): `src/backend-player/src/spotify-control.ts` (dispatch + Spotify control + state), `mplayer-wrapper.ts` (the generic url/file engine — the reuse point), `parsers.ts`. *(All three were `.js` until B2 steps 1–3, §9 — the esbuild **output** is still `deploy/spotify-control.js`, which is what the box, `ausliefern.py` and `deploy.zip` mean by that name.)*
- Metadata + config broker: `src/backend-api/src/server.ts` (`/api/data|add|edit|delete`, the Spotify suite, `/api/config`, `/api/mupihat`), `services/spotify-api.service.ts`, `services/spotify-media-info.service.ts`.
- Admin: `AdminInterface/www/admin.php` (hub), `includes/header.php` (auth), `backend.php` (the one escaped/whitelisted example), `media.php` (viewer), `jsoneditor.php` (raw `data.json` editor).
- MuPiHAT: `scripts/mupihat/mupihat.py` + `mupihat_bq25792.py`, `config/services/mupi_hat*.service`, `scripts/mupihat/enable_mupihat.sh`.
- System/install: `autosetup/autosetup.sh`, `config/services/*.service`, `config/templates/dietpi.txt`, `Dockerfile`.

---

## 9. Progress log

- **Dev harness (Tier A) + `mupictl` + `hwdetect`** — done, verified (§5). `./mupictl up`.
- **B2 TypeScript migration** — the whole `backend-player` is now `.ts`, verified
  in the Tier-A sim:
  - *step 1* (foundation): runs via `tsx`, `parsers.ts` + test (5 green), boot
    crash fixed, dead deps removed (`http`/`path`/`nodemon`/`body-parser`).
  - *step 2*: `mplayer-wrapper.js` → `.ts` (the generic engine; the typed
    `MplayerPlayer` interface is the B1 `Player` seam) — local ambient types for
    the untyped vendor libs in `vendor.d.ts`.
  - *step 3*: `spotify-control.js` → `.ts` (the ~1100-line server), keeping
    `spotify-web-api-node`; typed `CurrentMeta`, declared the former implicit
    globals, annotated all callbacks/params. `tsc --noEmit` strict + Biome clean.
    The esbuild **output** stays `deploy/spotify-control.js`, so the box
    entrypoint/autosetup/Dockerfile/update scripts are unaffected.
  - **Remaining B2 — DEFERRED (needs a real box/creds):** the **SDK swap**
    `spotify-web-api-node` → `@spotify/web-api-ts-sdk` (confirmed target, §6.1) is
    NOT a mechanical swap — inspecting the installed SDK types surfaced three
    concrete, sim-**unverifiable** divergences on a *working* integration: (1)
    user-scoped auth must be rebuilt (the SDK's `withClientCredentials` is
    app-level; the player needs a refresh-token→user-access-token grant of its
    own — the login5 protobuf groundwork already exists: `proto/spotify/login5/…`
    + `build-proto`); (2) `device_id` is now **required** on
    `pausePlayback`/`skipTo*`/`startResumePlayback` (the old lib defaulted to the
    active device); (3) the error shape differs (`handleSpotifyError` reads
    `err.body.error.status` for 401/404/429 recovery — SDK errors aren't shaped
    that way). Type-level is checkable, but the auth/control runtime needs
    Premium creds. **Plan:** land it verified once creds are provided —
    clientId+clientSecret+a user refresh token in the local (gitignored)
    `harness/seed/config-player.json`, optionally a librespot in the harness as a
    real Connect target — then the auth + device-list + playback-state (and, with
    librespot, control) are testable in Tier-A. Pre-existing gap: the `test` npm
    script references `cross-env`, not a devDependency (tests pass directly via
    `tsx --test`).
- **B1 provider abstraction — DONE:**
  - *play seam* (done): `playMedia`'s type switch → a `MediaProvider` registry
    (`media-provider.ts`); library/spotify/radio/rss each register a provider
    building the SAME backend URL, the Spotify pre-flight passed in as a dep. The
    "clean extension point" that unblocks B3. Verified in the sim.
  - *unified `NowPlaying` view-model* (done): `now-playing.ts` `toNowPlaying()`
    normalizes CurrentSpotify | CurrentMPlayer → one shape (pure + Jasmine spec);
    the now-playing bar derives from it. Verified end-to-end via the widget.
  - *`player.page.ts` migrated onto `toNowPlaying`* (`ce092760`-follow-up): the
    per-getter spotify-vs-local fork in `elapsedSec`/`durationSec`/`updateProgress`
    is gone — a single `nowPlaying()` helper funnels through `toNowPlaying`,
    selecting the source by the page's OWN `media.type` (so the exact
    transition-time behavior is preserved; toNowPlaying's cross-source precedence
    is deliberately NOT used here). It also **fixed a real bug**: `updateProgress`
    matched neither branch for a `jellyfin`/`jellyfin-album` track, so the poll
    never re-armed → the full player page's seek bar/progress froze at 0; it now
    re-arms for every finite source (radio stays a one-shot; resume-save stays
    gated to spotify/library/rss) and the redundant per-tick re-subscribe (a
    one-subscription-per-second leak) was removed. **Verified end-to-end in the
    sim** on a local audiobook (the byte-identical branch Jellyfin uses): elapsed
    0:01→0:20 advancing, duration 2:08, "endet um 02:18", progress bar moving,
    `/local` 200, no new errors, bundle slightly smaller. So Jellyfin albums now
    get a live seek bar + "ends at" on the FULL player page too, not just the bar.
  - *backend `Player` interface:* the mplayer half IS the typed `MplayerPlayer`
    (from B2); the `SpotifyConnectPlayer` half is intentionally bundled with the
    deferred SDK swap (needs Spotify Premium creds to verify), so it is as
    complete as it can be without that work — not a gap in B1.
  - The **metadata seam** (`updateMedia`'s 9-deep `iif()` chain) is DELIBERATELY
    left as-is: it is almost entirely Spotify resolution (query/artistid/showid/
    playlistid/id/audiobookid) + RSS, so it's sim-unverifiable like the SDK swap —
    and a new URL-stream service (B3) falls through its `of([item])` passthrough,
    so nothing is blocked by it.
- **B3 first new service = Jellyfin — FULLY VERIFIED end-to-end** against the
  owner's real Jellyfin 10.10.3 (reachable from the sim container on the same LAN):
  - *play path* (`740f32c0`): a `jellyfin` dispatch branch mirroring radio but
    `currentType 'jellyfin'` = a FINITE track (duration/seek), added to the
    metadata/path skip checks; a `jellyfin` `MediaProvider` routing the item's
    stream URL; pure `jellyfin.ts` helpers + a Jasmine spec.
  - *API-key login* (`40d57895`): `JellyfinService.testConnection`/`getAudioItems`
    via `X-Emby-Token`.
  - *QuickConnect device-code login* (`645db285`): `jellyfinDeviceAuth`
    (MediaBrowser header) + `quickConnectEnabled`/`Initiate`/`Poll`/`Authenticate`
    — the box shows a 6-digit code, the user approves it in Jellyfin, the box gets
    a user access token.
  - **Live verification:** QuickConnect Initiate → the owner approved the code →
    poll `Authenticated:true` → token → browse (**513 audio tracks**) → and a real
    track **streamed through the whole chain** (`currentType jellyfin`,
    `playing:true`, timePos advanced 2.6→5.6). **Correction:** the earlier "sim
    mplayer can't stream HTTP" note was WRONG — that failure was the trivial mock
    server (no proper streaming headers); mplayer streams a real Jellyfin
    `stream.mp3` fine.
  - **Known refinement:** a transcoded `stream.mp3` reports no upfront length →
    `duration` stays 0 (percent-seek still works, no "ends at"). Fix later by
    passing the item's `RunTimeTicks` as the duration (or `static=true` direct
    play for already-mp3 files).
  - *onboarding UI* (`a15023f4`): the `/jellyfin` page — enter the server URL, then
    "Mit QuickConnect verbinden" (shows the code + auto-polls) or an API key;
    stores the connection (`JellyfinService.saveConfig`, localStorage). Verified
    in the sim against the owner's server (no CORS — the browser reaches it
    directly): connect → "Verbunden als Achim" → config saved.
  - *browse + album play* (`214f2784`): "Alben anzeigen" → a cover grid of the
    server's albums; tapping one plays it in order (play first track + `jfqueue`
    the rest). The backend dispatch now matches the command VERB (segment after
    the room), not `dir.includes(...)`. Verified: 20 real albums listed, tapping
    one streams the whole album (timePos advancing).
  - *add to library* (`f81ae36c`): a `+` per album adds it to `data.json` as a
    `type:'jellyfin-album'` entry (carries the Jellyfin album id); it shows on the
    home screen like a Spotify/local album. Playing it resolves the album's tracks
    and plays them in order (`PlayerService.playJellyfinAlbum`, routed from
    `playMedia`). The sim's `data.json` mount was made read-WRITE so `/api/add`
    works. Verified against the owner's server: the `+` persists (2 entries in the
    music category — artists Das Lumpenpack + Simone Sommerland), and an album
    streams through the box. (The home category-tab switch couldn't be driven by
    the automated harness — Ionic segment + synthetic events — but the data is
    correct.)
  - *refinements ("die Kür")*: (a) **duration / "ends at" fixed via DIRECT PLAY** —
    `jellyfinStreamUrl` now builds `/Audio/{id}/stream?static=true&api_key=` (the
    ORIGINAL file, real `Content-Length`) instead of forcing the chunked
    `stream.mp3` transcode. Empirically verified in the sim: a static HTTP file
    gives mplayer a real `ID_LENGTH` and the box's `currentMeta.duration` matches
    the file exactly (426 s file → `duration:426`, stable), whereas the transcode
    reported `duration:0` — so the transcode, not RunTimeTicks, was the root cause.
    Bonus: no server-side transcode (lighter) + original quality + working seek.
    `jellyfinTranscodeUrl` kept as the documented fallback for an exotic codec the
    box's mplayer can't direct-play (it handles mp3/flac/m4a/aac/ogg/wav). (b)
    **browse limits lifted** 200→2000 tracks / 500→2000 albums so a growing library
    lists fully (owner has 513 tracks; a real pagination UI is unwarranted at ~20
    albums). Spec updated (direct-play URL + transcode-fallback test).
  - **Deferred (honest call): the access token stays in plain localStorage.**
    Encrypting only the Jellyfin token while Spotify's `clientSecret` sits in
    plaintext `config.json`, and the decryption key would have to live on the same
    headless box, is security theater — it belongs in **B0** as app-wide secret
    hardening (the consistent target is the backend `config.json`, like Spotify,
    not a browser-side crypto store). The kiosk is a trusted localhost appliance
    with no third-party JS, so localStorage is acceptable until B0.
  - **B3 (a first new service, end-to-end) is DONE** — play · API-key · QuickConnect ·
    onboarding · browse+play albums · add-to-library · real duration.
- **B10 HAT detection** — done, verified: `hwdetect.sh` + `hat-apply.sh`
  (manual wins, dry-run default, writes flag only, overlays untouched).
- **B0 / CI** — done, verified locally: `.github/workflows/ci.yml` (lint per
  workspace clean, backend tests + type-check pass, all builds incl. frontend-prod
  green, `npm ci` lock in sync, YAML valid). Not yet run on GitHub (no push).
- **B6 / theme** — new `themes/aurora.css` registered in `installedThemes`;
  verified rendering on live `ion-card`s in the sim.
- **B7 stage 1 (leaner Linux)** — NOT started. It is not verifiable in Tier A
  (no systemd/box); it needs **Tier B (QEMU aarch64)** or a real Pi. Deferred
  rather than shipping untested systemd units / `autosetup.sh` edits.
- **§6 Spotify audio path — RESOLVED** (empirically, from the box config in-repo):
  a runtime-gated **hybrid** — the kiosk (`--homepage http://localhost:8200`,
  `isLocalhost()` true) uses the **in-browser Web Playback SDK** (Widevine EME) as
  the PRIMARY path; **librespot** is the fallback for non-localhost remote
  controllers. Key consequence: **B7-stage-3 (Chromium→lighter engine) must be
  paired with an "SDK→librespot primary" switch** (librespot plays headless to
  ALSA, removing the browser from the audio path); and the B1 Spotify provider is
  a single `SpotifyConnectPlayer` (SDK-vs-librespot is a frontend device-registration
  concern). Full analysis + evidence in §6.
- **§6.1 Spotify platform watch (2026-07)** — researched the current state.
  librespot still works (moved to `login5`; the box already ships the post-fix
  `dev_0.6_20250806`). The 2024-11 Web-API deprecation does **not** hit MuPiBox
  (it calls none of the removed endpoints — verified against both backends). The
  **new** risk is operational: 2026-02 Dev-Mode now needs **Premium + ≤5 test
  users** → a box-owner onboarding concern. Confirmed **B2 SDK target =
  `@spotify/web-api-ts-sdk`** (maintenance upgrade; `spotify-web-api-node` is
  abandoned). Details + sources in §6.1.
```
