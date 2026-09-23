#!/usr/bin/env python3
"""
remote-step-installer — headless, scriptable controller.

The "drive it from a chat / an LLM / a script" interface: each call does ONE thing
and prints the result (streaming the live output), so an operator — or an assistant
in a chat, composing commands and reading the output — can steer the install step by
step from a plain shell. This is how "you could control it" works: the LLM IS the
driver; this is its steering wheel.

  rsi.py --base URL --pair 123456 pair                 # pair once (caches a token)
  rsi.py list --recipe ../recipes/mupibox.yaml         # list recipe steps
  rsi.py run node --recipe ../recipes/mupibox.yaml     # run a recipe step (streams)
  rsi.py exec "apt-get install -y rpi-eeprom" --timeout 120   # ad-hoc command (a fix)
  rsi.py search rpi-eeprom                              # package lookup
  rsi.py diagnose <run_id> --wiki mupibox              # diagnose a failure (known + UNKNOWN)
  rsi.py diagnose <run_id> --wiki mupibox --llm        # ...and ask the configured LLM
  rsi.py wiki --wiki mupibox                           # show the project knowledge (llmwiki)
  rsi.py status
  rsi.py abort <run_id>
  rsi.py shutdown --remove

The pair token is cached in $TMPDIR/rsi-<hash(base)>.token, so calls after `pair`
need no code. --recipe is only required for list/run. Exit code 0 on success, 2 on a
failed/aborted/timed-out step — so a driver can branch on it.
"""
import argparse
import hashlib
import json
import os
import shlex
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import Agent, AgentError, step_puts, step_check, box_fakten


def token_path(base):
    h = hashlib.sha1(base.encode()).hexdigest()[:12]
    return os.path.join(tempfile.gettempdir(), f"rsi-{h}.token")


def load_recipe(path):
    if not path:
        sys.exit("--recipe fehlt (für list/run nötig)")
    import yaml
    from core import resolve_recipe
    try:
        path = resolve_recipe(path)      # tolerant: Pfad, recipes/x.yaml oder nur 'demo'
    except FileNotFoundError as e:
        sys.exit(str(e))
    with open(path) as f:
        return yaml.safe_load(f)


def env_prefix(recipe):
    env = recipe.get("env") or {}
    return ("; ".join(f"export {k}={shlex.quote(str(v))}" for k, v in env.items()) + "; ") if env else ""


def run_and_stream(agent, sid, cmd, timeout):
    rid = agent.run(sid, cmd, timeout)
    print(f"[run_id {rid}] {cmd}", flush=True)
    res = agent.stream(rid, lambda ln: print(ln, flush=True))
    ok = res.get("exit") == 0 and not res.get("aborted") and not res.get("timedout")
    print(f"[{'OK' if ok else 'FAIL'}] exit={res.get('exit')} "
          f"aborted={res.get('aborted')} timedout={res.get('timedout')}", flush=True)
    if not ok:
        # a failed step points at its own diagnosis — works for UNKNOWN problems too
        print(f"       \033[2m→ Diagnose:  python3 controller/rsi.py diagnose {rid} "
              f"--wiki <projekt> [--llm]\033[0m", flush=True)
    return 0 if ok else 2


def main():
    ap = argparse.ArgumentParser(description="headless controller (drive from a shell/LLM)")
    ap.add_argument("action", choices=["pair", "list", "run", "exec", "search", "perf", "config", "sysinfo", "diagnose", "wiki", "watch", "status", "abort", "shutdown"])
    ap.add_argument("arg", nargs="?", help="step-id / command / query / run_id (watch: optional)")
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair", help="pair code (once; caches a token)")
    ap.add_argument("--recipe", help="recipe file (for list/run)")
    ap.add_argument("--timeout", type=int, help="kill the step after N seconds")
    ap.add_argument("--model", help="config/perf: Modell erzwingen (pi5/pi4/pi3/… ; 'auto'=erkennen)")
    ap.add_argument("--distro", help="sysinfo/run: Debian-Codename erzwingen (bookworm/trixie/forky)")
    ap.add_argument("--wiki", help="diagnose/config/perf/wiki: Wissenspaket (Projektname/Pfad)")
    ap.add_argument("--project", help="diagnose/config/perf: Projekt/Recipe-Name → dessen Standard-Wissen")
    ap.add_argument("--llm", action="store_true", help="diagnose: zusätzlich den konfigurierten LLM fragen (RSI_LLM_URL)")
    ap.add_argument("--propose", action="store_true", help="diagnose: Wiki-Signatur-Entwurf zum Zurückschreiben ausgeben")
    ap.add_argument("--query", help="wiki: Volltext-Filter")
    ap.add_argument("--kind", action="append", help="wiki: nur diese Art (optim/signature/config/perf/howto/note)")
    ap.add_argument("--remove", action="store_true", help="shutdown: also self-remove the agent")
    a = ap.parse_args()

    agent = Agent(a.base)
    tp = token_path(a.base)
    try:
        if a.pair:
            agent.pair(a.pair)
            with open(tp, "w") as f:
                f.write(agent.token)
            os.chmod(tp, 0o600)
            print("paired; token cached", flush=True)
        elif os.path.exists(tp):
            agent.token = open(tp).read().strip()
        elif a.action not in ("pair", "wiki", "list"):  # rein lokal (kein Agent nötig)
            sys.exit("nicht gepairt — erst:  rsi.py pair --base <URL> --pair <CODE>")

        if a.action == "pair":
            return
        if a.action == "list":
            for s in load_recipe(a.recipe).get("steps", []):
                flags = ("[opt]" if s.get("optional") else "") \
                    + (f"[{len(s['workarounds'])}wa]" if s.get("workarounds") else "") \
                    + (f"[t{s['timeout']}]" if s.get("timeout") else "") \
                    + (f"[when {s['when']}]" if s.get("when") else "") \
                    + ("[check]" if s.get("check") else "")
                print(f"  {s['id']:26} {s.get('name','')}  {flags}")
            return
        if a.action == "run":
            import hardware
            import sysinfo
            rec = load_recipe(a.recipe)
            step = next((s for s in rec.get("steps", []) if s["id"] == a.arg), None)
            if not step:
                sys.exit(f"kein Schritt '{a.arg}' in der Recipe")
            # Gehört der Schritt überhaupt zu DIESER Box? Ein `when:` wurde hier
            # bisher gar nicht gelesen — der Schritt lief auf jeder Hardware.
            # Übersprungen ist KEIN Fehler: exit 0, damit ein Treiber weiterläuft.
            if not hardware.passt(step.get("when"), box_fakten(agent)):
                print(f"[SKIP] {step['id']} — nur für »{step['when']}«, diese Box ist es nicht",
                      flush=True)
                sys.exit(0)
            # eigene Pakete hochladen (put:), dann die erkannte Umgebung einspeisen
            try:
                step_puts(agent, step, on_line=lambda s: print("  " + s, flush=True))
            except (FileNotFoundError, ValueError, AgentError) as e:
                sys.exit(f"Upload fehlgeschlagen: {e}")
            prefix = sysinfo.recipe_prefix(agent, rec, a.model, a.distro)
            rc = run_and_stream(agent, step["id"], prefix + step["run"],
                                step.get("timeout") or a.timeout)
            if rc == 0:
                # PROBE: exit 0 heisst nur „gelaufen", nicht „gewirkt".
                geprueft = step_check(agent, step, prefix,
                                      on_line=lambda ln: print("  " + ln, flush=True))
                if geprueft is False:
                    print("[FAIL] Probe (check:) fehlgeschlagen — der Schritt lief durch, "
                          "hat aber nicht gewirkt", flush=True)
                    print(f"       check: {str(step['check']).strip().splitlines()[0][:120]}",
                          flush=True)
                    rc = 2
                elif geprueft:
                    print("[OK] Probe (check:) bestanden", flush=True)
            sys.exit(rc)
        if a.action == "exec":
            if not a.arg:
                sys.exit("exec braucht einen Befehl (in Anführungszeichen)")
            sys.exit(run_and_stream(agent, "exec", a.arg, a.timeout))
        if a.action == "search":
            print(json.dumps(agent.search(a.arg or ""), indent=1, ensure_ascii=False))
            return
        if a.action == "perf":
            import perf
            data = agent.perf()
            perf.report(data, perf.analyze(data, perf._wiki_hints(a.wiki, a.project)))
            return
        if a.action == "config":
            import configcheck
            cfg = agent.config()
            configcheck.report(cfg, configcheck.analyze(cfg, a.model, configcheck._wiki_rules(a.wiki, a.project)), a.model)
            return
        if a.action == "sysinfo":
            import sysinfo
            sysinfo.report(agent.sysinfo(), a.model, a.distro)
            return
        if a.action == "diagnose":
            import diagnose
            diagnose.report(agent, a.arg, use_llm=a.llm, wiki_name=a.wiki, project=a.project, propose=a.propose)
            return
        if a.action == "wiki":
            import wiki
            pack = wiki.resolve(a.wiki)
            if a.arg == "context":
                text, _ = wiki.context(pack, a.kind, a.query)
                print(text)
            else:
                wiki.report(pack, a.kind, a.query)
            return
        if a.action == "watch":
            # ZUSCHAUEN: an den laufenden Schritt anhaengen und live mitlesen — auch
            # wenn ihn jemand anderes gestartet hat (der Agent bedient beliebig viele
            # Zuhoerer). Ohne run_id: dranbleiben und jeden neuen Schritt zeigen.
            import time as _t
            if a.arg:
                run_and_watch = agent.stream(a.arg, lambda ln: print("  " + ln, flush=True))
                print(f"[ende] exit={run_and_watch.get('exit')} "
                      f"aborted={run_and_watch.get('aborted')} timedout={run_and_watch.get('timedout')}")
                return
            print("👀 warte auf Schritte …  (Strg-C beendet nur das Zuschauen, nicht den Lauf)", flush=True)
            seen = set()

            def reconnect():
                """Neustart der Box überstehen: warten, bis der Agent wieder da ist,
                und dabei den Token neu einlesen — `./connect --watch` schreibt nach
                dem Neu-Pairen einen frischen in dieselbe Datei."""
                print(f"\033[1;33m⚠ Verbindung weg (Neustart?) — warte …\033[0m", flush=True)
                while True:
                    _t.sleep(5)
                    if os.path.exists(tp):
                        agent.token = open(tp).read().strip()
                    try:
                        agent.status()
                        print(f"\033[1;32m✓ wieder verbunden\033[0m", flush=True)
                        return
                    except (AgentError, OSError):
                        continue

            try:
                while True:
                    try:
                        runs = agent.status().get("runs", {})
                    except (AgentError, OSError):
                        reconnect()
                        continue
                    todo = [(rid, r) for rid, r in runs.items() if rid not in seen]
                    live = [(rid, r) for rid, r in todo if not r.get("done")]
                    pick = live[-1] if live else (todo[-1] if todo else None)
                    if not pick:
                        _t.sleep(1.0)
                        continue
                    rid, rec = pick
                    seen.add(rid)
                    print(f"\n\033[1;36m▶ {rec.get('id')}\033[0m \033[2m[{rid}]\033[0m", flush=True)
                    try:
                        res = agent.stream(rid, lambda ln: print("  " + ln, flush=True))
                    except (AgentError, OSError):
                        reconnect()          # Abriss mitten im Schritt (z.B. reboot)
                        continue
                    ok = res.get("exit") == 0 and not res.get("aborted") and not res.get("timedout")
                    mark = "\033[1;32m✓\033[0m" if ok else "\033[1;31m✗\033[0m"
                    extra = " TIMEOUT" if res.get("timedout") else (" ABGEBROCHEN" if res.get("aborted") else "")
                    print(f"  {mark} exit={res.get('exit')}{extra}", flush=True)
            except KeyboardInterrupt:
                print("\n(Zuschauen beendet — der Lauf auf der Box läuft weiter)")
                return
        if a.action == "status":
            print(json.dumps(agent.status(), indent=1))
            return
        if a.action == "abort":
            print(json.dumps(agent.abort(a.arg)))
            return
        if a.action == "shutdown":
            print(json.dumps(agent.shutdown(remove=a.remove)))
            return
    except AgentError as e:
        sys.exit(f"Agent-Fehler: {e}")


if __name__ == "__main__":
    main()
