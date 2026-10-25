#!/usr/bin/env bash
# Add photos/videos to one moment of the Thanksgiving board from this Mac, processed the same way as the
# convert-photos GitHub Action (HEIC/MOV conversion, Live Photo pairing, metadata stripping, manifest).
#
#   thanksgivingtrip/tools/add-photos.sh steaks ~/Desktop/IMG_4412.HEIC ~/Desktop/IMG_4412.MOV ...
#
# A back.txt among the files becomes the note on the back of that moment's card (copied into the manifest as is).
# A .gpx becomes the moment's trail map: processed into route.json (trimmed, no timestamps) and the copy deleted.
# Points within 5 km of home are cut if the repo root has an untracked .home file ("lat, lon").
#
# Needs: brew install ffmpeg exiftool   (plus libheif for HEIC; macOS sips is the fallback)
#        python3 with Pillow           (python3 -m pip install --user pillow)
#        python3 with gpxpy, for .gpx  (python3 -m pip install --user gpxpy)
#
# Processing here, before you commit, also keeps the originals (with their GPS and capture details)
# out of the repo's public history, which uploading through the GitHub website can't do.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
photos="$here/../photos"
ids="roadtrip-up atl tallulah-rim black-rock steaks newfound-gap andrews-bald kuwohi elk gorge-floor rabun-bald pickleball drive-home"

if [ $# -lt 2 ]; then
  echo "usage: $0 <id> <files...>"
  echo "ids: $ids"
  exit 1
fi
id="$1"; shift
case " $ids " in *" $id "*) ;; *) echo "unknown id '$id' (one of: $ids)"; exit 1 ;; esac

missing=""
for tool in ffmpeg ffprobe exiftool; do command -v "$tool" >/dev/null || missing="$missing $tool"; done
python3 -c 'import PIL' 2>/dev/null || missing="$missing python3-Pillow"
for f in "$@"; do
  case "$f" in *.gpx|*.GPX) python3 -c 'import gpxpy' 2>/dev/null || missing="$missing python3-gpxpy"; break ;; esac
done
if [ -n "$missing" ]; then echo "missing:$missing  (brew install ffmpeg exiftool; python3 -m pip install --user pillow gpxpy)"; exit 1; fi

mkdir -p "$photos/$id"
for f in "$@"; do
  [ -f "$f" ] || { echo "not a file: $f"; exit 1; }
  cp -p "$f" "$photos/$id/"
  echo "copied $(basename "$f")"
done

python3 "$here/process_photos.py"

repo="$(cd "$here/../.." && pwd)"
echo
echo "Now commit and push:"
echo "  cd \"$repo\""
echo "  git add thanksgivingtrip/photos"
echo "  git commit -m \"Add $id photos\""
echo "  git push"
