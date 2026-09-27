# Pi 4 = Pi 5: Abgleich und Rezept-Umbau

> **Stand 2026-07-30 — zurückgestellt.** Der Rezept-Umbau ist fertig und geprüft
> (remote-step-installer `b4be1d1`), der **Probelauf gegen den Pi 4 steht bewusst aus**.
> Entschieden: Die Entwicklung läuft weiter auf dem **Pi 5** (`192.168.178.169`),
> der Pi 4 wird später nachgezogen — eine Baustelle nach der anderen.
> Zum Nachziehen dann: TUI-Lauf gegen `192.168.178.99` mit `MUPI_HOST=MuPiBox2`
> (steht in `boxen.yaml`), Reihenfolge `mupibox` → `mupibox-app`, danach Neustart.

> **Nachtrag 2026-08-31 — der erste Pi-4-Weg war zu.** Nicht der TUI-Lauf oben,
> sondern der Karten-Installer (`./sdstart`): die Board-Wahl „Raspberry Pi 4"
> brach mit „Kein Abbild für RPi4 gefunden" ab. DietPi liefert **ein** 64-Bit-
> Abbild für Pi 2/3/4/Zero 2 und nennt es `RPi234` — ein `RPi4` gibt es dort
> nicht, und `sdprep.select()` vergleicht auf Gleichheit. Behoben mit
> `sdprep.BOARD_ALIAS` (RPi4/RPi3 → RPi234) und `board_aufloesen()`, das den
> Alias auflöst **und** einen Hinweis anzeigt, statt still etwas anderes zu
> nehmen. Aufgefallen ist es erst jetzt, weil alles bisher Gefahrene ein Pi 5
> war — genau die Lücke, die dieser Text seit dem 30.07. offen hält. Ausführlich
> im Wissenspaket unter `rpi4-heisst-bei-dietpi-rpi234`.

Stand: 2026-07-30 · Gemessen an beiden laufenden Boxen (Pi 4 `192.168.178.99`,
Pi 5 `192.168.178.169`), rein lesend. 162 Einzelbefunde: **37 kritisch, 50 wichtig,
15 hardware-bedingt (dürfen NICHT angeglichen werden), 60 kosmetisch, 52 identisch.**

Ziel: Der Pi 4 soll dem Pi 5 entsprechen — und beide Zustände müssen sich mit einem
TUI-Lauf des remote-step-installer **reproduzieren** lassen.

---

## Die Kernaussage

**Der Pi 5 ist von Hand großgezogen, der Pi 4 ist der reine Rezept-Stand.**
Alles, was den Pi 5 gut macht, ist an den Rezepten vorbei entstanden. Der Pi 4 zeigt
damit ungewollt genau das, was ein TUI-Lauf heute wirklich herstellt — und das ist
deutlich weniger, als man glauben würde.

Konkret: **Ein vollständiger TUI-Lauf gegen den Pi 4 würde an keinem der fünf harten
Ausfälle etwas ändern.** Kein Rezeptschritt installiert librespot. Keiner installiert
mpv. Der PipeWire-Schritt ist opt-in und lief nie. Der Kiosk-Benutzer-Schritt steigt
wegen einer Bedingung sofort aus. Der zram-Schritt meldet Erfolg, ohne etwas zu tun.

---

## Die fünf harten Ausfälle des Pi 4

### 1. librespot fehlt vollständig — kein Spotify-Ton
`/usr/bin/librespot` existiert nicht, `/etc/librespot/` existiert nicht, die Unit ist
`disabled/inactive`, der Wächter-Timer fehlt. Der Pi 5 hat 0.8.0 (selbst gebaut 28.07.).

**Der gefährliche Teil:** Beide Boxen tragen `mupibox.host = "MuPiBox"`. Die
Spotify-Geräteliste ist kontoweit und die Auswahl läuft über den **Namen** — der Pi 4
findet also ein Gerät namens „MuPiBox" (das des Pi 5) und würde dorthin abspielen.
Er wirkt bedienbar und schickt den Ton in den falschen Raum. Ein Fehler, der sich
nicht als Fehler meldet.

**Kein Neubau nötig:** Der ELF-Kopf des Pi-5-Binärs zeigt `e_machine 0xb7` (AARCH64),
beide Boxen melden `dpkg --print-architecture` = `arm64`. Das Binär läuft unverändert
auf dem Pi 4.

### 2. mpv fehlt — obwohl die Konfiguration ihn verlangt
Beide Boxen tragen `playerEngine: "mpv"`. Auf dem Pi 4 gibt es kein mpv. Der Player
fällt still auf mplayer zurück — der stille Rückfall verdeckt den Fehler dauerhaft.
**Kein Rezeptschritt installiert mpv**; der Pi 5 wurde von Hand nachgerüstet.

### 3. Falscher Tonstapel: PulseAudio statt PipeWire
Pi 4: PulseAudio 17.0, kein pipewire/wireplumber/pipewire-bin, **kein `wpctl`** —
`mupi-lautstaerke.sh` fällt deshalb dauerhaft auf den ALSA-Weg zurück.
Pi 5: PipeWire 1.4.2 + WirePlumber, PulseAudio nur noch als Paketleiche (`rc`).

Folge: **Der Pi 4 hat überhaupt keinen Bluetooth-Tonweg** — weder bluealsa noch
PipeWire-A2DP, auch `pulseaudio-module-bluetooth` fehlt. Trotzdem läuft dort alle
12 Sekunden der `mupibox-bt-reconnect.timer` ins Leere.

### 4. Kiosk läuft als root statt als dietpi
Pi 4: Chromium, xinit und Xorg alle als **root** (`agetty -a root`), `xserver-xorg-legacy`
fehlt. Pi 5: alles als `dietpi`, Xwrapper.config gesetzt.

Das ist die **Voraussetzung für PipeWire** (Benutzerdienst) und für die librespot-Unit
(`User=dietpi`, `XDG_RUNTIME_DIR=/run/user/1000`). Ohne diesen Schritt greift der Rest nicht.

### 5. MuPiHAT-Dienste aus, obwohl die Hardware antwortet
Pi 4: `mupi_hat.service` und `mupi_hat_control.service` **disabled** — obwohl
`i2cdetect -y 1` den Ladebaustein bei `0x6b` zeigt und die ExecCondition der Unit
erfüllt wäre. `/tmp/mupihat.json` enthält `[]`. Der Box fehlt damit jede
Akku-/Verstärker-Telemetrie. Ursache im Rezept: `systemd-dienste` schaltet die
`mupi_*`-Dienste **pauschal** ab („brauchen MuPiHAT-Hardware"), statt die Hardware zu prüfen.

Dazu zwei Folgefunde: `chromium.gpu` fehlt in der Konfiguration des Pi 4 → der Kiosk
läuft **ohne GPU-Beschleunigung** (das Skript wertet `null` aus und überspringt alle
fünf GPU-Schalter). Und `spotify-control.js` ist auf dem Pi 4 **777 KB kleiner** — das
ist der Baustand *vor* der librespot-Anbindung, also nicht nur eine fehlende Datei,
sondern ein anderer Wiedergabeweg.

---

## Rezept-Fehler: Schritte, die heute stillschweigend nichts tun

Das ist der eigentliche Ertrag des Abgleichs — diese Fehler erklären, **warum** der
Pi 4 so aussieht, wie er aussieht. Alle Zeilenangaben in `remote-step-installer/`.

| Schritt | Fehler | Wirkung |
|---|---|---|
| `zram` (mupibox.yaml:564) | Wachposten fragt „gibt es *irgendeinen* Swap?" | Pi 4 hat 153 MB DietPi-Datei-Swap → Schritt **meldet Erfolg, ohne zram je zu installieren** |
| `kiosk-als-benutzer` (:608) | an `MUPI_AUDIO=pipewire` gekoppelt, env setzt es nicht | steigt in Zeile 620 mit `exit 0` aus → Kiosk bleibt für immer root |
| `schneller-starten` (:206,225) | grept `initial-interval` | Debians Vorgabedatei hat die Zeile **auskommentiert** → tut auf frischer Box nie etwas |
| `pipewire` (:635) | `MUPI_AUDIO`-Guard sitzt nur im `run:` | die `put:`-Dateien werden **immer** kopiert → `80-bluez-ohne-seat.conf` liegt auf dem Pi 4 wirkungslos herum, obwohl WirePlumber fehlt |
| `mupihat-zugriff` (:346) | `put:` nutzt `von:/nach:/modus:` statt `src:/dest:/mode:` | Schritt bricht **vor** seinem `run:` ab |
| `darstellung-angleichen` (app:647) | derselbe Schlüsselfehler | dito |
| `skip-rpi-eeprom` (:97) | `run: "true"` | Platzhalter meldet Erfolg für nichts |
| `boot-animation` (app:743/753) | zwei `note:`-Schlüssel | YAML nimmt still den letzten, Begründung geht verloren |
| `ENTWURF-kiosk-nutzer.yaml` | kein `name:`/`steps:` | wird als wählbares Rezept angeboten → **jeder Runner stirbt mit AttributeError** |
| alle Runner | `check:` wird nie ausgeführt | **27 Schritte tragen eine Prüfung, keine läuft** |
| `core.py step_puts` | relative Quellen gegen CWD | Rezeptlauf hängt vom Arbeitsverzeichnis ab |
| `stepctl.py`, `rsi.py` | werten `when:` nicht aus | Modell-Gates greifen nur in der TUI |

**Und eine Falle in die andere Richtung:** `remote-step-installer/tools/mupibox-bt-reconnect.py` im Installer
ist **älter** (6199 B) als die Fassung auf dem Pi 5 (7845 B, mit Adapterwahl — die
Sicherung `.vor-adapterwahl` dort trägt exakt die Installer-Prüfsumme). Ein Rezeptlauf
gegen den Pi 5 würde ihn **zurückdrehen**. Dasselbe Risiko gilt für jeden `put:`-Schritt:
Was auf einer Box von Hand verbessert wurde, macht der nächste Lauf zunichte.

---

## Was hardware-bedingt verschieden bleiben MUSS

Diese 15 Unterschiede sind **richtig so** und dürfen beim Angleichen nicht angefasst werden:

- **DSI hängt am Pi 5 am RP1** als eigene DRM-Karte → PRIME-Offload, `02-dietpi-rpi5.conf`,
  `force-dsi-output.sh`. Am Pi 4 hängt DSI an derselben Karte — das Problem existiert dort nicht.
- **Framebuffer-Farbtiefe**: Pi 4 = 16 bpp (deshalb die RGB565-Wandlung im Boot-Splash),
  Pi 5 = 32 bpp.
- **Serielle Konsole**: `ttyS0` (Pi 4) gegen `ttyAMA0` (Pi 5); `root=PARTUUID` verschieden.
- **I2C-Busnummern**: Touch am Pi 5 auf `i2c-4`, am Pi 4 anderer Zweig; Adresse `0x20`
  zusätzlich nur am Pi 5.
- **ALSA-Kartenreihenfolge** und der Senken-Name der Onboard-/HAT-Karte.
- **Kernel-/Firmware-Pakete**, `rpi-eeprom`-Sonderregeln (nur Pi 5).

---

## Umbauplan für die Rezepte

Reihenfolge ist wesentlich — die Schritte bauen aufeinander auf.

### Stufe 0 — Runner reparieren (sonst wirkt der Rest nur zufällig)
1. `core.py step_puts`: relative Quellen gegen `repo_root()` auflösen; `von/nach/modus`
   als Synonyme akzeptieren (oder alle Rezepte auf `src/dest/mode` vereinheitlichen).
2. `stepctl.py` + `rsi.py`: `when:` auswerten (`hardware.passt()` existiert bereits und ist rein).
3. Alle Runner: `check:` nach dem `run:` **tatsächlich ausführen**.
4. `ENTWURF-kiosk-nutzer.yaml` umbenennen (`.yaml.entwurf`) — es killt heute jeden Runner.

### Stufe 1 — Fundament, muss vor allem anderen laufen
5. **Neuer Pflichtschritt `box-name`** (nach `mupiboxconfig`): setzt `mupibox.host` aus
   `$MUPI_HOST` **und** den Rechnernamen. Einziger richtiger Ort — `mupibox.host` ist
   zugleich `LIBRESPOT_NAME` und das Kriterium der Gerätewahl.
6. **`kiosk-nutzer` als Pflichtschritt** (Inhalt aus dem Entwurf), **ohne** MUPI_AUDIO-Kopplung,
   vor `kiosk`: `agetty -a dietpi`, `xserver-xorg-legacy`, `Xwrapper.config`,
   Gruppen `tty,input,video,audio,render`. Wirkt erst nach Neustart.

### Stufe 2 — Tonkette
7. **`pipewire` zur Pflicht machen** (bzw. `MUPI_AUDIO=pipewire` als Standard), Guard vom
   `run:` in ein `when:` heben, damit die `put:`-Dateien nicht mehr blind landen.
8. **Neuer Pflichtschritt `mpv`**: `apt-get install -y mpv`, `check: command -v mpv`.
9. **Neuer Pflichtschritt `librespot`** vor `librespot-nicht-blockieren`: das auf dem Pi 5
   gebaute 0.8.0-Binär per `put:` nach `/usr/bin/librespot` (0755 root:root),
   `librespot.service`, `/etc/librespot/env-librespot`, `librespot-waechter.sh` + `.timer`;
   `check:` auf `--version` beginnt mit `0.8`.
   *Vorher:* Binär vom Pi 5 holen und im Fork ablegen (z. B. `bin/librespot/0.8.0/librespot-arm64`).
   Die vorhandenen `bin/librespot/*` sind 0.6.0-dev und **unbrauchbar** (kein Ton).
10. `audio-mixer` (asound.conf) unter PipeWire aussetzen oder vor `pipewire` einsortieren —
    sonst legt er die Datei immer wieder an.

### Stufe 3 — Dienste und Feinschliff
11. `systemd-dienste`: `mupi_hat`/`mupi_hat_control` **nicht pauschal abschalten**, sondern
    Hardware prüfen (`i2cdetect -y 1 | grep -q ' 6b '`) — die ExecCondition der Unit fängt
    den Fall „kein HAT" ohnehin ab. `dienste-systemd` zur Pflicht, `dienste` (pm2) raus.
12. `zram`: Wachposten und `check:` auf **zram** statt auf „Swap vorhanden" umstellen
    (`grep -q '^/dev/zram' /proc/swaps`), vorhandenen Datei-Swap abschalten.
13. `schneller-starten`: Wachposten auf `grep -qE '^[[:space:]]*initial-interval'`.
14. `chromium.gpu` in die Konfigurationsvorlage aufnehmen **und** das Kiosk-Skript gegen
    `null` absichern (`[ "$FORCE_GPU" = true ]` statt `if ${FORCE_GPU}`).
15. `remote-step-installer/tools/mupibox-bt-reconnect.py`: die neuere Pi-5-Fassung zurück ins Repo holen.

### Stufe 4 — Zwei Boxen sauber führen
16. **Inventardatei** (`boxen.yaml`) mit beiden Boxen: Adresse, erwartetes Modell,
    `MUPI_HOST`. Heute steht keine der beiden Adressen irgendwo im Installer.
    Die box-spezifischen Werte müssen als Exporte in den Rezept-Prefix — heute reicht
    `sysinfo.py` nur `recipe['env']` durch.
17. **Ein deploy.zip für beide Boxen**: `spotify-control.js` weicht um 777 KB ab.
    Und: `bin/nodejs/deploy.zip` wird von Hand bestückt, es gibt **kein Bauskript**.

---

## Entscheidungen, die ich brauche

1. **Gerätename des Pi 4.** Zwei Boxen dürfen nicht beide „MuPiBox" heißen — sonst
   greifen sie sich gegenseitig die Wiedergabe ab. Vorschlag: Pi 5 bleibt `MuPiBox`,
   Pi 4 bekommt einen eigenen Namen. Welchen?
2. **librespot: kopieren oder bauen?** Empfehlung *kopieren* — beide Boxen sind arm64,
   das Binär läuft unverändert; ein Bau auf dem Pi 4 kostet ~30 Minuten, braucht rustup
   und ist eine zusätzliche Fehlerquelle. Nachteil: 17 MB Binärdatei im Fork-Repo.
3. **Soll der Pi 4 wirklich komplett auf den Pi-5-Stand?** Das schließt PipeWire,
   Kiosk-als-dietpi und einen Neustart ein. Alternative wäre, ihn bewusst als
   „schlanke" Box zu belassen — dann ist aber „gleich aufsetzen" hinfällig.
