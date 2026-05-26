"""Local-only: read schedule.txt (plaintext, gitignored), write schedule.png.

Usage:
    python render_local.py
"""
from pathlib import Path
from generate import parse, render

HERE = Path(__file__).parent
INPUT = HERE / "schedule.txt"
OUTPUT = HERE / "schedule.png"


def main():
    if not INPUT.exists():
        raise SystemExit(f"missing {INPUT}")
    blocks = parse(INPUT.read_text())
    img = render(blocks)
    img.save(OUTPUT, "PNG", optimize=True)
    print(f"wrote {OUTPUT} with {len(blocks)} blocks")


if __name__ == "__main__":
    main()

