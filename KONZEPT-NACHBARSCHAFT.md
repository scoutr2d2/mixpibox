# Konzept: Nachbarschaft — Boxen, die einander finden und abgleichen

Stand 03.09.2026. **Reines Konzept; nichts gebaut, nichts an der Box angefasst.**
Nachfolger von **E13** („Zwei Boxen, die voneinander wissen", 31.07.2026,
BACKLOG.md:1710), der dort als Idee für später liegt und die offene Frage
stehen ließ: *„Ob die Boxen einander überhaupt kennen sollen (Inventar,
Erkennung per mDNS?) oder ob die Spotify-Geräteliste als einzige Quelle
reicht."*

Dieses Konzept beantwortet sie mit **ja, eigene Erkennung** — aber aus einem
anderen Grund, als E13 vermutete. E13 dachte an Spotify („wer spielt gerade").
Der Betreiber will (03.09.2026) etwas Größeres: **Zugang, Offline-Dateien,
Statistiken, Profile, Playlisten und „zuletzt gespielt"** sollen zwischen den
Boxen abgeglichen werden. Für nichts davon gibt es eine Auskunftsstelle im
Netz — Spotify weiß nicht, wie oft ein Kind seine Gute-Nacht-Geschichte
gehört hat. Also müssen die Boxen selbst miteinander reden.

---

## 0. Die Kurzfassung

| | |
|---|---|
| **Erkennung** | UDP-Rundruf je Schnittstelle, **eigener Port** — NICHT mDNS/5353 (Begründung §2) |
| **Vertrauen** | Kopplung per Zahlencode im Eltern-Bereich, danach HMAC je Anfrage. Ohne Kopplung wird nichts als Kachel-Namen hinaus gegeben |
| **Abgleich** | Sechs Sorten Daten, **sechs verschiedene Zusammenführ-Regeln** — das ist der eigentliche Entwurf (§4) |
| **Netz** | Alles im LAN. Kein Konto, keine Wolke, kein Internet nötig |
| **Bauform** | Zwei reine Module (`nachbarn.ts`, `nachbarabgleich.ts`) + ein unreines (`nachbarfunk.ts`), wie kinderzeit.ts / plugin-vertrag.ts |
| **Reihenfolge** | Sieben Stufen, jede für sich auslieferbar und messbar (§8) |

**Die drei Sätze, an denen dieses Konzept hängt:**

1. **Zähler zusammenzuführen ist die schwierigste Stelle, nicht die
   Erkennung.** Zwei Boxen zu finden, ist eine Nachmittagsarbeit. „Oft
   gehört" nach dem Abgleich richtig anzuzeigen, ohne bei jedem zweiten
   Abgleich zu verdoppeln, ist der Entwurf.
2. **Die Kinderzeit ist der Grund, warum es sich lohnt — und die Stelle,
   an der ein naiver Abgleich Schaden anrichtet.** Zwei Boxen mit je 30
   Minuten Guthaben geben dem Kind heute 60. Das ist ein stiller Fehler,
   den niemand meldet, weil das Kind ihn nicht meldet.
3. **Was nicht gekoppelt ist, bekommt keine Kindernamen.** Die Ansage im
   Netz hört jedes Gerät im Haushalt, auch das des Besuchs.

---

## 1. Was es abzugleichen gibt — und was es schon gibt

Alles Folgende **liegt bereits im Baum**; dieses Konzept erfindet keine
Datenhaltung, es verteilt vorhandene.

| Sorte | Wo heute | Modul |
|---|---|---|
| Profile (Figur, Name, Passwort-Abdruck) | `profile.<kennung>`-Ablagen | `src/backend-api/src/profile.ts` |
| Kinderzeit-Regeln + Verbrauch | Regelwerk je Profil | `src/backend-api/src/kinderzeit.ts` |
| „Zuletzt gespielt" / „Oft gehört" | `gespielt.json` (Zähler + Zeit) | `src/backend-api/src/gespielt.ts` |
| Mitschnitt (Sitzungen, Hörzeit je Dienst) | `verlauf.json` | `src/backend-api/src/verlauf.ts` |
| Weiterhören (Stelle im Werk) | Stellen je Profil | `src/backend-api/src/weiterhoeren.ts` |
| Eigene Listen (gemischte Playlisten) | `ABLAGE_LISTEN`, eigene Ablage | `server.ts`, Block „Eigene Listen der Box" |
| Zugang (Jellyfin, Spotify, WLAN) | `mupiboxconfig.json` | `src/backend-api/src/konfiguration.ts` |
| Offline-Dateien (Mitschnitte, künftig Downloads) | `media/` auf der SD-Karte | E96, E98 |

Zwei Punkte, die dieser Tabelle ihre Schärfe geben:

* **Die Bibliothek bleibt gemeinsam** — das steht schon im Kopf von
  `profile.ts` („Getrennt gehören laut Wiki und BACKLOG E18 genau diese
  drei; die BIBLIOTHEK bleibt gemeinsam"). Abgeglichen wird also, was
  **je Profil** liegt, plus die Listen und die Dateien.
* **`gespielt.json` und `verlauf.json` sind zwei verschiedene Dinge** und
  brauchen zwei verschiedene Regeln: das eine ist ein **Zähler**, das
  andere ein **Protokoll**. Wer beide gleich behandelt, verliert entweder
  Zählerstände oder erfindet Hörzeit.

---

## 2. Erkennung: warum nicht mDNS

Der naheliegende Weg wäre mDNS/Bonjour (`_mixpi._tcp.local`). **Er ist hier
verbaut, zweimal gemessen:**

* **Avahi ist auf der Box nicht installiert.** `remote-step-installer/tests/connect_test.py:7`
  hält fest: *„Name 'mupibox' löste nicht auf (DietPi hat kein avahi)"*. Schlimmer:
  `remote-step-installer/recipes/perf-tune.yaml:38` schaltet `avahi-daemon`
  ausdrücklich **ab** (`consider-avahi`). Eine Erkennung, die Avahi braucht,
  stünde also im Widerspruch zum eigenen Tuning-Rezept.
* **UDP 5353 ist belegt — von librespot.** `config/templates/env-librespot:54`,
  am Gerät gemessen am 11.08.2026: *„25 Sekunden ohne Absturz, UDP 5353 selbst
  belegt (es bringt seine Netzansage mit, avahi wird nicht gebraucht)"*.
  Ein zweiter Melder auf 5353 kollidiert mit dem, was die Box in der
  Spotify-App sichtbar macht. **Das wäre ein Tausch: Nachbarerkennung gegen
  Spotify-Connect-Sichtbarkeit.** Kein guter Tausch.

### Der Weg stattdessen: derselbe, den die Box für Jellyfin schon geht

`server.ts`, Route `GET /api/jellyfin/suchen`, macht genau das Nötige
bereits, ohne jede Abhängigkeit: `node:dgram`, `setBroadcast(true)`, **an
jedes Netz einzeln statt nur an 255.255.255.255** (der limitierte Rundruf
wird nicht geroutet), Entdoppelung nach Adresse, und ein Fehler **beendet**
die Suche, statt sie zu werfen. Diese Bauart wird übernommen — samt der
Kommentare, die begründen, warum sie so ist.

**Festzulegen (und dann zu dokumentieren, siehe §7):**

```
Port      UDP 5387            belegt im Baum: 5353 librespot, 5588 Server,
                              7359 Jellyfin-Suche. 5387 hat im Baum keinen
                              Treffer — am Gerät noch mit `ss -lun` zu messen,
                              bevor die Zahl feststeht.
Takt      alle 30 s + einmal beim Start
Welk      nach 3 ausgefallenen Ansagen (90 s) → „still"
Weg       nach 10 Minuten ohne Ansage → aus der Liste
```

### Was in der Ansage steht — und was ausdrücklich nicht

Die Ansage geht an **jedes Gerät im Haushalt**, auch an das Handy des
Besuchs. Deshalb ist sie karg:

```json
{ "art": "mixpi-nachbar", "fassung": 1,
  "kennung": "…16 Zeichen…", "name": "Kinderzimmer",
  "api": 5588, "bau": "2026.09.03", "gekoppelt": ["…kennung…"] }
```

**Nicht in der Ansage:** Profilnamen, Figuren, Titel, Hörzeiten, IP-Listen,
Zugangsdaten. Der Name ist der, den der Betreiber in der Verwaltung vergibt
(`mupibox.host`, siehe `eigene-namen.ts:31`) — also ein Raum, kein Kind.

### Die Kennung der Box

Braucht: stabil über Neustart, DHCP-Wechsel und Umbenennung; **nicht** die
IP, **nicht** der Rechnername (beide ändern sich, und `MUPI_HOST` ist auf
zwei Boxen bereits verschieden gesetzt, `remote-step-installer/boxen.yaml:43/54`).

```
kennung = sha256("mixpi-nachbarschaft" + /etc/machine-id).hex[0..16]
```

`machine-id` **selbst wird nicht gesendet** — sie ist eine Systemkennung, die
anderswo als Geheimnis gilt. Der Abdruck reicht: er ist stabil und sagt nichts
über die Maschine.

---

## 3. Vertrauen: Kopplung, nicht Vertrauen aufs Netz

**Erkennung ist offen, Abgleich nicht.** Jede Box sieht jede andere in der
Liste — mit Name und Kennung, mehr nicht. Wer Daten will, muss gekoppelt sein.

**Warum die vorhandene Anmeldung dafür nicht reicht:** `auth.ts` hängt
ausdrücklich an `interfacelogin.state`, und der darf aus sein — *„eine
Bestandsbox darf nach einem Update nicht plötzlich nach einem Passwort
fragen, das ihr Besitzer nie gesetzt hat"* (auth.ts, Regel 2). Auf einer Box
mit ausgeschaltetem Schalter wäre der Nachbarkanal damit **offen für jeden
im LAN** — und über ihn liefen Kindernamen. Die Kopplung braucht ein eigenes
Geheimnis, das von diesem Schalter unabhängig ist.

**Der Ablauf** (beide Boxen, Eltern-Bereich):

1. Box A: „Nachbarn" → Box B in der Liste → *koppeln*. A zeigt eine
   sechsstellige Zahl, gültig 5 Minuten, einmal verwendbar.
2. Box B: dieselbe Kachel → Zahl eintippen.
3. Beide leiten aus der Zahl + beiden Kennungen ein gemeinsames Geheimnis
   ab (32 Byte) und legen es ab. Die Zahl ist danach wertlos.
4. Jede Abgleich-Anfrage trägt `HMAC(Geheimnis, Methode+Pfad+Rumpf+Zeit+Nonce)`.

**Vier Riegel, die keine Wahl sind:**

* **Nur aus dem LAN.** Anfragen von außerhalb der eigenen Netze werden
  abgewiesen — die Prüfung dafür steht schon in `eigene-namen.ts` und
  `herkunft.ts` und wird mitbenutzt, nicht nachgebaut.
* **Kopplung ist beidseitig sichtbar.** Im Eltern-Bereich beider Boxen steht,
  mit wem gekoppelt ist und seit wann. Eine Kopplung, die nur eine Seite
  kennt, ist die Sorte Fehler, die man erst bei der Fehlersuche findet.
* **Trennen wirkt lokal immer.** Es sagt der Gegenseite Bescheid, aber es
  wartet nicht auf sie. Eine Box, die man nicht mehr hat, darf die Trennung
  nicht blockieren.
* **Was ein Nachbar schickt, ist Fremdeingabe.** Kennungen wandern in
  Dateinamen (`gespielt.<kennung>.json`, siehe `profile.ts`) — es gilt
  dieselbe `kennungPruefen()`-Schranke wie für die eigene Oberfläche. Ein
  Nachbar, der `../../etc` als Profilkennung schickt, wird abgewiesen, nicht
  gespeichert.

---

## 4. Der Abgleich — sechs Sorten, sechs Regeln

Das Herzstück. Eine einzige Regel für alles wäre entweder verlustbehaftet
oder verdoppelnd; welche, hängt von der Sorte ab.

### 4.1 „Zuletzt gespielt" und „Oft gehört" (`gespielt.json`) — Zähler je Box

**Die Falle:** `gespielt.json` führt je Werk `anzahl` und `zuletzt`
(`gespielt.ts:19 ff.`). Beide naheliegenden Zusammenführungen sind falsch:

* **Maximum nehmen** → Box A hat 7, Box B hat 5 ⇒ 7. Die fünf Male auf B
  sind weg. „Oft gehört" zeigt zu wenig.
* **Summieren** → beim ersten Abgleich 12, richtig. Beim zweiten Abgleich
  24, beim dritten 48. Ein Zähler, der sich beim Nichtstun verdoppelt.

**Die Regel: jede Box zählt nur ihr eigenes, angezeigt wird die Summe.**

```
gespielt[key] = { "boxA": 7, "boxB": 5 }      // Ablage
anzahl        = 7 + 5 = 12                     // Anzeige
zuletzt       = max(zuletztA, zuletztB)
```

Beim Abgleich übernimmt jede Box die **fremden** Felder und lässt ihr eigenes
unangetastet. Das ist gegen Wiederholung immun (derselbe Abgleich zweimal
ändert nichts), verliert nichts, und braucht keine Reihenfolge. Ein Nachbar,
der verschwindet, hinterlässt seinen Stand — richtig so: gehört wurde es.

**Umstieg:** der heutige einzelne `anzahl`-Wert wird beim ersten Start dem
**eigenen** Kürzel zugeschrieben. Kein Datenverlust, kein Migrationsskript.

### 4.2 Mitschnitt (`verlauf.json`) — Protokoll, Vereinigung

Sitzungen werden **nie geändert**, nur angehängt (`verlauf.ts`). Damit ist
die Regel einfach: Schlüssel ist `(Boxkennung, beginn)`, zusammengeführt wird
die Vereinigung. Zweimal dasselbe einzuspielen ändert nichts.

**Die Sitzung braucht dafür ein neues Feld: von welcher Box.** Ohne es sind
zwei Sitzungen, die zufällig zur selben Millisekunde begannen, ununterscheidbar
— und die Hörzeit-Auswertung („welcher Dienst wie lange", der Grund, aus dem
`verlauf.ts` gebaut wurde) zählt eine davon weg. Das Feld ist optional; fehlt
es, gilt „diese Box", damit Bestandsdaten weiterlaufen.

**Ehrlich dazu:** die Hörzeit-Summe über alle Boxen ist danach eine echte
Summe — das Kind hat auf beiden Boxen wirklich gehört. Das ist gewollt und
muss in der Anzeige stehen („über 2 Boxen"), sonst wirkt sie wie ein Fehler.

### 4.3 Weiterhören — Stelle im Werk, und die Uhr, der man nicht trauen darf

Je `(Profil, Werk)` gibt es **eine** Stelle. Hier gilt der neuere Stand — aber
**„neuer" darf nicht allein an der Uhr hängen.** Der Baum weiß bereits, warum:
`verlauf.ts` hat einen eigenen Zweig samt Test für die **zurückspringende
Uhr** („NTP nach dem Start!"). Eine Box, die zwei Stunden vorgeht, gewänne
sonst jeden Vergleich und schickte das Kind dauerhaft an die falsche Stelle.

**Die Regel:** jede Box führt je Profil einen **Fortschrittszähler**, der bei
jeder Änderung um eins steigt und beim Abgleich auf das Maximum beider
gezogen wird. Verglichen wird `(Zähler, dann Zeit, dann Boxkennung)` — die
Kennung nur als Stichentscheid, damit beide Boxen dasselbe Ergebnis
bekommen.

**Und eine Sonderregel, die Ärger spart:** eine Stelle wandert **nicht
zurück**, solange der Zähler nicht eindeutig neuer ist. Ein Kind, das auf
Box B weitergehört hat, darf durch einen Abgleich nicht auf den älteren Stand
von Box A zurückgeworfen werden. Fertig-Markierungen (`FERTIG_ANTEIL`,
`weiterhoeren.ts:270`) gewinnen immer: einmal durchgehört bleibt durchgehört.

### 4.4 Profile und Kinderzeit — die Stelle mit dem echten Schaden

**Profile** (Figur, Name, Passwort-Abdruck, `profile.ts`): je Profil ein
Fortschrittszähler wie oben, Zusammenführung feldweise. Schlüssel ist die
`kennung`. Der bcrypt-Abdruck wandert mit — sonst müsste das Kind auf jeder
Box ein eigenes Passwort haben, und der Sinn eines Profils ist, dass es
dasselbe Kind ist. Ein Profil, das auf einer Box gelöscht wurde, bekommt
einen **Grabstein** (30 Tage), sonst holt der nächste Abgleich es zurück.

**Kinderzeit-Regeln** (`kinderzeit.ts`): genauso, feldweise, neuerer Zähler
gewinnt.

**Kinderzeit-VERBRAUCH: hier steckt der Grund für das ganze Vorhaben.**

Heute zählt jede Box für sich. Zwei Boxen mit je „30 Minuten am Tag" geben
dem Kind **60 Minuten** — und niemand merkt es, weil beide Boxen für sich
korrekt rechnen. Das ist kein Schönheitsfehler, das ist die Regel des
Betreibers, die still nicht gilt.

**Die Regel: derselbe Zähler-je-Box wie bei 4.1.** Jede Box führt ihre
eigenen verbrauchten Minuten des Tages; das Guthaben rechnet gegen die
**Summe aller bekannten Boxen**. Wiederholte Abgleiche ändern nichts.

**Zwei Dinge, die dazu ehrlich dastehen müssen:**

* **Es gibt ein Zeitfenster.** Zwischen zwei Abgleichen weiß Box A nicht, was
  B gerade verbraucht. Der Fehler ist nach oben begrenzt durch
  *Abgleichtakt × Anzahl Boxen*. Bei 60 s Takt und zwei Boxen sind das im
  schlechtesten Fall zwei Minuten zu viel am Tag. Für ein Zeitkonto ist das
  in Ordnung; **behauptet werden darf es nicht als exakt.** Während gespielt
  wird, geht der Takt auf 60 s herunter — dann ist es billig und wichtig.
* **Ein Nachbar, der aus ist, darf nicht sperren.** Die Box rechnet mit dem
  letzten bekannten Stand des Nachbarn und **spielt weiter**. Die strenge
  Auslegung („der andere könnte alles verbraucht haben, also blockieren")
  führt genau zu dem Gerät, das `profile.ts` ausschließt: *„Eine Box, die
  erst nach einer Anmeldung Musik macht, ist morgens um sieben das falsche
  Gerät."* Dasselbe gilt für eine Box, die schweigt, weil das Geschwisterkind
  seine Box nicht eingeschaltet hat. **Großzügig, und der Eltern-Bereich sagt
  wann.**

### 4.5 Eigene Listen — je Titel, nicht je Liste

Die gemischten Listen (`server.ts`, `interface BoxListe`) sind
`{ id, name, category, titel[] }`.

**Warum nicht „neuere Liste gewinnt":** Vater legt auf Box A drei Titel hinein,
Kind auf Box B zwei andere. Bei Liste-gewinnt verliert einer von beiden
**alles**. Bei Titel-Zusammenführung haben beide hinterher fünf.

**Die Regel:** Kopf der Liste (`name`, `category`) nach Fortschrittszähler;
**Titel als Menge mit Grabsteinen** — Hinzufügen und Entfernen sind eigene
Vermerke mit Zeitstempel, Entfernen gewinnt gegen ein älteres Hinzufügen.
Grabsteine verfallen nach 30 Tagen. Ohne sie kommt ein gelöschter Titel beim
nächsten Abgleich zurück, und man löscht ihn wieder, und er kommt wieder.

Die Reihenfolge innerhalb der Liste ist **kein** verlässlicher Abgleichwert
und wird nach `(Einfügezeit, Titelkennung)` stabil sortiert. Eine
handsortierte Reihenfolge über zwei Boxen zu erhalten, wäre ein eigenes
Vorhaben; das gehört ausgesprochen und nicht halb gebaut.

### 4.6 Zugang — was geht, was nicht, und was der Betreiber entscheidet

Der Betreiber hat es selbst eingeschränkt („wenn möglich"). Es zerfällt in
drei Teile, und die Unterschiede sind hart:

| Zugang | Abgleich | Warum |
|---|---|---|
| **Jellyfin** (URL + API-Schlüssel) | **Ja**, auf Knopfdruck | Ein Schlüssel, beliebig viele Geräte. Genau der Fall, für den es sich lohnt: einmal einrichten (`mupi-jellyfin-setup`), beide Boxen haben ihn |
| **ARD / Audiothek** | entfällt | Kein Zugangsdatum vorhanden |
| **WLAN** (SSID + PSK) | **Ja, aber ausdrücklich** | Technisch möglich (E115 hat den Netzwerk-Manager), praktisch nützlich für eine frisch aufgesetzte zweite Box. Ein PSK über das Netz braucht den gekoppelten Kanal und einen eigenen Knopf — **nie** stillschweigend mit |
| **Spotify: `credentials.json`** | **Nein** | Zwei Gründe. (a) E13 hält fest: *„eine Anmeldung, ein gleichzeitiger Strom"* — geteilte Anmeldedaten machen aus zwei Boxen nicht zwei Abspieler. (b) librespot legt die Datei je Gerät selbst an, und beide Boxen tragen bereits verschiedene Gerätenamen (`MUPI_HOST`) — eine kopierte Anmeldung stiftet Verwirrung in der Spotify-App statt Nutzen |
| **Spotify: `clientId`/`refreshToken`** (Web-API, nur Metadaten) | **Entscheidung des Betreibers**, Vorgabe aus | Das ist der Zugang für Titelinfos und Cover, nicht fürs Abspielen — teilbar. Aber es ist ein Geheimnis, und die Vorgabe eines Geheimnisses ist „bleibt hier" |

**Grundregel für alle Zugangsdaten:** nur über den gekoppelten Kanal, nur auf
ausdrücklichen **„übernehmen"**-Druck an der Zielbox, nie als Teil des
periodischen Abgleichs, und im Protokoll steht **dass** etwas übernommen
wurde (nie **was**).

### 4.7 Offline-Dateien — holen, nicht schicken

Die größte Sorte, und die mit der klarsten Abhängigkeit: sie sitzt auf **E96**
(Herunterladen) und **E98** (Sicherungs-Plugins) auf und kommt zuletzt.

* **Verzeichnis statt Vergleich.** Jede Box bietet ein Verzeichnis ihrer
  Ablage an: Pfad, Größe, Prüfsumme, Zeit. Verglichen werden Prüfsummen,
  nicht Zeitstempel.
* **Holen, nicht schicken.** Die Zielbox entscheidet, was sie holt — sie
  allein kennt ihren freien Platz. Die SD-Karte ist *„das Verschleißteil
  dieser Box"* (E98); niemand darf sie von außen vollschreiben.
* **Nur im Leerlauf.** Kein Übertragen, solange gespielt wird. Ein
  Hörbuch, das stockt, weil die Nachbarbox gerade 2 GB zieht, ist ein
  schlechterer Zustand als der ohne Abgleich.
* **Löschen wandert NICHT mit.** Box B hat aufgeräumt (E97 Vorratspflege);
  daraus darf nie folgen, dass Box A ihr Archiv wegwirft. Eine Kopie beim
  Nachbarn ist im Gegenteil ein **Sicherungs-Vermerk** im Sinne von E98 —
  die Vorratspflege darf sie als Löschfreigabe lesen. Damit zahlt dieses
  Vorhaben auf E97/E98 ein, statt mit ihnen zu streiten.

---

## 5. Fassungen — welcher Stand darf mit welchem abgleichen

Betreiberfrage (03.09.2026): *„sollen wir eine Synchronisierung nur mit
gleichem Softwarestand zulassen?"* — präzisiert: gemeint ist die
**MixPiBox-Fassung**, die gerade eingeführt wird. **Nicht** Board-Spezifika.

**Ja, an der MixPiBox-Fassung — aber als ERKLÄRTE UNTERGRENZE, nicht als
Gleichheit.**

### Die Untergrenze steht im Fassungsverzeichnis, nicht im Code

`version.json` kennt das Muster bereits: `mindestens` — *„die älteste Fassung,
von der aus direkt aktualisiert werden darf"*. Der Abgleich bekommt das
Geschwisterfeld:

```
"abgleichAb": "v1.2.0"    // mit dieser und jeder neueren Fassung gleiche ich ab
```

Zwei Boxen gleichen ab, wenn **jede die Grenze der anderen einhält**. Wer eine
brechende Änderung an den abgeglichenen Daten macht, hebt beim Veröffentlichen
diese Zahl — an genau der Stelle, an der er die Änderung macht, und nicht in
einer Verträglichkeitstabelle, die jemand später pflegen müsste.

### Warum nicht Gleichheit

**Der Grund ist das Zeitfenster — und was darin passiert.** Zwei Boxen sind nie
in derselben Minute aktualisiert; der Weg dahin ist von Hand und nacheinander.
Unter der Gleichheitsregel ist der Abgleich in diesem Fenster tot, und das
Fenster ist so lang, wie der Betreiber braucht: Stunden bis Wochen.

Tot heißt hier nicht „unvollständig". Es heißt: **jede Box zählt die Kinderzeit
wieder für sich, das Kind bekommt wieder 60 statt 30 Minuten, und nichts sagt
es an.** Der Preis der Strenge fällt genau auf das, wofür das Ganze gebaut wird.

Dazu: **die meisten Veröffentlichungen fassen die abgeglichenen Daten gar nicht
an.** Ein Fehler in der Klangkette oder ein neues Plugin hat mit `gespielt.json`
nichts zu tun. Gleichheit zahlt den vollen Preis bei jeder Veröffentlichung,
auch bei denen, die den Abgleich nichts angehen.

> **ZURÜCKGENOMMEN (03.09.2026).** Hier stand als dritter Grund, eine
> armhf-Box könne wegen des fehlenden librespot-Binärs (X1) nicht nachziehen
> und wäre dauerhaft abgeschnitten. **Das war eine Verwechslung** — X1 ist eine
> Board-Sache INNERHALB einer Fassung, kein Fassungsstand. Eine armhf-Box
> erreicht jede MixPiBox-Fassung; sie hat darin nur ein stummes librespot. Der
> Einwand fällt weg; die beiden Gründe darüber tragen allein.

### Warum auch nicht „gleiche Hauptnummer"

Naheliegend wäre, MAJOR als Verträglichkeitsgrenze zu lesen. Sie passt nach
beiden Seiten nicht:

* **Zu grob:** ein Bruch im Plugin-Vertrag hebt MAJOR und hat mit dem Abgleich
  nichts zu tun — der Abgleich stürbe für einen Grund, der ihn nicht betrifft.
* **Zu fein:** die Zähler-Umstellung aus §4.1 (eine `anzahl` ⇒ Zähler je Box)
  ist für den Benutzer ein neues Merkmal, also MINOR — für den Abgleich aber
  ein Bruch. Unter der MAJOR-Regel glichen zwei unverträgliche Boxen ab.

Eine erklärte Zahl trifft beide Fälle, weil ein Mensch sie setzt, der weiß, was
er geändert hat.

### Vier Auflagen, sonst ist es Theater

1. **`mindestens` liest heute NIEMAND.** Nachgemessen: das Feld steht in
   `version.json` beschrieben, und in `src/`, `scripts/`, `update/`,
   `autosetup/` liest es kein Zeichen Code. Ein `abgleichAb` mit demselben
   Schicksal wäre ein Feld, das aussieht wie eine Regel und keine ist. Es
   braucht **Umsetzung UND Test mit Gegenprobe**, sonst gilt es nicht.
2. **Kein dritter Fassungsvergleich.** `vergleicheVersionen()` in
   `aktualisierung.ts` ist pur, kennt die Form `v1.1.0` und ist getestet. Genau
   hier hat das Haus schon bezahlt: dieselbe Regel lag in
   `scripts/box/mixpi-zieher.py` und in `aktualisierung.ts`, nur eine wurde
   nachgezogen — Ergebnis war „kein Angebot" bei gefülltem Verzeichnis
   (berichtigt am 31.08.2026). Der Abgleich benutzt die vorhandene Funktion.
3. **Unvergleichbar ist NICHT verträglich.** `vergleicheVersionen()` gibt
   `null`, wenn sich eine Nummer nicht zerlegen lässt, und ihr Kopf sagt
   ausdrücklich: unvergleichbar heißt nicht „neuer". Für den Abgleich heißt es
   **kein Abgleich**, mit Grund in der Nachbarliste. Raten wäre hier die
   schlechteste Wahl.
4. **Das Feld muss ab der ERSTEN veröffentlichten Fassung dastehen.** Eine Box,
   die es nicht kennt, kann es nicht beachten. `version.json` führt heute leere
   Kanäle — *„dieser Fork hat noch nichts veröffentlicht"*. Das ist der
   günstigste Augenblick, den es je geben wird; nachträglich eingeführt, gilt
   es für alle Boxen der ersten Fassung nicht. Fehlt es dennoch, ist die
   Vorgabe **`v1.0.0`** (gleicht mit allem ab) — großzügig, weil die stille
   Alternative der Kinderzeit-Fehler ist.

### Was das für die Sorten heißt — und was VERSCHOBEN wird

Die Untergrenze gilt für den **ganzen** Abgleich: eine Box darunter gleicht gar
nicht ab. Das ist gröber als eine Regel je Datensorte — und für einen Haushalt
mit zwei, drei Boxen ist es **genug**.

Eine Formatnummer je Sorte (dann glichen die verträglichen Sorten weiter ab und
nur die gebrochene fiele aus) ist die feinere Lösung, kostet aber eine Nummer,
eine Prüfung und eine Anzeige **je Sorte**. **Sie wird erst gebaut, wenn eine
Veröffentlichung sie wirklich braucht** — wenn also ein Bruch an EINER Sorte
den Abgleich aller anderen mit auslässt und das weh tut.

Was dagegen **sofort** gelten muss, weil es sich nicht nachrüsten lässt:
**unbekannte Felder werden durchgereicht, nicht weggeworfen.** Box A (neu)
schreibt ein Feld, das B (alt) nicht kennt; B führt zusammen, wirft das
Unbekannte weg und schickt zurück — und A hat es dauerhaft verloren, ohne
Fehlermeldung. Das ist zugleich der Grund, warum **additive Änderungen die
Untergrenze NICHT heben müssen**: solange nichts weggeworfen wird, verträgt
eine ältere Box neue Felder.

### Sichtbar, nicht still

Die Nachbarliste zeigt je Nachbar die Fassung, und wenn nicht abgeglichen wird,
den Grund: *„⟨Box⟩ hat v1.1.0, diese Box gleicht erst ab v1.2.0 ab — ⟨Box⟩
aktualisieren."* Für den einen Fall, in dem Auslassen den Fehler zurückholt,
ein eigener Satz: **„Das Zeitkonto wird derzeit NICHT über beide Boxen
gerechnet."**

---

## 6. Die Bauform

Wie im Haus üblich: **die Regel getrennt vom Draht.** `kinderzeit.ts` und
`plugin-vertrag.ts` sind die Vorbilder — reine Logik, alles kommt herein,
heraus kommt ein Urteil, prüfbar ohne den Tag abzuwarten.

```
src/backend-api/src/
  nachbarn.ts          REIN. Ansage prüfen und auslegen, Zustand (frisch /
                       still / weg), Kopplungscode ableiten, HMAC bilden und
                       prüfen. Keine Uhr, kein Netz — die Zeit kommt herein.
  nachbarabgleich.ts   REIN. Die sechs Regeln aus §4. Zwei Stände herein,
                       ein zusammengeführter heraus. Kein fs, keine Uhr.
  nachbarfunk.ts       UNREIN, und nur hier: dgram, Taktgeber, HTTP zum
                       Nachbarn, Lesen und Schreiben der Ablagen (über
                       atomar.ts, nicht von Hand).
```

**Die Namen grenzen sich ausdrücklich ab** — im Baum gibt es bereits
`abgleich.ts` (welche *Werke* sind dasselbe) und `verschmelzung.ts` (welche
*Quelle* spielt). Beide haben mit Nachbarboxen nichts zu tun.
`nachbarabgleich.ts` trägt das `nachbar-` deshalb im Namen und nicht nur im
Kopfkommentar; die Verwechslungsgefahr ist sonst real, und `abgleich.ts`
begründet in seinem eigenen Kopf, warum solche Trennungen benannt gehören.

**Endpunkte** (alle hinter Kopplung + HMAC, außer der ersten):

```
GET  /api/nachbarn                  wen sehe ich, in welchem Zustand
POST /api/nachbarn/koppeln          Code erzeugen / Code einlösen
DEL  /api/nachbarn/:kennung         trennen
GET  /api/nachbarn/:kennung/stand   was hat der andere (Zähler, Zeiten)
POST /api/nachbar/abgleich          <- die Gegenstelle, die der Nachbar ruft
POST /api/nachbarn/:kennung/zugang  Zugangsdatum übernehmen (ausdrücklich)
```

**Takt:** alle 15 Minuten im Leerlauf; **alle 60 Sekunden, solange gespielt
wird** (wegen der Kinderzeit, §4.4); außerdem sofort nach einer Sitzung, nach
einer Profiländerung und beim Auftauchen eines Nachbarn.
**Geschrieben wird nur bei Änderung** — `verlauf.ts` hält bereits fest, warum:
*„alle zwei Sekunden eine Datei zu ersetzen kostet SD-Karten."*

---

## 7. Auflagen aus dem Haus — was mitgebaut werden MUSS

Kein Beiwerk; jede Zeile hier hat im Baum eine Wache, die sonst rot wird oder,
schlimmer, still grün bleibt.

1. **Der Port muss dokumentiert werden.** `tools/horchende-ports-deckung.py`
   prüft jeden horchenden Port in `src/**.ts` gegen README, BACKLOG, das
   Wissenspaket und `dokumentation/`. Ein neuer UDP-Port ohne Doku macht die
   Wache rot.
2. **Ausrollweg beidseitig.** `tools/ausrollweg-deckung.py` — was nur auf der
   Entwicklungsbox läuft, kommt auf keiner frischen Karte an. Betrifft eine
   etwaige Unit und die Firewall-Freigabe.
3. **Gegenprobe für jede Wache.** Test absichtlich kaputtmachen und rot sehen.
   Besonders hier: die Zusammenführ-Regeln sind alle „grün, wenn nichts
   passiert" — ein Test, der nur prüft, dass nichts kaputtgeht, prüft nichts.
   Jede der sechs Regeln braucht einen Test mit **zwei verschiedenen Ständen**
   und der Frage „und was, wenn ich denselben Abgleich zweimal fahre?".
4. **Handbuch nachziehen.** Die Doku-Wachen verlangen Prosa zu neuen
   Funktionen; „Nachbarboxen koppeln" gehört ins Benutzerhandbuch, nicht nur
   in dieses Konzept.
5. **Wissenspaket nachziehen** (`llmwiki/pack.yaml`), und zwar mindestens die
   zwei Funde, die über dieses Vorhaben hinaus gelten:
   *„UDP 5353 gehört librespot — eigene Erkennung braucht einen eigenen Port"*
   und *„Zähler über zwei Boxen: je Box zählen, Summe anzeigen — Maximum
   verliert, Summe verdoppelt"*.

---

## 8. Reihenfolge — sieben Stufen, jede für sich fertig

Nach dem Hausgrundsatz „kurz bauen und ausliefern; das große Programm erst,
wenn ein Block steht". Jede Stufe ist am Ende **messbar** und kann liegen
bleiben, ohne dass etwas halb ist.

| Stufe | Was | Messbar an | Risiko |
|---|---|---|---|
| **0** | Kennung + Ansage + Liste im Eltern-Bereich. **Kein Abgleich.** | Zwei Boxen sehen einander namentlich | keins — nichts wird geschrieben |
| **1** | Kopplung (Code, Geheimnis, HMAC, trennen) | Kopplung hält über Neustart; ungekoppelt = 403 | keins — noch keine Daten |
| **2** | „Zuletzt gespielt" + Mitschnitt (§4.1, §4.2) | Zähler stimmt nach **zwei** Abgleichen | gering, nur Anzeige |
| **3** | Weiterhören (§4.3) | Stelle springt nicht zurück, auch mit falscher Uhr | mittel — spürbar für das Kind |
| **4** | Profile + Kinderzeit (§4.4) | Guthaben über zwei Boxen; Nachbar aus ⇒ spielt weiter | **hoch — der eigentliche Gewinn** |
| **5** | Eigene Listen (§4.5) | Beidseitig bearbeitet ⇒ beide Änderungen da; Gelöschtes bleibt weg | mittel |
| **6** | Zugang (§4.6) | Jellyfin auf der zweiten Box ohne Abtippen | Geheimnisse — eigene Prüfung |
| **7** | Offline-Dateien (§4.7) | Datei kommt an, Prüfsumme stimmt, kein Stocken beim Hören | groß, **hängt an E96/E98** |

**Stufe 0 und 1 sind zusammen ein Abend** und beantworten die Frage aus E13
endgültig — danach steht fest, ob die Boxen einander sehen, bevor irgendein
Datensatz bewegt wird.

---

## 9. Was dieses Konzept ausdrücklich NICHT vorsieht

* **Kein gemeinsames Abspielen, kein Multiroom.** E13 hat das begründet
  abgeräumt: *„der Ton käme aus dem falschen Zimmer"*. Geteilt wird Wissen,
  nicht die Maschine.
* **Keine Wolke, kein Konto, kein fremder Server.** Alles bleibt im LAN. Eine
  Box ohne Internet gleicht mit der Nachbarbox trotzdem ab.
* **Keine automatische Kopplung.** Zwei Boxen im selben Netz reden nicht
  miteinander, bis jemand eine Zahl eintippt. „Von selbst gefunden und von
  selbst verbunden" ist bei Kinderdaten die falsche Bequemlichkeit.
* **Keine Bibliothek-Zusammenführung** (`data.json`). Das ist E9/E95-Gebiet
  und hat mit Nachbarn nichts zu tun.
* **Kein Abgleich der Konfiguration insgesamt.** Lautstärke, Bildschirm,
  Klangkette gehören dem Gerät und dem Raum, in dem es steht. Der Anlass steht
  schon fest: die zweite Box bekommt einen **FREENOVE 5″ DSI** (800×480, IPS,
  5-Punkt-Touch), die erste läuft an einem **Waveshare 5″ DSI** — dieselbe
  Auflösung (die Oberfläche merkt nichts davon), aber ein anderes Panel mit
  anderem Overlay und anderem DSI-Anschluss. Diese Box misst 800×480 über
  **DSI-2** (`scripts/chromium-autostart.sh:185`), während
  `scripts/flash-mupibox-sd.sh` das Waveshare-Panel auf **DSI1** vorkonfiguriert.
  Würde die Bildschirmkonfiguration mitwandern, machte ein Abgleich die
  Nachbarbox **schwarz** — und der Weg zurück führte über den Kartenleser.
* **Kein Fernzugriff von außen.** Wer seine Boxen aus dem Urlaub abgleichen
  will, redet über ein VPN — nicht über einen Port, den diese Box aufmacht.

---

## 10. Offene Fragen an den Betreiber

1. **Spotify-Web-Zugang (`clientId`/`refreshToken`) mit abgleichen?** Vorgabe
   in diesem Entwurf: nein (§4.6).
2. **Passwort-Abdruck der Kinder mit abgleichen?** Vorgabe: ja — sonst ist es
   auf jeder Box ein anderes Kind. Gegenargument: es ist ein Geheimnis mehr
   auf dem Draht (wenn auch als bcrypt-Abdruck).
3. **Kinderzeit bei unerreichbarem Nachbarn: großzügig oder streng?**
   Vorgabe: großzügig (§4.4) — mit Hinweis im Eltern-Bereich.
4. **Wie viele Boxen sollen es werden?** Der Entwurf skaliert auf eine
   Handvoll (jeder gleicht mit jedem ab). Ab etwa fünf lohnte eine Box als
   Sammelstelle — das wäre ein anderer Entwurf, und er sollte nicht
   vorsorglich gebaut werden.
5. **Soll Stufe 0 sofort gebaut werden?** Sie ist folgenlos und beantwortet
   die Frage aus E13 mit gemessenen Fakten statt mit Vermutung.
