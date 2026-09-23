# llmwiki_mupibox

**Ein versionierbares Wissenspaket („llmwiki") für die MuPiBox** — die Pi/DietPi-
Kinder-Musikbox. Es bündelt die hart erarbeiteten Lektionen: Workarounds (rpi-eeprom
auf Trixie, der hängende Bluetooth-Schritt, nodesource, Waveshare-DSI), die
Pi-5-KMS-Regeln, die Perf-/Cache-Optimierungen und die Spotify-/Boot-SD-Besonderheiten.

Es ist **Daten, kein Code** — Mensch *und* LLM lesen es, es wird nie automatisch
ausgeführt. Gedacht zum Konsum durch den [remote-step-installer](http://git.local:3000/achim/remoteinstaller.git):

```sh
# einmal holen (in den Wiki-Cache des Controllers):
python3 controller/wiki.py fetch http://git.local:3000/achim/llmwiki_mupibox.git

# dann nutzen — als Diagnose-/Config-/Perf-Zusatzwissen und als LLM-Kontext:
python3 controller/rsi.py diagnose <run_id> --wiki mupibox
python3 controller/rsi.py diagnose <run_id> --wiki mupibox --llm
python3 controller/wiki.py context --wiki mupibox        # das ganze Briefing (Mensch/LLM)
python3 controller/wiki.py list    --wiki mupibox
```

## Format

Ein Paket ist ein Ordner mit `pack.yaml` (Manifest + `entries:`) und optionalen
`*.md`-Notizen. Jeder Eintrag hat ein `kind`:

| kind | füttert | Felder |
|------|---------|--------|
| `signature` | die Fehler-Diagnose | `match` (regex), `sev`, `cause`, `fix` |
| `config` | die Config-Analyse | `file`, `present`/`absent`/`present_all`, `models`, `requires`, `why`, `fix` |
| `perf` | die Perf-Analyse | `unit`, `action` (drop/consider/swap/consolidate), `why`, `action_text` |
| `note` / `howto` | Kontext für Mensch + LLM | nur `body` (Markdown) |

Format-Details: siehe `wiki/README.md` im remote-step-installer.

## Versionierung

`pack.yaml` trägt eine `version`. Neues Wissen ablegen und die Version hochziehen:

```sh
# im remote-step-installer:
python3 controller/wiki.py learn neue-lektion.md --wiki <pfad-zu-diesem-repo>
```

…oder `pack.yaml` direkt editieren. Danach hier committen + taggen (`git tag v2`),
damit ein `wiki fetch` reproduzierbar eine bestimmte Version holen kann.

Lizenz: MIT.
