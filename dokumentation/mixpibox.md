# MixPiBox — die Dokumentation

Stand: 2026-08-25. **Dieses Dokument ist eine Karte, kein Lexikon.**

Die teuer erkauften Einzelheiten — welcher Workaround warum nötig war, welche
Messung welche Vermutung widerlegt hat, welche Prüfung sich selbst
zufriedenstellte — stehen im Wissenspaket `llmwiki/pack.yaml` (1117 Einträge,
Fassung 619). Hier steht, **wie die Teile zusammenhängen** und **wo man nachsieht**.
Wo ein Wiki-Eintrag die Antwort hat, wird er beim Namen genannt, statt sie hier
ein zweites Mal zu behaupten. Zwei Wahrheiten über dieselbe Sache sind
schlimmer als eine unvollständige.

> **Wir sind mitten in der Entwicklung.** Was noch im Bau ist, steht in
> [Abschnitt 9](#9-was-gerade-im-bau-ist) — ausdrücklich und mit Namen, damit
> niemand darauf baut.

---

## Inhalt

1. [Was die MixPiBox ist](#1-was-die-mixpibox-ist)
2. [Die vier Repos](#2-die-vier-repos)
3. [Die Box: Hardware und Betriebssystem](#3-die-box-hardware-und-betriebssystem)
4. [Architektur](#4-architektur)
5. [Installation](#5-installation)
6. [Betrieb](#6-betrieb)
7. [Entwicklung](#7-entwicklung)
8. [Fehlersuche](#8-fehlersuche)
9. [Was gerade im Bau ist](#9-was-gerade-im-bau-ist)

---

## 1. Was die MixPiBox ist

Eine Musikbox für Kinder auf einem Raspberry Pi: Touchscreen, Lautsprecher,
keine Tastatur. Ein Kind tippt auf ein Cover, und es spielt — aus Spotify, aus
Jellyfin, aus lokalen Dateien oder aus einem Radiostream.

Sie ist ein **Fork** der [MuPiBox](https://mupibox.de) von splitti und nero. Der
Fork heißt MixPiBox und ist inzwischen weit vom Ursprung entfernt: eigene
Backends in TypeScript, eine zweite Oberfläche, eine neue Verwaltung, ein
eigener Installationsweg.

**Zur Benennung:** In der Oberfläche steht immer der *konfigurierte* Name aus
`mupibox.host`, nie eine Konstante. Der Grund ist ein echter Fehler — in der
Kopfzeile stand fest verdrahtet „MuPiBox", während die Box laut eigener
Konfiguration längst „MixPiBox" hieß, und es fiel niemandem auf, weil die beiden
Stellen nie nebeneinander zu sehen sind. Details und die drei Töpfe
(sichtbar / intern / unantastbar): llmwiki `benennung-mixpibox-drei-toepfe`.

**MixPi** ist das Maskottchen — ein Wesen mit Kopfhörern, in zehn Zuständen
(`hoert`, `spielt`, `schlaeft`, `sucht`, `passwort`, …). Welcher Zustand wo
gilt, steht in `NewDesign/maskottchen.json`, **nicht im Code**: die klassische
und die neue Oberfläche sollen dieselbe Quelle lesen, sonst driften sie
auseinander. Siehe llmwiki `mixpi-maskottchen-familie`.

---

## 2. Die vier Repos

Wer nur im Projektordner sucht, findet drei davon nicht.

| Ort | Repo | Wofür |
|---|---|---|
| `~/Downloads/MuPiBox` | `achim/box` | **alles**: Backends, beide Oberflächen, Skripte, Werkzeuge — und seit dem 10.08.2026 auch Wiki und Installer |
| `~/Downloads/MuPiBox/llmwiki/` | (im Baum) | das Wissenspaket `pack.yaml` — Fallen, Messungen, Entscheidungen |
| `~/Downloads/MuPiBox/remote-step-installer/` | (im Baum) | Boxen aufsetzen per Rezept; konsumiert das Wissenspaket |
| `~/.rsi/` | — | Arbeitsverzeichnis des Installers, u. a. ein Wiki-Zwischenspeicher |

**Die zwei Herkunftsrepos sind stillgelegt.** `~/Downloads/llmwiki_mupibox` und
`~/Downloads/remote-step-installer` liegen noch auf der Platte, werden aber
nicht mehr gepflegt — wer dort arbeitet, legt eine zweite Wahrheit an. Warum,
wie sie hereinkamen und wie man sie notfalls wieder herauslöst, steht in
[`ZUGEZOGEN.md`](../ZUGEZOGEN.md).

**Nicht verwechseln:** `~/.rsi/wiki/llmwiki_mupibox` ist der *Zwischenspeicher*
des Installers. Änderungen gehören in den Baum — `llmwiki/pack.yaml` —, sonst
sind sie beim nächsten Holen weg.

> **Bis zum 24.08.2026 stand hier das Gegenteil:** „Änderungen gehören nach
> `~/Downloads/llmwiki_mupibox`" — also genau in das Repo, das der Absatz
> darüber für stillgelegt erklärt. Es blieb nicht folgenlos: das tote Repo trug
> noch am 22.08.2026 Commits, zwölf Tage nach der Stilllegung. Ausgegangen ist
> es gut: der jüngste Eintrag dort (`kein-plugin-weg-in-die-medienliste`) war
> schon Stunden nach dem Schreiben falsch, und der Baum führt die gültige
> Fassung als `plugin-inhalt-kommt-in-die-medienliste` — hätte jemand
> „nachgezogen", wäre der ältere Irrtum hereingekommen. Der Satz war die letzte
> Anleitung, die dorthin
> zeigte; seit dem 24.08.2026 hält `tools/stillgelegte-orte-pruefen.py` alle
> Handbücher und das Wissenspaket dagegen. Sie liest die toten Orte aus
> `ZUGEZOGEN.md` — wer stilllegt, schreibt es dort hin, und die Wache erbt es.
> Gerügt wird nur, was etwas **anweist**; über die Herkunft zu schreiben bleibt
> richtig. llmwiki `anleitung-zeigt-ins-stillgelegte-repo`.

Das Fernziel `upstream` von `achim/box` ist `splitti/MuPiBox` auf GitHub.

---

## 3. Die Box: Hardware und Betriebssystem

* **Rechner:** Raspberry Pi 5 (die zweite Box: Pi 4). Beide arm64.
* **Betriebssystem:** DietPi auf Debian 13 „Trixie" — seit 2025-08-09 der
  DietPi-Standard. Einzelne Pakete brauchen dort Workarounds (llmwiki
  `mupi-dietpi-trixie`).
* **Anzeige:** DSI-Touchscreen, 800 × 480. Diese Auflösung ist die Vorgabe für
  jedes Bild, das auf der Box entsteht.
* **Ton:** MuPiHAT mit MAX98357A über I2S — **nicht** hifiberry (llmwiki
  `mupi-max98357a-audio`). Dazu wahlweise ein Bluetooth-Lautsprecher.
* **Funk:** *ein* Baustein für WLAN und Bluetooth. Sie teilen sich die Antenne;
  das ist messbar und die Ursache von Tonstottern über Bluetooth
  (llmwiki `bt-audio-stottert-koexistenz`).

---

## 4. Architektur

### 4.1 Die laufenden Dienste

Auf einer eingerichteten Box. **Die Liste ist die, die die Ausrollwege mit
`systemctl enable` scharf schalten** — nicht der Inhalt von `config/services/`.
Dort liegen 42 Dateien, ein Teil davon ist Bestand, den kein Ausrollweg mehr
anfasst (`mupi_vnc`, `mupi_novnc`, `mupi_telegram`). **`mupi_startstop` gehört
nicht mehr in diese Reihe:** `autosetup.sh` schaltet ihn auf einer frischen
Karte weiterhin scharf — in derselben `for service in …`-Schleife wie
`mupi_wifi` —, und
er steht darum unten in der Tabelle. Nachgemessen wird das mit
`tools/dienste-doku-deckung.sh`; die Probe liest die `enable`-Aufrufe aus den
**sieben** Ausrollwegen — **auch die aus Schleifen** (`for d in "${DIENSTE[@]}"`,
`for service in a b c`, `AN="a b c"` mit `for s in $AN`) — und hält sie gegen
dieses Kapitel.

**Ein Ausrollweg muss kein Skript sein** (25.08.2026): fünf Wege lang waren es
fünf `*.sh`. Der Weg, über den die heutigen Boxen gebaut werden, ist aber das
**Rezept** — `remote-step-installer/recipes/mupibox.yaml` und
`mupibox-app.yaml`, eingebetteter Shell-Code je Schritt. Er schaltet an 22
Stellen scharf, und acht Units standen dadurch in keiner Zeile dieses Kapitels;
sie stehen jetzt unten mit dem Vermerk **„nur über das Rezept"**. Zwei Dinge
kamen bei derselben Messung heraus und gelten für jede Wache dieser Bauart:
`systemctl enable --now X` schreibt den Schalter **hinter** `enable` (das
Muster suchte ihn davor und warf acht echte Zeilen weg), und ein `enable` in
einem Kommentar oder hinter einem `echo` ist **kein** Einschalten — so kam
`mupi_fan` in diese Tabelle, und so wäre `pulseaudio` hineingekommen,
ausgerechnet auf dem Weg, der ihn abschaltet.

**Die Anwendung:**

| Unit | Was sie tut | Port |
|---|---|---|
| `mupibox-server` | Backend-API: Medien, Konfiguration, Verwaltung, liefert beide Oberflächen aus | 8200; zusätzlich 8443 (HTTPS), **sobald ein Zertifikat da ist**; **zeitweise 5588** nur auf `127.0.0.1` während einer Spotify-Anmeldung (siehe unten) |
| `mupibox-player` | Abspieldienst: mpv für lokal/Jellyfin, Spotify-Steuerung | 5005 |
| `librespot` | Spotify-Connect-Gerät der Box | — |
| `mixpi-fernbedienung` | greift gekoppelte BLE-Fernbedienungen und Controller **exklusiv** (EVIOCGRAB, `scripts/box/fernbedienung.py`, ausgerollt nach `/opt/mupibox-tools/`) und übersetzt Tasten über die Zuordnung `/etc/mupibox/fernbedienung.json` in Box-Aktionen. Ohne ihn steuert eine Fernbedienung den **Kiosk-Browser** — `Home` öffnete google.com (E134, 06.09.2026). Endet ohne Gerät mit 0 und wartet auf systemd (`Restart=always`): die Fernbedienung schläft ein und kommt wieder, das ist der Normalfall | — |
| `soloist` / `soloist-updater.timer` | der Spotify-Ersatzweg; der Timer sieht **wöchentlich** nach einem neuen Build, weil ein Build nach 90 Tagen verfällt | — |
| `dietpi-dashboard` | Systemübersicht von DietPi, nicht von uns — die Unit setzt keinen Port, er kommt aus der DietPi-Konfiguration | — |

**Der dritte Port, den man nicht sieht: 5588.** Neben 8200 und 8443 macht
`mupibox-server` zeitweise einen **dritten** Horcher auf — und der stand bis
zum 30.08.2026 in keiner Zeile Doku, obwohl es ihn seit dem Bau gibt.

Spotify lässt für den Client dieser Box genau eine Rückleitung zu:
`http://127.0.0.1:5588/login`. Vom Handy aus führt das ins Leere — dort ist
`127.0.0.1` das Handy. **Auf der Box ist es die Box selbst.** Also horcht die
Box während einer Anmeldung kurz selbst auf diesem Port: der Kiosk-Browser
geht zu Spotify, kommt mit dem Code zurück, der Horcher löst ihn ein. Kein
Abtippen, kein zweites Gerät, kein Tunnel.

Drei Eigenschaften, die beim Absichern und beim Debuggen zählen:

* **Nur `127.0.0.1`** — ausdrücklich nicht `0.0.0.0` und nicht `::`. Der
  Horcher nimmt einen Anmeldecode entgegen und tauscht ihn gegen ein Token;
  im Netz hat er nichts zu suchen. Eine Firewall-Regel braucht es dafür nicht.
* **Nur während eines Anlaufs**, höchstens **15 Minuten** (`TONLOGIN_FRIST_MS`).
  Danach ist der Port wieder zu. Wer zwischen zwei Anmeldungen nachsieht,
  findet nichts — das ist kein Fehler.
* **Wer den Port geschlossen vorfindet, obwohl ein Anlauf läuft**, landet in
  einer Sackgasse ohne Adresszeile: der Kiosk hat keinen Zurück-Knopf. Genau
  das passierte bis zum 13.08.2026, weil der Wecker eines alten Anlaufs den
  frischen Horcher eines zweiten mit schloss. Die Rückgabeseite holt den
  Benutzer heute nach 6 Sekunden von selbst auf `http://localhost:8200/`
  zurück.

`tools/horchende-ports-deckung.py` hält das fest: **jeder** Port, auf dem das
Backend horcht, muss in der Doku stehen — die Wache sucht `.listen(` im
Backend, nicht eine bestimmte Zahl in einer bestimmten Datei. Ein neuer
Horcher an einer neuen Stelle fällt genauso auf.

**Die Wachen** — alle als `Type=oneshot` hinter einem Timer, keine Dauerläufer:

| Unit | Takt | Was sie prüft |
|---|---|---|
| `librespot-waechter.timer` | alle 5 min (ab 3 min nach Start) | steht die Box noch in Spotifys Geräteliste? |
| `mupibox-kioskwache.timer` | alle 20 s (ab 130 s) | **kommt die Oberfläche?** Wenn Chromium nicht hochkommt, greift sie ein |
| `mupibox-standwache.timer` | alle 60 s (ab 150 s) | hält eine frische Auslieferung — oder wird zurückgedreht? |
| `mupibox-bt-reconnect.timer` | alle 30 s (ab 25 s) | vertraute Bluetooth-Lautsprecher wieder verbinden |
| `mupibox-sicherung.timer` / `.path` | täglich 04:17 | die Sicherung (siehe 6.5) |
| `mupibox-sicherungsprobe.timer` | sonntags 05:30 | lässt sich die Sicherung auch **zurückspielen**? |
| `soloist-anmeldewache.timer` | alle 2 min (ab 90 s) | **hat Soloist sich überhaupt angemeldet?** Siehe unten |
| `mupi_check_internet` | — | Netzverbindung (`check_network.sh`) |
| `mupi_check_monitor` | — | dunkler Schirm (`get_monitor.sh`) |

**Warum es die Anmeldewache gibt** (E104, 30.08.2026): Soloist versucht die
Spotify-Anmeldung **genau einmal**, beim Start. Fällt die in die unruhige
Boot-Phase — Uhr noch unsynchron, Netz noch beim Sortieren —, kommt
`login failed: make sure --api-key is valid`, und der Prozess **läuft danach
einfach weiter**: kein Exit, also greift `Restart=always` nie, die Unit steht
grün auf `active (running)`, und die Box hat den ganzen Abend kein Spotify.
Der Schlüssel ist dabei gültig; ein Neustart von Hand meldet denselben Dienst
in fünf Sekunden an. Die Wache (`scripts/soloist/soloist-anmeldewache.sh`)
liest das Logbuch **des laufenden Dienststarts** — `journalctl --since` auf
`ActiveEnterTimestamp`, der Fehlversuch von vorgestern zählt also nicht —, und
nur wenn dort `login failed` steht und **kein** `logged in as`, stößt sie genau
einen Neustart an. Sie tut nichts, solange `spotify.engine` nicht auf `soloist`
steht. Beide Suchtexte sind am Gerät gemessene Ausgaben von soloist 1.3.7.485.
Ausgerollt wird sie über `scripts/systemd/einrichten.sh` (mit Gegenprobe
„Anmeldewache tickt"), `autosetup.sh` und die Update-Schale.

> **Der Neustart ist nicht harmlos.** Er stellt die Connect-Sitzung wieder her
> („restoring session"), und Spotify setzt die letzte Wiedergabe von selbst
> fort — an der Oberfläche vorbei, die davon nichts weiß, weil die
> soloist-WebSocket `127.0.0.1:5033` von niemandem gelesen wird. Kein Knopf
> der Box stoppt so einen Strom. llmwiki
> `soloist-neustart-kann-wiedergabe-ausloesen` und
> `soloist-meldet-sich-genau-einmal-an`.

**Die Hardware am GPIO:**

| Unit | Was sie tut |
|---|---|
| `mupi_offtrigger` | **der weiche Ausschalter am Knopf** (GPIO17, 2 s Druck). Ohne ihn wirkt nur der 6-Sekunden-Hardware-Schnitt der Platine — mitten in laufende Schreibvorgänge hinein. Er lag ein Jahr lang gar nicht auf der Box, und **niemand hat es gemerkt**: `autosetup.sh` legte ihn nach `/var/lib/dietpi/postboot.d/`, wo er nie ankam — und wo er ohnehin nicht hätte laufen können, weil DietPi die Skripte dort nacheinander abarbeitet und auf ihr Ende wartet. Genau darum ist er heute eine Unit: `systemctl status mupi_offtrigger` beantwortet „läuft der Wächter?" in einer Zeile, ein fehlendes File in einem Verzeichnis beantwortet sie gar nicht |
| `mupi_powerled` | das Licht im Einschaltknopf (GPIO13, PWM) |
| `mupi_fan` | **Liegt auf der Karte, läuft aber nicht** — `autosetup.sh:1057` legt die Unit nur ab („NUR ANLEGEN, NICHT EINSCHALTEN: ein Lüfter gehört nicht an jede Box"), **kein Ausrollweg schaltet sie scharf**. Der einzige Einschalter war `AdminInterface/www/mupi.php`, und den gibt es seit E47 nicht mehr; `src/backend-api/src/dienste.ts` führt den Lüfter weiter als normale Wahlmöglichkeit. Wer ihn will, schaltet ihn selbst ein. Diese Zeile stand bis zum 25.08.2026 kommentarlos in dieser Tabelle — die Probe hatte ihr `enable` aus einem **Kommentar** gelesen. Lüftersteuerung (`fan_control.py`): die vier Schwellen `luefter25/50/75/100` stehen in der mupiboxconfig unter `fan.fan_temp_*`; `pruefeKonfig` verweigert eine Kurve, die nicht ansteigt — llmwiki `konfigfeld-zwei-namen-luefterkurve` |
| `mupibox-touch-bridge` | fragt den FT5x06-Touch per I2C ab |
| `mupi_taster`, `mupi_knopflicht` | der zweite Taster (GPIO17) und sein Licht (GPIO13). Sie kommen über `scripts/systemd/einrichten.sh` — das ist ein Ausrollweg wie die anderen vier, nur schaltet er in einer Schleife über `DIENSTE=( … )` scharf |

**Start, Ton und Wiederherstellung:**

| Unit | Was sie tut |
|---|---|
| `mupibox-boot-splash` | die Boot-Animation im Framebuffer, mit **echtem** Fortschritt |
| `mupibox-fehlerbild@.service` | **Vorlage**, keine gewöhnliche Unit: `%i` trägt den Namen der Unit, die gescheitert ist. Angehängt wird sie nicht in `config/services/`, sondern von `scripts/mupibox/fehlerbild-anhaengen.sh` als Zusatzstück — weil `mupibox-server` und `mupibox-player` gar nicht aus diesem Repo kommen, sondern vom remote-step-installer. Läuft Chromium, malt sie **nicht** |
| `mupibox-wiederherstellung` | holt beim Start eine Sicherung von der Karte zurück (E29/B3) |
| `mupibox-alsa-init` | legt den softvol-Regler an, den der Player beim Start braucht |
| `pipewire.socket` | die Tonkette (siehe 4.5) |
| `wifi-powersave-off` | schaltet den WLAN-Energiesparmodus ab, sonst bricht die Verbindung weg |
| `mixpi-wlan-adapter` | wendet die WLAN-Adapterwahl nach dem Start an |
| `mupi_wifi` | liest `/boot/add_wifi.json` bei **jedem** Start und trägt ein dort hinterlegtes Netz nach — der Weg, auf dem eine Karte ohne Bildschirm ins WLAN kommt |
| `mupi_startstop` | Bestand aus dem Ursprungsprojekt. **Er ist nicht abgeschafft**: `autosetup.sh` schaltet ihn auf einer frischen Karte mit scharf. Auf gewachsenen Boxen steht er oft auf `disabled` — llmwiki `taster-wird-von-niemandem-ueberwacht` misst das an `.169`. Wer „läuft er?" beantworten will, fragt `systemctl is-enabled mupi_startstop` und nicht dieses Kapitel |
| `mupi_idle_shutdown` | **fährt die Box nach Leerlauf herunter.** Steht in derselben Schleife von `autosetup.sh` und ist damit ab Werk scharf; wer misst und dabei wartet, misst gegen diese Unit |
| `netzabriss-sonde` | die Funkbild-Sonde des Netzabriss-Messaufbaus: `/home/dietpi/netzabriss/sonde.py`, `Restart=always`, läuft als `dietpi` und schreibt ein Protokoll daneben. **Kein Dauerläufer der Anwendung, sondern ein Messgerät** — Quelle im Baum ist `tools/box/netzabriss-sonde.py`, und sie ist der einzige Eintrag dieser Tabelle, der nichts für den Betrieb tut |

**Nur über das Rezept** (gefunden am 25.08.2026, als
`tools/dienste-doku-deckung.sh` zum ersten Mal auch
`remote-step-installer/recipes/*.yaml` las). Diese Units schaltet **nur** das
Rezept scharf: auf einer Rezept-Box laufen sie, auf einer autosetup-Karte
nicht. Sie standen bis dahin in keiner Zeile dieses Kapitels — und genau
deshalb liest sich die Tabelle oben wie „was auf jeder Box läuft", obwohl sie
„was jeder Weg einschaltet" meint:

| Unit | Was sie tut, und was ohne sie fehlt |
|---|---|
| `mupi_change_checker` | bemerkt neue Musik: `change_checker.sh` stößt `m3u_generator.sh` an, sobald sich die **Änderungszeit** eines Medienverzeichnisses ändert. `autosetup.sh` legt die Unit nicht einmal ab, und `update/start_mupibox_update.sh:1568-1570` **stoppt, deaktiviert und löscht** sie. Das Verwaltungsfeld „Medien prüfen alle N Sekunden" (`konfiguration.ts:451`) steuert genau diese Unit — auf einer autosetup-Karte ist es wirkungslos, und nach einem Update ist es das wieder. **Sie sieht nur EINE Ebene** (30.08.2026): die Schleife läuft über `"${MEDIA}/"*`, also über die **Kategorieordner** (`music`, `audiobook`), und liest deren `stat -c %Z`. Ein neues Album unter einem Interpreten, den es schon gibt, ändert nur `media/music/<Interpret>` — der Kategorieordner bleibt unberührt, und die Wache schlägt **nie** an. Nachgemessen: neues Album unter vorhandenem Interpreten lässt `%Z` von `media/music` stehen, ein neuer Interpret hebt es. Dann hilft nur der Knopf **Medien neu einlesen** (`system.ts`, `AKTIONEN['medien-neu']`, auf der Medienseite). llmwiki: [[medienwache-sieht-nur-die-kategorieebene]] |
| `mupi_hat`, `mupi_hat_control` | MuPiHAT: Akkuanzeige und Abschaltwarnung. `autosetup.sh:1032-1033` legt beide Units ab, **schaltet sie aber nicht ein**; das Rezept ist der einzige Weg, der es tut (`AN="$AN mupi_hat mupi_hat_control"`). Auf einer frischen Karte **mit** MuPiHAT bleibt die Akkuanzeige darum tot. Der Einzel-Einschalter `scripts/mupihat/enable_mupihat.sh` existiert, wird aber nur in Kommentaren erwähnt |
| `mupi_mqtt` | die MQTT-Anbindung. Die Unit kommt über `autosetup.sh:1041`, scharf schaltet nur das Rezept — und legt ihr dabei eine `ExecCondition` auf `mqtt.active` in der mupiboxconfig bei. Sie läuft also nur, wenn MQTT in der Verwaltung eingeschaltet ist |
| `mupi-network-info.timer` | Netzwerkdaten für die Oberfläche, alle 20 s (ab 25 s nach Start), über `mupibox-network-sync.sh`. **Die Unit steht in keiner Datei des Repos** — das Rezept schreibt sie zur Laufzeit mit `cat > …`; `tools/units-decken-sich.sh` kann sie deshalb nicht sehen |
| `mupibox-netz-watchdog-boot` | der Totmannschalter für WLAN-Änderungen: wer das WLAN über genau dieses WLAN ändert, bekommt ohne Entwarnung einen Rückrollvorgang. Die Boot-Einheit fängt den Neustart vor dem Wecker ab. Schritt ist `optional: true` — er kann im Runner abgewählt sein |
| `mupibox-bootwache` (`.service`/`.timer`) | nimmt eine unbestätigte `/boot/config.txt` zurück — ein falscher Drehwert ist sonst ein schwarzer Bildschirm, der **sauber bootet**. **Pflichtschritt**, weil die Systemaktion `drehung-zurueck` genau `/opt/mupibox-tools/bootwache.py --zuruecknehmen` ruft. Quelle ist `remote-step-installer/tools/mupibox-bootwache.py` — seit 29.08.2026 inhaltsgleich mit `scripts/box/bootwache.py` (die Fassungen waren auf 197 gegen 808 Zeilen auseinandergelaufen; `tools/zwillinge-nach-ziel.py` hält die Gleichheit seither). `autosetup.sh` kopiert die Box-Fassung nach `/opt/mupibox-tools/`, gestartet wird sie dort von keiner Unit dieses Repos |
| `zramswap` | DietPi-Bestand, kein eigener Dienst — das Rezept schaltet ihn nur mit ein |

**Was die Ausrollwege an fremde Units *anhängen*** (gefunden am 30.08.2026).
Die Tabellen oben beantworten „welche Unit läuft". Sie beantworten **nicht**,
wie sie läuft: ein Ausrollweg legt neben eine Unit ein Verzeichnis
`UNIT.d/` und darin eine `.conf`, die einzelne Zeilen **überschreibt** — ohne
die Unit-Datei anzufassen. Wer `config/services/mupi_hat.service` liest, sieht
keine Bedingung; auf der Box startet der Dienst trotzdem nur, wenn der HAT da
ist. **Das ist eine dritte Sorte** neben Vorlage (hat eine Datei im Baum) und
Eingriff (ändert eine fremde Datei): sie legt eine eigene Datei an *und* wirkt
auf eine fremde. Genau dazwischen sind alle sechs jahrelang durchgefallen.
`tools/ergaenzungen-deckung.py` hält sie seither gegen diese Tabelle — gesucht
wird der **Pfad unter `/etc/systemd/system/` mit einem `.d/` darin**, nicht ein
bestimmter Schreibbefehl.

| Ergänzung | Weg | Was sie an der Unit umschreibt |
|---|---|---|
| `mupi_hat.service.d/nur-wenn-da.conf` | `recipes/mupibox.yaml:426` | `ExecCondition=/usr/local/bin/mupihat-da` — **die Akkuanzeige läuft nur mit angestecktem HAT**; ohne ihn endet der Start sauber statt in `failed`. Dazu `Restart=on-failure` / `RestartSec=30`. Bis 30.08.2026 stand diese Datei in **keiner** Zeile Prosa, obwohl sie allein entscheidet, ob der Dienst überhaupt anläuft |
| `mupi_hat_control.service.d/stop.conf` | `recipes/mupibox.yaml:336` | setzt `ExecStop` neu, gefangen in `bash -c … \|\| true`. **Achtung, der Schritt repariert einen Fehler, den es hier nicht mehr gibt:** seine `note:` zitiert ein `ExecStop=…$(cat /run/mupi_hat_control.pid)` aus der „mitgelieferten Unit" — `config/services/mupi_hat_control.service` hat seit E52 (20.08.2026) **gar kein `ExecStop` mehr**, und die PID-Datei schreibt niemand. Der Weg hängt es also wieder an, während der Kommentar in der Unit „ExecStop IST ENTFALLEN" sagt. Wirkungslos durch das `\|\| true`, aber die Box widerspricht der Datei |
| `mupi_mqtt.service.d/nur-wenn-aktiv.conf` | `recipes/mupibox-app.yaml:1138` | `ExecCondition` auf `mqtt.active` in der mupiboxconfig — MQTT läuft nur, wenn es in der Verwaltung eingeschaltet ist (dieselbe Aussage wie in der Zeile `mupi_mqtt` oben, hier mit Dateinamen) |
| `librespot.service.d/nicht-blockieren.conf` | `recipes/mupibox-app.yaml:1016` | leert `ExecStartPre`/`ExecStart` und setzt den Start neu: das Warten auf die Tonsenke gehört **in** den Start, sonst hält es `multi-user.target` auf. Deckel 20 s (40 × 0,5 s), nachgemessen — nicht 90 s. Zur Reihenfolge zweier Ergänzungen derselben Unit siehe 6.4 |
| `librespot.service.d/engine.conf` | `recipes/mupibox-app.yaml:1067` | der Schalter der Tonmaschine (E42): `ExecCondition` auf `spotify.engine != "soloist"`. **Die einzige Ergänzung mit einer Quelle im Baum** — `scripts/systemd/librespot-engine.conf`, über `/tmp` gelegt, weil `put:` vor dem `mkdir` des `run:`-Blocks läuft |
| `getty@tty1.service.d/dietpi-autologin.conf` | `recipes/mupibox.yaml:759`, `autosetup.sh:869` | der Autologin, auf dem die ganze Kiosk-Kette steht. **Der einzige Fall, in dem beide Wege dieselbe Datei anfassen — und verschieden:** das Rezept schreibt sie ganz neu auf `agetty -a dietpi` (mit Sicherung `.vor-kiosknutzer`), `autosetup.sh` biegt dieselbe Zeile per `sed -i` auf `--skip-login --login-options "-f dietpi"` um |

**pm2 ist abgeschafft.** Die Dienste liefen früher darunter; seit der
Umstellung auf systemd ist die App 20 s früher bereit. Wer alte Aufrufe findet
(`pm2 restart …`), hat einen Rest vor sich: llmwiki
`pm2-reste-nach-der-systemd-umstellung`.

Der **zweite** Rest ist am 14.08.2026 geschlossen worden: die Aufrufer waren
damals umgestellt, die **Installationswege** aber nicht. `autosetup.sh` (frische
Karte) installierte pm2 weiter und startete den Server damit, und der
Update-Weg rief `pm2 stop server` / `pm2 start server` — beides wirkungslos,
beides still. Die Units liegen jetzt in `config/services/`, und `tools/pm2-bestand.sh`
misst am Gerät nach, ob eine Box noch pm2 hat (die Box im Haus hat keins mehr).
Für die andere Hälfte — „zeigt jede Unit, die ein Weg anfasst, auch eine Datei
gegenüber?" — gibt es `tools/units-decken-sich.sh`.

**Und eine dritte Hälfte, gefunden am 21.08.2026:** die beiden Ausrollwege
führen je eine **handgeführte Liste** derselben Dateien — `autosetup.sh` 105
Ablagen, `update/start_mupibox_update.sh` 94, davon 94 gemeinsam. Die Ränder
laufen auseinander, und beide Wege sind für sich grün. Konkret: der Update-Weg
**stoppt und startet** `mupibox-server.service` und `mupibox-player.service`,
**erneuert sie aber nie**. Wer eine Server-Unit ändert, erreicht damit nur
frisch bespielte Karten; jede Box im Haus läuft mit der Unit von damals weiter.
Gemessen wird das mit `tools/ausrollwege-vergleich.py` (`--streng` für die
Prüfbatterie); llmwiki `zwei-ausrollwege-eine-handgefuehrte-liste` nennt auch
die Fälle, in denen das Fehlen **Absicht** ist (`splash.png`, `crontab.template`).

**Die frühere Ausnahme ist keine mehr (E47, 19.08.2026):** hier stand bis dahin,
der alte PHP-Admin (`AdminInterface/`) rufe weiter pm2 und komme über
`autosetup.sh` auf jede frische Karte. Beides trifft nicht mehr zu — das
Verzeichnis liegt seit E47 nicht mehr im Baum (`git ls-tree HEAD` zählt null
Dateien darunter), und der Schritt in `autosetup/autosetup.sh` (Z. 707 ff.) ist
ein Kommentar, der den Ausbau begründet: kein `lighttpd`, kein PHP, keine
Symlinks nach `/var/www`, und vor allem keine Zeile
`www-data ALL=(ALL:ALL) NOPASSWD: ALL` mehr. BACKLOG G7 und MODERNIZATION
Stage 2 sind damit erledigt, nicht offen.

### 4.2 Die Bausteine im Repo

```
src/backend-api      76 Quelldateien, 115 Testdateien  Express, TypeScript
src/backend-player   13 Quelldateien,  11 Testdateien  mpv + Spotify
src/frontend-box     92 Quelldateien,  40 Testdateien  Angular/Ionic — die klassische Oberfläche
src/frontend-admin   47 Quelldateien,  20 Testdateien  Angular — die neue Verwaltung
NewDesign/app.js     29 829 Zeilen                     die zweite Box-Oberfläche, ohne Bau-Schritt
```

Gezählt am 30.08.2026 (`find <modul>/src -name '*.ts'`, Testdateien `*.spec.ts`).
Die Zahlen altern schnell — der vorige Stand stammte vom 13.08. und nannte für
NewDesign 9043 Zeilen, ein Drittel des tatsächlichen Umfangs. Wer sie liest,
prüfe das Datum, wer sie ändert, setze es neu.

**Wie schnell, zeigt `app.js` selbst:** am Vormittag desselben 21.08. standen
hier noch 26 842 Zeilen — 1720 mehr am Nachmittag. Eine Zeilenzahl in der Doku
ist eine Momentaufnahme, kein Merkmal. Sie steht hier für die
**Größenordnung** („zehntausende, nicht tausende"), nicht als Wert, auf den
sich etwas berufen dürfte.

### 4.3 Eine Oberfläche für die Box

`NewDesign/`, ausgeliefert unter `/neu/` — reines HTML, CSS und JavaScript,
**kein Bundler, keine Abhängigkeit, keine externe Adresse**. Sie läuft gegen
denselben Ursprung, aus dem sie kommt.

**Hier stand bis zum 23.09.2026 „Zwei Oberflächen"** — samt dem Umschalter
`mupibox.oberflaeche` (`"klassisch"`/`"neu"`, Vorgabe `"klassisch"`). Beides
gilt seit E118 nicht mehr: der Schalter fiel mit 1d, die klassische
Angular/Ionic-Oberfläche mit 1e am 05.09.2026 (siehe 4.3.1), und
`scripts/chromium-autostart.sh` lädt fest `/neu/`. Die Überschrift widersprach
damit dem eigenen Unterabschnitt vierzig Zeilen weiter unten — zwei Wahrheiten
in einem Kapitel, und die ältere stand oben, wo man zuerst liest.

**Die eine harte Regel der neuen Oberfläche:** Abgespielt wird ausschließlich
über `/player/<raum>/<befehl>`. Die Kinderzeit hängt genau dort. Ein eigener,
bequemer Abspielweg würde die Zeitbegrenzung aushebeln, ohne dass es jemand
merkt — bis ein Kind um Mitternacht Musik hört. Der Prüfschritt
„Tests neue Oberflaeche" sichert das ab.

**`/player` ist zweierlei zugleich**, und das ist beim Bauen leicht zu
übersehen: der Weiterreicher zum Wiedergabedienst auf Port 5005 *und* eine
Seite der Oberfläche. Wer die Seite neu lud, während der Spieler offen war,
bekam die rohe JSON-Antwort zu sehen — der weiße „Pretty Print"-Schirm.
Unterschieden wird seither an dem, was der Aufrufer **haben will**:
`istSeitenaufruf` in `src/backend-api/src/server.ts` (gerufen aus
`app.use('/player', …)`) gibt ein `GET` mit `Accept: text/html` und
`Sec-Fetch-Mode: navigate` — oder ganz ohne diesen Kopf — an die Auslieferung
der Einzelseiten-Anwendung weiter; alles andere geht unverändert an den
Dienst. Ein Tiefeneinstieg auf `/player` (Lesezeichen, iframe, Neuladen)
funktioniert damit. Gegenprobe, beide Zeilen müssen stimmen:

```
curl -H "Accept: text/html" http://<box>:8200/player   -> text/html
curl http://<box>:8200/player/state                     -> application/json
```

Zwei ältere Ratschläge sind damit **überholt**: „nie auf `/player` tief
einsteigen" (llmwiki `player-pfad-ist-im-backend-belegt`) und der
Kommentargrund in `app.component.ts`, der Umweg `?seite=player` sei nötig —
er bleibt bestehen, weil er nichts kostet, nicht weil er müsste. Die
allgemeine Regel dahinter gilt weiter: **wer eine neue Seite anlegt, prüft
vorher, ob das Backend ihren Pfad schon belegt** (`grep "app.use('/"
src/backend-api/src/server.ts`).

#### 4.3.1 Die Seiten der klassischen Oberfläche — Geschichte

Die klassische Angular-Oberfläche (16 Wege in einer Routentabelle, ein
Einstellungs-Tor davor) ist mit **E118/1e am 05.09.2026 gelöscht** worden —
es gibt EINE Oberfläche (4.3.2). Was aus ihr übernommen wird, steht mit
Fundstellen in `dokumentation/ALT-UEBERNAHMEN.md`; den vollen Stand trägt
die git-Historie vor dem Löschungs-Commit. Die frühere Wache dieses
Abschnitts (`box-seiten-deckung`) fiel mit der Routentabelle.

#### 4.3.2 Die Anzeigeorte der neuen Oberfläche

Die neue Oberfläche hat **keine Routentabelle** — sie ist eine einzige Seite,
und was man sieht, entscheidet ein `hidden` an einer Hülle. Wer sie nach dem
Muster von 4.3.1 zu zählen versucht, findet nichts. Ihre Entsprechung ist eine
andere: die **Anzeigeorte**, drei Hüllen in `NewDesign/index.html`, die
*dasselbe* über das laufende Stück zeigen.

| `data-anzeigeort` | Wo es steht |
|---|---|
| `Mini-Player` | das Kissen am unteren Rand (`#mp`) |
| `grosser Player` | der aufgezogene Spieler (`#gross`) |
| `Cover-Vollbild` | das formatfüllende Cover (`#album-gross`) |

**Warum das hier steht und nicht nur im Code:** Die drei Orte hatten bis zum
03.08.2026 je **eigene** Zuweisungen. Zwei liefen im 2-Sekunden-Takt
(`mpMalen`), die des Vollbilds nur beim Öffnen (`albumGrossAuf`) — beim
nächsten Titel blieben dort Titel, Interpret und Cover des vorigen stehen
(gemeldet wörtlich: „auch im voll bild aktualiierte es die infromationen
nicht"). Der Fehler war nicht die vergessene Zeile, sondern dass es drei
Stellen gab, an denen man sie vergessen **konnte**.

**Seither steht die Liste im Baum, nicht im Skript.** Jede Hülle trägt
`data-anzeigeort`, ihre Teile `data-np="titel|unter|cover|symbol"`;
`anzeigeOrte()` in `NewDesign/app.js` liest sie einmal aus dem Baum und malt
jeden gefundenen Ort. **Ein vierter Ort bekommt dieselben Merkmale und wird
mitgemalt, ohne dass in `app.js` eine Zeile dazukommt.** Wer einen anlegt,
trage ihn in die Tabelle oben nach — die Wache verlangt es.

**Wie weit die Zusammenführung geht** — die Grenze ist Absicht, nicht
Unfertigkeit:

* **Mit dabei:** Titel, Unterzeile, Cover, Spiel/Pause-Symbol. Die vier Dinge,
  die jeder Ort aus **derselben** Meldung ableitet und die deshalb überall
  dasselbe sagen müssen.
* **Nicht dabei: der Fortschritt** (`balkenMalen`). Er hat das Problem nicht —
  ein einziger Schreiber, und die Orte zeigen ihn **absichtlich verschieden**:
  der Mini-Player einen Balken, der große Player einen ziehbaren Regler mit
  zwei Zeiten, das Vollbild gar nichts. Ein gemeinsames Schema hätte dort mehr
  Ausnahmen als Fälle.
* **Nicht dabei: die Lautstärke-Anschläge.** Sie hängen nicht am laufenden
  Titel, sondern am Lautstärkewert, und sind über `data-laut` an ihrer eigenen
  einen Stelle zusammengefasst. Zwei Verzeichnisse für zwei verschiedene
  Quellen sind richtig; eines für beide wäre nur kürzer.

Bewacht von `tools/anzeigeorte-deckung.py`, beide Richtungen: jeder
`data-anzeigeort` aus dem HTML steht in der Tabelle oben, und die Tabelle
behauptet keinen Ort, den es nicht gibt. Die Wache ist am 30.08.2026
entstanden — bis dahin kam **keiner** der drei Namen in dieser Datei vor,
während die klassische Oberfläche ihre 16 Wege seit dem 25.08. aufgezählt und
bewacht führte.

#### 4.3.3 Wellen im Player — seit E99 taktehrlich, mit CSS als Rückfall

Der Fortschrittsbalken des großen Players (`.gross-balken`) kann sich bewegen,
solange Ton läuft. Schalter: `statusWellen` in `darstellung.json`
(**Vorgabe `false`**), Beschriftung „Wellen im Player" unter *Darstellung →
Optik → Mini-Player*. Bis zum 30.08.2026 lag der Schalter im Reiter
*Verhalten*; er steht seither beim Fortschrittsstreifen, den er bewegt
(Betreiber am selben Tag: „der schalter ist nicht da ich haette ihn im player
vermutet"). Im Betriebshandbuch steht die Bedienseite davon.

**ZWEI AUSPRÄGUNGEN, UND WELCHE LÄUFT, ENTSCHEIDET DIE BOX — nicht der
Nutzer.** Vor E99 (30.08.2026) gab es nur die untere Zeile dieser Tabelle, und
die Begründung dafür lautete, eine Beat-Analyse sei „strukturell unmöglich".
Das war für den BROWSER richtig und ist es geblieben — der Irrtum war, die
Aussage über den Browser für eine Aussage über die BOX zu halten:

| | Woher der Ausschlag kommt | Wann |
|---|---|---|
| **echt** (E99) | `src/backend-player/src/pegel.ts` misst auf der Box | Feld `pegel` liegt im Zustands-Poll |
| **CSS** (Rückfall) | reine Animation, folgt nur dem Wiedergabezustand | Feld `pegel` fehlt |

**Der echte Weg** (E99, Commit `55dd4f1e`, am Gerät bewiesen `dd6a5afc`):
`pegel.ts` startet `pw-record` **bewusst ohne `--target`**, greift also den
Monitor der Standard-Senke ab — dieselbe PipeWire-Eigenheit, die für
`plugins/mixpi-mitschnitt` eine Falle ist (vier stille Aufnahmen, 22./23.08.),
ist hier der **Vertrag**: gezeigt werden soll, was die Familie hört,
Piper-Ansagen eingeschlossen. Vier Bänder per **Goertzel** (je drei
Abhorchfrequenzen, 100-ms-Fenster bei 16 kHz mono, Höhen ehrlich bis 7,2 kHz —
Nyquist), Werte 0..1, additiv als `pegel: [b1,b2,b3,b4]` im vorhandenen
Zustands-Poll, ~10/s. Bei Stille oder Pause exakt `[0,0,0,0]`. **Fehlt
`pw-record`, verschwindet das Feld ganz** — ein Protokolleintrag, kein Gezeter.
Start/Stopp hängen an der EINEN Spielzustands-Stelle in `spotify-control.ts`.
Am Gerät gemessen (30.08., laufendes ARD): `pegel=[0.088, 0.073, 0.015, 0.005]`
— Bass vorn, Höhen leise —, Abgriff **0,0 % CPU**.

**Der Zeichner** (`NewDesign/app.js`, Canvas `#gr-wellen` in der
Fortschrittszeile): **kein `requestAnimationFrame`, kein Timer** — die
E100-Lehre, dass ein 250-ms-Takt den Kiosk-Hauptfaden schon einmal auf 47 %
Dauerlast getrieben hat. `wellenNeuerPegel()` läuft ausschließlich aus einer
frisch eingetroffenen Netzantwort und zeichnet genau einmal je Aufruf; bei
anhaltender Stille pausiert er nach 3 s **ganz**. Je Band ein Ringpuffer von 60
Werten, der von rechts nach links durchläuft (Oszilloskop-Scroll). Farben sind
vier Deckkraft-Stufen derselben aufgelösten `--player-akzent`-Farbe — kein
eigenes Farb-Parsing, robust gegen jedes Format, das ein Thema dort einträgt.
Die Leinwandgröße wird **bei jeder Zeichnung nachgemessen und nur bei
Abweichung zugewiesen**; warum das kein Luxus ist, steht in llmwiki
`leinwand-misst-sich-selbst-nicht-nach`.

Der CSS-Rückfall ist **nicht gelöscht**: drei überlagerte Bewegungen mit
**teilerfremden** Taktlängen (2600/3400/4100 ms) — nur `transform` und
`opacity`, damit der Pi bei 60 fps bleibt.

**Drei Klassen, nicht zwei** (`NewDesign/app.js`):

| Klasse | Woher sie kommt |
|---|---|
| `body.status-wellen` | der Schalter in der Verwaltung ist an |
| `body.ton-laeuft` | es spielt wirklich etwas |
| `body.wellen-echt` | **keine Einstellung** — es kommen wirklich Pegel an |

`body.wellen-echt` blendet die Leinwand ein und die beiden CSS-Pseudoelemente
aus; unter `prefers-reduced-motion` wird die Leinwand ebenso ausgeblendet wie
die CSS-Bewegung angehalten. Es gibt dafür **keinen Schalter in der
Verwaltung**, und das ist Absicht: ob die Box hören kann, ist eine Tatsache,
keine Wahl.

Fehlt eine der beiden ersten, wird die CSS-Bewegung **angehalten**
(`animation-play-state: paused`), nicht entfernt: Anhalten ruht an Ort und
Stelle, Entfernen springt. `prefers-reduced-motion` schaltet unabhängig vom
Schalter ab.

**Warum die positive Klasse `ton-laeuft` heißt und nicht `spielt`:** Die Wache
`tools/raster-marke-schau.mjs` verlangt für die Klasse `spielt` **genau einen**
Schreiber — sie gehört der Kachel-Marke. Der Body-Zustand hieß zunächst
gleich und setzte sie an drei weiteren Stellen; damit hätte außerdem eine
Kachel-CSS-Regel auf den Body matchen können. `ton-laeuft` wird an denselben
drei Stellen gesetzt wie `ton-pausiert` (`spieltMarkieren`,
`anhaltenOderWeiter`, `wechselAbschliessen`) und ist **bewusst keine Umkehrung**
davon: Vor der ersten Wiedergabe fehlen beide.

Der Fortschritt hat damit weiterhin **einen** Schreiber (`balkenMalen`, siehe
4.3.2). Der Wellen-Zeichner aus E99 kommt **nicht** als zweiter dazu: er malt
auf eine eigene Leinwand und fasst die Füllung `#gr-fuell` nicht an.

### 4.4 Eine Verwaltung

`src/frontend-admin` (Angular, ausgeliefert unter `/admin`) ist die **einzige**
Verwaltung der Box. Wenn sie fehlt, steht man ohne da — es gibt keinen zweiten
Weg mehr, über den man an die Einstellungen käme.

**Was hier bis zum 23.08.2026 stand und falsch war:** „Zwei Verwaltungen", die
alte `AdminInterface/` (PHP) und die neue, und `MUPI_ADMIN` entscheide, welche
gilt. Die alte ist mit E47 (19.08.2026) ausgebaut worden, und den Schalter
`MUPI_ADMIN` gibt es im Baum nicht mehr — die einzige verbliebene Fundstelle ist
`MUPI_ADMIN_DEBUG` in `harness/admin-entrypoint.sh`, ein anderer Name für eine
andere Sache — und auch die ist tot: das `admin`-Profil, das ihn setzt, mountet
`../AdminInterface/www` und startet seit E47 nicht mehr (nachgetragen
26.08.2026, siehe `harness/README.md` und `AUDIT-2026-08-25.md` §10). Ein Abschnitt, der eine Wahl zwischen zwei Dingen beschreibt, von
denen es nur noch eines gibt, schickt jeden Leser auf die Suche nach einem
Schalter, den er nicht findet.

**Drei der 27 Seiten stehen in keiner Leiste.** Die Kopfleiste (`rahmen.ts`)
führt **24** Einträge, `app.routes.ts` **27** Seiten (Stand 23.09.2026 — seit
der Zählung vom 20.09. dazugekommen: „Netzlaufwerk" und „Nachrichten"; davor
„Spiele" und „Videos" (Belohnungs-Videos aus der Mediathek), „Aufzeichnen",
E126, und „VPN", E30. Die Differenz von drei blieb über alle sechs Zugänge
dieselbe). Die Differenz sind die
Plugin-Unterseite (`/plugins/:kennung`) — und zwei vollwertige Seiten, die
**nur über einen Link auf der Medienseite** erreichbar sind (`medien.ts`,
Karte „weg"):

| Weg | Titel | Ablage | Rührt die Bibliothek an? |
|---|---|---|---|
| `/verschmelzung` | Doppelte | `config/verschmelzung.json` | nein |
| `/interpreten` | Interpreten | `config/interpreten.json` | nein |

Beide sind **Unterseiten von „Medien"** (seit 03.08.2026); `rahmen.ts:51` bildet
sie für die Markierung in der Leiste auf `/medien` ab, weil der Pfad nicht mit
`/medien` anfängt. Dass sie keine eigene Karte auf der Medienseite sind, ist
Absicht: die Karte darüber **löscht Einträge**, während diese beiden nur eine
Liste **daneben** schreiben — beides untereinander lädt zum Verwechseln ein.
Die eigene Ablage ist zugleich der Rückweg: die Datei zu löschen heißt wirklich
„wie vorher".

Wer die Seiten der Verwaltung zählt oder aufzählt, zähle deshalb
`app.routes.ts`, **nicht** die Kopfleiste — sonst fehlen genau die drei, die
niemand im Menü findet.

**Was hier bis zum 24.08.2026 stand und falsch war:** „Vier der 21 Seiten", die
Kopfleiste führe **17** Einträge, und die Übersicht sei eine davon, die niemand
im Menü findet. Sie ist der **erste** Eintrag der Leiste (`rahmen.ts:150`) — nur
steht sie als einzige außerhalb der `<section class="gruppe">`-Blöcke, und wer
die Gruppen zählt, kommt auf 17. Die Rechnung ging trotzdem auf (21 − 17 = 4),
und deshalb hat sie drei Wochen niemand nachgeschlagen. **Eine Differenz zweier
Zahlen belegt nicht, dass beide stimmen.**

**Die Suche über alle Seiten** ist der einzige Weg, in 25 Seiten (`app.routes.ts`,
ohne Anmeldung und Umleitung) einen Schalter zu finden, dessen Ort man nicht kennt. Was sie kennt, steht in
`src/frontend-admin/src/app/such-bestand.ts` — einer **erzeugten** Datei
(`tools/verwaltung-suchbestand.mjs` liest den sichtbaren Text aus den Seiten).

Wer dort etwas ändert, lese vorher llmwiki
`erzeugte-suchliste-von-hand-ergaenzt`. Gemessen am 29.08.2026 mit
`tools/suchbestand-drift.mjs`: die Seiten geben **310** Einträge her, abgelegt
sind ebenfalls **310** — kein fehlender und kein von Hand nachgetragener
Eintrag mehr. (Am 21.08.2026 stand hier noch 304 zu 275: 37 fehlende, darunter
die ganze Seite *Leistung* samt ihrem eigenen Titel und elf Schalter der
*Darstellung*, dazu acht von Hand nachgetragene, die ein `--schreiben`
weggeworfen hätte.) Die Wache dafür (`tools/pruefen.sh:298`, Schritt
„Suchbestand der Verwaltung") ist inzwischen grün.

### 4.5 Die Tonkette

```
Spotify   → librespot ──┐
Jellyfin  → mpv ────────┼→ ALSA → PipeWire → MuPiHAT (I2S) oder Bluetooth
lokal     → mpv ────────┘
Vorlesen  → Piper
```

Zwei unabhängige Tonmaschinen, die nichts voneinander wissen: **librespot**
läuft dauerhaft, **mpv** wird je Wiedergabe gestartet und beendet. Das Umschalten
zwischen ihnen ist eine eigene Regel — llmwiki `dienste-umschalten`.

Seit dem Umstieg auf **PipeWire** (von bluealsa) gilt: der Tonserver gehört der
*Benutzersitzung*, nicht dem System. Deshalb läuft der Kiosk als `dietpi` und
nicht als root — ein Benutzerdienst kann nicht zwei Benutzer bedienen. Der ganze
Umbau mit seinen drei Hürden: llmwiki `mupi-pipewire-umstieg`.

**Was die Ausrollwege in den Tonstapel legen.** Drei Vorlagen aus
`config/templates/` stellen PipeWire/WirePlumber fest ein; sie lassen sich nur
an der Box ändern (keine Verwaltungsseite). **Nicht alle drei liegen auf jeder
Box** — die Spalte *Weg* sagt, welche:

| Vorlage | Ziel auf der Box | Weg | Was sie festlegt |
| --- | --- | --- | --- |
| `80-bluez-ohne-seat.conf` | `/etc/wireplumber/wireplumber.conf.d/` | alle | Bluetooth-Ton **ohne aktive Sitzung**; ohne sie meldet `bluetoothctl` `br-connection-profile-unavailable` (llmwiki `mupi-wireplumber-kein-bluetooth-ohne-seat`) |
| `81-bluez-nur-a2dp.conf` | `/etc/wireplumber/wireplumber.conf.d/` | **erst nach dem ersten Update** | **nur die A2DP-Rollen**, kein Freisprech-Profil (HFP/HSP) — siehe unten |
| `61-entzerrer.conf` | `/etc/pipewire/pipewire.conf.d/` | **erst nach dem ersten Update** | die fünf Bänder des Equalizers; die Regler stellt der Server zur Laufzeit |

**Warum „erst nach dem ersten Update".** Es gibt drei Ausrollwege, nicht zwei:
den alten Monolithen (`autosetup/autosetup.sh`), den Update-Weg
(`update/start_mupibox_update.sh`) — und den remote-step-installer, der laut
§5.1 **der Weg heute** ist. Sein Rezept legt `80-bluez-ohne-seat.conf` aus dem
eigenen Baum ab (`remote-step-installer/tools/wireplumber/`, Wort für Wort
dieselbe Datei), `81` und `61` aber **nicht**. Eine heute frisch aufgesetzte
Box hat den Equalizer und die A2DP-Einschränkung also erst, wenn sie das erste
Mal aktualisiert wurde. Sieben der vierzehn ausgerollten Vorlagen sind so;
welche, sagt `tools/ausgerollte-vorlagen-deckung.py`. Die Vereinigung der Wege
belegt, dass *irgendein* Weg eine Datei legt — nie, dass *jede Box* sie hat.

`81-bluez-nur-a2dp.conf` ist eine **absichtliche Einschränkung, kein Rest**:
Lautsprecher mit Mikrofon (gemessen an der Xiaomi-Box, 15.08.2026) bieten
zusätzlich HFP/HSP an, WirePlumber versuchte es im Halbminutentakt
nachzuverbinden, und **jeder Versuch hackte den laufenden A2DP-Strom ab** —
der Betreiber hörte abgehacktem Ton zu, während der PipeWire-Graph fehlerfrei
lief (`pw-top: ERR 0`). Zeitweise kippte die Senke ganz in HFP (1 Kanal,
16 kHz, Telefonqualität). Der Preis: **die Box nimmt über Bluetooth kein
Mikrofon entgegen**, überall dort, wo die Datei liegt (siehe Spalte *Weg*), und
ohne Schalter. Wer das braucht, entfernt die Datei an der Box und startet
WirePlumber neu — und bekommt das Stottern zurück. Umgekehrt gilt: wer das
Stottern auf einer **frisch aufgesetzten** Box hört, hat die Datei noch nicht —
ein Update legt sie hin.

**Was die Ausrollwege im Tonstapel nicht ablegen, sondern *ändern*.** Eine
Vorlage hat einen eigenen Namen; ein Eingriff in eine fremde Datei hat nur ein
Ziel und passt in keine Vorlagen-Tabelle. `autosetup/autosetup.sh:700` hängt
`--noplugin=sap` an das `ExecStart=` in
`/lib/systemd/system/bluetooth.service` — der SAP-Steckplatz (SIM Access) fällt
damit weg. Drei Dinge gehören dazu: die Datei gehört dem **Paket** `bluez`
(anders als das Drop-in unter `/etc/systemd/system/librespot.service.d/`, das
diese Box sonst benutzt), ein Paket-Upgrade überschreibt sie also; **kein**
anderer Weg trägt den Eingriff nach — weder der Update-Weg noch das Rezept —,
und auf einer heute aufgesetzten Box gibt es ihn deshalb gar nicht. Ebenfalls
nur im Monolithen: drei `sed`-Zeilen auf `/etc/pulse/daemon.conf` und
`/etc/pulse/client.conf` (System-Instanz, `autospawn = no`), die 280 Zeilen
später ins Leere laufen — dort entfernt derselbe Weg PulseAudio ganz. Die
vollständige Liste solcher Eingriffe prüft
`tools/ausgerollte-eingriffe-deckung.py`; die außerhalb des Tonstapels stehen
in §5.3.

`librespot` setzt kein `LIBRESPOT_BACKEND`, läuft also über rodio → cpal →
**ALSA** — nicht über PulseAudio. Das ist der Grund, warum eine Bereitschafts­
prüfung auf `aplay -l` eine falsche Entwarnung wäre: die liest nur
`/proc/asound` und weiß vom Tonserver nichts.

**Das Klangwerk** (seit 20./21.08.2026) hängt sich *zwischen* Abspieler und
Soundkarte: ein PipeWire-`filter-chain` als eigene Senke, gefüttert aus einer
**geschlossenen Liste von Gliedern** — `basis` (Stereobasis), `hochpass`,
`tiefpass`, `kuhschwanz`, `glocke`, `vorpegel`. Ein Ton-Plugin (`mixpi-klang`)
beschreibt diese Glieder, `src/backend-api/src/klangkette.ts` übersetzt sie in
die Conf. **Freien PipeWire-Text nimmt der Kern nicht an** — `convolver` lädt
Dateipfade, `ladspa` fremde `.so`: ein Plugin schriebe sich damit am Kern
vorbei Code in den Tonstapel, und ein Tippfehler wäre eine **stumme Box**
(llmwiki `klangwerk-geschlossenes-vokabular-statt-freier-conf`).

Was der Eltern-Bereich auf der Ton-Seite zeigt, ist **gerechnet, nicht
gemalt**: die `bq_*`-Glieder sind Biquads nach dem RBJ-Cookbook, dieselben
Formeln stehen in `klangkette.ts` und liefern Kurve (`frequenzgang`, 20 Hz bis
20 kHz, logarithmisch) und Pegelanzeige (`spitzeDb`). Die Anzeige ist die
**Spitze der Kette**, nicht der Pegel des Stücks — sie sagt, wieviel Luft die
Einstellung frisst, und deshalb „kann übersteuern" statt „übersteuert". Die
Stereobasis steht **nicht** in der Kurve: sie mischt zwischen Kanälen und hat
keinen Frequenzgang; dafür gibt es die Bühne. Einzelheiten samt der Messung des
Kuhschwanz-Überschwingers: llmwiki `klangkurve-ist-die-echte-wirkung`.

**Die Lautstärke hat genau eine regelnde Stufe** — die Vorgabe-Senke. Alles
andere im Weg (Abspieler-Strom, Zwischenknoten, Tonkarte) ist Durchreiche und
gehört auf 100 %. Der Grund ist nicht Ordnungsliebe: der Weg wird beim
Klangwerk-Neubau neu gesteckt, und ein Wert, der auf einer *anderen* Stufe
liegen blieb, strandet dort und dämpft für immer weiter, während vorne alles
grün aussieht (`wpctl get-volume @DEFAULT_AUDIO_SINK@` antwortete „1.00", die
Kette machte -82 dB). `einheit_nachziehen` in `scripts/mupibox/mupi-lautstaerke.sh`
zieht das bei **jedem** `set` nach, nicht einmalig — die Reihenfolge, in der die
Stufen hochkommen, lässt sich nicht festnageln (llmwiki
`genau-eine-stufe-regelt-den-ton`).

Wer nachmisst, misst die Kette **ganz**: `tools/tonweg-pegel.mjs` (alle Stufen
mit ihren Werten) und `tools/tonweg-durchgang.py` (echtes Signal durch den Weg).
Dabei gelten zwei Zählweisen für dieselbe Zahl: `wpctl` und `pactl` zeigen die
Wahrnehmungszahl, `channelVolumes` in `pw-dump` die Verstärkung auf den
Abtastwerten — dazwischen liegt die dritte Potenz (7 % = 0,000343 = -69 dB).
Und der Monitor-Abgriff einer Senke sitzt **vor** deren Regler, sieht also alles
außer der letzten Stufe (llmwiki `zwei-zaehlweisen-fuer-eine-lautstaerke`).

Ein Wächter (`klangAnwenden`, alle 30 s) prüft nicht nur, ob die Senke
**existiert**, sondern auch, ob der Abspielweg noch **auf ihr liegt** — sonst
läuft der Ton an der Kette vorbei, und alles sieht grün aus (llmwiki
`signalweg-verrutscht-passive-sucht-standardsenke`).

### 4.6 Der Kiosk

`getty@tty1` meldet `dietpi` automatisch an → `dietpi-login` →
`chromium-autostart.sh` → `startx … -- tty2`. Der Autostart-Index steht in
`/boot/dietpi/.dietpi-autostart_index` (11), **nicht** in `dietpi.txt`.
Der Kiosk wartet auf `localhost:8200`, bevor er X startet — die Startzeit der
App *ist* damit die Zeit bis zum Bild.

**Zwei Browser stehen zur Wahl** (`mupibox.kioskBrowser`, seit 20.08.2026):

| Wert | Was läuft | Gemessen an dieser Box (Pi 5, 800×480 DSI-2) |
|---|---|---|
| `chromium` (Vorgabe, auch bei fehlendem Schlüssel) | Chromium unter Xorg | 511 MB PSS, 8 Prozesse **plus** X-Server |
| `cog` | Cog/WPE direkt auf DRM, **ohne X** | 331 MB PSS, 6 Prozesse, kein X-Server |

Die 180 MB sind auf einer 2-GB-Box die knappe Ware. Was es kostet: Cog bringt
**WebKit statt Blink** mit — keine Erweiterungen, keine Fehlersuche über CDP,
und Bedienelemente verhalten sich anders (zwei solche Fälle sind in der
Oberfläche bereits behoben: llmwiki `webkit-zieht-den-reglergriff-nicht`,
`webkit-button-flex-streckt-nicht`). **Wer umstellt, prüft danach mit dem
Finger, nicht nur die Speicherzahl.**

Zwei Dinge daran sind nicht verhandelbar:

* `-O renderer=gles` **ist kein Feinschliff.** Ohne den Schalter nimmt Cog den
  `modeset`-Renderer, das Bild wird gezeichnet, aber nie umgeschaltet — auf dem
  Schirm stehen Streifen. Eine Umgebungsvariable dafür gibt es nicht
  (`COG_PLATFORM_DRM_RENDERER` existiert nicht und fällt still durch).
* **Der Rückfall auf Chromium** ist der Grund, warum man die Wahl überhaupt
  anbieten darf: Diese Box hat keine Tastatur. Startet Cog nicht, steht ein
  Kind vor einem schwarzen Schirm und niemand kann etwas eintippen. Cog bekommt
  seine Sekunden, dann kommt Chromium. Fehlende Pakete holt
  `mixpi-kiosk-pakete.sh cog` **vor** dem Start nach (`cog` zieht `libgles2`
  nicht mit).


### 4.7 Plugins

Die Box lässt sich erweitern, **ohne den Kern anzufassen**. Ein Plugin ist ein
Ordner mit zwei Dateien (`plugin.json` + `index.mjs`), kein `npm install`, kein
Bauschritt. Er liegt auf der Box unter `/home/dietpi/.mupibox/plugins/` und
gilt als **Nutzerdaten** — `tools/ausliefern.py` fasst ihn nicht an, eine
Auslieferung überschreibt also keine Plugins.

Drei Anmeldepunkte gibt es heute:

| Anmeldepunkt | Recht in `plugin.json` | Wofür | Musterplugin |
|---|---|---|---|
| Medienquelle | `medienquelle` | eine neue Quelle für Titel (`aufloesen`, `suchen`) | `mupibox-podcast`, `mupibox-subsonic` |
| Ereignisse | `ereignisse` | auf Systemereignisse reagieren (Licht, MQTT) | `mupibox-wled` |
| Klang | `klang` | etwas in den Signalweg des Tons hängen (Stereobasis, Entzerrung) | `mixpi-klang` |

Quer dazu liegt `netz`: es ist kein Anmeldepunkt, sondern die Erlaubnis, das
`kontext.holen` überhaupt zu bekommen. Ohne dieses Recht ist `kontext.holen`
schlicht `undefined` — eine Medienquelle, die ins Netz will, braucht also
**zwei** Einträge. `mupibox-subsonic` führt beide vor (`medienquelle`, `netz`).

> **Wie ein Medien-Plugin in die Medienliste kommt (E87/E88, seit
> 22.08.2026):** ein Eintrag trägt `type: "plugin"` und in `id` die **volle**
> Medienkennung des Plugins — `{ "type": "plugin", "id":
> "mixpi-archive:<identifier>" }`. Daraus baut `medienSchluessel()` ohne Zutun
> `plugin:mixpi-archive:<…>`, eine stabile Identität für Verlauf,
> Weiterhören und Favoriten. **Nicht** die Plugin-Kennung direkt als `type`
> setzen: `dienstVon()` (`medien.ts`) ist eine reine Funktion ohne
> Plugin-Register und lässt Unbekanntes auf `anderes` durchfallen, `artVon()`
> ebenso — die Kachel spielt dann nicht. `mixpi-ardsounds` liefert weiterhin
> `type: 'ard'`, und das ist **korrekt**: die ARD-Dienste im Kern können mehr
> als der generische Weg (Reihenfolge-Wunsch, Vorspann-Sprung). Falsch ist
> nur alles Dritte. Der Satz „erweitern, ohne den Kern anzufassen" gilt damit
> **auch für Medienquellen**: `mixpi-archive` (Internet Archive, gemeinfreie
> Hörspiele) hat seit E88 Suche und Aufnehmen-Knopf und ist der erste
> Anbieter, der komplett über ein Plugin läuft. Die Form und die sechs
> Stellen, die dabei zusammenpassen müssen, stehen in
> [`plugins/README.md`](../plugins/README.md); geprüft wird die Kette mit
> `tools/plugin-kette-probe.mts`.
>
> **Stand vor E87 (überholt):** bis zum Abend des 22.08.2026 gab es keinen
> Empfänger für `vorschlagAus()`, und `mixpi-archive` hatte deshalb bewusst
> keinen Aufnehmen-Knopf. Wer diesen Satz noch irgendwo liest — er galt bis
> 17:08 und ist seit 18:58 falsch (BACKLOG E84, Nachtrag).
>
> **Die gemerkte Stelle gibt es seit E90 auch für Plugin-Inhalt** (23.08.2026).
> Sie hängt an der **Folgenkennung**, nicht an der Position — ein Plugin-Werk
> ist dieselbe Bauart wie eine ARD-Sendung: eine Liste, die zwischen zwei
> Blicken anders aussehen darf, und wer die Position merkt, springt nach dem
> nächsten Zuwachs in ein fremdes Stück. Die Felder heißen weiter
> `resumeard…`, weil sie so in jeder `resume.json` stehen; der Name ist
> ungenau geworden, die Bedeutung nicht.
>
> Der Plugin-Zweig **holt die Folgenliste nicht nach**, wenn sie nach einem
> Serverneustart fehlt. Der ARD-Zweig darf das — der Server weiß, in welcher
> Reihenfolge er eine Sendung spielt; bei einem fremden Plugin weiß er es
> nicht. Eine geratene Liste wäre schlimmer als keine Stelle. Bis die Kachel
> einmal geöffnet war, wird deshalb **nichts** gemerkt.

**Seit dem 22.08.2026 sind vier Gesichter der Box selbst Plugins** — der Satz
„erweitern, ohne den Kern anzufassen" ist damit keine Zusage mehr an Fremde,
sondern der Weg, den die Box selbst geht. Anbieter: `mixpi-ardsounds` (E79 —
Regale, Sammlungen, Suche, Folgen, seit 0.2.0 auch Radiosender) und
`mixpi-jellyfin` (E81); der Kern hält nur noch die alten Routen und ruft
dahinter `pluginHttp`/`pluginInhalt`. Auskunft: `mixpi-librespot` und
`mixpi-soloist` (E82) berichten über die Tonmaschine — der **Hebel bleibt im
Kern**, ein abgeschaltetes Engine-Plugin nimmt nie den Ton, nur die Auskunft.
Wer wissen will, wie weit der Vertrag wirklich trägt, liest diese vier statt
der Musterplugins: [`plugins/README.md`](../plugins/README.md).

Dazu ein **fünftes Recht**: `aufnahme`. Es war bis zum 21.08.2026 eine reine
**Ansage** — ein Worker darf ohnehin importieren, was er will, das Recht hielt
niemanden auf; es stand in der Liste, damit im Eltern-Bereich *lesbar* ist, dass
ein Plugin mitschneidet.

**Seit E74 entscheidet es über Daten.** Nur ein Plugin mit `aufnahme` bekommt
`kontext.stroeme` — und zwar **mit den Zugängen**. Der Grund sind zwei
Entscheidungen, die sich sonst widersprechen: `GET /api/stroeme` gibt den
`spak_`-Schlüssel **nie** heraus (dort holt ihn die Browser-Verwaltung, und was
man nicht auslesen kann, landet auch nicht versehentlich in einem Protokoll) —
aber ein Plugin, das aufnehmen soll, braucht ihn, denn `soloist -k …` geht ohne
nicht. Die Route bleibt also verschlossen, und der Weg zum Plugin führt über das
Recht, das genau dafür da ist. Wer es nicht hat, sieht das Feld gar nicht.

> Das kostete am 20.08. zwei Stunden: das Plugin holte die Ströme über
> `GET /api/stroeme`, bekam sie ohne Schlüssel und meldete geduldig „Strom 2 hat
> keinen Zugang" — obwohl einer eingetragen war. Zwei richtige Entscheidungen,
> die sich widersprachen.

Die **Zuteilung** eines Stroms läuft getrennt davon über den Wirt
(`POST /api/stroeme/vergabe`), der nur eine **Nummer** vergibt: die Route
verteilt Plätze, das Recht gibt Geheimnisse. Einziger Träger ist
`mixpi-mitschnitt` (0.3.0), eine **Testfunktion**: standardmäßig aus, je Dienst
ein eigener Schalter, zwei Haken statt einem (Dienst **und** bestätigte
Rechtslage). Der Grund für die Härte ist das **Familienkonto** — eine Sperrung
nähme nicht das Archiv, sondern das Abspielen überhaupt, für alle, jeden Abend.
Einzelheiten samt Messung des Abgriffpunkts: [`plugins/README.md`](../plugins/README.md).

> **Was am Regal davon ankommt.** Playlist und Kachel entstehen nach dem
> *ersten* gelungenen Stück, nicht am Ende des Albums. Ein abgebrochener
> Mitschnitt hinterlässt deshalb eine Kachel mit 20 Sekunden Inhalt, ein Album
> das bei `02` anfängt, oder Dateien ganz ohne Kachel — am Gerät gemessen
> (.62, 22.08.2026): 18 von 29 Alben. `tools/mitschnitt-stummel.py` nennt die
> Fälle, ohne etwas zu ändern. llmwiki `mitschnitt-stummel-kachel-vor-inhalt`.
>
> **Seit E89 (23.08.2026) sagt die Kachel es selbst.** Sie verschwindet nicht
> und schweigt nicht: der Mitschnitt setzt `unvollstaendig: true` beim
> **Anlegen** und löscht das Feld erst am Ende eines **sauberen** Laufs.
> Stirbt er vorher, bleibt die Marke stehen — das ist der Entwurf, denn ein
> sterbender Prozess kann sich nicht selbst melden. Die Verwaltung zeigt sie
> an der Zeile des Albums. **Zwei Ebenen, zwei Regeln, die man nicht
> verwechseln darf:** ein *Titel* unter 97 % wird verworfen und vorgemerkt,
> das *Album* wird gezeigt und markiert. llmwiki
> `unvollstaendig-wird-gesetzt-nicht-am-ende-behauptet` und
> `halbe-aufnahme-nicht-anzeigen`.
>
> **Und eine Kachel kann heil aussehen und das Falsche enthalten** (23.08.2026):
> `pw-record` lief ohne `--target` und griff bei zwei gleichzeitigen Diensten
> den **Lautsprecher-Monitor** ab — vier Aufnahmen mit digitaler Null, zwei zur
> Hälfte still, alle als `fertig` geführt. Behoben über
> `--target <object.serial>` plus Gegenprobe am Graphen und Pegelurteil; die
> alte Wache prüfte nur die Dateigröße und maß damit die Komprimierbarkeit,
> nicht den Ton. **Noch offen:** die sechs Dateien liegen weiter in der
> Mediathek. llmwiki `mitschnitt-nahm-den-lautsprecher-auf`.

> **Wie diese Funktion getestet wird — und warum nicht über `ssh`.** Am
> 16.08.2026 riss das WLAN mitten im Testlauf ab, *nach* dem Einschalten und
> *vor* dem Ausschalten; zurück blieb eine eingeschaltete Testfunktion.
> `tools/box/mitschnitt-durchlauf.py` läuft deshalb per `nohup` **auf der Box**
> und schaltet in einem `finally` wieder aus — auch bei Ausnahme und Strg-C.
> Die Regel gilt für alles, dessen *eingeschalteter* Zustand teurer ist als ein
> misslungener Test. llmwiki `heikle-testfunktion-nicht-ueber-ssh-schalten`.

Mit E82 kam ein **sechstes Recht**: `geraetestand`. Es gibt einem Plugin, das
über die Box *berichtet*, ein `kontext.geraet` — lesend und über **geschlossene
Listen**: es fragt nach Namen (`soloist-fassung`), nie nach Programm und
Argumenten. Wie beim `holen`-Zaun ist das ehrlich gesagt eine **Beschriftung,
kein Käfig** (ein Worker darf `node:child_process` ohnehin); der Gewinn ist,
dass im Prüfstand ablesbar wird, welche Namen ein Plugin zieht, und dass ein
Plugin-Update sich keine neuen Befehle dazuwünschen kann. Die Listen stehen in
`plugin-geraet.ts`.

Im Backend tragen das drei Dateien: `plugin-vertrag.ts` (was ein Plugin
zurückgeben darf — und was abgewiesen wird), `plugin-wirt.ts` (der Wirt, der es
laufen lässt) und `plugin-laufwerk.ts` (das Laden von der Platte). Der
Plugin-Ordner ist ein **eigenes Ausrollziel**: wer ihn im Repo ändert, muss
prüfen, dass beide Installationswege ihn kennen (llmwiki
`plugin-laufwerk-ist-eigenes-ausrollziel`).

Jedes Plugin läuft in einem eigenen `worker_thread` mit **8 s Frist je Aufruf**
und **48 MB** Speicher; dreimal gerissen, dann bleibt es aus. Auf einer echten
Box gemessen (`tools/plugin-box-probe.mjs`): eine Endlosschleife war nach
302 ms abgebrochen, Kosten 11,4 MB je Plugin. Das ist **Absturztrennung, keine
Sicherheitstrennung** — ein Worker darf `node:child_process` selbst
importieren; nur Plugins installieren, deren Quelle man kennt.

Der Kern behält die Hoheit: ein Plugin bekommt kein `spielen`, sondern liefert
eine Quelle — ob daraus Ton wird, entscheidet `spielweg.ts`, und dort wird die
**Kinderzeit** gefragt. `kontext.holen` verwehrt `127.0.0.0/8` und die eigenen
LAN-Adressen, Dateien dürfen nur unterhalb der Medienwurzel liegen.

Die vollständige Beschreibung samt Vertrag, Prüfstand und der Liste dessen, was
noch fehlt, steht in [`plugins/README.md`](../plugins/README.md). Prüfen:

```bash
node --test plugins/<kennung>/index.spec.mjs
npx tsx tools/plugin-pruefen.mjs plugins/<kennung>
```

### 4.8 Die Gesten der neuen Oberfläche

Ab Werk **aus** — eine Bedienung, die man nicht sieht, soll man eingeschaltet
haben. Eingeschaltet wird sie im Eltern-Bereich unter *Darstellung*
(fünf Zeilen) bzw. vollständig im Admin-Board (`seiten/darstellung.ts`);
gespeichert wird in `darstellung.json`, in **sieben flachen Feldern**:

| Feld | Wofür |
|---|---|
| `zweiFinger` | die Steuerung, die überall gilt |
| `playerStreichen` | Streichen über das Kissen blendet es aus |
| `playerZurueckSek` | nach so vielen Sekunden kommt es zurück (Vorgabe 10) |
| `wischGesten` | die Randgeste überhaupt |
| `wischRandBreite` | Breite des Randstreifens (Vorgabe 28 px) |
| `wischSchnellRand` · `wischSchnellFinger` | wo und mit wie vielen |

Flach mit Absicht: ein Objekt fiele bei einer feldweisen Prüfung als Ganzes
durch, und eine halb angekommene Belegung sähe aus wie Absicht.

> **Hier standen bis zum 21.08.2026 acht Felder** mit
> `wisch<Weg|Laut|Schnell><Rand|Finger>`. Das war der erste Entwurf, bei dem
> alle drei Taten am Rand hingen. Lautstärke und Player sind abgewandert
> (zwei Finger überall bzw. auf den Player selbst); `wischWegRand`,
> `wischWegFinger`, `wischLautRand` und `wischLautFinger` gibt es **nicht
> mehr**. Auf einer Box, die den ersten Stand schon hatte, stehen sie
> womöglich noch in `darstellung.json` — sie werden dort nur nicht mehr
> gelesen (das Zusammenführen im PUT nimmt Fremdes nicht weg).

| Geste | Was sie tut |
|---|---|
| zwei Finger hoch/runter | Lautstärke, der Finger bleibt am Regler |
| zwei Finger links/rechts | nächster / voriger Titel (links = vorwärts) |
| Doppeltipp mit zwei Fingern | anhalten oder weiter |
| **schnell** über den Player streichen | das Kissen geht und kommt nach 10 s (einstellbar) von selbst zurück |
| drei Finger vom Rand | das Schnellfenster |

**Warum zwei Finger und nicht der Rand:** Chromium entscheidet an den *ersten*
`touchmove`-Ereignissen, ob eine Berührung rollt. Wer erst abfängt, wenn seine
Geste feststeht, fängt zu spät ab — der Schirm rollt schon, und
`preventDefault` wird ab da ignoriert. Am Rand lässt sich das nicht früher tun
(dort liegt der Ein-Finger-Zug zum Rollen), mit zwei Fingern schon: zwei Finger
heißen in dieser Oberfläche nie „weiterrollen". Das Schnellfenster liegt
deshalb auf **drei** Fingern — auf zwei käme es bei jedem Lautstärke-Zug mit
heraus, der zufällig am Rand beginnt.

**Solange zwei Finger liegen, ist der Rahmen taub:** `body.zwei-finger` setzt
`pointer-events: none` auf den ganzen Rahmen, sonst würde aus einem Tipp ein
Klick auf die Kachel darunter, und die wischbaren Reihen zögen an
Zeiger-Ereignissen weiter, die vor den Berührungs-Ereignissen kommen.

**Die Sperre im Schnellfenster ist keine Geschmacksfrage:** Helligkeit und
Lautstärke wirken sofort, **Hörzeit und Funk gehen durch das Tor des
Eltern-Bereichs**. Eine Geste ist kein Schloss, und ein Kind findet einen Wisch
schneller, als Erwachsene glauben — wäre Funk frei, nähme es die Box aus dem
Netz; wäre die Hörzeit frei, wäre die Kinderzeit mit einem Wisch abgeschafft.

**Eine Hand hat keine drei gleich langen Finger.** Der Erkenner verlangte
zuerst, dass *alle* Finger im 28-px-Randstreifen liegen — für einen Finger
richtig, für drei unerfüllbar: Zeige-, Mittel- und Ringfinger stehen
unterschiedlich weit vor, der hinterste gut hundert Pixel weiter innen.
`wischRaenderDerHand` fragt seit dem 21.08.2026 anders: der **vorderste**
Finger muss im Streifen liegen, der hinterste in Reichweite einer Hand
(`WISCH_HAND_PX` = 160, rund 22 mm). Bei einem Finger ist das dieselbe Frage
wie vorher.

**Der linke Rand mit einem Finger:** Dort liegt auch `randwisch`, das die
eingefahrene Kategorienleiste zurückholt. Wer das Schnellfenster ausdrücklich
auf links/1 legt, bekommt es — `randwisch` steht dann zurück. Die Leiste kommt
ohnehin nach ihrer Ruhezeit von selbst; eine eingestellte Geste, die nur in den
1400 ms nach einem Blättern ausfällt, wäre dagegen unberechenbar.

Gemessen wird mit `tools/wischrand-schau.mjs` (echte Berührungen gegen
`tools/neu-vorschau.mjs`) und `tools/pruef-neu-regeln.js` (die reinen Regeln,
ohne Browser). **Achtung beim Ablesen:** Chromiums Berührungs-Nachbildung zeigt
mehrere dieser Fehler nicht (llmwiki `cdp-beruehrungen-nachzuegler`) — grün
beweist dort nichts. Zwei der vier Fehler dieser Sache lagen außerdem im
*Messwerkzeug* selbst (ideale Finger, ein verkehrtes Vorzeichen); wer hier
etwas ändert, prüfe zuerst, ob der Prüfstand die Wirklichkeit nachbaut. Alles
Weitere: llmwiki `wischgesten-vom-rand`.

### 4.9 Die Ströme: wer darf gerade Spotify?

Die Box führt **nummerierte Ströme** statt fester Rollen (`stroeme.ts`, E72).
Jeder Strom hat einen eigenen Zugang und ein eigenes Tonziel; Wiedergabe und
Mitschnitt sind zwei **Zwecke**, keine zwei Sonderfälle. Der Gedanke dahinter:
zwei Kinder, zwei Bluetooth-Lautsprecher — am 20.08.2026 an der Box gemessen,
dass ein Funkbaustein zwei A2DP-Ströme 180 s ohne Aussetzer trägt.

**Die eine Regel, die nicht verhandelbar ist:** zwei Ströme dürfen sich keinen
Zugang teilen. Ein Spotify-Konto spielt genau einen Strom; ein zweiter mit
demselben Schlüssel nähme dem ersten mitten im Stück die Musik weg. `pruefen()`
prüft deshalb nicht auf Gleichheit, sondern auf **Form** — ein Platzhalter ist
verschieden und trotzdem falsch (llmwiki `stroeme-duerfen-sich-keinen-zugang-teilen`).

**Nicht die Konfiguration entscheidet, sondern die Vergabe** (E74, `belegung.ts`).
Der Server führt ein Belegungsbuch; wer einen Strom will, fragt danach und
bekommt eine **Marke**:

| Endpunkt | Wofür |
| --- | --- |
| `POST /api/stroeme/vergabe` | `{fuer: wiedergabe\|mitschnitt}` → Strom-Nr. + Marke, oder eine Absage mit Grund |
| `POST /api/stroeme/lebenszeichen` | verlängert die Frist — und beantwortet zugleich „habe ich ihn noch?" |
| `POST /api/stroeme/freigeben` | gibt die Marke zurück |
| `GET /api/stroeme/belegung` | was gerade gehalten wird |

Die **Frist hängt am Zweck** (Mitschnitt: Minuten, Wiedergabe: Stunden — die
Zahlen stehen in `FRIST_MS` und nirgends doppelt). Eine **Reserve** hält ab Werk
einen Strom fürs Hören frei (`spotify.stromReserve`), damit Verdrängung der
Sonderfall bleibt. `soloist.service` trägt sich selbst ins Buch ein, bevor
verteilt wird — sonst vergäbe der Wirt einen Platz, auf dem schon jemand sitzt.

**Verdrängt wird durch Fragen, nicht durch Töten.** Hören hat Vorrang vor
Mitschnitt: der Wirt nimmt dem Verdrängten nur den *Eintrag* weg, der Arbeiter
merkt es am nächsten Lebenszeichen (`ok: false`) und hört von selbst auf.
Niemand schießt einen fremden Prozess ab, und eine ausgefallene Frage heißt
„ja" — ein Netzhänger soll keine halbe Aufnahme kosten. Verdrängung ist
**kein Fehlschlag**: der Titel geht auf `offen` zurück, samt dem einen Versuch,
den der Lauf gekostet hat (llmwiki `verdraengen-durch-fragen-statt-toeten`,
`pool-statt-rolle-am-strom`).

### 4.10 Die REST-Schnittstelle

Alles, was die Verwaltung kann, geht über HTTP an `mupibox-server` (Port 8200,
mit Zertifikat zusätzlich 8443). **Es gibt keinen zweiten Weg**: die Verwaltung
ist eine Angular-Anwendung ohne eigenen Zustand, jede Schaltfläche dort ist ein
Aufruf von unten. Wer die Box aus einem Skript, aus einem Plugin oder als LLM
steuern will, benutzt dieselben Endpunkte — und für den ist diese Liste
geschrieben, denn er sieht die Oberfläche nicht.

**Warum das hier bis zum 23.08.2026 fehlte:** dieses Handbuch nannte genau
sieben Endpunkte, alle sieben aus `/api/stroeme` (4.9), weil dort die *Regel*
erklärungsbedürftig war. Die anderen 188 standen nirgends. `tools/api-doku-deckung.sh`
misst das seither nach; die Probe `tools/doku-luecken-probe.sh` prüfte bis dahin
nur, was ein Mensch in der Oberfläche **sieht**.

**Und was auch diese Proben nicht finden können:** sie *zählen*. Kommt ein Name
irgendwo vor, ist die Lücke zu. Zwei Zeilen, die einander **widersprechen**,
sind für sie unsichtbar — beide Namen kommen ja vor. Dafür gibt es seit dem
23.08.2026 `tools/wiki-zwei-wahrheiten.mjs`: es stellt Wiki-Einträge nebeneinander,
deren `match:`-Muster dieselbe Frage abfangen, die einander aber nicht in
`related:` nennen. Erster Lauf: drei Paare aus 787 Einträgen, davon eines echt
(die Kachel-Marke oben). llmwiki `zaehlende-probe-sieht-keinen-widerspruch`.

**Die Gegenrichtung, und wie weit sie reicht.** Alle Wachen oben fragen: steht
der Name aus dem Code irgendwo in einem Handbuch? `tools/doku-pfade-pruefen.py`
stellt seit dem 23.08.2026 die Gegenfrage — *gibt es noch, worauf die Doku
zeigt?* —, aber nur für den **Pfad**; den Doppelpunkt dahinter schnitt sie ab.
Seit dem 24.08.2026 prüft `tools/doku-zeilenzitate-pruefen.py` auch die
**Stelle**: 201 Verweise der Form `pfad:zeile` stehen in den Handbüchern und im
Wissenspaket, viele davon als einziger Beleg einer Behauptung. Wandert der Code
— genau das misst die Pfad-Wache ständig —, bleibt der Dateiname richtig und
die Zeile zeigt woandershin. Erster Lauf: **kein Fund**, 201 geprüft, 14 nicht
entscheidbar (`streaming.ts` gibt es zweimal, `index.mjs` zehnmal; wo die
Zeilenzahl den Namensvetter nicht ausschließt, schweigt die Wache, statt zu
raten). Sie prüft, ob die Zeile **existiert**, nicht ob dort noch dasselbe
steht — das ist aus dem Text nicht ableitbar, und eine Wache, die es rät,
meldet Rauschen. llmwiki `doku-zeigt-auf-zeilen-die-wandern`.

**Und die Frage dahinter: existiert der Ort nicht nur, sondern gilt er noch?**
Alle sechzehn Wachen darüber prüfen Existenz — ein stillgelegtes Repo besteht
jede davon, der Ordner liegt ja auf der Platte. Seit dem 24.08.2026 hält
`tools/stillgelegte-orte-pruefen.py` die Handbücher und das Wissenspaket gegen
die Liste der stillgelegten Orte aus `ZUGEZOGEN.md` und rügt jeden Satz, der
einen davon **anweisend** nennt. Erster Lauf: ein Fund — Abschnitt 2 dieser
Datei (siehe dort). Gemessen 7 Nennungen in sechs Dateien, davon eine
Anweisung; nach der Korrektur 0, und `--sabotage` meldet 8 von 8 rot. llmwiki
`anleitung-zeigt-ins-stillgelegte-repo`.

**Und noch eine Ebene tiefer: der Ort stimmt — aber wie ruft man ihn auf?**
`tools/api-doku-deckung.sh` hält 199 Routen gegen vier Handbücher und liest
dabei ausschließlich den **Pfad**; ihr grep-Muster beginnt hinter dem
Anführungszeichen, das Verb steht davor und fällt weg. Die siebzehn Wachen
darüber fragen nach Existenz, keine nach dem **Verb**. Der Unterschied zählt,
weil Express auf ein falsches Verb mit `404` antwortet — derselben Antwort wie
für einen Pfad, den es nicht gibt: der Leser schließt „die Schnittstelle ist
weg", und das ist falsch. Seit dem 24.08.2026 prüft
`tools/endpunkt-verben-pruefen.py` jedes dokumentierte `VERB /api/…`-Paar gegen
die Routen des Kerns. Erster Lauf: 414 Paare, **ein Fund** — das Wissenspaket
schrieb `PUT /api/konfiguration`, der Kern kennt dort `GET` (`server.ts:5202`)
und `POST` (`:5716`). Verneinungen kommen durch, sonst rügte sie die
BACKLOG-Zeile, die festhält, dass es *kein* `PATCH /api/darstellung` gibt.
`--sabotage` meldet 6 von 6 Quellen rot. llmwiki
`doku-nennt-den-pfad-und-das-falsche-verb`.

**Und die Frage, die alle achtzehn Wachen darüber offen ließen: an WELCHEM
Namen hängt eine Route?** Sie suchten `app.` und `router.` — `sicherung.ts`
hängt seine fünf Wege an einen Router, der schlicht `r` heißt. Vier davon
standen in **keiner** der vier Ablagen, die fünfte
(`/api/sicherung/pruefen`, sie nimmt ein hochgeladenes Archiv entgegen) stand
selbst nach dem Verbreitern noch nicht drin: ihr Pfad liegt auf einer eigenen
Zeile hinter der offenen Klammer, und die Wachen lasen zeilenweise. Die
Zählung meldete währenddessen „195 von 195 genannt" — **eine Zahl, die
aufgeht, belegt nicht, dass ihre Grundmenge stimmt.** Seit dem 25.08.2026
zählen beide Wachen jeden Empfänger und lesen über Zeilengrenzen (199 Routen),
und `tools/kommentar-endpunkte-pruefen.py` stellt die Gegenfrage für die
**Kommentare**: 156 `/api/…`-Zitate liegen in `.ts`-Dateien, mehr als in den
Handbüchern, und keines war je gegen den Router gehalten. Erster Lauf: drei
Funde, alle auf Kernrouten, die mit E77 ins Plugin gewandert sind — darunter
die Begründung, warum die ARD kein eigenes Suchformular bekommt
(`server.ts:8799`). Historische Sätze dürfen tote Routen nennen, wenn sie sie
als tot ausweisen (Marker wie in `tools/doku-widerruf-probe.sh`). llmwiki
`router-unter-anderem-namen-ist-fuer-die-zaehlwache-unsichtbar`.

**Antwortform.** Schreibende Endpunkte antworten mit `{ok: true, …}` bzw.
`{ok: false, error: '…'}` und passendem Status; lesende mit dem Gegenstand
selbst. Wo die Verwaltung angemeldet sein muss, hängt an `auth.ts` — `/api/auth/state`
sagt, ob und als wer.

`server.ts` ist die Wurzel; die Sachthemen liegen in eigenen Dateien daneben
(`ton.ts`, `profile.ts`, `stroeme.ts`, `plugin-wirt.ts`, …).

**Anmeldung und Geheimnisse** (`auth.ts`, `passwort.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `POST /api/auth/login`, `POST /api/auth/logout` | Sitzung der Verwaltung |
| `GET /api/auth/state` | angemeldet? als wer? |
| `POST /api/konfiguration/passwort` | Verwaltungspasswort setzen |
| `POST /api/konfiguration/einstellungs-pin` | PIN vor den Einstellungen der Box setzen |
| `POST /api/einstellungen/pin-pruefen` | PIN prüfen — **eine Prüfung zur Zeit**, ein Parallelversuch wird abgewiesen |

**Wartungsmodus** (`server.ts`, 29.08.2026)

Solange er aktiv ist, legt die Kiosk-Oberfläche einen Sperr-Schirm über alles —
damit kein Kind dazwischenfunkt, während an der Box gearbeitet wird.

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/wartung` | `{aktiv, seit?}` — der Kiosk fragt das im Takt |
| `POST /api/wartung` | `{aktiv: boolean}` an/aus. Etwas anderes als ein Boolean gibt 400 `aktivFehlt` und lässt den Zustand unangetastet |

Der Zustand ist eine Datei (`MIXPI_WARTUNG_DATEI`, Vorgabe `/tmp/.mixpi-wartung`)
und **flüchtig mit Absicht**: ein Neustart beendet die Wartung von selbst. Der
teuerste Fehlerfall wäre die andere Richtung — ein *vergessener* Modus, der in
der Konfiguration überlebt und die Box dauerhaft sperrt, während niemand mehr
weiß, warum. Aus demselben Grund gilt eine **halb geschriebene Datei als AUS**,
nicht als Sperre: ein Schreibfehler darf die Kinder nicht aussperren, bis
jemand `/tmp` aufräumt.

> **BEHOBEN am 29.08.2026 nachmittags (gemessen am selben Tag): `POST
> /api/wartung` stand *vor* dem Anmelde-Tor**, während der Kopfkommentar das
> Gegenteil behauptete — `app.use(torBauen(…))` stand rund achtzig Zeilen
> darunter, und Express entscheidet nach Reihenfolge. `tools/wartung-tor-probe.ts`
> maß von der LAN-Seite: `POST /api/wartung` → 200 ohne Anmeldung; jeder im
> Netz hätte die Box für die Kinder sperren können. Seither steht das POST
> **hinter** dem Tor, das GET bewusst davor (der Kiosk ruft die Box je nach
> Verlinkung über ihre LAN-Adresse an; die Antwort ist ein ja/nein). In
> `OFFENE_PFADE` darf `/api/wartung` trotzdem nie: das Tor prüft nur
> `req.path` ohne Methode — ein Eintrag öffnete GET *und* POST zugleich.
> Die Probe bestätigt den Stand (Kontrolle `GET /api/dienste` → 401,
> `POST /api/wartung` → 401, `GET /api/wartung` → 200) und hängt seither in
> `tools/pruefen.sh`; die `wartung.integration.spec.ts` allein konnte den
> Mangel nicht sehen, weil `torBauen` jede Rückschleifen-Adresse durchlässt
> und supertest über 127.0.0.1 anruft.

**Medien und Werke** (`medien.ts`, `werke.ts`, `auswahl.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET/POST /api/medien`, `PATCH/DELETE /api/medien/:schluessel` | die Medienliste. **`POST` liest den Eintrag FLACH aus `req.body`** — wer ihn in `{ eintrag: … }` verpackt, bekommt 400 `unvollstaendig` und legt nichts an; llmwiki `api-medien-nimmt-den-eintrag-flach`. **Das gleichnamige *Feld* am Eintrag ist etwas anderes**: `unvollstaendig: true` markiert ein Album, dessen Mitschnitt noch läuft oder abgebrochen ist — `false` **löscht** es, statt false zu speichern (4.7) |
| `GET /api/medien/suche`, `GET /api/medien/:schluessel/andere` | suchen, Geschwister eines Eintrags |
| `GET /api/medien/verfuegbarkeit`, `POST /api/medien/verfuegbarkeit/pruefen` | was gerade spielbar ist; `geloescht` bleibt dabei unangetastet, die alte Oberfläche graut danach aus |
| `POST /api/medien/aufraeumen`, `POST /api/medien/aufraeumen/zurueck`, `POST /api/medien/doppelte/entfernen` | Aufräumlauf und sein Rückweg |
| `GET /api/werke`, `GET /api/werke/:schluessel/alben`, `GET /api/werke/:schluessel/inhalt` | Werke und ihr Inhalt |
| `GET /api/data`, `POST /api/add`, `/api/edit` | die alten Endpunkte der klassischen Oberfläche. Der Löschweg dieser Reihe ist am 19.09.2026 gefallen; gelöscht wird über `DELETE /api/medien/:schluessel` |

**Listen** (`playlist-alben.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET/POST /api/listen`, `PATCH/DELETE /api/listen/:id` | eigene Wiedergabelisten |
| `POST /api/listen/:id/titel`, `DELETE /api/listen/:id/titel/:pos` | Titel anhängen, Titel an Position löschen |
| `POST /api/listen/:id/album` | ein ganzes Album in die Liste |

**Ton** (`ton.ts`, `klangkette.ts`, `tonausgang.ts`, `daempfen.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/ton`, `POST /api/ton` | Lautstärke lesen/setzen |
| `GET /api/ton/ausgaenge`, `POST /api/ton/ausgang` | die Ziele (intern, Bluetooth, „Überall") und die Wahl |
| `POST /api/ton/ueberall` | ein Ziel in die Kombi-Senke aufnehmen oder herausnehmen (`{ziel: 'intern'\|MAC, an}`) |
| `POST /api/ton/versatz` | Laufzeitausgleich je Bluetooth-Ziel, 0–1000 ms |
| `POST /api/ton/deckel` | Obergrenze je Ziel, 0–125 % |
| `GET /api/ton/pegel`, `POST /api/ton/senke`, `POST /api/ton/quelle` | die Pegel aus PipeWire lesen, Senke bzw. Quelle setzen (0–125) |
| `GET /api/ton/klang`, `POST /api/ton/entzerrer` | Klangbild, Entzerrer an/aus samt Bändern |
| `GET /api/ton/klangwerk`, `POST /api/ton/klangwerk/neu`, `POST /api/ton/klangwerk/live` | die Klang-Plugin-Kette: Stand, Neubau, Werte am laufenden Graphen ohne Neubau |
| `GET /api/ton/klaenge`, `POST /api/ton/klang-probe` | die Klang-Dateien der Box; die Probe spielt **nur** Dateien aus dem Klang-Ordner (`klangDateiErlaubt`) |
| `POST /api/ton/daempfen` | kurzzeitig leiser |

**Profile** (`profile.ts`, `kinderzeit.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET/PUT /api/profile` | alle Profile; die Antwort streift den Passwort-Abdruck ab |
| `POST /api/profil/aktiv`, `POST /api/profil/gast` | umschalten, Gast |
| `POST /api/profil/name`, `POST /api/profil/figur`, `POST /api/profil/geburtstag` | Name (auf 40 Zeichen gestutzt), Figur, Geburtstag |
| `POST/DELETE /api/profil/passwort`, `PUT /api/profil/passwort/verwaltung` | Profilpasswort, Verwaltungsrecht |
| `GET/PUT /api/profil/merken` | Wer-bin-ich merken |
| `GET/PUT /api/profil/auswahl`, `GET /api/profil/auswahlen`, `POST /api/profil/auswahl/werk` | die Auswahl je Profil (der Gast hat keine und bekommt keine) |
| `GET/POST /api/profil/aussehen` | Aussehen je Profil; **nur was genannt wird, wird gesetzt** |
| `GET /api/figuren` | die Figuren zur Wahl — bewusst ohne Aufzählung im Code |
| `GET/PUT /api/kinderzeit` | die Regeln. **Mit `?profil=<kennung>` je Kind** (`RegelSatz.je`, seit 02.08.2026), ohne den Anhang der `standard`-Satz (die Hausregel); `regelnFuer` nimmt beim Stand den eigenen Satz, sonst `standard`. Die Antwort mit `?profil=` sagt **nicht**, ob die Regel eigen oder geerbt ist — dafür gibt es `/satz` |
| `GET /api/kinderzeit/satz` | der **ganze** Regelsatz `{standard, je}` (seit 25.09.2026). Daraus liest die Profilseite der Verwaltung, ob das gewählte Kind eigene Regeln hat, und bearbeitet genau das, was für es gilt |
| `DELETE /api/kinderzeit?profil=<kennung>` | eigene Regeln eines Kindes verwerfen — danach gilt die Hausregel (seit 25.09.2026; vorher verschwand ein `je`-Eintrag nur mit dem Kind). Ohne `?profil=` ein 400 `hausregelBleibt` |
| `GET /api/kinderzeit/stand`, `POST /api/kinderzeit/bonus`, `POST /api/kinderzeit/zuruecksetzen` | Konto, geschenkte Minuten und Tages-Reset — **immer je Kind** (`?profil=`, ohne Anhang das aktive Profil) |

**Belohnungs-Videos aus der Mediathek** (`videofreigabe.ts` + `plugins/mixpi-mediathek`, seit 20.09.2026)

Einzelne Videos der ARD Mediathek, die ein Elternteil **mit einer Anzahl** freigibt — „noch dreimal anschauen". Die Regel ist rein und geprüft (`videofreigabe.ts`, 32 Zeugen), die Ablage liegt je Profil in `profile/<kennung>/videofreigaben.json`, und das ARD-Wissen steckt **ausschließlich** im Plugin `mixpi-mediathek`. **Die Videozeit zählt NICHT auf die Kinderzeit** (Betreiberentscheidung: eine Belohnung soll nicht die Hörzeit auffressen).

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/video/freigaben` | alle Freigaben eines Profils — **auch die aufgebrauchten**, damit Eltern nachlegen können (`?profil=`, ohne Anhang das aktive Profil). Liefert `grenzen` mit (`anzahlMax` 99, `videosMax` 60, `schwelle` 0,9) |
| `POST /api/video/freigaben` | freigeben oder **nachlegen**: `{kennung, name, sendung, bild, dauerSek, anzahl}`. Ein schon freigegebenes Video bekommt die Anzahl dazu, statt eine zweite Kachel zu werden |
| `PUT /api/video/freigaben` | den **Rest** setzen: `{kennung, rest}`. `rest: 0` beendet die Freigabe, ohne die Vergangenheit (`verbraucht`) zu fälschen |
| `POST /api/video/entziehen` | `{kennung}` — eine Freigabe ganz entfernen |
| `GET /api/video/kind` | was der Kinderschirm zeigt: **nur, was noch läuft**, immer für das aktive Profil |
| `POST /api/video/start` | `{kennung}` → `{lauf, adresse, name, dauerSek, rest}`. 403 mit `grund` (`unbekannt`/`aufgebraucht`), 404/502 wenn die ARD es nicht mehr hat oder das Plugin aus ist. **Der Start verbraucht nichts** |
| `POST /api/video/gesehen` | `{kennung, lauf, anteil}` → gezählt wird **erst ab 90 %** (`schwelle`), und **je Laufkennung höchstens einmal** — ein Neuladen mitten im Video kostet sonst eine Belohnung. Antwortet 200 mit `grund` (`gezaehlt`, `zuWenigGesehen`, `schonGezaehlt`, `unbekannt`, `aufgebraucht`) |

Gesucht wird in der Verwaltung **direkt beim Plugin**: `GET /api/plugins/mixpi-mediathek/http/suche?begriff=…` und `…/http/video/<kennung>`. Der Kinderschirm erreicht diese Wege nicht (sie liegen hinter dem Tor der Verwaltung) — er bekommt die Adresse nur über `/api/video/start`, und nur, wenn die Freigabe steht.

**Interpreten und Verschmelzung** (`interpreten.ts`, `interpretenkennung.ts`, `verschmelzung.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/interpreten`, `/api/interpreten/suche`, `GET /api/interpret/:id` | die Interpretenseite |
| `POST /api/interpreten/offen`, `POST /api/interpreten/frei`, `POST /api/interpreten/abgelehnt`, `POST /api/interpreten/zuruecksetzen` | den Zustand eines Interpreten setzen |
| `GET/POST /api/interpretenkennungen`, `POST /api/interpretenkennungen/name`, `POST /api/interpretenkennungen/verweis` | Kennungen, ihr Name und ihr Verweis |
| `GET /api/verschmelzung` | die Karte „wer steckt hinter einem Schlüssel" |
| `POST /api/verschmelzung/abgleichen`, `POST /api/verschmelzung/verbinden`, `POST /api/verschmelzung/trennen`, `POST /api/verschmelzung/zuruecksetzen` | Doppelte zusammenführen und wieder lösen |

**Woran zwei Einträge als dasselbe erkannt werden** (E85/E86, `meinenDasselbe`
in `medien.ts`). Verglichen wird nicht Feld gegen Feld, sondern der **Wortsack
aus Titel UND Interpret** — denn zwei Dienste verteilen dieselben Wörter
verschieden:

> ARD Sounds führt „Quarks Science Cops" bei der Anstalt „WDR", Spotify
> „Science Cops" beim Interpreten „Quarks". Der alte Vergleich scheiterte an
> **beiden** Feldern.

Zwei Regeln, und es braucht beide: der kleinere Wortsack muss ganz im größeren
stecken (das trennt „Greatest Hits/Alpha" von „Greatest Hits/Beta"), und der
kürzere Titel muss den längeren zur Hälfte decken — ohne diese zweite Regel
risse die erste die eigenständige WDR-Sendung „Quarks" mit.

**Wie streng verglichen wird, ist einstellbar** (`mupibox.abgleichStufe`, Feld
`abgleichStufe` im Bereich *Medien* der Verwaltung):

| Stufe | Verhalten |
| --- | --- |
| `streng` | nur gleiche Titel — der Stand vor E85 |
| `normal` | Vorgabe; erkennt auch vertauschte Felder |
| `locker` | findet mehr Paare, fasst dabei auch „Quarks" und „Quarks Science Cops" zusammen |

Sie ändert **nichts von selbst**: der Abgleich läuft nur auf Knopfdruck, und
`getrennt` („das ist NICHT dasselbe") schlägt **jede** Stufe.

**Was die verschmolzene Kachel beschriftet** ist eine ANDERE Frage als, womit
sie spielt. Zum Abspielen gilt `lokal → jellyfin → spotify` (Absicherung gegen
Ausfall); zum **Beschriften** gilt `METADATEN_REIHENFOLGE`, also
`spotify → jellyfin → lokal` — dort gibt es keinen Ausfall, und Spotify ist die
gepflegteste Quelle. Die **Identität** (`schluessel`) wandert dabei nie mit;
an ihr hängen Verlauf, Weiterhören und Favoriten.

**Diese Reihenfolge entscheidet aber nur die *Bevorzugung*, nicht das
Ergebnis** (E95 Stufe 1, 29.08.2026). `GET /api/werke/:schluessel/inhalt` holt
ohne `quelle=`-Wunsch **alle** Quellen der Gruppe **parallel** und lässt
`waehleInhalt()` (`verschmelzung.ts`, reine Funktion) wählen: erst eine Antwort
mit `vollstaendig`, sonst **die mit den meisten Titeln**, und wenn keine
geantwortet hat, den Fehler der bevorzugten Quelle. Der Grund steht am
Messfall: ein Album, das **lokal** führt, dessen Mitschnitt-`playlist.m3u` aber
nur einen Teil trägt — vorher gewann der erste Erfolg, und die Box zeigte nur
die aufgezeichneten Stücke. Damit die Titelzahl-Regel überhaupt greift,
behauptet der lokale Zweig **kein `vollstaendig`** mehr: die m3u ist der
möglicherweise lückenhafte *Bestand*, nicht das Album. **Mit** `quelle=` gibt
es weiterhin keinen Rückfall. Die vier weiteren Stufen (Befund-Vertrag,
Titel-Merge, Warteschlangen-Vertrag, Weiterhören) sind Plan — llmwiki
`e95-stufenplan-titelweise-quelle`.

**Spotify** (`spotify-web.ts`, `spotify-maschine.ts`, `streaming.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET/POST /api/spotify/config`, `POST /api/spotify/validate` | Zugangsdaten setzen und prüfen |
| `GET /api/spotify/album/:albumId`, `GET /api/spotify/artist/:artistId`, `GET /api/spotify/artist/:artistId/albums` | Durchreiche zur Web-API |
| `GET /api/spotify/playlist/:playlistId`, `GET /api/spotify/playlist/:playlistId/tracks`, `GET /api/spotify/show/:showId`, `GET /api/spotify/show/:showId/episodes` | dito |
| `GET /api/spotify/audiobook/:audiobookId`, `GET /api/spotify/episode/:episodeId`, `GET /api/spotify/search/albums` | dito |
| `GET /api/spotify/ton`, `POST /api/spotify/ton/start`, `POST /api/spotify/ton/code`, `POST/DELETE /api/spotify/ton/geraetecode` | der Anmeldeweg über Gerätecode |
| `GET /api/spotify/bereit`, `/laeuft`, `/quelle` | Zustand |
| `GET/PUT /api/spotify/maschine` | welche Maschine spielt |
| `POST /api/spotify/warteschlange` | anhängen |

**Jellyfin** (`jellyfin-durchreiche.ts`, `jellyfin-schnellverbindung.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/jellyfin/adresse-pruefen`, `GET /api/jellyfin/suchen` | Server finden, Inhalt suchen |
| `GET/POST/DELETE /api/jellyfin/schnellverbindung`, `POST /api/jellyfin/schnellverbindung/pruefen` | Anmeldung per Schnellverbindung |
| `GET /api/jellyfin/strom/:kennung`, `GET /api/bild/jellyfin/:kennung` | Tonstrom und Bild durchreichen |

**ARD-Audiothek** (`ard.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/ard/sammlungen` | die Einstiege |
| `GET/POST /api/ard/vorspann`, `POST /api/ard/vorspann/alle`, `POST /api/ard/vorspann/messen` | den Vorspann einer Folge messen und überspringen |

**Plugins** (`plugin-wirt.ts`, `plugin-vertrag.ts` — ausführlich in `plugins/README.md`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/plugins` | die installierten Erweiterungen |
| `PUT /api/plugins/:kennung/aktiv` | ein- und ausschalten |
| `GET/PUT /api/plugins/:kennung/einstellungen` | die Einstellungen einer Erweiterung |
| `GET /api/plugins/:kennung/befinden`, `GET /api/plugins/:kennung/icon` | Zustandsmeldung, Symbol |
| `POST /api/plugins/:kennung/aktion/:aktion` | eine vom Plugin angebotene Handlung auslösen |
| `POST /api/plugins/spielen` | Plugin-Inhalt abspielen (E87) |

**Netz und Funk** (`netzwerk.ts`, `funk.ts`, `bluetooth.ts`, `vpn.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/funk`, `POST /api/funk/wlan`, `POST /api/funk/bluetooth`, `POST /api/funk/flug` | die Funkbausteine einzeln und der Flugmodus |
| `GET /api/netzwerk`, `GET /api/netzwerk/scan` | Stand und Umschau |
| `POST /api/netzwerk/verbinden`, `POST /api/netzwerk/bestaetigen` | verbinden und die Verbindung bestätigen (sonst fällt sie zurück) |
| `POST /api/netzwerk/wps`, `POST /api/netzwerk/wlan` | WPS, WLAN-Zugangsdaten |
| `GET /api/netzwerk/gespeichert` | die Netze, deren Passwort die Box schon hat — mit ihrer wpa_supplicant-Kennung (E115) |
| `POST /api/netzwerk/gespeichert/verbinden` | auf ein gespeichertes Netz umschalten, **ohne Passwort** (`{kennung}`); dieselbe Rückfall-Sicherung wie beim Verbinden mit Passwort |
| `POST /api/netzwerk/gespeichert/vergessen` | ein gespeichertes Netz samt Passwort entfernen (`{kennung}`); das *aktuelle* Netz wird mit 409 abgelehnt |
| `GET /api/netzwerk/watchdog` | die Wache über die Verbindung |
| `GET /api/vpn` | der VPN-Heimweg (E30): Werkzeug/Kern da?, Beschreibung der Verbindung **ohne Geheimnisse**, Einheit, Handschlag-Urteil (`steht`/`stand`/`nie`) |
| `POST /api/vpn/konfiguration` | eine WireGuard-Datei (FRITZ!Box-Export) übernehmen — geprüft: Volltunnel und PostUp-Zeilen abgelehnt, DNS gestrichen, Keepalive ergänzt; liegt danach als root-eigenes `/etc/wireguard/wg0.conf` |
| `POST /api/vpn/aktiv` | Tunnel schalten: `{an}` sofort, `{beimStart}` fürs Hochfahren — zwei getrennte Schalter; ohne Konfiguration 409 |
| `DELETE /api/vpn/konfiguration` | anhalten, Autostart weg, Datei samt Schlüssel weg |
| `GET /api/netzlaufwerk` | das Netzlaufwerk (E28/N6-N9): welche Einhängewerkzeuge da sind (`werkzeuge.smb` = cifs-utils, `werkzeuge.webdav` = davfs2), die hinterlegte Freigabe **ohne Passwort**, Zustand der `.automount` und — davon getrennt — ob gerade wirklich etwas eingehängt ist |
| `POST /api/netzlaufwerk/konfiguration` | eine Freigabe übernehmen — `art: 'smb'` (Adresse + Freigabename) oder `art: 'webdav'` (eine vollständige `adresse`, ohne Anmeldedaten darin, ohne `?` und `#`). Geprüft in `netzlaufwerk.ts`: keine Steuerzeichen und kein `%` in den Werten (sonst verbögen sie die Einheit), Einhängepunkt nur unter `/mnt/`. Legt `.mount` (**ohne** `[Install]` — hängt nie beim Start ein) und `.automount` nach `/etc/systemd/system` und die Zugangsdaten nach `/etc/mupibox/nas-zugang` |
| `POST /api/netzlaufwerk/konfiguration` (Zertifikat) | Bei WebDAV über https misst die Box vorher den TLS-Handschlag. Zeigt der Server ein selbstsigniertes Zertifikat (im Heimnetz der Normalfall), antwortet sie **409** mit dem SHA-256-Fingerabdruck und dem Aussteller, statt es still anzunehmen oder stumm zu scheitern — erst ein zweiter Aufruf mit `zertifikatVertrauen: true` legt es ab |
| `POST /api/netzlaufwerk/pruefen` | die ehrliche Probe: eine Datei schreiben und wieder wegnehmen — „Einheit aktiv" beantwortet die Frage nicht, eine Freigabe kann erreichbar und trotzdem nur lesbar sein |
| `POST /api/netzlaufwerk/spiegeln` | `{an}` — sollen die Sicherungsstände zusätzlich dorthin (E29/B4)? Die Karte bleibt der Rückweg ohne SSH |
| `DELETE /api/netzlaufwerk/konfiguration` | aushängen, Autostart weg, beide Einheiten weg, Zugangsdatei weg |
| `GET/POST /api/wlan-adapter`, `GET/POST /api/bt-adapter` | welcher Adapter benutzt wird |
| `GET /api/bluetooth`, `POST /api/bluetooth/suche`, `POST /api/bluetooth/:mac/:aktion` | Geräteliste, Suche, Koppeln/Trennen/Vergessen |

**System, Dienste, Protokolle** (`system.ts`, `dienste.ts`, `protokolle.ts`, `leistung.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/system`, `GET /api/system/verlauf` | Zustand und Verlauf der Box |
| `POST /api/system/:aktion` | die freigegebenen Systemhandlungen — die Freigabe prüft mit `Object.hasOwn`, nicht mit `in` |
| `POST /api/reboot`, `POST /api/shutdown` | neu starten, ausschalten. Ein dritter Weg zum Abschalten des Schirms (xset dpms) ist am 19.09.2026 gefallen — ohne Rufer; geregelt wird der Schirm über `GET/PUT /api/schirm/helligkeit` und `mupi_check_monitor` |
| `GET /api/dienste`, `POST /api/dienste/:name/:aktion` | systemd-Units der Box |
| `GET /api/protokolle`, `GET /api/protokolle/datei/:id`, `GET /api/protokolle/dienst/:name` | Protokolle; ein Name von außen wird nie ohne Freigabe zum `journalctl`-Argument |
| `GET /api/leistung`, `GET /api/monitor` | Auslastung |
| `GET /api/schrauben`, `POST /api/schrauben/:id` | die Systemschrauben (z. B. Journal auf Platte, beim Start aufs Netz warten) — jede mit Titel, Hinweis und **erlaubter Werteliste**; ein Wert außerhalb wird abgewiesen |
| `GET/PUT /api/schirm/helligkeit` | Displayhelligkeit |
| `GET /api/aktualisierung` | steht ein Update an? Das Verzeichnis kommt aus `/etc/mupibox/mixpi-update.json`; die Umgebung schlägt die Datei nur, wenn sie gesetzt ist. Gelesen wird bei **jeder** Anfrage — eine Einstellung, die erst nach einem Dienstneustart wirkt, ist auf einer spielenden Box keine |
| `POST /api/aktualisierung/einspielen` | den Zieher starten (`{erzwingen?}`). Antwortet `{gestartet:true}`, **nicht** „hat geklappt": `mixpi-zieher.py --einspielen` startet am Ende `mupibox-server.service` neu — also genau diesen Prozess. Deshalb hängt der Lauf über `systemd-run` in einer **eigenen** Unit (`mixpi-zieher-lauf`), die den Serverneustart überlebt. Ein zweiter Lauf wird mit `409 laeuftSchon` abgewiesen: zwei Läufe im selben Baum überschrieben sich den Rückweg |
| `GET /api/aktualisierung/lauf` | der Verlauf des laufenden bzw. letzten Einspielens, fortlaufend vom Zieher nach `MIXPI_LAUF_BERICHT` geschrieben. Die Oberfläche liest ihn im Sekundentakt und übersteht damit, dass der Server zwischendurch weg ist. Kein Bericht ist kein Fehler (`{da:false}`) |
| *(gefallen am 19.09.2026)* | Hier standen zwei Wege ohne Rufer: Browsermeldungen ins Journal (die Oberfläche, die sie schickte, ist mit E118 gegangen) und Schirmbild per Telegram (die Telegram-Skripte machen `scrot` selbst). Beide Namen stehen samt Begründung in `server.ts` an ihrer alten Stelle |

**Sicherung und Rückspielen** (`sicherung.ts`, Bedienung in 6.5)

Diese fünf Wege standen bis zum 25.08.2026 in **keinem** Handbuch, und keine
Wache hat sie vermisst: `sicherung.ts` hängt sie an einen Router namens `r`,
und sowohl `tools/api-doku-deckung.sh` als auch
`tools/endpunkt-zitate-pruefen.py` suchten nur nach `app.` und `router.` — die
Zählung meldete „195 von 195 genannt" über eine Fläche, die sie nicht sah.
llmwiki `router-unter-anderem-namen-ist-fuer-die-zaehlwache-unsichtbar`.

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/sicherung` | welche Stände liegen da, und ist die Liste lesbar |
| `POST /api/sicherung/anlegen` | einen Stand erzeugen **und herunterladen** — `POST` obwohl Download, weil ein Passwort mitkommen kann (`mitZugangsdaten`) und ein Passwort nie in eine Adresse gehört |
| `GET /api/sicherung/stand/:name` | einen **vorhandenen** Stand holen (die von Zeitgeber und Pfad-Wachhund) — wer gerade etwas kaputt gemacht hat, will den von *vorher* |
| `POST /api/sicherung/pruefen` | Schritt 1: das hochgeladene Archiv (`express.raw`) ansehen und melden, was passieren **würde**; gibt die `kennung` für Schritt 2 |
| `POST /api/sicherung/zurueckspielen` | Schritt 2: einspielen — nur mit der `kennung` aus der Vorschau, nie in einem Zug |

Davor hängt ein eigener Riegel (`r.use('/api/sicherung', …)`): `cross-site`
wird abgewiesen und `Access-Control-Allow-Origin` entfernt. Er nimmt nichts
weg — der Herkunftsriegel (`herkunft.ts`) zieht dieselben Striche seit dem
07.08.2026 schärfer.

**Worauf der Herkunftsriegel sich verlässt.** Er sieht nur, was durch Express
geht. Websockets und Eventstreams gehorchen CORS nicht; ein Draht, den die Box
**anbietet**, ginge an ihm vorbei und müsste seine Herkunft selbst prüfen. Die
Box bietet keinen an — das ist die Voraussetzung, unter der der Riegel
vollständig ist, und sie stand bis zum 25.08.2026 nur als datierter Satz im
Kopf von `herkunft.ts` („am 07.08.2026 nachgesehen: kein `ws`"). Am 22.08.
kam mit **E75** ein `ws` dazu: `server.ts` hängt sich an Soloists
`ws://`-Draht auf der eigenen Box. Der geht **hinaus** — eine fremde Seite
kann ihn nicht auslösen, der Riegel muss ihn nicht sehen — aber die Messung,
auf die der Satz sich berief, stimmte 18 Tage lang nicht mehr.

`tools/herkunft-annahme-probe.py` misst die Annahme jetzt bei jedem Lauf der
Doku-Probe: kein angebotener Draht in den Quellen des Backends (kein
`WebSocketServer`, kein `upgrade`-Horcher, kein `text/event-stream`), und
jeder **ausgehende** mit Grund in der Liste `AUSGEHEND`. Ein neuer ausgehender
Draht wird damit nicht verboten, sondern vorgelegt — genau das, was am 22.08.
niemand tat. Gebaut wird nur gegen Quellen: `src/deploy/server.js` ist ein
Bau-Ergebnis und bündelt fremde Bibliotheken mit.

**MuPiHAT** (`hat.ts`, `hatdiagnose.ts`, `akkustand.ts`, `akkuverlauf.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/mupihat`, `GET /api/mupihat/diagnose` | Hardware-Stand und Diagnose |
| `GET/POST /api/mupihat/batterie` | Akkustand, Lernlauf anstoßen |
| `GET /api/mupihat/verlauf` | die Kurve |
| `GET/DELETE /api/mupihat/protokoll`, `GET /api/mupihat/protokoll.:format`, `POST /api/mupihat/protokoll/messen` | das Messprotokoll lesen, ausgeben, verwerfen, neu messen |

**Wiedergabe und Spielstand** (`spielstand.ts`, `weiterhoeren.ts`, `gespielt.ts`, `verlauf.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/resume`, `/api/activeresume`, `POST /api/addresume`, `/api/editresume` | Wiedereinstieg |
| `GET/POST /api/weiterhoeren` | Weiterhören |
| `GET/POST /api/gespielt`, `GET /api/verlauf` | was gespielt wurde |
| `GET/POST /api/schlummer` | Schlummer. Das Albumende hat seit dem 19.09.2026 keinen Endpunkt mehr (er hatte keinen Leser): `albumstop.json` lesen der Abspieldienst und `albumstop.sh` direkt |

**Darstellung und Oberfläche** (`aussehen.ts`, `farbthema.ts`, `themen.ts`, `oberflaeche.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET/PUT /api/darstellung`, `GET/PUT /api/farbthema` | Darstellung und Farbthema |
| `GET /api/oberflaeche/stand`, `POST /api/oberflaeche/neuladen` | welche Oberfläche läuft, neu laden |
| `GET /api/bild/:schluessel`, `GET /api/bild/extern` | Bilder |

**Vorlesen** (`vorlesen.ts`)

| Endpunkt | Wofür |
| --- | --- |
| `GET/PUT /api/vorlesen` | Stand und Einstellungen |
| `GET /api/vorlesen/sprich`, `GET /api/vorlesen/silben` | sprechen, Silben |
| `POST /api/vorlesen/stimme`, `DELETE /api/vorlesen/stimme/:id` | Stimmen verwalten |

**Spiele** (`spiele.ts`, eigene Datei `config/spiele.json` seit 20.09.2026)

| Endpunkt | Wofür |
| --- | --- |
| `GET/PUT /api/spiele` | vier Schalter: `an` (der ganze Spielbereich), `vorlesen` (spricht er?), `spiele` (je Spiel der Spielecke einer), `apps` (je Tipp-App der Schublade einer). `GET` legt zusätzlich `werke` und `appWerke` bei — die Listen, die diese Box kennt; `PUT` nimmt sie nicht entgegen und speichert sie nie |

**Die Box hat zwei Spielorte**, und beide hängen an dieser einen Datei:

| Ort | Bedienung | Liste | Wo es läuft |
|---|---|---|---|
| Spielecke | Controller, Vollbild | `spiele` | `NewDesign/app.js` |
| Schublade | Finger, neben den Kategorien | `apps` | `NewDesign/apps.js` |

Für einen Betreiber ist das **eine** Frage („was darf mein Kind spielen?"),
deshalb stehen beide auf der Spiele-Seite. Dass `memory` in beiden Listen
steht, ist kein Fehler: die Schubladen-App zeigt Bilder aus der Bibliothek und
will einen Finger, „Paare" in der Spielecke zeigt Formen und will ein
Steuerkreuz. Die Fächer sind getrennt.

**Jede Liste steht an drei Orten**, und das ist Absicht: in
`src/backend-api/src/spiele.ts` (`SPIELE_WERKE` / `APP_WERKE` — die Wahrheit;
der Server wirft beim Normalisieren jede Kennung weg, die dort nicht steht), in
der Oberfläche (`SPIEL_ORDNUNG` in `app.js`, `SCHUBLADE_APPS` in `apps.js`) und
in `tools/neu-vorschau.mjs` (die Attrappe soll ohne gebauten Server auskommen).
Die **Kennung ist der Speicherschlüssel** der Einzelschalter; laufen die Listen
auseinander, lässt sich ein Spiel nicht mehr abschalten oder ein Schalter zeigt
auf nichts — beides ohne Fehlermeldung. Dagegen wacht
`tools/spiele-liste-deckung.py` (in `tools/pruefen.sh`).

**Die Richtung des Zweifels ist je Schalter eine andere**, und nur der
Unterschied erklärt sie: `an` und die einzelnen Spiele gelten bei `!== false`
als eingeschaltet (eine vorhandene Funktion darf ein neuer Schalter nicht
wegnehmen — auch ein Spiel, das die Datei von gestern noch nicht kannte, ist
an), die Stimme dagegen nur bei `=== true` (eine Box, die nach einem Update
ungefragt zu sprechen anfängt, wäre eine Änderung und keine Einstellung).

**Der Schalter der Schublade wirkt im Lauf**, nicht erst beim nächsten
Kiosk-Start: `schubladeBauen()` steigt bei gleicher Werkliste früh aus und
weiß von einem Schalter nichts, deshalb ruft `spielbereich.laden()` es bei
einer Änderung ausdrücklich noch einmal (dieselbe Falle wie beim Vorlese-Modus
und dem Eintrag „Lesen"). Gemessen wird das in
`tools/spiele-schalter-schau.mjs`, **ohne Seitenaufbau** — ein Abschalten, das
erst nach einem Neustart ankommt, rutschte sonst durch.

**Sonstiges**

| Endpunkt | Wofür |
| --- | --- |
| `GET /api/config`, `GET/POST /api/konfiguration` | die `mupiboxconfig` (Felder: `konfiguration.ts`) |
| `GET /api/musikdienste`, `GET /api/streaming` | die verfügbaren Quellen. Der alte Sonos-Erbe-Weg ist am 19.09.2026 gefallen — sein einziger Rufer war die curl-Lebendprobe des Installer-Rezepts, die jetzt `GET /api/config` fragt und die Antwort prüft |
| `GET /api/rssfeed` | Podcast-Feed einlesen |
| `GET/POST/DELETE /api/messung`, `GET/POST /api/messung/modus` | die Messläufe |
| `GET /api/network`, `GET /api/wlan` | die alten Netz-Endpunkte der klassischen Oberfläche |

### 4.11 Die Ablage: wo der Bestand der Box liegt

Die Box hat **keine Datenbank**. Ihr gesamter Bestand — die Bibliothek, die
Kinder, die gemerkten Stellen, jede Einstellung — liegt als JSON-Dateien in
zwei Bäumen:

| Baum | Auf der Box | Was darin liegt |
| --- | --- | --- |
| `etc/mupibox` | `/etc/mupibox` | `mupiboxconfig.json`, zwei Adapterwahlen (`bt-adapter`, `mixpi-wlan-adapter`) und die Tastenzuordnung `fernbedienung.json` (E134/E137 — die Arbeit des Betreibers, darum in der Sicherung und von beiden Ausrollwegen nur mit `cp -n` angelegt). Daneben liegt `fernbedienungen/` mit den **Geräteprofilen** (Vorbelegungen + SVG-Schemata je Gerätesorte) — das sind **ausgelieferte** Daten aus `config/fernbedienungen/`, sie werden beim Ausrollen überschrieben und darum nicht gesichert. Der Server liefert sie als `GET /api/eingabegeraete/profile` (Liste) und `GET /api/eingabegeraete/profil/:id/schema` (das SVG) aus |
| `server/config` | `/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config` | alles andere |

Beim Entwickeln ohne Box ist die zweite Wurzel `./server/config` relativ zum
Arbeitsverzeichnis; `MUPIBOX_CONFIG_DIR` verschiebt sie (`server.ts`,
`configBasePath`).

**Die maßgebliche Liste steht nicht hier.** Sie steht als `HINEIN` in
`scripts/mupibox/mupibox-sicherung.py` — von Hand geführt, jede Zeile mit
Begründung, und die einzige Stelle, die entscheidet, was einen Kartenschaden
überlebt. Wer eine Ablage hinzufügt und sie dort nicht einträgt, hat eine
Datei gebaut, die es nach dem Zurückspielen nicht mehr gibt; das ist mit
`profile.json` (07.08.2026) und `plugin-einstellungen.json` (15.08.2026)
zweimal genau so passiert. `tools/ablage-doku-deckung.sh` hält diese Aufzählung
gegen die Liste.

**Box-weit** (`server/config/`)

| Datei | Was darin steht |
| --- | --- |
| `data.json` | **die Bibliothek** — das ist die Box. `active_data.json` ist ein Verweis darauf bzw. auf `offline_data.json` |
| `offline_data.json` | die Ersatzbibliothek ohne Netz; `check_network.sh` legt den Verweis um |
| `resume.json` | gemerkte Stellen. Seit E18/S3 nur noch **Brücke** — der Inhalt liegt je Kind. `active_resume.json` ist wieder der Verweis |
| `offline_resume.json` | die Gegenstücke ohne Netz, von `check_network.sh` und `get_network.sh` per `jq` erzeugt |
| `profile.json` | das **Verzeichnis der Kinder**: Kennung, Name, Figur, wer dran ist. Die einzige Stelle, an der ein Kind überhaupt existiert |
| `darstellung.json` | die **Themen** (Farbsätze — die gehören der Box, ein Kind das eines baut teilt es) und `aktuell` als **Rückfall** für Profile ohne eigene Wahl. Steht **auch** je Kind (siehe unten), und zwar als einzige Ablage in beiden Tabellen zugleich: sie ist die einzige, die beim Start **nicht** umzieht (`OHNE_UMZUG` in `server.ts`, begründet in `profile.ts`). Wer diese Datei für überflüssig hält, weil „alles je Kind liegt", nimmt allen Kindern die Paletten |
| `kinderzeit.json` | der **Regelsatz**, `{standard, je}` — die Hausregel und, unter `je.<kennung>`, die Ausnahme eines einzelnen Kindes (seit 02.08.2026, `regelnFuer()`). **Nicht** die Zeitkonten: die liegen je Kind in `kinderzeit-verbrauch.json`. Box-weit mit Absicht — je Bereich abgelegt fände `regelnFuer()` die Hausregel nicht mehr (`profile.ts`, `BEREICH_ABLAGEN`) |
| `plugin-einstellungen.json` | Adresse, Benutzer und Passwort je Plugin (geheime Felder streicht `GEHEIM`) |
| `plugin-daten/<kennung>/` | der Zustand eines Plugins. Der Wirt legt den Ordner an (`plugin-wirt.ts`, `datenWurzel`) und reicht ihn als `kontext.datenOrdner` — wer sich einen eigenen Pfad ausdenkt, ist nicht gesichert |
| `klang.json` | Equalizer, Versatz je Bluetooth-Box, Überall-Auswahl, Deckel je Ausgabe |
| `ard-vorspann.json` | wie weit welche ARD-Sendung ihren Jingle überspringt — **gemessen**, nicht ableitbar |
| `interpreten.json` | welche Zusammenlegung jemand abgelehnt oder erlaubt hat. Steht nirgendwo sonst |
| `verschmelzung.json` | die Doppelten-Seite (`/verschmelzung`) |
| `albumstop.json` | wo ein Album enden soll, je Album entschieden |
| `vorlesen.json` | Stand und Stimmen des Vorlesers |
| `verfuegbarkeit.json` | was gerade erreichbar ist |
| `network.json`, `wlan.json` | die Netz-Stände der klassischen Oberfläche |
| `nas.json` | das **Netzlaufwerk** (E28/N6-N9, E29/B4): `art` (`smb` oder `webdav`), Adresse, Freigabe, Anmeldename, Einhängepunkt und `spiegeln` — ob die Sicherungsstände dorthin gehen. **Kein Passwort:** das liegt in `/etc/mupibox/nas-zugang` (SMB) bzw. `/etc/mupibox/nas-webdav-zugang` (WebDAV, genannt von der eigenen `/etc/mupibox/davfs2.conf`), root und 0600, und geht ausdrücklich NICHT in eine Sicherung. Bei WebDAV über https steht zusätzlich `zertifikatVertraut` darin — dann liegt das Zertifikat des Servers als `/etc/mupibox/nas-webdav-cert.pem` und `trust_server_cert` schaltet jede weitere Prüfung ab; das ist mit Absicht dauerhaft sichtbar |
| `monitor.json` | ob der Schirm an ist (`get_monitor.sh`, `vcgencmd display_power`) |
| `config.json` | der Stand der `node-sonos-http-api` |
| `akkuverlauf.json` | die Messreihe des Akkus — **Beiwerk**: geht mit in den Stand, zählt aber nicht als Änderung (sonst liefe das Kontingent von 10 Ständen durch) |

**Je Kind** (`server/config/profile/<kennung>/`)

Die Liste dieser Ablagen führt `src/backend-api/src/profile.ts` als
`BEREICH_ABLAGEN`; `tools/bereich-sicherung-deckung.py` misst nach, dass sie
mit der Aufnahmeliste der Sicherung übereinstimmt.

| Datei | Was darin steht |
| --- | --- |
| `resume.json` | die gemerkten Stellen dieses Kindes — **hier** liegt der Inhalt seit E18/S3. Box-weit steht der gleichnamige Rest als **Brücke** stehen (siehe oben); wer ihn liest, sieht nicht, was ein Kind gehört hat |
| `gespielt.json` | was es gehört hat |
| `verlauf.json` | dasselbe in der neueren Form. **Nicht** `systemverlauf.jsonl` — das ist Telemetrie über die Maschine und gehört ausdrücklich *nicht* in den Stand |
| `kinderzeit-verbrauch.json` | das verbrauchte Zeitkonto |
| `listen.json` | die eigenen Listen. Seit E18/S3 hier — der Umzug beim Start lässt **nichts** box-weit zurück (anders als `resume.json`, das dort eine Brücke behält; `bereich.integration.spec.ts`, „und nichts wieder box-weit") |
| `auswahl.json` | **was dieses Kind sehen darf.** Eine leere Auswahl heißt „alles" — geht die Datei verloren, kippt das Kind still von „nur diese sechs" auf die ganze Box |
| `darstellung.json` | nur `aktuell` — **die Wahl** dieses Kindes (welcher Farbsatz, hell/dunkel, Kachelform). Die Farbsätze **selbst** liegen box-weit (siehe oben) und wandern nicht mit; wer ein Thema sucht oder bearbeitet, sucht dort. Die Datei entsteht erst, wenn jemand für dieses Profil etwas verstellt — bis dahin gilt der box-weite Rückfall (15.08.2026) |
| `videofreigaben.json` | **welche Videos der ARD Mediathek dieses Kind noch anschauen darf, und wie oft** (20.09.2026). Eine Belohnung hängt an einem Kind: Geschwister teilen sich die Box, und was das eine sich verdient hat, ist nicht das Guthaben des anderen. Geht die Datei verloren, steht „nichts freigegeben“ — und das Kind hat verloren, was es sich verdient hat. Deshalb steht sie in `BEREICH_ABLAGEN` **und** in der Aufnahmeliste der Sicherung. Die Regel dazu: `videofreigabe.ts` |

Die flachen Formen `gespielt.<kennung>.json` und
`kinderzeit-verbrauch.<kennung>.json` (E18/S1) sind seit dem 05.08.2026 nicht
mehr die laufende Form, werden aber weiter mitgesichert: eine Box, die noch
nicht neu gestartet hat, hat sie noch.

**Was ausdrücklich draußen bleibt:** der `coverspeicher` (nachladbar, ~10 MB)
und die Altlasten von Hand (`*.bak`, `*.vor-*`). Die Begründung steht je Muster
in `DRAUSSEN` derselben Datei und landet mit im Stand.

Wie ein Stand entsteht, wo er liegt und wie er zurückgespielt wird: [6.5 Die
Sicherung](#65-die-sicherung).

---

### 4.12 Die Stellschrauben ohne Maske

`/etc/mupibox/mupiboxconfig.json` ist die eine Einstellungsdatei der Box; die
ausgelieferte Fassung steht als `config/templates/mupiboxconfig.json` im Repo
und führt **108 Schlüssel** (95 bis zum 20.09.2026, dann kamen die
13 der Gruppe `nachrichten` dazu — [4.13](#413-nachrichten-an-die-box-matrix-signal-telegram)). Die meisten davon hat die Verwaltung als Feld —
sie stehen als `FELDER` in `src/backend-api/src/konfiguration.ts`, und
`tools/doku-luecken-probe.sh` hält diese Liste gegen Doku und Wissenspaket.

**Die beiden Listen sind nicht dieselbe, und das ist Absicht.** `FELDER` wächst
mit der *Verwaltung*, die Vorlage mit der *Box*. `wled.com_port` und
`mupihat.battery_types` gehören in die Datei und in keine Maske. Der Preis
dafür: für diese Schlüssel ist die Datei die einzige Bedienung — wer sie nicht
kennt, kann sie nicht verstellen. Fünfzehn standen am 25.08.2026 in keinem der
vier Handbücher und mit null Treffern im Wissenspaket. Sie stehen hier.
Gewacht von `tools/konfig-vorlage-deckung.py` (läuft in
`tools/doku-luecken-probe.sh` mit).

**Die Leitungen am GPIO** — die Nummern nennt [4.1](#41-die-laufenden-dienste)
schon, aber ohne den Hebel, mit dem man sie ändert:

| Schlüssel | Vorgabe | Was er tut | Wer ihn liest |
| --- | --- | --- | --- |
| `shim.triggerPin` | `"17"` | die Leitung des **weichen Ausschalters**. `off_trigger.sh` reicht sie als `--leitung` an `taster_wache.py` | `scripts/OnOffShim/off_trigger.sh:62` |
| `shim.cutPin` | `"27"` | die Leitung, die im Abschaltmoment **den Strom schneidet** | `scripts/OnOffShim/poweroff.sh:54` |
| `shim.ledPin` | `"13"` | das Licht im Einschaltknopf (PWM) | `scripts/mupibox/mupi_start_led.sh:199` |
| `fan.fan_gpio` | `"12"` | die PWM-Leitung des Lüfters. **Achtung:** der Kommentar daneben in `fan_control.py` sagt seit jeher „GPIO13" — das ist der Knopf, nicht der Lüfter | `scripts/fan/fan_control.py:36` |

Alle vier haben im lesenden Skript einen **Rückfall auf dieselbe Zahl**:
`poweroff.sh` schneidet auch dann, wenn `/etc` im Abschaltmoment nicht mehr
lesbar ist oder `jq` fehlt. Ein Schlüssel, der in der Datei fehlt, macht die
Box also nicht kaputt — er wirkt nur nicht.

**Die WLED-Kette.** `wled.active` ist der Schalter (der steht in der
Verwaltung); alles, was danach kommt, nicht. Ohne diese sechs Werte weiß
niemand, *wohin* gesendet wird:

| Schlüssel | Vorgabe | Was er tut |
| --- | --- | --- |
| `wled.com_port` | `"/dev/ttyUSB0"` | die serielle Schnittstelle zum WLED-Baustein |
| `wled.baud_rate` | `"115200"` | deren Geschwindigkeit |
| `wled.main_id` | `""` | die WLED-**Voreinstellung** (`ps`), die im Betrieb gesetzt wird — sobald der Kiosk steht |
| `wled.shutdown_id` | `""` | dieselbe Rolle beim Herunterfahren |
| `wled.shutdown_active` | `false` | ob beim Herunterfahren überhaupt gesendet wird (Gegenstück zu `boot_active`) |
| `wled.brightness_default` / `wled.brightness_dimmed` | `"255"` / `"128"` | hell, solange der Schirm an ist — gedimmt, sobald er ausgeht |

Gesendet wird über `scripts/wled/wled_send_data.py`, aufgerufen aus
`mupi_start_led.sh` (Start und Schirmwechsel) und `mupi_shutdown.sh`.
`mupi_start_led.sh` holt die vier Laufzeitwerte **nur bei `wled.active =
true`** — vorher waren es vier `jq`-Aufrufe je Sekunde, rund 345 000 am Tag,
auf einer Box am Akku.

**Der Rest:**

| Schlüssel | Vorgabe | Was er tut |
| --- | --- | --- |
| `mupibox.ip_control_backend` | `false` | trägt beim Start die eigene IP in die `node-sonos-http-api` ein (`setting_update.sh:49`). Bei `false` wird das Feld dort ausdrücklich **geleert** — die API hört dann nur auf localhost. Fällt `hostname -I` leer aus, kommt die Adresse aus `network.json` |
| `spotify.cachepath` | `/home/dietpi/.cache/spotify` | wohin librespot seinen Zwischenspeicher legt (`LIBRESPOT_CACHE`). Der Kern kennt denselben Pfad noch einmal als Rückfall (`server.ts`) |
| `chromium.cachepath` | `/home/dietpi/.mupibox/chromium_cache` | das Gegenstück für den Kiosk, zusammen mit `chromium.cachesize` |
| `mupihat.battery_types` | vier Einträge | die **Spannungskennlinien** je Akkutyp (`v_100` … `v_0`, `th_warning`, `th_shutdown`, in mV). `mupihat.selected_battery` wählt einen davon aus; `mupihat_bq25792.py` sucht ihn über den `name`. Wer einen eigenen Akku einbaut, ändert den Eintrag `Custom` — die Schwellen sind **gemessen**, nicht ableitbar |

---

### 4.13 Nachrichten AN die Box (Matrix, Signal, Telegram)

**Stand 21.09.2026: Backend und beide Oberflächen fertig und geprüft.** Was
unten steht, ist gebaut und in einer eigenen Vorschau (Port 8291) durchgeklickt
— Karte auf dem Kinderschirm, Wegtippen, Nachrücken der zweiten Nachricht,
Erlaubnisliste im Eltern-Bereich samt abgewiesenem Eintrag. **Auf einer echten
Box gemessen wurde es noch nicht**, und kein Weg war je mit einem echten
Dienst verbunden — wer es dort benutzt, misst nach (`tools/nachrichten-sonde.py`),
statt es zu glauben.

Telegram gibt es in diesem Baum seit Jahren, aber nur in EINER Richtung: die
Box meldet **hinaus** (`scripts/telegram/telegram_send_message.py`, Start,
Abschalten, Titelwechsel). Die Gegenrichtung — jemand schreibt dem **Kind** —
gab es nie. Sie ist ein anderer Gegenstand und hat deshalb eine eigene
Konfigurationsgruppe, eigene Schalter und einen eigenen Bot.

**Der Empfänger liest nicht.** Deshalb gehört zu jeder Nachricht die
Möglichkeit, sie **vorzulesen** (Piper, dieselbe Kette wie bei den Kacheln) —
ein- und ausschaltbar **je Profil**: das eine Kind liest schon und will nicht
unterbrochen werden, das andere erführe sonst nie, dass jemand geschrieben
hat. Fehlt das Feld am Profil, gilt die Box-Vorgabe `nachrichten.vorlesen`
(dieselbe Regel wie bei `merken`).

**Wer durchkommt, steht in einer festen Erlaubnisliste.** Sie ist die
Bedingung, unter der die Sache überhaupt gebaut werden durfte: ein offener
Kanal auf einen Kinderschirm ist ein Kanal, über den ein Fremder einem Kind
etwas sagt. **Eine leere Liste heißt NIEMAND, nicht „alle".** Wer nicht
darauf steht, wird verworfen — gezählt wird, **dass** jemand geklopft hat,
sein Text wird nicht aufgehoben.

**Die vier Bausteine** — jeder für sich prüfbar, keiner mit zwei Aufgaben:

| Datei | Was darin entschieden wird |
| --- | --- |
| `src/backend-api/src/nachrichten.ts` | WAS eine Nachricht ist und WER durchkommt. Rein: kein Netz, keine Uhr, kein Dateisystem |
| `src/backend-api/src/nachrichten-holer.ts` | WIE eine Antwort der drei Dienste zu lesen ist (Adressen, Marken, Zeilenteilung) |
| `src/backend-api/src/nachrichten-ablage.ts` | WAS auf die Karte geht und was der Eltern-Bereich eintragen darf |
| `src/backend-api/src/nachrichten-dienst.ts` | die Schleifen. Alles, was mit der Welt zu tun hat — und nichts, was etwas entscheidet |

**Die drei Wege sind grundverschieden:**

* **Matrix** — `GET /_matrix/client/v3/sync`, Bearer-Token im **Kopf** (nicht
  in der Adresse: `?access_token=` ist seit Matrix v1.11 abgekündigt, und
  eine Adresse landet in jedem Fehlerprotokoll). Der Ruf **hängt** bis zu
  30 s, wenn nichts da ist — die Frist darum herum ist deshalb **länger** als
  der Long Poll, sonst baut man sich einen Dauerabbruch.
  **Verschlüsselte Räume gehen nicht:** ein `m.room.encrypted` trägt keinen
  Klartext und fällt durch. Der Raum für die Box muss unverschlüsselt sein.
* **Telegram** — `getUpdates` mit `offset`, ebenfalls Long Poll. **Ein
  eigener Bot, nicht der von `telegram.token`:** `getUpdates` liefert jede
  Nachricht **genau einmal**, und läuft daneben noch
  `scripts/telegram/telegram_receiver.py` mit demselben Token, holen sich die
  beiden die Nachrichten gegenseitig weg. Geprüft wird `from.id` (der
  Mensch), **nicht** `chat.id` — sonst öffnete eine freigegebene Gruppe jedem
  Mitglied darin den Weg zum Kind.
* **Signal** — kein HTTP-Konto. Es braucht **`signal-cli` als Dienst auf der
  Box**; der schiebt eintreffende Nachrichten als JSON-RPC-Meldungen über
  eine TCP-Verbindung (eine JSON-Zeile je Meldung), Vorgabe
  `127.0.0.1:7583`. **Der Dienst darf fehlen** — dann sagt
  `GET /api/nachrichten/stand` genau das (`signalDa: false` samt
  Einrichtungssatz), statt dass ein Schalter ANsteht und nichts passiert.

**Einrichtung von signal-cli** (nicht Teil des Ausrollwegs, Stand 20.09.2026):

```
sudo apt install -y openjdk-17-jre-headless
# signal-cli nach /opt/signal-cli entpacken
signal-cli link -n MuPiBox          # QR-Code mit dem Telefon scannen
signal-cli daemon --tcp 127.0.0.1:7583
```

**Die Schlüssel in `mupiboxconfig.json`** (Gruppe `nachrichten`, alle in der
Verwaltung unter *Melden*):

| Schlüssel | Vorgabe | Was er tut |
| --- | --- | --- |
| `nachrichten.active` | `false` | der Hauptschalter. Aus heißt: keine Schleife läuft, kein Ruf geht hinaus |
| `nachrichten.vorlesen` | `true` | die **Vorgabe** fürs Vorlesen. Ein Profil darf sie überstimmen (`nachrichtenVorlesen` in `profile.json`) |
| `nachrichten.erlaubt` | `[]` | die Erlaubnisliste: je Eintrag `weg`, `absender`, `name`. **Leer heißt niemand.** Geht über `/api/config` **nicht** hinaus |
| `nachrichten.matrixActive` | `false` | Weg Matrix an/aus |
| `nachrichten.matrixServer` | `""` | Heimserver, z. B. `https://matrix.example.org` — ohne Pfad dahinter |
| `nachrichten.matrixToken` | `""` | der `access_token` des Box-Kontos. **Geheim**, wird nie angezeigt und nie ausgeliefert |
| `nachrichten.matrixRaum` | `""` | nur aus diesem Raum (`!abc:server`). Leer heißt: aus allen Räumen der Box |
| `nachrichten.telegramActive` | `false` | Weg Telegram an/aus |
| `nachrichten.telegramToken` | `""` | der Token des **Eingangs**-Bots. **Geheim** |
| `nachrichten.signalActive` | `false` | Weg Signal an/aus |
| `nachrichten.signalHost` | `127.0.0.1` | wo der JSON-RPC-Zugang von signal-cli horcht |
| `nachrichten.signalPort` | `7583` | die Vorgabe von `signal-cli daemon --tcp` |
| `nachrichten.signalNummer` | `""` | die bei signal-cli verbundene Nummer der Box, international |

**Telefonnummern werden international verlangt** (`+49…` oder `0049…`), und
eine nationale (`0170…`) wird beim Eintragen **abgewiesen** statt umgerechnet:
welches Land gemeint ist, steht nirgends. Ein geratenes Land wäre die
Erlaubnisliste, die *manchmal* greift — die Eltern tragen die Nummer ein,
Signal meldet sie anders, nichts kommt an, und niemand sucht den Fehler bei
der Schreibweise.

**Die Wege nach draußen** (`src/backend-api/src/server.ts`):

| Weg | Was er tut |
| --- | --- |
| `GET /api/nachrichten` | die Liste (neueste zuerst), `ungelesen`, und ob für das aktive Profil vorgelesen wird |
| `POST /api/nachrichten/gelesen` | `{id}` — „hab ich gesehen". Antwortet auch dann mit 200, wenn sich nichts geändert hat |
| `DELETE /api/nachrichten` | alles weg, samt Zählung der Abgewiesenen |
| `GET /api/nachrichten/stand` | wie es den drei Wegen geht, letzter Fehlschlag je Weg, Zahl der Abgewiesenen — und ob die signal-cli-Tür offen steht (**gemessen**, nicht `systemctl is-active` gefragt) |
| `GET /api/nachrichten/erlaubt` | die Erlaubnisliste, geprüft |
| `PUT /api/nachrichten/erlaubt` | sie setzen. **Ganz oder gar nicht:** ein unbrauchbarer Eintrag lässt den ganzen Vorgang scheitern, samt Satz und Zeilennummer |
| `POST /api/profil/nachrichten-vorlesen` | `{kennung, wert}` — `true`/`false` je Kind, **`null` heißt „wieder wie die Box"** |

**Auf dem Kinderschirm** liegt die Nachricht als Karte über allem
(`NewDesign/index.html`, `#nachricht`; Logik in `app.js` bei
`NACHRICHT_TAKT_MS`). Sie geht **nicht von selbst weg** — anders als die
Meldung daneben, die nach 4,5 Sekunden verschwindet: eine Nachricht von Mama
ist kein Hinweis auf einen misslungenen Tipp, sondern das Einzige auf diesem
Schirm, das von einem Menschen kommt. Ein Tipp irgendwohin räumt sie ab und
meldet sie als gelesen; liegt noch eine dahinter, rückt sie nach. Gezeigt wird
immer die **älteste** ungelesene — in der Reihenfolge, in der geschrieben
wurde. Der Takt (5 s) läuft nur bei sichtbarem Schirm.

**Im Eltern-Bereich** gibt es die Seite *Nachrichten* (unter „Was die Box
ist", neben Netzlaufwerk): Zustand der drei Wege mit „wann kam zuletzt etwas",
die Erlaubnisliste, die Zählung der Abgewiesenen, das Vorlesen je Kind in drei
Stufen (*Wie die Box* / *An* / *Aus*) und die angekommenen Nachrichten. Die
Schalter und Zugänge selbst stehen weiterhin unter *Konfiguration → Melden* —
sie sind gewöhnliche Felder und brauchen keine eigene Maske.

**Die Ablage** liegt als `nachrichten.json` neben `profile.json`
(Ringspeicher, 50 Stück, Text auf 500 Zeichen gedeckelt). Darin stehen auch
die **Marken** je Weg — ohne sie holte die Box nach jedem Neustart alles noch
einmal und riefe das Kind zweimal.

---

## 5. Installation

### 5.1 Der Weg heute: der remote-step-installer

Der alte Monolith (`autosetup/autosetup.sh`) fror bei ~69 % ein, ohne
Abbruchmöglichkeit — und zwar am Bluetooth-Schritt (llmwiki
`mupi-bluetooth-hang`). Genau daraus entstand der Installer:

```
  SD-Karte              Controller (Laptop)         Box
  ────────              ───────────────────         ───
  sdprep  ──────────────────────────────────────→   nacktes DietPi
                                                    + agent.py (das EINZIGE,
                                                      was automatisch draufkommt)
            Rezept Schritt für Schritt  ───────→    jeder Schritt einzeln,
            ←─────── Ausgabe live (SSE) ───────     abbrechbar, mit Zeitlimit
```

**Der Agent** (`agent/agent.py`) ist reines Python-3-stdlib — kein pip, damit er
auf einer frischen DietPi läuft, auf der sonst nichts ist. Er führt einzelne
Befehle als root aus, streamt jede Ausgabezeile, killt einen hängenden Schritt
(ganze Prozessgruppe) und entfernt sich am Ende selbst.

**Die Rezepte:**

| Rezept | Schritte | Wofür |
|---|---|---|
| `mupibox.yaml` | 30 | das System: Pakete, Node, Audio, Kiosk, Netz |
| `mupibox-app.yaml` | 26 | die App: Dateien, Dienste, Konfiguration, Fernbedienung, Vorlesen |
| `perf-tune.yaml` | 9 | Startzeit und Speicher |
| `demo.yaml` | 5 | Beispiel |

**Paketfassungen werden nicht festgenagelt.** In allen Rezepten steht kein
einziges `paket=fassung`, kein `apt-mark hold`, keine `preferences.d`.
Festgelegt ist nur dreierlei, und zwar per *Artefakt*: das librespot-Binär, die
vorgebaute `deploy.zip` und Nodes Major-Fassung. Das ist eine bewusste
Entscheidung — eine internetverbundene Kinderbox braucht Sicherheitsupdates.
Sichtbar gemacht wird die Drift stattdessen: `tools/stueckliste.py` schreibt
auf, was eine funktionierende Box hatte, und der Rezeptschritt `stueckliste`
**meldet** Abweichungen, ohne sie zu verhindern.

### 5.2 Der Einrichtungsassistent (verdrahtet seit 08.08.2026; was danach offen bleibt: Abschnitt 9)

Ziel: beim ersten Start braucht niemand mehr einen Laptop.

```
  Box startet
      │
      ├─ Kabel steckt?  →  Bildschirm zeigt QR mit der Adresse
      │                     └→ Handy scannt → Assistent im Browser
      │
      └─ kein Kabel?    →  Box macht ihr EIGENES WLAN auf
                            └→ Bildschirm zeigt QR mit den WLAN-Daten
                               └→ Handy verbindet sich, Seite öffnet sich
                                  von selbst (Captive Portal)
```

Im Assistenten: WLAN einrichten (von Hand oder per WPS-Knopf), dann läuft die
Installation Schritt für Schritt mit Live-Ausgabe.

**Nach einem WLAN-Wechsel ist die Seite auf dem Handy tot** — die Box hängt dann
in einem anderen Netz. Deshalb prüft sie sich **selbst** in drei Stufen
(Adresse → Gateway → Internet) und entwarnt den Totmannschalter nur, wenn sie es
bewiesen hat. Und der Bildschirm zeigt die neue Adresse als QR-Code samt
„Verbunden mit <Netzname>", sodass man nur noch einmal hinsehen muss.

Die Bausteine liegen im Installer-Repo:

| Datei | Wofür |
|---|---|
| `remote-step-installer/tools/qr.py` | QR-Kodierer, reine Standardbibliothek |
| `remote-step-installer/tools/einrichtung-schirm.py` | der Bildschirm auf der Box |
| `remote-step-installer/tools/einrichtung-vorschau.py` | denselben Schirm ohne Box ansehen |
| `remote-step-installer/tools/einrichtung-ap.py` | eigenes WLAN + Captive Portal |
| `agent/einrichtung.html` | die Seite fürs Handy |

**Sicherheit:** Der Agent führt beliebige Befehle als root aus. Damit er ins
LAN darf, gelten drei Regeln:

1. **Harter Deckel beim Pairing** — nach 8 Fehlversuchen nimmt er auch den
   *richtigen* Code nicht mehr an. Ein bloßer Zeitzuschlag genügte nicht, weil
   jede Anfrage in einem eigenen Thread läuft und man parallel raten kann.
2. **Der Code steht auf dem Bildschirm der Box.** Damit kommt zur Kenntnis die
   körperliche Anwesenheit — das ist der eigentliche Schutz.
3. **Keine freien Befehle aus dem Browser.** Die Seite nennt einen *Namen* aus
   einer Tabelle; Werte gehen einzeln durch einen Prüfer und landen als
   Listenelemente in `argv` (`shell=False`), nie in einer Zeichenkette. Felder,
   die nicht in der Tabelle stehen, werden weggeworfen.

Ausführlich: llmwiki `pair-code-ohne-bremse-im-lan`,
`einrichtungsassistent-benannte-aktionen`, `einrichtung-ap-und-captive-portal`.

### 5.3 Was ein Ausrollweg in fremden Dateien ändert

Ein Ausrollweg legt nicht nur ab, er **greift ein**: `sed -i` in eine Datei,
die dem Betriebssystem gehört, `tee -a` an die Firmware-Konfiguration, ein
`>>` an eine Modulliste. Diese Sorte ist schlechter auffindbar als eine
Vorlage — **eine Vorlage hat einen eigenen Namen, ein Eingriff hat nur ein
Ziel**, und in einer Tabelle über Vorlagen kann er gar nicht vorkommen. Die
Wache dafür ist `tools/ausgerollte-eingriffe-deckung.py`; sie verlangt den
**vollen Zielpfad** in der Prosa, weil die Basisnamen dieser Sorte reihenweise
generisch sind (`config.toml`, `daemon.conf`, `login`).

Die Spalte *Weg* ist **gemessen, nicht fortgeschrieben** — sie kommt aus

```bash
python3 tools/ausgerollte-eingriffe-deckung.py --wege
```

Das ist kein Schmuck: die erste Fassung dieser Tabelle entstand aus einer
Wache, die zwei der vier Ausrollwege las (sie hatte ihre Wegeliste von der
Schwesterwache abgeschrieben, bevor die dazulernte). Vier Zeilen fehlten
deshalb ganz, und eine stand mit dem falschen Weg da. Wer die Tabelle pflegt,
misst nach; wer die Wegeliste ändert, ändert sie in
`ausgerollte-vorlagen-deckung.py` — diese Wache **importiert** sie von dort,
damit eine Korrektur beide heilt.

| Zieldatei auf der Box | Weg | Was der Eingriff tut |
|---|---|---|
| `/lib/systemd/system/bluetooth.service` | nur Monolith | `--noplugin=sap` an `ExecStart=` (§4.5) |
| `/etc/hosts` | nur Rezept | die `127.0.1.1`-Zeile auf den neuen Rechnernamen. `hostnamectl` schreibt nur `/etc/hostname`; bleibt in `/etc/hosts` der alte Name stehen, läuft die Namensauflösung des eigenen Rechners ins Leere und **jedes `sudo` hängt erst einmal** |
| `${BOOT_DIR}/dietpi.txt` (und `/boot/dietpi.txt`) | nur Rezept | `AUTO_SETUP_AUTOMATED=1`, damit die DietPi-Erstinstallation nicht interaktiv nachfragt (der klassische 69%-Hänger) |
| `/etc/dhcp/dhclient.conf` | nur Rezept | `initial-interval`/`backoff-cutoff`/`retry` angehängt — ohne das wartet `dhclient` nach den ins Leere gegangenen ersten Anfragen 8 und 11 Sekunden, obwohl das WLAN längst steht |
| `/var/lib/dietpi/dietpi-software/installed/chromium-autostart.sh` | nur Rezept | Kiosk-Feinschliff: `https://localhost:8200` → `http://` in **beiden** Zeilen (Probe *und* Adresse), `-background none`, Hintergrund `44afe2ff` → `000000ff`, `--hide-scrollbars`, Aufruf von `force-dsi-output.sh` |
| `/etc/pulse/daemon.conf`, `/etc/pulse/client.conf` | nur Monolith | System-Instanz, `autospawn = no` — läuft ins Leere, PulseAudio wird später entfernt (§4.5) |
| `/boot/cmdline.txt` | beide, **mit gegenläufiger Absicht** | Monolith: `tty1` → `tty3` plus `splash silent loglevel=0` — gar keine Textmeldungen, ein schwarzer Bildschirm bis zum Kiosk ist dort der Normalzustand. Rezept: `console=tty1` bleibt **absichtlich** stehen, dazu `quiet loglevel=3 logo.nologo consoleblank=0` — echte Fehler (`KERN_ERR` und schlimmer) sollen sichtbar bleiben. Wer eine Box zur Fehlersuche anstarrt, muss also wissen, welchen Weg sie gegangen ist |
| `/etc/pam.d/login` | nur Monolith | die beiden `pam_motd.so`-Zeilen auskommentiert (keine Begrüßung auf der Konsole) |
| `/etc/X11/Xwrapper.config` | Monolith **und** Rezept | `allowed_users=anybody` — sonst startet der Kiosk-X nicht als `dietpi`. Der Monolith ändert per `sed`, das Rezept schreibt die Datei neu |
| `/etc/systemd/system/getty@tty1.service.d/dietpi-autologin.conf` | **beide**, mit verschiedenem Inhalt | Monolith: `agetty --skip-login --noclear --noissue --login-options "-f dietpi"`. Rezept: schreibt die Datei neu auf schlichtes `agetty -a dietpi` (und legt vorher `.vor-kiosknutzer` daneben). Die Konsole verhält sich also je nach Weg unterschiedlich — „nur Monolith" stand hier, solange die Wache das Rezept nicht las |
| `/etc/modules-load.d/mupibox-touch.conf` | alle | `i2c-dev` und `uinput` schon beim Hochfahren statt beim ersten Start der Touch-Brücke |
| `${BOOT_CONFIG}` (`/boot/config.txt`, auf neueren Systemen `/boot/firmware/config.txt`) | alle | `dtparam=gpio=on`, `dtoverlay=gpio-poweroff,gpiopin=4,active_low=1` |
| `/opt/dietpi-dashboard/config.toml` | Monolith **und** Update | `terminal_user = "dietpi"` |

**Was daran teuer ist**, ist nicht die Zeile, sondern die Spalte *Weg*: „nur
Monolith" heißt, dass eine heute frisch aufgesetzte Box den Eingriff nicht hat
und **kein Update ihn nachträgt** — beim Ablegen einer Vorlage überschreibt der
Update-Weg einfach neu, ein Eingriff dagegen muss eigens wiederholt werden.
Dasselbe gilt gegen die Paketverwaltung: `/lib/systemd/system/bluetooth.service`
gehört `bluez`, ein Upgrade stellt die Datei ohne Rückfrage wieder her, und der
Eingriff ist still weg.

---

## 6. Betrieb

### 6.1 Welche Box ist es überhaupt?

```bash
tools/welche-box.sh
```

Adressen wechseln; eine zweite Adressliste veraltet zwangsläufig. Deshalb fragt
das Werkzeug den Bestand des Installers.

### 6.2 Alles durchmessen

```bash
sudo mupi-check
```

Rund 70 Prüfungen auf der Box. Nützliche Gruppen:

| Gruppe | Frage |
|---|---|
| `tonweg` | Kommt der Ton bis zum Lautsprecher? Welcher Funkadapter trägt ihn? |
| `umschalten` | Jellyfin → Spotify → Jellyfin, **am Lautsprecher** gemessen |
| `umschaltstress` | zehn Wechsel ohne Pause, je die Anlaufzeit |
| `spotifykette` | librespot-Fassung, Anmeldung, Geräteliste |
| `kinderzeit` | Regeln, Guthaben, Sperren |
| `browserton` | Kann der Kiosk überhaupt Ton erzeugen? |

Bei stumm oder knackend: erst `sudo mupi-check tonweg`, dann `mupi-ton --nur-weg`,
dann `bt-wechsel`. Die Reihenfolge steht in llmwiki `werkzeuge-benutzen`.

### 6.3 Protokolle

Die Dienste schreiben ins **Journal**, nicht mehr in Dateien:

```bash
journalctl -u mupibox-server -n 200
journalctl -u mupibox-player -n 200
journalctl -u librespot -n 200
```

In der Verwaltung stehen dieselben Journale unter *Protokolle*. Die alten
pm2-Dateien unter `~/.pm2/logs` sind **eingefroren** und wurden entfernt — ein
leeres Protokoll fällt auf, ein eingefrorenes nicht.

**Die drei Dateien neben den Journalen** (`src/backend-api/src/protokolle.ts`,
feste Tabelle `DATEIEN` — ein Pfad aus der Anfrage wäre ein Leseloch über das
ganze Dateisystem):

| Eintrag | Pfad | Wer schreibt |
|---|---|---|
| `idle-shutdown` | `/tmp/idle_shutdown.log` | `scripts/mupibox/idle_shutdown.sh` (Variable `LOG`) |
| `shutdown-control` | `/tmp/shutdown_control.log` | `scripts/OnOffShim/off_trigger.sh` (`LOGFILE`) |
| `chromium` | `/home/dietpi/.config/chromium/chrome_debug.log` | Chromium selbst, **nur** bei `chromium.debug=1` (`scripts/chromium-autostart.sh:98` hängt dann `--enable-logging` an) |

Beide Dateien liegen unter **`/tmp`** und sind nach einem Neustart leer. Das
ist keine Nachlässigkeit, sondern die Folge davon, wer schreibt: `off_trigger.sh`
läuft am Knopf und greift für alles Erhöhte einzeln zu `sudo`.

`/var/log/mupibox/` legt `autosetup.sh:397` an — **und danach schreibt dort nie
jemand hinein.** Bis zum 30.08.2026 zeigten die ersten beiden Einträge der
Tabelle genau dorthin; die Protokollseite antwortete für beide dauerhaft
„Protokoll nicht lesbar". Die Pfade waren beim Schreiben der Seite ausgedacht
und nie gegen die Schreiber gehalten. Wache seitdem:
`tools/protokoll-pfade-deckung.py` (hängt in `tools/doku-luecken-probe.sh`) und
ein Test in `protokolle.spec.ts`, der die Tabelle **gegen die Shell-Datei**
liest. llmwiki `protokolltabelle-ohne-schreiber`.

### 6.4 Eine systemd-Ergänzung, die nicht wirkt

systemd liest Ergänzungen in Namensreihenfolge, und die **letzte gewinnt**:
`90-x.conf` verliert gegen `nicht-blockieren.conf`, weil `9` vor `n` kommt.
`systemctl cat <unit>` zeigt, was wirklich gilt — der eigenen Datei zu glauben
ist dasselbe wie einer Attrappe zu glauben. Diagnose-Ergänzungen deshalb `zz-`
nennen. llmwiki `drop-in-reihenfolge-ueberstimmt`.

### 6.5 Die Sicherung

Es gibt **eine** Stelle, die sichert und zurückspielt:
`scripts/mupibox/mupibox-sicherung.py`, im Eltern-Bereich unter *Sicherung*.
Die fünf Endpunkte darüber (`sicherung.ts`) stehen in 4.10 unter *Sicherung und
Rückspielen* — wer aus einem Skript sichert, braucht sie; von Hand über SSH zu
gehen ist seit E29 nicht mehr der Weg.
Der Anlass war kein Platzproblem: am 04.08.2026 lagen 99 von Hand beiseite
gelegte Dateien auf der Box, 163,1 MB. Jede war richtig, als sie entstand;
weggeräumt hat sie nie jemand. Es gab keine Stelle, die sichert — also sicherte
jeder von Hand, und jeder anders.

**Drei Auslöser, absichtlich verschieden:**

| Unit | Wann | Warum gerade so |
|---|---|---|
| `mupibox-sicherung.path` | sobald sich `/etc/mupibox/mupiboxconfig.json` ändert | hängt an der **Datei**, nicht am Skript — der Update-Knopf holt sein Skript frisch von upstream und würde jeden Aufruf im Fork-Skript umgehen |
| `mupibox-sicherung.timer` | täglich 04:17 (`Persistent=true`) | Bibliothek und gemerkte Stellen ändern sich, **ohne** dass die Konfiguration angefasst wird |
| `mupibox-sicherungsprobe.timer` | sonntags 05:30, nach dem täglichen Stand | ein Rückweg, den nie jemand fährt, ist kein Rückweg |

Der Pfad-Wachhund sichert **nach** der Änderung. Was einen vor einem
`conf_update.sh` rettet, das einen Schlüssel löscht, ist deshalb nicht dieser
Lauf, sondern der **vorige** — und den gibt es nur, weil laufend gesichert wird.
`Persistent=true` ist bei beiden Zeitgebern der Normalfall, nicht die Ausnahme:
eine Kinderbox ist sonntags um 5:30 aus.

**Was hineinkommt, ist eine namentliche Liste, kein `*.json`.** Ein Muster
sammelte jede künftige Datei stillschweigend ein — auch eine mit Schlüsseln
darin. Was weder auf der Ja- noch auf der Nein-Liste steht, wird **gemeldet und
nicht mitgenommen**.

**Zugangsdaten haben zwei Lagen, und die Vorgabe ist die vorsichtige:**
*weglassen* (der Stand sagt namentlich, was fehlt) oder *verschlüsselt*
(`--anlegen --mit-zugangsdaten`, AES256-OCB in **einem** Behälter
`zugangsdaten.gpg`). Eine dritte Lage „Klartext" gibt es absichtlich nicht.
Verschlüsselt ist **nur der Behälter, nie das Archiv** — wer das Passwort
verliert, bekommt Bibliothek, gemerkte Stellen, Kinderzeit und Darstellung
trotzdem zurück, nur WLAN und die Musikdienste nicht. Ein verschlüsseltes
Gesamtarchiv nähme außerdem den Rückweg ohne SSH und der wöchentlichen Probe
ihren Gegenstand.

Warum das Passwort nicht automatisch geht: `--anlegen` läuft selbsttätig
(Zeitgeber, Wachhund, jede Auslieferung), `--von-karte` beim Booten als root —
in beiden ist **niemand da, der etwas eingeben könnte**. Ein Passwort, das sie
trotzdem erreichte, müsste auf der Box liegen, und wäre dann Theater statt
Schutz. Also: Zugangsdaten wandern nur in einen Stand, den jemand **von Hand**
angestoßen hat.

Beim Zurückspielen gilt die Umkehrung: **ein Schlüssel, der nicht zurückgeholt
werden kann, wird nie geschrieben** — auch nicht als Platzhalter. Er behält den
Wert, der gerade auf der Box steht. Sonst löschte eine Wiederherstellung genau
die Zugangsdaten, die sie aus Vorsicht nicht mitgenommen hat.

Was die Sicherung trägt — und die drei Lücken, die bleiben: llmwiki
`was-die-sicherung-nicht-traegt`.

---

## 7. Entwicklung

### 7.1 Die Leitplanke

```bash
tools/pruefen.sh --schnell   # nur die Kerntests
tools/pruefen.sh             # + Typen + alle Baue      ← vor jedem Ausliefern
tools/pruefen.sh --box       # + mupi-check auf dem Gerät
```

138 Schritte laufen immer, 7 weitere nur mit `--box` bzw. am echten Gerät
(Umzug am echten Bestand, Vorlesen, die drei E2E-Läufe, `mupi-check` und seit
09.09.2026 die Cover-gegen-Rückfallbild-Probe) — 145
insgesamt (Stand 19.09.2026, nachgezählt gegen `tools/pruefen.sh` bei
b6fe1f5b; seit 31.08.2026 zusätzlich die Wache „Fassungsvergleich-Deckung"
(`tools/mixpi-fassungsvergleich-deckung.py`, llmwiki
`dieselbe-regel-an-zwei-orten-braucht-eine-wache-quer-dazu`), die Probe „Zieher im Sandkasten"
(`tools/mixpi-zieher-probe.py`, siehe 7.7.7), die Wache „Fremdbezug" und die Wache
„Paketfrische" — beide aus dem Riegel-Lauf desselben Tages, llmwiki
`riegel-haelt-nur-wo-die-datei-auch-benutzt-wird` und
`deploy-zip-traegt-den-stand-des-letzten-handbaus` —, die Wache
„Album: Titel und ihre Herkunft" aus E112, die Wache „Quellen-Plakette sagt die
Wahrheit" aus E108 Stufe 1, die Dauerwache „Wellen-Regler wirken"
aus dem E99-Feinschliff, die Dauerwache „Größen-Regler wirken" aus E113
und die Schrittzahl-Wache selbst; davor die Ratsche
„Dienstwissen in der UI" aus E95/V, Shellcheck-Ratsche, Auslieferprobe und
Wartungs-Tor-Probe): Kerntests der beiden Backends **und der Plugins**, beide
Box-Oberflächen, die neue Verwaltung, mehrere Quelltext-Abgleiche, das
Wissenspaket, Typprüfung und die drei Baue.

> Die Zahl stand von der ersten Fassung bis zum 24.08.2026 auf **17** und war
> um 62 Schritte daneben — niemand zählt beim Lesen nach. Gewacht von
> `tools/leitplanken-zahl-pruefen.py`. Die Wache hing bis zum 31.08.2026 nur
> in `tools/doku-luecken-probe.sh` — also *hinter* dem Ereignis: Sie meldete
> die Abweichung erst beim nächsten Doku-Lauf, nachdem der Schritt längst
> eingecheckt war (so nachgetragen: 79 → 94 → 95 → 96 → 97). Seitdem hängt sie
> zusätzlich als eigener Schritt in `pruefen.sh` selbst: Wer eine
> `schritt`-Zeile hinzufügt, wird beim eigenen Lauf rot, vor dem Ausliefern.
>
> **Das hat trotzdem nicht gereicht** (nachgemessen 19.09.2026): Die **98**
> kam am 05.09.2026 herein (`6281ac5c`) und blieb vierzehn Tage stehen,
> während **14** Schritte dazukamen — der eigene Schritt war die ganze Zeit
> rot und wurde überlesen. Genau der Fall aus llmwiki
> `dauerrote-wache-ist-keine`: Wer eine `schritt`-Zeile hinzufügt, zieht
> **diese Zahl im selben Commit nach**; sonst ist der Schritt nur ein Schild,
> unter dem der nächste echte Befund verschwindet.

**Warum der Bau mitgeprüft wird** — der teuerste Stolperstein des Projekts:
`src/deploy` gehört root. esbuild kann dorthin nicht schreiben, meldet den
Fehler und gibt trotzdem „Done" mit Exitcode 0 aus. So wurde schon eine
unveränderte Datei ausgeliefert und lange gesucht. Das Skript baut an einen
eigenen Ort und **sieht nach**, ob die Datei wirklich da ist.

> **Achtung:** `auth.integration.spec.ts` endet nie von selbst. Der Lauf steht
> nach „Kerntests backend-api" still, bis man den Prozess erschlägt
> (`pkill -f "tsx --test"`); danach läuft die Prüfung normal zu Ende. Die
> gemeldete `duration_ms` misst nur, wie lange man selbst gewartet hat —
> nicht, wann der Läufer aufgibt. llmwiki
> `pruefen-sh-haengt-auf-auth-integration`.

### 7.2 Ohne Box arbeiten

| Werkzeug | Zeigt |
|---|---|
| `node tools/neu-vorschau.mjs` | die neue Box-Oberfläche unter `localhost:8299/neu/`, mit umschaltbaren Zuständen |
| `node tools/verwaltung-vorschau.mjs` | die neue Verwaltung |
| `python3 remote-step-installer/tools/einrichtung-vorschau.py` | den Einrichtungsbildschirm als PNG |

**Die wichtigste Lehre dabei:** Eine Attrappe, die dem Vertrag nicht folgt,
prüft nichts — und lügt in die falsche Richtung. Im ersten Versuch antwortete
`/player/local` mit `title`/`state`, wie man es erwarten würde; die Oberfläche
zeigte daraufhin gar keinen Player, und das sah aus wie ein Fehler in der Seite.
Wer eine Attrappe baut, **liest die Feldnamen am Quelltext ab** und schreibt die
Fundstelle daneben. llmwiki `neue-oberflaeche-ohne-box-ansehen`.

### 7.3 Testen

Der Bestand (nachgemessen 2026-09-23):

```
src/backend-api     142 Testdateien
src/frontend-box      1 Testdatei   (Nachzügler-Modul, siehe LIESMICH.md)
src/frontend-admin   27 Testdateien
src/backend-player   15 Testdateien
NewDesign/           33 Verhaltenstests (tools/e2e/neu-oberflaeche.test.mjs)
remote-step-installer  27 Testdateien für die Einrichtung (tests/*_test.py)
```

`src/frontend-box` fiel von 40 auf 1, weil die Angular/Ionic-Oberfläche mit
E118/1e (05.09.2026) **gelöscht** wurde — übrig ist ein Modul samt Spec, das
zum Zeitpunkt der Löschung in einer Parallelsitzung in Arbeit war.

Diese Zahlen stehen **nicht** zum Nachpflegen von Hand da:
`tools/readme-behauptungen-pruefen.sh` misst sie (Abschnitt 3b) und meldet,
sobald eine um mehr als ein Fünftel danebenliegt. Wer hier eine Zahl ändert,
ändert sie dort mit — sonst wird die Wache rot und man schaltet sie ab.
**Warum das hier steht:** derselbe Block war vom 03.08. bis 24.08.2026 falsch,
jede Zeile einzeln, `src/backend-api` um mehr als das Doppelte. Die Wache hatte
`51` am 23.08. in der `README.md` korrigiert — sie kannte diese Datei nicht.

**Grüne Tests beweisen nichts, solange sie nicht auch rot werden können.** Jeder
neue Test wird deshalb mutationsgeprüft: eine Zeile im Produktionscode
absichtlich umbiegen und zusehen, ob genau der richtige Test fällt — danach
`git status` gegenprüfen, dass die Mutation wirklich weg ist. Ein Test, der
nicht beißt, ist die nächste Wache, die sich selbst zufriedenstellt (llmwiki
`mupi-audio-guard-stumm`).

Bei allem, was einer **Norm** folgt, ist der Vergleich mit einer zweiten,
unabhängigen Umsetzung stärker als jeder Selbsttest. Der QR-Kodierer hatte einen
Fehler, den `zbarimg` anstandslos durchwinkte — gefunden hat ihn erst der
Vergleich Feld für Feld mit `qrencode` (llmwiki `qr-formatkopie-verkehrt-herum`).

### 7.4 Die npm-Skripte des Wurzelverzeichnisses

Die `README.md` verweist für diese Liste seit jeher hierher; bis zum
25.08.2026 stand hier keines der damals zwanzig Skripte. Sie sind ein
**npm-Arbeitsbereich** (`workspaces: src/*`) mit **drei** Bereichen —
`mupibox-backend-api`, `mupibox-backend-player`, `mupibox-frontend-admin`.

> **Drei Skripte sind am 23.09.2026 herausgeflogen**
> (`serve:`/`build:`/`test:frontend-box`), und `serve` startet seither nur noch
> die beiden Backends. Der Grund ist nicht Aufräumen: `mupibox-frontend-box`
> ist seit E118/1e **kein Arbeitsbereich mehr** (kein `package.json`), die
> Skripte liefen also und **scheiterten**:
>
> ```
> $ npm run serve:frontend-box
> npm error No workspaces found: --workspace=mupibox-frontend-box
> ```
>
> Gefunden beim Gegenlesen der README, die den Befehl anbot; die Wache
> `tools/readme-behauptungen-pruefen.sh` hatte ihn für belegt gehalten, weil
> der **Name** in `package.json` stand. Die Box-Oberfläche wird ohne Box über
> `node tools/neu-vorschau.mjs` angesehen (7.2), nicht über einen `ng serve`.
> llmwiki `readme-fuer-github-und-die-vier-toten-behauptungen`.

| Skript | Was es tut |
|---|---|
| `npm run serve` | startet `backend-api` und `backend-player` nebeneinander — **ohne die Verwaltung**, und ohne Box-Oberfläche (die läuft über `tools/neu-vorschau.mjs`) |
| `npm run serve:frontend-admin` · `serve:backend-api` · `serve:backend-player` | je ein Bereich einzeln |
| `npm run build` | baut alle drei (`--workspaces`) |
| `npm run build:frontend-admin` · `build:backend-api` · `build:backend-player` | je ein Bereich einzeln |
| `npm run test` | alle drei Bereiche **plus** `test:plugins` — siehe die Warnung unten |
| `npm run test:frontend-admin` | die Angular-Verwaltung |
| `npm run test:plugins` | `node --test plugins/*/*.spec.mjs` |
| `npm run lint` · `lint:fix` | Biome über alle drei Bereiche — seit 25.09.2026 nur die Lint-Regeln, ohne Formatierung und Import-Reihenfolge (7.5) |
| `npm run plugin:neu` · `plugin:pruefen` | Plugin-Gerüst anlegen, Manifest prüfen |
| `npm run docker:build` · `docker:start` | das Docker-Abbild aus dem Ursprungsprojekt — **bricht ab, siehe unten** |

> **`npm run test` in der Wurzel läuft nicht durch — das ist kein Fehler in
> Ihrer Umgebung.** Die Fächerung geht in `frontend-admin`, dessen eigenes
> `test` das nackte `ng test` ist: Karma bleibt im
> **Beobachtungsmodus** stehen und endet nie. Dazu braucht Karma einen Chrome,
> der hier nicht installiert ist. **Geprüft wird über `tools/pruefen.sh`** — es
> löst den Browser selbst auf (`CHROME_BIN`, notfalls das Playwright-Binary)
> und ruft `ng test --watch=false` bzw. `--configuration ci`.
>
> **Berichtigt am 25.09.2026:** Hier stand bis dahin, `npm run lint` fächere
> über alle Bereiche und npm überspringe `frontend-admin` „kommentarlos", weil
> der Bereich kein `lint` hatte. **Das war nie gemessen und ist falsch.** npm
> (nachgemessen mit 10.9.7) bricht die Fächerung mit `Missing script: "lint"`
> ab — still schweigt es nur mit `--if-present`. Der CI-Auftrag `Lint (Biome)`
> war genau daran rot, zusätzlich zu 145 Biome-Fehlern in den Backends. Seit
> dem 25.09. hat `frontend-admin` `lint` und `lint:fix`, wörtlich wie die
> Backends, und `tools/npm-skripte-deckung.py` zählt einen Bereich, dem ein
> gefächertes Skript fehlt, als Lücke. `--if-present` in der Wurzel wäre die
> kürzere Behebung gewesen — sie hätte die Verwaltung wieder ungeprüft
> gelassen.

Bis zum 25.08.2026 stand hier ein **totes Skript**: `test:frontend-api` rief
den Arbeitsbereich `mupibox-frontend-api`, den es nie gab (`npm error No
workspaces found`). Es ist jetzt `test:frontend-admin` und ruft die Verwaltung.
Der Befund stand am 03.08. in `AUDIT-2026-08-03.md` und am 23.08. nochmal in
`AUDIT-2026-08-23.md` — zweimal gefunden, 22 Tage nicht behoben. **Ein Befund
in einer Audit-Liste ist keine Dokumentation.** Gewacht von
`tools/npm-skripte-deckung.py` (läuft in `tools/doku-luecken-probe.sh`): es
hält jedes `--workspace=` gegen die wirklich vorhandenen Bereiche und jeden
Skriptnamen gegen diesen Abschnitt.

**Und genau dieselbe Leiche lag eine Ebene tiefer.** Die Wache las bis zum
26.08.2026 nur die Wurzel-`package.json` — die Bereiche haben aber eigene
Skripte, die von der Wurzel aus niemand aufruft. In `backend-player` stand
dort `build-proto`:

```
npx pbjs -t static-module -w commonjs -p proto -o src/spotify-proto.js proto/spotify/login5/v3/login5.proto
```

Der ganze `proto/`-Baum (sieben `.proto`-Dateien) und die daraus erzeugte
`spotify-proto.js` (5806 Zeilen) wurden am **26.08.2025** in `ce63e126` („Use
official spotify Playback SDK") gelöscht. Das Skript blieb stehen und bricht
seither mit `ENOENT` ab — **ein Jahr lang, von keiner Wache und keinem Läufer
berührt.** Mitgeschleppt wurden `protobufjs` und `protobufjs-cli`: beide
stehen bis heute unter `dependencies`, nicht `devDependencies`, obwohl kein
Quelltext im Baum noch das Wort „protobuf" enthält — sie werden also bei jeder
Installation mit auf die Box gezogen. Die Lehre ist dieselbe wie eine Zeile
weiter oben, nur eine Ebene tiefer: **ein Skript, das niemand ruft, verrottet
lautlos**, denn sein Fehler zeigt sich erst beim Aufruf.

Die Wache prüft seit dem 26.08.2026 deshalb zusätzlich, dass **jeder
Eingabe-Pfad jedes Skripts — in der Wurzel und in jedem Bereich — wirklich auf
der Platte liegt.** Ausgabeziele (`-o`, `--outfile=`, `--output-path=`,
`--metafile=`) sind ausgenommen, die entstehen ja erst beim Bau; Sternchen
werden als Muster aufgelöst, ein Muster ohne Treffer zählt als Loch.
`build-proto` ist der eine Fund; das Aufräumen — Skript und die beiden
Abhängigkeiten streichen — ist eine Änderung am Bau, nicht an der Doku, und
steht im `BACKLOG.md`.

**Und dieselbe Leiche noch eine Datei weiter: `npm run docker:build` bricht
seit 22 Monaten ab** (gefunden 26.08.2026). Das Skript ist
`docker build -t mupibox .` — kein Pfad mit Endung, also nichts, was die Wache
oben prüfen könnte; der tote Pfad steht in der `Dockerfile`. Zwei `RUN
cp`-Zeilen lesen aus Orten, die der Arbeitsbereichs-Umbau `5f5ea724` am
**23.10.2024** geräumt hat:

| Zeile | Liest | Der Inhalt liegt heute unter |
|---|---|---|
| `Dockerfile:74` | `$mupisrc/dev/customize/mplayer-wrapper/index.js` | `src/backend-player/src/mplayer-wrapper.ts` |
| `Dockerfile:103` | `$mupisrc/bin/nodejs/spotify-control.js` | `src/backend-player/src/spotify-control.ts` |

Ein `cp` auf eine fehlende Quelle endet mit 1, und `docker build` bricht an
dieser Schicht ab — **das Abbild ist seit dem Umbau nicht baubar**, und in
dieser Tabelle stand bis heute nur „das Docker-Abbild aus dem
Ursprungsprojekt". Von den 31 Wachen der Lücken-Probe las bis dahin **keine
einzige die `Dockerfile`**; sie ist keine Doku, kein Test und kein Skript,
sondern eine vierte Sorte Datei — eine Bauanleitung. Gewacht wird sie seit dem
26.08.2026 von `tools/abbild-pfade-pruefen.py`, und die stellt zwei Fragen
statt einer: liegt die Quelle im Baum, **und** legt überhaupt ein `COPY`
ihren obersten Ordner ins Abbild? Die zweite Frage ist die teurere: `src/`
wird gar nicht hineinkopiert (nur `autosetup`, `bin`, `config`, `dev`,
`media`, `scripts`, `themes`), wer also nur die zwei Pfade umbiegt, tauscht
„Quelle fehlt im Baum" gegen „Quelle fehlt im Abbild". Das Aufräumen ist
Arbeit am Bau und steht im `BACKLOG.md`.

### 7.5 Die CI: was ein `push` wirklich auslöst

`.github/workflows/ci.yml` läuft bei jedem `push` **und** jedem
`pull_request`. Bis zum 26.08.2026 stand darüber in keinem Handbuch ein
Wort — weder „CI" noch „GitHub Actions" kam vor. Abschnitt 7.3 zählt 200
Testdateien auf (186 unter `src/`, 14 unter `plugins/`; nachgemessen
30.08.2026) und liest sich wie eine Deckung; welche davon ein Fremder mit
einem PR wirklich auslöst, war nirgends nachlesbar.

Drei Aufträge, alle auf `ubuntu-latest` mit Node 22 und `npm ci`:

| Auftrag | Was er ruft | Was das deckt |
|---|---|---|
| `Lint (Biome)` | `npm run lint` | die Biome-Lint-Regeln in allen drei Bereichen, **blockierend** — Formatierung und Import-Reihenfolge nicht, siehe Kasten |
| `Tests + types` | `npm run check-types` (nur `backend-player`), dann `npm run test` für `backend-api` und `backend-player`, `npm run test:plugins`, dazu der Selbsttest von `tools/mixpi-github-fassung.py` und der Zieher-Sandkasten `tools/mixpi-zieher-probe.py` | die Testdateien beider Backends und aller Plugins, dazu die Fassungs-Pipeline (7.16) |
| `Build all workspaces` | `npm run build` | alle drei Bereiche mit Bau (`backend-api`, `backend-player`, `frontend-admin`); darüber läuft auch der Angular-Compiler der Verwaltung |

**Rot von der ersten Veröffentlichung bis zum 25.09.2026.** Alle drei Läufe
auf GitHub scheiterten an Lint und Bau: `src/frontend-admin/package.json`
deklarierte keine einzige Abhängigkeit (Abschnitt 7.13), ein frisches `npm ci`
hatte also kein `ng`, und `backend-api` fehlte `@types/cors` aus demselben
Grund. Auf keinem Arbeitsrechner fiel das auf — dort lag das alte
`node_modules`. Seit dem 25.09. ist beides deklariert und die Aktionen stehen
auf `actions/checkout@v7`/`actions/setup-node@v7` (Node 24 statt der
abgekündigten Node-20-Laufzeit).

**Warum `check-types` nur einmal dasteht:** `backend-api` hängt es sich selbst
vor den Bau (`"build": "npm run check-types && esbuild …"`), `backend-player`
nicht. Die eine Zeile in der CI schließt genau diese Lücke — sie ist kein
Rest, sondern die Ergänzung.

> **Was die CI *nicht* durchsetzt.** Drei Löcher, alle mit Grund; wer den
> Grund ändert, ändert diesen Kasten mit.
>
> * **`ng test` beider Oberflächen** (`frontend-box` 40, `frontend-admin` 20
>   Testdateien). Karma braucht einen Browser, den ein nackter Runner nicht
>   hat, und das ungeflaggte `ng test` endet ohnehin nie (Beobachtungsmodus).
>   Der Kommentarkopf von `ci.yml` sagt das und verweist darauf, dass der
>   `ng build` im Bau-Auftrag den ganzen Compiler durchläuft — Tippfehler und
>   Typfehler fallen also, das *Verhalten* nicht. Geprüft wird es über
>   `tools/pruefen.sh`, das den Browser selbst auflöst.
> * **Formatierung und Import-Reihenfolge — seit dem 25.09.2026 nicht im
>   Lint-Tor.** Das `lint` jedes Bereichs ruft
>   `biome check --formatter-enabled=false --assist-enabled=false`; die
>   Lint-Regeln aus `biome.json` gelten voll und blockieren. Biome meldete an
>   dem Tag 145 Fehler, davon 136 Formatierung und Import-Reihenfolge (die
>   übrigen neun sind behoben). Die Massenformatierung gehört in den internen
>   Baum, in dem parallele Sitzungen dieselben Dateien bearbeiten — von hier
>   aus gepusht, kollidierte sie mit allen (gemessen 25.09.2026: 148 Dateien,
>   +1190/−1075 Zeilen). **Der Rückweg:** im internen Baum in jedem Bereich
>   `npx @biomejs/biome check --fix .`, dann die zwei Schalter aus `lint` und
>   `lint:fix` aller drei Bereiche streichen; steht im `BACKLOG.md`. Am selben
>   Tag in einer Wegwerf-Kopie durchgespielt: danach meldet das volle
>   `biome check` in allen drei Bereichen null Fehler. Die
>   Schalter sitzen bewusst in den Skripten, nicht in `biome.json` — so
>   formatieren Editoren weiter nach den Regeln des Baums.
>
>   Davor, vom 25.09. bis zu dieser Änderung am selben Tag, war der
>   Lint-Schritt über `continue-on-error` ganz nicht blockierend. Biome ist
>   auf `2.5.11` gepinnt — mit `"*"` brachte jede neue Biome-Fassung neue
>   Regeln und damit neues Rot. `biome.json` verträgt **keine Kommentare**:
>   einer genügte, und Biome las die Konfiguration aus einem Bereich heraus
>   gar nicht mehr — ohne Fehlermeldung, mit Tabs und doppelten
>   Anführungszeichen als Vorgabe (llmwiki `lint-tor-ohne-formatierung-und-npm-ueberspringt-nicht-still`).

**Die 14 Testdateien unter `plugins/*/` liefen in keinem Läufer** (gefunden
26.08.2026). 367 Tests, alle grün, zusammen 230 Millisekunden — und niemand
rief sie:

* `npm run test` in der Wurzel ist `npm run test --workspaces && npm run
  test:plugins`. Die Fächerung bleibt in `frontend-box`/`frontend-admin` bei
  Karma im Beobachtungsmodus stehen (Abschnitt 7.4). **Das `&&` wird nie
  erreicht** — der zweite Teil ist unerreichbarer Code in einer
  `package.json`.
* `tools/pruefen.sh` ruft `plugin-geruest-probe.sh` und
  `mixpi-plugins-nachziehen-probe.sh`. Beide prüfen *etwas* mit Plugins,
  keines ruft diese 14 Dateien. Ein Namenstreffer taugt als Alibi.
* die CI ruft `test` nur für die beiden Backends.

Das ist die bekannte Bauart eine Ebene höher: nicht eine Wache hängt in
keinem Läufer, sondern eine ganze **Testmenge** (llmwiki
`wache-stirbt-still-wenn-sie-nirgends-haengt`, `testmenge-in-keinem-laeufer`).
Sie war grün, weil niemand fragte.
Seit dem 26.08.2026 ruft `tools/pruefen.sh` sie als eigenen Schritt, seit dem
25.09.2026 auch die CI (`npm run test:plugins` im Auftrag `Tests + types`).

Gewacht von `tools/ci-deckung.py` (läuft in `tools/doku-luecken-probe.sh`):
es hält jeden Auftrag und jedes `npm run` aus `ci.yml` gegen diesen
Abschnitt, in der Gegenrichtung diesen Abschnitt gegen `ci.yml`, und fragt
für **jeden** Testeinstieg des Baums, ob CI, `pruefen.sh` oder der Kasten
oben ihn nennt.

### 7.6 Ausliefern

Gebaut wird **am Entwicklungsrechner**, nicht auf der Box. Die Box bekommt
fertige Dateien (`bin/nodejs/deploy.zip`). Deshalb ist auch kein `@ionic/cli`
auf der Box nötig — er wurde aus dem Rezept gestrichen.

### 7.7 Arbeitsweise

Vier Regeln, die sich bewährt haben:

1. **Werkzeug statt Wegwerfbefehl.** Wer untersucht oder misst, schreibt eine
   benannte Datei nach `tools/` — mit einem Kopfkommentar „WOZU", der die
   *konkreten Kosten* nennt, die zu ihm geführt haben, und „WAS ES NICHT TUT".
   Ein Werkzeug kostet einmal Zeit, ein nachgebauter Einzeiler jedes Mal neu.
2. **Wiki zuerst lesen, Erkenntnisse hineinschreiben.** Vor einer Untersuchung
   nachsehen, ob die Antwort schon dasteht. Danach das Neue eintragen und die
   `version` in `pack.yaml` hochziehen.
3. **Commit-Nachrichten über eine Datei setzen** (`git commit -F`). Backticks in
   `git commit -m` führt die Shell aus.
4. **Alles Neue heißt `mixpi`** (Betreiber-Regel seit dem 21.08.2026). Neue
   Skripte, Units, Konfigurationsdateien und Plugins tragen das Präfix —
   `mixpi-wlan-adapter.sh`, `mixpi-wlan-adapter.service`, `plugins/mixpi-klang`.
   **Bestehendes aus dem Ursprungsprojekt bleibt, wie es heißt** (`mupibox-*`),
   sonst wäre jede Übernahme von dort ein Konflikt.
5. **Ein Commit, den `main` nicht hat, wirkt nirgends.** Sitzungen arbeiten in
   eigenen Bäumen unter `.claude/worktrees/` und committen dort auf einen
   eigenen Zweig; `git status` sieht immer nur den Baum, in dem man steht.
   Am 19.08.2026 lagen so drei fertige, gemessene Commits herum — der jüngste
   behob den Fehler, den die Inventur desselben Tages als „hoch" führte.
   `python3 tools/worktrees-schau.py` fragt über **alle** Bäume und trennt
   „fehlt in main" von „uncommittet". Es räumt nicht auf, mit Absicht.
   llmwiki `commit-ohne-main-wirkt-nirgends`.

### 7.8 Die Umgebungsvariablen

`src/` und `scripts/` lesen **64 Variablen** mit `MUPIBOX_`- oder
`MUPI_`-Präfix. Bis zum 25.08.2026 standen davon **drei** in einem Handbuch;
alle anderen fand nur, wer den Quelltext aufmachte — und wer überhaupt ahnte,
dass es sie gibt. `python3 tools/umgebungsvariablen-deckung.py` hält diese
Tabelle seither gegen den Quelltext.

Gelesen wird die Umgebung **immer mit Vorgabewert**. Nichts hier muss gesetzt
sein; die Vorgaben sind die Pfade der echten Box.

#### 7.7.1 Riegel und Gegenproben — die wichtigen vier

Diese vier ändern nicht *wo* etwas liegt, sondern *ob* etwas passiert. Wer am
Rand dieser Dateien arbeitet und sie nicht kennt, dreht am Gerät.

| Variable | Wirkung |
|---|---|
| `MUPIBOX_STANDWACHE_NIE_HANDELN` | **sperrt** das Handeln der Standwache (`scripts/box/mupibox-standwache.py`). Ohne diesen Riegel fährt sie wirklich herunter. Er ist absichtlich *herum gedreht* — ein Riegel, der Handeln erst *freigibt*, würde beim Verlieren eine stumme, tote Wache hinterlassen, und darauf verlässt man sich dann. **Jeder Test um diese Datei herum setzt ihn.** |
| `MUPIBOX_HERKUNFT_AUS=1` | schaltet die Herkunftsprüfung ab (`herkunft.ts`). Existiert **nur für die Gegenprobe** — der Riegel muss abschaltbar sein, damit ein Test zeigen kann, dass er sonst greift. |
| `MUPI_IDLE_NUR_FUNKTIONEN=1` | lädt `scripts/mupibox/idle_shutdown.sh` **ohne die Hauptschleife**. Ohne das läuft beim Einlesen die Abschaltlogik los. systemd setzt es nicht — dort startet die Schleife wie bisher. |
| `MUPI_OHNE_RUECKFRAGE` | überspringt die Sicherheitsabfrage in `src/deploy.sh` (greift ohnehin nur an einem Terminal). |

Dazu das eine **Geheimnis**:

| Variable | Wirkung |
|---|---|
| `MUPIBOX_SICHERUNG_PW` | das Passwort der Sicherung für Skripte. Es gibt **keinen Befehlszeilenschalter dafür**, mit Absicht: `ps` zeigt Argumente jedem Benutzer. Die Reihenfolge ist Umgebung → stdin → Nachfrage. `mupibox-sicherung.py` räumt die Variable aus der Umgebung, bevor es `gpg` startet. |

#### 7.7.2 Netz, TLS und Ports

| Variable | Vorgabe |
|---|---|
| `MUPIBOX_HTTP_PORT` | `8200` — der API-Port; `spotify-control.ts` liest ihn für das Vorlesen mit, damit eine Verschiebung nicht die Hälfte mitnimmt |
| `MUPIBOX_HTTPS_PORT` | `8443` |
| `MUPIBOX_PIPER_PORT` | `5100` |
| `PLAYER_PROXY_HOST` | `127.0.0.1` — wohin `server.ts` den Weiterreicher `/player` schickt |
| `PLAYER_PROXY_PORT` | `5005` — der Port des Wiedergabedienstes (`spotify-control.js`). Kein `MUPIBOX_`-Präfix, historisch gewachsen; siehe 7.7.6 |
| `MUPIBOX_TLS_DIR` | `/etc/mupibox/tls` |
| `MUPIBOX_NO_AUTO_TLS=1` | kein Selbstzertifikat beim Start anlegen |
| `MUPIBOX_PLAYER_TLS=1` | der Player spricht TLS — nur wirksam, wenn `cert.pem` und `key.pem` wirklich liegen |
| `MUPIBOX_SYS_NET` | `/sys/class/net` — der Ort, an dem die Schnittstellen gezählt werden |
| `MUPIBOX_FUNK_SCHALTWEG` | `ifupdown` oder `ip`. Ohne Angabe entscheidet die Anwesenheit von `/sbin/ifdown`. Übersteuerbar für den Test **und** für eine Box mit kaputtem `ifupdown` |
| `MUPIBOX_VPN_ZIEL` | `/etc/wireguard/wg0.conf` — wohin die übernommene WireGuard-Datei gelegt wird. Greift NUR außerhalb des Produktivbetriebs (Testnaht wie `MUPIBOX_CONFIG_DIR`), sonst wäre es ein Hebel, den Schlüsselablageort von außen zu verschieben |
| `MUPIBOX_VPN_SYS_MODUL` | `/sys/module/wireguard` — woran „Kern ist geladen" erkannt wird (E30/W5). Ebenfalls nur außerhalb des Produktivbetriebs |

#### 7.7.3 Wo die Dateien liegen (`backend-api`)

| Variable | Vorgabe |
|---|---|
| `MUPIBOX_CONFIG` | `/etc/mupibox/mupiboxconfig.json` |
| `MUPIBOX_CONFIG_DIR` | das Arbeitsverzeichnis der Ablage (siehe Abschnitt 4.11) |
| `MUPIBOX_MEDIA_DIR` | `/home/dietpi/MuPiBox/media` |
| `MUPIBOX_COVER_DIR` | `<CONFIG_DIR>/coverspeicher` |
| `MUPIBOX_SOUND_DIR` | `/home/dietpi/MuPiBox/sysmedia/sound` |
| `MUPIBOX_THEMES_DIR` | `/home/dietpi/MuPiBox/themes` |
| `MUPIBOX_WWW_DIR` · `MUPIBOX_ADMIN_DIR` | die ausgelieferte Box-Oberfläche bzw. die Verwaltung (`www-admin`) |
| `MUPIBOX_LOCK_DIR` | `/tmp` |
| `MUPIBOX_BACKLIGHT` | `/sys/class/backlight` |
| `MUPIBOX_PYTHON` | `/usr/bin/python3` |
| `MUPIBOX_PLAYER_CONFIG` | `…/spotifycontroller-main/config/config.json` |
| `MUPIBOX_TELEGRAM_SKRIPT` | `/usr/local/bin/mupibox/telegram_notify_screen.py` |
| `MUPIBOX_SICHERUNG_SKRIPT` | `/usr/local/bin/mupibox/mupibox-sicherung.py` |
| `MIXPI_FERNBEDIENUNG_PROFILE` | `/etc/mupibox/fernbedienungen` — die Geräteprofile (siehe 4.11); ohne Fund fällt der Server auf `config/fernbedienungen` im Arbeitsverzeichnis zurück |
| `MIXPI_INPUT_DEVICES` | `/proc/bus/input/devices` — die Quelle der Eingabegeräte-Liste, übersteuerbar für Tests ohne Box |
| `MUPIBOX_SICHERUNG_STAENDE` | `/home/dietpi/.mupibox/sicherungen` |
| `MUPIBOX_SICHERUNG_VORSPANN` | leer — Wörter, die dem Sicherungsaufruf vorangestellt werden (z. B. ein `sudo`) |
| `MUPIBOX_VORLESE_CACHE` | `/home/dietpi/.mupibox/vorlesen-cache` |
| `MIXPI_WARTUNG_DATEI` | `/tmp/.mixpi-wartung` — der Zustand des Wartungsmodus. Liegt **absichtlich unter `/tmp`**: ein Neustart beendet die Wartung, ein vergessener Modus kann die Box nicht dauerhaft sperren. Wer die Variable auf einen dauerhaften Ort zeigen lässt, kippt genau diese Sicherung um |
| `BOXNUTZER` | `dietpi` — **wem die Sitzungsdienste gehören** (`chromium-autostart.sh`). Gelesen wird daraus die uid, und daraus der Weg zum Ton: `PULSE_SERVER=unix:/run/user/<uid>/pulse/native`. Ohne diesen Export hat der Kiosk-Browser **gar keine Tonausgabe** — er läuft als root, PipeWire gehört `dietpi`, und unter `/run/user/0/` steht nichts (llmwiki `kiosk-browser-hatte-nie-ton`, 20.09.2026). Ohne `MUPIBOX_`-Präfix, weil die Datei aus der DietPi-Kette stammt und deren Schreibweise behält |

#### 7.7.4 Identität, Version und Plugins

| Variable | Wirkung |
|---|---|
| `MUPIBOX_HOST_ZUSATZ` | Komma-Liste zusätzlicher eigener Namen. Der dauerhafte Weg ist `"hostZusatz"` in der Konfiguration — die wird laufend neu gelesen, ein Neustart ist nicht nötig |
| `MUPIBOX_HERKUNFT_ZUSATZ` | Komma-Liste zusätzlich erlaubter Herkünfte |
| `MUPIBOX_UPDATE_EINSTELLUNG` | `/etc/mupibox/mixpi-update.json` — **die** Quelle des Versionsverzeichnisses. Bis zum 31.08.2026 las `server.ts` das Verzeichnis nur aus der Umgebung, `scripts/box/mixpi-zieher.py` nur aus dieser Datei: zwei Quellen für dieselbe Tatsache, und am Gerät sofort auseinandergelaufen — die Box .79 war für den Zieher vollständig eingerichtet und meldete auf der Aktualisierungsseite trotzdem „kein Versionsverzeichnis eingetragen". Wer das sieht, sucht den Fehler im Verzeichnis statt in der Verdrahtung. Jetzt gilt die Datei, und die drei folgenden Variablen schlagen sie nur, **wenn** sie gesetzt sind |
| `MUPIBOX_VERSIONSFEED` · `MUPIBOX_VERSIONSQUELLE` | das Versionsverzeichnis (`…/version.json`) und das Git-Repo dahinter. Beide leer als Vorgabe; ohne Feed meldet die Verwaltung „kein Versionsverzeichnis eingetragen" |
| `MUPIBOX_VERSIONSKANAL` | `stable` — welcher Kanal des Verzeichnisses gilt. Die Anfrage an `/api/aktualisierung` darf ihn übersteuern; sonst gilt der eingestellte |
| `MUPIBOX_PLUGIN_DIR` | `/home/dietpi/.mupibox/plugins` |
| `MUPIBOX_PLUGIN_FRIST_MS` | `8000` — die Frist, nach der der Wirt ein Plugin abwürgt |
| `MUPIBOX_PLUGIN_LAUFWERK` | der Pfad zum Laufwerk, wenn der Wirt ihn nicht selbst findet (er sagt es in seiner Fehlermeldung) |

#### 7.7.5 Die Skripte auf der Box

Die Piper-Einrichtung (`scripts/mupibox/piper-einrichten.sh`, und `server.ts`
liest die ersten beiden mit):

| Variable | Vorgabe |
|---|---|
| `MUPIBOX_PIPER_VENV` | `/home/dietpi/.mupibox/piper-venv` |
| `MUPIBOX_PIPER_STIMMEN` | `/home/dietpi/.mupibox/piper-stimmen` |
| `MUPIBOX_PIPER_STIMME` | `de_DE-ramona-low` |
| `MUPIBOX_PIPER_BESITZER` | `dietpi:dietpi` |

Die Fernbedienung (`scripts/box/fernbedienung.py`, läuft als
`mixpi-fernbedienung`, siehe 4.1):

| Variable | Vorgabe |
|---|---|
| `MIXPI_FERNBEDIENUNG_ZUORDNUNG` | `/etc/mupibox/fernbedienung.json` — welche Taste welche Box-Aktion auslöst |
| `MIXPI_BOX_ADRESSE` | `http://127.0.0.1:8200` — wohin die Aktionen gehen |

Die Hardware-Erkennung (`scripts/hwdetect/`) — beide sind **Prüfschalter**, der
Normalbetrieb setzt keinen davon:

| Variable | Wirkung |
|---|---|
| `MUPIBOX_HAT_AUTO=1` | behandelt jeden vorhandenen Wert wie `auto`, lässt also die Erkennung entscheiden |
| `MUPIBOX_FORCE_HAT=1` | tut so, als läge ein HAT an |

Die Wartungsskripte unter `scripts/mupibox/` (`data_clean.sh`,
`m3u_generator.sh`, `change_checker.sh`, `mupi-lautstaerke.sh`,
`mupibox-sicherungsprobe.sh`). Sie tragen das kurze `MUPI_`-Präfix und stammen
aus dem Ursprungsprojekt:

| Variable | Vorgabe |
|---|---|
| `MUPI_CONFIG` | `/etc/mupibox/mupiboxconfig.json` |
| `MUPI_CONFIG_DIR` · `MUPI_DATA` · `MUPI_COVER` | Ablage, `data.json`, Coverordner |
| `MUPI_MEDIA` | `/home/dietpi/MuPiBox/media` |
| `MUPI_SKRIPTE` | `/usr/local/bin/mupibox` |
| `MUPI_BESITZER` | `dietpi:dietpi` |
| `MUPI_TMP_DATA` | `/tmp/cleaned_data.json` |
| `MUPI_DATA_LOCK` | `/tmp/.data.lock` |
| `MUPI_LOGO` | `…/sysmedia/images/MuPiLogo.jpg` |
| `MUPI_FSTAB` · `MUPI_MOUNTS` | `/etc/fstab`, `/proc/mounts` — als Naht für den Test |
| `MUPI_WARTE` | `5` (Sekunden) |
| `MUPI_SICHERUNGEN_BEHALTEN` | `3` |
| `MUPI_MIXER` | `Master` |
| `MUPI_MAXVOL_BODEN` | `10` — die Untergrenze, unter die die Höchstlautstärke nicht fällt |
| `MUPI_KLANG_DATEI` | `…/server/config/klang.json` |
| `MUPI_SICHERUNG` · `MUPI_KARTE_ORDNER` · `MUPI_PROBE_URTEIL` | Sicherungsskript, Ordner auf der SD-Karte, Urteilsdatei der Sicherungsprobe |

#### 7.7.6 Die Stellschrauben ohne Hauspräfix

Diese Namen tragen weder `MUPIBOX_` noch `MUPI_`. Sie sind trotzdem
Stellschrauben — die Datei liest sie mit `${NAME:=vorgabe}` oder
`os.environ.get`, also ausdrücklich von außen. Bis zum **27.08.2026** stand
keiner von ihnen in einem Handbuch, und zwar aus einem einzigen Grund: die
Wache `tools/umgebungsvariablen-deckung.py` suchte nach dem Zugriff auf einen
Namen **mit Hauspräfix**. Wer sich an die Namenskonvention hielt, wurde
geprüft; wer nicht, war unsichtbar. Seitdem prüft die Wache jeden
Großbuchstabennamen, und wer nicht gemeldet werden soll, steht in ihr mit
Begründung daneben.

Die **Leerlaufuhr** (`scripts/mupibox/idle_shutdown.sh`). Alle Pfade und Zeiten
stehen in Variablen, damit `tools/leerlauf-uhr-nachspielen.sh` die Datei
*lesen und aufrufen* kann, statt sie nachzubauen:

| Variable | Vorgabe |
|---|---|
| `CONFIG` | `/etc/mupibox/mupiboxconfig.json` |
| `LOG` | `/tmp/idle_shutdown.log` |
| `PLAYERSTATE` | `/tmp/playerstate` |
| `TAKT` | `10` — Sekunden je Runde; der Zähler rechnet damit in Minuten |
| `STARTKARENZ` | `120` — Sekunden nach dem Start des Dienstes, in denen **nicht** gezählt wird. Gemessen, nicht geschätzt: der Dienst hängt an `basic.target` und läuft weit vor allem los, was ein Mensch sehen kann. Bei einer Minute schaltete sich die Box nach *jedem* Einschalten wieder ab, bevor die erste Kachel stand |
| `AUFFRISCHUNG` | `30` — alle so viele Runden werden die Eingabe-Deskriptoren neu geöffnet (30 × 10 s = 5 Minuten) |
| `EINGABE_SYS` · `EINGABE_DEV` | `/sys/class/input`, `/dev/input`. Zwei Namen, weil die Fähigkeiten in sysfs stehen und die Geräteknoten in `/dev` |
| `ABSCHALT_BEFEHL` | `sudo /usr/local/bin/mupibox/shutdown.sh` — **ausdrücklich** eine Variable, damit die Probe sie ersetzen kann. Ein Werkzeug, das zum Prüfen den Rechner ausschaltet, wird kein zweites Mal ausgeführt |

Der **WLAN-Adapter** und die **Plugin-Auslieferung** unter `scripts/mixpi/`:

| Variable | Vorgabe |
|---|---|
| `MIXPI_WLAN_WAHL` | `/etc/mupibox/mixpi-wlan-adapter` — die Wahldatei |
| `MIXPI_WLAN_WARTEN` | `45` (Sekunden) |
| `MIXPI_WLAN_VERTRAGSORDNER` | `/var/lib/dhcp` — wo die DHCP-Mietverträge liegen; im Test ein Wegwerfordner |
| `MIXPI_WLAN_NETZKLASSE` | `/sys/class/net` — wo der ifup-Riegel (mixpi-wlan-riegel.sh) nachsieht, ob die gewählte Karte als Gerät da ist; im Test ein Wegwerfordner mit Geräte-Attrappen |
| `MIXPI_WLAN_STICK_WARTEN` | `10` (Sekunden) — so lange wartet der Riegel auf das Erscheinen der gewählten Karte, bevor er sie für abwesend hält. Grund: beim Boot startet `ifup@wlan0`, bevor der USB-Stick enumeriert ist (am Gerät gemessen 06.09.2026) |
| `MIXPI_PLUGIN_BESITZER` | `dietpi:dietpi` |

Der Rest, je einer aus einer Datei:

| Variable | Vorgabe |
|---|---|
| `DHCLIENT_CONF` | `/etc/dhcp/dhclient.conf` (`scripts/mupibox/dhcp-schneller.sh`) |
| `TMP_DIR` | `/tmp` (`scripts/mupibox/remove_max_resume.sh`) — bleibt `/tmp`, damit die Karte nicht beschrieben wird, steht aber in einer Variablen, damit eine Probe es in ihren Sandkasten biegen kann |
| `MUPIHAT_ADDR` | `0x6b` — die I²C-Adresse, die `scripts/hwdetect/hwdetect.sh` abklopft |
| `MUPIHAT_LOGLEVEL` | `WARNING` (`scripts/mupihat/mupihat.py`). **Nicht** `INFO`: die Registerwerte sind 21 Zeilen alle 4 Sekunden — gemessen 35,6 MB Protokoll, und `/var/log` liegt bei dietpi-ramlog auf einem 50-MB-tmpfs (E48). Wer sie zur Fehlersuche braucht, setzt `INFO` oder `DEBUG` und startet den Dienst neu |

**Zwei Namen, die man nicht setzt, sondern gesetzt bekommt.** `PLAYER_EVENT`
und `POSITION_MS` liest `scripts/telegram/telegram_Track_Spotify.py` aus der
Umgebung — hineingelegt hat sie **librespot**, das das Skript als Ereignis-Haken
aufruft. Sie stehen hier, damit klar ist, woher sie kommen: sie sind ein
*eingehender Vertrag*, keine Stellschraube. Wer sie selbst setzt, stellt
lediglich ein Ereignis nach, das nie stattgefunden hat.

**Ein Name, der hier absichtlich fehlt.** `MUPI_LOCAL_SRC` (in
`make-boot-sd.sh`) trägt das Präfix, ist aber hausintern: das Skript
exportiert es im erzeugten Erstboot-Skript für sein Kind und liest es zwei
Zeilen weiter selbst (Zeilennummer bewusst nicht genannt — sie wanderte am
23.09.2026 von 126 auf 191, als die Paketauswahl davor umgebaut wurde). Wer es von außen setzt, sieht seinen Wert überschrieben. Ebenso
`MUPIBOX_STANDWACHE_ECHT` — der Name steht nur in einem Kommentar der
Standwache, als die *verworfene* Gegenrichtung des Riegels. Die Wache in
`tools/umgebungsvariablen-deckung.py` sucht deshalb nach dem **Zugriff**, nicht
nach dem Namen.

> **`MUPI_URL` stand hier bis zum 25.08.2026 daneben, und das war falsch**
> (*überholt*). Der Satz „das Skript setzt sie sich selbst" gilt für
> `chromium-autostart.sh:152` — dort steht eine Zuweisung ohne Bedingung. Er
> gilt **nicht** für `tools/pruefen.sh`, das `${MUPI_URL:-https://mupibox:8443}`
> an vier Stellen von außen liest und sich `MUPI_HOST` daraus ableitet (Z. 971,
> 978, 986, 1002). Damit war der einzige dokumentierte Name, mit dem man den
> ganzen Prüflauf auf eine andere Box richten kann, als „bringt nichts"
> dokumentiert. Eine Ausnahme gilt je Datei, nicht je Name.

#### 7.7.7 Der Zieher — Orte, die es nur für den Sandkasten gibt

`scripts/box/mixpi-zieher.py` tauscht **als root den Anwendungsbaum einer
Box**. Es lässt sich auf einem Arbeitsrechner nicht ausprobieren, weil die
Box-Pfade fest eingebaut sind — und ein Weg, den man nicht üben kann, wird erst
im Ernstfall zum ersten Mal gefahren. Genau darum liest jeder Ort eine
Variable: `tools/mixpi-zieher-probe.py` baut damit eine ganze Schein-Box unter
`/tmp` und fährt den **echten** Code darin, statt eine Nachbildung, die
auseinanderlaufen kann.

**Auf einer Box ist keine davon gesetzt.** Ein Tippfehler fällt sofort auf,
weil Schritt 1 „das ist keine Box" meldet, statt irgendwo hineinzuschreiben.

| Variable | Vorgabe |
|---|---|
| `MIXPI_APPDIR` | `/home/dietpi/.mupibox/Sonos-Kids-Controller-master` |
| `MIXPI_PLAYERDIR` | `/home/dietpi/.mupibox/spotifycontroller-main` |
| `MIXPI_LAGER` | `/home/dietpi/.mupibox/.zieher` — wohin das Archiv geholt wird |
| `MIXPI_SICHERUNG` | `/usr/local/bin/mupibox/mupibox-sicherung.py` |
| `MIXPI_STANDWACHE` | `/opt/mupibox-tools/mupibox-standwache.py` — stellt vor dem Neustart die Frist, die ohne Menschen zurückdreht |
| `MIXPI_TAUSCHER` | wird **vorangestellt**, nicht ersetzt: die drei bekannten Orte (`/opt/mupibox-tools/tauscher.py`, `/usr/local/bin/mupibox/mupibox-tauscher.py`, der Nachbar der eigenen Datei) werden danach weiter durchprobiert |
| `MIXPI_EINSTELLUNG` | `/etc/mupibox/mixpi-update.json` — dieselbe Datei, die `server.ts` über `MUPIBOX_UPDATE_EINSTELLUNG` liest (7.7.4) |
| `MIXPI_SCHLUESSEL` | `/etc/mupibox/mixpi-release.pub`. **Liegt er, ist eine Signatur Pflicht**; fehlt er, läuft es mit `sha256` allein und sagt das. Die Richtung ist Absicht — einen Schlüssel nachzulegen erhöht die Hürde und lässt sich nicht still wieder senken |
| `MIXPI_OHNE_SYSTEMD=1` | überspringt den Dienstneustart. Für den Sandkasten, in dem es kein systemd gibt — dort wird übersprungen, statt `systemctl` anzulügen |

Das **Verzeichnis** nimmt der Zieher in dieser Reihenfolge: Umgebung
(`MIXPI_FEED`, `MIXPI_QUELLE`, `MIXPI_KANAL` — Vorgabe des Kanals `stable`),
sonst `MIXPI_EINSTELLUNG`. Ohne Verzeichnis urteilt er „kein Angebot" und tut
nichts; das ist die richtige Auskunft für eine Box, für die niemand etwas
veröffentlicht hat, und ausdrücklich **kein** Fehler.

Zwei weitere liest das Backend, wenn die Verwaltung den Lauf anstößt
(`POST /api/aktualisierung/einspielen`, Abschnitt 5):

| Variable | Vorgabe |
|---|---|
| `MIXPI_ZIEHER` | `/opt/mupibox-tools/mixpi-zieher.py` — was `systemd-run` startet |
| `MIXPI_LAUF_BERICHT` | `/var/lib/mupibox/mixpi-zieher-lauf.json` — der fortlaufend geschriebene Verlauf, den `GET /api/aktualisierung/lauf` ausliefert. Er gehört **niemandem**: deshalb übersteht die Oberfläche, dass der Server sich mitten im Lauf selbst neu startet |

### 7.9 Welche Box ein Werkzeug anfasst

Fünf Namen richten ein Werkzeug auf eine Adresse, mit **unvereinbaren
Vorgaben**. Wer den einen setzt, wird von einem Werkzeug, das den anderen liest,
stillschweigend übergangen — es misst dann die vorgegebene Adresse und meldet
das Ergebnis als Befund. Eine falsche Bestätigung wiegt schwerer als eine
falsche Widerlegung, weil sie eine Frage schließt.

| Variable | Vorgabe | Wer liest sie |
|---|---|---|
| `MUPI_URL` | `https://mupibox:8443` | `tools/pruefen.sh` (4 Stellen) — der Läufer; leitet `MUPI_HOST` daraus ab |
| `MUPI_HOST` | `mupibox` | `tools/aufraeumen.sh` (auch als erstes Argument), `tools/mitmessen.mjs` |
| `MUPI_BOX` | `192.168.178.169` | `tools/anlauf-am-geraet.mjs`, `tools/verwaltung-systemkurve-schau.mjs` |
| `MUPIBOX_BOX` | `192.168.178.169:8200` | `tools/vorlesen-am-geraet.mjs` |
| `MUPI_BASIS` | `http://127.0.0.1:8200` | `tools/mupi-check.py` |

**Beim Messen an einer Box also alle fünf setzen**, nicht den, den das erste
Werkzeug nannte. Das zu **einem** Namen zusammenzuführen ist eine Änderung am
Code und steht offen; bis dahin hält `tools/box-adresse-deckung.py` die Liste
gegen den Baum — sie meldet jeden Namen, dessen Vorgabe eine Adresse ist und
der in keinem Handbuch steht, und jede Ausnahme dieses Abschnitts, die im Baum
nicht mehr stimmt. Rund 108 Werkzeuge tragen eine Box-Adresse fest im
Quelltext, ohne jeden Ausweg über die Umgebung; das ist der größere Rest.

### 7.10 Mitgelieferte Fremddateien: woher eine Schrift kommt

Dieses Repo hat eine Regel, die es nirgends aufgeschrieben hatte, aber zehnmal
befolgt: **neben jedem Themenordner mit fremden Bildern und Schriften liegt
eine `Readme.md`** mit `# Sources` und je einer Zeile `Background:` / `Font:`
samt Adresse. `themes/steampunk/Readme.md` führt vier Quellen einzeln auf. Die
Danksagung der `README.md` nennt jede fremde Zutat mit Adresse — das
Katzenbild, den Startklang, den Ausschaltklang, `jq`, die Symbole.

An genau einer Stelle war die Regel gebrochen, und es war die sichtbarste:
seit `3c59c80f` (31.07.2026) liegen unter `NewDesign/schriften/` **vier
`woff2`-Dateien, rund 135 kB fremde Binärdaten**, die auf jede Box
ausgeliefert werden und aus denen jeder Buchstabe der neuen Oberfläche
besteht. Kein `Readme.md` daneben, kein Lizenztext im Baum, `LICENSE.md`
erwähnt keine Schrift — und die eine Zeile in der Danksagung nannte „Baloo 2
und Nunito" als einzige Einträge der ganzen Liste **ohne Adresse**.

Nachgetragen am 27.08.2026, und zwar **aus den Dateien selbst gelesen**
(`name`-Tabelle, Eintrag 0 und 14) statt aus dem Netz abgeschrieben:

| Schrift | Urheber und Quelle | Lizenz |
|---|---|---|
| **Baloo 2** | The Baloo 2 Project Authors, https://github.com/EkType/Baloo2 | SIL Open Font License 1.1 |
| **Nunito** | The Nunito Project Authors, https://github.com/googlefonts/nunito | SIL Open Font License 1.1 |

**Warum keine der 34 Wachen das sehen konnte.** Sie stellen alle dieselbe
Frage — „nennt die Doku, was im Baum steht?" — und zwar für **Text**: Wege,
Zeilen, Endpunkte, Units, Vokabular, Schlüssel. Eine mitgelieferte Binärdatei
hat keinen Bezeichner, den man greppen könnte, und fällt durch jede dieser
Fragen hindurch. Sie ist die **achte Sorte Datei** nach Handbuch, Bauanleitung
(`Dockerfile`), Momentaufnahme (Analyse-MDs), Simulationsrezept
(`harness/`) und Entwicklerabbild (`.devcontainer/`). Dazu kam: die zehn
`themes/*/Readme.md` las ohnehin niemand — `tools/doku-pfade-pruefen.py` hielt
eine Liste von **sieben** Handbüchern, und wer nicht daraufstand, existierte
für sie nicht. *(Überholt seit dem 27.08.2026: die Wache leitet ihre Quellen
aus `git ls-files` ab statt aus einer Namensliste — siehe 7.11.)*

Gewacht von `python3 tools/schrift-herkunft-pruefen.py` (läuft in
`tools/doku-luecken-probe.sh`): jede Datei mit der Endung `ttf`, `otf`,
`woff` oder `woff2`, die `git ls-files` meldet, braucht eine Herkunft — eine
`Font:`-Zeile mit Adresse in einer `Readme.md` **neben** der Datei, oder eine
Zeile in der Danksagung der Wurzel-`README.md`, die den Datei- oder
Ordnernamen nennt.

> **Warum nur Schriften und nicht „alle Fremddateien".** Im Baum liegen 298
> PNG, 40 STL, 32 SKP — der weit überwiegende Teil ist selbst gebaut
> (3D-Teile, Bildschirmfotos, das Maskottchen). Eine Wache, die für jedes Bild
> einen Herkunftsnachweis verlangt, meldet auf Dauer rot und wird zu Recht
> ignoriert. Bei Schriften stellt sich die Frage nicht: **eine Schriftdatei
> zeichnet in diesem Projekt niemand selbst, jede ist fremd** — und der Baum
> belegt es, zehn von vierzehn hatten ihre Quelle von Anfang an. Darum ist
> „Schrift" die einzige Sorte, bei der „ohne Quelle" zuverlässig „Lücke"
> heißt.
>
> Neben der Datei wird **nicht** auf Namensgleichheit geprüft, und auch das
> ist gemessen: `themes/comic` liefert `snaphand-v1-free.ttf` und nennt
> `dafont.com/de/snaphand.font`, `themes/mystic` liefert
> `ylee_Mortal_Heart.ttf` und nennt `dafont.com/de/ylee-mhim.font`.
> Schriftgießereien benennen ihre Seite anders als die Datei; eine Probe auf
> den Namen meldete beide rot, obwohl die Quelle vollständig dasteht. In der
> Wurzel-`README.md` ist die Namensprobe dagegen nötig — dort stehen Dutzende
> fremder Zutaten, sonst ginge irgendeine Adresse als Beleg durch.

Was die Wache **nicht** prüft: welche Lizenz das ist und ob sie eingehalten
wird. Das ist eine Rechtsfrage und keine Wache; hier steht nur, dass überhaupt
jemand aufgeschrieben hat, woher die Datei kommt.

### 7.11 Welche Prosa eine Wache liest — Namensliste oder Sorte

`tools/doku-pfade-pruefen.py` stellt die Gegenfrage zu allen anderen Wachen:
*gibt es noch, worauf die Doku zeigt?* Bis zum 27.08.2026 tat sie das für eine
**von Hand gepflegte Liste von sieben Dateien**, die je Fund um einen Namen
wuchs (erst drei, dann fünf, dann sieben). Im Baum liegen **49 getrackte
`.md`** — die Liste deckte 14 % der Prosa ab, und zwar genau die 14 %, in denen
zufällig schon einmal ein Fund lag.

Was dort überlebte: `MODERNIZATION.md` ist der Tier-A-Einstieg für jeden
Neuzugang und stand nie auf der Liste. In Abschnitt 8 („Decisive code
references") führte es die Wiedergabe-Maschine als
`src/backend-player/src/spotify-control.js` samt `mplayer-wrapper.js` und
`parsers.js` — während Abschnitt 9 derselben Datei den Umbau auf `.ts` als
erledigt und nachgemessen meldet. **Zwei Läufe hatten dieselbe Behauptung
schon an je zwei anderen Stellen korrigiert** (die Tabelle in 2, das
ASCII-Architekturbild in 1); Abschnitt 8 ist die dritte und war die
folgenreichste, denn es ist der Kasten, in dem jemand nachsieht, *wo der Code
liegt*.

Seither leitet die Wache ihre Quellen ab, statt sie zu führen: jede `.md`, die
`git ls-files` meldet, dazu das Benutzerhandbuch und die
`harness/docker-compose.yml` (deren Kommentare wie ein Handbuch gelesen
werden). Dasselbe für die zweite Liste der Wache, die **obersten Ordner**, in
denen ein Pfad überhaupt liegen darf: sie führte neun Namen, und `NewDesign/`
— die ganze zweite Oberfläche, 261 getrackte Dateien — war keiner davon.

> **Zwei Lehren, die über diese Wache hinausgehen.**
>
> 1. **Die gelesene Quelle beweist nichts über den gelesenen Pfad.** Der
>    Wiki-Eintrag `laufende-vorschau-teilt-zustand` schickte seit dem
>    03.08.2026 zum Nachmessen in `NewDesign/stil.css`; die Datei hieß nie so,
>    sie heißt `app.css`. Das Wissenspaket stand die ganze Zeit auf der
>    Quellenliste — unsichtbar war das Ordner-Präfix. Eine Wache hat mehr als
>    eine Blindstelle, und das Verbreitern der einen Liste heilt die andere
>    nicht.
> 2. **Eine abgeleitete Liste braucht ihren eigenen Riegel.** Eine
>    Namensliste kann man nicht versehentlich leeren, eine Ableitung schon. Die
>    Gegenprobe (Endung auf `.gibtsnicht` gedreht, also keine Prosadatei mehr)
>    meldete zunächst weiter grün: das Wissenspaket allein liefert genug Pfade,
>    damit der vorhandene Wachhund („kein einziger Pfad gefunden") schweigt.
>    Seither prüft die Wache, dass die sechs seit Jahren bestehenden Ablagen
>    und die sechs Kernordner in der Ableitung **wirklich ankommen** — ohne
>    Mindestzahl, die beim nächsten neuen `README.md` falsch wäre.

Was sie **nicht** liest, und warum das gemeldet statt verschwiegen wird: die
`AUDIT-*.md` sind Momentaufnahmen mit Datum im Namen. Sie nennen Vorschläge
(`tools/wachen_lib.py`), Zwischenstände und Pfade, deren Abwesenheit ihr Befund
*ist*. Nachgemessen: **27 der 30** toten Pfade der ersten breiten Fassung
standen in ihnen. Eine Wache, die sie einfordert, meldet dauerhaft rot und wird
zu Recht ignoriert — also stehen sie draußen, und die Wache druckt in jedem
Lauf, wie viele sie übersprungen hat. Ein stiller Ausschluss liest sich sonst
wie Deckung.

Die dritte Fehlalarm-Klasse, erst durch die Verbreiterung sichtbar: **ein
Schrägstrich in Prosa heißt oft „oder"**. `autosetup/update` sind zwei
Ausrollwege, `config/sysinfo/diagnose/shutdown` ist eine Aufzählung von
SSE-Wegen, `src/dest/mode` sind drei Rezept-Schlüssel, und
`config/templates-Vorlagen` ist ein deutsches Kompositum. Eine allgemeine Regel
dafür gibt es nicht — `tools/archiv` ist ebenso endungslos und zu Recht
gemeldet —, deshalb steht jeder dieser Fälle einzeln **mit Begründung** in der
Ausnahmeliste. Wer dort etwas einträgt, liest den Satz vorher.

### 7.12 Der Commit-Haken — und warum er in deinem Klon vielleicht nicht läuft

Drei Prosadateien nennen den Umfang des Wissenspakets („*N* Einträge, Fassung
*M*"): `README.md`, `dokumentation/mixpibox.md` und
`dokumentation/benutzerhandbuch.html`. Nachgezogen wird das von
`tools/paket-angaben-nachziehen.py`.

Gerufen wurde es bis zum 28.08.2026 an **einer** Naht: aus
`tools/wiki-anhaengen.py`, direkt nach dem Anhängen. Wer seinen Eintrag von
Hand ins Paket schrieb, ging daran vorbei — und der Doku-Lauf am nächsten Tag
fand denselben Drift wie am Tag davor. **Ein Befund, der nach seiner Reparatur
wiederkehrt, ist ein Ablauffehler, kein Doku-Fehler:** die Wache stand hinter
dem Ereignis. Die Engstelle, durch die jede Änderung muss, egal wer sie macht,
ist der Commit.

```bash
git config core.hooksPath tools/git-hooks   # einmal pro Klon — sonst läuft nichts
git config --unset core.hooksPath           # aushängen
git commit --no-verify                      # einmal bewusst umgehen
```

> **Der Haken ist unsichtbar, solange er fehlt.** `core.hooksPath` ist lokale
> Konfiguration und wird **nicht mitgeklont**. Ein frischer Klon hat die Datei
> im Baum und trotzdem keinen Schutz, ohne dass irgendetwas das meldet. Nachsehen:
>
> ```bash
> git config core.hooksPath        # muss `tools/git-hooks` ausgeben
> bash tools/git-hooks/pre-commit  # von Hand: Ausgang 0 = nichts zu beanstanden
> ```

`tools/git-hooks/pre-commit` greift **nur**, wenn `llmwiki/pack.yaml` gestaged
ist; jeder andere Commit läuft ungebremst durch. Drei Entscheidungen, jede mit
Grund:

1. **Er misst den Index, nicht den Baum.** Dafür hat
   `paket-angaben-nachziehen.py` einen `--index`-Modus, der die Blobs über
   `git show :pfad` liest — Paket **und** Prosa. Eine im Baum gerichtete, aber
   nicht gestagte README ginge einer Baum-Prüfung als grün durch, und der
   Commit driftete trotzdem.
2. **Er schreibt nichts.** Automatisch nachziehen und nachstagen hieße, während
   eines Commits fremde Dateien in den Index zu heben; auf dieser Maschine
   laufen regelmäßig parallele Sitzungen im selben Baum. Er meldet und nennt
   den Befehl.
3. **Unmessbar (Ausgang 2) lässt er durch.** Ein Haken, der auch dann blockiert,
   wenn jemand die Form der Angabe absichtlich umschreibt, wird beim ersten Mal
   mit `--no-verify` abgeschaltet und danach nie wieder eingeschaltet.

> **Punkt 3 stand einen Tag lang nur im Kommentar.** `ausgang=$?` stand nach
> einem `fi` und las damit den Ausgang des `if` — der ist **immer 0**, wenn
> kein Zweig genommen wurde, nicht der des Aufrufs. Der Vergleich gegen 2 traf
> nie zu; der Haken blockierte bei „unmessbar" und nannte dabei den falschen
> Grund. Aufgefallen ist es erst beim Nachmessen aller drei Ausgänge
> (0 → 0, 1 → 1, 2 → 0) mit geschienten `git`- und `python3`-Aufrufen. Eine
> frisch gebaute Wache ist selbst ungeprüfter Code, und ihr Kopfkommentar ist
> eine Absicht. llmwiki:
> `ausgang-nach-fi-ist-null-der-durchlass-zweig-war-tot`.

### 7.13 Wer leiht bei wem: die Abhängigkeiten der Arbeitsbereiche

Die Bereiche (seit E118/1e am 05.09.2026 drei: `backend-api`,
`backend-player`, `frontend-admin` — bis dahin vier) teilen sich **ein**
`node_modules` in der Wurzel — das ist der Sinn eines npm-Arbeitsbereichs.
Die Kehrseite: **ein Bereich läuft auch mit Paketen, die er nirgends
deklariert**, solange irgendein anderer sie holt.
Fällt der Verleiher weg, fällt der Entleiher aus, und der Fehler erscheint an
der Stelle, an der niemand etwas geändert hat.

Genau das ist am 29.08.2026 passiert. `390880f5` strich `karma-coverage` aus der package.json der (mit E118/1e
gelöschten) alten Box-Oberfläche — zu Recht, deren karma.conf lud nur
den istanbul-Reporter. Kaputt ging die **Verwaltung**: sie hat gar keine
`karma.conf.js`, der Angular-Karma-Bauer erzeugt sich eine und lädt dabei fest
`karma-jasmine`, `karma-chrome-launcher`, `karma-jasmine-html-reporter` und
`karma-coverage`
(`node_modules/@angular/build/src/builders/karma/application_builder.js:604`).
`ef946f34` hat das Paket in die Wurzel gestellt, wo geteiltes Werkzeug
hingehört — der Ausfall war behoben, die Buchhaltung nicht.

**`src/frontend-admin/package.json` führte bis zum 25.09.2026 null
Abhängigkeiten.** Kein `@angular/core`, kein `rxjs`, kein `karma`. Jede
Inventur über `package.json` maß dort eine leere Menge und meldete grün;
gebaut und getestet wurde trotzdem. Ein Bereich, der nichts deklariert, ist für
eine Paket-Wache nicht sauber, sondern **unsichtbar** — dieselbe Bauart wie ein
Ordner, den kein Handbuch nennt.

**Und so ging es aus:** Mit E118 (05.09.2026) fiel der Verleiher, das
`package.json` der alten Box-Oberfläche unter `src/frontend-box`. Auf jedem Arbeitsrechner lag Angular weiter
im alten `node_modules`, nichts wurde rot. Aus einem frischen `npm ci` aber
endete `ng build` mit `ng: not found`, und `tsc` für das Backend fand
`@types/cors` nicht mehr (kam transitiv über karma/engine.io). Die GitHub-CI war
deshalb ab ihrer ersten Veröffentlichung (23.09.2026) rot, 3 von 3 Läufen.
Seit dem 25.09.2026 deklariert die Verwaltung ihre Pakete selbst, in den
Fassungen, die das Lockfile damals trug, und `@types/cors` steht bei
`src/backend-api`. **Wer eine Abhängigkeit streicht, baut danach einmal aus
`npm ci` in einem leeren Ordner** — das alte `node_modules` beweist nichts.
Einen Rest trug `package-lock.json` danach noch: den Eintrag
`packages["src/frontend-box"]`, einen Arbeitsbereich ohne Manifest. npm 10
schreibt ihn beim `npm install` als `extraneous` weiter statt ihn zu streichen;
seit dem 25.09.2026 ist das Lock mit npm 11 neu geschrieben und kennt ihn
nicht mehr (kein gelockter Stand geändert).

Gemessen von `tools/arbeitsbereich-abhaengigkeiten-deckung.py` (läuft in
`tools/doku-luecken-probe.sh`). Es fragt drei Sorten Benutzung ab, denn die
teuerste steht in keiner Zeile Quelltext:

1. den **blanken Import** im verfolgten Quelltext des Bereichs,
2. das, was der **Bauer voraussetzt** (`angular.json` nennt ihn als
   `paket:ziel`; für `:karma` ohne eigene `karmaConfig` die fünf Pakete oben),
3. das **Werkzeug eines npm-Skripts** (`ng build` braucht `@angular/cli`).

Als Deklaration zählt der eigene `package.json` **oder** die Wurzel, bewusst
nicht der Schwesterbereich — der ist der Gegenstand.

Die offenen Leihen. Sie stehen hier und nicht als Ausnahmeliste im Skript,
damit sie findet, wer die `package.json` aufmacht; das Aufräumen ist Arbeit am
Bau und steht im `BACKLOG.md`. **Stand 25.09.2026: keine.** Bis dahin standen
hier dreizehn Zeilen — zwölf Leihen der Verwaltung aus `src/frontend-box`
(Angular, `rxjs`, `karma` samt der drei vom Bauer fest geladenen Plugins) und
`ionicons`, das kein Bereich deklarierte. Die zwölf sind seit dem 25.09.
deklariert (siehe oben), `ionicons` fiel mit der alten Box-Oberfläche (E118).

<!-- GELIEHENE-ABHAENGIGKEITEN:ANFANG -->

| Paket | Bereich | Woher es heute kommt |
|---|---|---|

<!-- GELIEHENE-ABHAENGIGKEITEN:ENDE -->

Die Wache prüft die Tabelle **in beide Richtungen**: wer eine Leihe endlich
deklariert oder ihren letzten Nutzer löscht, ohne die Zeile hier zu streichen,
bekommt `DOKU VERALTET`. Eine Ausnahmeliste, die nur entschärft, verrottet wie
jede andere Zustandsaussage.

### 7.14 Zwei Wachen am Wissenspaket selbst

Die Wachen der Abschnitte 7.11–7.13 fragen, ob die **Doku** zum Baum passt.
Diese beiden fragen, ob das **Wissenspaket zu sich selbst** passt. Beide hängen
in `tools/doku-luecken-probe.sh`.

**`tools/symptom-kollision-probe.py` — ein Symptom in zwei Einträgen.**
`Cannot ensure player ready` stand in zwei Einträgen mit verschiedener Ursache,
`Touch reagiert nicht` ebenso, die durchgestrichene Wolke auch. Wer beim Suchen
den ersten Treffer las, hielt **einen halben Weg für den ganzen** — keine
Meldung, kein Widerspruch, nur eine Reparatur, die nicht trägt. Die Wache
meldet jede `match:`-Alternative, die zwei Einträge der Art `signature` oder
`falle` teilen, solange die sich nicht **gegenseitig** in `related:` nennen.

Zwei Einschränkungen, beide gemessen statt gesetzt:

* **Kein Name aus dem Baum.** Geteilte *Werkzeugnamen* (`api-doku-deckung`,
  `doku-luecken-probe`) stehen mit Absicht in mehreren `match:` — wer den
  Werkzeugnamen sucht, *soll* alle Einträge dazu finden. Ein Handle ist keine
  Verwechslungsgefahr; ein Satz, den jemand am Bildschirm oder im Log liest,
  ist eine. Gefragt wird `git ls-files`, nicht das Dateisystem: Rücklass auf
  der Arbeitsmaschine darf keinen Namen freisprechen. Antwortet git nicht,
  meldet die Wache **unmessbar** — eine leere Namensmenge machte jeden
  Indexbegriff zum Fund.
  > **Bis Fassung 382 stand hier stattdessen „Mehrwortigkeit"** — einwortige
  > Alternativen fielen heraus, begründet damit, es seien ohnehin
  > Werkzeugnamen. ~~Diese Begründung ist überholt:~~ die Wortzahl ist eine
  > Aussage über die *Schreibweise*, keine über den Gegenstand, und die
  > ausgeschlossene Klasse war nie einzeln nachgemessen worden. Am 29.08.2026
  > nachgemessen: von 36 einwortigen Kollisionen waren **fünf** Namen aus dem
  > Baum, **31** waren Code-Bezeichner, Konfigurationsschlüssel und API-Wege
  > (`track_number`, `erkennung_ausfall_ms`, `/api/wlan`) — jeweils zwei
  > Einträge mit verschiedener Ursache. Genau der Fall, für den die Wache
  > gebaut ist. Siehe `wortzahl-ist-kein-ausschluss-ueber-den-gegenstand`.
* **Nur `signature`/`falle`.** 17 Gruppen ohne, 14 mit dieser Bedingung; die
  drei weggefallenen waren Audit-Protokolle, die den Wortlaut eines Fundes
  zitieren.

**Ihre Blindheit, benannt statt verschwiegen:** teilt ein echtes Symptom
zufällig den Wortlaut eines Dateinamens, sieht die Wache es nicht. `pack.yaml`
steht so in drei Einträgen mit drei Ursachen.

Eine **Ausnahmeliste gibt es bewusst nicht** — sie würde altern, ohne dass es
jemand merkt. Stillgestellt wird eine Gruppe allein durch die Reparatur: beide
Einträge nennen einander in `related:`, und im Kopf des `body` steht die *eine
Frage*, die zwischen ihnen entscheidet (ein Befehl mit beiden Ausgängen, kein
„vgl. auch"). Die zehn Gruppen, mit denen die Wache eingehängt wurde, sind
abgearbeitet — darunter `0 Treffer` (veralteter Name gegen Probe ohne Läufer),
`Button held for` (falsche Bruchzahl gegen gar keinen Beobachter am Taster) und
`doku wache blind` (drei blinde Flecken derselben Probe).

**Stand 29.08.2026, 18 Uhr:** mit dem verbreiterten Merkmal fand die Wache
**31** Kollisionen; **14 sind verbunden, 17 stehen offen** (`--probe`,
`/api/wlan`, `ardqueue`, `nachlauf`, `player.*json`, `test:plugins` u. a.).
Zuerst verbunden wurden die, deren `body` den Zwilling längst *nannte* und
denen nur der `related:`-Eintrag fehlte — die Verbindung war da, nur nicht für
den, der beim anderen Eintrag landet. Zwei Cluster haben zusätzlich die
trennende Frage im Kopf bekommen: die vier `track_number`-Einträge (welche
Oberfläche, welche Stufe) und die drei `routerLinkActive`-Einträge (Fall,
Regel oder Messlücke).

**`tools/pack-zwillinge-verbinden.py` — das Nachtragen selbst.** Trägt zwei
oder mehr Kennungen *gegenseitig* in `related:` ein und beherrscht beide
Schreibweisen des Pakets (Fluss `[a, b]`, Block `- a`) sowie den Fall ganz
ohne `related:`. Es arbeitet **zeilenweise**: `yaml.safe_dump` löscht die
Kommentarzeilen der Datei (einmal passiert, zurückgenommen). Vor dem Schreiben
liest es mit `safe_load` gegen und zählt die Kommentarzeilen nach; stimmt
etwas nicht, schreibt es gar nicht. Den `body` fasst es **absichtlich nicht
an** — ein Verweis ohne den trennenden Satz ist die billige Erfüllung der
Wache, nicht ihre Absicht. `--pruefen` meldet nur, was fehlt.

    python3 tools/pack-zwillinge-verbinden.py <id-a> <id-b> [<id-c> …]

**`tools/pack-doppelte-schluessel.py` — die Ergänzung, die still nicht ankommt.**
Der Anlass ist der teuerste Teil des Fundes: ein angehängtes `related:` wirkte
nicht, weil der Eintrag sechzig Zeilen tiefer ein **zweites** `related:` führte
— und `yaml.safe_load` behält kommentarlos den letzten. Die Zeile stand in der
Datei, sie stand im Diff, und für jeden Leser des Pakets war sie unsichtbar.
Aufgefallen ist es nur daran, dass die Symptom-Wache danach unverändert rot
blieb: **sie liest das Ergebnis, das Diff nur die Absicht.** Die neue Wache
liest deshalb den **Text** der Datei, nicht das geladene Objekt — zum Zeitpunkt
des Ladens ist die Doppelung schon aufgelöst.

> Wer von Hand in `llmwiki/pack.yaml` schreibt, prüft danach mit
> `python3 tools/wiki-schau.py --pruefen` (doppelte ids, tote `[[…]]`,
> doppelte Schlüssel) und `python3 tools/symptom-kollision-probe.py`. Beide
> laufen auch in `tools/doku-luecken-probe.sh` mit.

---

### 7.15 Die Veröffentlichung nach GitHub

Der Baum liegt vollständig auf den eigenen Ablagen (`nas`, `origin`). Nach
GitHub (`github`, https://github.com/scoutr2d2/mixpibox) geht ein **kuratierter
Stand**. Was draußen bleibt und warum, steht in `tools/github-ausschluss.txt`;
*dass* etwas draußen bleibt, erklärt die `README.md` (Abschnitt 7). Hier steht
nur die Mechanik — und die eine Überlegung, die man sonst später nicht mehr
versteht.

**Warum kein `git push github main`.** Die Dateien hängen an der *Geschichte*,
nicht am Arbeitsbaum: ein `.gitignore` von heute entfernt kein Modell aus dem
Commit von gestern. Gepusht würden trotzdem alle Blobs — 670 MB, darunter genau
das CAD und die Rohrender, die nicht hin sollen.

**Warum kein `filter-repo`.** Eine umgeschriebene Geschichte hat neue
Kennungen. Danach stünden `nas` und `origin` vor einem *anderen* Repo, und
jeder Klon im Haus wäre unbrauchbar. Der Preis wäre also nicht der Aufwand,
sondern die anderen Ablagen.

**Was stattdessen passiert.** `tools/github-veroeffentlichen.py` baut einen
eigenen Zweig `veroeffentlichung`, dessen erster Commit **elternlos** ist:

```
git ls-files -s            alle getrackten Dateien mit ihren Blob-Kennungen
   ↓  Ausschlussliste
GIT_INDEX_FILE=/tmp/…      ein eigener Index — der Arbeitsbaum wird NICHT angefasst
   ↓  git write-tree
git commit-tree            Baum + (ab der zweiten Veröffentlichung) Elternteil
   ↓  git update-ref
refs/heads/veroeffentlichung
   ↓  git push github veroeffentlichung:main
```

Der Baum zeigt auf die **schon vorhandenen** Blobs — es wird nichts kopiert und
nichts neu gepackt. Gepusht werden genau die Objekte, die dieser eine Baum
braucht (gemessen 23.09.2026: 1724 Dateien, 77 MB — gegenüber 1974 Dateien und
436 MB im Arbeitsbaum). Jede weitere Veröffentlichung hängt einen Commit an,
sodass auf GitHub eine Reihe von Veröffentlichungen steht und der nächste Push
nur das Geänderte trägt.

**Die Wache darin** ist der eigentliche Grund, warum das ein Werkzeug ist und
keine Befehlszeile: Vor dem Bauen liest es die Installationsrezepte und
`autosetup/autosetup.sh`, sammelt jede Quelle ein, die sie aus dem Repo holen
(`${MUPI_REPO:-…}/…` bzw. `${MUPI_SRC}/…`, 113 Stück), und bricht ab, wenn eine
davon im veröffentlichten Stand fehlen würde. Sonst fiele ein Ausschluss zu
viel erst auf der Karte eines Fremden auf — und dort nur als eine Zeile im
Protokoll („diese Schritte laufen ins Leere"). Beides — Musterlogik
(`--selbsttest`) und Wache — hängt in `tools/doku-luecken-probe.sh`.

```bash
python3 tools/github-veroeffentlichen.py                 # Trockenlauf
python3 tools/github-veroeffentlichen.py --liste         # jede Datei einzeln
python3 tools/github-veroeffentlichen.py --bauen         # Commit anlegen
python3 tools/github-veroeffentlichen.py --bauen --push  # und hochladen
```

### 7.16 Fassungen über GitHub: Kanäle, Bauen, Signieren

*Eingerichtet am 25.09.2026; zu diesem Zeitpunkt ist noch keine Fassung
veröffentlicht.*

Die Box kann sich ihre Fassung längst selbst holen (`scripts/box/mixpi-zieher.py`,
Abschnitt 7.7.7): Kanal aus `/etc/mupibox/mixpi-update.json`, den neuesten
Eintrag dieses Kanals, `sha256` Pflicht, Signatur Pflicht sobald
`/etc/mupibox/mixpi-release.pub` liegt, unteilbarer Tausch, Frist, lokaler
Rückweg. Es fehlte die Gegenseite — ein Ort, der Artefakte und Verzeichnis
ausliefert. Das ist GitHub: Das Repo ist öffentlich, die Box lädt ohne
Zugangsdaten. Betreiber, 25.09.2026: Artefakt **auf GitHub gebaut**, signiert
wird **lokal**.

**Die Kanäle stehen im Namen** — dieselbe Form wie bei
`tools/mixpi-fassung-schneiden.py`:

| Name | Kanal | auf GitHub |
|---|---|---|
| `v1.2.0` | stable | normales Release |
| `v1.2.0-beta.3` | beta | Vorabversion |
| `v1.2.0-dev.7` | dev | Vorabversion |

Die Listen **schließen sich ein**: beta führt stable mit, dev führt alles. Die
Box nimmt den letzten Eintrag ihres Kanals; ohne Einschluss säße eine Beta-Box
auf der alten Beta, während stable längst weiter ist. Geordnet wird mit
`zerlege()` aus dem Zieher selbst (dev < beta < fertig, nicht alphabetisch).

**Drei Schritte, drei Orte:**

| Schritt | Wo | Was |
|---|---|---|
| 1. bauen | GitHub: Actions → „Fassung bauen“ (`.github/workflows/fassung.yml`) | `src/deploy.sh` baut wie am Arbeitsrechner; das Paket bekommt `herkunft.json` mit `quelle` = GitHub-Adresse, `version` = Fassung, `eigeneCommits`/`unsauber` = 0; es landet als **Entwurf** mit `.zip` und `.zip.sha256`. Ein Entwurf ist für keine Box sichtbar. |
| 2. signieren | lokal | `python3 tools/mixpi-github-fassung.py signieren --fassung v1.2.0 --veroeffentlichen` — holt den Entwurf, prüft Summe und Herkunft, signiert, prüft die Signatur gegen den **eingecheckten** `config/mixpi-release.pub`, lädt die `.sig` hoch und veröffentlicht. |
| 3. Kanäle | GitHub: „Kanaele veroeffentlichen“ (`.github/workflows/kanaele.yml`), läuft von selbst bei jedem Release-Ereignis | baut `version.json` aus allen veröffentlichten Releases, prüft **jede** Signatur nach und rollt nach GitHub Pages aus: `https://scoutr2d2.github.io/mixpibox/version.json`. Was nicht besteht, kommt nicht hinein; der Lauf wird rot, aber erst nach dem Ausrollen der übrigen. |

**Einmalig einrichten:**

1. GitHub: *Settings → Pages → Source: GitHub Actions.*
2. Lokal den Signierschlüssel anlegen:
   `python3 tools/mixpi-github-fassung.py schluessel-erzeugen`. Der private
   Schlüssel landet unter `~/.config/mixpibox/mixpi-release.key` (0600, **nie**
   im Baum — das Werkzeug verweigert einen Pfad darin), der öffentliche unter
   `config/mixpi-release.pub`. Den öffentlichen einchecken und veröffentlichen
   (7.15). Den privaten offline sichern: verloren heißt, jede eingerichtete Box
   braucht einen neuen öffentlichen.
3. Lokal `gh` (GitHub CLI) mit `gh auth login` anmelden.
4. Auf jeder Box, als root:
   `python3 tools/mixpi-github-fassung.py box-einrichten --kanal stable`.
   Das schreibt `/etc/mupibox/mixpi-update.json` (Verzeichnis, Quelle, Kanal)
   und legt den öffentlichen Schlüssel ab — ab dann ist die Signatur Pflicht.
   Den Kanal wechselt danach die Verwaltung (Aktualisierung).

**Der erste Wechsel einer bestehenden Box.** Wer heute über
`tools/ausliefern.py` oder die Karte aus dem internen Baum läuft, trägt die
Herkunft `http://git.local:3000/achim/box.git`. Das erste Angebot von GitHub
urteilt deshalb `fremdeQuelle` — richtig so, es ist ein Quellwechsel. Einmal
bewusst `sudo python3 scripts/box/mixpi-zieher.py --einspielen --erzwingen`;
danach trägt die Box die GitHub-Herkunft, und es geht ohne weiter.
`box-einrichten` sagt das, wenn es zutrifft.

**Befördern und Zurückziehen.** Aus `v1.2.0-beta.3` wird stable über
denselben Workflow mit dem Feld **„von“** = `v1.2.0-beta.3` und Fassung
`v1.2.0`. Dann wird **nicht** gebaut: das signierte Paket der Beta wird geholt,
gegen `config/mixpi-release.pub` geprüft und nur in `version` umgestempelt —
dieselben Bytes, die als Beta draußen liefen, nicht der heutige Stand von
`main`. Befördert wird nur innerhalb einer Nummer und nur nach oben
(dev → beta → fertig); danach wird wieder lokal signiert, denn der Name steht
im Paket, also sind es neue Bytes. Zurückgezogen wird ein Release,
indem man es löscht oder wieder zum Entwurf macht; das Verzeichnis folgt von
selbst. Boxen, die die Fassung schon haben, behalten sie (der Zieher geht nur
vorwärts); zurück geht es auf der Box mit `mixpi-zieher.py --zurueckdrehen`.

**Warum so und nicht einfacher:**

* **Lokal signieren.** Die `sha256` steht im selben Verzeichnis wie die
  Adresse — wer das GitHub-Konto übernimmt, fälscht beide. Mit dem Schlüssel
  als GitHub-Secret hätte er auch die Signatur. Liegt er nur am
  Arbeitsrechner, lehnt jede eingerichtete Box ab.
* **Pages statt `main`.** `main` schreibt allein `tools/github-veroeffentlichen.py`,
  ohne `--force`. Ein Workflow-Commit dort ließe die nächste Veröffentlichung
  abweisen.
* **Das Tag entsteht auf GitHub.** Ein internes Tag per `git push` trüge die
  ganze Geschichte der eigenen Ablagen hinaus (7.15).
* **Änderungen an den Workflows** kommen deshalb nur über den internen Baum und
  die nächste Veröffentlichung nach GitHub — **keinen PR auf `main` mergen**,
  sonst ist die Veröffentlichungskette nicht mehr vorspulbar.
* **Eine Fassung ist die Quelle, kein Eigenbau.** `eigeneCommits` stammt aus
  `@{upstream}..HEAD` des Baus; das eingecheckte Paket trug am 23.09. eine 2.
  Eine Box, die das einspielt, urteilt danach für immer `eigenbau`. Beide
  Schnittwege (`mixpi-fassung-schneiden.py` und dieser) stempeln deshalb 0.

**Der Zieher lehnte bis zum 25.09.2026 jedes echte Paket ab.** Er verlangte
`www/index.html`; seit E118/1e (05.09.) liegt die Box-Oberfläche aber unter
`www/neu/`. `tools/ausliefern.py` war am 05.09. umgestellt worden, der Zieher
nicht — und sein Sandkasten blieb grün, weil er ein Paket in der alten Form
baute. Gefunden beim ersten Ende-zu-Ende-Lauf dieser Pipeline; beide sind
jetzt auf `www/neu/index.html`, und der Sandkasten läuft in der CI.

**Wachen:** `python3 tools/mixpi-github-fassung.py --selbsttest` (Kanal aus dem
Namen, Einschluss und Ordnung gelesen mit dem Leser der Box, Umstempeln,
Signaturfälle: fehlend, fremd, falsche Summe, falsche Fassung im Paket,
Entwurf) hängt in der CI und in `tools/doku-luecken-probe.sh`;
`tools/mixpi-zieher-probe.py` in der CI und in `tools/pruefen.sh`.

---

## 8. Fehlersuche

Das Wissenspaket ist nach `kind` sortiert; für die Fehlersuche zählen vor allem:

| kind | Anzahl | Wofür |
|---|---|---|
| `falle` | 327 | Dinge, die anders sind, als sie aussehen |
| `howto` | 93 | Abläufe, die einmal richtig aufgeschrieben wurden |
| `signature` | 74 | Fehlertext → Ursache → Abhilfe |
| `entscheidung` | 62 | warum etwas so und nicht anders ist |
| `architektur` | 37 | wie etwas zusammenhängt |
| `offen` | 9 | gemessen, aber noch nicht verstanden — siehe Abschnitt 9 |

Die Zahlen sind am 23.08.2026 aus `entries` gezählt. **Sie decken das Paket
nicht vollständig ab:** die `kind`-Werte sind über die Zeit auseinandergelaufen
(`offen` neben `open`, `falle` neben `gotcha`, `knowhow` neben `lesson`,
`erkenntnis`, `befund`, `regel`, dazu 14 Einträge ganz ohne `kind`). Wer nach
Art sucht, sucht deshalb besser über die Tags als über `kind`.

Nachsehen:

```bash
cd ~/Downloads/MuPiBox/remote-step-installer
python3 controller/wiki.py list    --wiki mupibox
python3 controller/wiki.py context --wiki mupibox     # das ganze Briefing
```

Oder direkt in `pack.yaml` suchen — es ist bewusst **Daten, kein Code**, und
wird nie automatisch ausgeführt.

`tools/wiki-schau.py --pruefen` prüft das Paket selbst: doppelte Kennungen,
Verweise ins Leere, doppelte Schlüssel. Beim ersten wirklichen Lauf meldete es
sofort drei Verweise ins Leere — der Schritt hing bis dahin nie in der Prüfung,
behauptete im Kopf aber, er täte es.

---

## 9. Was gerade im Bau ist

Ehrlich benannt, damit niemand darauf baut. **Nachgeprüft am 25.09.2026**
gegen den Baum; was davon wie abgetragen wird, steht in `BACKLOG.md`, E143.

* **Der Einrichtungsassistent ist verdrahtet — er räumt nur nicht auf.** Seit
  dem 08.08.2026 (E11b/I9–I13) läuft der Weg ohne Laptop durch: `sdstart`
  bestückt die Karte, `mixpibox-vorstart.service` entscheidet beim Booten
  (Netz da → DietPi macht weiter; kein Netz → eigenes WLAN „MixPi Start",
  Agent und Schirm), die Seite fürs Handy übergibt das WLAN, und der Selbstlauf
  fährt das Rezept. Am Pi 5 durchgespielt, am Pi 4 nicht. **Offen ist, was
  danach bleibt** (E143/8–10): der Zweig „kein Netz" im Vorstart fragt die
  `fertig`-Marke nicht — eine fertige Box, die ohne Router startet, öffnet nach
  45 s wieder das Einrichtungs-WLAN —, und `step-agent.service` lauscht nach
  dem Selbstlauf weiter als root auf 0.0.0.0 (der Pair-Deckel aus 5.2 hält,
  gewollt ist es trotzdem nicht).
* **`hostapd` und `dnsmasq` braucht der AP nicht mehr** — er läuft über
  `wpa_supplicant` im Modus 2 und `kleiner-dhcp.py` (llmwiki
  `ap-ohne-hostapd-wpa-mode2`); das Hühnerei-Problem, das hier bis zum
  25.09.2026 stand, ist damit seit dem 08.08. gelöst. Die Kehrseite: das Rezept
  installiert beide trotzdem (und maskiert sie), und `weg_waehlen()` bevorzugt
  hostapd, sobald es da ist — mit dem Übergang, den `wechsel_aus_ap()` über
  `wpa_cli` macht, passt das nicht zusammen (E143/9).
* **Die neue Verwaltung** hat Zeugen für 8 ihrer 28 Seiten direkt, für 6
  weitere über Dienst oder Helfer; 14 sind ungetestet (gezählt 25.09.2026). In
  der CI laufen die Karma-Tests nicht.
* **Die neue Box-Oberfläche** hat Verhaltenstests für Abspielweg und Zustände,
  **nicht** für das Aussehen.
* **Bei den Plugins** (4.7) fehlt noch **eine *eigene* Fläche, die der
  Kinderschirm erreicht** — **Inhalte** kommen seit E87 sehr wohl dorthin
  (`type: "plugin"` in der Medienliste → `/api/werke/<s>/inhalt` Zweig
  `plugin` → `spielweg.ts`, samt Kachel, Folgenliste und gemerkter Stelle).
  Zu ist allein der Weg, auf dem der Kinderschirm Plugin-Code direkt fragt.
  Eigene Endpunkte gibt es seit E77 eingeschränkt: `http()` unter
  `/api/plugins/<kennung>/http/…`, aber nur GET/POST, nur JSON, 256 KB, und nur
  **hinter dem Tor der Verwaltung**. `UiExtension` — fremdes JS in der
  Kiosk-Seite — ist **bewusst gestrichen**; die Begründung steht in
  `plugins/README.md`, und sie gilt für die fehlende Fläche genauso.
  **Erledigt und deshalb nicht mehr hier:** die Verwaltungsseite (`/plugins`
  und `/plugins/<kennung>` seit dem 14.08.2026 — `curl` braucht es dafür nicht
  mehr) und die **gemerkte Stelle** (E90, 23.08.2026; Voraussetzung und Grenze
  stehen bei 4.7). Der Stand je Baustein steht als Tabelle in
  `plugins/README.md` → „Was noch fehlt"; diese Zeile ist nur der Zeigefinger
  darauf.
* **Mehrere Mitschnitte nebeneinander** sind gebaut, aber **am Gerät noch nicht
  zu sehen**: bei zwei Strömen hält `soloist.service` einen, es bleibt genau
  einer für die Aufnahme. Die Schleife arbeitet nachweislich (sie fragt, bekommt
  „kein Strom frei" und bricht sauber ab) — zwei gleichzeitige Aufnahmen gibt es
  erst mit einem dritten Zugang.
* **Der Lautstärkesprung beim Quellenwechsel** ist real und **nicht
  ausgeglichen, wenn Spotify über soloist spielt**: lokale Dateien laufen seit
  dem 21.08. über ReplayGain, und soloist kennt keine Normalisierung, nur
  `--initial-volume`. librespot — die Vorgabe-Maschine — startet mit
  `LIBRESPOT_ENABLE_VOLUME_NORMALISATION=1` (`config/templates/env-librespot`);
  ob das am Gerät wirkt und gleich laut ergibt, ist ungemessen. Der Regler dafür
  ist da („Wie laut — je Quelle"), die **Zahl fehlt**.
  `tools/box/pegelvergleich.py` soll sie stumm messen (Null-Senke + `ebur128`);
  die Einzelteile tragen, die Verkettung in `messen()` noch nicht (llmwiki
  `pegelsprung-quellenwechsel-noch-ungemessen`, E143/11–13).
* **Erledigt und deshalb nicht mehr hier: „Die `klangwerk`-Senke nimmt keine
  Lautstärke an".** Am 05.09.2026 am Gerät aufgelöst — es war nie die Senke,
  sondern der Attrappen-Regler der Tonkarte dahinter; `82-karte-software-regler.conf`
  lässt sie in Software regeln, und die Nutzerlautstärke wohnt seither auf der
  Hardware-Senke (llmwiki `klangwerk-senke-nimmt-keine-lautstaerke`, Abschnitt
  AUFLÖSUNG). Die Vorlage legte bis zum 25.09.2026 nur das Rezept ab; seither
  alle drei Wege.
* **Bluetooth als Zugangsweg** wurde erwogen und verworfen: auf iPhones gibt es
  weder Web-Bluetooth noch BT-PAN, der Schritt ist historisch der hängefreudigste,
  und er teilt sich die Antenne mit dem WLAN.
* **QR-Foto für WLAN-Daten** wurde erwogen und verworfen: Kamerazugriff braucht
  einen sicheren Kontext, den `http://192.168.x.y` nicht hat. WPS löst dasselbe
  Problem billiger.

---

## Woher die Zahlen stammen

Alles in diesem Dokument ist am Bestand abgelesen oder am Gerät gemessen, nicht
geschätzt. Wo eine Zahl steht, steht im Wissenspaket die Messung dazu. Wo etwas
unklar ist, steht es in Abschnitt 9 — nicht als Behauptung dazwischen.
