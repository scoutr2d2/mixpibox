#!/usr/bin/env python3
"""
remote-step-installer — Umgebungs-Erkennung (arbeitet mit allen DietPi-Versionen).

Erkennt Distro (Debian-Codename/-Version), DietPi-Version, die real genutzten Pfade
(`/boot` vs `/boot/firmware`, DietPi-Basisdir) und das Pi-Modell — auto oder per
--model/--distro überschrieben. Die erkannten Pfade werden als Shell-Variablen in die
Recipe-Env eingespeist ($BOOT_DIR/$DIETPI_DIR/$CODENAME/$PI_MODEL), damit ein Recipe
über alte + neue DietPi hinweg funktioniert, ohne Pfade hart zu kodieren.

  python3 sysinfo.py --base http://127.0.0.1:8099 --pair 123456
"""
import argparse
import os
import re
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import cached_agent, box_env, AgentError
import model as pimodel

DEBIAN = {"buster": 10, "bullseye": 11, "bookworm": 12, "trixie": 13, "forky": 14, "sid": 99}


def normalize(data, model_override=None, distro_override=None):
    codename = (distro_override or data.get("codename") or "").strip().lower()
    return {
        "codename": codename,
        "debian_major": DEBIAN.get(codename),
        "dietpi_raw": data.get("dietpi_version", ""),
        "boot_dir": data.get("boot_dir") or "/boot",
        "dietpi_dir": data.get("dietpi_dir") or "/boot/dietpi",
        "model_id": pimodel.pick(model_override) or pimodel.normalize(data.get("model", "")),
        "kernel": data.get("kernel", ""),
        "arch": data.get("arch", ""),
        "raw_model": (data.get("model", "") or "").replace("\x00", "").strip(),
        "distro": data.get("distro", ""),
    }


def dietpi_version(env):
    g = dict(re.findall(r"G_DIETPI_VERSION_(\w+)=(\d+)", env.get("dietpi_raw", "")))
    if g.get("CORE"):
        return f"{g['CORE']}.{g.get('SUB', 0)}.{g.get('RC', 0)}"
    return env.get("dietpi_raw") or "?"


def env_exports(env):
    return {
        "BOOT_DIR": env["boot_dir"],
        "DIETPI_DIR": env["dietpi_dir"],
        "CODENAME": env["codename"],
        "DEBIAN_MAJOR": str(env["debian_major"] or ""),
        "PI_MODEL": env["model_id"],
    }


def recipe_prefix(agent, recipe, model_override=None, distro_override=None):
    """Shell-Export-Prefix aus recipe.env + Box-Inventar + erkannter Umgebung.

    Drei Lagen, von allgemein nach speziell — die spätere gewinnt:
      1. `env:` des Rezepts        — gilt für jede Box
      2. `env:` der Box aus boxen.yaml (MUPI_HOST …) — gilt für DIESE Box
      3. die erkannten Pfade       — die Wahrheit vom Gerät

    Ohne Lage 2 kam ein box-eigener Wert nie in einem Schritt an, und der
    Rechner-/Spotify-Name musste je Box von Hand nachgezogen werden."""
    env = normalize(agent.sysinfo(), model_override, distro_override)
    merged = dict(recipe.get("env") or {})
    merged.update(box_env(env["model_id"]))
    merged.update(env_exports(env))
    parts = [f"export {k}={shlex.quote(str(v))}" for k, v in merged.items() if str(v) != ""]
    return ("; ".join(parts) + "; ") if parts else ""


def report(data, model_override=None, distro_override=None):
    e = normalize(data, model_override, distro_override)
    print("\033[1m System-Info\033[0m")
    print(f"  Modell:   {pimodel.label(e['model_id'])}   \033[2m({e['raw_model'] or '—'})\033[0m")
    print(f"  Distro:   {e['distro'] or '—'}   \033[2m(codename {e['codename'] or '?'}, Debian {e['debian_major'] or '?'})\033[0m")
    print(f"  DietPi:   {dietpi_version(e)}")
    print(f"  Kernel:   {e['kernel']}   {e['arch']}")
    print(f"  Pfade:    boot={e['boot_dir']}   dietpi={e['dietpi_dir']}")
    if e["codename"] == "trixie":
        print("  \033[2m(Debian 13 Trixie — DietPi-Standard; einzelne Pakete brauchen ggf. einen Workaround: rpi-eeprom-skip, nodesource→bookworm)\033[0m")
    elif e["codename"] == "forky" or (e["debian_major"] and e["debian_major"] >= 14):
        print("  \033[1;33m⚠ Debian 14 Forky — sehr neu → mehr Paket-Lücken möglich\033[0m")
    elif e["debian_major"] and e["debian_major"] < 12:
        print(f"  \033[1;33m⚠ Alte Basis ({e['codename']}) → ggf. andere Pakete/Node-Wege\033[0m")
    if not e["debian_major"]:
        print("  \033[2m(Codename unbekannt — mit --distro bookworm/trixie/forky setzen)\033[0m")


def run(base, pair=None, model_override=None, distro_override=None):
    report(cached_agent(base, pair).sysinfo(), model_override, distro_override)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8099")
    ap.add_argument("--pair")
    ap.add_argument("--model", help="Pi-Modell erzwingen")
    ap.add_argument("--distro", help="Debian-Codename erzwingen (bullseye/bookworm/trixie)")
    a = ap.parse_args()
    try:
        run(a.base, a.pair, a.model, a.distro)
    except AgentError as e:
        sys.exit(f"Agent-Fehler: {e}")


if __name__ == "__main__":
    main()
