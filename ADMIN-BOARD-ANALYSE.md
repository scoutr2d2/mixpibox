# Admin-Board — A-Phase (Bestandsaufnahme)

Stand: 2026-07-30 · Grundlage für E6 (G2–G5) und E7b (L2–L5) im [BACKLOG.md](BACKLOG.md)

**Das hier ist reine Bestandsaufnahme — Fakten mit Beleg, keine Bewertung, keine Lösung.**
Gemessen am Quelltext und an der laufenden Entwicklungsbox (Pi 5, `192.168.178.169`),
teils im echten Browser bei 800×480. Was daraus folgt, entscheidet die V-Phase.

Gegenstand ist ausschließlich das **neue Angular-Board** (13 Seiten + Anmeldung). Der
PHP-Admin taucht nur als Vergleichsquelle auf; er ist auf der Box tot (Port 80 verweigert
die Verbindung, kein Lauscher in `ss -lntp`), `/admin` auf Port 8200 antwortet mit 200.

---

## G2 — Deckungslücke der Konfigurationsseite

**Die Zahlen.** Die Tabelle `FELDER` in `src/backend-api/src/konfiguration.ts` führt
**27 Felder** (2× Text, 10× Zahl, 8× Schalter, 5× Auswahl, 1× URL, 1× geheim). Die echte
`/etc/mupibox/mupiboxconfig.json` der Box hat **14 Gruppen, 83 Skalarschlüssel und 5 Listen**.

| | Anzahl |
|---|---|
| Schlüssel der Box **mit** Feld im Board | 25 |
| Schlüssel der Box **ohne** Feld im Board | **58** (+ 5 Listen) |
| Felder des Boards, deren Schlüssel es auf der Box **nicht gibt** | **2** |

**Die zwei ins Leere zeigenden Felder:** `jellyfinSchluessel` → `jellyfin.apiKey` und
`spotifyPlaylistSuche` → `spotify.disableScraperForPlaylists`. Beide fehlen in der
laufenden Datei; die Gruppe `jellyfin` existiert, enthält aber nur `server`.
`spotify.disableScraperForPlaylists` **wird gelesen** (`server.ts:5352`, verzweigt in
`:5354`) und steht in der Vorlage — auf der Box fehlt er trotzdem.

**Ungedeckte Schlüssel, die aktiv gelesen werden** (jeweils mit Leser belegt):

| Bereich | Schlüssel | Leser |
|---|---|---|
| MQTT | alle 14 | `scripts/mqtt/mqtt.py:905-918`, Unit `mupi_mqtt.service` |
| Telegram | `active`, `token`, `chatId` | 6 Python-Skripte + `mupi_shutdown.sh:44`, `idle_shutdown.sh:27` |
| WLED | 10 Schlüssel | `mupi_start_led.sh`, `mupi_shutdown.sh` |
| OnOffShim | `poweroffPin`, `cutPin`, `triggerPin`, `ledPin`, `ledBrightness*` | `poweroff.sh`, `off_trigger.sh`, `mupi_start_led.sh` |
| Chromium | `resX`, `resY`, `debug`, `cachepath` | `chromium-autostart.sh:13-18` |
| Klang/Splash | `audioDevice`, `shutSound`, `shutSplash` | `shutdown_sound.sh`, `mupi_shutdown.sh`, `chromium-autostart.sh:108` |
| MuPiHAT | `selected_battery`, `battery_types` | `mupihat_bq25792.py:222`, `akkustand.ts:69` |
| Spotify-Zugang | `deviceId`, `clientId`, `clientSecret`, `accessToken`, `refreshToken` | `setting_update.sh:22-38` (spiegelt sie in zwei weitere Dateien) |
| Lüfter | `fan_gpio`, `fan_temp_100/75/50/25` | `fan_control.py:35-40` |
| sonstiges | `mupibox.ip_control_backend` | `setting_update.sh:49-59` |

**Ungedeckte Schlüssel ohne jeden Leser** (Volltextsuche im Repo, ohne die tote PHP-Verwaltung
und ohne `update/conf_update.sh`, das sie nur *setzt*): u. a. `mupibox.AudioDevice`
(großes A, Wert `hifiberry-dac`) samt der 28-Einträge-Liste `AudioDevices`, `pm2.ramlog`,
`fan.fan_active`. Daneben existiert `mupibox.audioDevice` (kleines a) mit drei aktiven Lesern —
**zwei Schlüssel, die sich nur in der Groß-/Kleinschreibung unterscheiden.**

**Zwei Listen ohne eigenes Feld werden trotzdem gebraucht:** `installedThemes` (29 Einträge)
und `googlettslanguages` (21) sind die Auswahlquellen der Felder *Thema* und *Vorlesesprache*.
Die Box führt 29 Themen, die Vorlage 28 — der Unterschied ist genau `MupiNew`, und
`mupibox.theme` der Box steht darauf.

**Einstellungen, die gar nicht in der JSON liegen:** Drei Systemschrauben laufen über
DietPi-Helfer (`cpuRegler` → `dietpi-set_cpu`, `auslagerung` → `dietpi-set_swapfile`,
`aufNetzWarten`). Die Tonausgabe schreibt `/etc/asound.conf` (`POST /api/ton`). Eigene
Ablagen unter `server/config`: `kinderzeit.json`, `kinderzeit-verbrauch.json`,
`darstellung.json`, `vorlesen.json`, `listen.json`, `albumstop.json`.

**Zwei Befunde am Rande, die beim Prüfen auffielen:**
- Die Systemaktion `drehung-zurueck` ruft `/opt/mupibox-tools/bootwache.py --zuruecknehmen`
  — **auf der Box fehlte die Datei.** Nachgefasst: Sie existiert sehr wohl, im
  remote-step-installer (`remote-step-installer/tools/mupibox-bootwache.py` samt Unit und
  Timer) — nur hat sie
  **kein Rezept je ausgerollt**. Behoben mit dem Pflichtschritt `bootwache`
  (Installer-Commit `bdd2eec`).
- Der geläufige Prüfbefehl `jq -r 'paths(scalars)'` **unterschlägt 11 Schlüssel**: alle
  booleschen mit Wert `false` (u. a. `mqtt.active`, `telegram.active`, `wled.active`).
  Wer damit zählt, übersieht sie. `jq -r '[paths]'` zeigt sie.

---

## G3 — Funktionslücke gegenüber dem alten Admin

Alter Admin: 28 PHP-Dateien. Neues Board: 14 Seiten-Dateien, dahinter 116 Express-Routen.

**Ohne Gegenstück im neuen Board** (jeweils per grep belegt, dass es dort nichts gibt):

| Funktion | Stand |
|---|---|
| **Backup** (`backup.php`, `fullbackup.php`) | Die Zeichenkette „backup" kommt weder im Board noch im backend-api vor |
| **WLED** (`smart.php`) | „wled" kommt in beiden nicht vor — obwohl die Box einen `wled`-Block führt |
| **MQTT / Telegram** | nur als Dienstname und Maskierliste; keine Einstellseite |
| **VNC** (`vnc.php`) | im Board gar nicht, im Backend nur als Dienstname |
| **Cover-Pflege** (`cover.php`) | kein Datei-Upload im Board: **kein `FormData`, kein `input type=file`, kein multer/multipart im Backend** |
| **Spotify-Cache leeren / Verbindung zurücksetzen** | kein Endpunkt im backend-api |
| **JSON-Editor** (7 Dateien frei bearbeitbar) | bewusst durch die feldbasierte Konfigurationsseite ersetzt |
| **Grafiken** (RRD-Diagramme, Bildschirmfoto per `scrot`) | „scrot"/„screenshot" kommen im Board nicht vor |
| **Kiosk neu starten** | `POST /api/oberflaeche/neuladen` **existiert im Backend**, wird aber von keiner Stelle des Boards aufgerufen |
| **Update einspielen** | Die Seite sagt selbst: „Einspielen geht hier absichtlich noch nicht" — es gibt keinen POST-Weg |

**Anmeldungen liegen woanders — und das ist so gewollt:** Die Spotify-PKCE-Anmeldung und
die Jellyfin-QuickConnect-Anmeldung leben in der **Box-Oberfläche** (`/spotify`, `/jellyfin`).
Beide Admin-Oberflächen verlinken nur dorthin.

**Nur im neuen Board** (im PHP-Admin ohne Gegenstück): Kinderzeit (serverseitig gezählt,
weil die frühere Browser-Zählung umgangen werden konnte), Vorlesen, Darstellung
(Live-Vorschau, Anordnen per Ziehen, Themen), Medien **bearbeiten** (suchen, aufnehmen,
ändern, löschen, eigene Listen — `media.php` konnte nur anzeigen), MuPiHAT-Diagnose
(Lade-/Entladekurve, Akkuwerte, Export als csv/json/xlsx/pdf), Herkunftsprüfung der
Installation.

**Veralteter Text im Board:** Die Übersichtsseite verlinkt nur 7 der 13 Seiten und schreibt
darunter, die übrigen Bereiche (Medien, Cover, Spotify, Jellyfin, MuPiHAT …) lägen noch in
der alten Verwaltung — Medien, MuPiHAT und Jellyfin gibt es dort inzwischen.

**Pfadwechsel, der beim Umzug passierte:** Die Protokollseite liest
`/var/log/mupibox/idle_shutdown.log`, der PHP-Admin las `/tmp/idle_shutdown.log`.

---

## L2 — Gestaltungs-Inventar der 13 Seiten

**Die Grundlage ist schmal:** Es gibt genau **eine** Stildatei
(`src/frontend-admin/src/styles.css`, 57 Zeilen)
mit **9 CSS-Variablen — allesamt Farben**:

```
--grund #121212   --flaeche #1c1c1e   --rand #2f2f33   --schrift #f2f2f7   --gedaempft #9a9aa0
--leit #3880ff    --warn #ffc409      --fehler #eb445a  --gut #2dd36f
```

**Für Abstände, Schriftgrößen, Radien und Schatten existiert keine einzige Variable.**
Dem stehen **861 Zeilen Inline-Stil** in 15 Komponenten gegenüber (alle im
`@Component`-Decorator, keine `styleUrls`, keine `encapsulation`-Angabe → Angular-Vorgabe
`Emulated`, jede Seite muss `h1`, `button`, `table` usw. neu schreiben).

**Vier Variablen werden benutzt, die es nicht gibt:** `--eingabe`, `--betont`, `--warnung`,
`--schlecht`. Alle 25 Vorkommen tragen einen Ersatzwert — zur Laufzeit greift also **immer
das Literal**. `--betont` bekommt dabei **drei verschiedene Ersatzfarben** (`#2b6cb0`,
`#3d7eff`, `#7fa8ff`).

**Ersatzwerte widersprechen den definierten Werten:** `var(--rand, #24313f)` steht 23×,
definiert ist `#2f2f33`. `var(--flaeche, #16202b)` 3×, definiert ist `#1c1c1e`. Wo die
Variable greift, erscheint eine andere Farbe als der Autor im Ersatzwert vorsah.

**Zwei Farbfamilien:** Acht Seiten benutzen ausschließlich die 9 definierten Variablen
(0 Literale). Die übrigen — vor allem `mupihat` (29 Hex + 10 rgba), `medien`, `kinderzeit`,
`vorlesen` — bringen eine eigene Palette mit. Insgesamt **104 Hex-Literale und 21 rgba()**.

**Wiederholte Literale über Seiten hinweg:** `#24313f` 23× in 4 Dateien, `#0e1720` 10× in 4,
`#fff` 8× in 5 (immer als Schrift auf einem eingefärbten Knopf), `#2b6cb0` 5× in 2.

**Ohne Variable, deshalb literal gestreut:** 70× `border-radius` in 13 verschiedenen Größen
(12px 17×, 10px 16×, 8px 13×, 999px 9×), **128 `font-size`-Deklarationen in 29 verschiedenen
Werten** (0.9rem 23×, 1.3rem 13× — immer `h1`, 0.94rem 10× — immer `p.unter`).

**Es gibt keine gemeinsamen Bausteine.** 16 Komponenten, davon 14 Seiten — **keine
Komponente für Knopf, Karte, Formularzeile oder Schalter**, keine Seite importiert eine
andere. Die einzigen seitenübergreifenden Bausteine sind die 5 Elementregeln in `styles.css`.
Folge:

- **`.karte`** wird in 6 Seiten definiert — in **3 verschiedenen Ausprägungen**.
- **`.meldung`** in 8 Seiten — in 3 Ausprägungen, mit **vier verschiedenen Zustandsnamen**
  für dasselbe (`.fehler`, `.hinweis`, `.gut`, `.warn`, `.schlecht`).
- **`.schalter`** meint auf drei Seiten **drei verschiedene Dinge** (Knopfleiste,
  Kontrollkästchen-Zeile, Label).
- Der globale Knopf wird in **vier Seiten vollständig überschrieben**.
- `kinderzeit.ts:112` definiert `button.wichtig` — **kein Element der Seite trägt die Klasse**.

**Bewegung:** 0 `transition`, 0 `animation`, 0 `@keyframes` im gesamten Board.

**Kein Netzbezug:** weder in der Quelle noch im gebauten Ergebnis eine einzige externe URL —
das erklärte Ziel „offline-fähig" ist eingehalten.

---

## L3 — Interaktionsmuster: drei Speichermodelle nebeneinander

| Modell | Seiten |
|---|---|
| **Sofort beim Ändern** | darstellung, dienste, system, medien, kinderzeit, vorlesen, bluetooth, netzwerk, mupihat |
| **Gesammelt mit Speichern-Leiste** | **konfiguration** (klebende Leiste unten, Zähler geänderter Felder, „Verwerfen") |
| **Nur lesend** | uebersicht, protokolle, aktualisierung |

**Rückmeldung ist uneinheitlich:**

| Seite | Erfolg | Fehler | Ort | Server-Text? |
|---|---|---|---|---|
| konfiguration | grün, **nennt die geänderten Felder** | roter Kasten | oben | **ja, wörtlich** |
| system | grüner Kasten | roter Kasten | oben | ja |
| vorlesen | „Gespeichert." Normalfarbe | `.meldung.schlecht` (orange) | letzte Karte | ja |
| medien | **graue** Zeile am Seitenende | dieselbe graue Zeile | ganz unten | nur Statuscode |
| darstellung | „Gespeichert —" **grau** | dieselbe graue Zeile | Mitte | nein |
| dienste | **gar keine** Erfolgsmeldung | roter Kasten | oben | nein |
| kinderzeit | **gar keine** | farbloser Text | ganz unten | nein |

**Ladezustand fehlt auf drei Seiten:** medien zeigt beim ersten Laden „Bibliothek (0)" und
„Kein Eintrag passt.", kinderzeit eine leere Wochentabelle, vorlesen den Kasten „nicht
eingerichtet" — jeweils **bis die Antwort da ist**. Die übrigen zehn zeigen „Einen Moment…".

**Rückfrage vor gefährlichen Aktionen — zwei Verfahren:** system nutzt einen roten
Bestätigungskasten mit „Ja, …"/„Abbrechen". medien, darstellung und vorlesen verwandeln den
Knopf in „wirklich?" (bei medien/darstellung mit 4-Sekunden-Rückfall, bei vorlesen ohne).
**Ohne jede Rückfrage:** Bluetooth-Kopplung entfernen, Adapter wechseln, Medien einlesen.

---

## L4 — Verhalten bei 800×480 (im Browser gemessen)

> **ENTSCHIEDEN 2026-07-31: Für das Admin-Board GEGENSTANDSLOS.**
> Das Board wird am PC-Browser bedient — dort spielt die Auflösung keine Rolle.
> Am 800×480-Bildschirm der Box zählt **das Menü der Box selbst** (Kinder-Oberfläche,
> `frontend-box`), nicht diese Verwaltung. Die folgenden Messwerte bleiben nur als
> Beleg stehen; **daraus wird für das Board nichts optimiert.**
> Wo Trefferflächen und 800×480 wirklich zählen: **E7a/E8** im Backlog.
>
> Eine Ausnahme, die unabhängig von der Auflösung galt und bereits behoben ist
> (Commit `125af75f`): `input { width: 100% }` zog Kontrollkästchen auf 551 px Breite
> bei 13 px Höhe — das war auf **jedem** Bildschirm falsch, auch am PC.

Grundlage: `styles.css:28` setzt `font: 16px/1.5` **fest** — 1 rem = 16 px, unabhängig vom
Gerät. Bei 0,14 mm/px entspricht die 9-mm-Marke **64,3 px**.

**Kein einziger Knopf, Schalter oder Eingabefeld erreicht 9 mm.**

| Element | Höhe | in mm |
|---|---|---|
| Eingabefeld / `button.still` (global) | 51,6 px | **7,22 mm** |
| Knopf (global) | 49,6 px | **6,94 mm** |
| Auswahlfeld | 42,0 px | **5,88 mm** |
| Knöpfe auf darstellung / protokolle / medien | 39,6–41,6 px | **5,54–5,82 mm** |
| **Kontrollkästchen und Radioknöpfe (alle 8)** | 13 px | **1,82 mm** |

Über 9 mm liegen nur ganze Zeilen und Kacheln (Übersichts-Kachel 14,91 mm,
Medien-Zeile 17,51 mm). Es gibt **keine Regel für `input[type=checkbox]`** — es gilt der
Browservorgabewert. **Zwei Kästchen sitzen ohne umschließendes `<label>`**
(konfiguration, kinderzeit-Tabelle): die Trefferfläche ist dort exakt 1,82 × 1,82 mm.

**Es gibt genau zwei Media-Queries im ganzen Board:** eine für `prefers-reduced-motion`
und eine einzige Breiten-Abfrage (`medien.ts:218`, `max-width: 62rem`). Leer blieben die
Suchen nach `@container`, `clamp(`, `vw`, `aspect-ratio`, `touch-action`,
`@media (pointer: coarse)`.

**Waagerechter Überlauf:** bei 800×480 **auf keiner Seite**. Bei 375 px (Handy) laufen
**fünf Seiten über**: kinderzeit (+163 px), netzwerk (+193), vorlesen (+145),
konfiguration (+22), bluetooth (+14). Ursache auf konfiguration: ein einziges Auswahlfeld
mit der langen Option „Maximal — 7 Tage halten, alles vorladen".

**Die Kopfleiste frisst 30 % der Höhe:** bei 800×480 ist der klebende Kopf mit seinen
13 Navigationslinks **144,5 px hoch = 30,1 % von 480 px** (Navigation bricht auf 2 Zeilen).
Bei 375 px sind es 267,3 px und 5 Zeilen. Von den 7 Übersichts-Kacheln sind dadurch
**4 ohne Rollen sichtbar**.

**Sechs Seiten rendern Tabellen** (bis 6 Stück auf mupihat, bis 5 Spalten). **Keine einzige
Tabelle steht in einem Behälter mit `overflow-x`** — bei 800×480 passen sie (711–745 px in
745 px Spalte), bei 375 px nicht. `overflow-x` kommt im ganzen Board genau einmal vor:
am Protokoll-`<pre>` (dort 745 px breit bei 1149 px Inhalt — der Rollbalken fängt es ab).

**Der Viewport-Hinweis ist gesetzt** (`width=device-width, initial-scale=1`, ohne
`maximum-scale`), dazu `color-scheme: dark light`.

**Zwei Seiten waren auf dieser Box nicht messbar:** die Anmeldung (weil
`interfacelogin.state = false` — der Aufruf landet sofort auf `/admin/`) und MuPiHAT
(kein Akku angeschlossen, die Seite zeigt nur zwei Absätze).

---

## Was daraus für die V-Phase offen ist

Diese Fragen beantwortet die Bestandsaufnahme **nicht** — sie sind zu entscheiden:

1. **G4** — Je fehlender Funktion: ins Board holen, bewusst entfallen lassen (VNC? Cover?
   Grafiken?) oder nach „Experte"? Für einige liegt der Endpunkt schon bereit
   (Kiosk neu laden), für andere fehlt alles (Backup, Upload).
2. **G5** — Wie werden 13 Seiten gruppiert? Maßstab ist der **PC-Browser**, nicht die Box
   (entschieden 2026-07-31). Die 30-%-Messung der Kopfleiste bei 800×480 ist damit
   hinfällig; es geht allein um Übersichtlichkeit von 13 Einträgen.
3. **G2-Folge** — Welche der 58 ungedeckten Schlüssel sollen ein Feld bekommen? Die
   Leser-Spalte oben trennt „wird gebraucht" von „liest niemand mehr".
4. **L5** — Welche Seite wird die Referenz? Acht Seiten benutzen bereits ausschließlich
   die definierten Variablen; die abweichenden vier bringen eigene Paletten mit.
   (Gestaltung am PC-Browser — Trefferflächen sind hier kein Kriterium.)
5. **Offen und unstrittig sachlich falsch** (kein Ermessen nötig): die zwei ins Leere
   zeigenden Felder, das fehlende `bootwache.py`, der veraltete Übersichtstext,
   die tote `button.wichtig`-Regel.
