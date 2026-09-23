# Die Figuren der Kinder

**Hier hinein kommen die MixPis, aus denen ein Kind sich seines aussucht.**
Brille, Mädchen, Junge, was auch immer noch dazukommt. Wer eine Datei
hineinlegt, hat die Auswahl erweitert — es braucht keine Codeänderung, keinen
Bau und keinen Neustart. `GET /api/figuren` sieht in diesem Ordner nach.

## Wie eine Datei heißen muss

    mixpi-brille.png
    mixpi-maedchen.png
    mixpi-junge.png

Die Regel ist in `src/backend-api/src/profile.ts` (`FIGUR_MUSTER`) festgelegt
und getestet:

* **klein geschrieben**, nur `a–z 0–9 . _ -`
* **muss auf `.png` enden** — kein `.jpg`, kein `.svg`, keine Endung
  wegzulassen
* keine Umlaute, keine Leerzeichen, kein `/`, höchstens 64 Zeichen
* das führende `mixpi-` ist eine **Empfehlung**, keine Bedingung: `brille.png`
  ginge auch. Der ORDNER entscheidet, nicht der Name.

Eine Datei, die durchfällt, verschwindet nicht stillschweigend — sie steht in
der Antwort von `GET /api/figuren` unter `uebergangen`. Wenn also ein Bild
nicht auftaucht:

    curl -s localhost:8200/api/figuren | python3 -m json.tool

## Warum ein eigener Ordner und nicht `bilder/`

Nebenan in `bilder/` liegen die zehn **Zustände** des Maskottchens (hört,
schläft, fehler, kein-bild …). Die werden von `tools/maskottchen-bauen.py` aus
`bilder/quellen/` erzeugt und gehören der Box, nicht einem Kind. Lägen beide
Sorten im selben Ordner, müsste irgendwo eine Liste stehen, welcher Name
welcher Sorte ist — und an diese Liste denkt der Nächste nicht, wenn er ein
Bild dazulegt. Ein eigener Ordner braucht keine Liste: **was hier liegt, ist
wählbar.**

## Woher die Bilder kommen können

`tools/maskottchen-bauen.py --figuren` stellt die Vorlagen aus
`bilder/quellen/` frei, schneidet sie zu und legt sie hier ab (256 px, PNG mit
durchsichtigem Grund). Welche Vorlage welchen Namen bekommt, steht in
`NewDesign/maskottchen.json` unter `_sammlung.kandidaten`. Der Aufruf erzeugt
nichts von selbst — wer ihn nicht startet, bekommt auch nichts.

Von Hand hineingelegte PNGs sind genauso richtig. Sinnvoll sind 256 × 256 px
mit durchsichtigem Grund. Nachgemessen am 06.08.2026 im Browser auf 800 × 480
zeigt die Oberfläche sie in einem **runden Feld von 56 px** oben links (der
Knopf ringsum ist 66 px — das ist die Trefferfläche, nicht das Bild) und in
einem abgerundeten **Feld von 84 px** in der Auswahl (Kachel 96 px, vier
Spalten). *Hier standen 66 px und „rund 130 px"; beide Zahlen waren die des
umgebenden Kastens, nicht die des Bildes.*

## Solange hier nichts liegt

Dann ist die Auswahl **nicht leer, sondern hat genau einen Eintrag**: „MixPi".
Er wählt das Standardbild `bilder/mixpi-hoert.png` — es liegt **nicht** in
diesem Ordner, sondern nebenan bei den Zuständen, und wird mit der Oberfläche
ausgeliefert. Genau das ist auch der Grund, warum `GET /api/profile` bei einem
Kind ohne eigene Wahl **leer** sagt statt eines Dateinamens: Der Server kennt
nur diesen Ordner. Was bei „leer" zu sehen ist, entscheidet die Oberfläche
(`ichBildPfad` in `app.js`).

**Hier stand bis zum 05.08.2026, der Eintrag heiße „kein Bild" und das Zeichen
oben links zeige dann eine gezeichnete Silhouette.** Das stimmt seit der
Berichtigung des Betreibers nicht mehr — „ich wollte niemals die mixpi figur
unten links, ich wollte sie oben links, schon vorbereitend für den platz des
bildes". Diese Ecke **ist** der Platz des Bildes; ohne eigene Wahl steht dort
das MixPi.

Die Silhouette (SVG, keine Datei) gibt es weiterhin, aber als **Notfall** und
nicht mehr als Normalfall: Sie erscheint nur, wenn ein Bild nicht **lädt**. Sie
kann nicht fehlen und nicht als zerbrochenes Bildzeichen dastehen.

## Wenn Sie hier eine Datei wieder herausnehmen

Dann ist das **kein** Notfall, und es steht auch keine Silhouette da: `GET
/api/profile` nennt nur Figuren, zu denen es eine Datei gibt. Ein Kind, dessen
Bild verschwunden ist, bekommt in der Antwort **leer** und sieht wieder das
MixPi — die Wahl bleibt dabei auf der Platte stehen und kommt zurück, sobald
die Datei zurückkommt.

Die Silhouette bleibt für den Fall übrig, dass **Verzeichnis und ausgelieferte
Datei auseinandergehen**: Das Bild wird gelöscht, während die Seite an der Box
schon offen ist; eine halbe Auslieferung; oder `bilder/mixpi-hoert.png` selbst
fehlt — dann steht sie bei *jedem* Kind. Sie ist also immer ein Hinweis auf
eine fehlende Datei, nie ein „hat sich nichts ausgesucht".

Ein gewähltes Bild, das nicht lädt, fällt dabei **nicht** auf das MixPi zurück
— sonst sähe „das Bild dieses Kindes ist verschwunden" genauso aus wie „es hat
sich nichts ausgesucht". Gemessen wird das alles mit:

    node tools/ich-zeichen-schau.mjs
