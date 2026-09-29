# MixPiBox-App (Android, Flutter)

Eine Fernbedienung fürs Handy: **mehrere Boxen** im Heimnetz, je Box die
**Kinderprofile** wechseln, abspielen, pausieren, lauter/leiser, aus der
Mediathek starten — und **alle Boxen auf einmal** still machen.

Stand 27.09.2026: **läuft auf einem echten Handy an einer echten Box** —
Honor PGT-N19 (Android 16) an Box `.62`, HTTP ohne Verwaltungspasswort:
Übersicht, „Jetzt" mit Cover, Profile und Mediathek, hochkant und quer.
20 Tests gegen eine nachgebaute Box. Beim ersten Lauf gefunden und behoben:
die Startseite blieb für immer beim Kreisel (Binding fehlte vor dem Laden),
Profil- und Mediathek-Reiter warfen bei jedem Öffnen, und quer lagen die
Knöpfe unter dem Rand. **Noch nicht probiert:** HTTPS (Port 8443) und eine
Box mit Verwaltungspasswort.

## Was sie kann

| Seite | Inhalt |
|---|---|
| **Übersicht** | Alle Boxen mit Zustand (spielt / still / nicht erreichbar / Anmeldung nötig), aktivem Kind und Pause-Knopf. Oben rechts ab zwei Boxen: **alle pausieren, alle stoppen, alle leiser/lauter, ein Profil auf allen Boxen**. |
| **Box → Jetzt** | Cover, Titel, Zurück/−30 s/Play-Pause/+30 s/Weiter, Stopp, Lautstärke (0–100, dieselbe Skala wie `setvolume:`). |
| **Box → Profile** | Die Kinder der Box, das aktive markiert. Antippen wechselt; ein geschütztes Profil fragt nach seinem Passwort. |
| **Box → Mediathek** | Was das **aktive** Kind sehen darf (`/api/werke`), mit Suche. Antippen spielt über `POST /api/spielen` — also mit Kinderzeit-Prüfung auf der Box. |
| **Box → Schloss** (seit 28.09.2026) | Die Box **sperren**: 15 min, 30 min, 1 h, 2 h, bis morgen 7:00 oder bis zu einer Uhrzeit — oder die Sperre aufheben. Solange sie gilt, steht auf „Jetzt" ein roter Streifen und in der Übersicht „Gesperrt bis …". Im Menü der Übersicht: **alle sperren / alle entsperren**. Durchgesetzt wird an der Box (`boxsperre.ts`), nicht in der App. |
| **Box → ⋮ → Kinderzeit** (seit 28.09.2026) | Die Woche als **kleiner Kalender**: sieben Balken (0–24 Uhr, oben Mitternacht), farbig das erlaubte Fenster, darunter die Hördauer, heute markiert mit einem Strich bei „jetzt". Ein Tipp öffnet den Tag: darf hören, ab, bis, Hördauer; übernehmen für den Tag, Mo–Fr, Sa–So oder alle. Oben die Wahl **Alle Kinder** (Hausregel) oder ein Kind — ein Kind ohne eigene Regeln zeigt, was es von der Hausregel erbt, und bekommt eigene erst nach „Eigene Regeln". Unten „Heute": Stand, +15/+30 min, zurücksetzen. Erst **Speichern** schreibt. |
| **Box → ⋮ → Sicherung** (seit 28.09.2026) | **Jetzt sichern** legt einen Stand an und speichert ihn unter `Download/MixPiBox` (auf Wunsch mit Zugangsdaten, verschlüsselt mit einem Passwort, das die App nicht merkt). Die Stände auf der Box lassen sich aufs Handy holen. **Datei wählen …** spielt zurück — erst die Vorschau der Box (was sich ändert, Warnungen, z. B. „andere Box"), dann erst nach dem roten Knopf; danach auf Wunsch Neustart. |
| **Box hinzufügen** | Sucht im WLAN (alle Adressen des eigenen /24-Heimnetzes, Port 8200, `/api/box`; Mobilfunk und VPN werden übersprungen) und zeigt „x von y". Ein Tipp auf einen Fund fügt die Box hinzu. Oder Name/IP von Hand. |

„Profil auf allen Boxen" ordnet über den **Namen** zu, nicht über die Kennung:
dasselbe Kind kann auf zwei Boxen verschiedene Kennungen haben.

## Was sie mit Absicht NICHT kann

* **Farb-, Muster- und Bildpasswörter** eines Kindes eintippen — die gibt es
  nur am Schirm der Box. Zeichen und Zahlen gehen.
* **Das Verwaltungspasswort speichern.** Gemerkt wird nur die Sitzung
  (Cookie `mupi_admin`, 12 h, stirbt mit jedem Neustart des Backends). Danach
  fragt die App einmal neu.
* **Verwalten** jenseits von Medien, Kinderzeit, Sperre und Sicherung (WLAN,
  Updates, Ton …). Dafür bleibt die Verwaltung im Browser
  (`http://<box>:8200/admin`).
* **Eine Sperre ohne Ende.** Jede Sperre endet nach höchstens 24 Stunden von
  selbst — eine vergessene Sperre soll die Box nicht für das Kind stumm lassen,
  während das Handy im Büro liegt.

## Wie sie mit der Box redet

Über die Schnittstellen der Box. Bis auf die **Sperre** (`/api/boxsperre`,
seit 28.09.2026) gibt es sie alle auch ohne die App; eine Box ohne diesen Weg
zeigt in der App schlicht kein Schloss-Zeichen in der Übersicht, das Sperren
meldet dann „braucht ein Update". Eine Box von **vor dem 25.09.2026** kennt
`/api/kinderzeit/satz` nicht: dann zeigt die Kinderzeit-Seite nur die
Hausregel (aus `GET /api/kinderzeit`) und keine Kinder — nie eine leere Woche,
die beim Speichern die echte Regel überschriebe:

| Zweck | Weg |
|---|---|
| Ist das eine MixPiBox? | `GET /api/box` → `box: "mixpibox"` (hinter dem Tor: 401 mit `anmeldung erforderlich` zählt auch) |
| Anmelden | `POST /api/auth/login` `{password}` → Cookie `mupi_admin` |
| Was läuft | `GET /player/local`, bei Spotify zusätzlich `/player/state`; Cover `GET /api/bild/laufend` |
| Befehle | `GET /player/current/<befehl>`: `play pause stop next previous seek+30 seek-30 +5 -5 setvolume:<n>` |
| Profile | `GET /api/profile`, `POST /api/profil/aktiv` `{kennung, passwort?}` |
| Mediathek | `GET /api/werke`, `POST /api/spielen` `{schluessel}` |
| Sperre | `GET /api/boxsperre` (frei, auch für den Kiosk), `POST /api/boxsperre` `{minuten}` oder `{bis}` (ms), `DELETE /api/boxsperre` |
| Kinderzeit | `GET /api/kinderzeit/satz`, `PUT`/`DELETE /api/kinderzeit[?profil=]`, `GET /api/kinderzeit/stand[?profil=]`, `POST …/bonus`, `POST …/zuruecksetzen` |
| Sicherung | `GET /api/sicherung`, `POST …/anlegen` (Antwort: die Bytes), `GET …/stand/<name>`, `POST …/pruefen` (Datei als Rumpf), `POST …/zurueckspielen` `{kennung, mitZugangsdaten, passwort?}` |

**Warum eine native App und keine Web-Seite:** Der Herkunftsriegel der Box
(`src/backend-api/src/herkunft.ts`) weist Browser-Anfragen einer *fremden*
Seite ab. Eine App schickt kein `Origin` und gilt dort wie `curl` — sie kommt
durch, ohne dass an der Box etwas aufgemacht werden muss.

**HTTPS:** Schalter „Verschlüsselt" nimmt Port 8443. Das selbst ausgestellte
Zeugnis der Box wird beim ersten Kontakt gemerkt (SHA-256) und danach nur noch
genau dieses akzeptiert — wie `ssh`. Nach einer Neueinrichtung der Box: in den
Box-Einstellungen „Zeugnis vergessen". Ohne den Schalter geht das
Verwaltungspasswort im Klartext durchs WLAN — genauso wie beim Browser auf
Port 8200.

## Bauen

Am einfachsten gar nicht selbst: Der Lauf **Handy-App**
(`.github/workflows/handy-app.yml`) baut bei jeder Änderung unter
`handy-app/` ein APK und hängt es als Artefakt `mixpibox-app` an. Herunterladen,
aufs Handy, „Installation aus unbekannten Quellen" erlauben.

Selbst (Flutter ≥ 3.44 laut `pubspec.lock`, gebaut mit 3.47.5, und Android-SDK):

```bash
cd handy-app
flutter pub get
flutter analyze
flutter test
flutter build apk --release      # → build/app/outputs/flutter-apk/app-release.apk
flutter run                      # Handy per USB, Entwickleroptionen an
```

Das Release-APK ist mit dem **Debug-Schlüssel** signiert (Vorgabe der
Flutter-Vorlage). Für einen eigenen Schlüssel: `key.properties` nach der
[Flutter-Anleitung](https://docs.flutter.dev/deployment/android#sign-the-app)
anlegen — und nie einchecken.

Das **App-Icon** ist das MixPi-Maskottchen, dieselbe Figur wie auf der Box
(`mixpi-hoert.png`, Boot-Animation). Die Bilder unter
`android/app/src/main/res/mipmap-*` werden erzeugt, nicht von Hand bearbeitet:

```bash
python3 tools/handy-app-icon.py            # neu bauen (aus dem Wurzelverzeichnis)
python3 tools/handy-app-icon.py --pruefen  # passt es noch zur Vorlage?
```

Welche Vorlage das ist, steht in `NewDesign/maskottchen.json` beim Zustand
`hoert`. `--pruefen` läuft in `tools/pruefen.sh` mit und misst auch, dass
nichts von der Figur aus dem Kreis ragt, den ein runder Launcher stehen lässt.
Ein neu installiertes Icon zeigt mancher Launcher erst nach einem Neustart des
Handys — vorher hängt noch das alte im Zwischenspeicher.

## Am Handy debuggen

Manche Handys verschlucken die Logs der App — auf dem Honor steht
`persist.log.tag=S`. Dann hängt `flutter run` nach „Installing …" für immer,
weil es die Adresse der Dart-VM aus logcat liest, und Fehler der App sieht
man gar nicht. Deshalb gibt es einen eigenen Weg, der am Handy nichts
verstellt (Flutter unter `~/development/flutter`, SDK unter `~/Android/Sdk`):

```bash
tools/handy-app-debug.sh start      # bauen, installieren, starten, anhängen
tools/handy-app-debug.sh neu        # Hot Reload nach einer Änderung in lib/
tools/handy-app-debug.sh neustart   # Hot Restart (main, Zustand)
tools/handy-app-debug.sh bild       # Schirmbild vom Handy
tools/handy-app-debug.sh log        # Ausgaben und Fehler direkt aus der Dart-VM
```

Fehler der App stehen außerdem in `/tmp/handy-app-debug/attach.log`.

## Aufbau

```
lib/
  main.dart            App, Lebenszyklus (fragt nur, solange sie vorne ist), Zeugnis-Regel für Bilder
  modell.dart          BoxEintrag, Wiedergabe, KindProfil, Werk — tolerant gegen neue Felder
  box_client.dart      EIN Client je Box: Anmeldung, Befehle, Profile, Mediathek, Zeugnis-Pinning
  zustand.dart         alle Boxen, ein Takt (4 s) für alle, Befehle an alle
  speicher.dart        Liste der Boxen (shared_preferences), ohne Passwort
  netzsuche.dart       /24-Suche nach /api/box
  seiten/              Übersicht, Box (Jetzt/Profile/Mediathek), Box bearbeiten,
                       sperren.dart, kinderzeit_seite.dart (Wochen-Kalender),
                       sicherung_seite.dart
test/
  box_client_test.dart gegen eine Attrappe, die Pfade und Fehlerformen von backend-api nachbildet
  zustand_test.dart    Befehl an alle, Profile über alle, Speichern
  widget_test.dart     Rauchtest der Startseite
```

**Wenn sich an der Box eine Schnittstelle ändert,** muss die Attrappe in
`test/box_client_test.dart` mitziehen — sonst bleiben die Tests grün, während
die App an der echten Box scheitert.

## Offen

* Weiter an echten Boxen ausprobieren: HTTPS (Port 8443) und mit
  Verwaltungspasswort — ohne Passwort über HTTP läuft es seit dem 27.09.2026
  an `.62`.
* Suche per mDNS (`_http._tcp`/`<name>.local`) statt /24-Abtastung — braucht
  auf Android einen Multicast-Lock, deshalb nicht im ersten Wurf.
* iOS: der Code ist plattformneutral; es fehlt nur `flutter create --platforms=ios .`
  und ein Mac zum Bauen.
