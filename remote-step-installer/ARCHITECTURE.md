# Architektur

## Warum

Das MuPiBox-`autosetup` ist ein `{ … } | whiptail --gauge`-Monolith, der auf dem Pi
im First-Boot durchrattert. Problem: **kein `set -e`, kein Timeout, keine
Abbruchmöglichkeit von außen**. Ein hängender `dietpi-set_hardware bluetooth enable`
fror den ganzen Lauf bei ~69 % ein — man konnte nur die SD neu flashen. Genau diese
Kontrolle liefert der Remote-Installer.

## Datenfluss

```
┌── Laptop ─────────────┐        SSH-Tunnel        ┌── Pi (DietPi, root) ───┐
│ Controller            │  :8099 (localhost only)  │ Agent (stdlib Python)  │
│  - lädt recipe.yaml   │ ───────────────────────► │  - /pair  (Code→Token) │
│  - Pair-Code eingeben │ ◄─── SSE Output-Stream ─ │  - /run   (Schritt)    │
│  - Schritt für Schritt│                          │  - /stream (SSE)       │
│  - retry/skip/wa/abort│ ──── /abort ───────────► │  - /abort (killpg!)    │
│  - LLM-Vorschlag      │                          │  - /status             │
│  - am Ende /shutdown  │ ──── /shutdown ────────► │  - self-stop + remove  │
└───────────────────────┘                          └────────────────────────┘
```

## Protokoll (HTTP + SSE, stdlib-freundlich)

| Methode | Endpoint | Zweck |
|---------|----------|-------|
| POST | `/pair` `{code}` | Pair-Code prüfen → `{token}` (Bearer für alles Weitere) |
| GET  | `/status` | Agent-Status, laufende Runs |
| POST | `/run` `{id,cmd,timeout?}` | Befehl in eigener **Prozessgruppe** starten → `{run_id}` |
| GET  | `/stream/{run_id}` | **SSE**: `data: {line}` je Zeile, am Ende `event: done data:{exit}` |
| POST | `/abort/{run_id}` | `killpg(SIGKILL)` der ganzen Gruppe — beendet den Hänger **sofort** |
| POST | `/search` `{query}` | Paket nachschlagen (apt-cache) → echte Alternativen |
| GET  | `/perf` | read-only Boot-/Laufzeit-Snapshot (systemd-analyze blame etc.) |
| POST | `/config` `{paths?}` | zentrale Config-Dateien lesen, **secret-redigiert** |
| GET  | `/sysinfo` | Umgebung erkennen (Distro/DietPi-Version, Pfade, Modell) |
| POST | `/diagnose` `{run_id?}` | Post-mortem-Beweise: Output-Tail + System-Proben (broken pkgs, failed units, disk/mem, journal/dmesg, apt-lock, DNS), **redigiert** |
| POST | `/shutdown` `{remove?}` | Agent stoppen, optional sich selbst entfernen |

- **Prozessgruppe** (`os.setsid` beim Start, `os.killpg` beim Abort) ist der Kern:
  ein `dietpi-software install` mit hängendem Sub-Prozess wird komplett gekillt.
- Jeder `/run` kann optional einen **Timeout** tragen (der Agent killt selbst) — so
  ist der Bluetooth-Workaround aus dem MuPiBox-Patch hier *Standard*, nicht Sonderfall.

## Recipe-Format (`recipes/*.yaml`)

```yaml
name: MuPiBox
version: 1
steps:
  - id: node
    name: "Node.js 22 installieren"
    run: "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs"
    check: "node --version"          # optional: Erfolg verifizieren
    optional: false
    workarounds:                      # bei Fehler wählbar
      - id: nvm
        name: "Über nvm (falls nodesource auf Trixie zickt)"
        run: "..."
      - id: bookworm-repo
        name: "nodesource Bookworm-Repo erzwingen"
        run: "..."
  - id: bluetooth
    name: "Bluetooth-Support"
    run: "dietpi-software install 5 && dietpi-set_hardware bluetooth enable"
    timeout: 90                       # <-- killt den bekannten Hänger automatisch
    optional: true
```

Der Controller rendert die Schritte, fährt sie der Reihe nach, und bei Exit≠0 (oder
Timeout) bietet er die `workarounds` + retry/skip/abort + „LLM fragen" an.

## Diagnose — auch für UNBEKANNTE Probleme

`configcheck`/`perf` sind Regel-Wissensbasen für BEKANNTE Themen. Für alles andere
gibt es `controller/diagnose.py`: bei einem Fehlschlag sammelt der Agent (`/diagnose`)
die realen Beweise — der Output-Tail des Schritts + generische System-Proben (kaputte
Pakete, fehlgeschlagene Units, Platz/RAM, journald/dmesg-Fehler, apt-Lock, DNS) — und
legt sie einem **Reasoner** vor. Zwei Reasoner teilen sich dasselbe Bündel:

- **der Chat/Assistent** (Claude) — liest das Bündel und komponiert einen Fix; das
  funktioniert für ALLES, weil er über den ECHTEN Output urteilt, nicht über eine
  feste Regeltabelle;
- **ein optionaler eingebauter LLM** (`--llm`, OpenAI-kompatibel: Ollama/Open WebUI/
  Copilot; via `RSI_LLM_URL`/`RSI_LLM_KEY`/`RSI_LLM_MODEL`) — für autonomen/Offline-Betrieb.

Eine **offene Signatur-Bibliothek** klassifiziert die häufigen Fehler-Fingerabdrücke
vorab (Unable to locate package, kaputte Deps, kein Platz, dpkg unterbrochen, Lock,
DNS, …) und wird mit dem versionierbaren llmwiki gemischt. Was NICHTS matcht, ist genau
das „unbekannte Problem" → volle Evidenz + LLM. Ein fehlgeschlagener Schritt weist
selbst auf seine Diagnose hin (`rsi.py diagnose <run_id>`).

## llmwiki — versionierbares, pro-Projekt-Wissen

Die drei eingebauten Wissensbasen sind nur ein **Seed**. Angesammeltes Wissen liegt als
**portable, git-versionierbare Wissenspakete** (`wiki/<projekt>/pack.yaml` + `*.md`),
die **Mensch UND LLM** lesen — inspiriert vom **Open Knowledge Format** (strukturierte,
portable Metadaten) und Karpathys LLM-tauglichem-Wissen-Ansatz (Markdown, konkatenierbar):

- **pro Projekt** (jedes Projekt kann sein Paket im EIGENEN Repo führen — MuPiBox:
  `llmwiki_mupibox`), **versionierbar** (`git tag`), **holbar** (`wiki.py fetch <repo>`).
- **doppelt nutzbar**: `signatures()/config_rules()/perf_hints()` mischen typisierte
  Einträge in die Analyzer (`--wiki <projekt>`); `context()` konkateniert die Prosa zu
  einem LLM-/Mensch-Briefing (fließt bei `--llm` als Kontext mit ein).
- Eintrags-`kind`: `signature` (regex→Ursache/Fix), `config` (Datei/present/absent/
  models/fix, modell-gegatet), `perf` (unit/action/why), `note`/`howto` (Prosa).

> **Sicherheit:** ein Wiki ist **Daten** — seine Fix-Texte werden nur ANGEZEIGT, nie
> automatisch ausgeführt (anders als eine Recipe). Ein Paket aus einem halb-vertrauten
> Repo zu holen ist deshalb risikoarm. Details + Format: `wiki/README.md`.

**Rückschreiben (der „unbekannt → bekannt"-Kreislauf):** findet die Analyse auf einer
Box ein neues Problem + ein Fix klappt, wird es als Eintrag zurückgeschrieben und ist
beim nächsten Mal BEKANNT (die Signatur feuert dann in `diagnose`). `diagnose --propose`
erzeugt aus einem Fund einen Signatur-ENTWURF, `wiki.py capture` nimmt ihn — nach einem
**Review** — auf (`validate_entry` prüft, Version wird gebumpt, doppelte ids abgelehnt).
Bewusst NICHT still automatisch: das Wiki ist geteiltes, versioniertes Wissen → das Tool
schlägt vor, ein Mensch (oder der Chat nach OK) bestätigt, dann `git commit`/`tag`/`push`.

Der frühere Plan (LLM steuert nie direkt, Mensch bestätigt) bleibt: ein LLM-Vorschlag
ist ein VORSCHLAG — als Ad-hoc-`exec`/Workaround bestätigt der Mensch (oder der Chat)
ihn kontrolliert.

## Controller-Schichten

1. **Kern** (`controller/core.py`): HTTP/SSE-Client (pair/run/stream/abort/search/perf/
   config/sysinfo/diagnose/shutdown), stdlib. Von allen anderen genutzt.
2. **CLI** (`controller/stepctl.py`): interaktive Schritt-für-Schritt-Schleife.
3. **TUI** (`controller/tui.py`): Textual — modern, **themebar**, Schritt-Liste + Live-Log.
4. **Chat-/Skript-Steuerung** (`controller/rsi.py`): headless — pair/list/run/exec/search/
   perf/config/sysinfo/**diagnose**/**wiki**/status/abort/shutdown. So fährt der Chat-
   Assistent den Install über den Tunnel.
5. **Analyse** (`perf.py`, `configcheck.py`, `sysinfo.py`, `model.py`) + **Diagnose**
   (`diagnose.py`) + **Wissen** (`wiki.py`) — alle über `--wiki <projekt>` mit dem
   llmwiki gefüttert.

## Sicherheitsgrenzen

Der Agent führt **beliebige Befehle als root** aus (das ist der Zweck). Vertrauen kommt
aus (a) localhost-Bindung + SSH-Tunnel, (b) Code-Pairing, (c) Selbst-Beendigung nach
Abschluss. Er ist **kein dauerhafter Dienst** und **kein offener LAN-Port** by default.
Recipes sind Code — nur vertrauenswürdige Recipes fahren.
