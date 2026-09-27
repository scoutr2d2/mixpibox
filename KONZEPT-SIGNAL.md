# Konzept: Signal auf der MuPiBox — ein Briefkasten, kein Chat

Stand 14.08.2026. Reines Konzept; die Box wurde dafuer nicht angefasst
(Anweisung des Betreibers: erstmal nichts auf der Box probieren).

> **ENTSCHEID (14.08.2026, spaeter am Tag): MATRIX ist der gewaehlte
> Traeger** — siehe Abschnitt 8 und den Wiki-Eintrag
> `matrix-traegt-nachrichten-und-anrufe` (llmwiki, Version 171).
> Die Abschnitte 1-7 beschreiben den Signal-Weg; er wird NICHT gebaut
> und bleibt als dokumentierte Alternative stehen. Die Grundsaetze aus
> Abschnitt 2 (eigenes Konto, ein Familienkanal, Einrichtung nur ueber
> die Verwaltung, traegerneutraler Kern) gelten unveraendert — sie
> wandern mit zu Matrix.

## 1. Zielbild

Die Familie (Grosseltern, Eltern unterwegs) schickt Sprachnachrichten in eine
Signal-Familiengruppe. Auf der Box erscheint eine Kachel "Nachrichten" mit
Zaehler; das Kind tippt und hoert. Textnachrichten liest die Box vor.
Spaeter darf das Kind antworten — per Sprachnachricht, nur in die Gruppe.

Explizit NICHT gewollt: freier Chat, fremde Kontakte, Tastatur-Eingaben am
Geraet. Die Box ist ein Briefkasten mit Lautsprecher, kein Messenger-Client.

## 2. Grundsatzentscheidungen

**a) Eigene Nummer — KEIN Koppeln an ein Elternkonto.** Ein gekoppeltes
Geraet (wie Signal Desktop) sieht ALLE Chats des Kontos. Auf einem
Kindergeraet indiskutabel. Die Box bekommt ein eigenes Konto. Kandidat:
die heimische FESTNETZNUMMER — Signal verifiziert auch per Anruf
(`register --voice`), keine SIM noetig, kostet nichts. Bedingung: die
Nummer wird sonst nicht fuer Signal gebraucht.

**b) Eine Familiengruppe ist der einzige Kanal.** Der Empfaenger verarbeitet
ausschliesslich Nachrichten aus der EINEN konfigurierten Gruppen-ID.
Direktnachrichten und fremde Gruppen werden verworfen (gezaehlt im Journal,
nie angezeigt). Wer senden darf, regelt die Gruppenmitgliedschaft — die
Governance liegt bei den Eltern, nicht im Code. Dazu gehoert die Gegenprobe
als Test: eine Direktnachricht MUSS verworfen werden, und der Test wird rot,
wenn der Filter faellt.

**c) Der Kiosk bleibt daheim.** Die gesamte Einrichtung (Captcha-Token,
Verifizierungscode, Gruppenwahl) laeuft ueber die Verwaltung vom
Eltern-Handy/PC. Lektion der drei Kiosk-Gefaengnisse vom 14.08.: niemals
externe Seiten auf dem Kiosk oeffnen.

**d) Signal ist der Lackmustest fuer den Plugin-Weg.** Traegt
`claude/plugin-skelett`, wird Signal Plugin Nr. 2 (nach mupibox-podcast):
ein Mieter mit eigenem Prozess, eigener Ablage, eigener Kachel — genau die
Sorte Fracht, fuer die das Laufwerk gebaut wird. Der KERN (Empfaenger,
Ablage, API-Form) wird aber traegerneutral geschnitten, damit er als
eigenstaendiger systemd-Dienst auf main leben kann, falls der Plugin-Weg
verworfen wird. Der Kern darf sich also nicht auf Vertrags-Details des
Skeletts stuetzen.

## 3. Der Maschinenraum

- **signal-cli** (AsamK, inoffizieller Client), Daemon-Modus, JSON-RPC ueber
  UNIX-Socket. **Mindestens v0.14.1**: Ende Maerz 2026 hat Signal Konten
  deaktiviert, die aeltere signal-cli-Fassungen ohne SPQR-Flag angelegt
  hatten. Das ist zugleich die Mahnung: ein Drittclient MUSS gepflegt
  werden — der Update-Pfad gehoert von Anfang an ins Installer-Rezept.
- **ARM64/GLIBC**: die neuesten nativen libsignal-Bauten verlangen
  GLIBC 2.41 (Debian 13 "Trixie"). Laeuft die Box auf Bookworm-Basis
  (GLIBC 2.36), braucht es eine dazu passende libsignal_jni.so >= 0.14.1.
  ERSTER MESSPUNKT, sobald die Box wieder frei ist: `ldd --version`.
- **Laufzeitkosten**: JRE headless (~200 MB Platte); der Daemon liegt
  erfahrungsgemaess bei 150-300 MB RSS — auf dem Pi 4 die kritische Zahl.
  VOR dem Merge messen und eine Abnahmeschwelle festlegen (Pi 5: die
  16-KB-Seiten bei /proc/statm beachten, sonst Faktor 4 daneben).
- **Empfangspfad**: daemon -> Empfaenger (Node) lauscht auf `receive` ->
  Sprachnachricht (Anhang .m4a/.aac) nach `media/nachrichten/`, Metadaten
  in `nachrichten.json` (ueber die Konfig-Schlange, konfigAendernSicher-
  Muster) -> `/api/nachrichten` -> Kachel im NewDesign mit Ungehoert-
  Zaehler -> Wiedergabe ueber den bestehenden lokalen Spielweg -> nach dem
  Anhoeren eine Rueckmeldung in die Gruppe ("angehoert") -> Aufraeumen per
  FIFO-Deckel wie beim vlCache (z. B. 50 Nachrichten / 200 MB / 30 Tage).
- **Registrierung** (einmalig, in der Verwaltung): Captcha auf
  signalcaptchas.org loesen — der Token MUSS von derselben externen IP
  kommen wie der register-Aufruf; im Heimnetz ist der Eltern-PC dieselbe
  IP wie die Box. Token in die Verwaltung einfuegen -> `register
  --captcha ... --voice` -> das Festnetz klingelt und sagt den Code an ->
  Code in der Verwaltung eintippen. Danach nie wieder.
- **Offline-Verhalten**: Box aus -> Nachrichten warten verschluesselt beim
  Signal-Server und kommen beim naechsten Start. Passt zum Geraet, das
  abends ausgeschaltet wird.

## 4. Sicherheit und Datenschutz

- Ende-zu-Ende-Verschluesselung reicht bis zur Box. AB der Box liegen
  Nachrichten unverschluesselt auf der SD-Karte — deshalb der
  Aufbewahrungsdeckel, und die Nachrichtenablage bleibt aus dem Backup
  draussen (Ausnahmeliste pruefen).
- Stufe 1 kann nichts senden ausser der Angehoert-Rueckmeldung — kein
  Ausleitrisiko vom Kindergeraet.
- Ehrlichkeit im Konzept: signal-cli ist GEDULDET, nicht garantiert. Die
  Maerz-Deregistrierung zeigt, dass Signal Drittclients planvoll
  aussperren kann. Plan B: Kachel, Ablage, API und Spielweg sind
  traegerneutral — ein anderer Zutraeger (Matrix, ein E-Mail-Postfach)
  koennte den signal-cli-Teil ersetzen, der teuerste Teil ueberlebt.

## 5. Ausbaustufen

1. **Empfangen**: Kachel, Zaehler, Abspielen, Angehoert-Rueckmeldung.
   Alleine schon das Produkt.
2. **Vorlesen**: Textnachrichten per Piper (haengt an der offenen
   Piper-Installation, ~700 MB).
3. **Antworten**: USB-Mikrofon, Aufnahme-UI im Kinder-Design, Senden NUR
   in die Gruppe. (Ob ein Mikrofon existiert, ist offen.)
4. **Bilder**: Fotos aus der Gruppe als Diaschau-Kachel.

## 6. Offene Fragen und Messpunkte (Box derzeit tabu — nur notiert)

- [ ] GLIBC und DietPi-Basis der Boxen (`ldd --version`).
- [ ] Freier RAM auf dem Pi 4 heute; Abnahmeschwelle fuer den Daemon.
- [ ] Festnetznummer vorhanden und fuer Signal frei?
- [ ] JRE ins Installer-Rezept: Paketgroesse, Bootzeit-Einfluss messen.
- [ ] Mikrofon vorhanden? (erst fuer Stufe 3)

## 7. Grobe Aufwaende (Stufe 1)

Rezeptteil (JRE + signal-cli + systemd) ~1 Tag; Empfaenger + API + Tests
1-2 Tage; Kachel im NewDesign ~1 Tag; Einrichtungs-Fluss in der Verwaltung
1-2 Tage (der Captcha-Fluss ist das Fummeligste); dazu ein Messtag am
Geraet. Der Einrichtungs-Fluss ist bewusst der groesste Posten: er
entscheidet, ob das Feature benutzbar ist oder ein Bastlerding bleibt.

## 8. Nachtrag vom selben Tag: Video mit Oma in Vietnam — die Nummernfrage dreht das Konzept

Der Betreiber dachte weiter: eine Kamera, telefonieren mit der Oma in
Vietnam — und die Telefonnummer ist ihm ein Dorn. Beides zusammen stellt
den Traeger in Frage, nicht nur ein Detail:

**a) Signal ohne Nummer: angekuendigt, aber nicht da.** Signal arbeitet an
"Signal Login" — Registrierung ohne Telefonnummer gegen eine einmalige
Zahlung (Spam-Bremse). Stand August 2026: in Entwicklung, KEIN Termin.
Darauf bauen kann man nicht.

**b) Der haertere Punkt: signal-cli kann grundsaetzlich NICHT telefonieren.**
Keine Sprach-, keine Videoanrufe — der inoffizielle Client empfaengt und
sendet Nachrichten, mehr nicht. Fuer die Video-Vision waere Signal auf der
Box also selbst MIT Nummer eine Sackgasse; der offizielle Desktop-Client
existiert fuer den Pi nicht ernsthaft. Ergebnis: Signal traegt den
Briefkasten (Abschnitte 1-7), aber niemals den Anruf.

**c) Die Box kann laengst telefonieren — sie weiss es nur noch nicht.**
Der Kiosk IST ein Chromium, und Chromium spricht WebRTC. Video braucht
also keinen neuen Klienten, sondern eine Kamera und eine Seite, die WIR
ausliefern (Kiosk-Lektion: nie fremde Seiten, immer eigene Flaeche mit
grossem rotem Knopf). Zwei nummernlose Traeger kommen in Frage:

  * **Matrix (empfohlen)**: Konten waren dort NIE an Telefonnummern
    gebunden. Oma bekommt die Element-App und ein Konto ohne Nummer,
    funktioniert in Vietnam wie ueberall. Anrufe laufen ueber Element
    Call (Ende-zu-Ende-verschluesselt, Gast-Links moeglich); die
    NAT-Durchquerung (TURN) bringt die gehostete Infrastruktur mit,
    spaeter selbst hostbar. Und der eigentliche Gewinn: Matrix traegt
    AUCH den Briefkasten — Sprachnachrichten, Texte, Bilder. EIN System
    statt Signal plus Anbau; der "traegerneutrale Kern" aus Abschnitt 2d
    bekommt damit seinen Namen: der Zutraeger ist Matrix, signal-cli
    wird zur dokumentierten Alternative, falls jemand auf Signal besteht.
  * **Jitsi (Stufe 0, sofort)**: gar kein Konto, ein geheimer Raumname
    mit Passwort, eingebettet per iFrame-API in unsere eigene Kachel.
    Der schnellste Weg zum ersten Oma-Gespraech — aber auf der
    oeffentlichen Instanz sieht der Server die Medien (Transport
    verschluesselt, nicht Ende-zu-Ende). Fuer Kindervideo auf Dauer
    nur selbst gehostet oder eben Element Call.

**d) Hardware-Messpunkte fuer Video** (Box weiter tabu, nur notiert):
  * Kamera: eine USB-Webcam (UVC) ist der reibungsfreie Weg in Chromium;
    das CSI-Kameramodul geht erst ueber Umwege.
  * Der Pi 5 hat KEINEN Hardware-Videoencoder mehr (der Pi 4 hatte
    einen) — Chromium encodiert in Software. Erwartung: 720p auf dem
    Pi 5 machbar, Pi 4 eher 480p. MESSEN, nicht hoffen: CPU-Last und
    Bildrate im Testanruf, ehe irgendwas versprochen wird.
  * Mikrofon: fuer Anrufe zwingend — die Webcam bringt meist eins mit,
    womit auch Stufe 3 des Briefkastens (Antworten) abfiele.

**e) Kinder-Klingel-Modell**: Oma ruft an -> die Box klingelt und zeigt
EINEN grossen Annehmen-Knopf; das Kind ruft nur ueber die eine
"Oma anrufen"-Kachel zurueck, die zur Elternzeit freigeschaltet ist
(Eltern-Governance wie beim Gruppen-Filter: wer anrufen darf, steht in
der Familienliste, nicht im Code). Die Klingel-Signalisierung ist bei
Matrix vorhanden; wie zuverlaessig sie die Kiosk-Seite weckt, ist ein
eigener Messpunkt.
