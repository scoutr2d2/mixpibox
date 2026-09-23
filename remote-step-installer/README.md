# remote-step-installer

**Ein ferngesteuerter, schrittweiser Installer für Linux-/Pi-/DietPi-Zielsysteme** —
recipe-getrieben, für **mehrere Projekte** nutzbar. Statt eines monolithischen
Setup-Scripts, das bei jeder Kleinigkeit (fehlendes Paket, ein hängender Dienst …)
**einfriert, ohne Kontrolle**, treibt ein **Controller** die Installation vom Laptop aus
**Schritt für Schritt**: jeder Schritt lässt sich live beobachten, **abbrechen**,
wiederholen, überspringen, per **Workaround** (älteres Paket / anderer Befehl) ersetzen —
inkl. **Paketsuche** und (geplant) **LLM-Hilfe**, die bei einem Fehler den Output
analysiert und einen Fix vorschlägt.

> Entstanden aus einem Setup-Krampf, bei dem ein hängender Schritt den ganzen Lauf bei
> 69 % einfror — **ohne Abbruchmöglichkeit**. Der Agent hier killt eine hängende
> Prozessgruppe auf Knopfdruck (und per Timeout automatisch). Das ist der Kern.

## Zwei Seiten

| | Wo | Was |
|-|----|-----|
| **Agent** (`agent/agent.py`) | auf dem Zielsystem, **als root** | pure Python-3-**stdlib** (kein pip!) → läuft auf einem frischen DietPi mit sonst nichts. Das **einzige**, was dort automatisch installiert wird. Führt einzelne Befehle aus, **streamt** den Output (SSE), **bricht** einen hängenden Schritt ab (killt die Prozessgruppe) oder killt ihn per **Timeout**, kann **Pakete suchen**, und **beendet + entfernt sich selbst** nach Abschluss. |
| **Controller** (`controller/`) | auf deinem Laptop — die steuernde „Client"-Seite | Hat die **Recipe** (Schritt-Liste) und steuert. **Code-Pairing wie Jellyfin**. **CLI** (`stepctl.py`) + moderne, **themebare Textual-TUI** (`tui.py`). Bei Fehler: retry / workaround / skip / abort / Paketsuche. |

Die **Recipe** liegt bewusst beim Controller (der steuert), nicht auf dem Zielsystem —
so kann derselbe Controller verschiedene Zielsysteme mit verschiedenen Recipes bespielen.

## Sicherheit (der Agent läuft als root!)

- **Code-Pairing:** der Agent zeigt beim Start einen 6-stelligen **Pair-Code**. Ohne den
  daraus gewonnenen Bearer-Token geht nichts außer `/pair`.
- **Nur localhost** by default → Zugriff via **SSH-Tunnel**. LAN-Bindung (`--host 0.0.0.0`)
  ist opt-in.
- **Selbst-Beendigung + Self-Remove** nach erfolgreichem Lauf — kein dauerhafter Root-Dienst.
- Recipes sind Code → nur vertrauenswürdige Recipes fahren.

## Schnellstart

```sh
# 0) Controller startklar machen (prüft alles, zieht Fehlendes nach)
./setup-controller.sh                # --check = nur prüfen · --yes = ohne Rückfragen
                                     # --venv  = ins .venv statt Systempakete (kein sudo)

# 1) erst mal OHNE Box ausprobieren (gefahrlos, es wird nichts installiert):
python3 agent/agent.py --port 8099                    # Terminal 1 → zeigt den PAIR CODE
./stepctl --recipe recipes/demo.yaml --pair <CODE>    # Terminal 2

# 2) echte Box: Agent hinbringen + starten (zeigt den Pair-Code)
scp -r agent dietpi@<box-ip>:/tmp/
ssh dietpi@<box-ip> 'sudo bash /tmp/agent/install-agent.sh'

# 3) am Laptop: Tunnel offen lassen, dann Controller (TUI oder CLI)
ssh -N -L 8099:localhost:8099 dietpi@<box-ip> &
./tui     --recipe recipes/mupibox.yaml --pair <CODE>   # moderne TUI (g = alle Schritte)
./stepctl --recipe recipes/mupibox.yaml --pair <CODE>   # oder CLI
```

> **Immer die Starter `./tui` `./stepctl` `./rsi` benutzen** (Repo-Root). Sie wählen den
> richtigen Python selbst — das lokale `.venv`, falls `setup-controller.sh` eins angelegt
> hat, sonst `python3`. Ein blankes `python controller/tui.py` nimmt dagegen den
> System-Python und scheitert, wenn die Pakete im venv liegen.
>
> Die Recipe darf angegeben werden, wie es gerade passt — `--recipe demo`,
> `recipes/demo.yaml`, `../recipes/demo.yaml` oder ein absoluter Pfad finden alle
> dieselbe Datei (egal aus welchem Verzeichnis gestartet); ein Tippfehler listet die
> vorhandenen Recipes auf.

`setup-controller.sh` prüft Python 3.9+, PyYAML (Recipes), textual (TUI), ssh/git und die
Wissenspakete — und installiert Fehlendes **bevorzugt als Distro-Paket**, sonst in ein
lokales `.venv` (systemweites `pip install` ist auf Arch/CachyOS und Debian 12+ gesperrt).
Es holt/aktualisiert auf Wunsch auch das MuPiBox-Wissenspaket.

## Steuerung durch den Chat / ein LLM (`controller/rsi.py`)

Der eigentliche Clou: **ein Assistent im Chat (Claude) fährt die Installation** — er
komponiert Befehle, liest den gestreamten Output, entscheidet den nächsten Schritt oder
Workaround, sucht Pakete. `rsi.py` ist die **headless Schnittstelle** dafür (jeder Aufruf
macht EINE Sache und gibt das Ergebnis zurück, Exit `0`=ok / `2`=fehlgeschlagen):

```sh
python3 controller/rsi.py pair --base http://127.0.0.1:8099 --pair <CODE>   # einmal pairen (Token gecacht)
python3 controller/rsi.py list  --recipe recipes/mupibox.yaml               # Schritte ansehen
python3 controller/rsi.py run node --recipe recipes/mupibox.yaml            # einen Recipe-Schritt fahren
python3 controller/rsi.py exec "apt-get install -y rpi-eeprom" --timeout 120  # Ad-hoc-Fix (streamt live)
python3 controller/rsi.py search rpi-eeprom                                 # Paket nachschlagen
python3 controller/rsi.py perf                                             # Boot-/Laufzeit-Analyse + Optimierungs-Vorschläge
python3 controller/rsi.py config                                           # Config-Analyse (config.txt & Co. gegen Regeln, Secrets maskiert)
python3 controller/rsi.py sysinfo                                          # Umgebung erkennen (DietPi/Debian-Version, Pfade, Modell)
python3 controller/rsi.py diagnose <run_id> --wiki mupibox                 # Fehler diagnostizieren (bekannt + UNBEKANNT)
python3 controller/rsi.py diagnose <run_id> --wiki mupibox --llm           # ... und den konfigurierten LLM fragen
python3 controller/rsi.py wiki --wiki mupibox                              # Projekt-Wissen ansehen (llmwiki)
python3 controller/rsi.py abort <run_id>                                    # Hänger killen
python3 controller/rsi.py shutdown --remove                                 # fertig + Agent entfernt sich
```

**So läuft eine Session:** du startest den Agent auf der Box + den SSH-Tunnel und gibst
dem Assistenten den Pair-Code — dann treibt er die Installation über diese Aufrufe, du
schaust zu und greifst ein, wenn du willst. Der **Mensch behält die Kontrolle** (Tunnel +
Code + Self-Remove); der Assistent ist nur der Fahrer, keine Direktverbindung ins System.

## Der kurze Weg: `./sdstart` — ein Knopf

Wer nur eine Box wiederhaben will, braucht keine sieben Fragen:

```sh
./sdstart                        # fragt nach dem Pi, dann Karte rein und klicken
./sdstart --board RPi4           # Board vorwaehlen, dann entfaellt die Frage
./sdstart --probe                # NUR ANSEHEN: Attrappen-Karte, kein Netz,
                                 # kein Schreiben. Der Lauf wird nachgespielt.
./sdstart --trocken              # der echte Probelauf: laedt und prueft das
                                 # Abbild wirklich, schreibt aber nicht
```

Sieben Seiten, jede mit ihrem Bild: **Willkommen** · **Welcher Pi?** (4 oder 5
— das Einzige, was das Programm nicht selbst sehen kann) · **WLAN** ·
**Name und Passwort** · **Die Karte** mit dem Knopf · **Es läuft** ·
**Fertig, Karte in die MixPi**.

Der Ein-Knopf-Gedanke bleibt: **jede Seite steht schon ausgefüllt da** — das
WLAN, in dem dieser Rechner gerade online ist, samt Schlüssel; der Name
`mixpi`; das Passwort `mupibox`. Wer nichts ändern will, klickt durch.

Zwei Dinge sind gesetzt und werden nicht gefragt:

* **DietPi Trixie**, nicht „das Neueste". dietpi.com bietet Bookworm, Trixie
  und Forky an; das Neueste wäre Forky. Trixie ist DietPis eigener Standard
  und der Stand, auf dem diese Box gemessen wurde (Debian 13, DietPi 10.5.2 —
  `dateien/stueckliste.txt`). Gibt es Trixie für ein Board nicht, weicht es
  aus und **sagt es im Protokoll**.
* **Der Bildschirm ist ab dem ersten Start an** (`debug_display=True` hängt
  das DSI-Panel in die `config.txt`). Ohne das richtet erst der Controller die
  Anzeige ein — und genau dahin kommt man nicht, wenn die Box nicht ins Netz
  findet.

Es entscheidet alles selbst und zeigt nur, **was** es entschieden hat: die
eingesteckte Wechselkarte, das neueste schlichte DietPi (mit SHA256 geprüft),
das WLAN, in dem **dieser Rechner gerade online ist** (samt Schlüssel aus
seinem eigenen Profil — der einzige, von dem bewiesen ist, dass er stimmt),
und den SSH-Schlüssel dieses Rechners.

Vor dem Schreiben kommt **eine** Rückfrage: sie nennt Modell, Größe und Gerät
und sagt in roter Schrift, dass alles gelöscht wird. Abgebrochen wird mit
Escape, Eingabe oder dem linken Knopf — der löschende ist rot, beschriftet mit
dem, was er tut, und **nicht** vorausgewählt. Getippt wird nichts.

> Stecken **mehrere** Wechseldatenträger, bleibt der Knopf zu. Geraten wird
> hier nicht; eine falsch getroffene Platte ist nicht rückgängig zu machen.

Wer mehr steuern will (Board, Abbild, Rechnername, Haken, Handy-Einrichtung),
nimmt weiterhin `./sdtui` oder `./sdgui`.

## Schritt 0: SD-Karte vorbereiten (`./sdprep`)

Macht aus einer leeren Karte ein **nacktes DietPi** — alles Weitere fährt danach der
Controller. Board wählen → DietPi-Variante wählen → Image laden (mit SHA256-Prüfung) →
schreiben → Boot-Partition mounten → WLAN, SSH und deinen SSH-Schlüssel eintragen.

> **Der Agent wird NICHT mit auf die Karte gebacken.** `./connect <box> --install`
> bringt ihn in Sekunden per SSH hin — und zwar immer die AKTUELLE Fassung statt der,
> die beim Schreiben der Karte zufällig aktuell war. (Wer ihn doch mitgeben will:
> `prepare_boot(..., bake_agent=True)`.)

```sh
./sdtui                          # ASSISTENT (TUI): Board → Variante → Karte → Einstellungen
./sdtui --write                  # ... ohne die Rückfrage nach dem Gerätenamen

./sdprep --list-images RPi5      # was gibt es? (Live von dietpi.com, nichts hartkodiert)
./sdprep --list-devices          # welche Karten sieht das System? (mit Ausschluss-Gründen)
```

In der Haupt-TUI stehen beide Vorstufen **als Schritte ganz oben in der Liste**
— der Weg beginnt schließlich bei der leeren Karte, nicht beim ersten Befehl auf
der Box:

```
○  SD-Karte schreiben (Schritt 0)          ← r = Assistent öffnen, s = überspringen
○  Box verbinden + Agent installieren      ← r = Agent hinbringen + pairen
○  DietPi-Erstinstallation abschliessen
○  …
```

Sie lassen sich wie jeder andere Schritt **überspringen** (`s`) — läuft die Box
schon, ist beides erledigt. „Alle Schritte" (`g`) lässt sie bewusst aus: eine
Karte zu überschreiben gehört nicht in einen Lauf, den man mit einer Taste
startet. Nach dem Verbinden übernimmt die TUI die frische Verbindung sofort, ohne
Neustart. (Die Tasten `0` und `c` gibt es weiterhin.)

Nach dem Schreiben **liest der Assistent die Karte zurück** und sagt Zeile für
Zeile, ob wirklich drauf ist, was drauf sein soll — WLAN-Eintrag, DietPis
vollständiger Variablensatz, Ländercode, Grafiktreiber, Panel-Overlay. Das kam
aus leidvoller Erfahrung: mehrere Läufe scheiterten still, und der Fehler zeigte
sich erst Minuten später beim Booten der Box.

Die WLAN-Auswahl liest die Netze **in Reichweite dieses Rechners** aus (`nmcli`,
ohne Rechte, ohne Passwörter — nur Namen); auf diesem Rechner gespeicherte Netze
stehen oben und sind mit ★ markiert. Eine von Hand getippte SSID ist sonst eine
der häufigsten Ursachen für eine Box, die sich nach dem Erstboot nie meldet.

Geschrieben wird erst, wenn du den **Gerätenamen abtippst** (`/dev/…`) — eine
Listenauswahl ist zu leicht versehentlich getroffen, und auf der falschen Zeile
steht die Systemplatte. `--write` überspringt diese Rückfrage bewusst nur für den
unbeaufsichtigten Gebrauch.

Die Bildliste wird **live geholt**, veraltet also nie; Sonder-Varianten (AlloGUI,
Amiberry) sind standardmäßig ausgeblendet — wir wollen ein nacktes System. Auf der
Karte landen nur `dietpi.txt` (automatisches Setup, **keine** Zusatzsoftware),
`dietpi-wifi.txt`, der Agent und ein `Automation_Custom_Script.sh`, das ihn beim
ersten Boot einrichtet und den Pair-Code zum Abholen hinterlegt.

> **Sicherheit beim Schreiben** (ein falsches Gerät zerstört Daten): angeboten werden
> nur Wechseldatenträger (removable/USB/MMC); jedes Gerät, auf dem `/`, `/home` oder
> `/boot` liegt, ist **hart ausgeschlossen** und wird mit Grund angezeigt; geschrieben
> wird erst nach Eintippen des Gerätenamens. Getestet: `tests/sdprep_test.py`
> (u.a. mit synthetischem `lsblk`-JSON gegen genau diese Verwechslung).

### WLAN einer **schon gebooteten** Karte umstellen (`controller/sdwlan.py`)

Die Box zieht um, das Netz heißt anders. Auf einer bereits gelaufenen Karte ist
`dietpi-wifi.txt` **wirkungslos** (nur Erstboot) und `add_wifi.json` steht auf
der Vorlage — wirksam ist allein `/etc/wpa_supplicant/wpa_supplicant.conf`, und
die gehört root.

```sh
udisksctl mount -b /dev/sdX2                 # die ext4-Partition
python3 controller/sdwlan.py --trocken       # zeigen, nichts schreiben
python3 controller/sdwlan.py                 # eintragen
udisksctl unmount -b /dev/sdX2
```

Ohne Argumente nimmt es das **aktive** WLAN dieses Rechners (nur dessen
Schlüssel ist bewiesen richtig) und findet die Karte selbst. Der Schlüssel wird
zum PSK gerechnet — **Klartext landet nirgends**, weder in der Datei noch in der
Ausgabe. Das **alte Netz bleibt stehen**: `eth0` ist auf der Box auskommentiert,
WLAN ist der einzige Weg hinein, und ein falscher Schlüssel hieße Karte wieder
ausbauen. Getestet: `tests/sdwlan_test.py` (32/32, PSK gegen die
IEEE-802.11i-Testvektoren).

## Box verbinden — ohne Pair-Code-Gefummel (`./connect`)

```sh
./connect 192.168.178.165              # Agent finden, Tunnel öffnen, Code holen, pairen
./connect 192.168.178.165 --install    # Agent auf eine BESTEHENDE Box bringen (kein Neuflashen)
./connect mupibox --watch              # verbunden BLEIBEN: übersteht Reboots von selbst
./connect mupibox --tunnel-only        # nur den Tunnel
```

> **`--watch` lohnt sich**, weil der Ablauf mehrere Neustarts enthält (DietPi-Erst-
> installation, Display-Overlays, Kiosk). Die Schleife meldet den Verlust, wartet auf
> die Box und macht Tunnel + Pairing selbst neu — mit Zeitstempel und Signalton.
> `./rsi watch` (Zuschauen) übersteht denselben Abriss: es liest den frischen Token
> nach und läuft weiter.

Danach brauchen TUI/CLI/rsi **kein `--pair` mehr** — der Token liegt im Cache:

```sh
./tui --recipe mupibox     ·     ./rsi sysinfo
```

`connect` meldet sich per normalem `ssh` an (Schlüssel, sonst fragt ssh nach dem
Passwort — es wird **nichts gespeichert** und kein Passwort in eine Kommandozeile
geschrieben), holt den Pair-Code (abgelegte Datei → root-Datei → journalctl) und öffnet
den Tunnel. `--install` richtet den Agent auf einer laufenden Box ein, sodass man auch
eine **bestehende MuPiBox adoptieren** kann, ohne die SD neu zu schreiben.

**Nach dem Passwort wird genau einmal gefragt.** Beim ersten Verbinden hinterlegt
`connect` deinen öffentlichen SSH-Schlüssel auf der Box (und erzeugt vorher einen, falls
keiner da ist) — über den bereits offenen Kanal, also ohne zusätzliche Eingabe. Danach
laufen alle weiteren Aufrufe passwortfrei, und `--watch` kann sich nach einem Neustart
der Box **von selbst** wieder verbinden, ohne dass jemand davorsitzt. Wer das nicht will:
`--no-key`. Der SD-Assistent legt denselben Schlüssel gleich mit auf die Karte, damit
eine frische Box vom ersten Start an passwortfrei erreichbar ist.

## Bunte Live-Anzeige (Pacman frisst die Pakete)

Eine Installation ist viel Warten vor einer Textwand. Die CLI zeigt deshalb während
jedes Schritts eine **farbige Live-Zeile** — Pacman frisst sich durch die Pakete, daneben
Phase, aktuelles Paket, Prozent und Laufzeit:

```
  [        ᗤ·●·ᗣ····●······●·] Entpacken  nodejs                     33%  0:02
  [                         ᗧ] Einrichten npm                       100%  0:03
  ✓ Node.js installieren · 3 Pakete (0:04)
```

Wo apt/nala eine echte Paketzahl verrät („N newly installed"), ist der Balken **echter
Fortschritt** — sonst hüpft Pacman als Aktivitätsanzeige. Die Ausgabezeilen werden nach
Art eingefärbt (Holen/Entpacken/Einrichten/Fehler/Warnung), deutsch und englisch erkannt.

> **Nur im echten Terminal.** In eine Pipe/Logdatei (oder mit `--plain`, `NO_COLOR=1`,
> `TERM=dumb`) bleibt die Ausgabe **roh und exakt parsebar** — sonst würden `rsi.py`,
> die LLM-Diagnose und die Logs Steuerzeichen abbekommen. Logik in `controller/anim.py`
> (pure, getestet: `tests/anim_test.py`).

## Diagnose — auch für UNBEKANNTE Probleme

Die Config-/Perf-Analyse kennt nur BEKANNTE Themen (Regel-Wissensbasen). Für alles
andere sammelt `diagnose` die realen Beweise (Output des gescheiterten Schritts +
generische System-Proben: kaputte Pakete, fehlgeschlagene Dienste, Platz/RAM, journald/
dmesg-Fehler, apt-Lock, DNS) und legt sie einem **Reasoner** vor — dem Chat-Assistenten
(urteilt über den ECHTEN Output, nicht über eine feste Tabelle) oder einem eingebauten
LLM (`--llm`, OpenAI-kompatibel via `RSI_LLM_URL`). Eine offene Signatur-Bibliothek
klassifiziert die häufigen Fingerabdrücke vorab; **was nichts matcht, ist genau das
unbekannte Problem → volle Evidenz + LLM**. Ein fehlgeschlagener Schritt weist selbst
auf `rsi.py diagnose <run_id>` hin.

## Wissen (llmwiki) — versionierbar, pro Projekt, für Mensch UND LLM

Die eingebauten Wissensbasen sind nur ein **Seed**. Angesammeltes Wissen (auch unsere
MuPiBox-Optimierungsschritte) liegt in **git-versionierbaren Wissenspaketen**, die man
pro Projekt getrennt führt, **holen** kann und die sowohl der Mensch als auch der LLM
nutzen — inspiriert vom Open Knowledge Format + Karpathys LLM-Wissen-Ansatz:

```sh
# NICHT MEHR HOLEN: das Repo llmwiki_mupibox.git ist seit 10.08.2026 stillgelegt.
# Das MuPiBox-Wissen liegt jetzt IM HAUPTBAUM, als gewöhnlicher Ordner:
#     ~/Downloads/MuPiBox/llmwiki/          → --wiki ~/Downloads/MuPiBox/llmwiki
# Ein `fetch` des alten Repos legt ~/.rsi/wiki/llmwiki_mupibox/ an. Dieser Ordner
# trägt dieselbe `id: mupibox` — `--wiki llmwiki_mupibox` serviert dann altes
# Wissen OHNE Warnung, und `--wiki all` mischt beide Fassungen doppelt.
# Siehe Wiki-Eintrag `stillgelegtes-repo-lebt-im-fetch-cache-weiter`.

python3 controller/wiki.py list    --wiki mupibox     # Überblick
python3 controller/wiki.py context --wiki mupibox     # Briefing (Mensch/LLM, konkateniert)
python3 controller/rsi.py diagnose <run_id> --wiki mupibox        # Signaturen + Kontext einmischen
python3 controller/rsi.py config           --wiki mupibox         # + Config-Regeln
python3 controller/rsi.py perf             --wiki mupibox         # + Perf-Hinweise
python3 controller/wiki.py learn lektion.md --wiki <paket-ordner> # neues Wissen ablegen (+ Version hoch)
```

Ein Wiki ist **Daten** (seine Fixes werden nur angezeigt, nie automatisch ausgeführt) →
das Holen aus einem fremden Repo ist risikoarm. Ohne `--wiki` wird das mitgelieferte
`generic`-Paket geladen. Format + Details: [`wiki/README.md`](wiki/README.md).

### Gefundene Fixes zurückschreiben (der „unbekannt → bekannt"-Kreislauf)

Findet die Analyse auf einer echten Box ein **neues Problem** und ein Fix klappt, kann
man das als Wiki-Eintrag **zurückschreiben** — dann ist es beim nächsten Mal *bekannt*
(die neue Signatur feuert automatisch in `diagnose`). Bewusst **nicht** still automatisch:
das Wiki ist geteiltes, versioniertes Wissen → ein **Review** gehört dazwischen (das Tool
schlägt vor, ein Mensch bestätigt).

```sh
# 1) Diagnose gibt aus einem unbekannten Fehler einen fertigen Signatur-ENTWURF aus:
python3 controller/rsi.py diagnose <run_id> --wiki mupibox --propose

# 2) cause/fix im Entwurf ausfüllen, dann als geprüften Eintrag aufnehmen:
python3 controller/wiki.py capture --wiki <wiki-repo-ordner> \
    --set kind=signature --set id=mupi-xyz \
    --set 'match=<regex>' --set 'cause=…' --set 'fix=…' --set 'source=…'
#    (fragt vor dem Schreiben nach; --yes, wenn das Review schon erfolgt ist, z.B. im Chat)

# 3) versionieren, damit andere es holen:  git commit && git tag vN && git push --tags
```

So macht auch **der Chat-Assistent** aus einem gemeinsam gefixten Problem einen
Wiki-Eintrag (er komponiert den Eintrag, zeigt ihn dir, `capture --yes` nach deinem OK).

## Eigene Pakete auf die Box bringen (`put:`)

Ein Recipe-Schritt kann Dateien **mitschicken**, bevor sein Befehl läuft — so
installiert man eigene Pakete, ohne dass die Box irgendetwas aus dem Netz holt:

```yaml
- id: app-paket
  put:
    - src: ${MUPI_REPO:-$HOME/Downloads/mixpibox}/bin/nodejs/deploy.zip   # $VARS + ${VAR:-fallback}
      dest: /tmp/mupi-deploy.zip
  run: unzip -o /tmp/mupi-deploy.zip -d "$MUPI_APP"
```

Das nutzt **`recipes/mupibox-app.yaml`**: es installiert **Frontend + Backend + Admin
aus DEINEM Fork** (`deploy.zip` = `server.js` + `spotify-control.js` + `www/`,
`AdminInterface/release/www.zip`), legt die Konfigurationsvorlagen an (**vorhandene
Configs/Tokens bleiben unangetastet**) und richtet die pm2-Dienste ein — genau der
Teil, der sonst im `autosetup` steckt, nur einzeln, abbrechbar und wiederholbar.

```sh
./tui --recipe mupibox-app               # wo der Fork liegt, findet der Controller selbst
export MUPI_REPO=/wo/auch/immer          # … nur nötig, wenn es ein anderer sein soll
```

## Recipes

Daten-getriebene Schritte (`recipes/*.yaml`): pro Schritt `run` (Befehl), optional
`check`, `timeout`, `optional` und `workarounds` (wählbare Alternativen). `mupibox.yaml`
ist die erste Recipe (das MuPiBox-Setup, inkl. der erarbeiteten Workarounds). Weitere
Projekte = weitere Recipes. Format: siehe [ARCHITECTURE.md](ARCHITECTURE.md).

## Stand / Roadmap

- [x] Agent: pair / run / **stream** / **abort** / timeout / **package-search** / self-remove (stdlib, smoke-getestet)
- [x] Controller-Kern + **CLI** (`stepctl.py`)
- [x] **Textual-TUI** (`tui.py`) — modern, themebar, Schritt-Liste + Live-Log. Headless gegen einen echten Agent getestet ✓ (run/fail/skip/**abort eines hängenden Schritts**/theme, 13/13; Textual 8.2.8)
- [x] **Chat-/Skript-Steuerung** (`controller/rsi.py`) — headless: pair/list/run/exec/search/status/abort/shutdown; ein Chat-Assistent (Claude) fährt den Install Schritt für Schritt (Exit 0/2). Getestet ✓
- [x] **Perf-Analyse** (`controller/perf.py` + Agent `/perf` + `recipes/perf-tune.yaml`) — Boot-Blame, gezielte Optimierung + **Tool-Konsolidierung/-Austausch** (nur was auf der Box präsent ist). Getestet ✓
- [x] **Config-Analyse** (`controller/configcheck.py` + Agent `/config`, secret-redigiert) — config.txt/cmdline/chromium/nodesource gegen eine Regel-Wissensbasis (Pi-5-KMS, fkms, framebuffer, DSI-Konflikt …), **modell-gegatet**, mit fertigen Fix-Befehlen. Getestet ✓
- [x] **Pi-Modell-Erkennung + -Auswahl** (`controller/model.py`, `--model`) — auto aus /proc/device-tree/model oder manuell (Test auf älterem Board); Regeln urteilen modell-korrekt. Getestet ✓
- [x] **Umgebungs-Erkennung** (`controller/sysinfo.py` + Agent `/sysinfo`) — Distro-Codename/DietPi-Version + reale Pfade (/boot vs /boot/firmware, DietPi-Dir); injiziert `$BOOT_DIR/$DIETPI_DIR` in Recipes → **arbeitet mit allen DietPi-Versionen** (Trixie-Default, Bookworm, Forky), `--distro`-Override. Getestet ✓
- [x] **Fehler-Diagnose auch für UNBEKANNTE Probleme** (`controller/diagnose.py` + Agent `/diagnose`) — sammelt Evidenz (Output-Tail + System-Proben) für Chat/LLM; offene Signatur-Bibliothek, gemischt mit dem llmwiki; optional eingebauter LLM (`--llm`). Getestet ✓
- [x] **Bunte Live-Anzeige** (`controller/anim.py`) — Pacman frisst die Pakete, echter Fortschritt aus der apt-Ausgabe, farbige Zeilen; TTY-geschützt (Pipe/`--plain` bleibt roh). Getestet ✓ (`tests/anim_test.py`, 26/26)
- [x] **llmwiki** (`controller/wiki.py` + `wiki/`) — versionierbare, pro-Projekt-Wissenspakete (Signaturen/Config/Perf/Prosa), holbar (`wiki fetch`), für Mensch UND LLM; MuPiBox-Wissen im Hauptbaum unter `llmwiki/` (das frühere Repo `llmwiki_mupibox` ist stillgelegt). Getestet ✓
- [ ] **Auto-Driver** (optional): ein *eingebautes* LLM (OpenAI-kompatibel: Ollama/Open WebUI/Copilot), das aus dem Diagnose-Bündel + llmwiki Fixes selbst komponiert — statt Chat/Mensch
- [ ] Workaround-Bibliothek weiter füllen (im llmwiki), Auth härten, Recipe 1:1 vervollständigen

Lizenz: MIT.
