# llmwiki — versionierbare Wissenspakete

Die drei hart eingebauten Wissensbasen (Diagnose-Signaturen, Config-Regeln,
Perf-Hinweise) sind nur ein **Seed**. Angesammeltes Wissen — projekt-spezifische
Lektionen, Fehler-Fingerabdrücke, How-tos — liegt hier als **portable, git-
versionierbare Wissenspakete**, die **Mensch UND LLM** konsumieren:

- **pro Projekt** (jedes Projekt kann sein Paket in seinem EIGENEN Repo führen),
- **versionierbar** (ein Paket sind nur Dateien → `git tag`),
- **holbar** („llmwiki holen": `wiki.py fetch <repo-oder-url>`), und
- **doppelt nutzbar**: `signatures()/config_rules()/perf_hints()` mischen die
  typisierten Einträge in die Analyzer; `context()` konkateniert die Prosa zu einem
  LLM-/Mensch-Briefing.

Inspiriert vom **Open Knowledge Format** (strukturierte, portable Metadaten) und von
Karpathys Gedanken zu LLM-tauglichem Wissen (Markdown, konkatenierbar).

> **Sicherheit:** ein Wiki ist **Daten** — seine `fix`/`action`-Texte werden Mensch/LLM
> nur ANGEZEIGT, nie automatisch ausgeführt (anders als eine Recipe). Ein Paket aus
> einem halb-vertrauten Repo zu holen ist deshalb risikoarm.

## Aufbau eines Pakets

Ein Paket = ein Ordner mit `pack.yaml` und optionalen `*.md`-Notizen:

```
wiki/<projekt>/
  pack.yaml          # Manifest + entries:
  irgendwas.md       # optional: lose Markdown-Notiz → wird als note-Eintrag geladen
```

`pack.yaml`:

```yaml
id: mupibox            # Paket-/Projekt-ID (auch der --wiki-Name)
version: "3"           # hochziehen, wenn Wissen dazukommt (git tag)
title: MuPiBox — Wissen
description: >
  worum es geht …
entries:
  - kind: signature            # Fehler-Fingerabdruck → Diagnose
    id: mupi-rpi-eeprom-trixie
    title: "rpi-eeprom fehlt (Trixie)"
    sev: med                   # high | med | info
    match: "Unable to locate package rpi-eeprom"   # regex auf den Fehler-Output
    cause: "…"
    fix: "diesen Schritt überspringen"
    body: |                    # optionale ausführliche Erklärung (Mensch + LLM)
      …

  - kind: config               # Config-Regel → configcheck (modell-gegatet)
    id: mupi-pi5-fkms
    file: config.txt
    present: "vc4-fkms-v3d"     # oder absent: / present_all: [..]
    models: [pi5]              # nur bei diesen Modellen (leer = alle)
    requires: "vc4-kms-v3d"    # optional: muss zusätzlich präsent sein
    sev: high
    why: "…"
    fix: "sed -i '/vc4-fkms-v3d/d' {f}"   # {f} = echter Pfad

  - kind: perf                 # Perf-Hinweis → perf.py
    id: mupi-two-node
    unit: "node"               # Teilstring, der in running/enabled/Prozessen matcht
    action: consolidate        # drop | consider | swap | consolidate
    why: "…"
    action_text: "…"

  - kind: optim                # „Optimierung möglich" → wiki.py --kind optim
    id: optim-node-24-lts      #   (vorwärtsgerichtet: Upgrade/Swap statt Fehler)
    title: "Node 22 → Node 24 (LTS)"
    current: "was aktuell genutzt wird"
    better:  "die neuere Version/Methode"
    gain:    "welcher Performance-/Wartungs-Gewinn"
    since:   "ab welcher DietPi-/Debian-/Paket-Version verfügbar"
    how:     "wie umstellen (Befehl/Schritte)"
    source:  "https://…"       # zum Verifizieren

  - kind: howto                # reine Prosa (nur Kontext für Mensch/LLM)
    id: mupi-bluetooth-hang
    title: "Bluetooth hängt"
    body: |
      …
```

Jeder Eintrag kann zusätzlich **`source:`** tragen (String oder URL-Liste) — gezeigt als
„Quelle (verifizieren): …" im Briefing und beim gefeuerten signature/config/perf-Finding.
Die Kategorie **`optim`** ist vorwärtsgerichtet („was ließe sich mit neuen Versionen/
Methoden verbessern") — ansehen mit `wiki.py list --kind optim` bzw. `context --kind optim`.

## Benutzung

```sh
python3 controller/wiki.py list                     # alle Pakete (built-in + geholt)
python3 controller/wiki.py list    --wiki mupibox   # ein Projekt
python3 controller/wiki.py show    <entry-id>       # ein Eintrag
python3 controller/wiki.py context --wiki mupibox   # LLM-/Mensch-Briefing (konkateniert)
python3 controller/wiki.py fetch   <repo-url>        # STILLGELEGT für mupibox, s. u.
python3 controller/wiki.py learn   lektion.md --wiki <paket-ordner>   # Wissen ablegen (bulk)
python3 controller/wiki.py capture --wiki <paket-ordner> \            # EINEN Fund geprüft aufnehmen
    --set kind=signature --set id=mupi-xyz --set 'match=…' --set 'cause=…' --set 'fix=…'
python3 controller/wiki.py roots                    # wo Pakete gesucht werden
```

**Gefundenes zurückschreiben:** `capture` nimmt einen einzelnen gefundenen Fix/eine
Verbesserung als geprüften Eintrag auf (fragt vor dem Schreiben nach; `--yes` überspringt
die Rückfrage, wenn das Review schon erfolgt ist). `diagnose --propose` liefert aus einem
unbekannten Fehler direkt einen fertigen `signature`-Entwurf + das `capture`-Kommando —
so wird aus „unbekannt" nach einem geglückten Fix „bekannt" (die Signatur feuert künftig).
Danach `git commit`/`tag`/`push`, damit andere es per `fetch` bekommen.

Die Analyzer nehmen das Wissen automatisch mit:

```sh
python3 controller/rsi.py diagnose <run_id> --wiki mupibox        # + Signaturen + Kontext
python3 controller/rsi.py config           --wiki mupibox         # + Config-Regeln
python3 controller/rsi.py perf             --wiki mupibox         # + Perf-Hinweise
python3 controller/rsi.py diagnose <run_id> --wiki mupibox --llm  # LLM bekommt das Wissen als Kontext
```

Ohne `--wiki` wird das eingebaute `generic`-Paket automatisch geladen. Geholte
Pakete landen unter `~/.rsi/wiki/<name>/` und sind danach als `--wiki <name>` nutzbar.

## Pakete

- **`generic/`** — projekt-unabhängiges Linux/Debian/Pi/DietPi-Wissen (mitgeliefert).
- **`mupibox`** — die MuPiBox-Lektionen; liegt seit 10.08.2026 IM HAUPTBAUM
  unter `~/Downloads/MuPiBox/llmwiki/` und wird per Pfad geladen
  (`--wiki ~/Downloads/MuPiBox/llmwiki`). Das alte Repo `llmwiki_mupibox` ist
  stillgelegt — es NICHT mehr per `fetch` holen: der Cache-Ordner trägt
  dieselbe `id: mupibox` und überdeckt bei `--wiki llmwiki_mupibox` bzw.
  verdoppelt bei `--wiki all` das aktuelle Wissen lautlos.
