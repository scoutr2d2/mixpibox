#!/usr/bin/env python3
"""
Vollflächiges Testbild direkt in den Framebuffer (/dev/fb0) — ohne X/Wayland.

Zeigt auf einen Blick, ob das Panel VOLLSTÄNDIG und RICHTIG HERUM angesteuert wird:
  * ein 6 px breiter weisser Rahmen ganz aussen  → fehlt eine Kante, wird nicht die
    volle Fläche genutzt (falsche Auflösung/Overscan),
  * vier verschieden farbige Ecken mit Ziffern   → zeigt die Orientierung,
  * ein Mittelkreuz + Farbbalken                 → Geometrie und Farbkanäle.

  sudo python3 fbtest.py            # Muster anzeigen
  sudo python3 fbtest.py --clear    # Bildschirm schwarz
"""
import os
import struct
import sys

FB = "/dev/fb0"


def geometry():
    def rd(p, d=""):
        try:
            return open("/sys/class/graphics/fb0/" + p).read().strip()
        except OSError:
            return d
    w, h = (rd("virtual_size", "0,0").split(",") + ["0", "0"])[:2]
    bpp = rd("bits_per_pixel", "32")
    stride = rd("stride", "0")
    return int(w or 0), int(h or 0), int(bpp or 32), int(stride or 0)


def packer(bpp):
    """→ Funktion (r,g,b) -> bytes für dieses Pixelformat."""
    if bpp == 16:                                   # RGB565
        return lambda r, g, b: struct.pack("<H", ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
    if bpp == 24:
        return lambda r, g, b: bytes((b, g, r))
    return lambda r, g, b: bytes((b, g, r, 0))      # 32 bpp: BGRX


# 5x7-Ziffern für die Ecken (1..4) — klein, aber eindeutig
DIGITS = {
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
    "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
}


def main():
    w, h, bpp, stride = geometry()
    if not w or not h:
        sys.exit("Framebuffer-Geometrie nicht lesbar (/sys/class/graphics/fb0)")
    px = bpp // 8
    if not stride:
        stride = w * px
    pack = packer(bpp)
    clear = "--clear" in sys.argv

    black = pack(0, 0, 0)
    rows = []
    for y in range(h):
        if clear:
            rows.append(black * w + b"\x00" * (stride - w * px))
            continue
        row = bytearray()
        for x in range(w):
            r = g = b = 0
            near = 6
            corner = 70
            if x < near or y < near or x >= w - near or y >= h - near:
                r = g = b = 255                                   # Rahmen: volle Fläche?
            elif x < corner and y < corner:
                r = 255                                           # 1 oben links: ROT
            elif x >= w - corner and y < corner:
                g = 255                                           # 2 oben rechts: GRUEN
            elif x < corner and y >= h - corner:
                b = 255                                           # 3 unten links: BLAU
            elif x >= w - corner and y >= h - corner:
                r = g = 255                                       # 4 unten rechts: GELB
            elif abs(y - h // 2) < 3 or abs(x - w // 2) < 3:
                r = g = b = 200                                   # Mittelkreuz
            elif h // 2 - 60 < y < h // 2 - 20:                    # Farbbalken
                f = int(255 * x / max(1, w - 1))
                seg = int(6 * x / max(1, w))
                r, g, b = [(f, 0, 0), (0, f, 0), (0, 0, f), (f, f, 0), (0, f, f), (f, 0, f)][min(seg, 5)]
            row += pack(r, g, b)
        row += b"\x00" * (stride - w * px)
        rows.append(bytes(row))

    buf = bytearray(b"".join(rows))

    if not clear:                                   # Ziffern in die Ecken malen
        def put(digit, x0, y0, scale=4):
            for ry, line in enumerate(DIGITS[digit]):
                for rx, ch in enumerate(line):
                    if ch != "#":
                        continue
                    for sy in range(scale):
                        for sx in range(scale):
                            X, Y = x0 + rx * scale + sx, y0 + ry * scale + sy
                            if 0 <= X < w and 0 <= Y < h:
                                off = Y * stride + X * px
                                buf[off:off + px] = pack(0, 0, 0)
        put("1", 16, 16)
        put("2", w - 16 - 5 * 4, 16)
        put("3", 16, h - 16 - 7 * 4)
        put("4", w - 16 - 5 * 4, h - 16 - 7 * 4)

    with open(FB, "wb") as f:
        f.write(bytes(buf))
    print(f"{'geleert' if clear else 'Testbild gezeichnet'}: {w}x{h}, {bpp} bpp, stride {stride}")


if __name__ == "__main__":
    main()
