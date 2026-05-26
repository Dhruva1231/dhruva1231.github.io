"""generate.py — reads schedule.txt, writes schedule.png (iPhone wallpaper size)."""
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1179, 2556
INPUT_PATH = Path("schedule.txt")
OUTPUT_PATH = Path("schedule.png")
FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def categorize(title):
    t = title.lower()
    if re.search(r"piano", t): return "#EF9F27"
    if re.search(r"espm|history|hist\s|7a", t): return "#1D9E75"
    if re.search(r"cs\s?\d|61c|188|161|16a|lecture", t): return "#7F77DD"
    if re.search(r"lunch|dinner|breakfast|wake|shower|ready|sleep|coffee", t): return "#888888"
    if re.search(r"mood|creative|design|art", t): return "#D4537E"
    if re.search(r"investor|call|meeting|zoom|interview", t): return "#D85A30"
    return "#888888"


def parse(text):
    items = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line: continue
        urgent = False
        if line.startswith("!"):
            urgent = True
            line = line[1:].strip()
        parts = [p.strip() for p in line.split("|")]
        label  = parts[0] if len(parts) > 0 else ""
        time   = parts[1] if len(parts) > 1 else ""
        detail = parts[2] if len(parts) > 2 else ""
        if not urgent and re.search(r"DO NOT MISS|priority|deadline|urgent", line, re.I):
            urgent = True
        items.append({"label": label, "time": time, "detail": detail,
                      "urgent": urgent, "color": categorize(label)})
    return items


def render(blocks):
    img = Image.new("RGB", (W, H), color="#0d0d0f")
    draw = ImageDraw.Draw(img)
    start_y, pad_x, natural_row_h = 740, 48, 150
    available = (H - 80) - start_y
    n = max(len(blocks), 1)
    row_h = max(110, available // n) if n * natural_row_h > available else natural_row_h
    scale = max(0.85, row_h / natural_row_h)

    f_time   = ImageFont.truetype(FONT_REG,  round(30 * scale))
    f_label  = ImageFont.truetype(FONT_BOLD, round(38 * scale))
    f_detail = ImageFont.truetype(FONT_REG,  round(28 * scale))
    inner_pad  = round(22 * scale)
    line_gap_1 = round(8 * scale)
    line_gap_2 = round(14 * scale)
    time_h = f_time.size + 4
    label_h = f_label.size + 4

    for i, b in enumerate(blocks):
        y = start_y + i * row_h
        bg = "#1f1008" if b["urgent"] else "#141418"
        draw.rounded_rectangle([pad_x, y, W - pad_x, y + row_h - 12], radius=24, fill=bg)

        cx, cy = pad_x + 52, y + (row_h - 12) // 2
        draw.ellipse([cx-12, cy-12, cx+12, cy+12], fill=hex_to_rgb(b["color"]))

        draw.text((pad_x + 84, y + inner_pad), b["time"], font=f_time, fill="#666666")
        draw.text((pad_x + 84, y + inner_pad + time_h + line_gap_1),
                  b["label"], font=f_label, fill="#ffffff")
        if b["detail"]:
            color = "#cc4400" if b["urgent"] else "#555555"
            draw.text((pad_x + 84, y + inner_pad + time_h + line_gap_1 + label_h + line_gap_2),
                      b["detail"], font=f_detail, fill=color)
    return img


if __name__ == "__main__":
    if not INPUT_PATH.exists():
        raise SystemExit(f"missing {INPUT_PATH}")
    blocks = parse(INPUT_PATH.read_text())
    img = render(blocks)
    img.save(OUTPUT_PATH, "PNG", optimize=True)
    print(f"wrote {OUTPUT_PATH} with {len(blocks)} blocks")
