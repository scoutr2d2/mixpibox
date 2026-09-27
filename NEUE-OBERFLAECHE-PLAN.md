# Zweite Box-Oberfläche — Grundlagen und Plan

Stand: 2026-07-31 · Vorarbeit für Startseite + Mini-Player unter `/neu/`

**Leitplanken (vom Nutzer gesetzt):**
1. **Strikt getrennt.** Die neue Oberfläche ändert nichts an der bestehenden Angular-App.
   Umschalten über `mupibox.oberflaeche`, der Rückweg ist ein Konfigurationswert.
2. **Das Rad nicht zweimal bauen.** Logik wird geteilt, notfalls schnittstellenartig umgebaut.
3. **Der Theme-Designer muss für beide gelten** (Reiter „Darstellung" im Admin).

---

## Der wichtigste Befund: es gibt ZWEI Systeme, die „Thema" heißen

Sie wissen nichts voneinander — kein einziger Codepfad verbindet sie.

| | **Darstellung** | **Farbthema** |
|---|---|---|
| Was | Aufbau, Größen, Sichtbarkeit | Farben, Hintergründe, Schriften |
| Bedient über | Admin-Reiter **Darstellung** | Admin-Reiter **Konfiguration**, Feld „Farbthema" |
| Liegt in | `server/config/darstellung.json` | `mupibox.theme` + `themes/*.css` (49 Dateien) |
| Wirkt über | **~28 CSS-Variablen `--mupi-*`** | eine per Symlink getauschte CSS-Datei |
| **Für die neue Seite** | **nutzbar** ✓ | **wirkungslos** ✗ |

**Warum das Farbthema nicht greift:** Die 49 Themendateien setzen ausschließlich
`--ion-*`-Variablen an `ion-*`-Selektoren (`ion-card`, `ion-range`, `ion-spinner` …).
Eine Seite ohne Ionic hat diese Elemente nicht — die Regeln laufen ins Leere.

Dazu kommt: `index.html` bindet den Symlink `www/active_theme.css` **relativ** ein.
Von `/neu/` aus zeigt derselbe Pfad ins Nichts; die neue Seite braucht `/active_theme.css`
mit führendem Schrägstrich.

**Und eine Lücke, die vorher niemandem auffiel:** Die `Darstellung`-Schnittstelle hat
33 Felder, davon **genau ein Farbfeld** (`kachelRandFarbe`). Der Theme-Designer kann die
neue Oberfläche also gar nicht einfärben — dafür fehlen ihm schlicht die Felder.

---

## Was sich ohne Umbau wiederverwenden lässt

Erfreulich viel — diese Dateien kennen kein Angular:

| Baustein | Wo | Was es liefert |
|---|---|---|
| `now-playing.ts` | `frontend-box/src/app/` | `toNowPlaying()`, Fortschrittsanker, `fortschrittJetzt`, `coverFuerLokal`, `coverFuerPlayer`, `KEIN_COVER` — **die ganze Logik des laufenden Titels** |
| `themen-wahl.ts` | ebenda | `abweichungen`, `passt`, `aktivesThema` — sagt selbst: „REIN: keine DOM-, keine Netzberührung" |
| `themen.ts` | `backend-api/src/` | die drei mitgelieferten Themen, ebenfalls rein |
| `GET`/`PUT /api/darstellung` | Backend | reines HTTP+JSON, kennt weder Angular noch Ionic |
| `GET /api/oberflaeche/stand` | Backend | Neuladen nach Umschaltung |

Der Entwurf tut übrigens **bereits dasselbe wie die bestehende App**: sein `applyTheme()`
setzt `--bg`, `--surface`, `--accent` per `documentElement.style.setProperty` — genau der
Mechanismus, den `darstellung.service.ts:802-848` für die `--mupi-*` benutzt. Die beiden
Welten passen an dieser Stelle ohne Übersetzung zusammen.

---

## Was geschnitten werden muss

**`pruefen()` und `anwenden()`** (`darstellung.service.ts:802-848` und `:859-1010`) sind
private Methoden einer `@Injectable`-Klasse. Sie setzen die CSS-Variablen und prüfen die
Werte — beides braucht die neue Seite genauso. Vorschlag: ein Angular-freies Modul, das
**beide** Oberflächen benutzen.

**Der Abgleichtakt** (`:664-702`, `:717-768`) muss mitkommen, nicht neu erfunden werden.
Seine drei Zahlen sind keine Bequemlichkeit, sondern Erfahrung: **3000 ms** Abfrage,
**700 ms** Entprellung beim Schreiben, **5000 ms** Ruhe nach eigener Änderung. Ohne sie
überfahren sich Kiosk und Verwaltung gegenseitig, sobald beide offen sind.

**Eine Kleinigkeit vorweg:** `now-playing.ts` importiert `cleanTrackTitle` aus `utils.ts`,
und `utils.ts` zieht rxjs mit. Eine Verschiebung in eine eigene Datei — sonst schleppt die
neue Seite über eine einzige Importzeile das ganze rxjs mit.

---

## Die größte Dopplungsgefahr

**`updateMedia()`** (`media.service.ts:443-597`). Das Backend liefert 11 rohe Einträge —
**die sichtbare Bibliothek entsteht erst im Browser**: Kategorie-Vorgabe, Kategoriefilter,
Spotify- und RSS-Auflösung je Eintrag, Interpreten-Überschreibung, Cover-Ermittlung.

Wer das in der neuen Seite nachbaut, hat es zweimal. **Hier gehört die Entscheidung hin** —
und sie ist dieselbe Naht, die auch E9 (Verschmelzung der Quellen) braucht.

Zweite Stelle: **die Raum-Kennung**. Jeder Player-Befehl braucht sie, ermittelt wird sie
client-seitig aus Spotifys Geräteliste (`spotify-player.service.ts:340-365`). Für die neue
Seite wäre ein kleiner Server-Endpunkt der günstigere Weg.

---

## Drei Stolpersteine, die beim Nachbau sicher zuschlagen

1. **Titelsprung in Spotify-Alben braucht `offset+1`** (`player.service.ts:143-152`) —
   sonst spielt jeder Tipp den Titel *davor*.
2. **`seekpos:` bedeutet bei Spotify Millisekunden, bei lokaler Wiedergabe Prozent.**
3. Der Symlink-Pfad des Farbthemas (siehe oben).

---

## Vorgeschlagene Reihenfolge

**Stufe 1 — Startseite und Mini-Player** (das, was du sehen wolltest)
- gemeinsames Modul für den laufenden Titel (`now-playing.ts` unverändert mitbenutzen)
- `/player/local` alle 1000 ms + `/player/state` alle 2000 ms, nur solange die Seite sichtbar ist
- Album-Raster aus `/api/data` (das liest `active_data.json`, nicht `data.json`)
- Darstellungs-Variablen anwenden + Abgleichtakt

**Stufe 2 — Theme-Designer für beide**
- `pruefen`/`anwenden` in ein gemeinsames Modul schneiden
- Farbfelder in der `Darstellung` ergänzen, damit der Designer überhaupt Farben hat

**Stufe 3 — die gemeinsame Datenschicht**
- `updateMedia` entflechten — gemeinsam mit E9, nicht daneben

---

## Offen (Entscheidungen, keine Technik)

1. **Wo lebt die gemeinsame Schicht?** Ein neuer Ordner `src/gemeinsam/`, den beide
   Frontends importieren — oder ein Server-Endpunkt, der die fertige Liste liefert?
   Ersteres spart einen Netzweg, letzteres spart Doppelpflege und hilft E9.
2. **Farbfelder in der Darstellung**: 13 neue Felder wären ein spürbarer Eingriff in eine
   Datei, die beide Oberflächen lesen. Lieber wenige, gut gewählte?
3. **Farbthema und neue Oberfläche**: eigene Themendateien für `/neu/`, oder die
   `--ion-*`-Werte in neutrale Namen übersetzen?
