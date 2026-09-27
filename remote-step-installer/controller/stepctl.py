#!/usr/bin/env python3
"""
remote-step-installer — controller CLI.

Drives a recipe against the agent step-by-step: streams each step's output live,
and on a failure/timeout offers retry / workaround / skip / abort / (LLM: TODO).
This is the functional core; the Textual TUI (tui.py) will sit on the same Agent.

Usage:
  python3 stepctl.py --recipe ../recipes/mupibox.yaml --pair 123456
  python3 stepctl.py --recipe ../recipes/mupibox.yaml --pair 123456 --base http://127.0.0.1:8099
"""
import argparse
import shlex
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML fehlt:  pip install pyyaml  (nur der Controller braucht es, nicht der Agent)")

from core import (Agent, AgentError, resolve_recipe, step_puts, step_check,
                  box_fakten, cached_agent, anzeige_schritt)
import anim
import hardware

# tiny ANSI theme (a real theme system comes with the TUI)
C = {"h": "\033[1;36m", "ok": "\033[1;32m", "err": "\033[1;31m",
     "warn": "\033[1;33m", "dim": "\033[2m", "0": "\033[0m"}
COLOR = anim.supports_anim()      # nur im echten Terminal; --plain schaltet es in main() ab


def c(k, s):
    return f"{C[k]}{s}{C['0']}" if COLOR else s


def env_prefix(recipe):
    env = recipe.get("env") or {}
    if not env:
        return ""
    return "; ".join(f"export {k}={shlex.quote(str(v))}" for k, v in env.items()) + "; "


def run_step(agent, step, prefix, plain=False, nummer=None, gesamt=None):
    cmd = step["run"]
    name = step.get("name", step["id"])
    # Damit derselbe Stand auf dem Bildschirm der BOX steht — wer davorsitzt,
    # sieht sonst 10 bis 20 Minuten lang nur die Boot-Animation von vorhin.
    anzeige = anzeige_schritt(step, nummer, gesamt)
    while True:
        print()
        print(c("h", f"▶ {name}"))
        if step.get("note"):
            print(c("dim", "  " + step["note"]))
        run_id = None
        try:                      # eigene Pakete hochladen, bevor der Schritt läuft
            if step_puts(agent, step, on_line=lambda s: print(c("dim", "  " + s))):
                pass
        except (FileNotFoundError, ValueError, AgentError) as e:
            print(c("err", f"  Upload fehlgeschlagen: {e}"))
            return
        # bunte Live-Zeile (Pacman frisst die Pakete); ohne TTY/--plain roh + parsebar
        an = anim.Animator(name, plain=plain).start()
        try:
            run_id = agent.run(step["id"], prefix + cmd, step.get("timeout"),
                               schritt=anzeige)
            res = agent.stream(run_id, on_line=an.line)
        except KeyboardInterrupt:
            try:
                if run_id:
                    agent.abort(run_id)
            except Exception:
                pass
            res = {"exit": 130, "aborted": True, "timedout": False}
            an.stop()
            print(c("warn", "  ⨯ abgebrochen"))
        except AgentError as e:
            res = {"exit": 1, "aborted": False, "timedout": False}
            an.stop()
            print(c("err", f"  Agent-Fehler: {e}"))

        exit_code = res.get("exit")
        ok = exit_code == 0 and not res.get("aborted") and not res.get("timedout")
        an.stop(ok=ok if not res.get("aborted") else None)
        if res.get("timedout"):
            print(c("warn", f"  ⏱ Timeout ({step.get('timeout')}s) — Schritt gekillt"))
        grund = f"exit {exit_code}"
        if ok:
            if not an.anim:                 # ohne Animation fehlt die Abschlusszeile
                print(c("ok", "  ✓ OK"))
            # PROBE: exit 0 heisst nur „gelaufen", nicht „gewirkt". Trägt der
            # Schritt ein `check:`, entscheidet das — sonst meldet ein Schritt
            # Erfolg, der nichts hinterlassen hat (auf der Box erlebt).
            geprueft = step_check(agent, step, prefix,
                                  on_line=lambda s: print(c("dim", "  " + s)))
            if geprueft is not False:       # None = keine Probe, True = bestanden
                if geprueft:
                    print(c("ok", "  ✓ Probe bestanden"))
                return
            print(c("err", "  ✗ Probe fehlgeschlagen — der Schritt lief durch, hat aber nicht gewirkt"))
            print(c("dim", "    check: " + str(step["check"]).strip().splitlines()[0][:120]))
            grund = "Probe (check:) fehlgeschlagen"
        # ---- failure menu --------------------------------------------------
        opts = ["[r] wiederholen"]
        was = step.get("workarounds") or []
        if was:
            opts.append("[w] Workaround")
        if step.get("optional"):
            opts.append("[s] überspringen")
        opts += ["[l] LLM fragen", "[q] Abbruch"]
        print(c("err", f"  ✗ fehlgeschlagen ({grund}).  ") + "  ".join(opts))
        ch = (input("  > ").strip().lower() or "r")[:1]
        if ch == "r":
            continue
        if ch == "w" and was:
            for i, w in enumerate(was):
                print(f"    {i+1}) {w['name']}")
            sel = input("    Workaround Nr: ").strip()
            if sel.isdigit() and 1 <= int(sel) <= len(was):
                cmd = was[int(sel) - 1]["run"]
            continue
        if ch == "s" and step.get("optional"):
            print(c("warn", "  → übersprungen"))
            return
        if ch == "l":
            print(c("dim", "  (LLM-Anbindung noch nicht verdrahtet — Roadmap. "
                          "Output oben an dein LLM geben, Fix als Workaround eintragen.)"))
            continue
        if ch == "q":
            sys.exit(c("err", "Abgebrochen."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recipe", required=True)
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair", help="Pair-Code (entfällt nach ./connect — Token ist gecacht)")
    ap.add_argument("--plain", action="store_true",
                    help="ohne Farbe/Animation (roh + parsebar; ohne TTY ohnehin automatisch)")
    args = ap.parse_args()
    if args.plain:
        global COLOR
        COLOR = False

    try:
        recipe_path = resolve_recipe(args.recipe)
    except FileNotFoundError as e:
        sys.exit(c("err", str(e)))
    with open(recipe_path) as f:
        recipe = yaml.safe_load(f)

    try:
        # --pair ist OPTIONAL: nach `./connect` liegt der Token im Cache
        agent = cached_agent(args.base, args.pair)
    except AgentError as e:
        sys.exit(c("err", f"Verbindung fehlgeschlagen: {e}"))
    print(c("ok", f"✓ verbunden mit {args.base} — Recipe: {recipe.get('name')}"))

    steps = recipe.get("steps", [])
    # Erkannte Umgebung ($BOOT_DIR/$DIETPI_DIR/$CODENAME/$PI_MODEL) einspeisen —
    # ohne das bleiben Recipe-Pfade leer (echter Lauf: tar auf "/MuPiBox-*.tgz").
    try:
        import sysinfo
        prefix = sysinfo.recipe_prefix(agent, recipe)
    except Exception as e:
        print(c("warn", f"Umgebung nicht erkannt ({e}) — nutze nur die Recipe-Env"))
        prefix = env_prefix(recipe)
    # Welche Schritte gehören zu DIESER Box? Ein `when:` stand bisher nur im
    # Rezept — die TUI wertete es aus, dieser Runner fuhr auch die Schritte der
    # anderen Hardware. Leere Faktenmenge (Erkennung nicht durchgekommen) heisst
    # bewusst: nichts auslassen.
    fakten = box_fakten(agent)
    for i, step in enumerate(steps):
        print(c("dim", f"\n── Schritt {i+1}/{len(steps)} ──"))
        if not hardware.passt(step.get("when"), fakten):
            print(c("warn", f"  ⏭ {step.get('name', step['id'])} — "
                            f"nur für »{step['when']}«, diese Box ist es nicht"))
            continue
        run_step(agent, step, prefix, plain=args.plain,
                 nummer=i + 1, gesamt=len(steps))

    print(c("ok", "\n✓ Recipe durch."))
    if input("Agent beenden + entfernen (Sicherheit)? [J/n] ").strip().lower() in ("", "j", "y"):
        try:
            agent.shutdown(remove=True)
            print(c("ok", "Agent beendet + entfernt."))
        except AgentError:
            print(c("warn", "Agent meldete sich nicht mehr (vermutlich schon weg)."))


if __name__ == "__main__":
    main()
