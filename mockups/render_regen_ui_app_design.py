"""Regen-Nowcast UI Mockups im Design der bestehenden wetter-app.

Design-Tokens aus index.html:
- BG gradient #0f2540 -> #1a4a7a -> #2d7ab5
- Cards: rgba(255,255,255,0.09), radius 18, border rgba(255,255,255,0.14)
- Text weiss, Titles uppercase letter-spacing
- Akzente: GR #4DD9FF, HH #FFB830, ok #4ade80
"""
from __future__ import annotations

import json
import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

JSON_PATH = r"D:\OneDrive\BESS\_BOCX\cosor\tmp-radar\scharbeutz_regen_vorhersage_2h.json"
OUT_DIR = r"D:\OneDrive\BESS\_BOCX\wetter-app\mockups"
OUT_PHONE = os.path.join(OUT_DIR, "regen_nowcast_phone.png")
OUT_IPAD = os.path.join(OUT_DIR, "regen_nowcast_ipad.png")

# --- wetter-app tokens ---
GRAD_TOP = (15, 37, 64)       # #0f2540
GRAD_MID = (26, 74, 122)      # #1a4a7a
GRAD_BOT = (45, 122, 181)     # #2d7ab5
WHITE = (255, 255, 255)
MUTED = (255, 255, 255, 180)
CARD_FILL = (255, 255, 255, 28)       # ~0.11 alpha on dark
CARD_BORDER = (255, 255, 255, 40)
CYAN = (77, 217, 255)         # #4DD9FF GR
AMBER = (255, 184, 48)        # #FFB830
GREEN = (74, 222, 128)        # #4ade80
ORANGE = (251, 146, 60)       # #fb923c
RED = (239, 68, 68)           # #ef4444
RAIN_LINE = (120, 210, 255)   # countdown cyan
CHART_RAIN_MMH = 0.05


def font(size, bold=False):
    cands = (
        ["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf"]
        if bold
        else ["segoeui.ttf", "arial.ttf", "calibri.ttf"]
    )
    for n in cands:
        try:
            return ImageFont.truetype(n, size)
        except OSError:
            continue
    return ImageFont.load_default()


def fill_gradient(img: Image.Image):
    """160deg-aehnlicher Vertikalverlauf wie body background."""
    w, h = img.size
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        if t < 0.55:
            u = t / 0.55
            r = int(GRAD_TOP[0] + (GRAD_MID[0] - GRAD_TOP[0]) * u)
            g = int(GRAD_TOP[1] + (GRAD_MID[1] - GRAD_TOP[1]) * u)
            b = int(GRAD_TOP[2] + (GRAD_MID[2] - GRAD_TOP[2]) * u)
        else:
            u = (t - 0.55) / 0.45
            r = int(GRAD_MID[0] + (GRAD_BOT[0] - GRAD_MID[0]) * u)
            g = int(GRAD_MID[1] + (GRAD_BOT[1] - GRAD_MID[1]) * u)
            b = int(GRAD_MID[2] + (GRAD_BOT[2] - GRAD_MID[2]) * u)
        for x in range(w):
            px[x, y] = (r, g, b, 255) if img.mode == "RGBA" else (r, g, b)


def glass_card(base: Image.Image, box, radius=18):
    """Halbtransparente Card mit Border wie .card."""
    x0, y0, x1, y1 = box
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rounded_rectangle(box, radius=radius, fill=CARD_FILL, outline=CARD_BORDER, width=1)
    return Image.alpha_composite(base.convert("RGBA"), overlay)


def rgba_text(draw, xy, text, fill, fnt):
    if len(fill) == 3:
        fill = (*fill, 255)
    draw.text(xy, text, fill=fill, font=fnt)


def wrap_text(draw, text, fnt, max_w):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def first_precip(timeline):
    for s in timeline:
        if s.get("site_mmh", 0) >= CHART_RAIN_MMH or s.get("is_raining"):
            return s["minutes_from_now"], s
    return None, None


def draw_sparkline(draw, box, timeline, begin_min):
    x0, y0, x1, y1 = box
    axis_h, axis_w = 40, 34
    plot_x0 = x0 + axis_w
    plot_y1 = y1 - axis_h
    plot_w = x1 - plot_x0
    plot_h = plot_y1 - y0
    vals = [s["site_mmh"] for s in timeline]
    vmax = max(1.0, max(vals) * 1.25)
    max_m = max(s["minutes_from_now"] for s in timeline) or 1

    def x_at(m):
        return plot_x0 + int((m / max_m) * (plot_w - 8))

    def y_at(v):
        return plot_y1 - int((v / vmax) * (plot_h - 10))

    # plot bg — dunkles Glas wie App-Cards
    draw.rounded_rectangle(box, radius=12, fill=(10, 28, 55, 120), outline=CARD_BORDER)

    for v in (0.0, vmax * 0.5, vmax):
        yy = y_at(v)
        draw.line([(plot_x0, yy), (x1 - 6, yy)], fill=(255, 255, 255, 28))
        lab = f"{v:.1f}"
        tw = draw.textlength(lab, font=font(9))
        rgba_text(draw, (plot_x0 - 6 - tw, yy - 6), lab, (255, 255, 255, 160), font(9))
    draw.line([(plot_x0, y0 + 4), (plot_x0, plot_y1)], fill=(255, 255, 255, 50))
    rgba_text(draw, (plot_x0 + 4, y0 + 2), "mm/h", CYAN, font(9))
    rgba_text(draw, (plot_x0 + 4, plot_y1 - 14), "0 = trocken", (255, 255, 255, 140), font(8))
    draw.line([(plot_x0, plot_y1), (x1 - 6, plot_y1)], fill=(255, 255, 255, 60))

    cest_by = {}
    for s in timeline:
        cest_by[int(round(s["minutes_from_now"] / 5) * 5)] = s.get("valid_time_cest")

    for m5 in range(0, int(max_m) + 5, 5):
        if m5 > max_m + 1:
            continue
        x = x_at(min(m5, max_m))
        major = m5 % 15 == 0 or m5 == 0 or m5 >= max_m - 2
        draw.line([(x, plot_y1), (x, plot_y1 + (6 if major else 3))], fill=(255, 255, 255, 120 if major else 60))
        lab = f"+{m5}"
        tw = draw.textlength(lab, font=font(8))
        rgba_text(draw, (x - tw / 2, plot_y1 + 7), lab, (255, 255, 255, 200 if major else 130), font(8))
        if major and cest_by.get(m5):
            tw2 = draw.textlength(cest_by[m5], font=font(9))
            rgba_text(draw, (x - tw2 / 2, plot_y1 + 19), cest_by[m5], CYAN, font(9))

    wet = []
    for s in timeline:
        if s["site_mmh"] < CHART_RAIN_MMH and not s.get("is_raining"):
            continue
        wet.append((x_at(s["minutes_from_now"]), y_at(s["site_mmh"]), s["minutes_from_now"], s["site_mmh"]))

    if len(wet) >= 2:
        segs = [[wet[0]]]
        for p in wet[1:]:
            if p[2] - segs[-1][-1][2] > 10:
                segs.append([p])
            else:
                segs[-1].append(p)
        for seg in segs:
            if len(seg) >= 2:
                draw.line([(q[0], q[1]) for q in seg], fill=RAIN_LINE, width=3)
            for x, y, _, mmh in seg:
                col = GREEN if mmh >= 0.5 else RAIN_LINE
                draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=col)

    if begin_min is not None:
        x = x_at(begin_min)
        draw.line([(x, y0 + 14), (x, plot_y1)], fill=CYAN, width=2)
        rgba_text(draw, (x + 5, y0 + 2), "Beginn", CYAN, font(9))

    rgba_text(
        draw,
        (plot_x0, y1 - 11),
        "5-Min-Schritte  |  nur bei Niederschlag  |  Beginn = Kurvenstart",
        (255, 255, 255, 140),
        font(8),
    )


def draw_radar(draw, box, approach_dir, dist_km, begin_min):
    x0, y0, x1, y1 = box
    # dunkler Innenbereich wie settings-menu / modal
    draw.rounded_rectangle(box, radius=14, fill=(10, 28, 55, 160), outline=CARD_BORDER)

    title_h, legend_h, status_h = 32, 48, 24
    plot_top = y0 + title_h
    plot_bot = y1 - legend_h - status_h
    rgba_text(draw, (x0 + 12, y0 + 10), "RADAR · ANNAEHERUNG", (255, 255, 255, 200), font(11))

    if begin_min is not None:
        badge = f"{int(begin_min)} Min bis Niederschlag"
        f_b = font(11)
        tw = draw.textlength(badge, font=f_b)
        bx0 = x1 - 12 - tw - 16
        draw.rounded_rectangle(
            (bx0, y0 + 6, x1 - 10, y0 + 30),
            radius=20,
            fill=(255, 255, 255, 28),
            outline=CYAN,
            width=1,
        )
        rgba_text(draw, (bx0 + 8, y0 + 10), badge, CYAN, font(11))

    cx = (x0 + x1) // 2
    cy = (plot_top + plot_bot) // 2
    max_ring = min((x1 - x0) // 2 - 44, (plot_bot - plot_top) // 2 - 12)
    max_ring = max(70, max_ring)
    kpp = 30.0 / max_ring

    for km in (10, 20, 30):
        r = int(km / kpp)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(255, 255, 255, 110), width=2)
        if km < 30:
            rgba_text(draw, (cx + r + 5, cy - 8), f"{km} km", (255, 255, 255, 180), font(10))

    r30 = int(30 / kpp)
    for lab, ang in (("N", 90), ("O", 0), ("S", 270), ("W", 180)):
        a = math.radians(ang)
        lx = cx + int(math.cos(a) * (r30 + 16))
        ly = cy - int(math.sin(a) * (r30 + 16))
        tw = draw.textlength(lab, font=font(13))
        rgba_text(draw, (lx - tw / 2, ly - 9), lab, WHITE, font(13, True))
    rgba_text(draw, (cx + int(r30 * 0.65), cy - int(r30 * 0.65) - 4), "30 km", (255, 255, 255, 160), font(9))

    dirs = {"W": 180, "SW": 225, "S": 270, "NW": 135, "N": 90, "NO": 45, "O": 0, "SO": 315}
    ang = math.radians(dirs.get(approach_dir, 225))
    dist_px = max(max(8.0, min(28.0, float(dist_km))) / kpp, 30)
    bx = cx + int(math.cos(ang) * dist_px)
    by = cy - int(math.sin(ang) * dist_px)
    for rr, col in ((20, (*CYAN, 70)), (14, (*CYAN, 160)), (7, (*GREEN, 230))):
        draw.ellipse((bx - rr, by - rr, bx + rr, by + rr), fill=col)
    draw.line([(cx, cy), (bx, by)], fill=(255, 255, 255, 200), width=2)
    draw.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=RED, outline=WHITE, width=2)

    status = f"Front ~{dist_km:.0f} km ({approach_dir}) — noch nicht am Ort"
    rgba_text(draw, (x0 + 12, plot_bot + 4), status, (255, 255, 255, 220), font(11))

    items = [
        (RED, "Standort"),
        ((220, 230, 240), "km · N/O/S/W"),
        (WHITE, "Richtung"),
        (CYAN, "Regenfront"),
    ]
    col_w = (x1 - x0 - 24) // 2
    for i, (col, txt) in enumerate(items):
        ix = x0 + 12 + (i % 2) * col_w
        iy = y1 - legend_h + 6 + (i // 2) * 20
        c3 = col[:3] if len(col) >= 3 else col
        draw.ellipse((ix, iy + 2, ix + 9, iy + 11), fill=c3)
        rgba_text(draw, (ix + 13, iy), txt, (255, 255, 255, 190), font(10))


def render_phone(data):
    s, w, timeline = data["summary"], data["window"], data["timeline"]
    approach = s.get("approach") or {}
    begin_min, begin_step = first_precip(timeline)
    begin_cest = (begin_step or {}).get("valid_time_cest") or s.get("onset_cest")

    W, H = 520, 1380
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    # device
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((24, 16, W - 24, H - 16), radius=44, fill=(8, 14, 24, 255))
    screen = (34, 36, W - 34, H - 36)
    # gradient screen
    screen_img = Image.new("RGBA", (screen[2] - screen[0], screen[3] - screen[1]), (0, 0, 0, 255))
    fill_gradient(screen_img)
    canvas.paste(screen_img, (screen[0], screen[1]))
    draw = ImageDraw.Draw(canvas, "RGBA")

    sx0, sy0, sx1, sy1 = screen
    # notch
    draw.rounded_rectangle(((sx0 + sx1) // 2 - 48, sy0 + 10, (sx0 + sx1) // 2 + 48, sy0 + 28), radius=10, fill=(5, 10, 18))
    rgba_text(draw, (sx0 + 22, sy0 + 12), w["query_now_cest"], WHITE, font(12, True))
    rgba_text(draw, (sx1 - 70, sy0 + 12), "5G", (255, 255, 255, 180), font(11))

    y = sy0 + 44
    cl, cr = sx0 + 16, sx1 - 16
    cw = cr - cl

    rgba_text(draw, (cl, y), "WETTER", (255, 255, 255, 160), font(12))
    y += 18
    rgba_text(draw, (cl, y), "Regen · 2 Stunden", WHITE, font(13))
    y += 22
    rgba_text(draw, (cl, y), "Gronenberg", WHITE, font(28, True))
    y += 36
    rgba_text(draw, (cl, y), f"Ab Jetzt · bis {w['horizon_end_cest']} · DWD RV", (255, 255, 255, 160), font(11))
    y += 26

    # hero card
    hero = (cl, y, cr, y + 118)
    canvas = glass_card(canvas, hero)
    draw = ImageDraw.Draw(canvas, "RGBA")
    rgba_text(draw, (cl + 14, y + 12), "HEUTE ABEND", (255, 255, 255, 170), font(11))
    rgba_text(draw, (cl + 14, y + 34), s["verdict"].replace("_", " ").title(), CYAN, font(24, True))
    for i, line in enumerate(
        wrap_text(draw, f"Kurzer Niesel ab ca. {s.get('onset_cest') or begin_cest} Uhr. {s.get('peak_feel','')}", font(13), cw - 36)[:2]
    ):
        rgba_text(draw, (cl + 14, y + 72 + i * 17), line, (255, 255, 255, 220), font(13))
    y += 130

    # ETA / Peak
    gap = 10
    half = (cw - gap) // 2
    for box, title, main, sub, col in (
        ((cl, y, cl + half, y + 88), "ETA AM ORT", begin_cest or "—", f"in ~{begin_min} Min" if begin_min is not None else "—", GREEN),
        ((cl + half + gap, y, cr, y + 88), "PEAK", f"{s['peak_mmh']:.1f} mm/h", f"{s['peak_class']} · {s['peak_cest']}", AMBER),
    ):
        canvas = glass_card(canvas, box)
        draw = ImageDraw.Draw(canvas, "RGBA")
        rgba_text(draw, (box[0] + 12, box[1] + 10), title, (255, 255, 255, 160), font(10))
        rgba_text(draw, (box[0] + 12, box[1] + 32), main, WHITE, font(22, True))
        rgba_text(draw, (box[0] + 12, box[1] + 62), sub, col, font(12))
    y += 100

    # chart
    chart = (cl, y, cr, y + 168)
    canvas = glass_card(canvas, chart)
    draw = ImageDraw.Draw(canvas, "RGBA")
    rgba_text(draw, (cl + 12, y + 10), "INTENSITAET AB JETZT", (255, 255, 255, 170), font(11))
    draw_sparkline(draw, (cl + 10, y + 32, cr - 10, y + 156), timeline, begin_min)
    y += 180

    # proximity
    rgba_text(draw, (cl, y), "WANN KOMMT DER REGEN IN DIE NAEHE?", (255, 255, 255, 160), font(10))
    y += 18
    prox = s.get("proximity_eta_min_from_now") or {}
    chips = [
        ("REGEN < 10 KM", f"in {prox.get('within_10km', '—')} Min", "10-km-Kreis", GREEN),
        ("REGEN < 5 KM", f"in {prox.get('within_5km', '—')} Min", "5-km-Kreis", AMBER),
        ("MENGE AM ORT", f"{s['sum_mm_in_window']:.2f} mm", "Summe 2 h", CYAN),
    ]
    chip_w = (cw - 2 * gap) // 3
    for i, (t, v, h, col) in enumerate(chips):
        x0 = cl + i * (chip_w + gap)
        box = (x0, y, x0 + chip_w, y + 78)
        canvas = glass_card(canvas, box, 14)
        draw = ImageDraw.Draw(canvas, "RGBA")
        rgba_text(draw, (x0 + 8, y + 8), t, (255, 255, 255, 150), font(8))
        rgba_text(draw, (x0 + 8, y + 28), v, col, font(13, True))
        rgba_text(draw, (x0 + 8, y + 52), h, (255, 255, 255, 140), font(9))
    y += 92

    # radar
    radar_h = 290
    radar = (cl, y, cr, y + radar_h)
    canvas = glass_card(canvas, radar)
    draw = ImageDraw.Draw(canvas, "RGBA")
    d0 = float((approach or {}).get("distance_km_now") or (approach or {}).get("distance_km_t0") or 23)
    adir = (approach or {}).get("dir_from", "W")
    draw_radar(draw, (cl + 8, y + 8, cr - 8, y + radar_h - 8), adir, d0, begin_min)
    y += radar_h + 14

    rgba_text(draw, (cl, y), "Radar-Nowcast · keine % · Update ~5 Min", (255, 255, 255, 130), font(10))
    y += 22

    # bottom pills like range-toggle
    tab_h = 42
    tab_y = min(y + 8, sy1 - 28 - tab_h)
    draw.rounded_rectangle((cl, tab_y, cr, tab_y + tab_h), radius=24, fill=(255, 255, 255, 22), outline=CARD_BORDER)
    for i, (lab, on) in enumerate((("Uebersicht", True), ("Timeline", False), ("Karte", False))):
        tw = (cr - cl) / 3
        tx = cl + i * tw
        if on:
            draw.rounded_rectangle((tx + 4, tab_y + 5, tx + tw - 4, tab_y + tab_h - 5), radius=18, fill=(255, 255, 255, 40))
        rgba_text(draw, (tx + 12, tab_y + 12), lab, CYAN if on else (255, 255, 255, 170), font(11, on))

    canvas.convert("RGB").save(OUT_PHONE, "PNG", optimize=True)
    print("wrote", OUT_PHONE)


def render_ipad(data):
    s, w, timeline = data["summary"], data["window"], data["timeline"]
    approach = s.get("approach") or {}
    begin_min, begin_step = first_precip(timeline)
    begin_cest = (begin_step or {}).get("valid_time_cest") or s.get("onset_cest")

    W, H = 1280, 900
    canvas = Image.new("RGBA", (W, H), (8, 14, 24, 255))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((28, 20, W - 28, H - 20), radius=32, fill=(10, 18, 30, 255))
    screen = (40, 34, W - 40, H - 34)
    screen_img = Image.new("RGBA", (screen[2] - screen[0], screen[3] - screen[1]), (0, 0, 0, 255))
    fill_gradient(screen_img)
    canvas.paste(screen_img, (screen[0], screen[1]))
    draw = ImageDraw.Draw(canvas, "RGBA")

    sx0, sy0, sx1, sy1 = screen
    rgba_text(draw, (sx0 + 28, sy0 + 14), w["query_now_cest"], WHITE, font(13, True))
    rgba_text(draw, (sx1 - 100, sy0 + 14), "Wi-Fi", (255, 255, 255, 170), font(12))

    y = sy0 + 42
    rgba_text(draw, (sx0 + 28, y), "WETTER", (255, 255, 255, 150), font(12))
    rgba_text(draw, (sx0 + 28, y + 18), "Gronenberg", WHITE, font(32, True))
    rgba_text(draw, (sx0 + 28, y + 58), f"Regen · 2 Stunden · Ab Jetzt bis {w['horizon_end_cest']} · DWD RV · iPad", (255, 255, 255, 160), font(12))

    # range-toggle style tabs
    tabs = ["Uebersicht", "Timeline", "Karte"]
    tw = 108
    tx0 = sx1 - 28 - len(tabs) * tw - 8
    draw.rounded_rectangle((tx0, y + 22, sx1 - 28, y + 56), radius=24, fill=(255, 255, 255, 25), outline=CARD_BORDER)
    for i, lab in enumerate(tabs):
        xx = tx0 + 6 + i * tw
        if i == 0:
            draw.rounded_rectangle((xx, y + 26, xx + tw - 8, y + 52), radius=18, fill=(255, 255, 255, 50))
        rgba_text(draw, (xx + 16, y + 30), lab, WHITE if i == 0 else (255, 255, 255, 150), font(12, i == 0))

    top = y + 88
    margin, gap = 28, 16
    left_w = int((sx1 - sx0 - 2 * margin - gap) * 0.40)
    right_w = (sx1 - sx0 - 2 * margin - gap) - left_w
    lx, rx = sx0 + margin, sx0 + margin + left_w + gap
    bottom = sy1 - 24

    # left hero
    ly = top
    hero = (lx, ly, lx + left_w, ly + 120)
    canvas = glass_card(canvas, hero)
    draw = ImageDraw.Draw(canvas, "RGBA")
    rgba_text(draw, (lx + 18, ly + 14), "HEUTE ABEND", (255, 255, 255, 160), font(11))
    rgba_text(draw, (lx + 18, ly + 38), s["verdict"].replace("_", " ").title(), CYAN, font(26, True))
    for i, line in enumerate(wrap_text(draw, f"Kurzer Niesel ab ca. {s.get('onset_cest') or begin_cest} Uhr. {s.get('peak_feel','')}", font(13), left_w - 40)[:2]):
        rgba_text(draw, (lx + 18, ly + 78 + i * 17), line, (255, 255, 255, 220), font(13))
    ly += 132

    half = (left_w - gap) // 2
    for box, title, main, sub, col in (
        ((lx, ly, lx + half, ly + 92), "ETA AM ORT", begin_cest or "—", f"in ~{begin_min} Min" if begin_min is not None else "—", GREEN),
        ((lx + half + gap, ly, lx + left_w, ly + 92), "PEAK", f"{s['peak_mmh']:.1f} mm/h", f"{s['peak_class']} · {s['peak_cest']}", AMBER),
    ):
        canvas = glass_card(canvas, box)
        draw = ImageDraw.Draw(canvas, "RGBA")
        rgba_text(draw, (box[0] + 14, box[1] + 12), title, (255, 255, 255, 150), font(10))
        rgba_text(draw, (box[0] + 14, box[1] + 34), main, WHITE, font(22, True))
        rgba_text(draw, (box[0] + 14, box[1] + 66), sub, col, font(12))
    ly += 104

    rgba_text(draw, (lx, ly), "WANN KOMMT DER REGEN IN DIE NAEHE?", (255, 255, 255, 150), font(10))
    ly += 20
    prox = s.get("proximity_eta_min_from_now") or {}
    chips = [
        ("REGEN < 10 KM", f"in {prox.get('within_10km','—')} Min", GREEN),
        ("REGEN < 5 KM", f"in {prox.get('within_5km','—')} Min", AMBER),
        ("MENGE AM ORT", f"{s['sum_mm_in_window']:.2f} mm", CYAN),
    ]
    cw = (left_w - 2 * gap) // 3
    for i, (t, v, col) in enumerate(chips):
        x0 = lx + i * (cw + gap)
        box = (x0, ly, x0 + cw, ly + 72)
        canvas = glass_card(canvas, box, 14)
        draw = ImageDraw.Draw(canvas, "RGBA")
        rgba_text(draw, (x0 + 8, ly + 10), t, (255, 255, 255, 140), font(8))
        rgba_text(draw, (x0 + 8, ly + 34), v, col, font(13, True))
    ly += 86

    klar = (lx, ly, lx + left_w, bottom)
    canvas = glass_card(canvas, klar)
    draw = ImageDraw.Draw(canvas, "RGBA")
    rgba_text(draw, (lx + 16, ly + 14), "KLARTEXT", (255, 255, 255, 160), font(11))
    bullets = [
        f"Fenster {w['query_now_cest']}–{w['horizon_end_cest']} MESZ (ab Jetzt).",
        f"Beginn am Ort ca. {begin_cest} (in ~{begin_min} Min)." if begin_min is not None else "Kein Regen in 2 h.",
        f"Peak {s['peak_cest']} · {s['peak_class']} · {s['peak_mmh']:.1f} mm/h.",
        f"Summe am Ort {s['sum_mm_in_window']:.2f} mm.",
        f"Front ~{float((approach or {}).get('distance_km_now') or 23):.0f} km aus {(approach or {}).get('dir_from','W')}.",
        "Radar-Nowcast · keine %-Wahrscheinlichkeit · Update ~5 Min.",
    ]
    yy = ly + 40
    for b in bullets:
        for line in wrap_text(draw, "• " + b, font(12), left_w - 36):
            rgba_text(draw, (lx + 16, yy), line, (255, 255, 255, 210), font(12))
            yy += 18

    # right column
    ry = top
    chart_h = int((bottom - top - gap) * 0.40)
    chart = (rx, ry, rx + right_w, ry + chart_h)
    canvas = glass_card(canvas, chart)
    draw = ImageDraw.Draw(canvas, "RGBA")
    rgba_text(draw, (rx + 16, ry + 12), "INTENSITAET AB JETZT", (255, 255, 255, 170), font(11))
    draw_sparkline(draw, (rx + 12, ry + 36, rx + right_w - 12, ry + chart_h - 12), timeline, begin_min)
    ry += chart_h + gap

    radar = (rx, ry, rx + right_w, bottom)
    canvas = glass_card(canvas, radar)
    draw = ImageDraw.Draw(canvas, "RGBA")
    d0 = float((approach or {}).get("distance_km_now") or 23)
    draw_radar(draw, (rx + 10, ry + 8, rx + right_w - 10, bottom - 8), (approach or {}).get("dir_from", "W"), d0, begin_min)

    canvas.convert("RGB").save(OUT_IPAD, "PNG", optimize=True)
    print("wrote", OUT_IPAD)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)
    render_phone(data)
    render_ipad(data)


if __name__ == "__main__":
    main()
