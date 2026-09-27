#!/usr/bin/env python3
"""Erkenntnisse ins Wissenspaket schreiben — und ins WERKZEUG, nicht nur in eine Datei.

══ WOZU ═══════════════════════════════════════════════════════════════════
Betreiber, 10.08.2026, auf die Frage nach dem Stand: „sind alle erkenntnisse im
wiki?" — und gleich darauf: „wichtig ist ins tool."

Die ehrliche Antwort war NEIN. Was an einem Tag gefunden wird, landete in
Commit-Nachrichten, in Kommentaren und im BACKLOG. Alle drei liest ein Mensch,
der schon weiss, wo er suchen muss. Das Wissenspaket liest ETWAS ANDERES: der
Controller des Karteninstallers zieht es in seinen Zwischenspeicher, und
`rsi diagnose` sucht darin nach der Fehlermeldung, die gerade auf dem Schirm
steht. Ein Befund, der dort fehlt, ist beim naechsten Mal wieder neu.

DESHALB DIESES WERKZEUG UND KEIN HANDEDIT. `llmwiki/pack.yaml` ist 1,8 MB mit
583 Eintraegen. Wer dort von Hand hineinschreibt, hat beim dritten Mal zwei
Eintraege mit derselben `id` oder eine kaputte Einrueckung — und merkt es erst,
wenn `rsi diagnose` gar nichts mehr findet.

══ WAS ES TUT ═════════════════════════════════════════════════════════════
Es traegt die unten stehenden Eintraege ein, ERSETZT gleichnamige statt sie zu
verdoppeln, zaehlt `version` hoch und laesst alles andere unberuehrt. Danach
holt es das Paket in den Zwischenspeicher des Installers, denn dort — und nur
dort — sieht `rsi diagnose` es.

══ DAS FELD, AUF DAS ES ANKOMMT ═══════════════════════════════════════════
`match`. Danach sucht die Diagnose, und zwar in dem, was das Werkzeug gerade
ausgegeben hat. Ein `match`, das niemand je zu sehen bekommt, ist ein Eintrag,
den niemand je findet. Deshalb steht dort woertlich, was auf dem Schirm steht —
nicht, wie wir das Problem nennen.

══ AUFRUF ═════════════════════════════════════════════════════════════════
    python3 tools/wiki-eintragen.py            # eintragen + in den Cache holen
    python3 tools/wiki-eintragen.py --pruefen  # nur sagen, was fehlt
"""
import pathlib
import subprocess
import sys

WURZEL = pathlib.Path(__file__).resolve().parent.parent
PACK = WURZEL / 'llmwiki' / 'pack.yaml'
WIKI_PY = WURZEL / 'remote-step-installer' / 'controller' / 'wiki.py'


# ══ DIE ERKENNTNISSE DES 10.08.2026 ═════════════════════════════════════════
#
# Jede hat ein `match`, das WOERTLICH auf einem Schirm stand — entweder in der
# Oberflaeche, im Kernelprotokoll oder in einer Fehlermeldung.
EINTRAEGE = [
    {
        'kind': 'howto',
        'id': 'spotify-geraetecode-quickconnect',
        'title': 'Spotify-Anmeldung per Geraete-Code — sechs Zeichen wie Jellyfins QuickConnect',
        'tags': ['spotify', 'librespot', 'auth', 'oauth', 'device-code', 'ton'],
        'quelle': ['https://accounts.spotify.com/oauth2/device/authorize'],
        'body': (
            'AM GERAET GEMESSEN (11.08.2026). Spotify bietet den Geraete-Ablauf an — '
            'fuer Dritt-Apps ist er NICHT dokumentiert, fuer librespots Client '
            '(65b708073fc0480ea92a077233ca87bd) aber vorhanden:\n\n'
            '  POST https://accounts.spotify.com/oauth2/device/authorize\n'
            '       client_id=<librespot>&scope=streaming …\n'
            '    -> user_code "UHL8NW", verification_uri "https://spotify.com/pair",\n'
            '       verification_uri_complete (Code vorbelegt),\n'
            '       expires_in 3599, interval 5\n\n'
            '  POST https://accounts.spotify.com/api/token\n'
            '       grant_type=urn:ietf:params:oauth:grant-type:device_code\n'
            '    -> {"error":"authorization_pending"}, bis jemand bestaetigt\n'
            '    -> danach access_token\n\n'
            'DAS IST GENAU JELLYFINS QUICKCONNECT: sechs Zeichen auf dem Schirm, auf '
            'einem beliebigen anderen Geraet eingetippt, die Box merkt es selbst.\n\n'
            'WARUM DAS DIE ANDEREN WEGE ABLOEST: Der Rueckweg von librespots OAuth ist '
            'auf 127.0.0.1:5588 festgelegt. Am Handy fuehrt das ins Leere (dort ist es '
            'das Handy) — man musste die gescheiterte Adresse kopieren und einfuegen. '
            'Am Geraet faengt die Box den Rueckweg zwar selbst auf, aber auf einer '
            'frischen Karte hat ihr Browser keine Spotify-Sitzung: dann steht dort die '
            'volle Anmeldung mit E-Mail und Passwort auf 3,5 Zoll.\n\n'
            'Der Geraete-Code braucht KEINS von beidem. Er macht das Einloesen nicht '
            'automatisch, sondern ueberfluessig.\n\n'
            'ENDPUNKTE DER BOX\n'
            '  POST   /api/spotify/ton/geraetecode   Code holen, Takt starten\n'
            '  DELETE /api/spotify/ton/geraetecode   abbrechen\n'
            '  GET    /api/spotify/ton               .geraet = {code, restSekunden,\n'
            '                                        wartet, fertig, meldung}\n\n'
            'DIE BOX FRAGT NACH, NICHT DIE OBERFLAECHE. Sonst haenge der Ablauf daran, '
            'dass jemand ein Fenster offen laesst — und ein Kind, das den Schirm '
            'beruehrt, wuerde ihn abbrechen. INTERVALL EINHALTEN: Spotify nennt 5 s; '
            'wer schneller fragt, bekommt `slow_down` und verlaengert die Sache.\n\n'
            'In der Verwaltung: Dienste -> Spotify -> Zustand -> "Ton anmelden" -> '
            '"Code anzeigen".'),
    },
    {
        'kind': 'signature',
        'id': 'librespot-invalid-credentials-fremde-clientid',
        'title': 'librespot: INVALID_CREDENTIALS im Neustartkreis — Token aus fremder Client-ID',
        'sev': 'high',
        'match': 'Login request was denied: INVALID_CREDENTIALS',
        'cause': (
            'Die Box hat ZWEI Spotify-Zugaenge: die Web-API (PKCE, Client-ID aus dem '
            'Dashboard) fuer Blaettern/Cover/Steuern, und librespot fuer den TON. '
            'config/templates/env-librespot schob librespot beim ersten Start den '
            'accessToken der Box unter ("Ansaat"), solange keine credentials.json '
            'existierte. Seit die Box eine SELBST angelegte Client-ID benutzt, weist '
            'Spotify diesen Token am Connect-Netz ab. librespot benutzt fuer seine '
            'eigene Anmeldung Spotifys Client 65b708073fc0480ea92a077233ca87bd — nur '
            'der darf dort herein.'),
        'fix': (
            'ZWEI Aenderungen, beide noetig. (1) Den Token aus env-librespot nehmen: '
            'eine gescheiterte Token-Anmeldung BEENDET librespot, mit Restart=always '
            'ergibt das einen Neustartkreis, und in jedem Durchlauf ist die Box '
            'unsichtbar. Ohne Token laeuft es im Entdeckungs-Modus stabil. (2) Einmal '
            'mit einem Token aus SPOTIFYS Client anmelden — dann entsteht '
            'credentials.json, und ab da meldet librespot sich selbst an. In der '
            'Verwaltung: Dienste -> Spotify -> Zeile "Zustand" -> "Ton anmelden".'),
        'tags': ['spotify', 'librespot', 'auth', 'ton', 'clientid'],
        'body': (
            'GEMESSEN am 11.08.2026 (192.168.178.57). Ausgeschlossen wurden vorher: '
            'Token zu alt (frischer geholt, gleiche Absage), fehlendes Streaming-Recht '
            '(der scope wird angefordert), fremdes Konto (dasselbe), kein Premium '
            '(product=premium, Land DE).\n\n'
            'mit Token:  Neustartkreis, 21 Neustarts\n'
            'ohne Token: 100 s ohne einen Neustart, UDP 5353 selbst belegt\n'
            'nach der Anmeldung ueber Spotifys Client: 0 Neustarts, 0 Fehlerzeilen in '
            '10 min, und "MixPiBox" steht als Speaker in der Geraeteliste des Kontos.\n\n'
            'ACHTUNG BEIM PRUEFEN: "active/running" beweist nichts. Mitten im '
            'Neustartkreis stand der Dienst genau so da — der Lauf war zwanzig '
            'Sekunden alt und schon verloren. Es zaehlt die DAUER.'),
    },
    {
        'kind': 'howto',
        'id': 'librespot-anmelden-ohne-app-ohne-tunnel',
        'title': 'librespot anmelden ohne Spotify-App und ohne Tunnel — der Horcher auf 127.0.0.1:5588',
        'tags': ['spotify', 'librespot', 'auth', 'oauth', 'pkce', 'kiosk'],
        'body': (
            'AUSGANGSLAGE: Spotify laesst fuer librespots Client nur '
            'http://127.0.0.1:5588/login als Rueckweg zu. Vom Handy aus fuehrt das ins '
            'Leere — das Handy ist sein eigenes 127.0.0.1.\n\n'
            'DIE ZEROCONF-UEBERGABE SCHEIDET AUS, wenn kein Handy im Spiel sein soll: '
            'im librespot-Projekt steht ausdruecklich, dass es fuer das Anmelden ueber '
            'den zeroconf-Endpunkt ohne vorherige Verbindung aus einer offiziellen '
            'Spotify-App kein funktionierendes Beispiel gibt. Auch librespot-auth und '
            'spotify-zeroconf geben sich nur als Geraet aus — angeklickt werden muss '
            'trotzdem in der App.\n\n'
            'DER WEG: Auf der BOX ist 127.0.0.1 die Box selbst. Der Server stellt '
            'waehrend eines Anlaufs einen eigenen Horcher auf 127.0.0.1:5588 auf '
            '(NICHT 0.0.0.0 — er tauscht einen Code gegen einen Token und hat im Netz '
            'nichts zu suchen). Der Kiosk geht im SELBEN Fenster zu Spotify, Spotify '
            'leitet zurueck, der Horcher faengt den Code, loest ihn ein, und seine '
            'Seite schickt den Bildschirm nach sechs Sekunden zurueck in die '
            'Oberflaeche.\n\n'
            'VOM HANDY AUS GEHT DERSELBE ANLAUF: dort laeuft die Rueckleitung ins '
            'Leere, aber die Adresszeile TRAEGT DEN CODE. Er wird in ein Feld '
            'eingefuegt; die Box tauscht ihn. Beide Wege teilen sich EINE '
            'Einloese-Funktion (tonloginEinloesen) — zwei Fassungen waeren '
            'auseinandergelaufen.\n\n'
            'ENDPUNKTE\n'
            '  GET  /api/spotify/ton        angemeldet, laeuft, Neustarts\n'
            '  POST /api/spotify/ton/start  Adresse + ob der Horcher steht\n'
            '  POST /api/spotify/ton/code   einloesen (Handy-Weg)\n\n'
            'DER TOKEN WIRD NUR EINMAL BENUTZT, um credentials.json entstehen zu '
            'lassen. Ein Zugangstoken gilt eine Stunde — genau daran ist die alte '
            '"Ansaat" in env-librespot gescheitert. credentials.json gilt weiter.\n\n'
            'Werkzeuge: tools/librespot-code-anmelden.py (derselbe Weg von der '
            'Kommandozeile), tools/librespot-anmelden.py (Rueckfall ueber SSH-Tunnel, '
            'braucht kein Handy, dafuer einen Rechner).'),
    },
    {
        'kind': 'howto',
        'id': 'jellyfin-server-im-netz-suchen',
        'title': 'Jellyfin-Server per Rundruf finden (UDP 7359)',
        'tags': ['jellyfin', 'netz', 'autodiscovery', 'udp'],
        'body': (
            'Eine frisch geschriebene Karte bringt jellyfin.server nicht mit, und ohne '
            'Adresse meldet auch die Schnellverbindung nur "es gibt niemanden zu '
            'fragen". Jellyfins eigener Weg: ein UDP-Rundruf auf Port 7359 mit dem '
            'Text "who is JellyfinServer?"; jeder Server im selben Netz antwortet mit '
            'JSON (Name, Id, Address).\n\n'
            'GET /api/jellyfin/suchen macht das auf der Box — ein Browser kann kein '
            'UDP. In der Verwaltung: Dienste -> Jellyfin -> Serveradresse -> Aendern -> '
            '"Im Netz suchen".\n\n'
            '255.255.255.255 GENUEGT NICHT: der limitierte Rundruf wird nicht geroutet '
            'und verlaesst nur EINE Schnittstelle. Eine Box mit LAN und WLAN suchte '
            'damit in genau einem ihrer Netze, und das saehe aus wie "nichts da". Die '
            'Frage geht deshalb zusaetzlich an die Rundrufadresse jeder eigenen '
            'IPv4-Schnittstelle.\n\n'
            'DIE GEGENPROBE GEHOERT AUF DIE BOX. Am 11.08.2026 gemessen: der '
            'Arbeitsrechner nimmt ueberhaupt kein UDP von anderen Rechnern an, auch '
            'kein Unicast — dort steht eine Firewall. "Nichts gefunden" haette dort '
            'IMMER gestanden, egal wie gut die Suche ist. '
            'tools/jellyfin-suche-probe.py --gegenprobe stellt das Schein-Jellyfin '
            'deshalb per SSH auf der Box auf und weist drei Dinge nach: dass die Suche '
            'findet, dass mehr als ein Rundruf-Ziel erreicht wird, und dass zwei '
            'Antworten trotzdem einen Eintrag ergeben.'),
    },
    {
        'kind': 'signature',
        'id': 'mixpi-karte-bleibt-am-login',
        'title': 'Frisch geschriebene Karte bleibt am root-Login — kein MixPi-Schirm',
        'sev': 'high',
        'match': 'bleibt beim root login stehen',
        'cause': (
            'Der Ein-Knopf-Assistent (sdstart) rief prepare_boot ohne lauf_paket, '
            'handy und bake_agent. Alle drei stehen dann auf False, und JEDER Block, '
            'der etwas installiert, faellt weg. Auf die Boot-Partition kamen vier '
            'Dateien: dietpi.txt, dietpi-wifi.txt, config.txt und ein 546 Byte '
            'grosses Automation_Custom_Script.sh, das nur authorized_keys schreibt. '
            'DietPi laeuft dann tadellos durch (.install_stage=2) und endet am '
            'Login — es wurde ihm nie gesagt, dass eine MixPiBox daraus werden soll.'),
        'fix': (
            'prepare_boot mit lauf_paket=True aufrufen (zieht handy und bake_agent '
            'zwingend nach sich). Behoben in sdstart.py am 10.08.2026. '
            'ERKENNEN laesst sich der Fall an der Box: /home/dietpi/.mupibox fehlt, '
            '/opt/mupibox-tools fehlt, und `systemctl list-unit-files | grep -c mupi` '
            'gibt 0 zurueck, waehrend .install_stage schon auf 2 steht.'),
        'tags': ['sdkarte', 'installer', 'erstboot', 'dietpi', 'sdstart'],
        'body': (
            'GEMESSEN am 10.08.2026 an der Testbox (mixpi, 192.168.178.77): Die Karte '
            'war ueber WLAN erreichbar und der mitgegebene SSH-Schluessel lag richtig — '
            'alles, was der Assistent versprach, ausser der Software selbst.\n\n'
            'Das Installationspaket passt problemlos: mupibox.yaml + mupibox-app.yaml '
            'ergeben 53 Schritte, 46 Dateien, 17,7 MB bei null fehlenden Quellen; die '
            'ganze Vorbereitung belegt 27 MB, frei waren 94 MB auf einer '
            '127-MB-Boot-Partition.'),
    },
    {
        'kind': 'signature',
        'id': 'mixpi-selbstlauf-faengt-nicht-an',
        'title': 'Installationspaket liegt auf der Karte, der Selbstlauf faengt trotzdem nicht an',
        'sev': 'med',
        'match': 'nur-wenn-angefangen',
        'cause': (
            'mixpibox-selbstlauf.service startet selbstlauf.py mit '
            '--nur-wenn-angefangen. Das Skript endet still, solange '
            '/var/lib/mixpibox-lauf/stand.json fehlt. Der Riegel ist Absicht: die '
            'Unit laeuft bei JEDEM Start, um einen von einem Neustart unterbrochenen '
            'Lauf fortzusetzen — von allein anfangen darf sie deshalb nicht, sonst '
            'richtete sich jede bespielte Karte ohne Zustimmung ein. Die Standdatei '
            'IST die Zustimmung.'),
        'fix': (
            'Entweder am Einrichtungsbildschirm der Box starten (QR + Pair-Code, vom '
            'Telefon), ODER die Zustimmung beim Schreiben mitgeben: prepare_boot mit '
            'sofort_starten=True legt im Erstboot '
            '{"fertig": [], "gescheitert": null} nach '
            '/var/lib/mixpibox-lauf/stand.json. Das ist zulaessig, wenn der Mensch '
            'schon im Assistenten die rote Rueckfrage bestaetigt hat — die zweite '
            'Frage waere dieselbe Frage.'),
        'tags': ['installer', 'selbstlauf', 'erstboot', 'systemd'],
        'body': (
            'Zu pruefen an der Box: `ls -l /var/lib/mixpibox-lauf/stand.json` und '
            '`systemctl status mixpibox-selbstlauf`. Ist die Unit „inactive (dead)" '
            'mit Rueckgabe 0 und die Datei fehlt, ist es genau dieser Fall — und '
            'KEIN Fehler.'),
    },
    {
        'kind': 'signature',
        'id': 'dietpi-unknown-install-state-erstlauf',
        'title': 'DietPi: blauer Kasten „Unknown install state / First run setup failed"',
        'sev': 'high',
        'match': 'Unknown install state',
        'cause': (
            'NOCH NICHT GEKLAERT (Stand 10.08.2026). DietPis Erstlauf bricht ab und '
            'meldet: „An error has occurred either during first run update or '
            'installs." Danach zeigt er einen whiptail-Dialog und fragt, ob der '
            'letzte Schritt interaktiv wiederholt werden soll — an einer Box ohne '
            'Tastatur bleibt er dort stehen. Beobachtet auf RPi 5 / aarch64 / '
            'Trixie, mit AUTO_SETUP_AUTOMATED=1 und LEEREM '
            'AUTO_SETUP_INSTALL_SOFTWARE_ID.'),
        'fix': (
            'ZUERST DAS PROTOKOLL LESEN, nicht raten: '
            '/var/lib/dietpi/logs/dietpi-firstrun-setup.log — DietPi nennt die Datei '
            'im Dialog selbst. Dort steht, welcher Schritt scheiterte. '
            'Am Dialog `Cancel` waehlen, nicht `Ok`: `Ok` startet die Einrichtung neu '
            'und ueberschreibt moeglicherweise die Spur. '
            'ACHTUNG, ZWEI FALSCHE FAEHRTEN, beide am 10.08.2026 selbst verfolgt: '
            '(1) Es ist KEINE unbeantwortete Lizenzfrage — AUTO_SETUP_ACCEPT_LICENSE '
            'gehoert auf Trixie zwar gesetzt, verhindert aber diesen Dialog nicht. '
            '(2) Der abgelehnte SSH-Schluessel bedeutet NICHT, dass '
            'Automation_Custom_Script.sh kaputt ist — es laeuft am ENDE der '
            'Erstinstallation, also nach dem Abbruch gar nicht mehr.'),
        'tags': ['dietpi', 'erstboot', 'installer', 'offen'],
        'body': (
            'OFFENER PUNKT. Verdacht, ausdruecklich unbelegt: ein leeres '
            'AUTO_SETUP_INSTALL_SOFTWARE_ID koennte DietPis Zustandsautomaten in '
            'einen Zustand fuehren, den er nicht kennt. Das steht im Log — wer diesen '
            'Eintrag liest, sollte ihn danach ergaenzen oder ersetzen.'),
    },
    {
        'kind': 'signature',
        'id': 'dietpi-raw-githubusercontent-nicht-aufloesbar',
        'title': 'Erstlauf bricht ab: Could not resolve host: raw.githubusercontent.com',
        'sev': 'high',
        'match': 'Could not resolve host: raw.githubusercontent.com',
        'cause': (
            'DietPis Erstlauf holt seine Versionsnummer von raw.githubusercontent.com. '
            'Schlaegt die Namensaufloesung GENAU DANN fehl, reisst das die ganze '
            'Erstinstallation ab („Unknown install state / First run setup failed"). '
            'Es ist meist NICHT ein kaputtes Netz: am 10.08.2026 im Protokoll gelesen — '
            'curl scheiterte an dem Namen, und DREI ZEILEN SPAETER holte derselbe '
            'Rechner 11,2 MB von deb.debian.org, dietpi.com und archive.raspberrypi.com. '
            'Der Name hat es besonders schwer, weil er KEINE IPv6-Adresse hat und ein '
            'junger Funk gern zuerst ueber IPv6 fragt.'),
        'fix': (
            'Im Vorstart NICHT „zwei von drei Namen genuegen" pruefen. Genau diese '
            'Mehrheitsregel liess den einen Namen durch, an dem alles haengt: '
            'raw.githubusercontent.com MUSS aufloesen, dazu mindestens eine Paketquelle. '
            'Geaendert in sdprep.py (dns_wirklich_da) am 10.08.2026. '
            'AM GERAET, wenn es schon passiert ist: einfach wiederholen — im Dialog '
            '<Ok>, oder `ssh -t root@box` und dort dietpi-launcher. Das Netz steht '
            'dann in aller Regel laengst.'),
        'tags': ['dietpi', 'dns', 'erstboot', 'installer'],
        'body': (
            'MERKMAL ZUM UNTERSCHEIDEN: DietPi meldet vorher „[OK] Checking DNS '
            'resolver" — die eigene Pruefung geht also durch, waehrend der eine Name '
            'trotzdem nicht aufloest. Wer nur auf diese Zeile schaut, sucht den Fehler '
            'an der falschen Stelle.'),
    },
    {
        'kind': 'signature',
        'id': 'dietpi-ohne-term-endlosschleife',
        'title': 'DietPi-Skripte ohne TERM: Syntaxfehler und Endlosschleife',
        'sev': 'med',
        'match': 'No value for $TERM and no -T specified',
        'cause': (
            'dietpi-globals rechnet ungeprueft mit `$(tput cols)`. Ohne $TERM liefert '
            'tput nichts, und aus `(( $(tput cols) <= 120 ))` wird '
            '„((: <= 120 : syntax error: operand expected". dietpi-login laeuft danach '
            'endlos im Kreis und wiederholt seinen Kopf.'),
        'fix': (
            'TERM setzen. Ueber SSH: `ssh -t box` (weist ein Terminal zu) statt '
            '`ssh box \'befehl\'`. In einem systemd-Dienst oder Skript: '
            '`export TERM="${TERM:-linux}"` vor dem Aufruf. Gesetzt in vorstart.sh vor '
            '/boot/dietpi/dietpi-software am 10.08.2026.'),
        'tags': ['dietpi', 'ssh', 'systemd', 'terminal'],
        'body': (
            'TRIFFT ZWEI STELLEN, die man leicht getrennt betrachtet: den Menschen, der '
            'per ssh ein DietPi-Skript startet — und jeden eigenen Dienst, der dasselbe '
            'tut. Beim Menschen sieht man die Schleife; im Dienst sieht sie niemand.'),
    },
    {
        'kind': 'signature',
        'id': 'dietpi-accept-license-trixie',
        'title': 'Trixie fragt nach der Lizenzzustimmung — aeltere Abbilder kannten den Schluessel nicht',
        'sev': 'med',
        'match': 'AUTO_SETUP_ACCEPT_LICENSE',
        'cause': (
            'Bei AUTO_SETUP_AUTOMATED=1 darf nie ein whiptail-Dialog kommen; an einer '
            'Box ohne Tastatur wartet er fuer immer. Neuere DietPi-Fassungen fragen '
            'beim Erstlauf nach der Lizenzzustimmung.'),
        'fix': (
            'AUTO_SETUP_ACCEPT_LICENSE=1 in die dietpi.txt. Kennt ein Abbild den '
            'Schluessel nicht, ueberliest DietPi ihn — der Preis fuer „steht da, wird '
            'ignoriert" ist eine Zeile, der fuer „fehlt" eine stehende Box.'),
        'tags': ['dietpi', 'erstboot', 'trixie'],
        'body': (
            'DIE LEHRE IST GROESSER ALS DER SCHLUESSEL: Im Code stand als Begruendung '
            '„die Fassung auf der Karte kennt den Schluessel nicht (null Vorkommen)". '
            'Das war gemessen und richtig — an EINEM Abbild. Ab dem Tag, an dem der '
            'Assistent auf Trixie umgestellt wurde, war die Folgerung falsch. Eine '
            'Messung bindet das Gemessene, nicht die Gattung. Es gab sogar einen Test, '
            'der den alten Befund als Waechter festhielt („kein erfundener '
            'Lizenzschluessel") — der musste mit umgedreht werden.'),
    },
    {
        'kind': 'signature',
        'id': 'brcmf-p2p-unkown-frame-harmlos',
        'title': 'brcmf_p2p_send_action_frame: Unkown frame — harmlos',
        'sev': 'low',
        'match': 'brcmf_p2p_send_action_frame',
        'cause': (
            'Der Broadcom-WLAN-Treiber (brcmfmac) notiert 802.11-Action-Frames, die er '
            'im P2P-Pfad nicht behandelt — category 0xa ist ein Public Action Frame, '
            'gesendet von irgendeinem Wi-Fi-Direct-faehigen Geraet im Netz (Fernseher, '
            'Drucker, Telefon). Der Tippfehler „Unkown" steht so im Treiberquelltext.'),
        'fix': (
            'NICHTS TUN — es ist kein Fehler und haelt nichts auf. Dass die Meldung '
            'ueberhaupt auf dem Schirm der Box steht, liegt an debug_display=True im '
            'Kartenschreiber: das schaltet die Konsole auf das Display. Wer eine Box '
            'einrichtet und Kernelmeldungen sieht, haelt das zu Recht fuer einen '
            'Fehler — der Startbildschirm konkurriert dann mit einer Textwand um '
            'denselben Framebuffer.'),
        'tags': ['wlan', 'kernel', 'schirm', 'harmlos'],
        'body': 'Am 10.08.2026 vom Betreiber als vermeintlicher Installationsfehler gemeldet.',
    },
    {
        'kind': 'signature',
        'id': 'bootsplash-fragezeichen-psf-schrift',
        'title': 'Startbild: hinter jedem Schritt steht ein Fragezeichen',
        'sev': 'med',
        'match': 'Fragezeichen',
        'cause': (
            'Die Konsolenschrift ist eine PSF-Datei mit 256 Zeichen. '
            'mupibox-boot-splash.py haengt an jeden Meilenstein ein U+2026 an: '
            'beschriftung = (offen + " …"). ord("…") ist 8230, also weit ausserhalb, '
            'und der Rueckfall in der Schriftklasse ersetzt jedes unbekannte Zeichen '
            'durch "?" (if i >= self.anzahl: i = ord("?")). Ergebnis: hinter JEDEM '
            'Schritt ein Fragezeichen — nicht einmal, sondern immer.'),
        'fix': (
            'Im Startbild nur ASCII verwenden: " ..." statt " …". Und einen Test '
            'dazu, der ALLE gemalten Zeichenketten gegen die Zeichenzahl der Schrift '
            'prueft — sonst faellt das naechste Sonderzeichen (Anfuehrungszeichen, '
            'Gedankenstrich, Haken) genauso durch, und niemand sieht den Grund.'),
        'tags': ['startbild', 'schrift', 'framebuffer', 'psf'],
        'body': (
            'FALSCHE FAEHRTEN, beide am 10.08.2026 selbst verfolgt und verworfen: '
            'Der Boxname war es NICHT (mupibox.host stand korrekt auf MixPiBox, und '
            'der Rueckfall in boxname() heisst ebenfalls MixPiBox). Das fehlende Logo '
            'war es auch nicht — das ist ein zweiter, unabhaengiger Fehler. '
            'Wer „ein Fragezeichen im Startbild" liest, denkt zuerst an einen '
            'fehlenden Wert; hier fehlt aber ein Zeichen in der SCHRIFT.'),
    },
    {
        'kind': 'signature',
        'id': 'bootsplash-logo-wird-nicht-gefunden',
        'title': 'Startbild zeigt den gezeichneten Kopf statt des MixPi-Bildes',
        'sev': 'low',
        'match': 'mixpi-hoert.png',
        'cause': (
            'Die Liste LOGOS in mupibox-boot-splash.py sucht an drei Orten, die alle '
            'aus der MuPiBox-Zeit stammen: /var/www/images/mupi_round_trans.png, '
            '…/www/assets/icon/favicon.png, /boot/splash.png. Auf der Box liegt '
            'mixpi-hoert.png an ANDEREN Stellen — gemessen am 10.08.2026: '
            '/opt/mixpibox-einrichtung/, /boot/firmware/einrichtung/ und '
            '/boot/firmware/einrichtung/vorstart/. Findet der Splash nichts, malt er '
            'seinen eigenen Kopf; das sieht nach Absicht aus und ist deshalb schwer '
            'als Fehler zu erkennen.'),
        'fix': (
            'LOGOS um die tatsaechlichen Pfade ergaenzen UND das Rezept die Datei '
            'neben das Splash-Skript legen lassen. Beides, nicht eines: eine Liste, '
            'die auf einen Ort zeigt, den niemand befuellt, ist genauso still.'),
        'tags': ['startbild', 'rezept', 'bild'],
        'body': 'Nachsehen mit: find / -name "mixpi-hoert.png" — und die Treffer gegen LOGOS halten.',
    },
    {
        'kind': 'signature',
        'id': 'mixpi-zwei-kopien-boot-splash',
        'title': 'Startbild zeigt den alten Namen — zwei Kopien derselben Datei',
        'sev': 'med',
        'match': 'boot-splash',
        'cause': (
            'mupibox-boot-splash.py liegt ZWEIMAL: in scripts/mupibox/ (Fork) und in '
            'remote-step-installer/tools/. Am 10.08.2026 waren sie in 114 Zeilen '
            'auseinander — die Fork-Fassung liest den Boxnamen (titel = boxname()), '
            'die Installer-Fassung hatte „MuPiBox" fest im Code. Verschaerft durch '
            'ZWEI ZIELPFADE auf der Box: /usr/local/bin/mupibox/… (gut, vom '
            'Skriptschritt) und /usr/local/bin/…-boot-splash.py (alt, vom '
            'Splash-Schritt) — die Unit ruft den zweiten.'),
        'fix': (
            'Das Rezept zieht die Datei aus ${MUPI_REPO}/scripts/mupibox/, nicht aus '
            'tools/. Allgemein: wo eine Datei in beiden Repos liegt, gehoert EINE als '
            'Quelle bestimmt — sonst gewinnt der Zufall der Schrittreihenfolge.'),
        'tags': ['startbild', 'rezept', 'doppelte-datei'],
        'body': 'Erkennen: md5sum ueber beide Kopien vergleichen, bevor man den Fehler im Code sucht.',
    },
    {
        'kind': 'signature',
        'id': 'mixpi-enable-startet-nicht-im-laufenden-boot',
        'title': 'Unit ist enabled, lief aber nie — Erstboot kommt nach multi-user.target',
        'sev': 'high',
        'match': 'ExecMainStartTimestamp=',
        'cause': (
            '`systemctl enable` setzt nur den Link fuer den NAECHSTEN Start. Das '
            'Automation_Custom_Script.sh laeuft aber mitten in der '
            'DietPi-Erstinstallation — also lange nachdem multi-user.target erreicht '
            'war. Eine dort erst angelegte Unit wird in diesem Boot nicht mehr '
            'gestartet, und wenn DietPi danach nicht neu startet, passiert gar nichts.'),
        'fix': (
            'Im Erstboot zusaetzlich `systemctl start --no-block <unit>` aufrufen. '
            '`--no-block`, wenn der Dienst lange laeuft: die Erstinstallation darf '
            'nicht darauf warten. Behoben fuer mixpibox-selbstlauf am 10.08.2026.'),
        'tags': ['systemd', 'erstboot', 'dietpi', 'installer'],
        'body': (
            'ERKENNUNGSZEICHEN an der Box: `systemctl is-enabled <unit>` sagt '
            '"enabled", `is-active` sagt "inactive", und `systemctl show <unit> -p '
            'ExecMainStartTimestamp` gibt einen LEEREN Wert zurueck — die Unit ist '
            'also nie gelaufen, nicht etwa gescheitert.\n\n'
            'GEMESSEN am 10.08.2026 an der Testbox: Boot 18:19:56, Unit-Datei '
            '18:22:14, ein einziger Boot im Journal. Sichtbare Folge: der '
            'Einrichtungsschirm zeigte weiter QR und Pair-Code statt „Das Grundsystem '
            'wird eingerichtet", weil niemand einen Lauf begonnen hatte, dessen '
            'Fortschritt er haette anzeigen koennen.'),
    },
    {
        'kind': 'signature',
        'id': 'mixpi-zwei-wechseldatentraeger-ein-leser',
        'title': 'Kartenschreiber meldet zwei Wechseldatentraeger, es ist aber ein Leser mit zwei Schaechten',
        'sev': 'med',
        'match': 'Wechseldatenträger gefunden',
        'cause': (
            'Ein Mehrfach-Kartenleser meldet JEDEN Schacht als eigenes Laufwerk, auch '
            'den leeren. Der leere hat 0 Byte und keine Partitionen. Es sind KEINE '
            'zwei Partitionen — die filtert `type != "disk"` schon weg — und auch '
            'keine zwei Geraete: in sysfs unterscheiden sie sich nur in der LUN '
            '(…/target0:0:0/0:0:0:0 gegen 0:0:0:1), Hersteller und Seriennummer sind '
            'gleich. Das Kernelprotokoll sagt es woertlich: '
            '"sd 0:0:0:1: [sdb] Media removed, stopped polling".'),
        'fix': (
            'Geraete mit GEMESSENER Groesse 0 gehoeren nicht in die Auswahl. WICHTIG: '
            'nur die gemessene Null sperren, nie eine unbekannte Groesse — eine frisch '
            'gesteckte Karte kann kurz 0 melden, und wer beides zusammenwirft, sperrt '
            'echte Karten aus. In geraete.py trennt `_bytes()` genau das (None = '
            'unbekannt, sperrt nie). Und „zieh alle ab ausser der einen" ist bei einem '
            'Mehrfachleser NICHT befolgbar: beide Schaechte haengen am selben Stecker.'),
        'tags': ['sdkarte', 'kartenleser', 'lsblk', 'geraete'],
        'body': (
            'Nachsehen mit: `lsblk -b -o PATH,SIZE,HCTL,SERIAL`. Gleiche SERIAL und '
            'gleiche HCTL-Wurzel (0:0:0 vor dem letzten Doppelpunkt) heisst: ein '
            'Geraet, mehrere Faecher.'),
    },
    {
        'kind': 'signature',
        'id': 'mixpi-windows-bustype-8-ist-raid',
        'title': 'Windows: eingebauter SD-Leser wird nie angeboten, RAID-Verbund dagegen schon',
        'sev': 'high',
        'match': 'kein Wechseldatentraeger',
        'cause': (
            'In der Aufzaehlung MSFT_Disk.BusType ist 8 = RAID, nicht SD/MMC. SD ist '
            '12, MMC ist 13. Wer 8 fuer wechselbar haelt, bietet einen RAID-Verbund '
            'zum Beschreiben an und weist zugleich den eingebauten Kartenleser jedes '
            'Notebooks mit „kein Wechseldatentraeger" ab.'),
        'fix': 'In windows_auswerten die Bustypen (7, 12, 13) zulassen — behoben 10.08.2026.',
        'tags': ['windows', 'geraete', 'sdkarte', 'get-disk'],
        'body': 'NICHT an einem Windows gemessen — die Zahlen stammen aus der dokumentierten Aufzaehlung.',
    },
    {
        'kind': 'signature',
        'id': 'mixpi-grab-set-vor-wait-visibility',
        'title': 'Tkinter: grab failed: window not viewable',
        'sev': 'high',
        'match': 'grab failed: window not viewable',
        'cause': (
            'grab_set() wurde aufgerufen, bevor der Fenstermanager das Toplevel '
            'aufgezogen hatte. UNTER Xvfb faellt das NICHT auf: dort laeuft kein '
            'Fenstermanager, ein Toplevel ist sofort sichtbar, und derselbe Aufruf '
            'gelingt. Auf einem echten Schreibtisch stirbt er.'),
        'fix': (
            'wait_visibility() VOR grab_set(), und den Griff ans Ende des Aufbaus. '
            'Und grundsaetzlich: ein Bildschirmfoto aus Xvfb beweist, wie etwas '
            'AUSSIEHT — nicht, dass es auf einem Schreibtisch laeuft.'),
        'tags': ['tkinter', 'oberflaeche', 'xvfb', 'test'],
        'body': 'Am 08.08.2026 im Karteninstaller passiert; dieselbe Falle lag laenger im aelteren sdgui.py.',
    },
    {
        'kind': 'signature',
        'id': 'mixpi-rueckfrage-nicht-ans-ziel-gebunden',
        'title': 'Loesch-Rueckfrage nennt Karte A und schreibt auf Karte B',
        'sev': 'high',
        'match': 'Karte löschen und schreiben',
        'cause': (
            'Die Rueckfrage las das Ziel nur zum Beschriften und gab es nicht weiter; '
            'beim Schreiben wurde die Auswahl ein ZWEITES Mal frisch gelesen. Der '
            'Suchtakt laeuft dabei weiter — grab_set() haelt Maus und Tastatur auf, '
            'Zeitgeber nicht. Wer die Karte zwischen Aufziehen und Klicken wechselt, '
            'bekommt ein Fenster, das A nennt, und ein dd, das B trifft.'),
        'fix': (
            'Das Ziel beim Aufziehen EINFRIEREN (eine Kopie, kein Verweis) und '
            'durchreichen; die Suche anhalten, solange gefragt wird; unmittelbar vor '
            'dem Schreiben noch einmal pruefen, ob im Schacht dasselbe Medium steckt '
            '(Seriennummer, sonst Modell und Groesse). Behoben 10.08.2026.'),
        'tags': ['sdkarte', 'oberflaeche', 'datenverlust'],
        'body': 'Ein Geraetename ist keine Karte: /dev/sdb bleibt /dev/sdb, wenn jemand das Medium tauscht.',
    },
]


def laden():
    import yaml
    return yaml.safe_load(PACK.read_text(encoding='utf-8'))


def eintragen(trocken=False):
    import yaml
    paket = laden()
    vorhanden = {e.get('id'): i for i, e in enumerate(paket['entries'])}
    neu, ersetzt = [], []
    for e in EINTRAEGE:
        if e['id'] in vorhanden:
            if paket['entries'][vorhanden[e['id']]] != e:
                ersetzt.append(e['id'])
                if not trocken:
                    paket['entries'][vorhanden[e['id']]] = e
        else:
            neu.append(e['id'])
            if not trocken:
                paket['entries'].append(e)
    if trocken:
        return neu, ersetzt, paket
    if neu or ersetzt:
        # DIE VERSION ZAEHLT MIT. Der Zwischenspeicher des Installers vergleicht
        # sie; ohne Erhoehung haelt er seinen alten Stand fuer aktuell.
        paket['version'] = int(paket.get('version', 0)) + 1
        PACK.write_text(
            yaml.safe_dump(paket, allow_unicode=True, sort_keys=False, width=100),
            encoding='utf-8')
    return neu, ersetzt, paket


def in_den_cache():
    """Ohne diesen Schritt sieht `rsi diagnose` gar nichts — der Controller
    sucht im Zwischenspeicher, nicht im Baum."""
    lauf = subprocess.run(
        [sys.executable, str(WIKI_PY), 'fetch', str(PACK), '--as', 'mupibox'],
        capture_output=True, text=True, timeout=300)
    return lauf.returncode, (lauf.stdout or lauf.stderr).strip()[:400]


if __name__ == '__main__':
    trocken = '--pruefen' in sys.argv[1:]
    neu, ersetzt, paket = eintragen(trocken=trocken)
    print(f"  Paket: {len(paket['entries'])} Eintraege, Version {paket.get('version')}")
    for i in neu:
        print(f"  {'fehlt' if trocken else 'neu':7} {i}")
    for i in ersetzt:
        print(f"  {'anders' if trocken else 'ersetzt':7} {i}")
    if not neu and not ersetzt:
        print('  alles schon drin und unveraendert')
    if trocken:
        sys.exit(1 if (neu or ersetzt) else 0)
    rc, meldung = in_den_cache()
    print(f"\n  In den Zwischenspeicher geholt: {'ok' if rc == 0 else 'FEHLGESCHLAGEN'}")
    print(f"  {meldung}")
    sys.exit(0 if rc == 0 else 1)
