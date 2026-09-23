#!/usr/bin/env python3
"""
remote-step-installer — gezielte Config-Analyse (modell-bewusst).

Liest (secret-redigiert) die zentralen Config-Dateien vom Agent und prüft sie gegen
eine Regel-Wissensbasis — die Lektionen aus dem Pi-5/DietPi-Setup: Legacy-fkms auf
Pi 5, framebuffer/gpu_mem unter KMS, fehlendes/kollidierendes DSI-Overlay, Chromium-
Cache auf SD, nodesource/Trixie … Regeln sind **modell-gegatet** (z.B. fkms ist auf
Pi 4 ok, auf Pi 5 ein Schwarzbild). Das Modell wird erkannt oder per --model gewählt
(wichtig beim Test auf einem älteren Board). Jeder Fund kommt mit fertigem `fix`.

  python3 configcheck.py --base http://127.0.0.1:8099 --pair 123456
  python3 configcheck.py --model pi4        # Erkennung überschreiben (älteres Board)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import cached_agent, AgentError
import model as pimodel

# file = Basename; present/absent = Teilstring in AKTIVEN (nicht-#) Zeilen;
# present_all = alle vorhanden (Konflikt); models = nur bei diesen Modellen;
# requires = weiterer Teilstring, der zusätzlich präsent sein muss; {f} = echter Pfad.
RULES = [
    {"file": "config.txt", "sev": "high", "present": "vc4-fkms-v3d", "models": ["pi5"],
     "why": "Legacy fkms — der Pi 5 hat KEINEN fkms/Legacy-Treiber → schwarzer Schirm",
     "fix": "sed -i '/vc4-fkms-v3d/d' {f}; grep -q '^dtoverlay=vc4-kms-v3d' {f} || echo dtoverlay=vc4-kms-v3d >> {f}"},
    {"file": "config.txt", "sev": "high", "present_all": ["vc4-kms-dsi-7inch", "waveshare-panel"],
     "why": "zwei DSI-Panel-Overlays gleichzeitig (offiziell 7\" + Waveshare) → Konflikt",
     "fix": "das falsche entfernen — nur EIN Panel-Overlay behalten"},
    {"file": "config.txt", "sev": "med", "present": "framebuffer_width", "requires": "vc4-kms-v3d",
     "why": "framebuffer_width/height werden unter KMS ignoriert (Legacy-Rest)",
     "fix": "sed -i '/^framebuffer_width=/d; /^framebuffer_height=/d' {f}"},
    {"file": "config.txt", "sev": "med", "present": "gpu_mem", "models": ["pi5"],
     "why": "gpu_mem wird vom Pi 5 ignoriert (unified memory) — harmlose Altlast",
     "fix": "sed -i '/^gpu_mem/d' {f}"},
    {"file": "config.txt", "sev": "info", "absent": "vc4-kms-v3d", "models": ["pi5"],
     "why": "kein KMS-Overlay (vc4-kms-v3d) — auf Pi 5 nötig für Display/GPU",
     "fix": "echo dtoverlay=vc4-kms-v3d >> {f}"},
    {"file": "cmdline.txt", "sev": "info", "absent": "quiet",
     "why": "Boot zeigt viele Kernelmeldungen — für einen Kiosk oft 'quiet loglevel=1 consoleblank=0'",
     "fix": "(optional) 'quiet consoleblank=0' in {f} ergänzen (eine Zeile!)"},
    {"file": "chromium-autostart.sh", "sev": "perf", "absent": "--disk-cache-dir",
     "why": "Chromium-Disk-Cache landet auf SD; --disk-cache-dir=/tmp = RAM → weniger Wear, schneller",
     "fix": "--disk-cache-dir=/tmp in der Chromium-Startzeile ({f}) ergänzen"},
    {"file": "nodesource.list", "sev": "med", "present": "trixie",
     "why": "nodesource-Repo auf Trixie — hatte Lücken; Bookworm-Repo ist stabiler",
     "fix": "auf 'node_22.x bookworm main' umstellen, falls 'apt install nodejs' zickt"},
    {"file": "os-release", "sev": "info", "present": "trixie",
     "why": "Debian 13 Trixie (DietPi-Standard) — passt; einzelne Pakete brauchen ggf. einen Workaround (rpi-eeprom überspringen, nodesource→bookworm), kein Downgrade nötig",
     "fix": "(Info) betroffene Schritte per Workaround fahren"},
]

TAG = {"high": "\033[1;31mHIGH\033[0m", "med": "\033[1;33mMED \033[0m",
       "perf": "\033[1;36mPERF\033[0m", "info": "\033[2mINFO\033[0m"}


def _resolve(config):
    """basename -> (path, lines), /boot/firmware bevorzugt."""
    best = {}
    for path, info in config.items():
        if not info.get("exists"):
            continue
        base = os.path.basename(path)
        if base not in best or "/firmware/" in path:
            best[base] = (path, info.get("lines", []))
    return best


def _active(lines):
    return "\n".join(ln for ln in lines if ln.strip() and not ln.lstrip().startswith("#"))


def resolve_model(config, override=None):
    files = _resolve(config)
    raw = " ".join(files["model"][1]).replace("\x00", "").strip() if "model" in files else ""
    mid = pimodel.pick(override) or pimodel.normalize(raw)
    return mid, raw


def analyze(config, model_override=None, extra_rules=None):
    mid, _ = resolve_model(config, model_override)
    files = _resolve(config)
    findings = []
    for r in RULES + (extra_rules or []):  # eingebaute Regeln + llmwiki (projekt-spezifisch)
        # Modell-Gate: bei unbekanntem Modell NICHT unterdrücken (Sicherheitsnetz)
        if r.get("models") and mid not in r["models"] and mid != "unknown":
            continue
        entry = files.get(r["file"])
        if not entry:
            continue
        path, lines = entry
        active = _active(lines)
        if r.get("requires") and r["requires"] not in active:
            continue
        if "present" in r:
            hit = r["present"] in active
        elif "absent" in r:
            hit = r["absent"] not in active
        elif "present_all" in r:
            hit = all(s in active for s in r["present_all"])
        else:
            hit = False
        if hit:
            findings.append({"sev": r.get("sev", "med"), "file": path,
                             "why": r.get("why", ""),
                             "fix": r.get("fix", "").replace("{f}", path),
                             "src": r.get("_wiki"), "source": r.get("source")})
    order = {"high": 0, "med": 1, "perf": 2, "info": 3}
    findings.sort(key=lambda x: order.get(x["sev"], 9))
    return findings


def report(config, findings, model_override=None):
    mid, raw = resolve_model(config, model_override)
    files = _resolve(config)
    src = "manuell gewählt" if pimodel.pick(model_override) else ("erkannt" if raw else "unbekannt")
    print(f"\033[1m Config-Analyse — {pimodel.label(mid)}\033[0m \033[2m({src}: {raw or '—'})\033[0m")
    print(f"\033[2m gelesen: {', '.join(sorted(files.keys()))}\033[0m")
    if mid == "unknown":
        print("\033[1;33m ⚠ Modell nicht erkannt — Pi-5-Regeln werden vorsichtshalber angewandt. "
              "Mit --model pi4/pi3/… korrigieren.\033[0m")
    if not findings:
        print("\n  \033[1;32m✓ keine bekannten Config-Probleme für dieses Modell\033[0m")
        return
    print()
    for f in findings:
        src = f" \033[2m(wiki:{f['src']})\033[0m" if f.get("src") else ""
        print(f"  [{TAG.get(f['sev'], f['sev'])}] {os.path.basename(f['file'])}{src}")
        print(f"        {f['why']}")
        if f.get("fix"):
            print(f"        \033[2m→ {f['fix']}\033[0m")
        if f.get("source"):
            print(f"        \033[2m⌾ Quelle: {f['source']}\033[0m")
    print()


def _wiki_rules(wiki_name, project):
    """Zusätzliche Config-Regeln aus dem versionierbaren llmwiki (generic + Projekt)."""
    try:
        import wiki
        pack = wiki.resolve(wiki_name) if wiki_name else wiki.load_default(project)
        return wiki.config_rules(pack)
    except (ImportError, SystemExit):
        return []


def run(base, pair=None, model_override=None, wiki_name=None, project=None):
    agent = cached_agent(base, pair)
    cfg = agent.config()
    report(cfg, analyze(cfg, model_override, _wiki_rules(wiki_name, project)), model_override)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair", help="Pair-Code (falls noch nicht gepairt)")
    ap.add_argument("--model", help="Modell erzwingen (pi5/pi4/pi3/… ; 'auto' = erkennen)")
    ap.add_argument("--wiki", help="Wissenspaket (Projektname/Pfad) für zusätzliche Config-Regeln")
    ap.add_argument("--project", help="Projekt/Recipe-Name → lädt dessen Standard-Wissen")
    args = ap.parse_args()
    try:
        run(args.base, args.pair, args.model, args.wiki, args.project)
    except AgentError as e:
        sys.exit(f"Agent-Fehler: {e}")


if __name__ == "__main__":
    main()
