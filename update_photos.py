#!/usr/bin/env python3
"""Update index.html to reference photo files that now exist on disk."""
import os
import re

INDEX = os.path.join(os.path.dirname(__file__), "index.html")
PHOTOS_DIR = os.path.join(os.path.dirname(__file__), "photos")

# Get all slugs that have a photo file (jpg or png)
available = set()
for fn in os.listdir(PHOTOS_DIR):
    if fn.endswith(".jpg") or fn.endswith(".png"):
        slug = os.path.splitext(fn)[0]
        available.add(slug)

with open(INDEX, "r") as f:
    html = f.read()

# Each person is on one line. Match the whole line, identify slug, swap photo:null.
updated_count = 0
missing = []

new_lines = []
for line in html.splitlines(keepends=True):
    if 'photo:null' in line:
        m = re.search(r'id:"([a-z0-9-]+)"', line)
        if m:
            slug = m.group(1)
            if slug in available:
                jpg = os.path.join(PHOTOS_DIR, slug + ".jpg")
                ext = "jpg" if os.path.exists(jpg) else "png"
                line = line.replace('photo:null', f'photo:"photos/{slug}.{ext}"')
                updated_count += 1
            else:
                missing.append(slug)
    new_lines.append(line)
new_html = ''.join(new_lines)

if new_html != html:
    with open(INDEX, "w") as f:
        f.write(new_html)
    print(f"Updated {updated_count} photo references in index.html")
else:
    print("No changes.")

if missing:
    print(f"\n{len(missing)} slugs still have photo:null (no file on disk):")
    for s in missing:
        print(f"  {s}")
