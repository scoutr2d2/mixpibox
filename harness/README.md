# MuPiBox dev harness (Tier A simulation)

Run the MuPiBox software stack on an **x86 dev machine**, no Raspberry Pi and no
MuPiHAT hardware needed. This is "Tier A" in [../MODERNIZATION.md](../MODERNIZATION.md) §5
and the foundation that makes the modernization work testable locally.

## What it runs

| Service | Port | What |
|---|---|---|
| `backend-api` | 8200 | Express 5 / TS, dev mode (`tsx watch`). Serves `/api/*` + (in prod) the UI. |
| `backend-player` | 5005 | Express 4 / **TS**, dev mode (`tsx`) + **mplayer** (the generic url/file audio engine). Hier stand bis zum 26.08.2026 „JS" — gemessen: 20 `.ts`, **null** `.js`. |
| `mupihat-mock` | — | Writes a synthetic `/tmp/mupihat.json` on the real HAT schema (varying battery SOC / charge state). Replaces the BQ25792/I²C hardware. |
| `frontend` *(opt-in)* | 4200 | Angular dev server (`ng serve`). Enable with `--frontend`. |

The MuPiHAT hardware itself is **not emulated** — it is mocked at the
`/tmp/mupihat.json` contract boundary, which every consumer (backend-api
`/api/mupihat`, the frontend `mupihat-icon`, `fan_control.py`, mqtt/telegram)
reads. See MODERNIZATION.md §3.

## Usage

From the repo root:

```bash
./mupictl up              # start backends + HAT mock
./mupictl up --frontend   # also start the Angular dev server (:4200)
./mupictl state           # show the simulated battery + /api/mupihat
./mupictl api /api/data   # curl the seed media library
./mupictl logs backend-api
./mupictl down
```

Open **http://localhost:8200/api/data** (seed library) or, with `--frontend`,
the UI at **http://localhost:4200** (it calls the mapped :8200/:5005 on the host).

## Seed data

`seed/` holds a small, self-contained config + a `data.json` with one item per
provider type (`radio`, `rss`, `library`, `spotify`) so all playback paths are
represented. Spotify metadata needs real credentials — put a `clientId`/`clientSecret`
into `seed/config-api.json` + `seed/mupiboxconfig.json` to exercise it.

Writable runtime files live in `state/` (git-ignored): the mock's `mupihat.json`
and the resume files. Delete `state/` to reset.

## Notes / limitations

- First `up` runs `npm install` inside each container (into named volumes) and,
  for the frontend, compiles Angular — the first start is slow, later ones are fast.
- No Chromium kiosk, no systemd — this harness targets the **app
  stack** (frontend + backends), which is where the modernization work happens.
  For the OS/boot/systemd layer use Tier B (QEMU aarch64); for real I²C/I²S/touch
  use Tier C (a real Pi + MuPiHAT). See MODERNIZATION.md §5.
- The host needs Docker. It does **not** need Node/mplayer installed — the
  containers provide them (Node 22, matching the box).
- **Das `admin`-Profil in `docker-compose.yml` startet nicht mehr** (Stand
  26.08.2026). Es mountet `../AdminInterface/www`; der PHP-Admin ist mit E47 am
  19.08.2026 ausgebaut, im Baum liegen **null** versionierte Dateien darunter
  und **null** `.php`. `docker compose … --profile admin up` scheitert am
  fehlenden Mount. Gemeldet als `AUDIT-2026-08-25.md` §10 (Vorschlag: Profil,
  `admin-entrypoint.sh` und `MUPI_ADMIN_DEBUG` löschen) — bis dahin steht es
  hier, damit niemand den Weg sucht.

  **Warum das hier vier Wochen unsichtbar war:** an dieser Stelle stand „No
  Chromium kiosk, **no PHP admin**, no systemd". Der Satz war beim Schreiben
  **falsch** (das Profil war da) und ist durch E47 **von allein richtig**
  geworden — und deckte dabei genau das tote Profil zu, das er zu bestreiten
  schien. Eine Verneinung, die zufällig wahr wird, ist keine Korrektur.
