# Übernahmen aus der alten Oberfläche — die Fundstellen, BEVOR sie fallen

Stand: 05.09.2026, unmittelbar vor E118/1e (Löschung von `src/frontend-box/`
und `themes/`). Die Zeilennummern gelten für den Baum GENAU VOR der Löschung —
wer sie später braucht, holt die Dateien aus der git-Historie (der
Löschungs-Commit nennt diese Datei). Grundlage ist die Element-Inventur der
alten App vom 05.09.2026 (drei Explore-Läufe, Betreiber-Entscheidungen per
Rückfrage).

## Warum diese Datei existiert

Betreiber, 05.09.2026: „du kannst auch noch die elemente des alten analysieren
und in das neue system übernehmen man muss ja nicht das rad neu erfinden bspw
der flip ..." — die Übernahmen sind E121 (Stufe 4 des Plans); der Code, aus
dem sie portiert werden, fällt aber schon mit E118/1e. Diese Datei ist die
Brücke: WAS übernommen wird, WOHER es kommt, und was BEWUSST fällt.

## Entschieden ÜBERNOMMEN (E121)

### 4d — Der Flip als Überblend-Karte (`reihen.albumTipp: 'karte'`)

Das Erlebnis des Alten: Tipp auf die Album-Kachel → die Titelliste wächst
sichtbar AUS der angetippten Kachel (räumliche Verbindung Kachel↔Liste),
zentriertes Quadrat `min(100vh−16px, 100vw−32px)`, Zeile spielt ab Titel,
Schließen läuft rückwärts in die Kachel.

* Öffnen/Schließen + Geometrie (elementsFromPoint auf die ION-CARD):
  `src/frontend-box/src/app/medialist/medialist.page.ts:212–259` (coverClicked),
  `:322–441` (openFlip), `:443–461` (closeFlip)
* 3D-CSS (NICHT übernehmen — siehe Warnung): `medialist/medialist.page.scss:21–70`
* Geteilte Titellisten-Vorlage: `global.scss:146–200` (`.tl-head/.tl-list/
  .tl-item/.tl-cover/.tl-nr/.tl-name/.tl-play/.tl-current`)
* „Weiter"/„Von vorn" im Flip (blau = gemerkte Stelle, grün = von vorn):
  `medialist.page.html:69–89`, `medialist.page.ts:543–570`
* Player-Cover-Flip (zweite Ausprägung): `player/player.page.html:86–134`,
  `player.page.ts:508–585`
* Finger-Scroll in der Liste: `drag-scroll.directive.ts`

**WARNUNG, teuer gemessen:** Die 3D-Drehung (`rotateY` + `backface-visibility`)
wurde im NewDesign am 02.08.2026 BEWUSST entfernt (`NewDesign/app.css:3806–3818`,
Messung gegen Zeichenschicht-Speicher auf dem Pi 5: `app.css:1671–1704`).
Übernommen wird die IDEE (Karte wächst aus der Kachel, scale/translate,
EINE Zeichenschicht), nicht die Mechanik. Die Titel-DATEN liefern die
vorhandenen Lanes (`NewDesign/app.js:5730–5740` trägt schon
„Weiter/Von vorn" je Kachel).

### 4a — Zeiten

* **`endeZeit`** („· endet um 19:42 Uhr" im Fortschrittsstreifen — die Frage
  vor dem Zubettgehen): Rechnung in
  `src/frontend-box/src/app/now-playing-bar.component.ts:364–366`,
  Feld `darstellung.service.ts:291–292`, Player-Seite `player.page.html:262–264`.
* **`zeigeTimer`** (Restzeit des Schlummer-Timers; leer wenn keiner läuft —
  nicht „0:00"): `zeitanzeige.component.ts:101–104` (Anzeige), `:145–153`
  (Quelle `/api/schlummer`). Im NewDesign existiert KEIN Schlummer-Wort
  (offener Punkt `NewDesign/app.js:9353`, BACKLOG E23/P2).
* **`zeigeRest`** (Restdauer des laufenden Stücks in der Kopfzeile):
  `zeitanzeige.component.ts:105–108`, Brücke von der Leiste
  `now-playing-bar.component.ts:1521–1542`.

### 4b — Verhalten

* **`beimVerlassen: 'stopp'`** (Album verlassen = Schluss, die Ur-MuPiBox):
  `darstellung.service.ts:194–204`, wirksam `player.page.ts:321–328`
  (setzt playerMode='album'). Im Thema gespeichert, nicht abgeleitet.
* **`startseite`** (Startkategorie audiobook|music|other):
  `darstellung.service.ts:301–302`, `:994–996`, gelesen `home.page.ts:93`.
* **`kategorien: 'einer'`** (EIN durchschaltender Knopf — für Kinder, die
  nicht lesen): `home.page.html:23–32`, `home.page.ts:330–334`.

### 4c — Anzeigen und Feinheiten

* **`btAkkuArt`** ('prozent'|'balken'|'aus', rot <20 %, nur wenn das
  BT-Gerät den Stand meldet): `darstellung.service.ts:243–250`,
  `netzstatus.component.ts:148–156` (Datenquelle), `:238–280` (gezeichneter
  Akku). Der NewDesign-Akku ist der HAT-Akku der Box — das hier ist der des
  KOPFHÖRERS.
* **`statusLaenge`** (Fortschrittszeile kürzer als die Leiste, mittig):
  `darstellung.service.ts:284–290`, CSS-Var `:872`.
* **Zwei Lautstärkeknöpfe** (leiser/lauter ±5 % statt Regler):
  `player.page.html:158–169` (Knopfmatrix), `:231–242` (neben der
  Flip-Liste), Schritte `player.page.ts:1166–1173`.
* **`abstandBez`** (Abstand Bild↔Beschriftung, −12..60 px):
  `darstellung.service.ts:293–294`, `:669–672`, CSS-Var `:874`.

## Entschieden NICHT übernommen (Betreiber, 05.09.2026)

Fundstellen bleiben hier, falls die Entscheidung später kippt:

* **Favoriten-Zweig** (dreifarbiger Stern, 3 Listen, Durchschalten 1→2→3,
  Favoriten-Fenster mit „Alle (n)" und zweistufigem Löschen, eigene
  Start-Reihen): `now-playing-bar.component.ts:105–132`, `:271–286`,
  `:1393–1428`; `favorites-overlay.component.ts:50–129`;
  `home.page.ts:154–183`; `startseite.ts:233–256`; `global.scss:601–613`.
  Der Profil-Speicherschlüssel ist im NewDesign vorbereitet
  (`app.js:176–177`, `mupibox_p_<kennung>_favorites_v1`).
* **Dienst-Anzeigen Spotify/Jellyfin** (DREI Zustände: nicht eingerichtet =
  nichts, weg = durchgestrichen, da = Markenfarbe):
  `dienststatus.component.ts:30–95`.
* **Freies Anordnen** (21 Stücke ziehen, Halten = Größe, 7-px-Raster,
  Hilfslinien, `?anordnen=1`): `anfassbar.directive.ts`,
  `fuehrungen.component.ts`, `darstellung.service.ts:33–58`, `:864–910`,
  `:1055–1077`, `now-playing-bar.component.ts:397–435`, `:1559–1718`,
  `anordnen.component.ts`. Im NewDesign AUSDRÜCKLICH abgelehnt
  (`app.js:12397–12401`: „ein Werkzeug für eine Maus und einen großen
  Schirm").
* **`kopfIcons`/`kopfOrdnung`** (Anzeigen in der Leiste vs. frei schwebend,
  freie Reihenfolge): `darstellung.service.ts:251–264`, `:490–492`,
  `:1019–1043`.
* **`mpVariante`** (zehn benannte Mini-Player-Bauformen, u.a. `nurTasten`,
  `integriert` = 3-px-Linie, Streifen oben/innen/über/unter):
  `darstellung.service.ts:128–135`, `:417–428`,
  `now-playing-bar.component.ts:746–843`.
* **`aussehen: 'classic'`** als CSS-Paket (21 Regeln `global.scss:307–585`
  unter `body.look-classic`): Der Classic-LOOK entsteht in E120 NEU aus
  Blöcke-Feldern (rund + Ring + dunkel + groesse 1.8) — die alten
  Ionic-Regeln passen auf kein Element des NewDesign.

## Alt-Farbkanal (fällt mit 1e, Referenz)

`scripts/mupibox/setting_update.sh:12–20` (Symlink-Anlage mit dem
dokumentierten Teilstring-Vergleich), `themes/*.css` (29 Dateien + 10
Asset-Ordner), `www/theme-data/`-Verteilung in `autosetup.sh:570–598,817–818`
und `update/start_mupibox_update.sh:751–790`, Symlink-Rettung
`scripts/box/mupibox-tauscher.py:150–186`, `altFarbthemaLesen()` in
`src/backend-api/src/server.ts` (die Lese-Brücke aus E118/1c — entfernen,
sobald themes/ fällt).
