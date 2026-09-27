# Testing this build on real hardware

This fork carries changes that are **not** in upstream `splitti/MuPiBox`
(Spotify PKCE fixes, playlist split, remote‑HTTPS single‑origin proxy + auto‑TLS,
box‑wide Jellyfin, admin Spotify/Jellyfin pages, less idle polling — see
`version.json` 4.3.0). To run them on a Pi you must get **this repo's code +
`bin/nodejs/deploy.zip`** onto the box. The pre‑built artifact is already
refreshed from `src/` (`src/deploy.sh`), so no build happens on the Pi.

## The one prerequisite: make this code reachable

The installer/updater clones a Git repo. Pick one:

- **A fork (recommended).** Push this repo to your own GitHub/Gitea fork, e.g.
  `git remote add fork <url> && git push fork <branch>`. Then point the scripts
  at it (see below).
- **Manual copy.** `scp` this whole repo folder to the box and run the installer
  against the local copy (skip the clone step).
- **Baked onto the SD (no fork, no clone).** For a fresh boot stick, Path B below
  bakes this exact code onto the SD and installs it offline — see
  `scripts/make-boot-sd.sh`. This is the recommended way if you can't push a fork.

The upstream URL is hard‑coded in a handful of places — change the owner/repo/branch:

- `autosetup/autosetup.sh` — the `git clone …/splitti/MuPiBox…` and the
  `raw.githubusercontent.com/splitti/MuPiBox/main/version.json` fetch.
- `update/start_mupibox_update.sh` — same two (the `MUPI_SRC` clone + version.json).
- `AdminInterface/www/admin.php` + `spotify.php`/`jellyfin.php` links use
  `splitti/MuPiBox/main` for the news/version check (cosmetic).

## Path A — update an existing MuPiBox (fastest)

If you already have a working box:

1. Get this repo onto it (fork clone or scp) as `MUPI_SRC`.
2. Run the updater's install steps (it does: `systemctl stop mupibox-server
   mupibox-player` → unzip `bin/nodejs/deploy.zip` into
   `~/.mupibox/Sonos-Kids-Controller-master/` → copy `spotify-control.js` to
   `~/.mupibox/spotifycontroller-main/` → `systemctl start mupibox-server
   mupibox-player`). Either trigger it from the **Admin panel →
   Admin → Update**, or run `update/start_mupibox_update.sh` pointed at your fork.
   *(Bis 14.08.2026 stand hier `pm2 stop server` / `pm2 start server` + `pm2
   save` — das war seit der systemd-Umstellung wirkungslos und liess den
   Abspieldienst ganz aus.)*
3. Reboot (or `sudo systemctl restart mupibox-server mupibox-player` + restart
   the kiosk).

Your `data.json` / `mupiboxconfig.json` (media, tokens) are preserved.

## Path B — fresh boot stick (self‑contained, no fork)

This bakes **this** code onto the SD so first boot installs it offline (only the
usual distro/apt/node deps are fetched online). `autosetup` gained a local‑source
mode (`MUPI_LOCAL_SRC`), and `scripts/make-boot-sd.sh` wires it up for you.

1. **Flash DietPi** (Bookworm, the matching arch — RPi 3/4/Zero 2) to the SD with
   the Raspberry Pi Imager / balenaEtcher / `dd`. Don't boot it yet.
2. **Re‑insert the SD** so the desktop mounts its FAT **boot** partition (e.g.
   `/media/$USER/bootfs`).
3. **Stage this code onto it** (run on this machine, from the repo root):

   ```bash
   scripts/make-boot-sd.sh /media/$USER/bootfs
   ```

   It builds `MuPiBox-<ver>.tgz` from HEAD (incl. `bin/nodejs/deploy.zip`), copies
   the patched `autosetup.sh` + a generated `Automation_Custom_Script.sh`, and
   sets `AUTO_SETUP_CUSTOM_SCRIPT_EXEC=1` in `dietpi.txt`. (Commit first — it ships
   the last commit, not uncommitted edits.)
4. **Give DietPi network + headless config** on the same boot partition:
   `dietpi.txt` → `AUTO_SETUP_AUTOMATED=1` + locale, and `dietpi-wifi.txt` →
   your Wi‑Fi SSID/key (or use Ethernet). The Pi must reach the internet on first
   boot (autosetup apt‑installs node 22, librespot, lighttpd, …).
5. **Eject, insert into the Pi, power on.** DietPi runs its first‑run setup, then
   our installer (progress: `/var/tmp/mupibox-firstboot.log` on the box, plus
   `/tmp/autosetup.log`). It reboots into the MuPiBox kiosk.
6. Freeze the result into a shareable image later with
   `documentation/create_image.md` (dd + pishrink — it also has you delete
   `Automation_Custom_Script.sh` first so the image doesn't re‑install).

Fallback (with a fork): drop your fork's `autosetup/autosetup.sh` as
`Automation_Custom_Script.sh` (or `curl <fork raw>/…/autosetup.sh | bash`) — the
old online path, unchanged.

## What to verify on the hardware

- **Spotify playback** (the real target — the preview browser has no Widevine):
  a track plays and keeps going; pause/next work.
- **Spotify setup from another computer** (BACKLOG E22, since 2026‑08‑04 — this
  step used to say "register `https://<box-ip>:8200/spotify` as the redirect
  URI"; that address is wrong twice over: TLS lives on 8443, not 8200, and the
  browser has not sent a per‑host redirect URI since E22/R1):
  register **`http://127.0.0.1:8200/spotify`** in the Spotify dashboard — the
  loopback literal is the only http redirect Spotify still accepts, it is the
  same in every network and needs no certificate. Then open
  `http://<box‑ip>:8200/spotify` (plain http, no warning), log in, and paste the
  address of the resulting 127.0.0.1 **error page** back into the field on that
  same page/tab. The error page is expected — nothing listens on your laptop's
  loopback; the code is in its address bar.
  `tools/spotify-rueckweg-abgleich.py` checks that every place naming this
  address still names the same one.
- **Jellyfin:** set the server + API key in **Admin → Jellyfin**; the app picks
  it up box‑wide (a per‑browser QuickConnect login still wins).
- **Playlist album‑split**, cover‑flip track lists, the source badges.
- **Admin pages** reachable at `http://<box‑ip>` (lighttpd), Spotify/Jellyfin
  panels save into `mupiboxconfig.json`.
- **Responsiveness/idle:** the box should be noticeably calmer when nothing plays
  (idle HTTP polling was cut from ~2.4/s toward ~0.3–0.5/s).

## Notes / gaps

- `src/deploy_on_device.sh` ist seit 05.08.2026 **abgeloest** und bricht mit
  Code 64 ab (Gruende stehen im Kopf der Datei: pm2 statt systemd, `mv` in ein
  Verzeichnis, das es nicht gibt, `rm -rf www` vor dem Kopieren).
- Der Ausrollweg auf die **laufende** Box ist `python3 tools/ausliefern.py`
  (bzw. `mupictl --device <host> deploy`, das genau dorthin durchreicht). Er
  baut, prueft die Bauausgabe auf ihren **Zeitstempel** (esbuild endet auch mit
  0, wenn es nicht schreiben konnte), stoesst `mupibox-sicherung.py --anlegen`
  an, tauscht atomar (`renameat2(RENAME_EXCHANGE)` — keine Luecke, in der `www`
  fehlt), startet die betroffenen systemd-Dienste und misst danach am Geraet
  nach. `--probe` prueft alles, ohne zu tauschen. Fuer eine **frische Karte**
  gilt weiterhin `src/deploy.sh` → `bin/nodejs/deploy.zip` (Pfad A).
- MuPiHAT (audio amp + battery) is unaffected by this cycle's changes — the
  `/tmp/mupihat.json` contract + `hat_active` are untouched.
