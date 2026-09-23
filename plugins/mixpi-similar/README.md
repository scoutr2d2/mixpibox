# mixpi-similar — ähnliche Interpreten aus mehreren Quellen

**Stand: 06.09.2026, Fassung 0.2.0.** Empfehlungen **und** Wachliste sind
gebaut; die Empfehlungen sind am echten Dienst durchgestochen, die Wachliste
gegen aufgezeichnete Antworten (Abnahmekriterien 6–8 des Entwurfs als Zeugen).
Was offen bleibt, steht unter [Was noch fehlt](#was-noch-fehlt).

Beantwortet zwei Fragen:

* *„Das Kind hört Pettersson und Findus — was noch?"*
* *„Gibt es zu dem, was die Box schon hat, etwas Neues?"*

```bash
curl 'http://<box>:8200/api/plugins/mixpi-similar/http/aehnlich?name=Pettersson%20und%20Findus'
```

## Warum es diese Erweiterung gibt

Die übliche Antwort eines Empfehlungsdienstes ist *„was Vierjährige sonst so
hören"*, und das ist fast nie eine Antwort: zwischen einem ruhigen
Bauernhof-Hörspiel und einer Rettungsstaffel mit Martinshorn liegt alles, was
einen Abend ausmacht. Deshalb steht neben den Hördaten-Quellen eine eigene
**Themenkarte**, und deshalb wiegt sie in der Vorgabe am meisten.

Wie berechtigt das ist, zeigt die Messung am 06.09.2026
(`python3 tools/similar-quellen-probe.py bilanz`) — vier deutsche
Kinderserien gegen zwei Popmusiker als Kontrolle:

| Quelle | Kinderserien | Kontrolle |
|---|---|---|
| MusicBrainz | 4/4 | 2/2 | (nur Identität, keine Ähnlichkeit) |
| **Deezer** | **3/4** | 2/2 |
| ListenBrainz | 1/4 | 2/2 |

**ListenBrainz lieferte zu „Benjamin Blümchen" als zweiten Treffer
Rammstein.** Hördaten messen, wer dasselbe hört — und wer abends
Kinderhörspiele auflegt, hört nachts etwas anderes. Auf einer Box, vor der ein
Kind sitzt, ist das keine schwache Empfehlung, sondern eine falsche. Die
Quelle ist deshalb auf Gewicht 0,3 gesetzt, nicht abgeschaltet: wer sie
hochdreht, sollte `mindestensQuellen` auf 2 stellen.

## Die Wege

Alles unter `/api/plugins/mixpi-similar/http/…`, also **hinter dem Tor der
Verwaltung** — das ist eine Elternfrage, keine Kinderfrage.

| Weg | Wofür |
|---|---|
| `GET /http/aehnlich?name=…&mbid=…&grenze=…&quellen=…` | das fusionierte Ergebnis |
| `GET /http/quellen` | welche Quelle mitspielt, welche stumm ist und warum |
| `GET /http/roh?name=…` | die Rohtreffer je Quelle, vor der Fusion |
| `POST /http/inhalt` | einen Datensatz der Themenkarte anlegen/ändern |
| `POST /http/kartei-leeren` | Zwischenspeicher verwerfen (`{"quelle":"deezer"}` oder leer) |
| `GET /http/wachliste` | beobachtete Interpreten, Zeitplan, Kanäle, ungelesene Meldungen |
| `POST /http/wachliste/eintragen` | `{"name":"…"}` — legt zugleich die Grundlinie an |
| `POST /http/wachliste/entfernen` | `{"name":"…"}` |
| `POST /http/wachliste/aus-bestand` | schlägt Namen aus der Medienliste der Box vor |
| `POST /http/wachliste/pruefen` | jetzt prüfen (ein Eintrag; `{"name":"…"}` für einen bestimmten) |
| `GET /http/nachrichten?ungelesen=true` | der Posteingang |
| `POST /http/nachrichten/gelesen` | `{"nr":"…"}` |

Antwort von `/http/aehnlich`:

```json
{
  "frage": { "name": "Pettersson und Findus" },
  "ergebnis": [
    { "name": "Benjamin Blümchen", "punkte": 0.038452,
      "quellen": { "deezer": 1, "inhalt": 8 }, "unaufgeloest": true }
  ],
  "meta": { "benutzt": ["deezer","listenbrainz","inhalt"], "stale": [], "fehler": {} }
}
```

`quellen` trägt **den Rang je Quelle mit**, nicht nur die Namen. Ohne diese
Angabe ist ein Ergebnis nicht zu beurteilen — „warum steht das da?" ist die
erste Frage, die jemand stellt, und sie muss ohne einen zweiten Lauf zu
beantworten sein.

## Was anders ist als im Entwurf, und warum

Der Entwurf beschrieb einen eigenen Dienst im Backend mit SQLite und
`/api/similar/*`. Gebaut ist ein **Plugin**, aus einem Grund, der schwerer
wiegt als der Aufwand: der Kern ist der Ort, an dem die Kinderzeit hängt, und
jede Zeile dort kann ein Kind vor eine stumme Box stellen. Ein Plugin läuft im
eigenen Worker mit eigenem Speicherdeckel und eigener Frist; stirbt es, spielt
die Musik weiter.

| Entwurf | Gebaut | Warum |
|---|---|---|
| SQLite (`better-sqlite3` / `node:sqlite`) | JSON im Datenordner | `better-sqlite3` ist eine **native** Abhängigkeit, der Ausrollweg kopiert Plugins aber mit `cp` — auf einem Pi 4 gebaut, auf einem Pi 5 kaputt, und der Fehler sieht aus wie ein kaputtes Plugin. `node:sqlite` hängt an der Node-Fassung der **Box** (v22), nicht des Entwicklerrechners (v26). Bei ein paar hundert Einträgen ist eine Datei im Speicher ohnehin schneller. |
| `/api/similar/*` | `/api/plugins/mixpi-similar/http/*` | Der Vertrag gibt keinen anderen Weg her (E77). |
| `DELETE …/cache` | `POST …/kartei-leeren` | Die Durchreiche lässt nur GET und POST durch. |
| `config/similar.json` | `felder` im Manifest | Der Eltern-Bereich baut die Oberfläche daraus von selbst. |
| Deezer-Gewicht 0,7 | **1,0** | Die Begründung für 0,7 war „liefert keinen Score" — das stimmt, ist aber für RRF gleichgültig, weil RRF ohnehin nur den Rang benutzt. Herabgestuft wurde damit die beste Quelle. |
| ListenBrainz-Gewicht 1,0 | **0,3** | Siehe die Messung oben (Rammstein). |
| Ollama-Vorgabe `http://localhost:11434` | **leer** | Siehe unten. |

### Ollama auf localhost geht nicht — und das ist kein Fehler

`kontext.holen` verwehrt `127.0.0.0/8`, `localhost` und die eigenen Adressen
der Box (`adresseErlaubt` in `plugin-laufwerk.ts`) — der Riegel gegen den
kurzen Weg an der Kinderzeit vorbei. Ein Plugin mit `localhost:11434` im Feld
fängt sich bei **jeder** Anfrage einen Wurf und fällt auf die Schlagworte
zurück, ohne dass jemand versteht, warum.

Die Vorgabe ist deshalb **leer** (= Schlagwort-Vergleich), und ein `localhost`
im Feld wird abgefangen und in Worte gefasst, statt am Adressenriegel zu
zerschellen. Wer Einbettungen will, trägt die Adresse eines **anderen**
Rechners im Netz ein.

## Die Themenkarte

40 Datensätze in [`inhalt-daten.json`](inhalt-daten.json), von Hand gepflegt:
`name`, `auch` (Aliase), `tags`, `beschreibung`. Verglichen wird über Jaccard
auf den Schlagworten; mit Ollama zusätzlich über Kosinus auf Einbettungen, und
beides wird gemittelt — die Schlagworte sind die verlässlichere Auskunft, die
Einbettung fängt, was nur in der Beschreibung steht.

**Sie ist am echten Bestand der Box ausgerichtet, nicht am Katalog.** Am
06.09.2026 gegen die 66 Einträge von Box `.62` gemessen: **20 von 21**
Interpretenfeldern werden aufgelöst, **64 von 66** Einträgen sind thematisch
beschrieben. Der einzige Fehlschlag ist „ROSÉ, Bruno Mars" — echte Popmusik,
die in einer Kinder-Themenkarte nichts verloren hat.

Zwei Dinge hat erst dieser Abgleich aufgedeckt, beide sind jetzt Zeugen:

* **Das `artist`-Feld der Box ist nicht *ein* Interpret.** Dort steht
  „Ruby van der Bogen, 101 fabelhafte Freunde" und „Team Karacho, ANOTHER
  NGUYEN" — bei 9 von 66 Einträgen, dem größten Posten im ganzen Bestand. Wer
  das Feld als einen Namen nimmt, findet nichts. Zerlegt wird deshalb der
  **rohe** Name: `normalName` macht aus jedem Komma ein Leerzeichen, und wer
  danach am Komma trennen will, findet keines mehr.
* **„Hörspiele" und „Hoerspiele" müssen zusammenfallen.** Die Box führt
  „Hello Kitty Hörspiele", die Karte „Hello Kitty Hoerspiele". Wer nur die
  Diakritika wegnimmt, bekommt „horspiele" gegen „hoerspiele" — zwei
  Schlüssel für dieselbe Serie. Deutsche Umlaute werden deshalb
  **ausgeschrieben**, bevor der NFD-Schritt läuft.
* **Manchmal ist der `artist` ein Sender, nicht eine Serie.** „Quarks Science
  Cops" steht unter `artist: "WDR"`, die Serie im `title`. Ein Sendername
  taugt weder als Alias noch als Wachlisten-Eintrag: der WDR produziert auch
  „Die Sendung mit der Maus", ein Alias schöbe beide in einen Topf, und ein
  Sender veröffentlicht täglich. Deshalb heißt der Eintrag „Quarks" und führt
  `auch: ["Quarks Science Cops"]` — den Titel, nicht den Sender.

**Der Bestand ist nicht derselbe wie gestern.** Am Vormittag des 06.09.2026
antwortete die Box unter `.62` mit 66 Einträgen, am Nachmittag unter `.78` mit
44 — und die zweite Liste enthält neben Conni und Hello Kitty auch **Red Hot
Chili Peppers und Alin Coen**. Das ist die praktische Fassung des
Rammstein-Befunds oben: auf demselben Gerät liegt Kinder- neben
Erwachsenenmusik, und genau daraus lernt ein Hördaten-Dienst „wer Conni hört,
hört auch Red Hot Chili Peppers". Zahlen aus diesem Abschnitt gehören vor dem
Weiterverwenden nachgemessen, nicht geglaubt.

Einen Datensatz ergänzen (landet im Datenordner und überschreibt den
mitgelieferten Eintrag desselben Namens):

```bash
curl -X POST http://<box>:8200/api/plugins/mixpi-similar/http/inhalt \
  -H 'content-type: application/json' \
  -d '{"name":"Der Räuber Hotzenplotz","tags":["abenteuer","wald","humorvoll"],"beschreibung":"…"}'
```

## Eine eigene Quelle dazubauen

Eine Datei in `quellen/` genügt — der Verzeichnis-Scan findet sie, ohne dass
im Plugin etwas geändert wird. Pflicht ist nur `id`; alles andere ist
freiwillig, dieselbe Regel wie im Plugin-Vertrag selbst:

```js
export const id = 'meinequelle'
export const name = 'Meine Quelle'
export default {
  id, name,
  async aufloesen(frage, umgebung) { /* → { quellenId, name, mbid?, extra? } | null */ },
  async aehnlich(ref, grenze, umgebung) { /* → [{ name, mbid?, rang }] */ },
  async veroeffentlichungen(ref, umgebung) { /* freiwillig */ },
}
```

`umgebung` trägt alles mit, was gebraucht wird — `holen`, `protokoll`,
`nutzerKennung`, `marke(id, grenze)` für den Takt, `karteien`. Eine Quelle
greift sich **nichts** selbst; deshalb ist sie in einem Zeugen ohne Box zu
prüfen, indem man die Umgebung fälscht.

`aehnlich` ist **nicht** Pflicht: `musicbrainz` liefert nur Identität und
Veröffentlichungen und hat bewusst keins.

## Die Fallen, die gemessen wurden

Alle am 06.09.2026, alle als Zeuge festgenagelt und in
`tools/similar-gegenprobe.sh` einzeln kaputtgemacht:

* **Deezers erster Treffer ist nicht der beste.** `q=Conni` liefert als
  Ersten „Conni & Co" (id 57582222) mit **leerem** `/related`. Die gesuchte
  Serie heißt ebenfalls „Conni" (id 75255, 95 Alben, 29 964 Anhänger).
  `nb_fan`/`nb_album` stehen im Suchergebnis schon drin.
* **Deezer meldet Fehler mit HTTP 200** und einem `error`-Feld. Wer nur den
  Status prüft, trägt die Fehlermeldung als leere Liste in die Kartei — dort
  steht sie dann 30 Tage.
* **MusicBrainz drosselt trotz eingehaltener 1 Anfrage/s** (5 von 18 Anfragen
  kamen als 503). Wer 503 als „gibt es nicht" liest, streicht Serien, die es
  gibt.
* **Der ListenBrainz-Algorithmusname muss vollständig sein.**
  `…_threshold_10_limit_100_filter_True_skip_30` gibt 200, derselbe Name ohne
  das letzte Stück gibt **400**. Es gibt keine gültige Kurzform — genau daran
  ist die erste Fassung gescheitert, und der Fehler sah aus wie ein toter
  Dienst.
* **ListenBrainz nennt den Interpreten selbst mit**, unter anderer MBID und
  mit dem höchsten Wert. Ohne Filter steht die Serie in ihrer eigenen
  Empfehlung an erster Stelle.
* **Last.fm liefert einen einzelnen Treffer als Objekt**, nicht als Liste
  (Eigenheit aus der XML-Herkunft). Ohne Behandlung wirft `.map` genau dann,
  wenn es einen Treffer gibt.
* **Ein Rate-Limit darf nie zum Fristriss werden.** Ein Plugin-Ruf hat 8 s,
  MusicBrainz erlaubt 1 Anfrage/s — in einen Ruf passen also höchstens sieben.
  Der Takt sagt deshalb **nein**, statt zu warten; ein Nein führt zum
  abgelaufenen Karteieintrag (`stale`), ein Fristriss terminiert den Worker
  samt allen offenen Rufen.

## Prüfen

```bash
node --test plugins/mixpi-similar/*.spec.mjs            # 124 Zeugen in 3 Dateien, ohne Netz
bash tools/similar-gegenprobe.sh                        # macht 21 Vorrichtungen einzeln kaputt
npx tsx tools/plugin-pruefen.mjs plugins/mixpi-similar  # das Urteil des echten Kerns
npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/mixpi-similar --http "aehnlich?name=Conni"
python3 tools/similar-quellen-probe.py bilanz           # die Dienste selbst, geht ins Netz
```

Die drei Zeugendateien prüfen verschiedene Dinge, und das ist kein Zufall:
`index.spec.mjs` die Bausteine, `wachliste.spec.mjs` die reine Logik,
`wege.spec.mjs` die **Verdrahtung** durch `http()` mit echtem Wirt. Die ersten
beiden waren grün, als die Wachliste noch von nichts aufgerufen wurde — sie
fassten die Verdrahtung nicht an und konnten das gar nicht merken.

Die Zeugen laufen außerdem in `tools/plugin-zeugen-probe.sh` mit, das seit dem
06.09.2026 in `tools/doku-luecken-probe.sh` hängt.

## Die Wachliste

Beobachtet Interpreten, die die Box schon hat, und meldet, wenn dazu etwas
Neues erscheint.

```bash
curl -X POST http://<box>:8200/api/plugins/mixpi-similar/http/wachliste/eintragen \
  -H 'content-type: application/json' -d '{"name":"Pettersson und Findus"}'
```

**Die Grundlinie ist der ganze Trick.** Beim Eintragen wird der aktuelle Stand
als *bekannt* vermerkt; gemeldet wird nur, was **danach** erscheint. Ohne
diesen Schritt meldet der erste Durchlauf einer Wachliste mit zwanzig Serien
mehrere hundert „Neuerscheinungen" — den gesamten Altbestand — und man schaltet
die Benachrichtigung ab, bevor sie je etwas Nützliches gesagt hat. Lässt sich
die Grundlinie nicht holen, wird **gar nicht erst eingetragen**: ein Eintrag
mit leerer Grundlinie sieht aus wie ein normaler und meldet beim nächsten Lauf
alles, was der Interpret je veröffentlicht hat.

**Ein Werk wird einmal gemeldet, auch wenn zwei Quellen es liefern.**
Zusammengelegt wird über die Release-Group-MBID, ersatzweise UPC, ersatzweise
normalisierter Titel **+ Jahr**. Warum Jahr und nicht Datum: MusicBrainz führt
bei Hörspielen überwiegend nur „2026" (Bibi Blocksberg: 8 taggenau gegen 15 nur
Jahr), Deezer immer „2026-03-14" — auf das Datum verglichen wären das zwei
Werke. Beim Zusammenlegen gewinnt die genauere Angabe; **wer nach dem
MusicBrainz-Datum sortiert, sortiert bei Hörspielen Rauschen.**

### Der Zeitplan läuft im Hintergrund, nicht in einem Ruf

Das ist keine Stilfrage: ein Plugin-Ruf hat 8 Sekunden, MusicBrainz lässt eine
Anfrage pro Sekunde zu. Eine Wachliste mit zwanzig Einträgen und zwei Quellen
braucht vierzig — wer den Durchlauf in einen Ruf legt, reißt die Frist, und ein
Fristriss **terminiert den Worker samt allen offenen Rufen**; die Empfehlungen
stürben mit.

Der Worker lebt dagegen über alle Rufe hinweg (er wird beim Laden gestartet,
nicht beim Rufen). Ein `setInterval` darin unterliegt keiner Frist, weil
niemand darauf wartet. Alle 15 Minuten wird **ein** Eintrag geprüft, und zwar
der am längsten nicht geprüfte — das ist die Voraussetzung dafür, dass ein
Durchlauf abbrechen darf. Ein Lauf, der immer vorn anfängt, prüft bei knapper
Zeit ewig dieselben ersten Einträge und erreicht die hinteren nie.

Das Zeitfenster (Vorgabe 02:00–05:00) **kann über Mitternacht**. Bei
„22:00 bis 06:00" ist `von` größer als `bis`, und ein naiver Vergleich liefert
dann immer falsch — die Wachliste liefe nie, ohne eine einzige Zeile im
Journal.

### Die Kanäle

| Kanal | Verhalten |
|---|---|
| **Posteingang** | immer, nicht abschaltbar, kein Kanal im Verzeichnis |
| `ntfy` | Push an ein Topic; Adresse **und** Thema nötig |
| `webhook` | POST mit dem Ereignis als JSON |

**Die Meldung liegt immer zuerst im Posteingang**, erst danach wird zugestellt.
Ein Kanal, der ausfällt, meldet das ins Journal und hält die anderen nicht auf
— eine Benachrichtigung, die beim Ausfall des Zustellwegs spurlos verschwindet,
ist schlimmer als gar keine, weil man sich auf sie verlässt und nie erfährt,
dass sie ausgefallen ist.

Ein eigener Kanal ist eine Datei in `kanaele/` mit `id`, `name`, `senden()` und
optional `bereit()` — derselbe Verzeichnis-Scan wie bei den Quellen. `senden()`
gibt `{ ok, text }` zurück und **wirft nicht**.

### Aus dem Bestand füllen

`POST /http/wachliste/aus-bestand` **schlägt vor, statt einzutragen**: jeder
neue Eintrag braucht eine Grundlinie und damit Anfragen an fremde Dienste, und
bei zwanzig Namen ist das kein Vorgang für einen 8-Sekunden-Ruf.

Der Bestand kommt dabei **von der Platte, nicht über HTTP** — `kontext.holen`
verwehrt die eigene Box, `GET /api/data` ist für ein Plugin der verbotene Weg.
Der Pfad wird aus dem eigenen Datenordner abgeleitet, weil `data.json` und
`plugin-daten/` im Server am selben `configBasePath` hängen (server.ts:792 und
:2600). Und es muss `data.json` sein, **nicht `active_data.json`**: letztere ist
im Offline-Betrieb eine andere, kürzere Liste (server.ts:9141) — wer sie nähme,
würfe Wachlisten-Einträge weg, sobald die Box einmal ohne Netz gestartet ist.

**Der Umweg ist nicht nur erzwungen, er ist auch der bessere Weg.** Am Gerät
gemessen (06.09.2026, Box `.78`):

| | Einträge | verschiedene `artist` |
|---|---|---|
| `server/config/data.json` | **144** | 36 |
| `GET /api/data` | 44 | 11 |

Die API liefert eine **gefilterte Teilmenge** — zwei Drittel fehlen. Für eine
Wachliste, die den ganzen Bestand beobachten soll, wäre sie die falsche
Quelle gewesen, ganz unabhängig vom Riegel.

> **Achtung beim Weiterlesen:** Zahlen in diesem README, die als
> „Bestand der Box" auftreten und aus `/api/data` stammen (die 66 vom
> Vormittag, die 44 vom Nachmittag), messen die **API-Antwort**, nicht den
> Bestand. Die Abdeckungsquote der Themenkarte (20 von 21) ist deshalb gegen
> die kleinere Liste gerechnet.

## Am Gerät gemessen (06.09.2026, Box `.78`)

Ausgerollt, Server neu gestartet, Plugin `bereit`. Was dort wirklich lief:

* **Empfehlungen.** „Pettersson und Findus" → Benjamin Blümchen, Was ist Was,
  Die Olchis. Der erste Platz zeigt die Fusion bei der Arbeit: Benjamin
  Blümchen steht in der Themenkarte nur auf Rang 8, bei Deezer aber auf 1 —
  **Übereinstimmung schlägt Überzeugung**, genau wofür `k = 60` da ist.
* **Grundlinie.** Der Eintrag „Pettersson und Findus" holte **63**
  Veröffentlichungen aus MusicBrainz und Deezer zusammen. Das sind 63
  Falschmeldungen, die ein Weg ohne Grundlinie beim ersten Lauf erzeugt hätte.
* **Zwei Prüfläufe hintereinander: null Meldungen.** Der Posteingang blieb
  leer, wie er soll.
* **Bestandslesen.** `server/config/data.json` wurde über den abgeleiteten
  Pfad gefunden und gelesen; die Zerlegung trennte „Ruby van der Bogen" von
  „101 fabelhafte Freunde" und „Simone Sommerland" von „Die Kita-Frösche".
* **Karteien.** `aehnlich-kartei.json`, `identitaet-kartei.json` und
  `wachliste.json` liegen im Datenordner und werden geschrieben.

## Was noch fehlt

**Eine echte Neuerscheinung hat die Wachliste noch nie gesehen.** Dass sie
nichts meldet, wenn es nichts gibt, ist am Gerät belegt; dass sie meldet, wenn
etwas erscheint, nur im Zeugen gegen eine aufgezeichnete Antwort
(Abnahmekriterium 6). Das lässt sich nicht erzwingen — es braucht eine echte
neue Folge, also Wochen.

**Der Zeitplan ist ungemessen.** Er startet beim ersten Ruf und weckt alle 15
Minuten; dass er das über Tage tut, ohne Speicher zu fressen oder den Worker
am Beenden zu hindern, ist begründet (`unref()`), aber nicht nachgemessen. Das
Zeitfenster stand während der Messung auf 02:00–05:00, der Hintergrundlauf ist
also am Nachmittag gar nicht angetreten — geprüft wurde über
`/http/wachliste/pruefen`.

**Die Kanäle sind am Gerät unbenutzt.** ntfy und Webhook waren nicht
eingerichtet (`an: false`), die Meldungen liefen nur in den Posteingang. Der
Ausfallweg ist im Zeugen belegt, nicht am echten Dienst.

**`notifyNewSimilar` aus dem Entwurf (§9.1, „neuer ähnlicher Interpret") gibt
es nicht.** Der Entwurf hatte es selbst auf *Default aus* gesetzt. Es fehlt
bewusst: dafür müsste je Wachlisten-Eintrag regelmäßig die volle Fusion
laufen, und die kostet ein Vielfaches einer Release-Abfrage — für eine Meldung,
deren Nutzen erst feststeht, wenn die Empfehlungen im Alltag taugen.

**Nicht gemessen:** Last.fm. Dafür braucht es ein Konto, und eines anzulegen
war nicht Teil dieser Arbeit. Die Quelle folgt der Doku und fährt im Zeugen
gegen eine aufgezeichnete Antwort; wer einen Schlüssel einträgt, ist der
Erste, der sie wirklich laufen lässt.
