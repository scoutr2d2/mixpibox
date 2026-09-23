#!/usr/bin/env python3
"""
remote-step-installer — failure diagnosis (ALSO for UNKNOWN problems).

configcheck/perf are rule bases for KNOWN issues. This is the other half: when a
step fails — foreseen or not — it gathers the real evidence (the failed command's
output + generic system probes) and hands it to a reasoner. Two reasoners share the
same bundle:
  • the chat/assistant (me) — reads the printed bundle and composes a fix; works for
    ANYTHING, because it reasons over the ACTUAL output, not a fixed rule table;
  • an optional embedded LLM (--llm, OpenAI-compatible: Ollama/Open WebUI/Copilot),
    configured via the RSI_LLM_URL/RSI_LLM_KEY/RSI_LLM_MODEL env vars, for autonomous/
    offline use.
A small, OPEN-ENDED signature library pre-classifies the common failure fingerprints
(Unable to locate package, broken deps, no space, dpkg interrupted, lock, DNS, …) as
first-pass hints — and it is MERGED with the versionable llmwiki (`wiki.signatures`),
so project-specific knowledge (our MuPiBox lessons) plugs in. Whatever matches nothing
is exactly the "unknown problem" → the full evidence + the LLM.

  python3 diagnose.py --base URL --pair 123456 <run_id>
  python3 diagnose.py <run_id> --wiki mupibox        # + project knowledge
  python3 diagnose.py <run_id> --llm                 # + ask the configured LLM
"""
import argparse
import json
import os
import re
import shlex
import sys
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import cached_agent, AgentError

# Open-ended failure fingerprints: regex on the output -> likely cause + a concrete
# next action. NOT a closed rule base — extend it here or (better) in the llmwiki.
# Whatever matches nothing here is the "unknown problem" → full evidence + LLM.
SIGNATURES = [
    {"re": r"Unable to locate package[: ]+(\S+)", "sev": "high",
     "cause": "Paket '{0}' gibt es im aktiven Repo nicht (oft nach Distro-Wechsel, z.B. Bookworm→Trixie)",
     "fix": "rsi.py search {0}   # echten Namen/Alternative finden, ggf. Repo-Workaround"},
    {"re": r"E: (?:Held broken packages|Unable to correct problems)|unmet dependencies", "sev": "high",
     "cause": "kaputte / gehaltene Abhängigkeiten",
     "fix": "rsi.py exec 'apt-get -s -f install'  (Dry-Run) → dann ohne -s"},
    {"re": r"No space left on device|not enough free space", "sev": "high",
     "cause": "Datenträger voll",
     "fix": "rsi.py exec 'df -h; apt-get clean'   # Platz schaffen (/var/cache, /tmp, alte Kernel)"},
    {"re": r"dpkg was interrupted|dpkg --configure -a|dpkg: error processing", "sev": "high",
     "cause": "dpkg wurde mittendrin unterbrochen (typisch nach einem Hänger/Abbruch)",
     "fix": "rsi.py exec 'dpkg --configure -a'    # dann den Schritt wiederholen"},
    {"re": r"Could not get lock .*(?:dpkg|apt)|dpkg frontend lock", "sev": "med",
     "cause": "apt/dpkg-Lock — ein anderer apt-Lauf (oder ein Zombie) hält es",
     "fix": "kurz warten; sonst Halter zeigen (Probe apt_lock) und beenden"},
    {"re": r"(?:command not found|: not found)\s*$", "sev": "med",
     "cause": "aufgerufenes Programm fehlt im PATH",
     "fix": "rsi.py search <tool>   # Paket dazu finden/installieren"},
    {"re": r"Permission denied|EACCES|Operation not permitted", "sev": "med",
     "cause": "Rechteproblem (der Agent ist root — Datei-Owner/Mount prüfen)",
     "fix": "Besitzer/Mount prüfen; ggf. chown / remount rw"},
    {"re": r"Temporary failure resolving|Could not resolve|Network is unreachable|Failed to fetch|Connection timed out", "sev": "high",
     "cause": "Netzwerk/DNS-Problem beim Download",
     "fix": "rsi.py exec 'getent hosts deb.debian.org && ping -c1 deb.debian.org'"},
    {"re": r"NO_PUBKEY|GPG error|signatures couldn't be verified|is not signed", "sev": "med",
     "cause": "Repo-Signatur/GPG-Key fehlt oder passt nicht",
     "fix": "fehlenden Key importieren / Repo-Suite prüfen (nodesource: bookworm statt trixie)"},
    {"re": r"under-voltage|voltage.*detected|Undervoltage", "sev": "high",
     "cause": "Unterspannung — Netzteil/Kabel zu schwach, kann Installs sporadisch killen",
     "fix": "stärkeres Netzteil (Pi 5: 5V/5A) / besseres Kabel"},
    {"re": r"[Rr]ead-only file system", "sev": "high",
     "cause": "Dateisystem read-only gemountet (oft nach SD-Fehler/unsauberem Aus)",
     "fix": "rsi.py exec 'mount -o remount,rw /'  + dmesg auf I/O-Fehler prüfen (Probe dmesg_bad)"},
    {"re": r"[Oo]ut of memory|Cannot allocate memory|oom-kill|Killed process \d|invoked oom-killer", "sev": "high",
     "cause": "Out-of-Memory — der Prozess wurde vom Kernel gekillt",
     "fix": "zram-Swap aktivieren (rsi.py perf), parallele Jobs reduzieren"},
    {"re": r"held back|is not going to be installed", "sev": "med",
     "cause": "Paket zurückgehalten (Abhängigkeitskonflikt / phased update)",
     "fix": "rsi.py exec 'apt-get install --no-install-recommends <pkg>' oder Version pinnen"},
]

PROBE_LABEL = {
    "failed_units": "Fehlgeschlagene systemd-Units", "dpkg_audit": "dpkg --audit (halb-konfiguriert)",
    "dpkg_broken": "Nicht sauber installierte Pakete", "apt_fix_check": "apt-get -f install (Dry-Run)",
    "disk": "Speicherplatz", "mem": "Arbeitsspeicher", "journal_err": "journald-Fehler (dieser Boot)",
    "dmesg_bad": "Kernel-Auffälligkeiten (OOM/Spannung/I/O)", "apt_lock": "apt/dpkg-Lock-Halter",
    "dns": "DNS-Auflösung",
}
SEV_TAG = {"high": "\033[1;31mHIGH\033[0m", "med": "\033[1;33mMED \033[0m", "info": "\033[2mINFO\033[0m"}


def _signatures(wiki_name=None, project=None):
    """Built-in fingerprints + the versionable llmwiki (shared 'generic' + project)."""
    sigs = list(SIGNATURES)
    try:
        import wiki
        pack = wiki.resolve(wiki_name) if wiki_name else wiki.load_default(project)
        sigs += wiki.signatures(pack)
    except (ImportError, SystemExit):
        pass
    return sigs


def scan_signatures(text, sigs):
    hits, seen = [], set()
    for s in sigs:
        m = re.search(s["re"], text, re.I | re.M)
        if m:
            g = m.groups()
            cause = s.get("cause", "").format(*g) if g else s.get("cause", "")
            fix = s.get("fix", "").format(*g) if g else s.get("fix", "")
            if cause not in seen:
                seen.add(cause)
                hits.append({"sev": s.get("sev", "med"), "cause": cause, "fix": fix,
                             "src": s.get("_wiki"), "source": s.get("source")})
    return hits


def _probes_with_content(probes):
    return {k: v.strip() for k, v in (probes or {}).items() if (v or "").strip()}


def build_bundle(agent, run_id):
    diag = agent.diagnose(run_id)
    try:
        si = agent.sysinfo()
    except AgentError:
        si = {}
    run = diag.get("run") or {}
    probes = _probes_with_content(diag.get("probes", {}))
    out_text = "\n".join(run.get("tail", []))
    L = ["# Fehlgeschlagener Schritt"]
    if run:
        L += [f"befehl: {run.get('cmd', '?')}",
              f"exit={run.get('exit')} aborted={run.get('aborted')} timedout={run.get('timedout')}",
              "--- output (tail) ---", out_text or "(kein output)"]
    L += ["", "# System",
          f"modell={si.get('model', '?')} distro={si.get('distro', '?')} "
          f"kernel={si.get('kernel', '?')} arch={si.get('arch', '?')}",
          f"boot_dir={si.get('boot_dir', '?')} dietpi={si.get('dietpi_version', '?')}", ""]
    for k, v in probes.items():
        L += [f"# Probe: {PROBE_LABEL.get(k, k)}", v, ""]
    return {"text": "\n".join(L), "run": run, "probes": probes, "sysinfo": si,
            "out_text": out_text}


def llm_suggest(bundle_text, wiki_context=""):
    base = os.environ.get("RSI_LLM_URL", "").rstrip("/")
    if not base:
        return None, ("kein LLM konfiguriert — setze RSI_LLM_URL (OpenAI-kompatibel, "
                      "z.B. Ollama/Open WebUI), optional RSI_LLM_KEY + RSI_LLM_MODEL")
    url = base if base.endswith("/chat/completions") else base + "/chat/completions"
    sys_p = ("Du bist Experte für Linux/Debian/Raspberry-Pi/DietPi-Installationen. Dir wird ein "
             "fehlgeschlagener Installationsschritt samt System-Evidenz gegeben (und ggf. Projekt-"
             "Wissen). Nenne knapp auf Deutsch: (1) die WAHRSCHEINLICHSTE Ursache und (2) konkrete "
             "Shell-Befehle als Fix — minimal, reversibel, das Ziel läuft als root.")
    user = (("# Projekt-Wissen (llmwiki)\n" + wiki_context + "\n\n") if wiki_context else "") + bundle_text
    payload = {"model": os.environ.get("RSI_LLM_MODEL", ""), "temperature": 0.2,
               "messages": [{"role": "system", "content": sys_p}, {"role": "user", "content": user}]}
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    if os.environ.get("RSI_LLM_KEY"):
        req.add_header("Authorization", f"Bearer {os.environ['RSI_LLM_KEY']}")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            j = json.loads(resp.read() or b"{}")
        return j["choices"][0]["message"]["content"].strip(), None
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError, IndexError, ValueError) as e:
        return None, f"LLM-Fehler: {e}"


def propose_signature(bundle, prefix="mupi"):
    """Draft a wiki `signature` entry from a failed run — so an UNKNOWN problem, once
    diagnosed + fixed, can be captured and become KNOWN (auto-recognized next time)."""
    run = bundle.get("run") or {}
    cand = ""
    for ln in (bundle.get("out_text", "") or "").splitlines():
        s = ln.strip()
        if len(s) >= 8 and not s.startswith(("+", "#")):
            cand = s
            break
    slug = re.sub(r"[^a-z0-9]+", "-", (run.get("id") or "fix").lower()).strip("-") or "fix"
    return {"kind": "signature", "id": (prefix + "-" + slug)[:38],
            "title": "(neu) " + (run.get("cmd", "?") or "?")[:48], "sev": "med",
            "match": re.escape(cand).replace("\\ ", " ")[:100] if cand else "<REGEX aus dem Fehler-Output>",
            "cause": "<Ursache — bitte ausfuellen>", "fix": "<der Fix, der geholfen hat>"}


def report(agent, run_id, use_llm=False, wiki_name=None, project=None, propose=False):
    b = build_bundle(agent, run_id)
    sigs = _signatures(wiki_name, project)
    # signatures classify the FAILURE's own output; if there is none (pure system
    # scan, no run_id), fall back to the probes. Probes are shown separately below.
    scan = b["out_text"] if b["out_text"].strip() else "\n".join(b["probes"].values())
    hits = scan_signatures(scan, sigs)
    run = b["run"]

    print("\033[1m Fehler-Diagnose\033[0m", end="")
    if run:
        st = "abgebrochen" if run.get("aborted") else ("Timeout" if run.get("timedout") else f"exit {run.get('exit')}")
        print(f" \033[2m— Schritt '{run.get('id', '?')}' ({st})\033[0m")
    else:
        print(" \033[2m— (kein run_id: nur System-Evidenz)\033[0m")

    if hits:
        print("\n\033[1m Erkannte Signaturen\033[0m")
        for h in hits:
            tag = SEV_TAG.get(h["sev"], "?")
            src = f" \033[2m(wiki:{h['src']})\033[0m" if h.get("src") else ""
            print(f"  [{tag}] {h['cause']}{src}")
            if h.get("fix"):
                print(f"        \033[2m→ {h['fix']}\033[0m")
            if h.get("source"):
                print(f"        \033[2m⌾ Quelle: {h['source']}\033[0m")
    else:
        print("\n  \033[1;33m⚠ keine bekannte Signatur — unbekanntes Problem.\033[0m")
        print("  \033[2m  Volle Evidenz unten: per --llm den konfigurierten LLM fragen, oder den "
              "Block dem Chat-Assistenten geben.\033[0m")

    if b["probes"]:
        print("\n\033[1m System-Evidenz\033[0m")
        for k, v in b["probes"].items():
            print(f"\n  \033[1;36m─ {PROBE_LABEL.get(k, k)}\033[0m")
            for ln in v.splitlines()[:20]:
                print("    " + ln)

    if use_llm:
        wctx = ""
        try:
            import wiki
            pack = wiki.resolve(wiki_name) if wiki_name else wiki.load_default(project)
            wctx, _ = wiki.context(pack, query=None, limit=25)
        except (ImportError, SystemExit):
            pass
        print("\n\033[1m LLM-Vorschlag\033[0m")
        text, err = llm_suggest(b["text"], wctx)
        print("  " + (err.replace("\n", "\n  ") if err else "\n".join(text.splitlines()).replace("\n", "\n  ")))
    else:
        print("\n\033[2m  (Tipp: --llm fragt den konfigurierten LLM; ohne LLM den Evidenz-Block "
              "dem Chat-Assistenten vorlegen. Projekt-Wissen: --wiki <projekt>.)\033[0m")

    if propose:
        e = propose_signature(b)
        print("\n\033[1m Als Wiki-Signatur vorschlagen (wenn ein Fix geklappt hat)\033[0m")
        print("  \033[2mEntwurf — cause/fix (und ggf. match) anpassen, dann aufnehmen:\033[0m")
        flags = " ".join(f"--set {k}={shlex.quote(str(v))}" for k, v in e.items())
        print(f"  python3 controller/wiki.py capture --wiki <wiki-repo-ordner> \\\n      {flags}")
        print("  \033[2m→ so wird aus dem unbekannten Problem eine bekannte Signatur (für alle).\033[0m")
    print()


def run(base, pair=None, run_id=None, use_llm=False, wiki_name=None, project=None, propose=False):
    report(cached_agent(base, pair), run_id, use_llm, wiki_name, project, propose)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_id", nargs="?", help="run_id des fehlgeschlagenen Schritts (optional)")
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair")
    ap.add_argument("--llm", action="store_true", help="zusätzlich den konfigurierten LLM fragen (RSI_LLM_URL)")
    ap.add_argument("--wiki", help="Wissenspaket (Projektname/Pfad) für zusätzliche Signaturen + Kontext")
    ap.add_argument("--project", help="Projekt/Recipe-Name → lädt dessen Standard-Wissen")
    ap.add_argument("--propose", action="store_true",
                    help="einen Wiki-Signatur-Entwurf aus diesem Fund ausgeben (zum Zurückschreiben)")
    a = ap.parse_args()
    try:
        run(a.base, a.pair, a.run_id, a.llm, a.wiki, a.project, a.propose)
    except AgentError as e:
        sys.exit(f"Agent-Fehler: {e}")


if __name__ == "__main__":
    main()
