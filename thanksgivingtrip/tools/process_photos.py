#!/usr/bin/env python3
"""Convert, pair, strip and index the Thanksgiving board photos.

Used by .github/workflows/convert-photos.yml and tools/add-photos.sh. For every photos/<id>/ folder:
  - HEIC/PNG/raw JPG -> JPG (quality 88, auto-oriented, sRGB, long side <= 2000px)
  - Videos of 4s or less that pair with a photo (same base name, or captured within 4s) are Live Photos:
    MOV -> MP4 (H.264, <= 1080 wide, no audio, faststart)
  - Every other video is a standalone video: MP4 with AAC audio, plus a -poster.jpg from the frame at 1s.
    Over 50MB it's re-encoded at crf 30; still over 90MB it's skipped with a warning (GitHub's limit is 100MB).
  - captions.txt ("filename: caption" per line) sets per-photo captions
  - order.txt (one filename per line) puts those files first, in that order
  - back.txt (the note on the back of the moment's card) is copied into the manifest exactly as written, under
    "backs": {"<id>": {"text": ...}}. It's text, so it's never converted or stripped.
  - ALL metadata (EXIF, GPS, XMP, ICC, QuickTime tags) is removed from every output file. Capture times
    are read only to order the photos and are never written anywhere.
Then photos/manifest.json is regenerated from what's in the folders.

Order: a file whose name starts with "cover" always goes first, then anything listed in order.txt, then the
rest. Photos already in the manifest keep their order; new ones follow them in capture order.

Needs: python3 with Pillow, ffmpeg, exiftool, and heif-convert (libheif) or macOS sips for HEIC.
"""
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

PHOTOS = Path(__file__).resolve().parent.parent / 'photos'
MANIFEST = PHOTOS / 'manifest.json'
STILL_IN = {'.jpg', '.jpeg', '.png', '.heic', '.heif'}
VIDEO_IN = {'.mov', '.mp4', '.m4v'}
MAX_SIDE, QUALITY, PAIR_SECONDS, LIVE_MAX = 2000, 88, 4, 4.0
SOFT_MB, HARD_MB = 50, 90
# exiftool groups/tags that mean a file still carries personal metadata.
PRIVATE_GROUPS = {'EXIF', 'GPS', 'XMP', 'IPTC', 'MakerNotes', 'ICC_Profile', 'Photoshop', 'Keys', 'UserData', 'ItemList'}
VIDEO_TAGS = {'CreationDate', 'Make', 'Model', 'Software', 'GPSCoordinates', 'LocationInformation', 'ContentIdentifier'}


def run(*cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]} failed on {cmd[-1]}: {r.stderr.strip()[-400:]}")
    return r.stdout


def exif_json(paths, *args):
    if not paths:
        return {}
    out = run('exiftool', '-j', '-q', *args, *map(str, paths))
    return {Path(d['SourceFile']).name: d for d in json.loads(out or '[]')}


def parse_time(v):
    """'2026:11:21 15:30:12[.123][+05:00|Z]' -> epoch seconds. Times without a zone are read as UTC."""
    if not isinstance(v, str):
        return None
    m = re.match(r'(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)(\.\d+)?(Z|[+-]\d\d:?\d\d)?', v.strip())
    if not m or m.group(1) == '0000':
        return None
    y, mo, d, h, mi, s = map(int, m.groups()[:6])
    tz = timezone.utc
    if m.group(8) and m.group(8) != 'Z':
        z = m.group(8).replace(':', '')
        tz = timezone(int(z[0] + '1') * timedelta(hours=int(z[1:3]), minutes=int(z[3:5])))
    t = datetime(y, mo, d, h, mi, s, tzinfo=tz).timestamp()
    return t + float(m.group(7) or 0)


def capture_times(folder, names):
    """Capture time per file, read before anything is converted (conversion drops it)."""
    meta = exif_json([folder / n for n in names], '-api', 'QuickTimeUTC',
                     '-SubSecDateTimeOriginal', '-DateTimeOriginal', '-OffsetTimeOriginal', '-CreationDate', '-CreateDate')
    times = {}
    for n in names:
        d = meta.get(n, {})
        if Path(n).suffix.lower() in VIDEO_IN:
            t = parse_time(d.get('CreationDate')) or parse_time(d.get('CreateDate'))
        else:
            dto = d.get('DateTimeOriginal')
            if isinstance(dto, str) and d.get('OffsetTimeOriginal') and not re.search(r'[+-]\d\d:\d\d$', dto):
                dto += d['OffsetTimeOriginal']
            t = parse_time(d.get('SubSecDateTimeOriginal')) or parse_time(dto) or parse_time(d.get('CreateDate'))
        times[n] = t
    return times


def is_clean(path):
    d = exif_json([path], '-G0').get(path.name, {})
    for key in d:
        group, _, tag = key.partition(':')
        if group in PRIVATE_GROUPS and not (group == 'ItemList' and tag == 'Encoder'):
            return False
        if group == 'QuickTime' and tag in VIDEO_TAGS:
            return False
    if path.suffix.lower() == '.jpg':
        with Image.open(path) as im:
            return max(im.size) <= MAX_SIDE
    return True


def strip_all(path):
    run('exiftool', '-q', '-all=', '-overwrite_original', str(path))


def decode_heic(src, tmp):
    out = tmp / (src.stem + '.jpg')
    if shutil.which('heif-convert'):
        # Writes into its own folder: some versions also emit depth/aux images next to the main one.
        d = Path(tempfile.mkdtemp(dir=tmp))
        run('heif-convert', '-q', '100', str(src), str(d / out.name))
        return d / out.name
    if shutil.which('sips'):
        run('sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '100', str(src), '--out', str(out))
        return out
    raise RuntimeError('HEIC needs heif-convert (libheif) or macOS sips')


def write_jpg(src, dst):
    """Upright, sRGB, <= 2000px, quality 88, no metadata at all."""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        icc = im.info.get('icc_profile')
        if icc:
            try:
                im = ImageCms.profileToProfile(im.convert('RGB'), ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                                               ImageCms.createProfile('sRGB'), outputMode='RGB')
            except (ImageCms.PyCMSError, OSError, ValueError):
                pass
        im = im.convert('RGB')
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        tmp = dst.with_name('.tmp-' + dst.name)
        im.save(tmp, 'JPEG', quality=QUALITY, optimize=True, progressive=True)
    strip_all(tmp)
    tmp.replace(dst)


def probe(path):
    """(duration seconds, display width / height) of a video."""
    out = run('ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
              'format=duration:stream=width,height:stream_side_data=rotation', '-of', 'json', str(path))
    d = json.loads(out)
    st = (d.get('streams') or [{}])[0]
    w, h = st.get('width') or 16, st.get('height') or 9
    rot = next((abs(int(x.get('rotation', 0))) for x in st.get('side_data_list', []) if 'rotation' in x), 0)
    if rot % 180 == 90:
        w, h = h, w
    return float(d.get('format', {}).get('duration') or 0), w / h


def write_mp4(src, dst, audio, crf=26):
    tmp = dst.with_name('.tmp-' + dst.name)
    sound = ['-c:a', 'aac', '-b:a', '128k'] if audio else ['-an']
    run('ffmpeg', '-v', 'error', '-y', '-i', str(src),
        '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-pix_fmt', 'yuv420p',
        *sound, '-movflags', '+faststart', '-map_metadata', '-1', '-map_chapters', '-1',
        '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', str(tmp))
    strip_all(tmp)
    tmp.replace(dst)


def write_standalone(src, dst):
    """Standalone video with sound. False if it's too big to commit even at crf 30."""
    write_mp4(src, dst, audio=True)
    mb = dst.stat().st_size / 1e6
    if mb > SOFT_MB:
        print(f'  {src.name} is {mb:.0f}MB as MP4; re-encoding at crf 30')
        write_mp4(src, dst, audio=True, crf=30)
        mb = dst.stat().st_size / 1e6
    if mb > HARD_MB:
        dst.unlink()
        print(f'::warning::Skipped {dst.parent.name}/{src.name}: still {mb:.0f}MB after re-encoding (GitHub rejects files '
              f'over 100MB). Trim it or split it and upload again.')
        return False
    return True


def poster(video, dst, tmp, at=1.0):
    """Still from the frame at 1s (or the first frame of a shorter clip), same rules as photos."""
    f = tmp / (video.stem + '-frame.jpg')
    seek = ['-ss', str(at)] if probe(video)[0] > at else []
    run('ffmpeg', '-v', 'error', '-y', *seek, '-i', str(video), '-frames:v', '1', '-q:v', '1', str(f))
    write_jpg(f, dst)


def free_name(folder, stem, ext, taken, own=None):
    """An unused filename. `own` is the source being replaced: IMG.JPG -> IMG.jpg is fine even on macOS,
    where the two names are the same file."""
    name, k = stem + ext, 2
    while name.lower() != (own or '').lower() and (name in taken or (folder / name).exists()):
        name, k = f'{stem}-{k}{ext}', k + 1
    taken.add(name)
    return name


def convert(folder, n, out, write):
    """Write `out` from source `n` via a staging file, then drop the source. Staging keeps this safe when
    the names differ only by case (one file on macOS). False (from `write`) keeps the source."""
    stage = folder / ('.conv-' + out)
    if write(stage) is False:
        return False
    if out != n:
        (folder / n).unlink()
    stage.replace(folder / out)
    return True


def read_captions(folder):
    caps, f = {}, folder / 'captions.txt'
    if f.exists():
        for line in f.read_text(encoding='utf-8').splitlines():
            name, sep, text = line.partition(':')
            if sep and name.strip() and text.strip():
                caps[Path(name.strip()).stem.lower()] = text.strip()
    return caps


def read_order(folder):
    f = folder / 'order.txt'
    if not f.exists():
        return {}
    names = [Path(l.strip()).stem.lower() for l in f.read_text(encoding='utf-8').splitlines() if l.strip() and not l.startswith('#')]
    return {n: k for k, n in reversed(list(enumerate(names)))}


def stems(e):
    """Base names an entry answers to in captions.txt/order.txt: its photo, video, and original upload."""
    out = {Path(e['src']).stem.lower().removesuffix('-poster')}
    for k in ('live', 'video'):
        if e.get(k):
            out.add(Path(e[k]).stem.lower())
    return out


def rel(path_in_manifest):
    return path_in_manifest.split('/', 1)[1]


def process_folder(folder, old_entries):
    files = sorted(p.name for p in folder.iterdir() if p.is_file() and not p.name.startswith('.'))
    known = {rel(e[k]) for e in old_entries for k in ('src', 'live', 'video') if e.get(k)}
    # Anything new, or anything that still carries metadata (e.g. a re-uploaded original), gets processed.
    raw = [n for n in files if Path(n).suffix.lower() in STILL_IN | VIDEO_IN
           and (n not in known or Path(n).suffix.lower() not in {'.jpg', '.mp4'} or not is_clean(folder / n))]
    times = capture_times(folder, raw)
    taken = set(files)
    new_stills = {}                      # output name -> capture time
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for n in (n for n in raw if Path(n).suffix.lower() in STILL_IN):
            src, ext = folder / n, Path(n).suffix.lower()
            out = n if n.endswith('.jpg') else free_name(folder, Path(n).stem, '.jpg', taken, own=n)
            convert(folder, n, out, lambda dst: write_jpg(decode_heic(src, tmp) if ext in {'.heic', '.heif'} else src, dst))
            new_stills[out] = times.get(n)
            print(f'  {folder.name}/{n} -> {out}')

        stills = {p.name for p in folder.iterdir() if p.name.endswith('.jpg') and not p.name.startswith('.')}
        entries = [dict(e) for e in old_entries if rel(e['src']) in stills]
        for e in entries:
            for k in ('live', 'video'):
                if e.get(k) and not (folder / rel(e[k])).exists():
                    e.pop(k)
                    e.pop('duration', None), e.pop('aspect', None)
        entries = [e for e in entries if not (Path(e['src']).stem.endswith('-poster') and not e.get('video'))]
        by_src = {rel(e['src']): e for e in entries}
        added = []                       # (capture time, entry) for everything new this run
        for n in new_stills:
            if n in by_src:
                continue
            e = {'src': f'{folder.name}/{n}'}
            by_src[n] = e
            added.append((new_stills[n], e))

        # Videos: raw uploads plus any clean MP4 nothing points at any more.
        used = {rel(e[k]) for e in by_src.values() for k in ('live', 'video') if e.get(k)}
        loose = [n for n in files if n.endswith('.mp4') and n in known and n not in used and n not in raw]
        by_stem = {Path(s).stem.lower(): s for s in by_src}
        for n in [n for n in raw if Path(n).suffix.lower() in VIDEO_IN] + loose:
            src, vt = folder / n, times.get(n)
            dur, aspect = probe(src)
            match = by_stem.get(Path(n).stem.lower())
            if match and (by_src[match].get('live') or by_src[match].get('video')):
                match = None
            if not match and vt is not None:
                near = sorted((abs(t - vt), s) for s, t in new_stills.items()
                              if t is not None and not by_src[s].get('live') and abs(t - vt) <= PAIR_SECONDS)
                match = near[0][1] if near else None
            out = n if n.endswith('.mp4') else free_name(folder, Path(n).stem, '.mp4', taken, own=n)
            if match and dur <= LIVE_MAX:
                if n in raw:
                    convert(folder, n, out, lambda dst: write_mp4(src, dst, audio=False))
                by_src[match]['live'] = f'{folder.name}/{out}'
                print(f'  {folder.name}/{n} -> {out} (Live Photo for {match})')
            else:
                if n in raw and not convert(folder, n, out, lambda dst: write_standalone(src, dst)):
                    continue
                post = free_name(folder, Path(out).stem + '-poster', '.jpg', taken | stills)
                poster(folder / out, folder / post, tmp)
                dur, aspect = probe(folder / out)
                e = {'src': f'{folder.name}/{post}', 'video': f'{folder.name}/{out}',
                     'duration': max(1, round(dur)), 'aspect': round(aspect, 2)}
                by_src[post] = e
                added.append((vt, e))
                print(f'  {folder.name}/{n} -> {out} + {post} ({dur:.0f}s video)')
    for t, e in sorted(added, key=lambda x: (x[0] is None, x[0] or 0, x[1]['src'])):
        entries.append(e)
    # cover* first, then order.txt, then the order built above (old order, then new by capture time).
    order = read_order(folder)
    rank = lambda e: min((order[k] for k in stems(e) if k in order), default=len(order))
    entries.sort(key=lambda e: (not Path(e['src']).name.lower().startswith('cover'), rank(e)))
    caps = read_captions(folder)
    out = []
    for e in entries:
        item = {'src': e['src']}
        for k in ('live', 'video', 'duration', 'aspect'):
            if e.get(k):
                item[k] = e[k]
        item['caption'] = next((caps[k] for k in sorted(stems(e)) if k in caps), None)
        out.append(item)
    return out


def main():
    try:
        old = json.loads(MANIFEST.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        old = {}
    manifest = {}
    for folder in sorted(p for p in PHOTOS.iterdir() if p.is_dir() and not p.name.startswith('.')):
        prev = [e for e in old.get(folder.name, []) if isinstance(e, dict) and isinstance(e.get('src'), str)]
        manifest[folder.name] = process_folder(folder, prev)
    backs = {}
    for folder in sorted(p for p in PHOTOS.iterdir() if p.is_dir() and not p.name.startswith('.')):
        back = folder / 'back.txt'
        if back.is_file():
            backs[folder.name] = {'text': back.read_text(encoding='utf-8')}
    if backs:
        manifest['backs'] = backs
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + '\n'
    if not MANIFEST.exists() or MANIFEST.read_text(encoding='utf-8') != text:
        MANIFEST.write_text(text, encoding='utf-8')
        print('manifest.json updated')
    moments = {k: v for k, v in manifest.items() if k != 'backs'}
    total = sum(map(len, moments.values()))
    print(f'{total} photo(s) across {sum(1 for v in moments.values() if v)} moment(s), {len(backs)} card back(s)')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as e:
        sys.exit(f'error: {e}')
