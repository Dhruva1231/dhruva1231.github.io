"""Decrypt schedule.enc with SCHEDULE_PASSPHRASE env var, render schedule.png."""
import os, re, base64
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

W, H = 1179, 2556
INPUT = Path("schedule.enc")
OUTPUT = Path("schedule.png")
FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def decrypt(b64_data: str, passphrase: str) -> str:
    data = base64.b64decode(b64_data.strip())
    salt, iv, ct = data[:16], data[16:28], data[28:]
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=100000).derive(passphrase.encode())
    return AESGCM(key).decrypt(iv, ct, None).decode()


def hex_to_rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def categorize(t):
    t = t.lower()
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
        if line.startswith("!"): urgent = True; line = line[1:].strip()
        p = [x.strip() for x in line.split("|")]
        if not urgent and re.search(r"DO NOT MISS|priority|deadline|urgent", line, re.I): urgent = True
        items.append({"label": p[0] if p else "", "time": p[1] if len(p)>1 else "",
                      "detail": p[2] if len(p)>2 else "", "urgent": urgent,
                      "color": categorize(p[0] if p else "")})
    return items


def render(blocks):
    img = Image.new("RGB", (W, H), color="#0d0d0f")
    d = ImageDraw.Draw(img)
    start_y, pad_x, natural = 740, 48, 150
    available = (H - 80) - start_y
    n = max(len(blocks), 1)
    row_h = max(110, available // n) if n * natural > available else natural
    s = max(0.85, row_h / natural)
    ft = ImageFont.truetype(FONT_REG, round(30*s))
    fl = ImageFont.truetype(FONT_BOLD, round(38*s))
    fd = ImageFont.truetype(FONT_REG, round(28*s))
    ip, g1, g2 = round(22*s), round(8*s), round(14*s)
    th, lh = ft.size + 4, fl.size + 4
    for i, b in enumerate(blocks):
        y = start_y + i * row_h
        d.rounded_rectangle([pad_x, y, W-pad_x, y+row_h-12], radius=24,
                            fill="#1f1008" if b["urgent"] else "#141418")
        cx, cy = pad_x + 52, y + (row_h-12) // 2
        d.ellipse([cx-12, cy-12, cx+12, cy+12], fill=hex_to_rgb(b["color"]))
        d.text((pad_x+84, y+ip), b["time"], font=ft, fill="#666666")
        d.text((pad_x+84, y+ip+th+g1), b["label"], font=fl, fill="#ffffff")
        if b["detail"]:
            d.text((pad_x+84, y+ip+th+g1+lh+g2), b["detail"], font=fd,
                   fill="#cc4400" if b["urgent"] else "#555555")
    return img


if __name__ == "__main__":
    passphrase = os.environ.get("SCHEDULE_PASSPHRASE")
    if not passphrase: raise SystemExit("missing SCHEDULE_PASSPHRASE")
    if not INPUT.exists(): raise SystemExit(f"missing {INPUT}")
    plaintext = decrypt(INPUT.read_text(), passphrase)
    blocks = parse(plaintext)
    render(blocks).save(OUTPUT, "PNG", optimize=True)
    print(f"wrote {OUTPUT} with {len(blocks)} blocks")
