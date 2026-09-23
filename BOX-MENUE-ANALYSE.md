# Das Menü auf der Box — A-Phase (Bestandsaufnahme)

Stand: 2026-07-31 · Grundlage für E7a (B1–B5) und E8 (T2–T6) im [BACKLOG.md](BACKLOG.md)

Gegenstand: **das Einstellungs-Menü auf der Box selbst** — Einstiegsseite, WLAN, Bluetooth,
Neustart. Nicht das Admin-Board (das läuft am PC-Browser, siehe
[ADMIN-BOARD-ANALYSE.md](ADMIN-BOARD-ANALYSE.md)).

**Reine Bestandsaufnahme — Fakten mit Beleg, keine Bewertung, keine Lösung.**
Größen sind aus Ionics eigenen Vorgabewerten (`node_modules/@ionic/core`, Fassung 8.7.5,
Modus `md`) plus den Überschreibungen der App **gerechnet**, jede Zahl mit ihrer Rechnung.
Kein Browser im Spiel.

**Umrechnung ist belegt, nicht angenommen:** Der Kiosk startet Chromium mit
`--window-size=800,480` und **ohne** `--force-device-scale-factor` → 1 CSS-Pixel = 1 Gerätepixel
→ **0,14 mm/px**. Die 9-mm-Marke (ISO 9241-411) ist damit **64,3 px**.

---

## Die Ausgangsannahme stimmt nicht

Im Backlog stand: *„Reboot/Shutdown ist eine schlichte, linksbündige Textliste."*

**Beides ist am Quelltext nicht haltbar** — und die Wirklichkeit ist unangenehmer:

- Es ist **keine Liste**, sondern der **fünfte Eintrag eines waagerechten Kachelbands**.
- Die Knöpfe im Dialog sind **rechtsbündig und in Großbuchstaben**
  (`.alert-button { text-align: end; text-transform: uppercase }`,
  `.alert-button-group { justify-content: flex-end }`).

Der eigentliche Befund liegt woanders — siehe die nächsten zwei Abschnitte.

---

## T4 — Der Weg zum Herunterfahren

### Die Kachel ist fast unsichtbar

Das Kachelband rechnet so: Kachelbreite `--mupi-tile` = `clamp(140px, calc(100vh - 310px), 230px)`,
bei 480 px Höhe also **170 px**; Abstand zwischen den Folien 24 px → Raster 194 px.
Die Folien beginnen bei 0, 194, 388, 582, **776**.

| Position | Eintrag | sichtbar bei 800 px Breite |
|---|---|---|
| 1 | Add media | ganz |
| 2 | WiFi settings | ganz |
| 3 | Bluetooth | ganz |
| 4 | Darstellung | ganz |
| **5** | **Reboot / Shutdown** | **24 px von 170** |
| 6 | More settings (bedingt) | gar nicht |

**Man muss wischen, um überhaupt hinzukommen** — und Wischen ist der einzige Weg: Es gibt
keine Blätterknöpfe, keine Punkte-Anzeige, und die Bildlaufleiste ist 4 px hoch
(0,56 mm) **und nicht ziehbar** (Swiper-Vorgabe `draggable: false`).

### Der Dialog stellt vier gleich aussehende Knöpfe nebeneinander

Ionic stapelt Dialogknöpfe **selbsttätig untereinander**, sobald es mehr als zwei sind
(`buttons.length > 2` → Klasse `alert-button-group-vertical`, `flex-direction: column`).
Die App hebt das global wieder auf:

```scss
.alert-button-group { flex-direction: row !important; }   // global.scss:74-76
```

Ergebnis auf einem Dialog, der zugleich auf **feste 400 px Breite** gezwungen ist
(`--width`, `--min-width`, `--max-width` in `global.scss:62-68`):

| | |
|---|---|
| Knöpfe | **vier nebeneinander** auf 384 px nutzbarer Breite |
| Reihenfolge | „Oberfläche neu laden" · **„Shutdown"** · **„Reboot"** · „Cancel" |
| Höhe je Knopf | 10 + 20 + 10 = **40 px = 5,60 mm** (die 9-mm-Marke wäre 64,3 px) |
| Abstand | **8 px = 1,12 mm** |
| Farbliche Unterscheidung | **keine** — kein Knopf trägt `role` oder `color` |

Weil keiner der Knöpfe eine `role` trägt, greift weder Ionics
`.alert-button-role-destructive` noch eine Abbruch-Behandlung: **„Shutdown" sieht exakt aus
wie „Cancel"** — gleiche Größe, gleiche Farbe, gleiche Schrift.

Und **„Shutdown" grenzt direkt an „Oberfläche neu laden"** — 1,12 mm zwischen der
harmlosesten und der folgenreichsten Aktion des Dialogs.

### Ein Fehlgriff ist sofort endgültig

- **Genau eine Rückfrage:** Kachel antippen → Dialog → „Shutdown" antippen → `POST /api/shutdown`.
  Keine zweite Bestätigung, kein Halten, keine Verzögerung.
- **Keine Rückmeldung:** Der Handler ruft `.subscribe()` ohne Erfolgs- oder Fehlerzweig.
  Antwortet der Server mit 500, sieht der Nutzer nichts.
- **Kein Passwort auf der Box:** Das Anmeldetor lässt alles durch, was von `127.0.0.1` kommt.
  Die Kiosk-Oberfläche ruft über die Rückschleife — `POST /api/shutdown` ist von der Box aus
  **immer** ohne Anmeldung erreichbar, auch wenn `interfacelogin.state` eingeschaltet ist.
- **Zwei verschiedene Bauarten:** Die Box ruft `/api/shutdown` und `/api/reboot`, die im
  `server.ts` als **freie Shell-Zeichenkette** (`exec('sudo su - -c "…"')`) ausgeführt werden.
  Das Admin-Board benutzt für dasselbe die feste Tabelle `AKTIONEN` mit `execFile` und
  Argument-Array.

### Was ein Kind versehentlich auslösen kann

- **Ein Langdruck rettet nichts:** 500 ms Halten auf der Kachel öffnet den Dialog **nicht**,
  sondern liest den Namen vor (`appLongPress` → `readText`).
- **Zwei Karten, gleiche Optik, verschiedene Wirkung:** Die Bildkarte öffnet den Eintrag,
  die Beschriftungskarte darunter **liest nur den Namen vor**. Ein Tipp auf die Schrift
  „Reboot / Shutdown" tut also nichts.
- **Kein Druckzustand:** Die Kacheln sind `<ion-card>` ohne `button`/`href` — Ionic rendert
  dann keinen `<button>`, keine `ion-activatable`-Klasse, **keinen Ripple**. Es gibt auch
  keine `:active`-Regel. Wer tippt, bekommt keine Rückmeldung, dass er getroffen hat.
- **Bluetooth „Trennen"** läuft ganz ohne Rückfrage. Auf der WLAN-Seite verbindet ein Tipp
  auf ein **offenes** Netz sofort — und wechselt damit die laufende Verbindung.

Immerhin bewusst entschärft: **„Entfernen" fehlt auf der Bluetooth-Seite absichtlich** — laut
Kommentar, weil eine gelöschte Kopplung auf 800×480 mit Kinderfingern zu leicht passiert und
nur in der Verwaltung wiederherstellbar wäre.

---

## B2 — Der Referenzfall: WLAN gegen Bluetooth

Zwei fast deckungsgleiche Aufgaben, zwei grundverschiedene Umsetzungen.

| | **WLAN** | **Bluetooth** |
|---|---|---|
| Dateien | 3 getrennte (1643 Zeilen) | **1 Datei, alles inline** (333 Z.), keine Tests |
| Bausteine | Ionic (`ion-list`/`ion-item`) | **rohes HTML** (`ul`/`li`/`span`) |
| Kapselung | **`ViewEncapsulation.None`** | Emulated (gekapselt) |
| Einstieg | **zweistufig** (erst „Netze suchen", dann Liste) | einstufig (ein „Suchen"-Knopf) |
| Suche startet | **automatisch beim Öffnen** — ohne jede Anzeige | **nie von selbst**, nur auf Knopfdruck |
| Suchdauer | ~4,5 s | **12 s** (2,7-fach) |
| Anzeige währenddessen | nur der Knopftext | Knopftext **plus** Erklärzeile |
| gesperrt währenddessen | nur der Suchknopf | Suchknopf **und alle Zeilen** |
| Signalstärke | **doppelt**: 3 Balken **und** dBm-Zahl, je Band | **gar nicht** (kein RSSI in der API) |
| Gerätesymbol | Ionicon (Schloss) | **Emoji** 🔈 🎧 📱 |
| Zeile antippbar | **ganze Zeile** | **nur der Knopf** am rechten Rand |
| Zeilenhöhe | ~64 px bzw. 86 px | 66 px = 9,24 mm |
| Kopfleiste | eigener Knopf, 70×70 px erzwungen | `ion-back-button`, 48×48 px |
| Leerzustand | nur „Keine Netze gefunden." | erklärender Text, was zu tun ist |
| Titel | **„WiFi settings"** (englisch) | **„Bluetooth"** |
| Leiste | `#1f1f1f` | `color="light"` → `#2a2a2a` |

**Dieselbe Marke, zwei Kontraste:** „verbunden" steht bei WLAN in `#1e7a3c` auf hellem Grund —
**Kontrast 2,15:1**. Bei Bluetooth in `#3dc25a` auf `#121212` — **7,40:1**. Dieselbe Aussage,
dreieinhalbfacher Unterschied in der Lesbarkeit.

### Ein Nebenbefund mit Reichweite über die Seite hinaus

**`WifiPage` ist mit `ViewEncapsulation.None` deklariert.** Ihr SCSS wird beim ersten Betreten
der Seite ungekapselt ins Dokument gehängt und **bleibt dort — app-weit**. Betroffen sind
unter anderem:

```scss
ion-toolbar ion-button { height: 70px !important; width: 70px !important; font-size: 20px !important; }
ion-item { font-size: 18px; }
```

Wer einmal die WLAN-Seite geöffnet hat, hat also andere Knopfgrößen und Schriftgrößen
in der **ganzen** Oberfläche. Dazu kommen tote Regeln in derselben Datei
(`ion-segment-button`, `ion-select`, `.tast-zu` — in `wifi.page.html` gibt es dafür kein
Element), die wegen der fehlenden Kapselung auf **anderen** Seiten greifen könnten.

---

## T2 — Trefferflächen, gerechnet

| Element | Rechnung | Ergebnis | ≥ 9 mm? |
|---|---|---|---|
| Kopfzeile | 70 px (global überschrieben) | **9,80 mm** | ✓ |
| Kachel (Bild) | 170 × 170 px | **23,80 mm** | ✓ |
| Bluetooth-Zeile | 48 + 16 + 2 = 66 px | 9,24 mm | ✓ (aber nicht antippbar) |
| WLAN-Zeile | 48 px Mindestmaß, ~64–86 px real | 6,72–12,0 mm | grenzwertig |
| WLAN „Netze suchen" (`size=large`) | 2,8 × 20 px = 56 px | 7,84 mm | ✗ |
| Zurück-Knopf | 48 × 48 px | 6,72 mm | ✗ |
| Bluetooth-Knöpfe | 48 px | 6,72 mm | ✗ |
| WLAN „Neu suchen" | 48 px | 6,72 mm | ✗ |
| Passwort-Eingabefeld | 44 px | 6,16 mm | ✗ |
| Kachel-Beschriftung | 58 px | 8,12 mm | ✗ |
| **Dialogknöpfe (Shutdown!)** | 10+20+10 = 40 px | **5,60 mm** | ✗ |
| **WPS-Knopf** (kleinster) | 36 px (Ionic-Grundmaß) | **5,04 mm** | ✗ |
| Bildlaufleiste | 4 px | 0,56 mm | ✗ (nicht ziehbar) |

**Kein einziger Knopf erreicht 9 mm.** Über der Marke liegen nur die Kacheln, die Kopfzeile
und die Bluetooth-Zeile — die aber gar nicht antippbar ist.

---

## T3/T5 — Rückmeldung und Präzision

**Ohne sichtbaren Druckzustand:** die Kacheln des Menüs (kein Ripple, keine `:active`-Regel)
und **alle** Bluetooth-Knöpfe (einfache `<button>`, im ganzen Stilblock weder `:active` noch
`:focus`). WLAN hat als einzige Seite Ripple, weil sie Ionic-Bausteine benutzt.

**Eine `:hover`-Regel, die am Finger nichts leistet:** `.tast-lasche:hover` — die einzige
Hover-Regel der drei Seiten, und anders als Ionics eigene **nicht** in
`@media (any-hover: hover)` geklammert. Am Touch bleibt der Zustand nach dem Tippen haften.

**Dieselbe Lasche trägt zwei Gesten:** Tippen schaltet die Tastatur um, Ziehen ändert ihre
Größe. Unterschieden wird an einer **3-px-Schwelle = 0,42 mm**. Sichtbar ist sie 84 × 24 px
(11,8 × 3,4 mm), treffbar durch ein unsichtbares `::before` 120 × 44 px.

---

## T6/T7 — Platz und Tastatur

Bei 480 px Höhe bleiben nach der 70-px-Kopfzeile **410 px**.

- **Einstellungsseite:** 268 px Inhalt + 70 px Kopf = 338 px — passt bequem.
- **Bluetooth:** **vier Zeilen** vollständig sichtbar (66n + 8(n−1) ≤ 342 → n ≤ 4,73).
- **WLAN:** **fünf Netze** bei 64-px-Zeilen, weniger bei Bänderzeilen.

**Die Bildschirmtastatur ist höher als der Platz, den man ihr reserviert hat:**

```
Tastatur:  4 Reihen × 48 px + 3 × 5 px + 2 × 5 px Polster = 217 px
+ Lasche 24 px                                            = 241 px
reserviert (.top.mit-tastatur padding-bottom)             = 180 px
                                                    Differenz = 61 px (8,54 mm)
```

Um diese 61 px lässt sich der Inhalt nicht vollständig über die Tastatur hinausschieben.
Bei geöffneter Tastatur bleiben oben **169 px** für Netzname, Marke und Passwortfeld.

---

## Weitere belegte Befunde

- **Der QR-Code führt ins Leere.** „More settings" zeigt auf `http://<ip>` **ohne Port** —
  das Backend hört auf 8200/8443, und Port 80 ist auf beiden Boxen tot (gemessen 2026-07-30).
- **Ohne Beschriftung:** Die Namen unter den Kacheln hängen an `DarstellungService.zeigeBezeichnung`.
  Das mitgelieferte Thema **„Tiger Mupi" setzt `bezeichnung: false`** — dann zeigt das Menü
  fünf bis sechs **Symbole ohne jeden Text**.
- **`filter: invert(1)`** gilt für **jedes** Bild im Kachelband der Einstellungen — also auch
  für die Rasterdatei hinter „Darstellung" und für den erzeugten QR-Code.
- **Tote Klasse:** `settings-header` wird im HTML vergeben, hat aber nirgends eine Regel.
- **Doppelter Import:** `MupiHatIconComponent` steht zweimal in derselben `imports`-Liste
  (`settings.page.ts:30` und `:36`).
- **Kein Debug-Schalter im Menü** — der Messmodus lässt sich nur über `localStorage` von den
  Entwicklerwerkzeugen aus einschalten.

---

## Offen für die V-Phase

Nicht beantwortet — das sind Entscheidungen:

1. **Erreichbarkeit von „Reboot / Shutdown"**: Der Eintrag ist zu 86 % außerhalb des Bildes.
   Soll er sichtbar werden, oder ist genau das der gewünschte Schutz?
2. **Der Vierfach-Dialog**: Ionic würde stapeln, die App zwingt ihn in eine Reihe. Zurück zur
   Ionic-Vorgabe? Und soll „Shutdown"/„Reboot" eine `role` bekommen (rot statt blau)?
3. **Referenz-Seite (B5)**: WLAN ist ausgereifter, aber ungekapselt und färbt auf die ganze
   App ab. Bluetooth ist sauber gekapselt, aber ohne Ionic und ohne Druckzustand.
   Welches Muster trägt?
4. **Zielgröße für Trefferflächen (T6)**: Heute erreicht kein Knopf 9 mm. Ein Zielwert ist zu
   setzen — und ob er für Kinderhände höher liegen soll.
5. **Sprache**: „WiFi settings" gegen „Bluetooth" gegen „Darstellung" — Englisch und Deutsch
   gemischt.

**Sachlich falsch und ohne Ermessen zu beheben:** die ungekapselte WLAN-Seite (färbt app-weit
ab), die toten Regeln in `wifi.page.scss`, die tote Klasse `settings-header`, der doppelte
Import, der QR-Code auf den toten Port 80, und die 61-px-Lücke unter der Tastatur.
