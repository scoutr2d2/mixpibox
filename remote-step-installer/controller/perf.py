#!/usr/bin/env python3
"""
remote-step-installer — Perf-Analyse.

Holt vom Agent den read-only Boot-/Laufzeit-Snapshot (`/perf`), findet die
langsamsten Boot-Units, und schlägt **gezielte Optimierungen** + **Tool-
Zusammenlegungen/-Austausch** vor — aber nur solche, die auf DEINER Box tatsächlich
präsent sind (Wissensbasis wird gegen die laufenden/aktivierten Dienste + Prozesse
geprüft). Vorschläge kommen mit Begründung + fertigem `action`-Befehl, den der
Controller (oder ich im Chat) als kontrollierten Schritt anwenden kann.

  python3 perf.py --base http://127.0.0.1:8099 --pair 123456
  # oder importiert:  perf.run(base, pair)
"""
import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import cached_agent, AgentError

# ── Wissensbasis: unit = Teilstring, der in running/enabled/Prozessen matcht ──
KB = [
    {"unit": "ModemManager", "kind": "drop",
     "why": "Mobilfunk-Modem-Verwaltung — auf einer WLAN/LAN-Box unnötig",
     "action": "systemctl disable --now ModemManager"},
    {"unit": "NetworkManager-wait-online", "kind": "drop",
     "why": "blockt den Boot bis 'network online' — für einen Kiosk selten nötig",
     "action": "systemctl disable NetworkManager-wait-online"},
    {"unit": "systemd-networkd-wait-online", "kind": "drop",
     "why": "verzögert den Boot bis 'online' (networkd)",
     "action": "systemctl disable systemd-networkd-wait-online"},
    {"unit": "avahi-daemon", "kind": "consider",
     "why": "mDNS/.local — nur nötig, wenn du die Box per <name>.local ansprichst",
     "action": "systemctl disable --now avahi-daemon"},
    {"unit": "triggerhappy", "kind": "consider",
     "why": "globaler Hotkey-Daemon — bei einem Touch-Kiosk meist ungenutzt",
     "action": "systemctl disable --now triggerhappy"},
    {"unit": "bluetooth", "kind": "consider",
     "why": "nur nötig, wenn du BT (Kopfhörer) nutzt — sonst spart's Boot + RAM",
     "action": "systemctl disable --now bluetooth"},
    {"unit": "man-db", "kind": "drop",
     "why": "baut den man-Seiten-Index — auf einer Appliance unnötig, frisst I/O",
     "action": "systemctl disable --now man-db.timer"},
    {"unit": "apt-daily", "kind": "drop",
     "why": "Auto-apt im Hintergrund kämpft mit dem Kiosk (I/O-Spikes, kann apt sperren)",
     "action": "systemctl disable --now apt-daily.timer apt-daily-upgrade.timer"},
    {"unit": "e2scrub", "kind": "drop",
     "why": "ext4-Scrub-Timer — auf SD/kleiner Box unnötig",
     "action": "systemctl disable e2scrub_all.timer"},
    {"unit": "rpi-eeprom-update", "kind": "consider",
     "why": "EEPROM-Update-Check beim Boot — nach einmaligem Update abschaltbar",
     "action": "systemctl disable rpi-eeprom-update"},
    # ── Austausch / Zusammenlegen ─────────────────────────────────────────
    {"unit": "dphys-swapfile", "kind": "swap",
     "why": "Swap auf SD = Wear + langsam. Besser zram (komprimierter Swap im RAM)",
     "action": "dphys-swapfile deaktivieren + zram-tools/zram-swap aktivieren"},
    {"unit": "pulseaudio", "kind": "swap",
     "why": "PulseAudio ist relativ schwer. Bei reinem I2S/ALSA oft ganz weglassbar (direkt ALSA), sonst PipeWire (leichter, modern)",
     "action": "prüfen ob nötig; sonst ALSA direkt oder pipewire + pipewire-pulse"},
    {"unit": "rsyslog", "kind": "consolidate",
     "why": "journald reicht meist; DietPi-RAMlog ersetzt rsyslog → deutlich weniger SD-Writes",
     "action": "rsyslog entfernen, journald/RAMlog nutzen"},
]

# immer gezeigte, kontext-Ideen (app-/kiosk-spezifisch)
GENERAL = [
    {"kind": "consolidate",
     "why": "MuPiBox fährt backend-api + backend-player als ZWEI Node-Prozesse (+ pm2) plus Admin (lighttpd/PHP). Die zwei Node-Dienste ließen sich zu EINEM Prozess zusammenlegen; das PHP-Admin nur bei Bedarf starten",
     "action": "app-seitig zusammenlegen (größere Änderung) / Admin on-demand"},
    {"kind": "swap",
     "why": "Chromium-Kiosk: Disk-Cache auf tmpfs/RAM + KMS-GPU-Flags → schnellerer Start, weniger SD-Writes (wie beim MuPiBox-Perf-Pass)",
     "action": "--disk-cache-dir=/tmp + GPU/KMS-Flags"},
]

KIND_TAG = {"drop": "\033[1;31mDROP\033[0m", "consider": "\033[1;33mPRÜF\033[0m",
            "swap": "\033[1;36mSWAP\033[0m", "consolidate": "\033[1;35mMERGE\033[0m"}


def _secs(dur):
    """'1min 2.345s' / '12.345s' / '850ms' -> Sekunden."""
    t = 0.0
    for p in dur.split():
        p = p.strip()
        try:
            if p.endswith("ms"):
                t += float(p[:-2]) / 1000
            elif p.endswith("min"):
                t += float(p[:-3]) * 60
            elif p.endswith("h"):
                t += float(p[:-1]) * 3600
            elif p.endswith("s"):
                t += float(p[:-1])
        except ValueError:
            pass
    return t


def analyze(perf, extra_hints=None):
    present = set(perf.get("running", []) + perf.get("enabled", []))
    present |= {ln.split()[-1] for ln in perf.get("top_rss", []) if ln.split()}  # process comms
    blame = []
    for ln in perf.get("boot_blame", []):
        parts = ln.split()
        if len(parts) >= 2:
            blame.append((_secs(" ".join(parts[:-1])), parts[-1]))
    blame.sort(reverse=True)

    def is_present(u):
        return any(u in p for p in present)

    matched = [k for k in (KB + (extra_hints or [])) if is_present(k["unit"])]  # eingebaut + llmwiki
    swap_on_disk = any("file" in ln or "partition" in ln for ln in perf.get("swap", []))
    return {"blame": blame[:12], "matched": matched, "present": present,
            "swap_on_disk": swap_on_disk}


def report(perf, a):
    def head(s):
        print(f"\n\033[1;36m═ {s}\033[0m")

    model = (perf.get("model") or ["?"])[0]
    print(f"\033[1m Perf-Analyse: {model}\033[0m")
    for ln in perf.get("boot_total", []):
        print("  " + ln)

    head("Langsamste Boot-Units (blame)")
    if a["blame"]:
        for sec, unit in a["blame"]:
            bar = "▮" * min(30, int(sec * 2))
            print(f"  {sec:6.2f}s  {unit:34} {bar}")
        print("  \033[2m(Achtung: nur Units auf dem kritischen Pfad verzögern den Boot wirklich —\033[0m")
        print("  \033[2m   siehe critical-chain; langsam ≠ automatisch relevant)\033[0m")
    else:
        print("  (keine blame-Daten — systemd-analyze nicht verfügbar?)")

    head("Speicher / Swap")
    for ln in perf.get("memory", [])[:3]:
        print("  " + ln)
    if a["swap_on_disk"]:
        print("  \033[1;33m⚠ Swap liegt auf Datei/Partition (SD-Wear!) → zram erwägen\033[0m")

    head(f"Optimierungs-Vorschläge (nur was auf DEINER Box präsent ist: {len(a['matched'])})")
    if not a["matched"]:
        print("  (nichts aus der Wissensbasis gefunden — schon schlank, oder Daten fehlen)")
    for k in a["matched"]:
        src = f" \033[2m(wiki:{k['_wiki']})\033[0m" if k.get("_wiki") else ""
        print(f"  [{KIND_TAG.get(k['kind'], k['kind'])}] {k['unit']}{src}")
        print(f"        {k['why']}")
        print(f"        \033[2m→ {k['action']}\033[0m")
        if k.get("source"):
            print(f"        \033[2m⌾ Quelle: {k['source']}\033[0m")

    head("Tool-Konsolidierung / Austausch (Ideen)")
    for g in GENERAL:
        print(f"  [{KIND_TAG[g['kind']]}] {g['why']}")
        print(f"        \033[2m→ {g['action']}\033[0m")
    print()


def _wiki_hints(wiki_name, project):
    """Zusätzliche Perf-Hinweise aus dem versionierbaren llmwiki (generic + Projekt)."""
    try:
        import wiki
        pack = wiki.resolve(wiki_name) if wiki_name else wiki.load_default(project)
        return wiki.perf_hints(pack)
    except (ImportError, SystemExit):
        return []


def run(base, pair=None, wiki_name=None, project=None):
    agent = cached_agent(base, pair)
    perf = agent.perf()
    report(perf, analyze(perf, _wiki_hints(wiki_name, project)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair", help="Pair-Code (falls noch nicht gepairt)")
    ap.add_argument("--wiki", help="Wissenspaket (Projektname/Pfad) für zusätzliche Perf-Hinweise")
    ap.add_argument("--project", help="Projekt/Recipe-Name → lädt dessen Standard-Wissen")
    args = ap.parse_args()
    try:
        run(args.base, args.pair, args.wiki, args.project)
    except AgentError as e:
        sys.exit(f"Agent-Fehler: {e}")


if __name__ == "__main__":
    main()
