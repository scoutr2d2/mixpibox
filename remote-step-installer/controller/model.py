"""
Pi-Modell-Erkennung + -Auswahl.

Normalisiert `/proc/device-tree/model` auf eine kompakte ID, damit die Analyse
modell-korrekt urteilt (z.B. Legacy-fkms ist auf Pi 4 ok, auf Pi 5 ein Schwarzbild;
gpu_mem zählt auf Pi 4, wird auf Pi 5 ignoriert). Manuelle Auswahl via `--model`
überschreibt die Erkennung — wichtig, wenn wir es auf einem älteren Board testen.
"""

# id -> (Label, SoC, kms_only?)   kms_only = nur voller KMS-Treiber (kein fkms/Legacy)
MODELS = {
    "pi5":     ("Raspberry Pi 5",         "bcm2712", True),
    "cm4":     ("Compute Module 4",       "bcm2711", False),
    "pi4":     ("Raspberry Pi 4 / 400",   "bcm2711", False),
    "pi3":     ("Raspberry Pi 3",         "bcm2837", False),
    "pizero2": ("Raspberry Pi Zero 2 W",  "bcm2837", False),
    "pi2":     ("Raspberry Pi 2",         "bcm2836", False),
    "pizero":  ("Raspberry Pi Zero",      "bcm2835", False),
    "pi1":     ("Raspberry Pi 1",         "bcm2835", False),
}


def normalize(model_string):
    """'/proc/device-tree/model'-Text -> ID (oder 'unknown')."""
    s = (model_string or "").lower().replace("\x00", "")
    if "pi 5" in s or "bcm2712" in s:
        return "pi5"
    if "compute module 4" in s or "cm4" in s:
        return "cm4"
    if "pi 400" in s or "pi 4" in s or "bcm2711" in s:
        return "pi4"
    if "zero 2" in s:
        return "pizero2"
    if "pi 3" in s or "bcm2837" in s:
        return "pi3"
    if "pi 2" in s or "bcm2836" in s:
        return "pi2"
    if "zero" in s:
        return "pizero"
    if "pi 1" in s or "pi model b" in s or "bcm2835" in s:
        return "pi1"
    return "unknown"


_ALIASES = {
    "5": "pi5", "pi5": "pi5",
    "400": "pi4", "pi400": "pi4", "4": "pi4", "pi4": "pi4",
    "cm4": "cm4",
    "3": "pi3", "pi3": "pi3",
    "zero2": "pizero2", "pizero2": "pizero2",
    "2": "pi2", "pi2": "pi2",
    "zero": "pizero", "pizero": "pizero", "pi0": "pizero", "0": "pizero",
    "1": "pi1", "pi1": "pi1",
}


def pick(override):
    """Manuelle --model-Auswahl normalisieren; '' / 'auto' -> None (erkennen)."""
    o = (override or "").lower().strip()
    if o in ("", "auto"):
        return None
    o = o.replace("raspberry", "").replace(" ", "").replace("-", "").replace("_", "")
    return _ALIASES.get(o, o)


def label(mid):
    return MODELS.get(mid, (mid or "unbekannt",))[0]


def kms_only(mid):
    return MODELS.get(mid, ("", "", False))[2]


def choices():
    return list(MODELS.keys())
