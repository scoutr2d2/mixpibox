# MuPiBox-Plugins

Ein Plugin bringt der Box eine neue **Medienquelle** bei (Podcast, Mediathek,
eigener Server), lässt sie auf **Ereignisse** reagieren (Licht, MQTT) — oder
hängt etwas in den **Signalweg des Tons** (Stereobasis, Entzerrung).

> **Stand.** **Medienquellen, Ereignisse und Klang sind fertig** und
> durchgehend geprüft — je ein Musterplugin dafür liegt daneben
> ([Podcast](mupibox-podcast/), [WLED](mupibox-wled/),
> [Klang](mixpi-klang/)).
>
> **Das vierte Musterplugin zeigt den Fall mit Zugangsdaten:**
> [`mupibox-subsonic`](mupibox-subsonic/) (Subsonic/Navidrome/Airsonic, seit
> 14.08.2026). Die anderen drei zeigen je eine Hälfte des Vertrags; die meisten
> echten Erweiterungen sprechen aber mit einem Dienst, der Benutzer und Passwort
> will. Zwei Dinge lernt man nur hier: wie ein `geheim`-Feld benutzt wird, ohne
> dass das Passwort je in einer Adresse steht (Subsonic-Weg mit Salz und
> Prüfsumme, `t` + `s`), und wie `suchen()` aussieht — es ist das **einzige**
> Musterplugin, das diese Methode überhaupt benutzt. `node:crypto` darf es
> dafür verwenden: ein Plugin läuft im `worker_thread` mit vollem Node-Umfang
> (weiter unten ausdrücklich: „Absturz- und Verbrauchstrennung, **keine**
> Sicherheitstrennung" — siehe [Was die Box für dich tut](#was-die-box-für-dich-tut)).
> Nachgemessen am 22.08.2026: Prüfstand HÄLT, 18/18 Zeugen grün.
>
> Zum Klang (21.08.2026): entwickelt am Entwicklerrechner (PipeWire 1.6.8),
> **inzwischen auch auf der Box nachgemessen** (Pi 5, MuPiHAT, PipeWire 1.4.2):
> die erzeugte Kette lädt, kostet 8 MB RSS und 0,0 % CPU im Leerlauf, und alle
> benutzten `builtin`-Label sind dort vorhanden. **Noch offen:** der Übergang
> Klangwerk→Entzerrer im Betrieb und die hörbare Wirkung.
>
> (Ein Kanaltest meldete zwischenzeitlich „Chassis mono gebrückt" — das war ein
> Messfehler des Werkzeugs, die Box ist Stereo. Warum der Test nichts taugte:
> llmwiki `kanaltest-mit-rauschen-misst-nichts`.)
>
> **Nicht fertig, ausdrücklich:** [`mixpi-mitschnitt`](mixpi-mitschnitt/) (0.3.0)
> ist eine **Testfunktion** und trägt das fünfte Recht `aufnahme` — siehe
> [Das Recht `aufnahme`](#das-recht-aufnahme). Es ist kein Musterplugin zum
> Nachbauen, sondern der Grund, warum das Recht existiert.
>
> **Zwei Anbieter der Box sind selbst Plugins (E79/E81, 22.08.2026):**
> [`mixpi-ardsounds`](mixpi-ardsounds/) (Regale, Sammlungen, Suche, Folgen —
> **seit 0.2.0 auch Radiosender**) und
> [`mixpi-jellyfin`](mixpi-jellyfin/). Der Kern hält nur noch die alten Routen
> und ruft dahinter `pluginHttp`/`pluginInhalt` — nachzulesen in `server.ts` an
> den Stellen um `/kategorien` und die Jellyfin-Routen. Wer wissen will, wie
> weit der Vertrag trägt, liest diese beiden zuerst: sie sind keine
> Spielbeispiele, sondern das, was die Box wirklich benutzt.
>
> **Radiosender kamen dazu, ohne die Livestream-Sperre zu lockern (E84,
> 22.08.2026):** die ARD hat dafür einen eigenen Einstieg
> (`permanentLivestreams`, 195 Sender), also steht eine zweite Sorte daneben,
> statt dass `folgenAus()` künftig Endlosströme zwischen Hörspielfolgen
> durchlässt. Für Plugin-Autoren steckt darin die eigentliche Lehre: **die
> `type`-Angabe eines Vorschlags entscheidet, was die Oberfläche hinter der
> Kachel erwartet.** Ein Sender trägt deshalb `type: 'radio'` und nicht den
> Dienstnamen `'ard'` — `artVon()` im Kern (`src/backend-api/src/werke.ts`)
> bildet `'ard'` **unbedingt** auf `show` ab, also auf „eine Folge nach der
> anderen", und die gibt es bei einem Sender nie.
>
> **Ein Plugin ohne Server und ohne Abo — und die Sperre dahinter (E84,
> 22.08.2026):** [`mixpi-archive`](mixpi-archive/) (0.1.0) holt gemeinfreie
> Hörspiele und Lesungen aus dem Internet Archive; Suche, Metadaten und
> Dateien liegen offen, es braucht also weder etwas im Haus noch ein Konto.
> Drei Dinge lernt man dort, alle am echten Dienst gemessen: **Dubletten sind
> die Regel** (ein Werk führt dieselbe Spur als VBR, 128k und 64k — das Feld
> `original` zeigt von der Ableitung auf die Quelle und fasst zusammen), die
> **Dauer gehört der Gruppe, nicht der Datei** (`length` fehlt ausgerechnet am
> Original), und **ein Werk ist kein Album** (von 1038 Dateien waren 345
> Bilder und 344 Spektrogramme — Ton ist, was ein MP3-Format trägt).
>
> **Die Sperre, die es aufdeckte, ist am selben Tag gefallen (E87/E88,
> 22.08.2026):** Bis dahin hatte das Plugin **bewusst keinen
> Aufnehmen-Knopf**, weil es **keinen allgemeinen Plugin-Weg in die
> Medienliste** gab — weder Box-Oberfläche noch Kern setzten einen `type`, der
> auf eine Plugin-Kennung zeigt, in einen Ruf an `/api/plugins/spielen` um;
> `dienstVon()` machte daraus `anderes`, `artVon()` ebenso, und ein Knopf hätte
> Kacheln erzeugt, die nicht spielen. **Seit E87 gibt es den generischen Weg**
> (siehe „Ein Medien-Plugin kommt generisch in die Medienliste" weiter unten),
> **seit E88 ist er begehbar**: die Verwaltungsfläche von `mixpi-archive` hat
> Suche und Aufnehmen, der Vorschlag trägt `type: 'plugin'` mit der vollen
> Medienkennung in `id`. Damit ist es **der erste Anbieter, der komplett über
> ein Plugin läuft** — kein Sonderweg im Kern. Wer ein weiteres Medien-Plugin
> baut, braucht diesen Weg nicht noch einmal zu bauen; er prüft ihn mit
> `tools/plugin-kette-probe.mts`.
>
> **Ein Medien-Plugin kommt generisch in die Medienliste (E87, 22.08.2026):**
> Ein Eintrag trägt `type: "plugin"` und in `id` die **volle** Medienkennung
> des Plugins — `{ "type": "plugin", "id": "mixpi-archive:<identifier>" }`.
> Daraus baut `medienSchluessel()` ohne Zutun `plugin:mixpi-archive:<…>`, eine
> stabile Identität für Verlauf, Weiterhören und Favoriten. **Nicht** die
> Plugin-Kennung direkt als `type` setzen: `dienstVon()` ist eine reine
> Funktion ohne Plugin-Register und könnte „mixpi-archive" nicht von einem
> Tippfehler unterscheiden. Vier Stellen tragen den Weg — `dienstVon`/
> `pluginKennungAus()` (`medien.ts`), `artVon` → `show` (`werke.ts`), ein
> dienstblinder Zweig in `/api/werke/<s>/inhalt` (`server.ts`) und
> `plugin-inhalt.ts`/`.service.ts` plus Anbieter in der Box.
> [`mixpi-ardsounds`](mixpi-ardsounds/) liefert weiterhin `type: 'ard'`, und
> das ist **korrekt**: die ARD-Dienste im Kern können mehr als der generische
> Weg (Reihenfolge und Vorspann). Falsch ist nur alles Dritte —
> das wird `anderes`, und die Kachel spielt nicht.
>
> **Die gemerkte Folge war bis E90 der dritte Vorteil und ist es nicht mehr**
> (23.08.2026): sie gilt seither generisch für `type: "plugin"`. Wer diesen
> Satz noch mit drei Punkten liest, liest eine überholte Fassung.
>
> **Zwei Engine-Plugins sind Gesichter, keine Anbieter (E82, 22.08.2026):**
> [`mixpi-librespot`](mixpi-librespot/) und [`mixpi-soloist`](mixpi-soloist/)
> liefern in der Sektion `streaming/spotify` die **Auskunft** über die
> Tonmaschine (Dienststand, Bitrate, Build-Verfall, Anmeldung) — der **Hebel
> bleibt im Kern**: `spotify.engine`, die Umschalt-Prüfung und die Unit-Neustarts
> hängen an Units und Timern, deren Zusicherung „genau eine Maschine läuft" ein
> Worker nur behaupten könnte. **Ein Engine-Plugin abzuschalten nimmt nie den
> Ton, nur die Auskunft** — `GET /api/spotify/maschine` antwortet dann in voller
> Form (den Dienststand erfragt der Kern selbst, die Einzelheiten stehen ehrlich
> auf `null`) und legt einen `hinweis` dazu, statt zu schrumpfen; die Karte
> dereferenziert ohne doppelten Boden. Sie sind das Muster für „Plugin zeigt,
> Kern schaltet".
>
> **Ein Plugin, das nur WEISS — und ausdrücklich nichts entscheidet (20.09.2026):**
> [`mixpi-mediathek`](mixpi-mediathek/) (0.1.0) ist die eine Hälfte der
> Belohnungs-Videos aus der ARD Mediathek: es sucht, und es löst eine Kennung
> zu einer abspielbaren MP4-Adresse auf. Die andere Hälfte — welches Video für
> welches Profil freigegeben ist und wie oft es noch laufen darf — liegt im
> Kern, weil ein Zähler, den die Seite des Kindes führt, kein Zähler ist
> (dieselbe Lehre wie bei der Kinderzeit). **Es ist damit das schmalste
> Plugin des Hauses:** ein Recht (`netz`), drei Methoden (`http`, `befinden`,
> `aktion`), kein `aufloesen()` — das führte nach `spielweg.ts` und damit in
> den Ton-Weg mit `mpv --no-video`, also zu einer Tonspur ohne Bild. Wer ein
> Plugin baut, das dem Kern nur ZULIEFERT, findet hier die Form.
>
> Drei Eigenheiten der ARD stehen dort gemessen und mit Zeugen (llmwiki
> `mediathek-dieselbe-folge-liegt-dreimal-da`): dieselbe Folge liegt
> **dreimal** in der Trefferliste (normal, Audiodeskription, Gebärdensprache),
> die **Hörfassung liegt in derselben Stream-Gruppe** wie die normale Fassung
> und in denselben Auflösungen, und die **größte angebotene Adresse ist HLS** —
> die ein `<video>`-Element in Chromium nicht spielen kann. Gegen den echten
> Dienst misst `node tools/mediathek-probe.mjs`; sie hängt bewusst in keinem
> Läufer, weil sie das Internet braucht.
>
> **Und zwei, die erst die Box gefunden hat** (llmwiki
> `ard-tonspur-markierung-ist-vertauscht`, 20.09.2026 — nachdem alles gegen
> Zeugen und Vorschau grün war): `isGeoBlocked` ist ein **Merkmal, keine
> Sperre** (dieselbe Adresse antwortete aus demselben Wohnzimmer mit
> `200 video/mp4`), und `audios[].kind` kann **vertauscht** sein — bei
> „Kommissar Wisting" trug die Hörfassung `standard` und der internationale
> Ton `audio-description`. Wer eine fremde Schnittstelle gegen EINE
> gespeicherte Antwort prüft, prüft, dass er sie damals richtig gelesen hat;
> deshalb liegt neben der schönen Vorlage jetzt die hässliche
> (`ard-wisting.fixture.json`).
>
> **Und eine zweite Mediathek daneben, die fünf Sender auf einmal mitbringt
> (20.09.2026):** [`mixpi-mediathekview`](mixpi-mediathekview/) (0.1.0) fragt
> den öffentlichen Suchdienst von MediathekView und deckt damit ZDF, KiKA,
> 3sat, arte, funk und die ARD-Anstalten ab. Betreiber: „video feature
> ausbauen kann man noch von weiteren quellen videos beziehen ? zdf, youtube,
> netflix was ist moeglich" — was davon geht und was nicht, steht gemessen im
> Wissenspaket unter `videoquellen-jenseits-der-ard`; `node
> tools/videoquellen-probe.mjs` misst es nach.
>
> **Warum EIN Plugin und nicht fünf:** `api.zdf.de` will einen `apiToken`, der
> aus der Webseite gepflückt werden muss. Eine fremde Schnittstelle statt fünf,
> und die MP4-Adresse steht schon im Suchergebnis. **Der Preis dafür steht im
> Kopf der Datei** und ist für Plugin-Autoren das Lehrreiche: der Dienst
> **durchsucht seine eigene `id` nicht** (gemessen: `fields:["id"]` liefert
> null Treffer), also ist die Kennung dieses Plugins kein fremder Schlüssel,
> sondern **der Suchweg zurück** — base64url von Sender, Sendung und Titel,
> beim Auflösen streng auf allen drei Teilen verglichen. Dazu: **keine
> Vorschaubilder** (das Feld gibt es nicht), **HLS fällt schon in der Suche
> weg** (SRF und ORF liefern nur das, und ein `<video>` in Chromium spielt es
> nicht), und die **Auflösung steht bestenfalls im Dateinamen** (`AVC-720`) —
> wo sie fehlt, gilt die mittlere Stufe, und `?stufe=` macht die Annahme am
> Gerät widerlegbar. Gegen den echten Dienst fährt `node
> tools/mediathekview-probe.mjs` den GANZEN Weg: suchen, die Kennung wieder
> auflösen, HEAD auf die Adresse. Genau das hat einen Fehler gefunden, den 26
> grüne Zeugen nicht sahen (die gewählte Stufe hieß still `undefined`).
>
> **Eine Freigabe kann ein AUSSCHNITT sein (20.09.2026):** Betreiber: „marker
> im video setzen zu koennen um definerte stuecke zumachen eine 25 min maus ist
> ggf zu lange". Die Elternfläche schneidet in einer Vorschau am Abspielkopf,
> und jedes Stück wird eine eigene Belohnung mit eigenem Zähler. **Für
> Plugin-Autoren ändert das nichts** — der Schnitt ist Sache des Kerns, das
> Plugin liefert weiter eine ganze Adresse. **Für alle anderen** steht die
> eigentliche Falle im Wissenspaket unter
> `stueck-schwelle-rechnet-gegen-das-stueck`: „90 % gesehen" gegen die
> Videolänge gerechnet erreicht ein Fünf-Minuten-Stück eines 25-Minuten-Videos
> nie — es liefe unbegrenzt oft, und es fällt niemandem auf.
>
> **Beide Mediatheken stehen im Kern in einer Erlaubnisliste**
> (`VIDEO_PLUGINS` in `server.ts`), und jede Freigabe trägt seither das Feld
> `quelle`. Wer eine dritte baut, trägt sie dort ein — eine Formprüfung
> („sieht aus wie eine Plugin-Kennung") ließe den Kern ein **beliebiges**
> Plugin mit einer beliebigen Zeichenfolge rufen.
>
> `ApiRouteProvider` gibt es **seit E77 eingeschränkt** (`http()`, nur hinter
> dem Tor der Verwaltung), `UiExtension` gibt es nicht — beides mit Begründung
> unten unter [Was noch fehlt](#was-noch-fehlt).

## Ein Plugin in fünf Minuten

```bash
node tools/plugin-geruest.mjs mupibox-meinequelle --name "Meine Quelle"
```

Das legt einen Ordner an, der **sofort läuft und sofort getestet ist** — kein
Skelett mit TODO-Zeilen:

```bash
node --test plugins/mupibox-meinequelle/index.spec.mjs   # 6 Tests, grün
npx tsx tools/plugin-pruefen.mjs plugins/mupibox-meinequelle
```

Ändere dann eine Datei, die schon grün ist, statt eine anzufangen, die noch nie
lief. Der Rest dieser Seite erklärt, was du dabei in der Hand hast.

## Was ein Plugin ist

Ein Ordner mit zwei Dateien. Mehr nicht — kein `npm install`, kein Bauschritt.

```
/home/dietpi/.mupibox/plugins/
└── mupibox-podcast/
    ├── plugin.json
    └── index.mjs
```

**`plugin.json`**

```json
{
  "kennung": "mupibox-podcast",
  "name": "Podcast",
  "fassung": "1.0.0",
  "haupt": "index.mjs",
  "rechte": ["medienquelle", "netz"]
}
```

Die `kennung` ist **zugleich der Namensraum**. Sie wird nicht gewählt, sondern
abgeleitet: dein Plugin bekommt automatisch das Schema `mupibox-podcast:…` und
die Route `/api/plugins/mupibox-podcast/`. Damit können zwei Plugins nicht um
dasselbe Präfix streiten. Der Ordnername muss gleich der Kennung sein.

**`index.mjs`**

```js
export default {
  async aufloesen(rest, kontext) {
    const antwort = await kontext.holen(rest)
    const xml = await antwort.text()
    // … deine Logik …
    return {
      titel: { name: 'Folge 1', kuenstler: 'Meine Sendung' },
      quelle: { art: 'strom', adresse: 'https://example.org/1.mp3' },
    }
  },
}
```

Abspielen lässt es sich dann mit:

```bash
curl -X POST http://mupibox:8200/api/plugins/spielen -H 'content-type: application/json' -d '{"kennung":"mupibox-podcast:https://example.org/feed.xml"}'
```

Vollständiges Beispiel mit Kommentaren: [`mupibox-podcast/index.mjs`](mupibox-podcast/index.mjs).

## Der Vertrag

Alle Methoden sind **freiwillig**. Ein Plugin darf wenig können.

| Methode | Wofür | Braucht |
|---|---|---|
| `aufloesen(rest, kontext)` | Kennung → abspielbare Quelle | `medienquelle` |
| `suchen(begriff, kontext)` | Liste von Titeln | `medienquelle` |
| `inhalt(rest, kontext)` | ein Werk → geordnete Folgenliste, siehe unten (E78) | – |
| `befinden(kontext)` | „Geht es dir gut?" für den Eltern-Bereich | – |
| `ereignis(name, nutzlast, kontext)` | auf Systemereignisse reagieren, siehe unten | `ereignisse` |
| `klangkette(kontext)` | Glieder für den Signalweg, siehe unten | `klang` |
| `aktion(kennung, kontext)` | ein Knopf aus der Verwaltung wurde gedrückt (E77) | Anmeldung unter `aktionen` |
| `http(anfrage, kontext)` | eigene Verwaltungs-Routen unter `/api/plugins/<kennung>/http/…` (E77) | – |
| `songtext(frage, kontext)` | Zeilen mit Zeitmarken zum laufenden Stück, siehe unten (E84/B2) | `songtext` |

### In der Verwaltung erscheinen — Sektion, Icon, Aktionen (E77)

Seit dem 22.08.2026 kann ein Plugin sich **in einer Sektion der Verwaltung
anmelden**, statt nur auf der Plugin-Seite zu wohnen. Drei Manifest-Felder,
alle freiwillig:

```json
{
  "sektion": "streaming/ardsounds",
  "icon": "icon.svg",
  "aktionen": [
    { "kennung": "pruefen", "name": "Erreichbarkeit messen", "hinweis": "…" }
  ]
}
```

* **`sektion`** — wo das Plugin erscheint. Ein geschlossenes Vokabular
  (`SEKTIONEN` in `plugin-vertrag.ts` *ist* die Grenze). Die Richtung ist der
  Punkt: **das Plugin sagt, wohin es gehört** — keine Karte muss dein Plugin
  kennen. Fünf Werte gibt es, und **vier davon sind wirklich ein Ort:**

  | Wert | Wo es erscheint |
  |---|---|
  | `streaming/spotify` | Streaming-Seite, Karte Spotify |
  | `streaming/jellyfin` | Streaming-Seite, Karte Jellyfin |
  | `streaming/ardsounds` | Streaming-Seite, Karte ARD Audiothek |
  | `medien` | Medien-Seite, Abschnitt „Erweiterungen" (über dem Archiv-Kasten) |
  | `ton` | **nirgends** — nimm `rechte: ["klang"]`, siehe unten |

  > **`medien` ist seit dem 05.09.2026 ein Ort** (Betreiber: „es gibt das
  > plugin internet archive aber es ist nicht nutzbar, wir müssen es zu
  > medien verdrahten"). `seiten/medien.ts` hängt
  > `<mixpi-plugin-abschnitt [sektion]="'medien'">` unter eine eigene
  > Überschrift „Erweiterungen", direkt **über** dem Archiv-Kasten. Damit
  > tragen Icon, Zustand, Befinden, die angemeldeten **Aktionen** und der Weg
  > zu den Einstellungen dort, wo man sie braucht — vorher meldete sich
  > `mixpi-archive/plugin.json` unter `"sektion": "medien"` an und bekam
  > dafür nichts. Meldet sich **niemand** für die Sektion, steht dort ein
  > Satz statt einer leeren Überschrift (`leerHinweis`); auf den
  > Streaming-Karten bleibt die Leiste ohne diesen Eingang unsichtbar wie
  > bisher.
  >
  > **`ton` hängt weiter ins Leere** (gemessen am 23.08.2026, nachgesehen am
  > 05.09.2026). Die Ton-Seite baut ihren Abschnitt „Klangwerk" aus dem
  > **Recht `klang`**, nicht aus der Sektion. Ein Manifest mit
  > `"sektion": "ton"` besteht die Prüfung des Wirts und erscheint trotzdem
  > nirgends — für ein Klang-Plugin ist `rechte: ["klang"]` der Weg, nicht die
  > Sektion.
  >
  > **Die Sektion ersetzt den E87-Weg nicht, sie ergänzt ihn.** Wer Medien
  > liefern will, braucht weiterhin den **E87-Weg** („Ein Medien-Plugin kommt
  > generisch in die Medienliste", weiter oben): eigene `http/…`-Pfade
  > anbieten und Einträge mit `type: "plugin"` und der vollen Medienkennung in
  > `id` vorschlagen. Dieser Weg ist generisch und trägt Verlauf,
  > Weiterhören, Favoriten und die gemerkte Stelle (E90) ohne Kernänderung.
  > `"sektion": "medien"` trägt die **Steuerung** (Schalter, Einstellungen,
  > Aktionen), nicht den Inhalt. Was **nicht** generisch ist, ist nach wie vor
  > die **Suchmaske** in `seiten/medien.ts`: dort stehen `mixpi-ardsounds` und
  > `mixpi-archive` wörtlich in den URLs, und eine dritte Suchfläche braucht
  > heute noch eine Kernänderung.
  >
  > Umgekehrt fehlt `streaming/deezer`: die Streaming-Seite baut ihre Anker aus
  > den vier Anbieter-Ids (`spotify`, `jellyfin`, `ardsounds`, `deezer`), im
  > Vokabular stehen nur drei. Der Wirt lehnt ein Deezer-Plugin also ab, obwohl
  > die Karte dafür dasteht — und `plugin-vertrag.spec.ts` nagelt genau diese
  > Ablehnung als Beispiel für einen ungültigen Wert fest. Wer `deezer`
  > aufnimmt, nimmt dem Test sein Gegenbeispiel weg; das ist eine Entscheidung,
  > kein Versehen. Beide Richtungen bewacht `tools/sektionen-deckung.py`.
  >
  > **Diese drei Absätze sind die Ausnahmeliste der Wache** (seit 25.08.2026).
  > `tools/sektionen-deckung.py` kennt keine eigene Liste; es liest **`**nirgends**`
  > in der Tabelle darüber** und **den Satz „Umgekehrt fehlt `…`"** und nimmt
  > genau diese Abweichungen hin. Das hat zwei Folgen für den, der hier
  > herumschreibt: Wer die Tabellenzeile oder den Satz löscht, macht die Wache
  > wieder rot — die Abweichung muss erklärt bleiben, **wo ein Plugin-Bauer sie
  > findet**, nicht in einem Python-Skript. Und wer umgekehrt `ton` wirklich
  > einhängt oder `deezer` ins Vokabular aufnimmt, **muss hier nachziehen**:
  > die Wache prüft die Ausnahme in der Gegenrichtung mit und meldet
  > `DOKU VERALTET`, sobald der Grund weg ist. (Davor war sie seit ihrem
  > ersten Tag dauerrot — und eine dauerrote Wache ist keine.)
* **`icon`** — eine Datei **in deinem Ordner** (`.svg` oder `.png`), die die
  Verwaltung unter `/api/plugins/<kennung>/icon` ausliefert. Kein Katalog im
  Kern; das Bild reist mit dem Plugin.

  > **Dein SVG muss seine Farbe selbst mitbringen — `currentColor` allein
  > reicht nicht.** Die Steckleiste lädt das Zeichen über
  > `<img src="/api/plugins/<kennung>/icon">`, und ein SVG im `img`-Element ist
  > ein **eigenes Dokument**: es sieht die `color` der Verwaltung nicht, und
  > `currentColor` fällt auf den Anfangswert **Schwarz** zurück. Auf dem
  > Untergrund der Verwaltung (`#121212`) ist das Zeichen dann unsichtbar —
  > gemessen am 05.09.2026 an allen fünf mitgelieferten Zeichen: Kontrast
  > 1,12:1. Die Datei war da, die Route gab 200, das Bild war geladen. Zu sehen
  > war nichts.
  >
  > Setz deshalb im SVG selbst eine Farbe, dann darf der Rest bei
  > `currentColor` bleiben:
  >
  > ```svg
  > <style> svg { color: #f2f2f7; } </style>
  > ```
  >
  > `#f2f2f7` ist die Schriftfarbe der Verwaltung (`--schrift` in
  > `src/frontend-admin/src/styles.css`). Ein **farbiges** Logo darfst du
  > mitbringen, es wird nicht umgefärbt — der Wirt fasst dein Bild nicht an.
  > Gemessen wird beides von `tools/plugin-icon-kontrast.py`: es rendert jedes
  > Zeichen in der Größe, in der es dasteht (24 px), und verlangt gegen den
  > Untergrund mindestens 3:1. Die Wache hängt in `tools/doku-luecken-probe.sh`.
* **`aktionen`** — Knöpfe, die die Steckleiste zeigt. Ein Druck ruft
  `aktion(kennung, kontext)`; zurück kommt dieselbe Form wie bei `befinden`
  (`{ ok, text }`), und der Text steht wörtlich in der Verwaltung. Nur
  angemeldete Kennungen kommen an — der Wirt prüft gegen das Manifest.

**`http(anfrage, kontext)`** ist die freie Fläche dahinter: alles unter
`/api/plugins/<kennung>/http/<pfad>` landet bei dir als
`{ methode: 'GET'|'POST', pfad, abfrage, rumpf }`, zurück gibst du
`{ status?, inhalt }`. Nur JSON, Status 200–499, höchstens 256 KB — der Wirt
prüft das, nicht du. Die Routen liegen **hinter dem Tor der Verwaltung**; eine
Fläche für den Kinderschirm ist damit bewusst nicht zu bauen, der einzige Weg
zum Abspielen bleibt `spielweg.ts`.

Wer eine Sektion hat, sollte auch `befinden()` können — die Steckleiste zeigt
den Satz direkt unter dem Namen. Vollständiges Beispiel:
[`mixpi-ardsounds/`](mixpi-ardsounds/).

### Eine Folgenliste liefern — `inhalt()` (E78)

`aufloesen()` beantwortet „was spiele ich JETZT ab?". `inhalt()` beantwortet
die Frage davor: **welche Folgen hat dieses Werk, in welcher Reihenfolge?**
Daraus baut die Oberfläche die Warteschlange.

```js
async inhalt(rest, kontext) {
  const [kennung, wunsch] = String(rest).split('#', 2)   // "<werk>#neueste"
  return {
    titel: 'Die Sendung mit der Maus',
    kuenstler: 'WDR',            // freiwillig — steht unter der Kachel
    folgen: [
      { kennung: 'f-1', name: 'Folge 1', quelle: { art: 'strom', adresse: 'https://…' },
        bild: 'https://…', dauerSek: 1382 },
    ],
    vollstaendig: true,          // false = es gibt mehr, als du geliefert hast
  }
}
```

`rest` ist der Teil hinter deinem Schema-Präfix, genau wie bei `aufloesen()`.
Der Pilot legt den Reihenfolge-Wunsch mit `#` dahinter (`neueste` /
`aelteste`); das ist **deine** Vereinbarung, der Wirt sieht nur eine
Zeichenkette.

**Was der Wirt damit macht — und warum du dich darauf verlassen kannst:**

* **Jede Folge geht durch dieselbe Quellen-Prüfung wie ein einzelner Fund**
  (`fundPruefen`, wiederverwendet statt nachgebaut) — inklusive des
  Pfad-Gefängnisses für `art: 'datei'`. Eine Liste ist kein Freibrief: die
  40. Folge mit `file:///etc/shadow` wäre dieselbe Lücke wie beim einzelnen
  Fund, nur besser versteckt.
* **Kaputte Folgen fallen heraus, die Liste bleibt.** Eine Sendung mit 59
  guten und einer krummen Folge ist eine Sendung mit 59 Folgen, kein Fehler.
  Der Mangel geht ins Journal, nicht ins Nichts. Dasselbe gilt für doppelte
  `kennung` — die zweite fällt heraus.
* **Der Deckel liegt bei 500 Folgen** (`FOLGEN_DECKEL` in
  `plugin-vertrag.ts`). Darüber wird die ganze Antwort abgewiesen: das ist
  eine Warteschlange, kein Katalog.
* **Eine leere Liste ist ein Ergebnis, kein Fehler** — eine Sendung kann
  gerade ohne abrufbare Folge dastehen (alles abgelaufen). Was fehlende
  Folgen bedeuten, entscheidet der Aufrufer. Wirf nur, wenn du die Frage
  wirklich nicht beantworten konntest.
* **Fehlt die Methode, ist das ein Wurf mit Klartext** („kann keine
  Folgenlisten liefern"), nicht eine leere Liste. Die beiden Fälle dürfen
  nicht gleich aussehen.

**Ohne Rückfall auf einen Kern-Weg.** Seit E78 holt der ARD-Zweig des Servers
seine Folgenlisten über `pluginInhalt()` — der frühere Kern-Weg wurde
*entfernt*, nicht danebengestellt. Der Grund steht bei
`/api/werke/:schluessel/inhalt` in `server.ts`: die Liste, aus der die Oberfläche die
Warteschlange baut, und die Liste, gegen die später eine
Warteschlangennummer aufgelöst wird, müssen Zeichen für Zeichen dieselbe
sein. Zwei Wege wären genau an dem Tag auseinandergelaufen, an dem eine der
Ordnungsregeln sich ändert — und die gemerkte Stelle hätte still auf die
falsche Folge gezeigt. Fehlt das Plugin, ist das ein 502 mit Klartext.

Was der Kern behält, ist Infrastruktur: der Eintrag mit dem
Reihenfolge-Wunsch, der Weiterhören-Speicher, der Vorspann und der
Befehlsbau. Netz, Folgen-Regeln und Ordnung wohnen im Plugin.

### Die Klangkette

`klangkette()` ist die einzige Methode, die nicht *tut*, sondern **beschreibt**:
sie liefert eine Liste von Gliedern, aus denen der Kern die PipeWire-Filterkette
baut. Gefragt wird **beim Start und nach jeder Einstellungsänderung genau
einmal** — nicht je Puffer. Gerechnet wird danach in PipeWire, nicht in deinem
Plugin.

Erlaubt ist **nur ein geschlossenes Vokabular** (`basis`, `hochpass`,
`tiefpass`, `kuhschwanz`, `glocke`, `vorpegel`, `kompressor`, `begrenzer` — die
Liste in `src/backend-api/src/klangkette.ts` *ist* die Grenze). Ausdrücklich
**kein freier `filter.graph`-Text**: dessen Bausteine `convolver` und `ladspa`
laden eine Datei bzw. eine fremde `.so` nach, ein Plugin schriebe sich damit am
Kern vorbei Code in den Tonstapel.

**`kompressor` und `begrenzer` sind selbst LADSPA — und das ist kein
Widerspruch.** Der Riegel gilt für *Plugins*: ein Fremdplugin beschreibt
weiterhin nur `{ art: 'kompressor', … }` und kann **keinen Pfad angeben**.
Welche `.so` geladen wird, entscheidet allein `klangkette.ts` aus einer
geschlossenen Liste (`swh-plugins`: `sc4`, `fast_lookahead_limiter`). Der
Unterschied ist der zwischen „das Plugin darf eine Datei benennen" und „der
Kern benutzt eine Datei, die er selbst gewählt hat".

Fehlt die `.so` (Box ohne `swh-plugins`), **fällt nur das Glied heraus** — die
übrige Kette bleibt. Eine Kette, die auf eine fehlende Datei zeigt, lädt gar
nicht, und dann wäre die Senke weg, auf die der Ton schon geroutet ist.

Zwei Unterschiede zu den übrigen Gliedern, beide gemessen:
* Sie sind **Stereo-Knoten** (ein Knoten für beide Kanäle, nicht je Kanal
  einer). Zwei getrennte Kompressoren regelten unabhängig — ein lauter Ton
  links zöge nur links den Pegel herunter, und das wandert hörbar.
* Sie laufen **bei Vorgabe nicht mit**. Die Biquads kosten neutral nichts; ein
  Kompressor auf 1:1 lädt trotzdem eine fremde `.so` und rechnet. Der Preis:
  Ein- und Ausschalten ändert die Struktur und kostet einen kurzen Aussetzer
  — am Regler ziehen bleibt live.

Was der Kern nicht kennt, wird nicht gebaut. Ein Plugin mit krummer Kette
**fällt heraus**, die übrigen bleiben — der Grund steht im Journal. Der Grund
für diese Härte ist gemessen: eine Kette mit einem unbekannten Baustein lädt
nicht, PipeWire bricht ab, und die Senke erscheint gar nicht erst. Wäre der Ton
schon dorthin geroutet, stünde ein Kind vor einer stummen Box.

Vollständiges Beispiel: [`mixpi-klang/index.mjs`](mixpi-klang/index.mjs).

### Songtexte liefern — `songtext()` und das Recht `songtext` (E84/B2)

`songtext(frage, kontext)` beantwortet „welcher Text gehört zu dem, was
**gerade** läuft?". Die Frage trägt drei Felder, und alle drei sind Pflicht:

Es gibt **zwei Formen**, und du lieferst genau eine davon:

```js
async songtext({ interpret, titel, dauerSek }, kontext) {
  // SYNCHRON — läuft im Player mit:
  return {
    zeilen: [
      { zeitMs: 12000, text: 'die erste Zeile' },
      { zeitMs: 15500, text: '' },        // eine Pause zwischen den Strophen
    ],
  }
  // UNSYNCHRON — taugt nur zum Lesen im Vollbild:
  // return { absaetze: ['erste Zeile', 'zweite Zeile'] }
}
```

**Die Trennung ist Absicht, kein Umstand.** Eine gemeinsame Form mit
optionalem `zeitMs` hieße, dass jede Stelle, die mitlaufen will, erst nachsehen
muss, ob die Marke da ist — und die eine Stelle, die es vergisst, zeigt bei
Sekunde 0 den ganzen Text auf einmal. Getrennte Felder machen aus „ist das
synchron?" eine Frage, die der Aufrufer nicht stellen *kann*, ohne sie zu
beantworten. Lieferst du beides, gewinnt `zeilen`. Die Antwort der Route trägt
`synchron: true|false` mit.

Der Kern liefert das unter **`GET /api/songtext?interpret=…&titel=…&dauerSek=…`**
aus — einer **Box**-Route, nicht einer Verwaltungsroute. Das ist der Grund,
warum es diesen Anmeldepunkt überhaupt gibt: deine eigenen `http()`-Pfade
liegen hinter dem Tor der Verwaltung und erreichen den Kinderschirm
ausdrücklich nicht, und an den Fund anhängen lässt sich ein Text auch nicht
(`fundPruefen` baut aus sechs Feldern neu auf). Es ist dieselbe Form wie beim
Klangwerk: ein schmaler Anmeldepunkt statt `UiExtension`, und **fremdes JS
kommt nirgends in die Seite**.

**`dauerSek` ist kein schmückendes Beiwerk — es ist das ganze Problem.**
Quellen wie LRCLIB sind nutzerbefüllt und führen dieselbe Nummer vielfach:
Studio, Single-Edit, Live-Mitschnitt, Bearbeitung. Am 05.09.2026 gemessen
(`tools/songtext-quellen-probe.py`, je 20 Treffer):

| Nummer | Fassungen | Spanne |
|---|---|---|
| Queen — Bohemian Rhapsody | 14 Dauern, 263–415 s | **152 s** |
| Radiohead — Creep | 12 Dauern, 236–311 s | 75 s |
| Nena — 99 Luftballons | 10 Dauern, 229–284 s | 55 s |

Alle tragen Zeitmarken, und alle sind für sich richtig. Wer nur nach Interpret
und Titel sucht und den ersten Treffer nimmt, liefert einen Text, der **Wort
für Wort stimmt und um zweieinhalb Minuten versetzt läuft** — der schlimmste
Fehlerfall, weil er wie ein Fehler der Zeitbasis aussieht und der nächste
Sucher dort dann auch sucht. Gleiche deshalb auf die Dauer ab und liefere im
Zweifel **nichts**.

**Eine leere Liste ist die richtige Antwort, kein Fehlschlag.** Für Hörspiele
findet sich nichts (0 von 5 in der Stichprobe), für deutsche Kinderlieder oft
auch nicht (3 von 5); bei Popmusik dagegen 5 von 5. Die Anzeige **bleibt dann
leer**, statt „nicht gefunden" zu melden — ein Kind, das ein Hörspiel hört,
soll keine Fehlermeldung sehen. Wirf nur, wenn du die Frage wirklich nicht
beantworten konntest.

Was der Wirt damit macht:

* **Die Antwort wird neu aufgebaut**, aus genau `zeitMs` und `text` — alles
  andere fällt still heraus, wie bei `fundPruefen`.
* **Kaputte Zeilen fallen heraus, die Liste bleibt** (negative oder krumme
  Zeitmarken, `text`, der kein Text ist). Der Mangel geht ins Journal.
* **Leerer Text MIT Zeitmarke bleibt** — das sind die Pausen, und sie sind der
  Grund, warum die Anzeige zwischendurch leer wird, statt die letzte Zeile
  stehen zu lassen.
* **Sortiert wird im Kern**, nicht bei dir; `zeileJetzt()` sucht binär.
* **Der Deckel liegt bei 600 Zeilen** (`ZEILEN_DECKEL` in `songtext.ts`).
  Darüber wird die ganze Antwort abgewiesen.
* **Mehrere Plugins:** das erste, das etwas liefert, gewinnt. Zusammengeführt
  wird nichts — zwei Quellen haben verschiedene Zeitmarken, und
  ineinandergeschobene Zeilen ergeben Kauderwelsch.

Warum ein **eigenes** Recht und nicht `medienquelle`: die beiden beantworten
verschiedene Fragen. `medienquelle` heißt „ich sage, **was** gespielt wird" —
das Plugin bestimmt den Ton. `songtext` heißt „ich sage etwas **über** das, was
ohnehin läuft"; es bestimmt nichts, es beschriftet. Wer die Plugin-Liste im
Eltern-Bereich liest, soll den Unterschied sehen.

**Das Musterplugin dazu ist [`mixpi-lrclib`](mixpi-lrclib/)** (0.1.0,
05.09.2026) — Rechte `songtext` + `netz`, 26 Zeugen, am echten Dienst
durchgestochen. Zwei Dinge lernt man dort, beide gemessen: es nimmt
**`/api/search` und nicht `/api/get`** (`get` verlangt einen Albumnamen, den
die Box bei lokaler Wiedergabe oft nicht kennt, und riegelt ausgerechnet auf
ihn ab statt auf die Dauer), und **die Zeitmarken-Bedingung ist so wichtig wie
der Dauerabgleich**: bei „Bibi Blocksberg" hat LRCLIB 20 Treffer, aber nur
unsynchronen Text — wer den zulässt, zeigt dem Kind einen fremden Text.

Mit einer echten Frage fahren lässt es sich ohne Box:

```bash
npx tsx tools/plugin-pruefen.mjs plugins/mixpi-lrclib --songtext "Nena|99 Luftballons|233"
```

**Der Dauer-Riegel gilt auch für unsynchronen Text** — dieselbe Abfrage zeigt,
warum (gemessen 05.09.2026): „Bibi Blocksberg — Die neue Schule" mit `95`
liefert 36 unsynchrone Zeilen (das Titellied), mit `2400` (die echte Folge)
liefert sie **nichts**. Ohne den Riegel bekäme die Hörspielfolge den Text des
Titellieds.

**Rechtlich dazugesagt:** Songtexte sind urheberrechtlich geschützt, und
LRCLIB ist nutzerbefüllt. Für die eigene Box ist das normale Nutzung;
Weiterverteilen wäre etwas anderes — insbesondere sollte kein Ausrollweg
Textdateien mitschleppen. LRCLIB verlangt außerdem eine `User-Agent`-Kennung
mit Namen und Verweis.

### Das Recht `aufnahme`

`aufnahme` fällt aus der Reihe, und das gehört hierher statt in den Quelltext:
die anderen fünf Rechte sind **Schlüssel** zu etwas, das der Kern reicht
(Medienquelle, Ereignisse, Netz, Klangkette, Gerätestand). `aufnahme` ist eine
**Ansage**.
Ein Worker darf `node:child_process` ohnehin importieren (siehe den Kopf von
`plugin-laufwerk.ts`) — das Recht hält niemanden auf, der es nicht einträgt. Es
steht in der Liste, damit im **Eltern-Bereich lesbar** ist, dass dieses Plugin
mitschneidet, statt dass man es aus dem Quelltext erfährt.

Es gibt dafür **keine eigene Methode**. Ein Plugin mit `aufnahme` arbeitet über
`ereignis()` und meldet über `befinden()`, dass es gerade läuft. Der einzige
Träger heute ist [`mixpi-mitschnitt`](mixpi-mitschnitt/) — eine **Testfunktion**,
und sie ist an jeder Stelle so gebaut, dass Nichtstun der Normalfall ist:
standardmäßig aus, je Dienst ein eigener Schalter (keine Sperrliste, nur eine
Erlaubnisliste), zwei Haken statt einem (der Dienst **und** die bestätigte
Rechtslage), sichtbar während des Laufs, jederzeit abschaltbar.

Der Grund für diese Härte ist keine Vorsicht, sondern eine Rechnung: es ist das
**Familienkonto**. Eine Sperrung nähme nicht das Archiv, sondern das Abspielen
überhaupt — für alle, jeden Abend. Das gilt auch dann, wenn der Zweck nur
„Puffer" heißt.

Abgegriffen wird **nicht** am Monitor der Senke, sondern am Quellknoten
(`alsa_playback.librespot`) selbst: der Monitor hört alles mit, auch die
Piper-Ansagen („Noch fünf Minuten"). Am Gerät gemessen (16.08.2026,
`tools/box/mitschnitt-machbar.py`): ein Fremdton steckt im Monitor-Mitschnitt
mit dem 2178-fachen der Kontrollfrequenz, im Quell-Mitschnitt mit dem
2,8-fachen — also gar nicht. Wie man eine einzelne Tonquelle überhaupt trifft:
llmwiki `pipewire-abgriff-je-quelle`.

**NACHTRAG 23.08.2026 — der Satz „`--target` lügt" ist überholt und war teuer.**
Er hat gesagt, was NICHT hilft, und daraus wurde im Code, `--target` sei
entbehrlich. Ohne `--target` sucht `pw-record` sich die Standardquelle selbst,
und das ist der **Lautsprecher-Monitor**: vier Mitschnitte vom 22.08. enthalten
digitale Null über die volle Laufzeit, zwei weitere sind zur Hälfte still, und
sie standen als `fertig` in der Mediathek. Was heute gilt (am Gerät vorgeführt,
drei Läufe nebeneinander):

| Aufruf | woran der Abgriff hängt |
|---|---|
| `--target <object.serial>` | `mixpi-mitschnitt:monitor_FL` — richtig |
| ohne `--target` | `alsa_output…fallback:monitor_FL` — der Lautsprecher |

Also: **`pw-link` für die Verkabelung UND `--target <object.serial>` für den
Rückfall**, und die Seriennummer, nicht die Id — `pw-record` nimmt laut eigener
Hilfe „node target serial or name"; dass beide in der Messung übereinstimmten
(33 = 33), war Zufall. Dazu die Gegenprobe am Graphen und die Pegelprüfung
(`annahmeUrteil`, `index.mjs:379`), die es im passiven Weg längst gab. Die alte
Wache prüfte nur `gross < 10 000 B` — **eine Größenprüfung misst die
Komprimierbarkeit, nicht den Ton**: digitale Stille wiegt 177 B/s, die Grenze
fällt damit bei 56,5 Sekunden. llmwiki `mitschnitt-nahm-den-lautsprecher-auf`.

**Noch offen:** die PipeWire-Vorlage `config/templates/62-mixpi-mitschnitt.conf`
liegt im Repo, steht aber in **keinem** der beiden Ausrollwege — auf einer frisch
bespielten Karte fehlt sie. Ihre Schwester `61-entzerrer.conf` steht in **beiden**
(`autosetup.sh:938`, `update/start_mupibox_update.sh:1259`); das ist der
Unterschied, den `tools/ausrollwege-vergleich.py` misst.

**Die Kachel entsteht nach dem ersten Stück, nicht am Ende.** `index.mjs:961`
schreibt `playlistSchreiben()` **und** `kachelAnlegen()` nach *jedem einzelnen*
gelungenen Stück. Das ist eine Entscheidung für „sofort hörbar" — der Preis
zeigt sich erst am Regal, und er ist am Gerät gemessen (.62, 22.08.2026: 29
Alben, **18 mit Befund**, ausgelöst durch einen Betreiberfund). Drei Symptome,
eine Ursache:

| Was passiert | Was im Regal steht |
|---|---|
| bricht nach Stück 1 ab | Kachel mit einem 16–25-Sekunden-Stück — „spielt nicht" |
| Stück 1 wird verworfen (`pegelMessen`, zu leise) | Album fängt bei `02` an; Kapitel 1 fehlt |
| bricht **vor** dem ersten Stück ab | Dateien ohne Kachel (Waise), kein `cover.jpg` |

Die Daten sind **bei diesen drei Symptomen** nicht kaputt: FLAC-Köpfe gültig,
`playlist.m3u` richtig, `/api/bild/<schluessel>` liefert ein echtes JPEG. Wer
dort sucht, sucht falsch. **Das gilt nicht für den Abgriff-Fehler oben** — die
Dateien vom 22.08. sind formal einwandfrei und enthalten trotzdem digitale Null
oder eine fremde Wiedergabe. Ein gültiger FLAC-Kopf ist kein Beleg für Ton.
**Noch offen:** sechs solcher Dateien liegen weiter in der Mediathek.
`python3 tools/mitschnitt-stummel.py --box <box>` nennt alle Fälle und ändert
nichts — **nicht** laufen lassen, während ein Mitschnitt läuft.

Die Kachel stattdessen „unvollständig" zu beschriften geht heute **nicht**:
`neuerEintrag` (`medien.ts:480`) ist eine strenge Weißliste aus `type`,
`category`, `title`, `artist` und genau sechs weiteren Feldern (`id`,
`playlistid`, `showid`, `audiobookid`, `spotify_url`, `cover`); jedes
Zusatzfeld fällt still heraus. llmwiki `mitschnitt-stummel-kachel-vor-inhalt`.

### Die Ereignisse

| Name | Wann | Nutzlast |
|---|---|---|
| `wiedergabeGestartet` | etwas fängt an zu spielen | `{}` bzw. `{herkunft:'plugin'}` |
| `wiedergabeGestoppt` | angehalten oder pausiert | `{verb:'stop'\|'pause'}` |
| `lautstaerke` | Lautstärke geändert | `{wert}` (0–100) |
| `kinderzeitEnde` | die Kinderzeit hat abgeschaltet | `{grund}` — `aufgebraucht`, `zuSpaet`, `tagGesperrt` |

Ereignisse sind **Mitteilungen, keine Aufträge**: der Kern wartet nicht auf dich
und die Musik hängt nicht an dir. Wirft dein Plugin, landet das im Journal, und
die Box spielt weiter. Umgekehrt heißt das: eine Frist von 8 s gilt trotzdem.

`kinderzeitEnde` ist etwas anderes als `wiedergabeGestoppt` — Schlafenszeit ist
kein normales Anhalten. Das WLED-Beispiel schaltet dort das Licht aus, **auch
wenn** der Schalter „Licht aus beim Anhalten" auf *nein* steht.

`rest` ist alles **nach dem ersten Doppelpunkt** — bei
`mupibox-podcast:https://example.org/feed.xml` also die ganze URL, unversehrt.

**Der Kontext** ist alles, was dein Plugin von der Box bekommt:

| Feld | Vorhanden wenn | |
|---|---|---|
| `kontext.protokoll(text)` | immer | landet im Journal der Box |
| `kontext.einstellungen` | immer | was die Eltern eingestellt haben, eingefroren |
| `kontext.holen(adresse)` | Recht `netz` | wie `fetch`, aber mit Frist |
| `kontext.konfig` | Manifest-Feld `konfig` (E80) | Kern-Konfiguration je angemeldeter Gruppe, eingefroren — siehe unten |
| `kontext.geraet` | Recht `geraetestand` (E82) | benannte, **lesende** Blicke auf Dienste, Programme, Dateien — siehe unten |
| `kontext.datenOrdner` | fast immer | ein Ordner, der **dir allein** gehört — siehe unten |

Was nicht im Manifest steht, gibt es nicht — `kontext.holen` ist ohne das Recht
`netz` schlicht `undefined`. Frag danach, statt an einem Fehler zu zerschellen:

```js
if (!kontext.holen) throw new Error('Dem Plugin fehlt das Recht "netz".')
```

**`kontext.datenOrdner`** ist der eine Ort für deinen Zustand: ein eigener
Ordner je Plugin unter `plugin-daten/<kennung>/` im Konfigurationsordner der
Box. Der Wirt legt ihn **beim Laden** an, nicht beim ersten Schreiben — ein
Plugin, das ihn selbst anlegen müsste, könnte es vergessen, und dann fiele der
Zustand beim ersten Fehler auf, nicht beim Einrichten.

Es ist **keine Befugnis, sondern eine Vereinbarung**: Dateizugriff hast du
ohnehin. Der Sinn ist, dass es einen Ort gibt, den das Sicherungsnetz kennt
(E65). Wer stattdessen irgendwohin schreibt, legt eine Datei an, die beim
nächsten Kartenschaden weg ist.

Ließ er sich nicht anlegen, ist das Feld leer und dein Plugin **läuft
trotzdem** — alles außer Zustand ist mehr als nichts. Dann komm ohne aus und
sag es, statt dir einen Pfad auszudenken:

```js
if (!kontext.datenOrdner) kontext.protokoll('Kein Datenordner — merke mir nichts.')
```

## Einstellungen

Was dein Plugin braucht, meldet das Manifest an — dann baut der Eltern-Bereich
die Eingaben daraus, und du musst keine Oberfläche mitliefern:

```json
"felder": [
  { "schluessel": "adresse", "art": "text", "name": "Adresse des Lichts",
    "hinweis": "IP oder Name, z. B. 192.168.178.42" },
  { "schluessel": "helligkeit", "art": "zahl", "name": "Helligkeit", "vorgabe": 128 },
  { "schluessel": "an", "art": "schalter", "name": "Eingeschaltet", "vorgabe": true },
  { "schluessel": "schluessel", "art": "geheim", "name": "API-Schlüssel" }
]
```

Die Werte stehen dann in `kontext.einstellungen` — mit den Vorgaben, solange
niemand etwas eingetragen hat.

- **`geheim`** wird beim Lesen geleert, nie herausgegeben, und ein leeres Feld
  beim Speichern heißt *„so lassen"* — sonst würde jedes Speichern aus dem
  Eltern-Bereich den Schlüssel wegwischen. Eine `vorgabe` ist bei `geheim`
  nicht erlaubt: sie stünde im Klartext im Manifest.
- **Eine Änderung startet dein Plugin neu.** `kontext.einstellungen` ist
  eingefroren und wird beim Start einmal gebaut — ohne Neustart sähest du die
  neue Adresse nie.

### Kern-Konfiguration einsehen — `konfig` (E80)

Manche Zugänge wohnen **nicht** beim Plugin, sondern in der Kern-Konfiguration
der Box: die Jellyfin-Adresse und ihr Schlüssel etwa werden von der
Streaming-Karte verwaltet, samt dem Anbieter-Schalter daneben. Eigene
`felder` dafür hießen: dieselben Werte an zwei Orten, ein Migrationsskript für
jede Bestandsbox, zwei Verwaltungsflächen für eine Sache.

Stattdessen **meldet das Manifest an**, welche Gruppen es einsehen darf:

```json
"konfig": ["jellyfin"]
```

Der Wirt reicht dann genau diese Gruppen in den Kontext:

```js
const jf = kontext.konfig?.jellyfin ?? {}
```

* **Die Liste ist geschlossen** — `KONFIG_GRUPPEN` in `plugin-vertrag.ts` *ist*
  die Grenze; heute `jellyfin`, `ard` und `maschine`. `spotify` steht **bewusst
  nicht** darin: dort liegen `refreshToken` und `clientSecret`, und abgespielt
  wird Spotify ohnehin vom Kern. Was ein Plugin einsehen darf, ist eine
  Kern-Entscheidung je Gruppe, nicht je Plugin.
* **`maschine` (E82) ist keine Dateigruppe, sondern eine gerechnete** — es gibt
  keinen solchen Schlüssel in `mupiboxconfig.json`. Der Kern baut sie in
  `kernKonfigGruppen` aus dem `spotify`-Block: `{ engine, hatSchluessel }`. Ein
  **Boolean statt des Schlüssels** — die Engine-Plugins müssen wissen, *ob* ein
  Soloist-Schlüssel hinterlegt ist, nie welcher. Weil sie eine Gruppe wie jede
  andere ist, greift der E80-Neustart: wer die Engine umschaltet, startet genau
  die Plugins neu, die `maschine` angemeldet haben. (Wer eine weitere gerechnete
  Gruppe einführt und nur `KONFIG_GRUPPEN` erweitert, ohne sie dort zu bauen,
  bekommt sie lautlos nie — und der Neustart vergliche `null` gegen `null`.)
* **Ohne Anmeldung ist `kontext.konfig` schlicht `undefined`** — dieselbe Regel
  wie bei `kontext.holen`. Und angemeldet ist nicht gleich vorhanden: eine
  Gruppe, zu der die Box nichts konfiguriert hat, fehlt im Objekt. Deshalb
  `?.` und ein Vorgabewert.
* **Eingefroren, wie die Einstellungen** — und eine Änderung an der
  Kern-Konfiguration **startet dein Plugin neu**
  (`kernKonfigAktualisieren` im Wirt). Neu gestartet wird nur, wer die
  geänderte Gruppe auch angemeldet hat; alle anderen merken nichts.

Das Muster ist dasselbe wie bei `stroeme` unter dem Recht `aufnahme`: was das
Plugin braucht, **reist mit dem Kontext**, statt dass das Plugin danach greift.
Vollständiges Beispiel: [`mixpi-jellyfin/`](mixpi-jellyfin/).

### Gerätestand einsehen — Recht `geraetestand` (E82)

Ein Plugin, das über die Box **berichtet** (läuft der Dienst? welche Bitrate?
wie alt ist der Build?), braucht Blicke nach außen. Es bekommt sie mit dem Recht
`geraetestand` als `kontext.geraet` — **lesend, benannt, mit Frist**:

```js
if (!kontext.geraet) throw new Error('Dem Plugin fehlt das Recht "geraetestand".')

const zustand = await kontext.geraet.dienstZustand('librespot.service')  // 'laeuft' | 'steht' | …
const { ok, text } = await kontext.geraet.ausfuehren('soloist-fassung')  // ein NAME, kein Programm
const warnung = await kontext.geraet.lesen('soloist-warnung')            // Text oder null
```

* **Rezepte statt Befehle.** Ein Plugin fragt nach **Namen**
  (`soloist-fassung`), nie nach Programm und Argumenten. Die Zuordnung steht in
  geschlossenen Listen in `plugin-geraet.ts` (`GERAET_DIENSTE`,
  `GERAET_BEFEHLE`, `GERAET_DATEIEN`) — ein Plugin-Update kann sich keine neuen
  Befehle dazuwünschen, und im Prüfstand ist ablesbar, welche Namen ein Plugin
  zieht. **Ehrlich gesagt ist das eine Beschriftung, kein Käfig** (derselbe Satz
  wie am `holen`-Zaun): der Worker darf `node:child_process` ohnehin. Die Liste
  spart den bequemen Irrweg und macht den Vertrag prüfbar.
* **Gedeutete Worte statt Exit-Codes.** `dienstZustand` gibt
  `laeuft` / `steht` / `gescheitert` / `wechselt` / `unbekannt` zurück.
  Der Grund ist eine `systemctl`-Eigenheit, die schon einmal Ärger gemacht hat:
  `is-active` antwortet für eine **ordnungsgemäß stehende** Unit mit Exit ≠ 0
  **und** dem Wort `inactive`. Wer den Exit-Code liest, meldet eine stehende
  Maschine als kaputt. Hier zählt das Wort.
* **2,5 s je Blick, und das ist kein Zufall.** Der ganze Plugin-Ruf hat 8 s
  (`FRIST_MS` im Wirt), und ein Fristriss **terminiert den Worker** samt allen
  offenen Rufen. Vier Blicke nacheinander sprengen das im Hängefall — die alte
  Kern-Route reihte genau so, und der 3-s-Poll der Engine-Karte machte daraus
  ein Neustart-Karussell. Wer mehr als drei Blicke braucht, holt sie **parallel**
  (`Promise.all`) oder legt sie sich weg.
* **Eine fehlende Datei ist eine Auskunft, kein Fehler.** `lesen` gibt dann
  `null` — „keine Warnung hinterlegt" ist ein Ergebnis. Ebenso `ausfuehren`:
  fehlt das Programm, kommt `ok: false` mit Text, kein Wurf.
* **Ohne das Recht ist `kontext.geraet` `undefined`** — dieselbe Regel wie bei
  `kontext.holen` und `kontext.konfig`.

Vollständige Beispiele: [`mixpi-soloist/`](mixpi-soloist/) (Dienst, Build-Verfall
aus der `-V`-Zeile, Anmeldung) und [`mixpi-librespot/`](mixpi-librespot/)
(Dienst, Bitrate **gelesen** statt behauptet). Beide melden zusätzlich
`"konfig": ["maschine"]` an und erfahren so, welche Engine überhaupt gewählt ist.

Der normale Weg dorthin ist der Eltern-Bereich (`/plugins/<kennung>`), der die
`felder` als Eingaben baut. Dieselben Wege direkt:

```bash
curl http://<box>:8200/api/plugins/mupibox-wled/einstellungen
curl -X PUT http://<box>:8200/api/plugins/mupibox-wled/einstellungen \
     -H 'content-type: application/json' -d '{"adresse":"192.168.178.42"}'
```

## Testen — ohne Box

Der Kontext ist nur ein Objekt, also fälscht ihn der **Prüfstand**
([`pruefstand.mjs`](pruefstand.mjs)):

```js
import { antwort, kontext } from '../pruefstand.mjs'

const { k, geholt, protokoll } = kontext({
  antworten: { 'https://example.org/feed.xml': FEED_XML },
})
const fund = await plugin.aufloesen('https://example.org/feed.xml', k)
```

`geholt` sammelt die abgefragten Adressen — damit lässt sich auch prüfen, was
dein Plugin **nicht** getan hat. Eine unbekannte Adresse wirft, statt still
`undefined` zu liefern; und der Loopback-Riegel gilt hier genauso wie auf der
Box, damit du ihn lokal findest.

```bash
node --test plugins/mupibox-podcast/index.spec.mjs
```

Vollständiges Beispiel: [`mupibox-podcast/index.spec.mjs`](mupibox-podcast/index.spec.mjs).

### Der Prüfstand als Werkzeug — ein Verzeichnis, ein Urteil

Für den Rundum-Blick ohne eigene Spec-Datei gibt es das Werkzeug (E77):

```bash
npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/mixpi-ardsounds
npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/x --ohne-netz
npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/x --http kategorien --aufloesen "https://…"
npx tsx tools/mixpi-plugin-pruefstand.mjs plugins/x --inhalt "<werk>#neueste"   # E78
```

Es prüft das Manifest **mit exakt der Funktion, die auch der Wirt ruft**
(`manifestPruefen` wird importiert, nicht nachgebaut), liest das Icon, lädt das
Plugin, ruft `befinden` und jede angemeldete Aktion und meldet Ende 0 oder 1.
`--ohne-netz` ersetzt `holen` durch eine Attrappe, die wirft — damit siehst du,
ob dein Plugin einen Netzausfall in Worte fasst oder stirbt. `--inhalt` nennt
Titel, Folgenzahl, `vollstaendig` und die erste Folge — genug, um eine
verrutschte Reihenfolge zu sehen, ohne die Box anzufassen.

**Bei `geraetestand` ist `kontext.geraet` dort ECHT** (E82) — der Prüfstand läuft
unter `tsx` und zieht `geraetBauen()` direkt aus dem Kern, statt eine Attrappe
zu bauen. Am Entwicklerrechner antworten die Rezepte dann ehrlich statt zu
werfen: kein `soloist`-Binary → `ok: false`, keine Unit → ein Wort
(`inactive`/`unbekannt`), keine Datei → `null`. Genau das ist der Lauf, den du
sehen willst — er zeigt, ob dein Plugin **ohne** Gerät noch einen Satz sagt.
Für Zeugen mit erfundenen Antworten fälschst du `geraet` als schlichtes Objekt
mit den drei Methoden; Muster:
[`mixpi-soloist/index.spec.mjs`](mixpi-soloist/index.spec.mjs) (es merkt sich
nebenbei, **welche** Namen das Plugin gezogen hat).

### Und einmal gegen den echten Kern

Der Prüfstand ist eine **Nachbildung** — schnell, aber sie kann irren. Das
Gegenstück lädt dein Plugin in einem echten `worker_thread`, mit dem echten
Laufwerk, den echten Rechten und der echten Prüfung dessen, was du zurückgibst:

```bash
npx tsx tools/plugin-pruefen.mjs plugins/mupibox-meinequelle
```

Ohne weitere Angabe geht dabei **kein** Netzaufruf hinaus. Wenn du eine echte
Auflösung sehen willst:

```bash
npx tsx tools/plugin-pruefen.mjs plugins/mupibox-meinequelle --aufloesen "https://example.org/feed.xml"
```

Was dieses Werkzeug sagt, sagt der Kern. Es gibt hier keinen zweiten Regelsatz.

## Die Regeln, die die Box durchsetzt

Diese Punkte sind **nicht verhandelbar** — sie sind der Grund, warum es
überhaupt ein Plugin-System und nicht einfach `require()` gibt.

1. **Die Kinderzeit gilt auch für dich.** Dein Plugin bekommt kein `spielen`.
   Es liefert eine Quelle, und ob daraus Ton wird, entscheidet der Kern in
   `spielweg.ts` — dort wird die Kinderzeit gefragt, **vor** und **nach** dem
   Auflösen.
2. **Kein Zugriff auf die eigene Box.** `kontext.holen` verwehrt `127.0.0.0/8`
   und die eigenen LAN-Adressen. Der Weg am Kern vorbei ist zu.
3. **Nur unterhalb der Medienwurzel.** `{art:'datei'}` darf nur auf
   `/home/dietpi/MuPiBox/media/…` zeigen. `..` hilft nicht.
4. **Nur `http`/`https`.** `file:` wird abgewiesen.
5. **8 Sekunden.** Jeder Aufruf hat eine Frist. Wer sie reißt, wird abgebrochen
   und neu gestartet — dreimal, dann bleibt das Plugin aus.
6. **48 MB.** Mehr Speicher gibt es nicht; ein Leck beendet dein Plugin, nicht
   die Box.

## Was die Box für dich tut

Jedes Plugin läuft in einem eigenen `worker_thread`. Gemessen **auf einer
echten Box** (Raspberry Pi 5, 2 GB, arm64 — `tools/plugin-box-probe.mjs`):

- Eine Endlosschleife in deinem Code ist nach **302 ms** abgebrochen. Im
  Hauptprozess wäre sie mit keinem Mittel einzufangen.
- Ein Absturz beendet dein Plugin — die Musik läuft weiter.
- Ein Speicherleck beendet dein Plugin, nicht die Box: *„Worker terminated due
  to reaching memory limit"*.
- Kosten: **11,4 MB je Plugin**. Drei Plugins sind 2,6 % des freien Speichers.

**Ehrlich dazugesagt:** das ist Absturz- und Verbrauchstrennung, **keine
Sicherheitstrennung**. Ein Worker darf `node:fs` und `node:child_process` selbst
importieren. Installiere nur Plugins, deren Quelle du kennst.

## Was noch fehlt

| | Stand |
|---|---|
| **Gemerkte Stelle** | **da (E90, 23.08.2026).** Sie hängt an der **Folgenkennung**, nicht an der Position: ein Plugin-Werk ist eine Liste, die zwischen zwei Blicken anders aussehen darf, und wer die Position merkt, springt nach dem nächsten Zuwachs in ein fremdes Stück. Voraussetzung ist die Kette aus E87 — ein Eintrag `type: "plugin"` in der Medienliste; ad hoc über `/api/plugins/spielen` Gespieltes hat weiterhin keine Stelle, und das bleibt richtig so. **Was der Plugin-Zweig NICHT tut:** die Folgenliste nachholen, wenn sie nach einem Serverneustart fehlt — der Server weiß bei einem fremden Plugin nicht, wie es ordnet, und eine geratene Liste wäre schlimmer als keine Stelle. Bis die Kachel einmal geöffnet war, wird nichts gemerkt. |
| **Verwaltung in der Oberfläche** | **da.** Seit dem 14.08.2026 gibt es `/plugins` (Liste) und `/plugins/<kennung>` (ein Ort je Erweiterung, verlinkbar) mit An/Aus-Schalter und den `felder`-Eingaben aus dem Manifest — `curl` braucht es dafür nicht mehr. Dazu seit E77 die **Steckleiste** in der angemeldeten Sektion, und für Klang-Plugins den Abschnitt „Klangwerk" auf der Ton-Seite (siehe unten). |
| `ApiRouteProvider` (eigene Endpunkte) | **teilweise da (E77).** `http()` gibt dir Routen unter `/api/plugins/<kennung>/http/…` — aber nur GET/POST, nur JSON, 256 KB, und nur hinter dem Tor der Verwaltung. Was fehlt, ist eine **eigene** Fläche, die der Kinderschirm erreicht; die ist aus demselben Grund zu wie `UiExtension`. **Für Inhalte brauchst du sie nicht:** dein Werk kommt über den E87-Weg auf den Kinderschirm (`type: "plugin"` in der Medienliste → `/api/werke/<s>/inhalt`, Zweig `plugin` → `spielweg.ts`), samt Kachel, Folgenliste, Verlauf und gemerkter Stelle. Zu ist nur der Weg, auf dem der Kinderschirm *deinen* Code fragt. |
| `UiExtension` (Widgets in der Oberfläche) | **bewusst gestrichen.** Fremdes JS in der Kiosk-Seite hätte volles DOM und alle `fetch`-Rechte — ein fehlerhaftes Widget könnte dem Kind den Ausschalter nehmen. Kommt später über `iframe` + engen `postMessage`-Vertrag. **In der Verwaltung zeigst du dich ohne JS**: `icon`, der Satz aus `befinden()` und die Knöpfe aus `aktionen` bilden die Steckleiste in deiner `sektion`, `felder` gibt dir Eingaben. **Für Regler braucht es mehr nicht** — siehe die Lehre darunter. |

**Die Lehre aus dem Klangwerk (21.08.2026).** Für den Ton-Anmeldepunkt war ein
Vertrags-Ausbau eingeplant (BACKLOG E36/B, vermerkt im Kopf von
`seiten/ton.ts`). Gebraucht wurde er nicht. Der Denkfehler war die Annahme, ein
Plugin müsse eine **Oberfläche** mitbringen — dafür hätte es `UiExtension`
gebraucht, und das ist aus gutem Grund gestrichen. Es meldet stattdessen seine
Regler als `felder` im Manifest an, und die Ton-Seite baut die Eingaben daraus.
Fremdes JS kommt nirgends in die Seite. Wer den nächsten Anmeldepunkt baut
(Licht? Anzeige?), fange hier an, nicht bei `UiExtension`.

## Auf die Box bringen

```bash
scp -r plugins/mupibox-meinequelle dietpi@<box>:/home/dietpi/.mupibox/plugins/
ssh dietpi@<box> "sudo systemctl restart mupibox-server.service"
curl http://<box>:8200/api/plugins
```

**Das galt bis zum 21.08.2026 und stimmt nicht mehr.** Hier stand, der
Plugin-Ordner sei Nutzerdaten und werde vom Ausrollen nicht angefasst.
`tools/ausliefern.py` führt `plugins` inzwischen als eigenes Ziel und
**tauscht den ganzen Baum**: Was auf der Box liegt und nicht im Repo steht,
verschwindet. Deine Einstellungen bleiben (die stehen in
`plugin-einstellungen.json` neben der Konfiguration, nicht im Plugin-Ordner),
und ein abgeschaltetes Plugin bleibt abgeschaltet.

Wer ein eigenes Plugin nur auf der Box liegen hat, verliert es bei der
nächsten Auslieferung. Es gehört ins Repo.

Und auf einer **frisch aufgesetzten Karte** liegen die Plugins seit dem
21.08.2026 von selbst da. **Das `cp -rn` von damals ist seit dem 22.08.2026
weg** — es klang nach Rücksicht („was da liegt, gehört dem Betreiber"), war
aber eine Falle mit Verfallsdatum: einmal ausgerollt wurde ein Plugin **nie
wieder** aktualisiert, während Server und Vertrag weiterwanderten. Der Fehler
sähe später aus wie ein kaputtes Plugin, nicht wie ein Kopierbefehl (Wiki:
`cp-rn-friert-plugins-auf-dem-erststand-ein`).

Alle Wege rufen jetzt denselben Kopierer, `scripts/mixpi/mixpi-plugins-nachziehen.sh`:

| Ziel fehlt | kopieren (Erstausrollung) |
|---|---|
| `fassung` der Quelle **höher** | ganz ersetzen (`rm` + `cp` — ein Plugin ist ein Stand, kein Schichtkuchen) |
| `fassung` gleich oder älter | nichts tun (Downgrade-Schutz) |
| Ziel ohne `plugin.json` | ersetzen (ein halber Stand ist kein Eigentum, sondern Schutt) |
| Ordner **nur** auf der Box | unangetastet |

Verglichen wird `fassung` aus `plugin.json` numerisch je Stelle (`sort -V`) —
`0.10.0` ist neuer als `0.9.0`, ein Textvergleich sähe das andersherum.
**Ein eigenes Plugin auf der Box überlebt das also**, anders als bei
`tools/ausliefern.py` darüber; nur ist es dort trotzdem nicht aufgehoben.

Es gibt **drei** Wege, und jeder ruft den Kopierer selbst — kopiert ist nicht
aufgerufen:

- `autosetup/autosetup.sh` (frische Karte),
- `update/start_mupibox_update.sh` (Update einer laufenden Box). In beiden
  stand der Aufruf bis zum 22.08.2026 **im PipeWire-Zweig** — eine
  PulseAudio-Box bekam gar keine Erweiterungen. Er steht jetzt hinter dem
  `esac`, unabhängig vom Tonstapel.
- `remote-step-installer/recipes/mupibox-app.yaml`, Schritt `plugins` (seit
  22.08.2026). Vorher rollte das Rezept **gar keine** Plugins aus — kein
  „plugin" im ganzen Rezept, `deploy.zip` ohne `plugins/`. Eine per Rezept
  aufgesetzte Box hatte weder ARD noch Jellyfin noch die Engine-Gesichter,
  bis das erste Update lief. Der Schritt liegt **vor** dem ersten Serverstart:
  der Wirt liest die Plugins beim Start, wer sie danach hinlegt, braucht einen
  Neustart mehr und sieht bis dahin eine leere Steckleiste.

Dass jeder Weg den Aufruf hat, prüft `tools/ausrollweg-deckung.py`; die Regeln
des Kopierers prüft `tools/mixpi-plugins-nachziehen-probe.sh`.

## Für LLMs — die kurze, harte Fassung

Der Rest dieser Seite erklärt das *Warum*. Hier steht das *Was*, ohne Prosa.

### Reihenfolge

```bash
node tools/plugin-geruest.mjs mupibox-<name>        # 1. anlegen (läuft sofort)
node --test plugins/mupibox-<name>/index.spec.mjs   # 2. eigene Tests
npx tsx tools/plugin-pruefen.mjs plugins/mupibox-<name>   # 3. Urteil des echten Kerns
```

Schritt 3 ist maßgeblich. Was der Prüfstand in Schritt 2 sagt, ist eine
**Nachbildung** — sie kann irren. Schritt 3 lädt dein Plugin in einem echten
`worker_thread` mit den echten Riegeln. Ohne `--aufloesen` / `--ereignis` geht
dabei kein Netzaufruf hinaus.

**Fertig bist du, wenn Schritt 3 „Das Plugin ist brauchbar" sagt** — nicht,
wenn deine eigenen Tests grün sind.

### Was dein Plugin abweist (wörtlich, aus `plugin-vertrag.ts`)

Das Manifest wird **nicht gebogen**: im Zweifel wird nicht geladen, und alle
Mängel kommen auf einmal — ein Manifest mit acht Fehlern meldet acht, nicht den
ersten. (Nachgemessen; die Meldungen unten stehen wörtlich so da.)

| Regel | Meldung |
|---|---|
| `kennung`: 3–64 Zeichen, klein, Buchstabe zuerst, dann `a-z 0-9 -` | „ist unbrauchbar: erlaubt sind 3 bis 64 Zeichen, klein, …" |
| Ordnername **muss** gleich `kennung` sein | „Ordner heisst „x", Kennung ist „y" — beide muessen gleich sein." |
| `kennung` doppelt vergeben | „Kennung „x" ist bereits vergeben." (das **zweite** lädt nicht) |
| `fassung` in der Form `1.0.0` | „ist keine Form „1.0.0"." |
| `haupt` innerhalb des Ordners | „muss innerhalb des Plugin-Ordners liegen (kein `..` und kein `/` am Anfang)" |
| `rechte` nur `medienquelle`, `ereignisse`, `netz`, `aufnahme`, `klang`, `geraetestand`, `songtext` | „`rechte` kennt „x" nicht. Erlaubt: medienquelle, ereignisse, netz, aufnahme, klang, geraetestand, songtext." — ein unbekanntes Recht wird **nicht** stillschweigend weggelassen |
| `felder[].schluessel`: Buchstabe zuerst, dann Buchstaben/Ziffern/`_` | „taugt nicht als Schluessel — Buchstabe zuerst, dann Buchstaben, Ziffern, Unterstrich." — **das fängt auch `__proto__`**, weil es mit `_` anfängt |
| `constructor`, `prototype` als Schlüssel | „ist nicht erlaubt — es wuerde den Prototyp veraendern." |
| `felder[].art` nur `text`, `zahl`, `schalter`, `geheim` | „hat die Art „x"" |
| `geheim` mit `vorgabe` | „ist geheim und darf keine `vorgabe` haben." (sie stünde im Klartext im Manifest) |
| `konfig` ist eine Liste, wenn vorhanden | „`konfig` muss eine Liste sein, etwa [„jellyfin"]." |
| `konfig` nur `jellyfin`, `ard`, `maschine` | „`konfig` kennt „x" nicht. Erlaubt: jellyfin, ard, maschine." — wie bei `rechte`: nicht stillschweigend weggelassen |

Und was dein **Rückgabewert** passieren muss (`fundPruefen`, läuft im
Hauptprozess, nicht im Worker):

| Regel | Meldung |
|---|---|
| `titel.name` nicht leer | „`titel.name` fehlt — ohne Namen steht auf dem Schirm nichts." |
| `quelle.art` ist `strom` oder `datei` | „muss „strom" oder „datei" sein" |
| bei `strom`: nur `http`/`https` | „darf nur http/https sein, nicht „file:"." |
| bei `datei`: unterhalb der Medienwurzel, `..` wird aufgelöst | „liegt ausserhalb der Medienwurzel (…)" |

### Invarianten, die du nicht umgehen darfst

1. **Du bekommst kein `spielen`.** Du lieferst eine Quelle; ob daraus Ton wird,
   entscheidet der Kern (`spielweg.ts`), und dort wird die Kinderzeit gefragt —
   vor *und* nach deinem Auflösen.
2. **`kontext.holen` verwehrt `127.0.0.0/8` und die eigenen LAN-Adressen.**
   Nicht umgehen versuchen; der Weg an der Kinderzeit vorbei ist zu.
3. **Ohne das Recht `netz` ist `kontext.holen` `undefined`** — nicht eine
   Funktion, die wirft. Frag danach.
4. **8 s Frist je Ruf.** Wer sie reißt, wird abgebrochen und neu gestartet;
   dreimal, dann bleibt das Plugin aus.
5. **48 MB.** Ein Leck beendet dein Plugin, nicht die Box.
6. **`kontext.einstellungen` ist eingefroren** und wird beim Start einmal
   gebaut. Eine Änderung startet dein Plugin neu — verlass dich nicht darauf,
   sie zur Laufzeit zu sehen.

### Wo du nachliest, wenn etwas nicht passt

| Frage | Datei |
|---|---|
| Was prüft das Manifest genau? | `src/backend-api/src/plugin-vertrag.ts` (reine Logik, mit Tests daneben) |
| Was bekommt mein Plugin im Kontext? | `src/backend-api/src/plugin-laufwerk.ts` |
| Frist, Speicher, Neustart, Abschalten | `src/backend-api/src/plugin-wirt.ts` |
| Warum wird nicht gespielt? | `src/backend-api/src/spielweg.ts` |
| Warum ist das so gebaut? | Wissenspaket `llmwiki`, Eintrag `plugin-system` |

### Was NICHT geht

`UiExtension` (Widgets) gibt es nicht — **wohl aber eine Fläche ohne eigenes
JS**: `icon` + `befinden()` + `aktionen` ergeben die Steckleiste in deiner
`sektion`, `felder` die Eingaben daneben. Für alles, was ein Regler oder eine
Statusanzeige braucht, reicht das (siehe „Die Lehre aus dem Klangwerk" oben).
Ereignisse werden ausgelöst, aber es gibt nur die vier oben — keine eigenen.

Eine **gemerkte Stelle** für Plugin-Inhalte gibt es dagegen **seit E90**
(23.08.2026) — sie stand bis dahin an dieser Stelle als „gibt es nicht".
Voraussetzung ist ein Eintrag `type: "plugin"` in der Medienliste (die Kette
aus E87); ad hoc über `/api/plugins/spielen` Gespieltes hat weiterhin keine
Stelle. Die Einzelheiten stehen oben in [Was noch fehlt](#was-noch-fehlt).

Eigene Endpunkte gibt es **seit E77 eingeschränkt**: `http()` unter
`/api/plugins/<kennung>/http/…`, aber nur GET/POST, nur JSON, Status 200–499,
256 KB Deckel, und **hinter dem Tor der Verwaltung**. Eine *eigene* Route, die
der Kinderschirm erreicht, ist damit weiterhin nicht zu bauen — **Inhalte
liefern kannst du trotzdem**: der E87-Weg (`type: "plugin"` in der Medienliste,
`/api/werke/<s>/inhalt` Zweig `plugin`, Abspielen über `spielweg.ts`) trägt
Kachel, Folgenliste, Verlauf, Weiterhören und die gemerkte Stelle bis auf den
Kinderschirm, ohne dass er je deinen Code direkt fragt.

## Werkzeuge

| Befehl | Wofür |
|---|---|
| `node tools/plugin-geruest.mjs <kennung>` | neues Plugin anlegen, lauffähig und getestet |
| `npx tsx tools/plugin-pruefen.mjs <ordner>` | das Urteil des echten Kerns, im echten Worker |
| … `--einstellungen '{"adresse":"…"}'` | mit Werten prüfen statt mit Vorgaben |
| … `--aufloesen "<rest>"` / `--ereignis <name>` | wirklich auflösen bzw. ein Ereignis schicken (geht ins Netz) |
| `node --test plugins/<kennung>/index.spec.mjs` | deine eigenen Tests, ohne Box |
| `bash tools/plugin-geruest-probe.sh` | prüft das Gerüst selbst (für Änderungen daran) |
| `npx tsx tools/plugin-ladeweg-probe.mjs` | misst Ladeweg, Speicher, Abbruch, Kinderzeit |
| `node tools/plugin-box-probe.mjs` | dasselbe **auf** der Box (per scp dorthin) |
| `bash tools/plugin-gegenprobe.sh` | macht jede Schutzvorrichtung kaputt und verlangt einen roten Test |
| `node tools/mixpi-vertrag-doku-abgleich.mjs` | hält den Vertrag gegen **diese Seite** — rot, wenn ein Name hier fehlt |
| `bash tools/mixpi-plugins-nachziehen-probe.sh` | prüft den Kopierer der Ausrollwege (ersetzen, Gleichstand, Downgrade, Fremdes) |
| `python3 tools/ausrollweg-deckung.py` | prüft, dass **jeder** Ausrollweg den Kopierer wirklich aufruft |
