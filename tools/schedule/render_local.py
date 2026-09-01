"""Local-only: read schedule.txt (plaintext, gitignored), write today + tomorrow PNGs."""
import datetime as dt
import sys
from pathlib import Path
from generate import parse_dual, render

HERE = Path(__file__).parent
INPUT = HERE / "schedule.txt"
OUTPUT_TODAY = HERE / "schedule.png"
OUTPUT_TOMORROW = HERE / "schedule_tomorrow.png"


def day_label(prefix, date):
    return f"{prefix} · {date.strftime('%a, %b %-d')}"


def main():
    if not INPUT.exists():
        raise SystemExit(f"missing {INPUT}")
    today_blocks, tomorrow_blocks = parse_dual(INPUT.read_text())

    offset = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    today = dt.date.today() + dt.timedelta(days=offset)
    tomorrow = today + dt.timedelta(days=1)

    render(today_blocks, label=day_label("today", today)).save(
        OUTPUT_TODAY, "PNG", optimize=True)
    print(f"wrote {OUTPUT_TODAY} with {len(today_blocks)} blocks")

    if tomorrow_blocks:
        render(tomorrow_blocks, label=day_label("tomorrow", tomorrow)).save(
            OUTPUT_TOMORROW, "PNG", optimize=True)
        print(f"wrote {OUTPUT_TOMORROW} with {len(tomorrow_blocks)} blocks")


if __name__ == "__main__":
    main()
