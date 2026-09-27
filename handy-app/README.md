# MixPiBox-App (Android, Flutter)

Eine Fernbedienung fürs Handy: **mehrere Boxen** im Heimnetz, je Box die
**Kinderprofile** wechseln, abspielen, pausieren, lauter/leiser, aus der
Mediathek starten — und **alle Boxen auf einmal** still machen.

Stand: Gerüst vom 27.09.2026. Analysiert und getestet (17 Tests gegen eine
nachgebaute Box); **noch nie an einer echten Box und noch nie auf einem Handy
gelaufen.** Wer sie als Erstes an einer Box ausprobiert, trägt hier das Datum
und die Box ein.

## Was sie kann

| Seite | Inhalt |
|---|---|
| **Übersicht** | Alle Boxen mit Zustand (spielt / still / nicht erreichbar / Anmeldung nötig), aktivem Kind und Pause-Knopf. Oben rechts ab zwei Boxen: **alle pausieren, alle stoppen, alle leiser/lauter, ein Profil auf allen Boxen**. |
| **Box → Jetzt** | Cover, Titel, Zurück/−30 s/Play-Pause/+30 s/Weiter, Stopp, Lautstärke (0–100, dieselbe Skala wie `setvolume:`). |
| **Box → Profile** | Die Kinder der Box, das aktive markiert. Antippen wechselt; ein geschütztes Profil fragt nach seinem Passwort. |
| **Box → Mediathek** | Was das **aktive** Kind sehen darf (`/api/werke`), mit Suche. Antippen spielt über `POST /api/spielen` — also mit Kinderzeit-Prüfung auf der Box. |
| **Box hinzufügen** | Sucht im WLAN (alle Adressen des eigenen /24-Netzes, Port 8200, `/api/box`), oder Name/IP von Hand. |

„Profil auf allen Boxen" ordnet über den **Namen** zu, nicht über die Kennung:
dasselbe Kind kann auf zwei Boxen verschiedene Kennungen haben.

## Was sie mit Absicht NICHT kann

* **Farb-, Muster- und Bildpasswörter** eines Kindes eintippen — die gibt es
  nur am Schirm der Box. Zeichen und Zahlen gehen.
* **Das Verwaltungspasswort speichern.** Gemerkt wird nur die Sitzung
  (Cookie `mupi_admin`, 12 h, stirbt mit jedem Neustart des Backends). Danach
  fragt die App einmal neu.
* **Verwalten** (Medien anlegen, WLAN, Updates …). Dafür bleibt die
  Verwaltung im Browser (`http://<box>:8200/admin`).

## Wie sie mit der Box redet

Nur über Schnittstellen, die es schon gibt — die Box braucht **keine
Änderung**:

| Zweck | Weg |
|---|---|
| Ist das eine MixPiBox? | `GET /api/box` → `box: "mixpibox"` (hinter dem Tor: 401 mit `anmeldung erforderlich` zählt auch) |
| Anmelden | `POST /api/auth/login` `{password}` → Cookie `mupi_admin` |
| Was läuft | `GET /player/local`, bei Spotify zusätzlich `/player/state`; Cover `GET /api/bild/laufend` |
| Befehle | `GET /player/current/<befehl>`: `play pause stop next previous seek+30 seek-30 +5 -5 setvolume:<n>` |
| Profile | `GET /api/profile`, `POST /api/profil/aktiv` `{kennung, passwort?}` |
| Mediathek | `GET /api/werke`, `POST /api/spielen` `{schluessel}` |

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

## Aufbau

```
lib/
  main.dart            App, Lebenszyklus (fragt nur, solange sie vorne ist), Zeugnis-Regel für Bilder
  modell.dart          BoxEintrag, Wiedergabe, KindProfil, Werk — tolerant gegen neue Felder
  box_client.dart      EIN Client je Box: Anmeldung, Befehle, Profile, Mediathek, Zeugnis-Pinning
  zustand.dart         alle Boxen, ein Takt (4 s) für alle, Befehle an alle
  speicher.dart        Liste der Boxen (shared_preferences), ohne Passwort
  netzsuche.dart       /24-Suche nach /api/box
  seiten/              Übersicht, Box (Jetzt/Profile/Mediathek), Box bearbeiten
test/
  box_client_test.dart gegen eine Attrappe, die Pfade und Fehlerformen von backend-api nachbildet
  zustand_test.dart    Befehl an alle, Profile über alle, Speichern
  widget_test.dart     Rauchtest der Startseite
```

**Wenn sich an der Box eine Schnittstelle ändert,** muss die Attrappe in
`test/box_client_test.dart` mitziehen — sonst bleiben die Tests grün, während
die App an der echten Box scheitert.

## Offen

* An einer echten Box ausprobieren (Pi 4 `.99` / Pi 5 `.169`) — beide Wege,
  mit und ohne Verwaltungspasswort, HTTP und HTTPS.
* Suche per mDNS (`_http._tcp`/`<name>.local`) statt /24-Abtastung — braucht
  auf Android einen Multicast-Lock, deshalb nicht im ersten Wurf.
* iOS: der Code ist plattformneutral; es fehlt nur `flutter create --platforms=ios .`
  und ein Mac zum Bauen.
