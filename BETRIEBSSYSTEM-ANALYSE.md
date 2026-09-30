# Weg von DietPi? Schlanke Basis, andere Boards, die Box als App

> **Stand: 30.09.2026.** Analyse und Recherche, **kein Umbau.** Der Code-Teil
> (Abschnitt 2) ist am Baum gemessen, mit `tools/dietpi-kopplung-inventur.py`
> (am selben Tag gebaut), nicht an der Box. Die Speicherzahlen in Abschnitt 3
> stammen aus früheren Messungen an der Box (Quelle jeweils dabei). Die
> Recherche (Abschnitte 5–7) gibt den Stand der Quellen vom 30.09.2026 wieder;
> mehrere Herstellerseiten (dietpi.com, raspberrypi.com, home-assistant.io,
> balena.io, volumio.com) sperrt der Proxy dieser Sitzung, dort stützt sich die
> Aussage auf GitHub-Quellen oder Suchauszüge — das ist dann gesagt.
> Wer eine Zahl übernimmt, misst sie nach: die Kopplung soll ja sinken.

**Auftrag (Betreiber, 30.09.2026):** „mache eine analyse mit recherche ob es
noch andere möglichkeiten gibt anstatt dietpi die box aufzusetzen ich denke an
was schlankeres was ggf auch auf andere boards passt. Das die mixpibox mehr
eine "app" ist und man die app durch beispielsweise "HomeAutomate" ergänzen
austauschen kann... bisschen wie android blos sehr leichtgewichtig."
Nachfrage am selben Tag: „wieviel speicher verbrauch hat ein dietpi typisch
gibt es da hebel?" — beantwortet in Abschnitt 3.

---

## 0. Die Antwort in sechs Sätzen

1. **„Schlanker" ist beim Arbeitsspeicher der falsche Hebel:** DietPi selbst
   braucht wenige Dutzend MB; von rund 1 GB Arbeitsmenge der Box gehören fast
   alles unseren eigenen Prozessen (Chromium, Node, Piper). Ein anderes OS
   spart dort kaum etwas.
2. **Was ein eigenes Abbild wirklich gewinnt, ist Reproduzierbarkeit:** heute
   gibt es drei Ausrollwege, und der Pi 5 ist „von Hand großgezogen"
   ([ANGLEICH-PI4-PI5.md](ANGLEICH-PI4-PI5.md)). Ein unveränderliches Abbild
   mit A/B-Update beendet genau das.
3. **„Andere Boards" verlangt keinen Abschied von DietPi** — DietPi läuft auf
   Radxa ZERO 3, Orange Pi 3B/5, ROCK 5 u. a. Die Hürde ist die Hardware:
   das DSI-Display, der I²S-Verstärker und `config.txt`.
4. **Die App ist schon fast eine App:** der Laufzeit-Code ruft genau drei
   DietPi-Helfer auf. Die Kopplung sitzt im Einrichtungsweg und im Board.
5. **Was zum „leichten Android" fehlt, ist der Schnitt Plattform ↔ App:** der
   Server ist heute beides — er spielt Musik UND schaltet WLAN, Bluetooth,
   Akku, Update. Eine zweite App (HomeAutomate) braucht diese Dinge als
   gemeinsame Plattform, samt Kinderzeit, die für ALLE Apps gilt.
6. **Empfehlung:** erst den Schnitt im Bestand (auf DietPi, ohne OS-Wechsel),
   dann ein eigenes Debian-Abbild (rpi-image-gen, später Armbian für andere
   Boards) — **nicht** Buildroot/Yocto: dort gibt es kein Chromium, und der
   einzige Kiosk-Ersatz (WPE) verliert beim Abspielen Speicher und ist mit Cog
   am Lebensende.

---

## 1. Was DietPi heute für die Box tut

Wer DietPi ersetzt, muss jede Zeile dieser Tabelle neu lösen. Die meisten sind
klein; zwei (Netz, Erststart) sind es nicht.

| DietPi-Leistung | wo die Box sie nutzt | Ersatz auf anderer Basis |
|---|---|---|
| Abbild für viele Boards + Erststart-Automatik (`dietpi.txt`, `AUTO_SETUP_*`) | `remote-step-installer` (sdprep wählt DietPi-Abbilder), Rezeptschritt `dietpi-firstrun` | eigenes Abbild; Erststart ist dann schon erledigt |
| `dietpi-software` (Chromium, ALSA, Bluetooth, Dashboard) | Rezepte `mupibox.yaml` (Schritte `bluetooth`, `chromium`) | Paketliste im Abbild (apt) |
| `dietpi-set_hardware` (Soundkarte, Bluetooth, I²C) | `scripts/mupihat/enable_mupihat.sh:17`, Rezept `hardware` | Board-Profil: Overlays + Kartenname als Daten |
| Autologin + Kiosk-Start (`dietpi-login` → `scripts/chromium-autostart.sh`) | `scripts/mupibox/restart_kiosk.sh:5` ruft den Kiosk über `/var/lib/dietpi/dietpi-software/installed/` | eigene systemd-Unit für den Kiosk |
| `dietpi-ramlog`: `/var/log` als 50-MB-tmpfs | stillschweigend; jede Protokollzeile kostet RAM (Wiki `ramlog-macht-protokoll-zu-arbeitsspeicher`) | journald `Storage=volatile` mit Deckel |
| Netz über **ifupdown + wpa_supplicant** | Server und Skripte: 86 Zeilen `ifup/ifdown/interfaces`, 78 Zeilen `wpa_cli/wpa_supplicant` in 15 bzw. 10 Dateien | NetworkManager (Raspberry Pi OS, Armbian) oder systemd-networkd + iwd — **der größte Umbau** |
| Stellschrauben `dietpi-set_cpu`, `dietpi-set_swapfile`, `dietpi-set_software boot_wait_for_network` | `src/backend-api/src/server.ts:8259–8273` (Verwaltung) | je ein eigener Befehl (cpufreq, zram-generator, systemd-networkd-wait-online) |
| zram (DietPis eigenes) | Rezepte `zram`, `perf-tune.yaml` `swap-zram` | zram-generator |

---

## 2. Gemessen: wie fest hängt die Box an DietPi — und am Pi?

`python3 tools/dietpi-kopplung-inventur.py` (Stand 30.09.2026, nur von git
verfolgte Dateien, ohne Doku). Zahl = **Code-Zeilen / Dateien**, `[k]` = reine
Kommentarzeilen, die an nichts koppeln:

| Bereich | DietPi-Werkzeug | Erststart | Nutzer `dietpi` | Pi-Eigenes |
|---|---|---|---|---|
| Laufzeit-Code (src, plugins, Oberfläche) | **6/2** | 0/0 | 30/9 [40] | 4/4 [4] |
| Box-Skripte + Units (scripts, config) | 35/10 [39] | 57/3 [24] | 162/60 [84] | 47/17 [8] |
| Einrichtung (autosetup, update, Rezepte) | 145/27 [59] | 84/14 [21] | 264/35 [105] | 136/22 [18] |
| Entwicklerwerkzeuge + Tests | 76/33 [22] | 108/11 [17] | 377/163 [81] | 136/30 [16] |

Was die Zahlen sagen:

* **Laufzeit: praktisch DietPi-frei.** Die 6 Zeilen sind die drei
  Stellschrauben in `src/backend-api/src/server.ts:8259–8273` und dreimal der
  Name `dietpi-dashboard.service` in der Dienstliste
  (`src/backend-api/src/dienste.ts`).
* **Box-Skripte: 35 Zeilen, davon 23 Bash-Aliase** in
  `config/templates/.bashrc` (Bequemlichkeit, keine Abhängigkeit). Die echten:
  Kiosk-Neustart über den DietPi-Pfad (`scripts/mupibox/restart_kiosk.sh:5`),
  die DPMS-Datei (`scripts/mupibox/setting_update.sh:11`), der
  Partitions-Vergrößerer (`scripts/mupibox/startup.sh:9`), die Soundkarte
  (`scripts/mupihat/enable_mupihat.sh:17`), die Kartensuche
  (`scripts/flash-mupibox-sd.sh`).
* **Einrichtung: 10 von 69 Rezeptschritten** fassen DietPi an
  (`--rezept`: `mupibox.yaml` 6 von 33, `mupibox-app.yaml` 3 von 26,
  `perf-tune.yaml` 1 von 10).
* **Der Nutzer `dietpi` ist groß, aber mechanisch.** Im Server haben fast alle
  Pfade schon einen Umgebungs-Schalter (`MUPIBOX_PLUGIN_DIR`,
  `MUPIBOX_MEDIA_DIR`, …). Der **Abspieldienst nicht**:
  `src/backend-player/src/spotify-control.ts`, `loeschen.ts:87` und
  `befehlspfad.ts:241` tragen `/home/dietpi/MuPiBox/media` fest.
* **Pi-Eigenes zur Laufzeit: 4 Zeilen.** Die Board-Kopplung sitzt in der
  Einrichtung — im Kern fünf Overlays: `vc4-kms-v3d`, `vc4-kms-dsi-7inch`
  (das Waveshare 5″ läuft als nachgebildetes Pi-7″-Panel, Wiki
  `mupi-andere-zielhardware`), `max98357a`, `i2s-mmap`, `gpio-poweroff`.
* **Nicht im Werkzeug, weil es nicht „dietpi" heißt:** das Netz (ifupdown,
  siehe Abschnitt 1) und die ramlog-Annahme.

**Folge:** Die Kopplung sitzt nicht in der App, sondern im Einrichtungsweg und
im Board. Das ist die Voraussetzung für das App-Bild — und es heißt auch: der
OS-Wechsel ist vor allem ein **Neubau des Einrichtungswegs**, kein Umbau der
App.

---

## 3. Arbeitsspeicher: was DietPi kostet, was die Box kostet, wo die Hebel sind

### DietPi selbst

Herstellerangabe rund 30–50 MB im Leerlauf; ein Vergleich auf dem Pi 4
(DietPi v10.6, 64 Bit) nennt 109 MiB gegen 176 MiB bei Raspberry Pi OS Lite.
Beides nur als Suchauszug gelesen (dietpi.com und tech-reader.blog sperrt der
Proxy) und **nicht an der Box gemessen**. Die Größenordnung genügt für die
Aussage: die Basis ist nicht das Problem.

### Die Box (Pi 5, 2 GB)

Arbeitsmenge im Leerlauf rund 1 GB (Wiki `pi3-1gb-machbarkeit-gemessen-am-pi5`,
27.09.2026, PSS):

| Posten | PSS |
|---|---|
| Chromium (8 Prozesse) | 415–460 MB |
| Node-Server | ~190 MB, dazu ~110 MB in zram |
| Abspieldienst (Node) | ~66 MB |
| Xorg (nur für Chromium da) | 43–53 MB |
| Soloist | ~49 MB |
| Python-Dienste (MuPiHAT, Fernbedienung, step-agent) | ~49 MB |
| mpv | 34–50 MB (BACKLOG E51) |
| PipeWire + WirePlumber | ~34 MB |
| `/var/log` (ramlog) | bis 50 MB |
| **Piper, sobald einmal vorgelesen wurde** | **bis 698 MB** (nach 9,7 h, Wiki `speicher-waechst-erst-im-betrieb`) |

### Hebel, nach Gewinn sortiert

1. **Piper nach Leerlauf beenden — bis ~700 MB.** Der Dienst startet beim
   ersten Satz und bleibt danach für immer stehen
   (`src/backend-api/src/server.ts:18248`, „bleibt dann stehen"). Ein
   Leerlauf-Zeitgeber ist ein kleiner Eingriff; der Preis ist ein langsamerer
   erster Satz nach der Pause (Modell neu laden), bekannte Sätze kommen aus dem
   Vorlese-Zwischenspeicher. Ob die 698 MB mit der Laufzeit wachsen oder von
   Anfang an so groß sind, ist **nicht gemessen**.
2. **Kiosk-Browser — gut 250 MB, derzeit blockiert.** Cog spart gemessen
   267 MB (Wiki `cog-spart-267-mb-gemessen`), verliert aber beim Abspielen
   +40 MB/min und stirbt nach ~30 min (Wiki `wiedergabe-leck-im-wpe-renderer`);
   seit 06.09.2026 läuft die Box deshalb auf Chromium (Wiki
   `wiedergabe-leck-ist-wpe-chromium-bleibt-flach`). Cog selbst ist seit
   17.09.2026 ohne weitere stabile Fassungen (Igalia/cog#799), der Nachfolger
   WPEPlatform ist für Trixie nicht beschaffbar (BACKLOG, AUDIT-2026-09-19
   Rang 8).
3. **Chromium schlanker stellen — geschätzt 100–150 MB, nicht gemessen.**
   `--renderer-process-limit` und ein gedeckelter Kachelspeicher (BACKLOG,
   „Noch offen" nach E48). Kann ruckeln; braucht Messung am Schirm.
   Chromium auf Wayland unter `cage` statt auf Xorg spart die 43–53 MB von
   Xorg abzüglich cage — ebenfalls ungemessen.
4. **Node-Server — ~190 MB plus zram, nie untersucht.** Erst ein Heap-Profil,
   dann eine Grenze; sonst stürzt der Server statt zu sparen.
5. **Kleinkram:** drei Timer schreiben ~70 Protokollzeilen/min in den RAM
   (BACKLOG, „Noch offen" nach E48); step-agent + netzabriss-sonde zusammen
   28 MB (am 20.08.2026 bewusst behalten).
6. **Ein Fehler, kein Hebel:** am 27.09.2026 lagen 450 MB verwaiste
   Rohaufnahmen in `/dev/shm` (Wiki `pi3-1gb-machbarkeit-gemessen-am-pi5`).
   Ob behoben, ist im veröffentlichten Baum nicht prüfbar — das
   Aufnahme-Plugin geht nicht mit hinaus.

Schon erledigt: zram statt Auslagerungsdatei (~1 GB komprimiert), das
MuPiHAT-Protokoll auf WARNING (35,6 MB weniger im ramlog), der offene VNC.

**Folge für kleinere Boards:** 1 GB (Pi 3) nur ohne oder mit stark gestutztem
Chromium und mit Piper-Leerlauf-Ende; 512 MB nur mit WPE — und WPE steckt
gerade in der Sackgasse (Punkt 2).

---

## 4. Das Zielbild „leichtes Android" in vier Schichten

```
┌───────────────────────────────────────────────────────────────┐
│ Apps       MixPiBox (Musik) │ HomeAutomate │ …                  │
│            je: Manifest, eigene Unit + Nutzer, Web-Oberfläche,  │
│            eigener Datenordner, erklärte Rechte                 │
├───────────────────────────────────────────────────────────────┤
│ Shell      EIN Chromium-Kiosk: Starterseite + Systemleiste,     │
│            die aktive App im Vollbild-iframe                    │
├───────────────────────────────────────────────────────────────┤
│ Plattform  „HAL": Ton-Obergrenze, WLAN, Bluetooth, Akku/MuPiHAT,│
│            Helligkeit, Kinderzeit + Boxsperre, Update,          │
│            Sicherung, Handy-Kopplung — feste Liste von Aufrufen │
├───────────────────────────────────────────────────────────────┤
│ Basis-OS   unveränderliches Abbild je Board, Datenpartition,    │
│            A/B-Update mit Rückfall                              │
└───────────────────────────────────────────────────────────────┘
```

| Android | hier |
|---|---|
| Systempartition | Basis-Abbild (Abschnitt 5) |
| HAL + Systemdienste | Plattform-Dienst |
| Launcher + Statusleiste | Starterseite im Kiosk |
| APK + Manifest + Berechtigungen | App-Bündel mit Rechten (Abschnitt 6) |
| Digital Wellbeing / Elternkontrolle | Kinderzeit + Boxsperre — **in der Plattform**, nicht in der Musik-App |
| Play Store | Fassungsverzeichnis mit Kanälen und sha256 (`version.json`) + Handy-App |

### Was davon schon im Baum steht

* **Der App-Vertrag, eine Etage tiefer:** das Plugin-System (BACKLOG E35) hat
  Manifest (`plugin.json`), einzeln erteilte Rechte, abgeleiteten Namensraum,
  Worker-Trennung mit Frist und Speichergrenze — und die Lehre, die für Apps
  genauso gilt: **eine Erweiterung darf die Kinderzeit nicht umgehen**.
* **Die Plattform-Module gibt es schon als Dateien:** in
  `src/backend-api/src/` sind 24 Module mit zusammen rund 9 800 Zeilen
  Plattform, nicht Musik — `netzwerk.ts`, `funk.ts`, `bluetooth.ts`, `hat.ts`,
  `akkustand.ts`, `akkulernen.ts`, `akkuverlauf.ts`, `aktualisierung.ts`,
  `sicherung.ts`, `dienste.ts`, `system.ts`, `leistung.ts`, `protokolle.ts`,
  `systemverlauf.ts`, `vpn.ts`, `kopplung.ts`, `taster.ts`, `auth.ts`,
  `boxsperre.ts`, `kinderzeit.ts`, `schirmhelligkeit.ts`, `tonausgang.ts`,
  `ton.ts`, `tonwache.ts`.
* **Die feste Liste erlaubter Operationen** (`system.ts` AKTIONEN,
  `dienste.ts` ERLAUBTE_PRAEFIXE) — der Keim der Plattform-Schnittstelle.
* **Der Update-Kanal:** `version.json` mit stable/beta/dev und Pflicht-sha256.
* **Der iframe-Weg ist schon angedacht:** E35 hat `UiExtension` gestrichen,
  weil fremdes JS im Kiosk dem Kind den Ausschalter nehmen könnte — „später
  über iframe + engen postMessage-Vertrag". Genau das ist die Shell oben.

### Was fehlt

**Der Schnitt.** `src/backend-api/src/server.ts` hat 24 901 Zeilen und rund
300 Routen und trägt Musik und Plattform in einem. Solange das so ist, müsste
HomeAutomate entweder in den Musik-Server hineinwachsen oder WLAN, Akku und
Kinderzeit ein zweites Mal bauen.

**Und auf 2 GB zählt jeder Node-Prozess** (~66 MB kostet schon der
Abspieldienst). Deshalb: **erst der logische Schnitt** (Module + eigener
Routen-Namensraum + Rechteprüfung je App-Kennung im selben Prozess), der
Prozess-Schnitt erst, wenn es eine zweite App wirklich gibt.

---

## 5. Recherche: Basis-Systeme

Stand 30.09.2026. Querschnitt für den Pi 5: **Debian 13 selbst unterstützt ihn
nicht** (erst Forky/Sid), und Mainline-Linux kann am RP1-Chip erst Ethernet und
USB — für DSI und I²S braucht jede Option den Raspberry-Pi-Kernel.

| Option | Pi 5 | Rockchip/x86 | Kiosk-Browser | Update | Aufwand für 1 Person + Agenten | Urteil |
|---|---|---|---|---|---|---|
| **DietPi** (Ist, v10.7 vom 12.09.2026) | ja | ja — auf Nicht-Pi mit **Armbian-Kernel** | Chromium (Debian) | apt + dietpi-update | keiner | behalten, bis der Schnitt steht |
| **Raspberry Pi OS Lite + rpi-image-gen** (v2.8.0, 29.09.2026) | ja (Hersteller) | **nein, nur Pi** | Chromium (Debian/RPi) | apt, oder A/B über den Layer `image-rota` (A/B-Root + Datenpartition) | niedrig | **erste Wahl für das eigene Pi-Abbild** |
| **Armbian** (26.8, 422 Board-Konfigurationen, 152 mit Standard-Support) | ja (RPi-Kernel) | ja / ja | Chromium (Debian) | apt | niedrig | **Weg für andere Boards** |
| **debos / mkosi** | nur mit RPi-Kernel; mkosi-Weg für Pi 5 nicht belegt (UEFI-Port archiviert) | ja, Kernel selbst besorgen | Chromium (Debian) | apt, oder A/B mit mkosi + systemd-sysupdate | mittel | Reserve, falls rpi-image-gen/Armbian nicht reichen |
| **Buildroot** (2026.08) | ja, Overlays selbst einschalten | ja / ja | **kein Chromium**; WPE 2.50.5 + cog 0.18.5 | Abbild/A/B (RAUC, SWUpdate, Mender) | mittel | **nein, solange der Kiosk Chromium braucht** |
| **Yocto 6.0** (LTS bis 2030) | ja | ja / ja | WPE über meta-webkit | Abbild/A/B | **hoch** (erste Builds 2–4 h, >50 GB) | nein |
| **Alpine** (3.24) | ja | x86 ja | Chromium ja, **kein WPE** | apk (+ lbu im RAM-Modus) | mittel | nein: Node für arm64-musl nicht offiziell, librespot nur in `testing` |
| **NixOS** | nur unstable, DSI „not tested" | x86 ja | nicht geprüft | Generationen + Rollback | hoch | nein (Lernkurve, Pi-5-Stand) |

**Das stärkste Einzelsignal:** HiFiBerry hat sein Buildroot-basiertes
HiFiBerryOS aufgegeben und schreibt es als „Next Generation" auf
Standard-Debian neu (Repo zuletzt 07.09.2026) — ein kleines Team, das den
Buildroot-Weg gegangen ist und zurückkommt. Dort übrigens auch: cage + cog als
Kiosk mit „~150 MB statt ~450 MB für Chromium".

---

## 6. Recherche: App-Plattformen und Vorbilder

| Vorbild | Basis | Was eine „App" ist | Trennung | Update | Übertragbar |
|---|---|---|---|---|---|
| **Home Assistant OS** (18.3) | Buildroot, schreibgeschütztes SquashFS | seit HA 2026.2 heißen Add-ons **„Apps"**: Ordner mit `config.yaml` (slug, version, arch, options/schema, ingress) + Dockerfile; Repo = Git mit `repository.yaml` | Docker + AppArmor | RAUC A/B, auf dem Pi 5 über ein eigenes tryboot-Skript | **das Manifest-Muster und „ingress"** (App-Oberfläche eingebettet); die Basis selbst nicht (offiziell ≥ 2 GB nur für HA) |
| **balenaOS** | Yocto | Container | Container | A/B | nein: Cloud-Bindung, openBalena „perpetually in beta" |
| **Ubuntu Core** (UC26) | Ubuntu | Snap | streng | transaktional | nein: Ubuntu Frame nennt den Pi 5 nicht, Kiosk nur mit WPE (Leck) |
| **Volumio 4** | Debian Bookworm, SquashFS + Overlay `/data` | Node-Plugin-Ordner (`package.json`, `UIConfig.json`, `install.sh`) | keine | SquashFS-Tausch + Werksabbild | **Werksreset-Muster** |
| **HiFiBerryOS NG** | Debian | jeder Player ein `.deb`, dazu JSON in `players.d/` und ein eigenes nginx-Stück | keine | apt | **am nächsten an uns**: Drop-in-Registrierung je Paket |
| **piCorePlayer** | piCore, läuft im RAM | `.tcz` = SquashFS, per Loop-Mount eingehängt | keine | vor Ort | **App als eingehängtes Abbild** |
| **LibreELEC** | eigenes JeOS | Kodi-Add-on-Zip | keine | SquashFS-Tausch beim Neustart | Einzweck-System als Vorbild |
| **Phoniebox v3** | Pi OS Lite 32 Bit | Plugin-System erst geplant | — | Skript | nein |

**Container sind auf 2 GB teuer:** dockerd + containerd ~100 MiB (ein
Benchmark-Repo, 27.09.2026, Hardware unbekannt) — ein Viertel von Chromium,
bevor die erste App läuft.

**Die leichte Alternative steckt in systemd selbst** (Debian Trixie, Paket
`systemd-container`): **Portable Services** — eine App ist ein Abbild
(Ordner, raw oder SquashFS) mit eigenen Units; `portablectl attach` hängt es
ein und legt je nach Profil (`default`, `strict`, `nonetwork`, `trusted`) die
Riegel an. Kein Daemon im Dauerbetrieb, keine Container-Laufzeit. Für
Erweiterungen des Grundsystems gibt es `systemd-sysext` (legt Abbilder über
`/usr` und `/opt`, prüft die Verträglichkeit über `extension-release`).

### Die drei Muster, die sich übertragen lassen

1. **Schreibgeschütztes Grundsystem + Datenpartition, Tausch als Ganzes**
   (Volumio, LibreELEC; sicher mit A/B wie HAOS). rpi-image-gen bringt das
   A/B-Layout mit; RAUC als Debian-Paket plus das tryboot-Skript aus HAOS
   (Apache-2.0) sind die fertige Vorlage für den Rückfall.
2. **App = Bündel mit Manifest, verteilt über ein Repo** (HA `config.yaml`,
   Volumio `package.json`, HiFiBerry `players.d`). Bei uns: `plugin.json`
   eine Etage höher gezogen.
3. **App als eingehängtes Abbild statt Container** (piCore `.tcz`, systemd
   Portable Services): Tausch und Entfernen sind atomar, die Trennung kommt
   aus systemd, der Speicher bleibt bei der App.

---

## 7. Recherche: Kiosk, Starter, andere Boards

### Kiosk und App-Wechsel

* **cage** zeigt genau eine Anwendung; mehrere Fenster gehen, **wechseln
  nicht**. Weston kiosk-shell verteilt Apps auf Ausgänge, nicht auf einen
  Schirm. Der einzige fertige Umschalter ist **agl-compositor** (Automotive
  Grade Linux) — für uns zu schwer.
* **Deshalb die Shell als Webseite:** EIN Chromium, eine Starterseite der
  Plattform, die aktive App im Vollbild-iframe unter demselben Ursprung
  (Rückwärts-Proxy je App-Pfad, wie HA „ingress"). Ein Browser = ein
  RAM-Posten; zwei Browser nebeneinander passen auf 2 GB nicht.
* Native Oberflächen (flutter-pi, Slint, LVGL) laufen direkt auf DRM und
  bräuchten auf 512 MB-Boards kein Chromium — wären aber ein Neubau der
  Oberfläche. Ausgearbeitet am selben Tag als Probe mit dem Ziel „Pi 3 mit
  1 GB": [NATIV-PROBE-PLAN.md](NATIV-PROBE-PLAN.md).

### Boards (Auszug, Stand 30.09.2026)

| Board | SoC | DSI | 40-Pin Pi-kompatibel | DietPi | Bemerkung |
|---|---|---|---|---|---|
| Pi 5 (Ist) | BCM2712 | 2× 4-lane | ja | ja | 1–16 GB; seit 12/2025 drei Preiserhöhungen wegen RAM |
| Pi 4 | BCM2711 | ja | ja | ja (`RPi234`) | neu mit 3 GB |
| Pi 3B+ | BCM2837B0 | ja | ja | ja | 1 GB — siehe Abschnitt 3 |
| Pi Zero 2 W | RP3A0 | **nein** | ja | ja | 512 MB |
| Radxa ROCK 3C | RK3566 | ja, Pi-7″-Kabel passt | ja | nicht belegt | I²S an der Leiste |
| Orange Pi 3B | RK3566 | ja | ja | ja | |
| Radxa ZERO 3W | RK3566 | **nein** | ja | ja | |
| Orange Pi 5 / Zero 3 | RK3588S / H618 | ja / nein | **nein** (26-Pin) | ja | |
| Pine64 Quartz64 | RK3566 | — | — | — | Fertigung ruht bis ≥ Mitte 2027 |

### Die Hürden für Board-Unabhängigkeit, der Größe nach

1. **Das DSI-Display.** Das Waveshare 5″ tritt als Pi-7″-Panel auf
   (TC358762-Brücke, Pi-eigener Regler auf I²C 0x45, `edt-ft5406`-Touch).
   Waveshares Treiber gibt es nur für den Pi-Kernel. Auf jedem anderen SoC
   braucht es einen eigenen Device-Tree — ob Radxas Pi-7″-Overlay auf dem
   ROCK 3C das 5″ trägt, ist **nicht belegt, nur am Gerät zu klären**.
   **Ein HDMI- oder USB-Touch-Display würde diese Hürde ganz beseitigen.**
2. **Der I²S-Verstärker.** Elektrisch einfach, aber je Board ein eigenes
   Overlay und eine eigene Pin-Zuordnung (`sdmode-pin=16`, `gpio-poweroff`
   auf 4, `gpio-shutdown` auf 17 sind Pi-Nummern).
3. **Die Boot-Konfiguration.** `config.txt` gibt es nur beim Pi; Armbian
   nimmt `armbianEnv.txt` + `armbian-add-overlay`, Radxa `rsetup`, Libre
   Computer `ldto`.
4. **Der MuPiHAT über I²C** — die kleinste Hürde: meist nur die Busnummer
   (`smbus2.SMBus(i2c_device)` in `scripts/mupihat/mupihat_bq25792.py:205`
   ist schon ein Parameter).

**Deshalb ein Board-Profil als Daten** (BACKLOG B10 in
[MODERNIZATION.md](MODERNIZATION.md) hat die Erkennung schon vorgesehen):
Overlays, Kartenname der Soundkarte, I²C-Bus, GPIO-Nummern, Display-Art — und
ein Rezept, das nur noch das Profil liest.

---

## 8. Empfehlung in Stufen

Jede Stufe ist für sich nützlich; keine setzt einen OS-Wechsel voraus, bevor
Stufe 3 beginnt.

**Stufe 0 — entkoppeln im Bestand (DietPi bleibt).**
* Die drei Stellschrauben (`server.ts:8259–8273`) hinter eine
  Plattform-Funktion legen, die je Basis anders antworten darf.
* Den Kiosk über eine eigene systemd-Unit starten statt über
  `dietpi-login`; `scripts/mupibox/restart_kiosk.sh` ruft dann die Unit. (E56
  hat den Dateinamen `chromium-autostart.sh` genau wegen `dietpi-login`
  behalten — mit eigener Unit fällt dieser Zwang weg.)
* Den Abspieldienst auf dieselben Umgebungs-Schalter bringen wie den Server
  (`MUPIBOX_MEDIA_DIR` statt `/home/dietpi/MuPiBox/media` fest).
* Das Netz (ifupdown/wpa_cli) hinter eine Schnittstelle legen — die größte
  Einzelarbeit, und die einzige, die beim OS-Wechsel sonst alles blockiert.
* **Maß:** die KERNZAHL von `tools/dietpi-kopplung-inventur.py` gegen null;
  dazu den Piper-Leerlauf-Stopp aus Abschnitt 3, weil er unabhängig vom Rest
  der größte RAM-Gewinn ist.

**Stufe 1 — der Schnitt Plattform ↔ Musik-App, im selben Prozess.** Die 24
Module aus Abschnitt 4 bekommen einen eigenen Routen-Namensraum
(`/api/plattform/…`) und eine Rechteprüfung je App-Kennung. Kinderzeit und
Boxsperre wandern in die Plattform. Kein zweiter Node-Prozess.

**Stufe 2 — App-Bündel und Starterseite.** Ein Manifest (`app.json`:
Kennung, Fassung, Name, Symbol, Oberflächen-Pfad, Units, Rechte,
Datenordner), Installation und Update als Einheit, die Starterseite mit
Systemleiste und iframe. Als Beweis eine **zweite, kleine App** — z. B. ein
HomeAutomate-Panel, das ein vorhandenes Home Assistant über dessen API
bedient (HA selbst auf der Box scheidet aus: offiziell ≥ 2 GB allein).

**Stufe 3 — eigenes Abbild.** Debian Trixie über **rpi-image-gen**,
schreibgeschützte Wurzel, Datenpartition, A/B über `image-rota`; RAUC +
tryboot, wenn der Rückfall automatisch werden soll. Der remote-step-installer
schrumpft auf „Abbild schreiben, koppeln". Messen: Bootzeit, RAM, Karte
ausstecken im Betrieb.

**Stufe 4 — ein zweites Board.** Entweder ein RK3566-Board mit DSI und
Pi-kompatibler Leiste (ROCK 3C, Orange Pi 3B) — dann zuerst am Gerät klären,
ob das Display läuft — oder für echte Board-Freiheit ein HDMI/USB-Touch.
Basis dort: Armbian minimal (oder DietPi, das auf diesen Boards ohnehin den
Armbian-Kernel nimmt).

**Ausdrücklich nicht empfohlen, mit Grund:** Buildroot und Yocto (kein
Chromium; WPE leckt beim Abspielen; eigene Browser-Sicherheitspflege auf einem
Gerät im Kinderzimmer-Netz), Container-Plattformen (≥ 100 MiB Grundlast auf
2 GB), Alpine (Node arm64-musl nicht offiziell), NixOS (Lernkurve, Pi 5 nur
unstable).

---

## 9. Entscheidungen, die beim Betreiber liegen

1. **Reihenfolge:** erst der App-Schnitt auf DietPi (Stufen 0–2), der
   OS-Wechsel später — oder zuerst das Abbild?
2. **Display:** beim DSI-Panel bleiben (Board-Wahl eng) oder HDMI/USB-Touch
   zulassen (Board-Wahl frei)?
3. **HomeAutomate:** ein Panel auf der Box für ein vorhandenes Home Assistant,
   die Box als Gerät in Home Assistant (der Weg, den MuPiBox-NG laut Website
   über HACS geht), oder beides?
4. **Wessen Apps?** Nur eigene/kuratierte → Ordner + systemd-Riegel genügen.
   Fremde Apps → Portable Services mit Profil `strict`, und dieselbe
   Ehrlichkeit wie bei den Plugins (E35: „Absturz- und Verbrauchstrennung,
   keine Sicherheitstrennung").
5. **Piper-Leerlauf-Stopp** jetzt bauen (Abschnitt 3, Hebel 1)?

---

## Quellen (abgerufen 29./30.09.2026)

Basis-Systeme
* rpi-image-gen: https://github.com/raspberrypi/rpi-image-gen ·
  Layer-Doku: https://raspberrypi.github.io/rpi-image-gen/layer/index.html ·
  Vorstellung: https://www.raspberrypi.com/news/introducing-rpi-image-gen-build-highly-customised-raspberry-pi-software-images/
* Pi 5 in Debian: https://raspi.debian.net/ ·
  RP1 in Mainline: https://forums.raspberrypi.com/viewtopic.php?t=394796
* Buildroot: https://github.com/buildroot/buildroot/blob/master/CHANGES ·
  https://github.com/buildroot/buildroot/tree/master/configs
* Yocto 6.0: https://www.yoctoproject.org/blog/2026/05/13/yocto-project-6-0-wrynose-is-here/ ·
  meta-raspberrypi: https://github.com/agherzan/meta-raspberrypi ·
  meta-webkit: https://github.com/Igalia/meta-webkit
* Alpine: https://github.com/alpinelinux/aports/tree/master/main/linux-rpi ·
  Node-Plattformen: https://github.com/nodejs/node/blob/main/BUILDING.md
* Armbian: https://github.com/armbian/build/blob/main/config/boards/rpi4b.conf ·
  https://github.com/armbian/documentation/blob/main/docs/releases/26.8.md
* DietPi: https://github.com/MichaIng/DietPi/blob/master/CHANGELOG.txt ·
  Installer (Armbian-Kernel auf Nicht-Pi): https://github.com/MichaIng/DietPi/blob/master/.build/images/dietpi-installer
* mkosi: https://github.com/systemd/mkosi/blob/main/mkosi/resources/man/mkosi.1.md ·
  debos: https://github.com/go-debos/debos
* NixOS auf dem Pi 5: https://wiki.nixos.org/wiki/NixOS_on_ARM/Raspberry_Pi_5

Speicher (Suchauszüge, Seiten gesperrt)
* https://dietpi.com/forum/t/dietpi-uses-more-ram-than-rpios/23101
* https://www.tech-reader.blog/2025/05/insight-great-minimal-os-showdowndietpi.html
* https://pcbsync.com/dietpi-vs-raspberry-pi-os-lite/

App-Plattformen und Vorbilder
* HAOS: https://github.com/home-assistant/operating-system ·
  Update: https://github.com/home-assistant/developers.home-assistant/blob/master/docs/operating-system/update-system.md ·
  App-Format: https://github.com/home-assistant/developers.home-assistant/blob/master/docs/apps/configuration.md ·
  Umbenennung: https://github.com/home-assistant/architecture/discussions/1287
* balenaOS: https://github.com/balena-os/meta-balena · openBalena: https://github.com/balena-io/open-balena
* Ubuntu Core: https://documentation.ubuntu.com/core/reference/release-notes/index.html ·
  Frame-Plattformen: https://ubuntu.com/frame/docs/24/explanation/where-does-ubuntu-frame-work/
* Volumio: https://developers.volumio.com/Architecture/filesystem-architecture ·
  https://github.com/volumio/volumio-plugins-sources-bookworm
* HiFiBerryOS NG: https://github.com/hifiberry/hifiberry-os
* piCorePlayer: https://docs.picoreplayer.org/information/picore_backup/
* Phoniebox: https://github.com/MiczFlor/RPi-Jukebox-RFID/blob/future3/main/documentation/builders/installation.md
* RAUC: https://github.com/rauc/rauc · Mender: https://github.com/mendersoftware/mender-convert ·
  OSTree: https://ostreedev.github.io/ostree/atomic-upgrades/
* Docker-Grundlast: https://github.com/dsegan/docker-memory-overhead
* systemd Portable Services: https://github.com/systemd/systemd/blob/main/docs/PORTABLE_SERVICES.md ·
  portablectl in Trixie: https://manpages.debian.org/trixie/systemd-container/portablectl.1.en.html ·
  systemd-sysext: https://man7.org/linux/man-pages/man8/systemd-sysext.8.html

Kiosk und Boards
* Cog ohne weitere stabile Fassungen: https://github.com/Igalia/cog/issues/799 ·
  WebKit entfernt Cog: https://github.com/WebKit/WebKit/pull/75061
* cage: https://github.com/cage-kiosk/cage/releases ·
  Weston kiosk-shell: https://wayland.pages.freedesktop.org/weston/toc/kiosk-shell.html ·
  agl-compositor: https://docs.automotivelinux.org/en/koi/5_Component_Documentation/1_agl-compositor/
* flutter-pi: https://github.com/ardera/flutter-pi
* Pi-7″-Overlay: https://github.com/raspberrypi/linux/blob/rpi-6.12.y/arch/arm/boot/dts/overlays/vc4-kms-dsi-7inch-overlay.dts ·
  Waveshare 5″ DSI: https://www.waveshare.com/wiki/5inch_DSI_LCD
* Armbian-Overlays: https://docs.armbian.com/User-Guide_Armbian_overlays/ ·
  Radxa rsetup: https://docs.radxa.com/en/zero/zero3/os-config/rsetup
* RAM-Preise und Pi-Preise: https://www.raspberrypi.com/news/a-new-3gb-raspberry-pi-4-for-83-75-and-more-memory-driven-price-increases/ ·
  https://www.jeffgeerling.com/blog/2026/dram-pricing-is-killing-the-hobbyist-sbc-market/
* Quartz64-Pause: https://www.hackster.io/news/pine64-calls-time-on-the-linux-hardware-market-ceases-production-until-the-ai-bubble-bursts-a865c8345041
