/**
 * Dienste der Box lesen und schalten.
 *
 * ERSETZT service.php. Dort lief alles über exec() mit zusammengebauten
 * Zeichenketten und `sudo su - -c "…"` — die Bestandsaufnahme zählte im Admin
 * 259 ungeprüfte $_POST-Zugriffe gegen 5 escapeshellarg. Hier gibt es deshalb
 * ZWEI Regeln, die zusammen die ganze Fehlerklasse ausschließen:
 *
 *  1. NIE eine Shell. Alle Aufrufe gehen über execFile mit einem ARRAY von
 *     Argumenten. Ein Dienstname mit `;` oder `$(…)` ist dann bloß ein
 *     Dienstname, den systemd nicht kennt — kein Befehl.
 *  2. NIE ein Name vom Anrufer. Die Liste der schaltbaren Dienste kommt von
 *     systemd SELBST; was hereinkommt, muss in dieser Liste stehen. Der
 *     Anrufer wählt aus, statt zu benennen.
 *
 * Warum die Liste nicht fest verdrahtet ist: sie wäre sofort veraltet. Wir
 * haben in diesem Projekt schon mupibox-touch-bridge, -boot-splash und
 * -alsa-init dazubekommen. Ein Präfix-Filter nimmt die automatisch mit.
 */

/** Präfixe, unter denen die Box ihre eigenen Dienste anlegt. */
export const ERLAUBTE_PRAEFIXE = ['mupi_', 'mupibox-', 'mupi-']

/** Fremde Dienste, die die Box mitverwaltet (aus service.php übernommen). */
export const ERLAUBTE_EXTRA = [
  'smbd.service',
  'nmbd.service',
  'proftpd.service',
  'librespot.service',
  'spotifyd.service',
  'pulseaudio.service',
  'bluetooth.service',
  'dietpi-dashboard.service',
  'wifi-powersave-off.service',
]

/**
 * ABGELÖST — etwas NEUERES tut dasselbe.
 *
 * DIE UNTERSCHEIDUNG, um die es hier geht (verlangt am 03.08.2026), ist
 * keine Wortklauberei, sondern der Unterschied zwischen einer Auskunft und
 * einem Ratschlag:
 *
 *   ABGELÖST          Es gibt einen Nachfolger. Wer den Dienst einschaltet,
 *                     hat danach zwei Dinge, die dasselbe tun.
 *   AUF DIESER BOX AUS Der Dienst ist eine ganz normale Wahlmöglichkeit, die
 *                     hier gerade niemand gewählt hat. `mupi_vnc`, `mupi_fan`
 *                     und `mupi_telegram` sind genau das — sie stehen deshalb
 *                     in KEINER dieser beiden Tabellen und erscheinen in der
 *                     normalen Liste. Ein „abgelöst" an ihnen wäre eine
 *                     Falschauskunft, und zwar eine, die jemanden davon
 *                     abhält, den Lüfter einzuschalten.
 *
 * Jeder Eintrag trägt seinen BELEG mit. Ohne den ist die Einstufung eine
 * Behauptung, und Behauptungen über abgeschaltete Dienste veralten still.
 */
export interface Abloesung {
  /** Wovon abgelöst — der Nachfolger, beim Namen genannt. */
  wodurch: string
  /** Warum wir das wissen. Steht am Bildschirm nicht, im Code aber schon. */
  beleg: string
  /** Warum der Eintrag trotzdem stehen bleibt. */
  warumGeblieben: string
}

export const ABGELOEST: Record<string, Abloesung> = {
  'spotifyd.service': {
    wodurch: 'librespot',
    beleg:
      'Am Geraet gemessen (2026-07-30, beide Boxen): `dpkg -l spotifyd` ist leer, im Pfad liegt kein ausfuehrbares `spotifyd`. Der Dienst KANN nicht starten.',
    warumGeblieben:
      'Jemand koennte spotifyd nachinstallieren wollen — dann ist der Eintrag schon da.',
  },
  'mupi_splash.service': {
    wodurch: 'mupibox-boot-splash („Startbild mit Fortschritt")',
    // PRAEZISIERT am 03.08.2026: der erste Anlauf schrieb hier „beide Units
    // existieren" — das stimmt auf den GERAETEN (2026-07-30 durchgegangen,
    // beide Boxen zeigten zwei Startbilder in der Liste), aber NICHT in
    // diesem Repo: `mupibox-boot-splash.service` lag im remote-step-installer,
    // nicht unter config/services/. Ein Beleg, der die beiden Orte nicht
    // auseinanderhaelt, laesst den naechsten Leser im Repo nach etwas suchen,
    // das dort nie war (Zwei-Repos-Delta, BACKLOG E12).
    //
    // NACHGEZOGEN am 04.08.2026 beim Gegenlesen von E11c: seit Commit 64e53ec9
    // stimmt genau dieser Satz nicht mehr. `mupibox-boot-splash.service` und
    // `scripts/mupibox/mupibox-boot-splash.py` liegen jetzt IN DIESEM REPO und
    // werden von beiden Ausrollwegen eingeschaltet (autosetup.sh und
    // update/start_mupibox_update.sh, BACKLOG E11c/S2). Der Beleg von gestern
    // war damit ueber Nacht zu der Falschauskunft geworden, vor der der Absatz
    // darueber warnt — und er haette den naechsten Leser zwei Repos weit in
    // die falsche Richtung geschickt.
    beleg:
      'Auf beiden Boxen gemessen (2026-07-30): mupi_splash ist aus, mupibox-boot-splash uebernimmt. Seit 04.08.2026 liegt die neue Unit in DIESEM Repo (config/services/mupibox-boot-splash.service samt scripts/mupibox/mupibox-boot-splash.py) und wird von beiden Ausrollwegen eingeschaltet; config/services/mupi_splash.service samt splash_screen.sh bleibt daneben liegen, aber ausgeschaltet.',
    warumGeblieben: 'Echter Rueckfall, falls das neue Startbild nicht gefaellt.',
  },
}

/**
 * HINWEIS — eine Auskunft OHNE Urteil.
 *
 * `pulseaudio` gehört ausdrücklich NICHT in ABGELÖST, und der Grund ist am
 * Gerät gemessen (2026-07-30): auf dem Pi 4 ist es der AKTIVE Tonweg, auf dem
 * Pi 5 der Rückfall hinter PipeWire. „Abgelöst" wäre für die eine Box wahr
 * und für die andere eine Aufforderung, sich den Ton abzuschalten. Was bleibt,
 * ist die Auskunft — und die zweite, wichtigere: dieser Eintrag zeigt den
 * SYSTEM-Dienst, während PulseAudio als NUTZERdienst läuft. Er steht deshalb
 * auf „aus", auch wenn gerade Musik spielt.
 *
 * `mupibox-alsa-init` steht aus demselben Grund hier und nicht in ABGELÖST:
 * auf einem Pi 4 ohne PipeWire legt sie den softvol-Regler an, den der
 * Abspieldienst dort wirklich braucht. „Abgelöst" wäre auf dieser Box eine
 * Aufforderung, sich den Ton wegzuschalten. Der Hinweis sagt stattdessen das,
 * was am Gerät gemessen ist — und was den Schalter daneben erklärt.
 */
export const HINWEIS: Record<string, string> = {
  'pulseaudio.service':
    'Auf dem Pi 5 übernimmt PipeWire, auf dem Pi 4 ist dies der Tonweg. ACHTUNG: hier steht der SYSTEM-Dienst — PulseAudio läuft normalerweise als NUTZERdienst, dieser Eintrag zeigt ihn deshalb auch dann als „aus", wenn Ton läuft.',
  // AM GERÄT GEMESSEN (04.08.2026, Box .169, Pi 5, PipeWire):
  //   systemctl is-enabled mupibox-alsa-init.service  -> disabled
  //   systemctl is-active  mupibox-alsa-init.service  -> active (exited)
  //   systemctl show mupibox-player.service -p Wants  -> mupibox-alsa-init.service
  //   systemctl show mupibox-server.service -p Wants  -> mupibox-alsa-init.service
  // Und über /api/dienste kam am selben Tag genau das heraus, was ohne diesen
  // Hinweis niemand versteht: `"eingeschaltet": false, "zustand": "active"`.
  // Der Schalter zeigt „aus", die Unit läuft. `disable` nimmt nur den Verweis
  // aus multi-user.target.wants — ein `Wants=` in einer ANDEREN Unit zieht sie
  // trotzdem hoch. Wer sie wirklich stilllegen will, muss die beiden `Wants=`
  // entfernen; die zwei Unit-Dateien liegen NICHT in diesem Repo, sondern im
  // remote-step-installer (nachgesehen: config/services/ kennt weder
  // mupibox-player.service noch mupibox-server.service).
  //
  // WARUM DAS MEHR IST ALS EIN SCHÖNHEITSFEHLER: init-alsa-softvol.sh ruft
  // `amixer -q sset Master 70%` OHNE `-c`. Unter PipeWire zeigt ctl.!default
  // auf die PipeWire-Senke — der Aufruf trifft also die ECHTE Lautstärke und
  // geht dabei an `mupibox.maxVolume` vorbei (die Obergrenze sitzt in
  // mupi-lautstaerke.sh). Siehe llmwiki [[alsa-init-laeuft-obwohl-abgeschaltet]]
  // und [[amixer-master-wirkt-unter-pipewire]], BACKLOG E12/X13(b).
  'mupibox-alsa-init.service':
    'ACHTUNG, der Schalter greift hier nicht: „aus" bedeutet nur, dass die Einheit nicht selbst beim Hochfahren startet — Abspieldienst und Server ziehen sie über „Wants=" trotzdem jedes Mal mit hoch. Am Gerät gemessen steht sie deshalb auf „aus" und läuft. Wirklich stillgelegt wird sie nur, indem man die beiden „Wants="-Zeilen entfernt. Auf einer Box mit PipeWire wird sie außerdem nicht mehr gebraucht und setzt die Lautstärke auf 70 %, an der eingestellten Obergrenze vorbei; auf einem Pi 4 ohne PipeWire legt sie dagegen den Regler an, den der Abspieldienst dort braucht.',
}

export const AKTIONEN = ['start', 'stop', 'restart', 'enable', 'disable'] as const
export type Aktion = (typeof AKTIONEN)[number]

export function istAktion(x: unknown): x is Aktion {
  return typeof x === 'string' && (AKTIONEN as readonly string[]).includes(x)
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TRAGWEITE — „was kann man am Gerät noch, wenn der weg ist?"
 *
 * DER ANLASS (07.08.2026). Diese Seite bot bis heute für JEDEN Dienst
 * dieselben zwei Bedienungen an, in derselben Aufmachung: den Knopf
 * „Anhalten" und das Häkchen „startet mit". `mupibox-server.service` stand
 * dabei als ganz normale Zeile mittendrin — und dieser eine Prozess bedient
 * 8200 UND 8443, also die Verwaltung selbst, die ganze API und das Bild auf
 * dem Schirm der Box. Wer sein Häkchen wegnimmt, sperrt sich aus. Nicht
 * sofort: die Box läuft weiter, alles sieht heil aus. Erst beim nächsten
 * Stromausfall fährt sie ohne Verwaltung und ohne Oberfläche hoch, und eine
 * Kinderbox wird ausgesteckt, nicht heruntergefahren. Zwischen Ursache und
 * Wirkung liegen dann Tage.
 *
 * DIE PRÜFFRAGE, an der hier jeder Eintrag gemessen ist, lautet NICHT „ist
 * das gefährlich?", sondern:
 *
 *     Ein Elternteil tut das. Es hat kein zweites Gerät, kein SSH und keine
 *     Anleitung. Kommt es zurück?
 *
 * Ein Weg über SSH ist kein Weg zurück. Ein Weg über einen zweiten Rechner im
 * Netz ist ein halber — deshalb steht er im Text, zählt aber nicht als
 * Rückweg AM GERÄT.
 *
 * WAS HIER AUSDRÜCKLICH NICHT PASSIERT: nichts wird versteckt, ausgegraut
 * oder verboten. Es ist seine Box; wer den Server anhalten will, um etwas zu
 * untersuchen, soll das können. Was sich ändert, ist nur: eine Bedienung, aus
 * der man nicht zurückkommt, muss ANDERS AUSSEHEN als eine, aus der man
 * zurückkommt — und sie muss sagen, was gleich passiert und was der Weg
 * zurück wäre.
 *
 * ZWEI BEDIENUNGEN, GETRENNT BEURTEILT — und das ist der Kern:
 *
 *   ANHALTEN (stop)      wirkt sofort, die Einheit bleibt `enabled`. Ein
 *                        Stromausfall holt sie zurück. ZURÜCKNEHMBAR.
 *   STARTET MIT (disable) wirkt scheinbar gar nicht — und beim nächsten
 *                        Hochfahren für immer. ENDGÜLTIG.
 *
 * Heute sieht der endgültige harmloser aus als der harmlose: ein Häkchen
 * gegen einen Knopf. Genau diese Verwechslung dreht der Datensatz um.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Wie weit reicht eine Bedienung zurück?
 *
 *   normal          Man kommt zurück. Die Verwaltung antwortet weiter, der
 *                   Schirm der Box bleibt bedienbar.
 *   warnung         Man kommt zurück, aber etwas Spürbares fällt weg — und
 *                   zwar so, dass es später niemand mehr mit diesem Klick
 *                   zusammenbringt (kein Ton, keine Musik, kein Akkuschutz).
 *   kein-rueckweg   AM GERÄT gibt es keinen Weg zurück. Nur SSH oder ein
 *                   zweiter Rechner im Netz — und das eine hat ein Elternteil
 *                   nicht, das andere nicht immer.
 */
export type Stufe = 'normal' | 'warnung' | 'kein-rueckweg'

export interface Folgen {
  stufe: Stufe
  /** Was danach am Gerät nicht mehr geht. Ein Satz, kein Fachwort. */
  verliert: string
  /** Der Weg zurück — oder ausdrücklich, dass es am Gerät keinen gibt. */
  rueckweg: string
}

export interface Tragweite {
  /** „Anhalten" — wirkt sofort, gilt bis zum nächsten Hochfahren. */
  anhalten: Folgen
  /** „startet mit" wegnehmen — wirkt erst beim nächsten Hochfahren. */
  startetMit: Folgen
  /** Warum wir das wissen. Steht am Bildschirm nicht, im Code aber schon. */
  beleg: string
}

/** Kurzform für die Masse der Dienste, bei denen beides zurücknehmbar ist. */
function harmlos(verliert: string, beleg: string, rueckweg?: string): Tragweite {
  const zurueck =
    rueckweg ??
    'Verwaltung und Schirm der Box bleiben erreichbar — hier wieder einschalten genügt.'
  return {
    anhalten: { stufe: 'normal', verliert, rueckweg: zurueck },
    startetMit: {
      stufe: 'normal',
      verliert: `${verliert} — allerdings erst ab dem nächsten Hochfahren.`,
      rueckweg: zurueck,
    },
    beleg,
  }
}

/**
 * JEDER Dienst, den systemd auf dieser Box meldet, steht hier — auch die
 * harmlosen.
 *
 * WARUM AUCH DIE HARMLOSEN: weil „steht nicht drin" sonst zwei Dinge heißen
 * könnte — „ist geprüft und harmlos" oder „hat noch nie jemand angesehen".
 * Diese beiden auseinanderzuhalten ist der ganze Zweck der Tabelle. Wer einen
 * Dienst dazubaut und ihn hier vergisst, wird rot (siehe `ohneEinstufung`,
 * dienste.spec.ts und tools/dienst-rueckweg-probe.mjs).
 *
 * DIE GRENZE: „an dieser Box gemessen" heißt Box .169 (Pi 5, PipeWire,
 * Lautsprecher über Bluetooth, am wlan0). Wo eine Aussage von der Bauart
 * abhängt, sagt der Text das mit — eine Warnung, die auf der Hälfte der Boxen
 * falsch ist, ist selbst ein Fehler.
 */
export const TRAGWEITE: Record<string, Tragweite> = {
  // ── DIE ZWEI, DIE DIE BOX UNBEDIENBAR MACHEN ─────────────────────────────
  'mupibox-server.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Sofort weg: diese Verwaltung, die ganze API und das Bild auf dem Schirm der Box — der Kiosk zeigt dann eine Fehlerseite. Auch diese Antwort hier kommt vermutlich nicht mehr an.',
      rueckweg:
        'Die Einheit bleibt eingeschaltet. Einmal Strom aus und wieder an holt sie zurück — der Griff, den eine Kinderbox ohnehin bekommt.',
    },
    startetMit: {
      stufe: 'kein-rueckweg',
      verliert:
        'Heute ändert sich NICHTS — und das ist das Gefährliche. Beim nächsten Hochfahren startet nichts mehr auf 8200/8443: keine Verwaltung, keine API, kein Bild auf dem Schirm. Der Schirm ist die einzige Bedienung am Gerät, und er wird von genau diesem Dienst beliefert.',
      rueckweg:
        'Am Gerät keiner. Auch von einem anderen Rechner im Netz nicht — es antwortet dann nichts mehr, der alte PHP-Admin (lighttpd) ist aus und ausgeschaltet, und kein Zeitgeber holt den Dienst nach. Zurück geht es nur über SSH. Auffallen wird es erst beim nächsten Stromausfall; bis dahin können Tage vergehen.',
    },
    beleg:
      'Am Gerät nachgesehen (07.08.2026, Box .169): ExecStart=/usr/bin/node …/Sonos-Kids-Controller-master/server.js, WantedBy=multi-user.target. Derselbe Prozess bedient 8200 und 8443; der Kiosk-Chromium hält http://localhost:8200/neu/ offen (im /proc des laufenden Chromium gelesen).',
  },
  'mupibox-touch-bridge.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Der Berührungsschirm reagiert sofort nicht mehr. Das Bild bleibt stehen — am Gerät ist dann nichts mehr zu bedienen.',
      rueckweg:
        'Die Einheit bleibt eingeschaltet. Strom aus und wieder an bringt die Berührung zurück.',
    },
    startetMit: {
      stufe: 'kein-rueckweg',
      verliert:
        'Nach dem nächsten Hochfahren ist der Schirm nur noch ein Bild. Diese Brücke IST der Berührungsschirm, und die Box hat keinen zweiten Bedienweg.',
      rueckweg:
        'Am Gerät keiner. Nur noch von einem anderen Rechner im Netz über diese Verwaltung — wer den nicht hat, kommt an die Box nicht mehr heran.',
    },
    beleg:
      'Am Gerät gemessen (Box .169): /proc/bus/input/devices führt GENAU EIN Berührungsgerät, Name="MuPiBox Touch Bridge". Der Kerneltreiber edt_ft5x06 bindet zwar an, bekommt aber nie eine Unterbrechung und liefert 0 Ereignisse — er ist also kein Rückfall.',
  },

  // ── DER RÜCKWEG SELBST ───────────────────────────────────────────────────
  // Ein Dienst, dessen einzige Aufgabe es ist, jemanden zurückzuholen. Ihn
  // abzuschalten kostet heute nichts und beim übernächsten Mal alles.
  'mupibox-wiederherstellung.service': {
    anhalten: {
      stufe: 'normal',
      verliert:
        'Nichts. Der Lauf findet nur beim Hochfahren statt und ist längst vorbei — Anhalten ändert jetzt nichts.',
      rueckweg: 'Nichts zu holen: es ist nichts weg.',
    },
    startetMit: {
      stufe: 'kein-rueckweg',
      verliert:
        'Damit fällt der Rückweg über die SD-Karte weg — der einzige, der ohne Netz, ohne zweites Gerät und ohne SSH auskommt. Wer eine Datei auf die Karte legt, damit die Box beim Hochfahren ihren alten Stand zurückholt, wartet danach vergebens.',
      rueckweg:
        'Solange die Verwaltung noch antwortet, lässt sich das Häkchen hier wieder setzen. Genau darauf ist aber kein Verlass: dieser Dienst ist die Reserve für den Fall, dass sie NICHT mehr antwortet. Er holt allerdings nur die Konfiguration zurück, nicht den systemd-Zustand — ein abgeschalteter Dienst bleibt abgeschaltet.',
    },
    beleg:
      'config/services/mupibox-wiederherstellung.service: Type=oneshot, ExecStart=…/mupibox-sicherung.py --von-karte, WantedBy=multi-user.target. Auf .169 eingeschaltet (07.08.2026 gelesen). Gegenstück: mupibox-sicherung.{service,timer,path} legt die Stände an.',
  },

  // ── DIE SICHERUNG, DIE DEN RÜCKWEG ÜBERHAUPT ERST FÜLLT ──────────────────
  'mupibox-sicherung.service': {
    anhalten: {
      stufe: 'normal',
      verliert: 'Nichts Dauerhaftes — der Lauf ist kurz und wiederholt sich.',
      rueckweg: 'Zeitgeber und Pfad-Einheit stoßen ihn von selbst wieder an.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Es entstehen keine neuen Sicherungsstände mehr. Die alten bleiben liegen, veralten aber ab sofort — und niemand merkt es, weil nichts fehlschlägt.',
      rueckweg:
        'Verwaltung und Schirm bleiben; hier wieder einschalten genügt. Die Stände der Zwischenzeit sind allerdings nie entstanden.',
    },
    beleg:
      'config/services/mupibox-sicherung.service (Type=oneshot, --anlegen … und --auf-karte), angestoßen von mupibox-sicherung.timer (täglich 04:17) und mupibox-sicherung.path (bei Änderung an /etc/mupibox/mupiboxconfig.json). Auf .169 als „static" gemeldet — das Häkchen erscheint dort gar nicht.',
  },
  'mupibox-sicherungsprobe.service': harmlos(
    'Der wöchentliche Selbsttest des Rückwegs fällt aus. Gesichert wird weiter — nur ob die Sicherung TAUGT, prüft dann niemand mehr.',
    'config/services/mupibox-sicherungsprobe.service (Type=oneshot) am mupibox-sicherungsprobe.timer, sonntags 05:30. Auf .169 „static".',
  ),

  // ── NETZ ─────────────────────────────────────────────────────────────────
  // KEIN kein-rueckweg, und das ist Absicht: der Elternbereich AUF DEM SCHIRM
  // der Box kann WLAN neu eintragen (NewDesign/app.js kennt /api/netzwerk und
  // /api/funk). Solange Schirm und Berührung laufen, ist ein WLAN-Fehler am
  // Gerät reparierbar. Eine Warnung, die hier „kein Weg zurück" schriee, wäre
  // falsch — und würde die zwei echten Fälle oben entwerten.
  'mupibox-netz-watchdog-boot.service': {
    anhalten: {
      stufe: 'normal',
      verliert: 'Nichts. Der Lauf gehört zum Hochfahren und ist vorbei.',
      rueckweg: 'Nichts zu holen.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Die Rücknahme fällt weg, die eine nie bestätigte WLAN-Änderung beim nächsten Hochfahren rückgängig macht. Ein Tippfehler im WLAN-Schlüssel ist dann dauerhaft: die Box ist von außen nicht mehr erreichbar.',
      rueckweg:
        'Am Schirm der Box lässt sich das WLAN neu eintragen (Elternbereich), solange Schirm und Berührung laufen. Von einem anderen Rechner aus geht bis dahin nichts.',
    },
    beleg:
      'Am Gerät (07.08.2026, .169): ExecStart=/opt/mupibox-tools/netz-watchdog.py rollback --beim-start, WantedBy=sysinit.target, eingeschaltet. Description: „WLAN-Aenderung zuruecksetzen, wenn sie nie bestaetigt wurde".',
  },
  'mupi_autoconnect-wifi.service': harmlos(
    'Die Box sucht sich beim Hochfahren nicht mehr selbst das beste bekannte WLAN. Eine bestehende Verbindung wird davon nicht angefasst.',
    'config/services/mupi_autoconnect-wifi.service → autoswitch_wifi.sh. Auf .169 ausgeschaltet, WantedBy leer — dort läuft sie also ohnehin nicht.',
  ),
  'mupi_wifi.service': harmlos(
    'Der Weg, ein am Schirm eingetipptes WLAN einzutragen, fällt weg.',
    'config/services/mupi_wifi.service → add_wifi.sh („Add Wifi from Display Dialog"). Auf .169 ausgeschaltet und WantedBy leer; die neue Oberfläche trägt WLAN über /api/netzwerk ein, nicht über diese Einheit.',
  ),
  'wifi-powersave-off.service': harmlos(
    'Das WLAN darf wieder stromsparen. Auf manchen Adaptern äußert sich das als Aussetzer beim Streamen — nicht als Abriss.',
    'ERLAUBTE_EXTRA, aus service.php übernommen. Auf .169 eingeschaltet (07.08.2026 gelesen).',
  ),
  'mupi_check_internet.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Die Box merkt nicht mehr, ob sie online ist. Die Umschaltung zwischen der ganzen Bibliothek und dem, was ohne Internet spielbar ist, bleibt auf dem letzten Stand stehen — Kacheln ohne Netz führen dann ins Leere.',
      rueckweg: 'Verwaltung und Schirm bleiben; hier wieder starten genügt.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Ab dem nächsten Hochfahren dasselbe: keine Umschaltung mehr zwischen Online- und Offline-Bibliothek.',
      rueckweg: 'Verwaltung und Schirm bleiben; hier wieder einschalten genügt.',
    },
    beleg:
      'scripts/mupibox/check_network.sh schreibt active_data.json aus data.json bzw. offline_data.json. WantedBy=multi-user.target, auf .169 eingeschaltet.',
  },

  // ── TON ──────────────────────────────────────────────────────────────────
  'bluetooth.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Hängt der Lautsprecher über Bluetooth — auf dieser Box tut er das —, bricht der Ton sofort ab. Mitten im Hörspiel.',
      rueckweg: 'Verwaltung und Schirm bleiben; hier wieder starten genügt.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Ab dem nächsten Hochfahren kommt bei einem Bluetooth-Lautsprecher kein Ton mehr. Am Bild ändert sich nichts — es sieht nach einem kaputten Lautsprecher aus, nicht nach einem Häkchen von vorletzter Woche.',
      rueckweg:
        'Verwaltung und Schirm bleiben; hier wieder einschalten und danach den Lautsprecher neu verbinden.',
    },
    beleg:
      'ERLAUBTE_EXTRA. Auf .169 eingeschaltet und aktiv (07.08.2026 gelesen); der Betreiber gibt an, dass ein Lautsprecher an Bluetooth hängt. Bei einer Box mit Klinken- oder HAT-Lautsprecher trifft das nicht zu — deshalb steht die Bedingung im Text.',
  },
  'mupibox-bt-reconnect.service': harmlos(
    'Vertraute Bluetooth-Lautsprecher werden nach dem Einschalten nicht mehr von selbst wieder verbunden. Von Hand verbinden geht weiter.',
    'config/services/mupibox-bt-reconnect.service (Type=oneshot, bt-reconnect.py --leise) am mupibox-bt-reconnect.timer. Auf .169 „static" — abschalten ginge nur über den Zeitgeber, und die Liste hier kennt nur --type=service.',
  ),
  'mupibox-player.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Es wird sofort nichts mehr abgespielt — mitten im Hörspiel. Das Bild bleibt, die Knöpfe bewirken nichts mehr.',
      rueckweg: 'Verwaltung und Schirm bleiben; „Starten" holt ihn zurück.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Heute spielt sie weiter. Ab dem nächsten Hochfahren spielt die Box nichts mehr ab: die Oberfläche kommt, die Kacheln stehen da, und beim Antippen passiert nichts.',
      rueckweg:
        'Verwaltung und Schirm bleiben erreichbar, das Häkchen lässt sich wieder setzen — nur wird kaum jemand den stummen Schirm mit diesem Häkchen in Verbindung bringen.',
    },
    beleg:
      'Am Gerät (07.08.2026, .169): ExecStart=/usr/bin/node …/spotifycontroller-main/spotify-control.js, WantedBy=multi-user.target, eingeschaltet. Der Server (8200) spricht ihn über 127.0.0.1:5005 an — die Oberfläche kommt also, der Ton nicht.',
  },
  'librespot.service': harmlos(
    'Die Box ist kein Spotify-Connect-Gerät mehr; vom Handy aus lässt sich nichts mehr auf sie schieben. Was in der Box selbst ausgewählt wird, spielt weiter.',
    'config/services/librespot.service, WantedBy=multi-user.target. Auf .169 eingeschaltet.',
  ),
  'librespot-waechter.service': harmlos(
    'Es prüft niemand mehr nach, ob die Box als Spotify-Gerät noch sichtbar ist; verschwindet sie, kommt sie nicht von selbst zurück.',
    'config/services/librespot-waechter.service (Type=oneshot) am librespot-waechter.timer. Auf .169 „static".',
  ),
  'pulseaudio.service': harmlos(
    'Auf einer Box OHNE PipeWire wäre das der Tonweg — dort bliebe es still. Auf dieser Box (Pi 5, PipeWire) ändert der Schalter nichts, denn PulseAudio läuft hier als Nutzerdienst und nicht als dieser System-Dienst.',
    'Siehe HINWEIS: am Gerät gemessen (2026-07-30) ist es auf dem Pi 4 der aktive Tonweg, auf dem Pi 5 der Rückfall hinter PipeWire. Auf .169 ausgeschaltet.',
  ),
  'spotifyd.service': harmlos(
    'Nichts — auf dieser Box ist spotifyd gar nicht installiert, der Dienst kann nicht starten.',
    'Siehe ABGELOEST: `dpkg -l spotifyd` ist leer, im Pfad liegt kein ausführbares `spotifyd` (2026-07-30, beide Boxen).',
  ),
  'mupibox-alsa-init.service': {
    anhalten: {
      stufe: 'normal',
      verliert:
        'Nichts Bleibendes: die Einheit ist ein einmaliger Lauf und längst durch. Der einmal gesetzte Regler bleibt stehen.',
      rueckweg: 'Nichts zu holen.',
    },
    startetMit: {
      stufe: 'normal',
      verliert:
        'Vermutlich nichts — der Schalter greift hier ohnehin nicht: Abspieldienst und Server ziehen die Einheit über „Wants=" jedes Mal wieder hoch.',
      rueckweg: 'Der Zustand lässt sich hier jederzeit wieder setzen.',
    },
    beleg:
      'Siehe HINWEIS und llmwiki [[alsa-init-laeuft-obwohl-abgeschaltet]]: am Gerät ist sie „disabled" und trotzdem „active (exited)", weil mupibox-player und mupibox-server sie über Wants= mitziehen.',
  },

  // ── SCHIRM UND ANZEIGE ───────────────────────────────────────────────────
  'mupi_check_monitor.service': harmlos(
    'Die Box merkt nicht mehr, wenn der Schirm dunkel geschaltet ist. Berührungen auf einem schwarzen Schirm werden dann als echte Eingaben genommen — der erste Tipp weckt den Schirm nicht nur, sondern drückt gleich etwas.',
    'config/services/mupi_check_monitor.service → get_monitor.sh („block inputs if the screen is blank", vcgencmd display_power → monitor.json). WantedBy=default.target, auf .169 eingeschaltet.',
  ),
  'mupibox-boot-splash.service': harmlos(
    'Beim Hochfahren erscheint kein Startbild mehr; der Schirm bleibt bis zur Oberfläche schwarz. Das dauert genauso lange wie vorher, sieht aber nach „kaputt" aus.',
    'config/services/mupibox-boot-splash.service, WantedBy=basic.target. Auf .169 eingeschaltet; löst mupi_splash ab (siehe ABGELOEST).',
  ),
  'mupi_splash.service': harmlos(
    'Nichts — auf dieser Box ist das alte Startbild ohnehin aus, mupibox-boot-splash hat es abgelöst.',
    'Siehe ABGELOEST. Auf .169 ausgeschaltet (07.08.2026 gelesen).',
  ),
  'mupibox-kioskwache.service': harmlos(
    'Es prüft niemand mehr nach, ob die Oberfläche im Kiosk wirklich gekommen ist. Bleibt sie einmal weg, bleibt der Schirm leer, bis jemand den Strom zieht.',
    'config/services/mupibox-kioskwache.service (Type=oneshot) am mupibox-kioskwache.timer. Auf .169 nicht installiert (07.08.2026: nicht in list-unit-files).',
  ),
  'mupi_vnc.service': harmlos(
    'Der Schirm der Box lässt sich nicht mehr aus der Ferne ansehen. AM GERÄT ändert das nichts — dies ist ein zusätzlicher Weg hinein, kein Weg heraus.',
    'config/services/mupi_vnc.service (x11vnc auf :0). Auf .169 ausgeschaltet — also eine Wahlmöglichkeit, die hier niemand gewählt hat.',
  ),
  'mupi_novnc.service': harmlos(
    'Dasselbe im Browser: der Fernblick über 6080 fällt weg. Am Gerät ändert das nichts.',
    'config/services/mupi_novnc.service (websockify 6080 → localhost:5900), braucht mupi_vnc. Auf .169 ausgeschaltet.',
  ),

  // ── STROM, AKKU, LICHT ───────────────────────────────────────────────────
  'mupi_hat.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Es kommen keine Akkuwerte mehr. Die Anzeige friert auf dem letzten Stand ein, und die Abschaltung bei leerem Akku hat nichts mehr, worauf sie reagieren könnte.',
      rueckweg: 'Verwaltung und Schirm bleiben; hier wieder starten genügt.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Ab dem nächsten Hochfahren dasselbe — ohne Akkuwerte warnt nichts mehr vor dem leeren Akku, und der Akku wird tiefentladen. Das merkt man erst, wenn er es nicht überlebt hat.',
      rueckweg:
        'Das Häkchen lässt sich hier wieder setzen. Ein tiefentladener Akku kommt davon nicht zurück.',
    },
    beleg:
      'config/services/mupi_hat.service → mupihat.py -j /tmp/mupihat.json; mupi_hat_control.service kommt danach (After=mupi_hat.service) und wertet die Datei aus. Auf .169 eingeschaltet. Betrifft nur Boxen MIT MuPiHAT.',
  },
  'mupi_hat_control.service': {
    anhalten: {
      stufe: 'warnung',
      verliert:
        'Die Box warnt bei leerem Akku nicht mehr und fährt nicht mehr von selbst herunter.',
      rueckweg: 'Verwaltung und Schirm bleiben; hier wieder starten genügt.',
    },
    startetMit: {
      stufe: 'warnung',
      verliert:
        'Ab dem nächsten Hochfahren fehlt die Abschaltung bei leerem Akku. Statt sich sauber auszuschalten, läuft die Box bis zum Umfallen — Tiefentladung, und im ungünstigen Fall eine halb geschriebene Karte.',
      rueckweg:
        'Das Häkchen lässt sich hier wieder setzen. Der Schaden am Akku und an der Karte nicht.',
    },
    beleg:
      'config/services/mupi_hat_control.service → mupihat_automation.sh („to automate warn and shutdown"), WantedBy=multi-user.target, After=mupi_hat.service. Auf .169 eingeschaltet. Betrifft nur Boxen MIT MuPiHAT.',
  },
  'mupi_fan.service': harmlos(
    'Der Lüfter wird nicht mehr geregelt. Auf einer Box mit Lüfter heißt das: er läuft dauernd oder gar nicht — je nachdem, wie er verdrahtet ist.',
    'config/services/mupi_fan.service → fan_control.py. Auf .169 ausgeschaltet — eine Wahlmöglichkeit, keine Vergangenheit.',
  ),
  'mupi_powerled.service': harmlos(
    'Die Betriebsleuchte wird nicht mehr geschaltet. Sie bleibt dann so, wie sie gerade ist.',
    'config/services/mupi_powerled.service → mupi_start_led.sh. Auf .169 ausgeschaltet.',
  ),
  'mupi_idle_shutdown.service': harmlos(
    'Die Box schaltet sich bei Nichtstun nicht mehr selbst ab. Sie läuft dann, bis jemand den Stecker zieht oder der Akku leer ist.',
    'config/services/mupi_idle_shutdown.service → idle_shutdown.sh. Auf .169 ausgeschaltet.',
  ),
  'mupi_startstop.service': harmlos(
    'Die eigenen Skripte beim Hochfahren und Herunterfahren laufen nicht mehr.',
    'config/services/mupi_startstop.service (Type=oneshot) → mupi_startup.sh, WantedBy=multi-user.target. Auf .169 ausgeschaltet und WantedBy leer.',
  ),

  // ── MEDIEN UND MELDEWEGE ─────────────────────────────────────────────────
  'mupi_change_checker.service': harmlos(
    'Neu auf die Box kopierte Musik taucht nicht mehr von selbst auf. Was schon da ist, spielt weiter.',
    'config/services/mupi_change_checker.service → change_checker.sh (stößt m3u_generator.sh an, wenn sich /home/dietpi/MuPiBox/media ändert). Auf .169 eingeschaltet.',
  ),
  'mupi_telegram.service': harmlos(
    'Nachrichten per Telegram kommen nicht mehr an der Box an.',
    'config/services/mupi_telegram.service → telegram_start.sh. Auf .169 ausgeschaltet — eine Wahlmöglichkeit.',
  ),
  'mupi_mqtt.service': harmlos(
    'Die Box meldet sich nicht mehr bei der Hausautomatik und nimmt von dort keine Befehle mehr an.',
    'config/services/mupi_mqtt.service → mqtt.py. Auf .169 eingeschaltet.',
  ),
  'mupi-network-info.service': harmlos(
    'Die Netzwerkanzeige beim Anmelden bleibt leer.',
    'Auf .169 als „static" gemeldet — das Häkchen erscheint dort gar nicht.',
  ),
  'smbd.service': harmlos(
    'Die Box ist im Windows-Netz nicht mehr als Laufwerk zu sehen; Musik lässt sich nicht mehr per Datei-Explorer aufspielen. Am Gerät selbst ändert sich nichts.',
    'ERLAUBTE_EXTRA, aus service.php übernommen.',
  ),
  'nmbd.service': harmlos(
    'Die Box ist im Windows-Netz nicht mehr unter ihrem Namen zu finden — über die IP-Adresse schon.',
    'ERLAUBTE_EXTRA, aus service.php übernommen. Gehört zu smbd.',
  ),
  'proftpd.service': harmlos(
    'Der FTP-Zugang fällt weg. Am Gerät ändert sich nichts.',
    'ERLAUBTE_EXTRA, aus service.php übernommen.',
  ),
  'dietpi-dashboard.service': harmlos(
    'Die DietPi-Übersicht im Browser fällt weg. Das ist eine ZWEITE Sicht auf die Box, nicht diese hier — und kein Weg heraus, wenn diese hier fehlt.',
    'ERLAUBTE_EXTRA. Auf .169 ausgeschaltet (07.08.2026 gelesen).',
  ),
}

/**
 * Die Einstufung zu einem Dienst — oder `undefined`, wenn ihn niemand
 * eingeordnet hat. Pure.
 */
export function tragweiteVon(name: string): Tragweite | undefined {
  return Object.hasOwn(TRAGWEITE, name) ? TRAGWEITE[name] : undefined
}

/**
 * Was diese eine Bedienung an diesem einen Dienst anrichtet. Pure.
 *
 * NUR `stop` und `disable` haben Folgen. `start`, `restart` und `enable`
 * schalten etwas AN oder wieder an — daraus kommt man immer zurück, indem man
 * es wieder ausschaltet. Ein Hinweis dort wäre Lärm, und Lärm ist genau das,
 * was die zwei echten Warnungen entwertet.
 */
export function folgenVon(name: string, aktion: Aktion): Folgen | undefined {
  const t = tragweiteVon(name)
  if (!t) return undefined
  if (aktion === 'stop') return t.anhalten
  if (aktion === 'disable') return t.startetMit
  return undefined
}

/**
 * Muss der Anrufer diese Bedienung ausdrücklich bestätigen? Pure.
 *
 * Nur bei `kein-rueckweg`. Eine Rückfrage vor JEDER Warnung wäre nach zwei
 * Wochen ein Reflex, und ein Reflex schützt niemanden — er trainiert das
 * Wegklicken. Was zurücknehmbar ist, wird gesagt, nicht abgefragt.
 */
export function brauchtBestaetigung(name: string, aktion: Aktion): boolean {
  return folgenVon(name, aktion)?.stufe === 'kein-rueckweg'
}

/**
 * Das Wort, mit dem der Anrufer bestätigt. Pure.
 *
 * Es enthält Dienst UND Aktion, damit eine Bestätigung nicht auf eine andere
 * Zeile oder eine andere Bedienung passt: wer „Anhalten" bestätigt hat, hat
 * damit nicht „startet mit" bestätigt. Ein blosses `{"bestaetigt":true}`
 * liesse sich blind mitschicken; dieses Wort muss man erst geliefert
 * bekommen — und wer es geliefert bekommt, hat auch den Text bekommen.
 */
export function bestaetigungFuer(name: string, aktion: Aktion): string {
  return `kein-rueckweg:${name}:${aktion}`
}

/**
 * Welche der von systemd gemeldeten Dienste hat niemand eingeordnet? Pure.
 *
 * Der Punkt der ganzen Tabelle: „steht nicht drin" darf nicht heißen können
 * „ist harmlos". Ein Werkzeug und ein Test halten die systemd-Liste hier
 * dagegen und werden rot, wenn jemand einen Dienst dazubaut, ohne die Frage
 * zu beantworten.
 */
export function ohneEinstufung(namen: string[]): string[] {
  return namen.filter((n) => !Object.hasOwn(TRAGWEITE, n)).sort()
}

/**
 * Darf dieser Name überhaupt ein Dienst der Box sein? Pure.
 *
 * Die Prüfung ist bewusst eng: nur `wort.service`, keine Pfade, keine
 * Vorlagen-Einheiten mit `@`, kein `..`. Sie ist die ZWEITE Reihe — die erste
 * ist der Abgleich gegen die von systemd gemeldete Liste.
 */
export function istErlaubterDienst(name: string): boolean {
  if (!name || name.length > 100) return false
  if (!/^[A-Za-z0-9_.-]+\.service$/.test(name)) return false
  if (name.includes('..')) return false
  if (ERLAUBTE_EXTRA.includes(name)) return true
  return ERLAUBTE_PRAEFIXE.some((p) => name.startsWith(p))
}

export interface Dienst {
  name: string
  beschreibung: string
  /** Läuft er gerade? */
  aktiv: boolean
  /** Startet er beim Hochfahren? `null` = statisch/nicht umschaltbar. */
  eingeschaltet: boolean | null
  /** Roher Zustand für die Anzeige (active, failed, inactive …). */
  zustand: string
  /** Gesetzt, wenn ein NEUERER Dienst dasselbe tut — der Text nennt ihn. */
  abgeloest?: string
  /** Auskunft ohne Urteil (siehe HINWEIS). */
  hinweis?: string
}

/**
 * In welchen Abschnitt gehört dieser Dienst? Pure.
 *
 * Die Seite zeigt zwei Listen. Das ist keine Kosmetik: ein abgelöster Dienst
 * zwischen zwanzig laufenden sieht aus wie eine Wahlmöglichkeit, und genau so
 * wurde er auch behandelt.
 */
export type Abschnitt = 'normal' | 'abgeloest'

export function abschnittVon(name: string): Abschnitt {
  return Object.hasOwn(ABGELOEST, name) ? 'abgeloest' : 'normal'
}

/*
 * DAS AUFTEILEN SELBST STEHT ABSICHTLICH NICHT HIER.
 *
 * Der erste Anlauf (03.08.2026) hatte daneben ein `geteilt(liste)`, das die
 * Liste in zwei Listen zerlegte. Es hat nie jemand gerufen: der Server
 * schickt EINE nach `sortiert` geordnete Liste, an der jeder Dienst sein
 * `abschnitt` traegt, und die Seite filtert danach. Zwei Formulierungen
 * derselben Regel, von denen eine nur ihren eigenen Test bestanden hat —
 * genau die Sorte Code, die beim naechsten Umbau als „wird schon benutzt"
 * mitgeschleppt wird. Die Regel steht in `abschnittVon`, und zwar einmal.
 *
 * Die Reihenfolge geht dabei nicht verloren: `sortiert` laeuft ueber die
 * GANZE Liste, bevor gefiltert wird, und Filtern erhaelt die Reihenfolge.
 */

/**
 * Ausgabe von `systemctl show a b c -p Id -p ActiveState -p UnitFileState
 * -p Description` zerlegen. Pure.
 *
 * systemd trennt die Blöcke durch eine LEERE Zeile. Fehlende Eigenschaften
 * lässt es je nach Fassung weg oder gibt sie leer zurück — beides muss hier
 * überleben, sonst verschwindet ein Dienst still aus der Liste.
 */
export function parseShow(text: string): Dienst[] {
  const raus: Dienst[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const feld: Record<string, string> = {}
    for (const zeile of block.split('\n')) {
      const i = zeile.indexOf('=')
      if (i < 1) continue
      feld[zeile.slice(0, i).trim()] = zeile.slice(i + 1).trim()
    }
    const name = feld['Id']
    if (!name || !name.endsWith('.service')) continue
    const dateizustand = feld['UnitFileState'] ?? ''
    raus.push({
      name,
      beschreibung: feld['Description'] || name,
      aktiv: feld['ActiveState'] === 'active' || feld['ActiveState'] === 'activating',
      // static/masked/generated lassen sich nicht sinnvoll umschalten -> null,
      // damit die Oberfläche keinen Schalter anbietet, der nichts tut.
      eingeschaltet:
        dateizustand === 'enabled' || dateizustand === 'enabled-runtime'
          ? true
          : dateizustand === 'disabled'
            ? false
            : null,
      zustand: feld['ActiveState'] || 'unknown',
    })
  }
  return raus
}

/**
 * Namen aus `systemctl list-unit-files --type=service --no-legend --plain`
 * ziehen und auf die erlaubten eingrenzen. Pure.
 */
export function erlaubteAusListe(text: string): string[] {
  const namen = new Set<string>()
  for (const zeile of text.split('\n')) {
    const name = zeile.trim().split(/\s+/)[0]
    if (name && istErlaubterDienst(name)) namen.add(name)
  }
  return [...namen].sort()
}

/**
 * Sprechende Beschriftung für die bekannten Dienste.
 *
 * systemd liefert eine Description, aber die ist oft technisch ("mupi_hat") und
 * teils englisch. Wo wir es besser wissen, sagen wir es besser; alles andere
 * fällt auf die Description zurück — eine unbekannte Einheit bleibt so sichtbar
 * statt namenlos.
 */
const NAMEN: Record<string, string> = {
  // ERGAENZT am 07.08.2026. Diese elf standen bis dahin mit ihrer
  // systemd-Description da — und die beiden wichtigsten hiessen dort
  // „MuPiBox Backend (server.js)" und „MuPiBox Touch-Bruecke (FT5x06 per I2C
  // abfragen)". Wer solche Zeilen liest, kann nicht wissen, dass die eine die
  // ganze Verwaltung ist und die andere der Beruehrungsschirm. Eine Warnung
  // hilft nicht, wenn die Zeile darueber verschweigt, worum es geht.
  'mupibox-server.service': 'Verwaltung und Oberfläche (die ganze Box)',
  'mupibox-player.service': 'Abspieldienst (Musik und Hörspiele)',
  'mupibox-wiederherstellung.service': 'Rückweg von der SD-Karte',
  'mupibox-sicherung.service': 'Stand sichern',
  'mupibox-sicherungsprobe.service': 'Rückweg proben',
  'mupibox-netz-watchdog-boot.service': 'WLAN-Änderung zurücknehmen',
  'mupibox-kioskwache.service': 'Wache über die Oberfläche',
  'mupi_change_checker.service': 'Neue Musik bemerken',
  'mupi_startstop.service': 'Eigene Skripte beim Start',
  'mupi_wifi.service': 'WLAN vom Bildschirm eintragen',
  'librespot-waechter.service': 'Wache über Spotify-Connect',
  'mupi_vnc.service': 'Bildschirm fernsehen (VNC)',
  'mupi_novnc.service': 'Bildschirm im Browser (noVNC)',
  'smbd.service': 'Dateifreigabe (Windows-Netz)',
  'nmbd.service': 'Dateifreigabe: Namensdienst',
  'proftpd.service': 'Dateiübertragung (FTP)',
  // mupi_autoconnect_bt.service ist entfallen (kaputt seit BlueZ 5.82, siehe
  // bluetooth.ts). Ersatz ist mupibox-bt-reconnect, ein einmaliger Lauf am
  // Zeitgeber. ZUM ABSCHALTEN muesste der TIMER bedienbar sein, und die Liste
  // kennt heute nur `--type=service` (server.ts) — solange steht hier nur der
  // Lauf selbst, und das Abschalten geht ueber die Kommandozeile.
  'mupibox-bt-reconnect.service': 'Bluetooth automatisch verbinden',
  'mupi_autoconnect-wifi.service': 'WLAN automatisch verbinden',
  'librespot.service': 'Spotify-Wiedergabe',
  'spotifyd.service': 'Spotify-Wiedergabe (spotifyd)',
  'pulseaudio.service': 'Tonausgabe',
  'bluetooth.service': 'Bluetooth',
  'mupi_hat.service': 'MuPiHAT (Akku, Lüfter)',
  'mupi_hat_control.service': 'MuPiHAT-Steuerung',
  'mupi_fan.service': 'Lüfter',
  'mupi_powerled.service': 'Betriebsleuchte',
  'mupi_idle_shutdown.service': 'Abschalten bei Nichtstun',
  'mupi_check_internet.service': 'Internet-Prüfung',
  'mupi_check_monitor.service': 'Bildschirm-Überwachung',
  'mupi_telegram.service': 'Telegram-Nachrichten',
  'mupi_mqtt.service': 'MQTT (Hausautomatik)',
  'mupi_splash.service': 'Startbild',
  'mupibox-boot-splash.service': 'Startbild mit Fortschritt',
  'mupibox-touch-bridge.service': 'Touchscreen-Brücke',
  'mupibox-alsa-init.service': 'Tonkarte vorbereiten',
  'mupi-network-info.service': 'Netzwerk-Anzeige',
  'wifi-powersave-off.service': 'WLAN-Stromsparen aus',
  'dietpi-dashboard.service': 'DietPi-Übersicht',
}

export function beschriftung(d: Dienst): string {
  return NAMEN[d.name] ?? d.beschreibung
}

/**
 * Dienste in eine sinnvolle Anzeigereihenfolge bringen. Pure.
 *
 * Kaputtes zuerst — wer die Seite öffnet, will als Erstes sehen, was klemmt.
 * Danach das Laufende, dann der Rest, jeweils alphabetisch nach Beschriftung.
 */
export function sortiert(liste: Dienst[]): Dienst[] {
  const rang = (d: Dienst) => (d.zustand === 'failed' ? 0 : d.aktiv ? 1 : 2)
  return [...liste].sort(
    (a, b) => rang(a) - rang(b) || beschriftung(a).localeCompare(beschriftung(b), 'de'),
  )
}

/**
 * Kurzzeit-Gedaechtnis fuer eine teure, selten wechselnde Abfrage.
 *
 * AN DER BOX GEMESSEN (Pi 5, 2026-07-27), weil die Verwaltung sich zaeh
 * anfuehlte:
 *
 *     systemctl list-unit-files --type=service   335 ms  (206 Einheiten)
 *     systemctl show <namen>                      64 ms
 *     ein Prozessstart (/bin/true)                 2 ms
 *
 * Die 335 ms sind also systemds eigene Arbeit, nicht der Prozessstart — und
 * dieselbe Abfrage steckte in ZWEI Endpunkten (/api/dienste und
 * /api/protokolle). Jeder Seitenwechsel zahlte sie erneut.
 *
 * Gemerkt wird bewusst nur die LISTE DER NAMEN. Der Zustand (laeuft/aktiviert)
 * kommt aus `systemctl show` und wird NIE gemerkt — sonst zeigte die
 * Verwaltung nach einem Klick den alten Zustand an. Die Liste aendert sich
 * nur, wenn Unit-Dateien dazukommen oder verschwinden; nach jeder eigenen
 * Aktion wird sie zusaetzlich sofort vergessen.
 *
 * Gleichzeitige Anfragen teilen sich EINEN Lauf: zwei Seiten, die zusammen
 * laden, loesen nicht zwei systemctl-Aufrufe aus.
 */
export function kurzGemerkt<T>(
  holen: () => Promise<T>,
  fristMs: number,
  jetzt: () => number = Date.now,
): (() => Promise<T>) & { vergessen: () => void } {
  let wert: T | undefined
  let gueltigBis = 0
  let laufend: Promise<T> | null = null

  const f = async (): Promise<T> => {
    if (wert !== undefined && jetzt() < gueltigBis) return wert
    if (laufend) return laufend
    laufend = holen().then(
      (v) => {
        wert = v
        gueltigBis = jetzt() + fristMs
        laufend = null
        return v
      },
      (e) => {
        // Ein Fehlschlag wird NICHT gemerkt — sonst haengt eine einmalige
        // Stoerung die ganze Frist lang nach.
        laufend = null
        throw e
      },
    )
    return laufend
  }
  f.vergessen = () => {
    wert = undefined
    gueltigBis = 0
  }
  return f
}
