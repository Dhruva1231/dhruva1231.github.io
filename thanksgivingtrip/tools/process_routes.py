#!/usr/bin/env python3
"""GPX tracks -> photos/<id>/route.json, for the board's self-drawing trail maps.

Called by process_photos.py (so by the convert-photos Action and tools/add-photos.sh). Every .gpx in a moment's
folder becomes one or more tracks (one per <trk>, files in name order), drawn one after another. The .gpx itself
is always deleted: only the processed route.json is ever kept.

Privacy:
  - The first and last 250 m of every track are trimmed off the drawn line (like Strava's privacy zones).
  - No timestamps are written; only the computed moving time.
  - Points within 5 km of home are cut with a warning. Home is "lat, lon" from the HOME_LATLON environment
    variable (a repo secret in the Action) or an untracked .home file at the repo root.

Stats (imperial): distance (haversine), elevation gain (elevations smoothed with a ~30 m window, then only climbs of
more than 3 m counted, with hysteresis), high point, moving time (stops under 0.5 mph for over 60 s excluded), and the
route's shape. A track that ends within 150 m of its start is a loop, unless its second half retraces the first
(then it's an out-and-back, which also ends where it started); one that ends farther away is one-way.
Stats cover the whole recording; only the drawing is trimmed.

Geometry: projected to local meters (equirectangular about the moment's center), simplified with
Ramer-Douglas-Peucker to about 250-400 points per track, and scaled into a 0-1000 box, north up, aspect kept.
route.json: {"tracks": [{"points": [[x, y], ...], "elev": [ft, ...], "summitIndex": n, "type": "loop"}],
             "stats": {...}, "box": [w, h], "metersPerUnit": m}
"""
import json
import math
import os
from pathlib import Path

R = 6371008.8
TRIM_M, HOME_M, LOOP_M = 250, 5000, 150
SMOOTH_M, CLIMB_M = 30, 3
STOP_MPS, STOP_S = .5 * 0.44704, 60
FEW, MANY, AIM = 250, 400, 320
M_PER_MI, FT_PER_M = 1609.344, 3.28084


class RouteError(Exception):
    pass


def hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(h)))


def home_point(repo):
    raw = os.environ.get('HOME_LATLON', '').strip()
    if not raw and (repo / '.home').is_file():
        raw = (repo / '.home').read_text(encoding='utf-8').strip()
    if not raw:
        return None
    try:
        lat, lon = (float(v) for v in raw.replace(';', ',').split(',')[:2])
        return lat, lon
    except ValueError:
        print('  warning: home coordinate is not "lat, lon"; no home cut applied')
        return None


def read_tracks(path):
    try:
        import gpxpy
        import gpxpy.gpx
    except ImportError:
        raise RouteError('gpxpy is not installed (python3 -m pip install --user gpxpy)')
    try:
        gpx = gpxpy.parse(path.read_text(encoding='utf-8', errors='replace'))
    except Exception as e:   # gpxpy raises several XML/GPX exception types
        raise RouteError(f'{path.name} is not a readable GPX file ({type(e).__name__}: {str(e)[:160]})')
    tracks = [[p for s in t.segments for p in s.points] for t in gpx.tracks]
    tracks += [list(r.points) for r in gpx.routes]
    tracks = [[{'lat': p.latitude, 'lon': p.longitude, 'ele': p.elevation, 't': p.time} for p in t] for t in tracks]
    tracks = [t for t in tracks if len(t) >= 2]
    if not tracks:
        raise RouteError(f'{path.name} has no track with at least two points')
    return tracks


def cumulative(pts):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + hav((a['lat'], a['lon']), (b['lat'], b['lon'])))
    return cum


def smoothed_elevations(pts, cum):
    """Moving average over ~30 m of track (missing elevations filled from neighbors); None if there are none."""
    raw = [p['ele'] for p in pts]
    known = [i for i, e in enumerate(raw) if e is not None]
    if not known:
        return None
    filled, k = [], 0
    for i in range(len(raw)):
        while k + 1 < len(known) and known[k + 1] <= i:
            k += 1
        a = known[k]
        if raw[i] is not None:
            filled.append(raw[i])
        elif i < a or k + 1 >= len(known):
            filled.append(raw[a] if i > a else raw[known[0]])
        else:
            b = known[k + 1]
            u = (cum[i] - cum[a]) / ((cum[b] - cum[a]) or 1)
            filled.append(raw[a] + (raw[b] - raw[a]) * u)
    # The 30 m box twice over: a triangular window 30 m wide at half height, which drops GPS altitude jitter far
    # better than one box pass (on noisy test tracks, about +15-20% gain instead of +30-45%).
    return box(box(filled, cum), cum)


def box(vals, cum):
    out, lo, hi, total = [], 0, 0, 0.0
    for i in range(len(vals)):
        while hi < len(vals) and cum[hi] <= cum[i] + SMOOTH_M / 2:
            total += vals[hi]
            hi += 1
        while cum[lo] < cum[i] - SMOOTH_M / 2:
            total -= vals[lo]
            lo += 1
        out.append(total / (hi - lo))
    return out


def climb(elev):
    """Total ascent counting only rises of more than 3 m from the last turning point (hysteresis)."""
    gain, ref = 0.0, elev[0]
    for e in elev[1:]:
        if e - ref > CLIMB_M:
            gain += e - ref
            ref = e
        elif ref - e > CLIMB_M:
            ref = e
    return gain


def moving_seconds(pts, cum):
    """Elapsed time minus stops: runs of segments slower than 0.5 mph lasting over 60 s. None without times."""
    if any(p['t'] is None for p in pts):
        return None
    total, slow = 0.0, 0.0
    for i in range(1, len(pts)):
        dt = (pts[i]['t'] - pts[i - 1]['t']).total_seconds()
        if dt <= 0:
            continue
        if (cum[i] - cum[i - 1]) / dt < STOP_MPS:
            slow += dt
            continue
        total += dt + (slow if slow <= STOP_S else 0)
        slow = 0.0
    return total + (slow if slow <= STOP_S else 0)


def clock(seconds):
    m = round(seconds / 60)
    return f'{m // 60}h {m % 60:02d}m' if m >= 60 else f'{m}m'


def rdp(xy, eps, keep):
    n = len(xy)
    mark = [False] * n
    mark[0] = mark[-1] = True
    for k in keep:
        mark[k] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, at = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else math.hypot(px - ax, py - ay)
            if d > best:
                best, at = d, i
        if at >= 0 and best > eps:
            mark[at] = True
            stack += [(a, at), (at, b)]
    return [i for i in range(n) if mark[i]]


def simplify(xy, keep):
    """Indices kept by RDP, with the tolerance searched so about 320 (250-400) points remain."""
    if len(xy) <= MANY:
        return list(range(len(xy)))
    lo, hi = 0.0, max(max(p[0] for p in xy) - min(p[0] for p in xy), max(p[1] for p in xy) - min(p[1] for p in xy))
    best = None
    for _ in range(40):
        mid = (lo + hi) / 2
        idx = rdp(xy, mid, keep)
        if FEW <= len(idx) <= MANY and (best is None or abs(len(idx) - AIM) < abs(len(best) - AIM)):
            best = idx
        if len(idx) > AIM:
            lo = mid
        else:
            hi = mid
    return best or rdp(xy, (lo + hi) / 2, keep)


def retraces(pts, cum):
    """True if most of the second half runs within 40 m of the first half (the way back is the way out)."""
    half = cum[-1] / 2
    lat0 = math.radians(pts[0]['lat'])
    xy = [(math.radians(p['lon']) * R * math.cos(lat0), math.radians(p['lat']) * R) for p in pts]
    grid = {}
    for (x, y), c in zip(xy, cum):
        if c <= half:
            grid.setdefault((int(x // 40), int(y // 40)), []).append((x, y))
    back = [(x, y) for (x, y), c in zip(xy, cum) if c > half]
    near = sum(1 for x, y in back if any(math.hypot(x - a, y - b) <= 40
                                         for gx in (-1, 0, 1) for gy in (-1, 0, 1)
                                         for a, b in grid.get((int(x // 40) + gx, int(y // 40) + gy), ())))
    return near >= .6 * len(back)


def track_stats(pts):
    cum = cumulative(pts)
    elev = smoothed_elevations(pts, cum)
    secs = moving_seconds(pts, cum)
    closed = hav((pts[0]['lat'], pts[0]['lon']), (pts[-1]['lat'], pts[-1]['lon'])) <= LOOP_M
    kind = ('out-and-back' if retraces(pts, cum) else 'loop') if closed else 'one-way'
    return cum, elev, {
        'meters': cum[-1], 'gain': climb(elev) if elev else None, 'high': max(elev) if elev else None,
        'seconds': secs, 'type': kind
    }


def build_route(gpx_files, home):
    """All tracks of one moment -> the route.json dict. Raises RouteError with a readable message."""
    raw = [t for f in gpx_files for t in read_tracks(f)]
    tracks = []
    for n, pts in enumerate(raw, 1):
        if home:
            kept = [p for p in pts if hav((p['lat'], p['lon']), home) > HOME_M]
            if len(kept) < len(pts):
                print(f'  warning: track {n}: cut {len(pts) - len(kept)} point(s) within 5 km of home')
            pts = kept
        if len(pts) < 2:
            print(f'  warning: track {n}: nothing left after the home cut; skipped')
            continue
        cum, elev, st = track_stats(pts)
        if cum[-1] < 2 * TRIM_M + 50:
            raise RouteError(f'track {n} is only {cum[-1]:.0f} m long, too short to trim 250 m off each end')
        # Privacy zones: drop the first and last 250 m from what's drawn.
        idx = [i for i, c in enumerate(cum) if TRIM_M <= c <= cum[-1] - TRIM_M]
        tracks.append({'pts': [pts[i] for i in idx], 'elev': [elev[i] for i in idx] if elev else None,
                       'cum': [cum[i] for i in idx], 'stats': st})
    if not tracks:
        raise RouteError('no track left to draw')

    # One local projection and one box for the whole moment, so its tracks line up.
    lats = [p['lat'] for t in tracks for p in t['pts']]
    lons = [p['lon'] for t in tracks for p in t['pts']]
    lat0, lon0 = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
    kx, ky = math.radians(1) * R * math.cos(math.radians(lat0)), math.radians(1) * R
    for t in tracks:
        t['xy'] = [((p['lon'] - lon0) * kx, (p['lat'] - lat0) * ky) for p in t['pts']]
    xs = [x for t in tracks for x, _ in t['xy']]
    ys = [y for t in tracks for _, y in t['xy']]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    s = 1000 / (max(w, h) or 1)
    out = []
    for t in tracks:
        summit = max(range(len(t['xy'])), key=lambda i: t['elev'][i]) if t['elev'] else 0
        keep = simplify(t['xy'], [summit])
        pts = [[round((t['xy'][i][0] - min(xs)) * s, 1), round((max(ys) - t['xy'][i][1]) * s, 1)] for i in keep]
        track = {'points': pts, 'summitIndex': keep.index(summit), 'type': t['stats']['type']}
        if t['elev']:
            track['elev'] = [round(t['elev'][i] * FT_PER_M) for i in keep]
        out.append(track)

    st = [t['stats'] for t in tracks]
    stats = {'miles': round(sum(x['meters'] for x in st) / M_PER_MI, 1)}
    if all(x['gain'] is not None for x in st):
        stats['gainFt'] = round(sum(x['gain'] for x in st) * FT_PER_M)
        stats['highFt'] = round(max(x['high'] for x in st) * FT_PER_M)
    if all(x['seconds'] is not None for x in st):
        stats['movingTime'] = clock(sum(x['seconds'] for x in st))
    kinds = list(dict.fromkeys(x['type'] for x in st))
    stats['type'] = ' + '.join(kinds)
    return {'tracks': out, 'stats': stats, 'box': [round(w * s, 1), round(h * s, 1)], 'metersPerUnit': round(1 / s, 4)}


def build_routes(photos):
    """Process every moment's .gpx files into route.json (deleting the .gpx) and return {id: route}."""
    repo = photos.parent.parent
    home = None
    routes = {}
    for folder in sorted(p for p in photos.iterdir() if p.is_dir() and not p.name.startswith('.')):
        gpx = sorted(f for f in folder.iterdir() if f.is_file() and f.suffix.lower() == '.gpx')
        target = folder / 'route.json'
        if gpx:
            if home is None:
                home = home_point(repo) or False
            try:
                route = build_route(gpx, home or None)
                target.write_text(json.dumps(route, separators=(',', ':')) + '\n', encoding='utf-8')
                st = route['stats']
                print(f'  {folder.name}: {", ".join(f.name for f in gpx)} -> route.json ({len(route["tracks"])} track(s), '
                      f'{st["miles"]} mi, {st.get("gainFt", "?")} ft gain, {st["type"]})')
            except RouteError as e:
                msg = f'{folder.name}: route not updated: {e}'
                print(f'::error::{msg}' if os.environ.get('GITHUB_ACTIONS') else f'  error: {msg}')
            finally:
                for f in gpx:            # the raw GPX is never kept, readable or not
                    f.unlink()
        if target.is_file():
            try:
                routes[folder.name] = json.loads(target.read_text(encoding='utf-8'))
            except ValueError:
                print(f'  error: {folder.name}/route.json is not valid JSON; skipped')
    return routes


if __name__ == '__main__':
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    print(json.dumps({k: v['stats'] for k, v in build_routes(Path(__file__).resolve().parent.parent / 'photos').items()}, indent=2))
