# MixPi — die Wesen und ihre Zustände

## Die Geschichte dahinter

**MixPis sind Musikwesen vom MixPi-Planeten.** Es gibt sehr viele von ihnen, und
sie sind alle verschieden — so wie Menschen. Das ist keine Verzierung, sondern
der Rahmen, in dem diese Oberfläche gebaut wird.

Zwei Dinge folgen daraus, und beide sind wichtiger, als sie klingen:

**Es gibt nicht „das" Maskottchen.** Die Datei unten ordnet Bilder Zuständen zu
(hört, spielt, schläft …) — das bleibt richtig. Aber die Bilder sind nicht ein
Wesen in verschiedenen Lagen, sondern *verschiedene Wesen*. Wer neue hinzufügt,
erweitert eine Art, keinen Zeichensatz.

**Jedes Kind bekommt sein eigenes.** Geplant ist, dass sich mehrere Kinder
anmelden — Liam bekommt seins, Kalea ihres, und mit dem Zugang auch die eigenen
Hörspiele, das eigene Weiterhören, die eigene Kinderzeit. Das MixPi ist dann
nicht Dekor, sondern das *Erkennungszeichen*: Ein Kind, das noch nicht liest,
erkennt seinen Zugang am Wesen, nicht am Namen.

Weitere MixPis entstehen mit **Meshy**; sie liegen als Kandidaten in
`maskottchen.json` unter `_sammlung`, bis sie eine Aufgabe bekommen.

## Wozu sie in der Oberfläche stehen

Sie begleiten die Stellen, wo sonst nichts oder ein nüchterner Satz stünde. Sie
ersetzen keine Auskunft — sie machen sie freundlich.

## Ablage

Die Bilder liegen in `bilder/`. Alles in `NewDesign/` wird durch die Bau-Regel in
`src/frontend-box/angular.json` nach `www/neu` kopiert und ist damit unter
`http://<box>:8200/neu/bilder/…` erreichbar — **ohne Netz**, PNG mit durchsichtigem
Grund.

## Benennung

`mixpi-<zustand>.png`, Zustand kleingeschrieben und deutsch.

| Datei | Zustand | Wo es hingehört | px |
|---|---|---|---|
| `mixpi-hoert.png` | steht, Augen zu — **das Standardbild** | Zeichen „wer hört" oben links, solange kein Kind ein eigenes Bild gewählt hat | 256 |
| `mixpi-spielt.png` | singt mit offenem Mund, Funken ringsum | **Während der Wiedergabe** — löst aus, wenn `/player/state` `playing` meldet | 256 |
| `mixpi-kein-bild.png` | zuckt mit den Schultern, daneben eine **gestrichelte** Karte mit Note und Fragezeichen | **Ersatzbild IN der Kachel**, wenn der Eintrag da ist, sein Cover aber nicht — eigene Regeln, siehe unten | 160 |
| `mixpi-schlaeft.png` | liegt, Zzz | Ruhezeit, Kinderzeit abgelaufen, Bildschirm gleich aus | 256 |
| `mixpi-farben.png` | winkt, Farbfächer in der Hand | Themenauswahl — „welches Aussehen darf es sein?" | 256 |
| `mixpi-gestalten.png` | Palette und Pinsel, bemalt eine **Musikbox** | **Theme-Designer** (Admin-Reiter „Darstellung") | 256 |
| `mixpi-blase.png` | winkt, **leere** Sprechblase | Begrüßung; der Text wird überlagert, siehe unten | 384 |
| `mixpi-sucht.png` | Lupe vor dem Auge, Fragezeichen | Suche läuft, Bibliothek wird gelesen, kein Treffer | 256 |
| `mixpi-passwort.png` | zeigt auf ein Schloss mit Sternchenfeld | **PIN-Dialog der Einstellungssperre**, Admin-Anmeldung | 256 |
| `mixpi-fehler.png` | erschrocken, rotes Warndreieck | Etwas ist wirklich kaputt — strenge Regeln, siehe unten | 256 |

**Der Unterschied zwischen `kein-bild` und `fehler` ist Absicht:** Ein fehlendes
Cover ist Alltag und bekommt ein Schulterzucken. Ein rotes Dreieck bedeutet, dass
etwas nicht funktioniert. Wer beides gleich zeichnet, dem glaubt man das Dreieck
nicht mehr, wenn es darauf ankommt.

Zwei Zeichen tragen diesen Unterschied: bei `kein-bild` die **gestrichelte**
Umrandung der Karte — die Konvention für „hier fehlt etwas" —, bei `fehler` das
rote Dreieck. Ein Kind muss die Wörter nicht lesen können, um zu merken, dass das
eine harmlos ist und das andere nicht.

---

## Die Bilder werden ERZEUGT, nicht von Hand geschnitten

Die Vorlagen liegen in `bilder/quellen/` (28 MB, 25 Dateien). Daraus entstehen die
benannten Bilder:

```bash
tools/maskottchen-bauen.py
```

Welche Vorlage welcher Zustand wird, steht in `maskottchen.json` im Feld `quelle`.
**Das ist die Entscheidung** — die Bilder daneben sind nur ihr Ergebnis. Kommt eine
bessere Vorlage, wird dort der Name geändert und das Werkzeug neu laufen gelassen.

`bilder/quellen/**` ist in `src/frontend-box/angular.json` von der Kopie nach
`www/neu` **ausgenommen**. Ohne das lägen 27 MB Vorlagen auf der SD-Karte für
568 kB Nutzen — und die neue Oberfläche wurde mühsam von 4,1 MB auf 300 kB gebracht.

### Was beim Aufbereiten der Vorlagen zu wissen ist

Alle 25 kamen **ohne Transparenz** an — auch die vier, die `…-transparent.png`
hießen, und die eine, die `…-alpha.png` heißt. **Der Dateiname sagt darüber
nichts.** Zwei Fallen stecken darin, beide belegt:

1. **MixPi ist weiß (254), der Hintergrund fast auch (247).** Wer nach Farbe
   maskiert, radiert die Figur mit weg. Was trägt, ist die dunkle Kontur: geflutet
   wird vom Bildrand her, und die Flut bleibt an der Kontur stehen.
2. **Bei `mixpi-fehler` war das Transparenz-Karo als echte Pixel eingebrannt**
   (Ecke wechselt blockweise 237/254). Weil die helle Karofarbe genau das
   Figurenweiß trifft, sah es auf weißem Grund richtig aus — auf dunklem stand ein
   Karomuster um die Figur.

Beides erledigt `tools/bilder-freistellen.py`; `tools/bilder-pruefen.py` findet
solche Bilder, `tools/kontaktbogen.py` zeigt sie auf dunklem Grund nebeneinander.

## Verwendung

- **Nie ohne Text.** Das Bild trägt die Stimmung, der Satz trägt die Auskunft.
  „Noch kein Album" sagt, was los ist; MixPi sagt, dass es nicht schlimm ist.
- **Nie als Ladeanzeige missbrauchen.** Wer lädt, will wissen, dass etwas passiert —
  dafür ist Bewegung zuständig, nicht ein stehendes Bild.
- **Höchstens eines je Bildschirm.** Sonst wird aus einem Begleiter ein Rudel.

---

## Die Sprechblase — ein Bild, das reden kann

`mixpi-blase.png` ist das einzige Bild der Familie, das **kein fertiges Bild ist**:
Die Blase ist leer und durchsichtig. Der Text wird nicht eingebrannt, sondern
darübergelegt — damit wird aus einer Grafik ein Bauteil, das jeden Tag etwas
anderes sagen kann.

### Wie der Text hineinkommt

Die Blase liegt an einer festen Stelle IM Bild. Damit der Text mitwächst, wenn das
Bild skaliert, wird ihr Feld in Prozent der Bildgröße angegeben — nicht in Pixeln:

```html
<div class="mixpi-spricht">
  <img src="bilder/mixpi-blase.png" alt="">
  <p class="blasentext">Hallo! Was möchtest du hören?</p>
</div>
```

```css
.mixpi-spricht { position: relative; display: inline-block; }
.mixpi-spricht img { width: 100%; height: auto; display: block; }
/* Das Feld der Blase, gemessen am Bild. Prozent, damit es jede Größe mitmacht. */
.blasentext {
  position: absolute;
  /* GEMESSEN, nicht geschaetzt: die weisse Flaeche ist ein Kasten von
     171x122 px bei (192,85) in einem 384x384-Bild. Die Werte hier sind
     das eingezogene TEXTfeld - sonst klebt die Schrift an der Rundung
     und am Zipfel der Blase. */
  left: 53%; top: 25%; width: 39%; height: 25%;
  display: grid; place-items: center;
  margin: 0; padding: 0 2%;
  text-align: center; text-wrap: balance;
  font-family: 'Baloo 2', system-ui, sans-serif;
  /* Mitwachsend statt fest: sonst steht der Text bei kleiner Darstellung über. */
  font-size: clamp(0.8rem, 2.2cqw, 1.6rem);
  color: #1a1a2e;
}
```

Gemessen wurde mit einer Flut über die hellen, deckenden Flächen: Es gibt genau
zwei große — den Körper (129×162 bei 37,136) und die Blase (171×122 bei 192,85).
Kommt eine neue Vorlage, ist das in einer Minute nachgemessen.

### Zwei Regeln, die aus der Form folgen

1. **Kurz halten.** Die Blase ist so groß, wie sie ist. Ein Satz, höchstens zwei —
   und lieber eine Zeile zu wenig als eine zu viel. Wer mehr sagen will, braucht
   keine Blase, sondern eine Seite.
2. **Nie lebenswichtige Auskunft allein in die Blase.** Sie ist ein Gruß, kein
   Fehlerbild. „Kein WLAN" gehört nicht dorthin.

### Sie kann auch sprechen

Die Box hat bereits eine Stimme: `GET /api/vorlesen/sprich?text=…` spricht
beliebigen Text, und `&silben=1` zerlegt ihn in Silben — das ist ausdrücklich für
Leseanfänger gedacht (siehe `vorlese.service.ts`, Modi `aus | antippen | lernen`).

Damit liegt nahe: **ein Tipp auf die Blase liest vor, was darin steht.** Für ein
Kind, das noch nicht liest, wird der Gruß damit überhaupt erst zugänglich — und es
ist keine neue Technik nötig, nur eine Verbindung zweier vorhandener Dinge.

Zu beachten: Vorlesen ist eine Einstellung, kein Automatismus. Steht der Modus auf
`aus`, bleibt die Blase still — sie darf nicht ungefragt losreden.

### Was sie sagen könnte

- Begrüßung nach Tageszeit („Guten Morgen!", „Schön, dass du da bist")
- Wenn nichts läuft: „Was möchtest du hören?"
- Wenn die Kinderzeit fast um ist: „Noch fünf Minuten" — freundlicher als eine Zahl
- Nach dem Einschalten der Box: der Name der Box, damit klar ist, welche man vor sich hat

---

## Das Ersatzbild — ein Sonderfall mit eigenen Regeln

`mixpi-kein-bild.png` ist das einzige Maskottchen, das **nicht neben dem Inhalt**
steht, sondern **an dessen Stelle**: Der Eintrag existiert, nur sein Cover kam nicht
an. Gründe im Betrieb: die Spotify-Adresse antwortet nicht, der Jellyfin-Server ist
aus, die lokale Datei trägt kein eingebettetes Bild.

Daraus folgen drei Regeln, die für die übrigen Bilder NICHT gelten:

1. **Es erscheint vielfach gleichzeitig.** Fällt ein Dienst aus, trägt es jede Kachel
   des Rasters. Die Datei muss deshalb klein sein und bei **rund 160 px** gut
   aussehen — nicht bei 1024. Richtwert: unter 20 kB.
2. **Kein Text daneben.** Die sonst geltende Regel „nie ohne Text" gilt hier
   ausdrücklich nicht: In der Kachel steht bereits der Titel. Ein zusätzliches
   „kein Bild" wäre Lärm — man sieht es ja.
3. **Es darf nicht wie ein Fehler wirken.** Ein fehlendes Cover ist Alltag, kein
   Defekt. Deshalb das Schulterzucken und kein Warnzeichen.

### Wo es einzuhängen ist

Es ersetzt das heutige `nocover_mupi.png` (58 kB). Das steckt an fünf Stellen:

- `src/backend-api/src/server.ts:3647` — `KEIN_BILD`, der Rückfall von
  `GET /api/bild/:schluessel`. **Die wichtigste Stelle: sie bedient die neue
  Oberfläche.**
- `artwork.service.ts`, `spotify-browse.ts`, `now-playing.ts`,
  `medialist.page.html` — die bestehende Angular-App.

**Vorsicht bei der bestehenden App:** Die beiden Oberflächen sollen getrennt bleiben.
Das Ersatzbild dort auszutauschen wäre eine sichtbare Änderung an der alten
Oberfläche — also erst nach Rückfrage, nicht nebenbei.

---

## Die Sammlung — fünfzehn Bilder ohne Auslöser

Von den 25 gelieferten Vorlagen wurden **zehn** zu Zuständen. Die übrigen fünfzehn
zeigen MixPi beim Radfahren, im Zug, im Auto, auf einem Einhorn, in der Badewanne,
unter einem Regenbogen. Hübsch — aber es gibt **keine Lage der Box, in der sie
erscheinen würden**. Nach der Regel oben („nie ohne Text, und der Text muss etwas
sagen") wären sie damit erledigt.

Ein Bild verdient eine besondere Erwähnung: das mit „Hallo / Hello / Xin chào".
Eine Sprachumschaltung klingt plausibel — **die Box hat aber kein i18n**, kein
`ngx-translate`, kein `LOCALE_ID`, nichts. Ein Zustand dafür wäre erfunden, und
genau das ist die Falle bei hübschen Bildern: Man baut die Lage, damit das Bild
einen Platz bekommt.

**Vorschlag statt Wegwerfen:** Das Kind wählt sein Begrüßungsbild selbst. Das ist
ein echtes Merkmal mit einem echten Ort — dem Reiter „Darstellung", den wir für den
Theme-Designer ohnehin anfassen. Bis es diese Auswahl gibt, bleiben die fünfzehn
**unerzeugt** in `bilder/quellen/` und wiegen im Bau nichts. Sie stehen in
`maskottchen.json` unter `_sammlung`; `tools/maskottchen-bauen.py --sammlung`
erzeugt sie, wenn es so weit ist.

---

## Was schon verdrahtet ist

Stand 2026-07-31, in der neuen Oberflaeche unter `/neu/`:

| Zustand | Wo es wirkt | Ausloeser im Code |
|---|---|---|
| `hoert` | Kopfbereich | Vorgabe, solange nichts laeuft |
| `spielt` | Kopfbereich | `/player/state` bzw. `/player/local` meldet `playing` |
| `kein-bild` | Player-Cover | `/api/bild` liefert nichts Brauchbares |
| `sucht` | Leerzustand der Startseite | Bibliothek leer **oder** Filter ohne Treffer |
| `fehler` | Fehlerzustand, Meldung | `/api/werke` bricht; Abspielen misslingt |
| `schlaeft` | Meldung | 403 der Kinderzeit — eine Regel, kein Defekt |

**Pause zaehlt als Stille.** Das singende Bild bedeutet „es kommt etwas aus dem
Lautsprecher". Saenge MixPi bei einer angehaltenen Geschichte weiter, lernte das
Kind, dem Bild nicht zu trauen.

**Noch nicht verdrahtet:** `blase` (Begruessung), `farben` (Themenauswahl) und
`gestalten` (Theme-Designer) — die drei haengen an Stufe 2 und am Admin.

### Ansehen ohne Box

```bash
node tools/neu-vorschau.mjs
```

Dann `http://localhost:8299/neu/`. Die seltenen Faelle lassen sich umschalten,
ohne sie herbeifuehren zu muessen:

```bash
curl localhost:8299/vorschau/leer        # Bibliothek leer
curl localhost:8299/vorschau/kaputt      # /api/werke antwortet 500
curl localhost:8299/vorschau/kinderzeit  # Abspielen mit 403 abgelehnt
curl localhost:8299/vorschau/ohne-cover  # Kacheln ohne Cover
```
