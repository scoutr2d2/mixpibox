# Nativ-Probe: der Kinderschirm ohne Browser — Plan

> **Stand: 30.09.2026. PLAN — nichts davon ist gebaut.** Auf Wunsch des
> Betreibers erst der Plan, dann der Bau. Die Zahlen aus der Box stammen aus
> früheren Messungen am Pi 5 (Quelle jeweils dabei), die Recherche-Angaben aus
> Quellen vom 30.09.2026 (Abschnitt 1, dort auch die Web-Engines).
> Vorgeschichte: [BETRIEBSSYSTEM-ANALYSE.md](BETRIEBSSYSTEM-ANALYSE.md),
> Abschnitte 3 (Speicher) und 7 (Kiosk).

**Auftrag (Betreiber, 30.09.2026):** „wenn man nochmal das mixpi box system
anschaut gibt es da möglichkeiten ggf von chromium, cog... wegzukommen mit
einer nativen app mit biblioteken..." — dann: „ich stelle mir mal einen
schnelle test version vor ziel ist es auf raspi 3 mit 1gb auch noch lauffähig
zu sein" — und: „mache erst mal einen detailierten plan".

---

## 0. Der Plan in fünf Sätzen

1. Eine kleine **Flutter-App** (`nativ-probe/`) zeigt den Kern des
   Kinderschirms direkt auf dem Bildschirm (DRM) über **flutter-pi** — ohne
   Chromium, ohne Xorg, ohne Wayland.
2. Sie spricht **dieselben Endpunkte** wie die heutige Oberfläche; Kinderzeit,
   Sperre und Lautstärke-Obergrenze bleiben, wo sie sind: im Server.
3. Sie beantwortet **eine Frage mit Zahlen:** passt die Box ohne Browser auf
   1 GB? Gemessen wird der Speicher im Leerlauf **und über 30 Minuten
   Wiedergabe** (das WPE-Leck zeigte sich nur dort), die Bildrate auf dem
   Pi 3 und die Startzeit.
4. **Vier Phasen, jede mit Abbruchkriterium.** Phase 0 (ein nacktes
   Flutter-Beispiel auf dem Pi 3) kostet einen halben Tag und entscheidet, ob
   der Rest lohnt.
5. **Nicht Teil der Probe:** Eltern-Bereich, Gestalter und Themen,
   Schubladen-Apps, Bildschirmtastatur, Videos, Vorlesen — und der Umstieg
   selbst. Die heutige Oberfläche bleibt unangetastet.

---

## 1. Warum Flutter — und was Plan B ist

| | Flutter (flutter-pi) | Plan B: LVGL 9.6 | verworfen |
|---|---|---|---|
| direkt auf DRM | ja, ohne X11/Wayland | ja | Iced, egui, GTK4 (brauchen cage) |
| Pi 3 | „known working" für Pi 2/3/4 **inkl. 512-MB-Modelle** und Zero 2 (README) | ja (HelixScreen auf Pi 3/4/5) | |
| Speicher | **nicht belegt** — zitiert wird alles zwischen ~75 MB (Embedded-Messung) und >400 MB (Desktop-Flutter) | ~15 MB (HelixScreen) | |
| Codeteilung | **Handy-App ist Flutter** (`handy-app/`, 5 700 Zeilen, API-Client zur Box) | keine (C) | Qt: keine; Slint: keine |
| Glas-Effekt | `BackdropFilter`, auf schwacher GPU teuer | Blur seit 9.5 | Slint: kein Hintergrund-Blur |
| Tests | Widget- und Golden-Tests, am Desktop | LVGL-Pro-CLI (kostenpflichtig) | |
| Gestalter | dieselbe App baut für Web → Vorschau = echte Oberfläche | Online-Viewer | |
| Pflege | **eine Person**, zuletzt schleppend; Toyota **ivi-homescreen** trägt dieselbe App (sehr aktiv), sein Vulkan-Weg geht auf dem Pi 3 aber nicht | sehr aktiv | |

**Warum trotzdem erst Flutter:** Es ist der einzige Weg, der die Handy-App
mitnimmt und den Gestalter behält — und die offene Speicherfrage ist genau
das, was die Probe misst. Reißt Flutter die Grenze in Phase 0, kommt LVGL als
eigene Probe mit denselben Messpunkten. Qt scheidet aus (keine Codeteilung,
Qt Virtual Keyboard nur GPLv3; Qt 6 mit eglfs auf dem Pi 5 nicht belegt),
Slint ebenso (kein Hintergrund-Blur, KMS-Weg „still experimental", frei nur
unter GPLv3).

### Und die Web-App behalten, nur mit leichterer Engine?

Für das **Pi-3-Ziel** reicht das nicht: Chromium selbst warnt unter 1 GB, und
seine 415–460 MB passen nicht neben die ~620 MB aus §2. Die Recherche vom
30.09.2026 im Einzelnen:

| Weg | Stand | Urteil für 1 GB |
|---|---|---|
| Chromium unter **cage** (Wayland) statt Xorg, dazu `--renderer-process-limit=1 --in-process-gpu` | cage ist in Trixie paketiert; Ersparnis auf dem Pi **nicht belegt** — höchstens der Xorg-Anteil (~50–100 MB); `--single-process` laut Chromium „not a safe or robust process model", also nicht | hilft dem Pi 5, nicht dem Pi 3 |
| **WPE 2.54** mit WPEPlatform direkt auf DRM | erschienen 16.09.2026, Skia-Compositor (+36 % MotionMark am Pi 4), Touch über libinput; nur in Debian **sid**; **kein fertiger Kiosk-Starter** (MiniBrowser ist ein Testwerkzeug, Cog ohne Nachfolger); ein Leck-Fix für den Fall der Box steht in keinen Release-Notes | nur mit eigenem Starter und einer neuen 30-min-Messung |
| **Servo** 0.5 | Linux-aarch64 seit 31.08.2026; `backdrop-filter`, Masken und scroll-snap fehlen; braucht einen Compositor | nein |
| **Ladybird** | „pre-alpha", braucht Qt ≥ 6.9 (Trixie hat 6.8) | nein |
| **Sciter** | eigener CSS-Dialekt, kein `localStorage`/`EventSource`, braucht X11/Wayland | Neubau der Web-App — dann gleich nativ |
| Ultralight, Blitz, litehtml, Tauri | proprietär bzw. ohne JS bzw. WebKitGTK (dieselbe Engine wie WPE) | nein |

**Folge für diesen Plan:** Phase 2 misst als Maßstab auch **Chromium unter
cage mit den zwei Schaltern** — das ist der Weg „bleiben" für den Pi 5. Ein
WPE-2.54-Versuch bleibt ein eigenes Vorhaben (Starter schreiben), nicht Teil
dieser Probe.

**Offen und erst am Gerät zu klären:** welchen Renderer flutter-pi auf der
Pi-3-Grafik (VC4, Mesa `vc4`, OpenGL ES 2) mit aktuellem Flutter benutzt — das
README sagt es nicht, und Impellers OpenGL-Weg ist laut Flutter noch nicht
fertig. Das ist die erste Frage von Phase 0.

---

## 2. Das Speicherbudget auf 1 GB — gerechnet, nicht gemessen

Posten aus dem Wiki `pi3-1gb-machbarkeit-gemessen-am-pi5` (27.09.2026, PSS,
Pi 5). **Vorsicht:** Der Pi 5 läuft mit 16-KB-Seiten (Wiki
`pi5-hat-16k-seiten`), der Pi 3 mit 4 KB — dieselben Prozesse können dort
kleiner ausfallen. Die Rechnung ist eine Obergrenze, keine Messung.

| Posten | heute (Pi 5) | auf 1 GB ohne Browser |
|---|---|---|
| Chromium + Xorg | ~460–560 MB (E54, E57) | **0** |
| Oberfläche (Probe) | — | **Budget: ≤ 150 MB** |
| Node-Server | ~190 MB (+~110 in zram) | ~190 MB |
| Abspieldienst (Node) | ~66 MB | ~66 MB |
| Soloist bzw. librespot | ~49 MB | ~49 MB |
| Python-Dienste (MuPiHAT, Fernbedienung, step-agent) | ~49 MB | ~49 MB |
| mpv | 34–50 MB | 34–50 MB |
| PipeWire + WirePlumber | ~34 MB | ~34 MB |
| `/var/log` (ramlog) | bis 50 MB | bis 50 MB |
| Piper | bis 698 MB | **0** (aus oder Leerlauf-Ende, siehe §7) |
| **Summe** | | **~620–640 MB** |

Dazu kommen Kernel und der **CMA-Bereich der Grafik**, der auf dem Pi 3 vom
1 GB abgeht (`grep Cma /proc/meminfo` am Gerät ablesen; einstellbar über
`dtoverlay=vc4-kms-v3d,cma-…`). **Knapp, aber denkbar** — deshalb misst die
Probe die ganze Box, nicht nur die Oberfläche.

---

## 3. Was die Probe zeigt — und was nicht

### Drin

| Bildschirm | Endpunkte (dieselben wie `NewDesign/app.js`) |
|---|---|
| **Kopfleiste:** Boxname, Uhr, Akku | `/api/config` (`mupibox.host`, `maxVolume`), `/api/mupihat` |
| **Cover-Raster** des aktiven Profils, seitenweise wischen | `/api/werke`, `/api/bild/…` |
| **Tipp auf ein Cover** spielt | `/api/spielen` — die Kinderzeit prüft der Server, wie heute |
| **Mini-Player** unten: Cover, Titel, Pause/Weiter, vor/zurück, Lautstärke | `/player/state` bzw. der Strom `/api/box/strom`; Befehle `/player/current/<befehl>` |
| **Profilwahl** (ohne Passwörter) | `/api/profile`, `/api/profil/auswahl` |
| **Pause-Schirm** bei Sperre und Kinderzeit-Ende | `/api/kinderzeit/stand`, `/api/boxsperre` |

**Lastschalter** (Kommandozeile), damit gemessen wird, was teuer ist:
`--glas` (Glas-Effekt hinter Player und Kopfleiste), `--wellen`
(Pegel-Wellen 25 Bilder/s aus `/player/pegelstrom`), später `--video`.

**Messmodus** `--mess`: alle 10 s eine JSON-Zeile auf stdout — PSS und RSS
aus `/proc/self/smaps_rollup` (in kB, **nie** aus `statm` mit fester
Seitengröße), Größe des Bild-Zwischenspeichers, Bildzeiten p50/p90/p99 über
`SchedulerBinding.addTimingsCallback`.

### Bewusst draußen

Eltern-Bereich (gehört auf Dauer eher in die Handy-App), Gestalter und
Themenwechsel (die Probe nimmt EIN festes Thema), Schubladen-Apps,
Bildschirmtastatur, Interpreten, Titelkarte, Belohnungs-Videos, Sprach-Clips
(würden über ALSA mit PipeWire um das Gerät streiten — später über den
Server). Die Probe **ersetzt nichts** und wird nicht ausgerollt.

---

## 4. Wo was im Baum liegt

* **`nativ-probe/`** — die Flutter-App, eigener Ordner, als Ganzes wieder
  löschbar. Darin `lib/` (Schirme, Messmodus), `test/` (Widget- und
  Golden-Tests), `werkzeuge/` (Bau- und Messskripte), `README.md`.
* **Codeteilung mit der Handy-App:** `handy-app/lib/box_client.dart` und
  `handy-app/lib/modell.dart` ziehen in ein **reines Dart-Paket**, das beide
  Apps benutzen. Die Handy-App behält ihre zwei Dateien als
  `export`-Weiche; ihre Tests (`handy-app/test/box_client_test.dart`) müssen
  **unverändert** grün bleiben.
  **Eine nötige Änderung:** der Client schickt bei jeder Anfrage
  `x-mixpi-app: fernbedienung` — und die Box wertet **jeden** Wert dieses
  Kopfes als Handy und zeigt ein Handy-Zeichen in der Leiste
  (`src/backend-api/src/server.ts:1137`, `handysZuletzt`). Ein anderer Wert
  genügt also nicht: für die Probe muss der Kopf **ganz wegfallen**. Er wird
  ein abschaltbarer Parameter mit der heutigen Vorgabe.
* **Anmeldung:** keine. Die Probe ruft `http://127.0.0.1:8200`, und die Box
  verlangt von der Rückschleife nie ein Passwort
  (`src/backend-api/src/auth.ts`, Regel 3). Der Herkunftsriegel lässt eine
  App ohne `Origin` durch (Wiki `handy-app-flutter-fernbedienung`).
* **Entwicklungs-Gegenstelle:** `tools/neu-vorschau.mjs` — die Attrappe, gegen
  die schon die Web-Oberfläche entwickelt wird, bedient die Endpunkte aus §3.
  Kein zweites Attrappen-Rezept (Wiki `attrappe-luegt-durch-weglassen`: was
  sie nicht liefert, fällt dort zuerst auf).
* **Messwerkzeuge werden erweitert, nicht neu gebaut:**
  `tools/kiosk-benchmark.py` kennt heute `chromium` und `cog` und bekommt
  eine dritte Familie `nativ` (Prozess `flutter-pi`);
  `tools/box/renderer-speicher-verlauf.py` trägt die 30-Minuten-Strecke.
* **CI:** ein Lauf neben `.github/workflows/handy-app.yml` für `nativ-probe/`
  (analyze, test, Golden).

---

## 5. Die Phasen

### Phase 0 — Geht Flutter überhaupt auf dem Pi 3? (≈ ½ Tag, am Gerät)

1. **Testgerät, nie die Kinderbox:** Pi 3 mit DietPi (64-Bit-Abbild
   `RPi234`, Wiki `rpi4-heisst-bei-dietpi-rpi234`), KMS (`vc4-kms-v3d`),
   dasselbe DSI-Display wie heute (`vc4-kms-dsi-7inch`). Kein Pi 3 da →
   eine **Pi-5-Testbox mit `total_mem=1024`** in `config.txt` (Vorschlag aus
   dem Wiki `pi3-1gb-machbarkeit-gemessen-am-pi5`): richtig für den
   Speicher, **falsch für die Bildrate** (andere GPU).
2. flutter-pi auf dem Gerät aus der Quelle bauen (Paketliste im README:
   `libgles2-mesa-dev libegl1-mesa-dev libdrm-dev libgbm-dev libinput-dev
   libsystemd-dev libudev-dev libxkbcommon-dev fontconfig`).
3. Am Entwicklungsrechner ein Flutter-Beispiel mit
   `flutterpi_tool build --arch=arm64 --release` bauen, hinüberkopieren,
   Kiosk aus, starten.
4. **Ablesen:** Renderer und GLES-Version aus dem Start-Protokoll, Touch
   geht (auch Rotation), PSS des nackten Prozesses (zweimal mit Abstand),
   CMA-Größe, Zeit bis zum ersten Bild.

**Abbruch:** startet nicht, kein Touch, oder der nackte Prozess liegt über
**120 MB PSS** → Plan B (LVGL-Probe) statt Phase 1.

### Phase 1 — Die Probe bauen (≈ 1–2 Tage, am Entwicklungsrechner)

1. Gerüst `nativ-probe/`, Lauf als Linux-Desktop-App gegen die Attrappe,
   Fenster 800×480.
2. Dart-Paket aus der Handy-App ziehen (§4); Handy-App-Tests grün, App-Kopf
   als Parameter.
3. Die Bildschirme aus §3. **Cover mit Deckel:** Bilder in Kachelgröße
   dekodieren (`cacheWidth`) und den Bild-Zwischenspeicher begrenzen —
   ungedeckelt ist genau das der größte Speicherposten einer Flutter-App mit
   hundert Covern.
4. Messmodus und Lastschalter.
5. Tests: Widget-Tests gegen einen Attrappen-Client, **drei Golden-Bilder**
   (Raster, Player, Pause-Schirm). Jede Wache einmal absichtlich brechen und
   rot sehen (`AGENTS.md`, „Grün glauben statt gegenprüfen").

**Ergebnis:** läuft am Desktop, Tests grün, Bildschirmfotos im Bericht.

### Phase 2 — Messen (≈ 1 Tag, am Gerät)

1. Echte Box-Dienste laufen, Kiosk aus, Probe an. Das Startskript bringt
   den Kiosk **in jedem Fall** zurück — auch bei Abbruch (die Box hat keine
   Tastatur; Regel aus E56: der Rückfall ist die Bedingung, nicht die Kür).
2. **Leerlauf:** drei Läufe mit Abstand.
3. **Wiedergabe:** 30 Minuten leise, dieselbe Strecke wie im Wiki
   `wiedergabe-leck-im-wpe-renderer`; Steigung der PSS.
4. **Wischlast:** 60 s Raster blättern; Bildzeiten mit und ohne `--glas`,
   mit und ohne `--wellen`.
5. **Ganze Box:** `MemAvailable`, zram-Belegung, `dmesg` auf OOM, über die
   30 Minuten.
6. **Gegenmessung Chromium auf demselben Gerät** — ohne sie fehlt der
   Maßstab. Auf dem Pi 5 zusätzlich Chromium unter cage mit
   `--renderer-process-limit=1 --in-process-gpu` (§1): das ist die Zahl für
   „bleiben".

### Phase 3 — Entscheiden und festhalten (≈ ½ Tag)

Ergebnistabelle als Nachtrag in diesen Plan, Wiki-Eintrag
(`tools/wiki-anhaengen.py`), dann entscheidet der Betreiber:

* **Umstieg** — eigener Plan: dritter Wert `nativ` für
  `mupibox.kioskBrowser` mit Rückfall auf Chromium, Eltern-Bereich in die
  Handy-App statt nachbauen, Gestalter als Flutter-Web.
* **Plan B** — LVGL-Probe mit denselben Messpunkten.
* **Bleiben** — Chromium schlanker stellen (BETRIEBSSYSTEM-ANALYSE.md §3).

---

## 6. Erfolgskriterien — Vorschlag, der Betreiber bestätigt

| Messgröße | Ziel | Grenze | Maßstab heute |
|---|---|---|---|
| Oberfläche, PSS im Leerlauf | ≤ 120 MB | ≤ 180 MB | Chromium + Xorg 537–557 MB (Pi 5, E57) |
| Oberfläche, Steigung über 30 min Wiedergabe | ≤ 0,5 MB/min | ≤ 1 MB/min | Chromium flach, WPE +40 MB/min |
| ganze Box, `MemAvailable` nach 30 min (Pi 3, Piper aus) | ≥ 200 MB | ≥ 120 MB, kein OOM | — |
| Raster wischen, p90 Bildzeit auf dem Pi 3 | ≤ 16,7 ms | ≤ 33 ms | — |
| Tipp bis sichtbare Reaktion | ≤ 100 ms | ≤ 200 ms | — |
| Start bis erstes Bild | ≤ 3 s | ≤ 6 s | Chromium 2,7 s (Pi 5) |
| CPU im Leerlauf | ≤ 5 % eines Kerns | ≤ 10 % | Chromium 7–9 % (Pi 5) |

---

## 7. Was die Box außer der Oberfläche für 1 GB braucht

Nicht Teil der Probe, aber ohne diese Punkte hilft auch die beste Oberfläche
nicht:

* **Piper** aus oder mit Leerlauf-Ende (bis 698 MB,
  `src/backend-api/src/server.ts:18248`) — Entscheidung steht aus.
* **CMA-Größe** der Grafik auf dem Pi 3 ablesen und passend setzen.
* **Node-Server-Heap** (~190 MB) einmal profilieren.
* Der **`/dev/shm`-Fehler** mit verwaisten Rohaufnahmen (27.09.2026: 450 MB)
  muss behoben sein — auf 1 GB wäre er der Absturz.
* zram bleibt.

---

## 8. Risiken

* **flutter-pi hängt an einer Person.** Ausweg ivi-homescreen — dessen
  bestätigter Weg ist aber Vulkan (Pi 4/5); ob sein EGL-Weg auf dem Pi 3
  trägt, ist nicht belegt.
* **Renderer auf VC4** (Skia oder Impeller, GLES 2) — unbelegt, Phase 0.
* **Glas-Effekt** auf der Pi-3-GPU vermutlich zu teuer → darf dort
  wegfallen? (Entscheidung 5).
* **Cover-Dekodierung** frisst ohne Deckel Speicher (§5, Phase 1.3).
* **DRM gehört einem:** Xorg/Chromium müssen aus sein; ein Messskript ohne
  sicheren Rückweg hinterlässt eine schwarze Box ohne Tastatur.
* **Schriften:** die Probe nimmt die Schriften aus `NewDesign/schriften`
  (Lizenz vor dem Einbinden prüfen) und hält die Regel „kein einziges Emoji"
  aus `NewDesign/app.js`.
* **Das Prüfnetz fehlt:** 153 von 277 JS/TS-Werkzeugen in `tools/` treiben
  die Web-Oberfläche über einen Browser — für die Probe gilt keines davon.
  Golden-Tests ersetzen einen Teil, nicht alles.

---

## 9. Entscheidungen vor dem Start

1. **Testgerät:** Gibt es einen Pi 3 mit 1 GB — oder eine Pi-5-Testbox auf
   1 GB kappen? Nie die Kinderbox.
2. **Flutter** als erste Probe bestätigt, LVGL als Plan B?
3. **Erfolgskriterien** aus §6 so übernehmen?
4. **Dart-Paket** jetzt aus der Handy-App ziehen (berührt `handy-app/`, deren
   Tests grün bleiben müssen) — oder die Probe erst ohne Codeteilung?
5. **Glas-Effekt** auf dem Pi 3: darf er wegfallen, wenn er die Bildrate
   kostet?

---

## Quellen (abgerufen 30.09.2026)

* flutter-pi: https://github.com/ardera/flutter-pi (README: unterstützte
  Modelle, Paketliste, „runs without X11") ·
  flutterpi_tool: https://github.com/ardera/flutterpi_tool ·
  Pi-5-Issue: https://github.com/ardera/flutter-pi/issues/511 ·
  Speicherfrage offen: https://github.com/ardera/flutter-pi/issues/67
* ivi-homescreen: https://github.com/toyota-connected/ivi-homescreen
* Impeller: https://docs.flutter.dev/perf/impeller
* Flutter/Qt-Speicher (Suchauszug): https://www.maibornwolff.de/en/know-how/qt-vs-flutter/
* LVGL: https://github.com/lvgl/lvgl · HelixScreen: https://github.com/prestonbrown/helixscreen
* Slint: https://github.com/slint-ui/slint/blob/master/LICENSE.md ·
  Hintergrund-Blur fehlt: https://github.com/slint-ui/slint/issues/13502
* Qt Virtual Keyboard (Lizenz): https://github.com/qt/qtvirtualkeyboard
* WPE 2.54: https://wpewebkit.org/release/wpewebkit-2.54.0.html ·
  https://wpewebkit.org/blog/2026-09-16-wpewebkit-2.54.html ·
  Cog ohne Nachfolger: https://github.com/Igalia/cog/issues/799 ·
  https://github.com/WebKit/WebKit/pull/75061
* Chromium-Schalter: https://github.com/chromium/chromium/blob/main/content/public/common/content_switches.cc ·
  Prozessmodell: https://github.com/chromium/chromium/blob/main/docs/process_model_and_site_isolation.md
* Servo: https://servo.org/blog/2026/08/31/july-in-servo/ ·
  CSS-Stand: https://github.com/servo/stylo/blob/main/style/properties/longhands.toml
* Ladybird: https://github.com/LadybirdBrowser/ladybird
* Sciter: https://gitlab.com/c-smile/sciter-js-sdk
