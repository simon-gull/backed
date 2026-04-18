#!/usr/bin/env python3
"""Fetch Wikipedia thumbnails for roster players that lack photos."""
import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

PHOTOS_DIR = os.path.join(os.path.dirname(__file__), "photos")
os.makedirs(PHOTOS_DIR, exist_ok=True)

# id -> Wikipedia page title
PEOPLE = {
    "larry-ellison": "Larry Ellison",
    "michael-dell": "Michael Dell",
    "tobias-lutke": "Tobias Lütke",
    "warren-buffett": "Warren Buffett",
    "ken-griffin": "Kenneth C. Griffin",
    "stephen-schwarzman": "Stephen A. Schwarzman",
    "bill-ackman": "Bill Ackman",
    "cathie-wood": "Cathie Wood",
    "phil-knight": "Phil Knight",
    "bob-iger": "Bob Iger",
    "mukesh-ambani": "Mukesh Ambani",
    "wang-chuanfu": "Wang Chuanfu",
    "michelle-zatlyn": "Michelle Zatlyn",
    "mary-barra": "Mary Barra",
    "jane-fraser": "Jane Fraser",
    "safra-catz": "Safra Catz",
    "jeff-bezos": "Jeff Bezos",
    "bill-gates": "Bill Gates",
    "gautam-adani": "Gautam Adani",
    "dario-amodei": "Dario Amodei",
    "daniela-amodei": "Daniela Amodei",
    "mira-murati": "Mira Murati",
    "demis-hassabis": "Demis Hassabis",
    "fei-fei-li": "Fei-Fei Li",
    "alexandr-wang": "Alexandr Wang",
    "aravind-srinivas": "Aravind Srinivas",
    "arthur-mensch": "Arthur Mensch",
    "mustafa-suleyman": "Mustafa Suleyman",
    "lucy-guo": "Lucy Guo",
    "peter-thiel": "Peter Thiel",
    "alex-karp": "Alex Karp",
    "palmer-luckey": "Palmer Luckey",
    "michael-saylor": "Michael Saylor",
    "vitalik-buterin": "Vitalik Buterin",
    "dylan-field": "Dylan Field",
    "melanie-perkins": "Melanie Perkins",
    "kim-kardashian": "Kim Kardashian",
    "rihanna": "Rihanna",
    "kylie-jenner": "Kylie Jenner",
    "taylor-swift": "Taylor Swift",
    "emma-grede": "Emma Grede",
    "huda-kattan": "Huda Kattan",
    "jay-z": "Jay-Z",
    "ryan-reynolds": "Ryan Reynolds",
    "mrbeast": "MrBeast",
    "alex-hormozi": "Alex Hormozi",
    "toto-wolff": "Toto Wolff",
    "cristiano-ronaldo": "Cristiano Ronaldo",
    "david-beckham": "David Beckham",
}

UA = "BackedGamePhotoFetcher/1.0 (https://play-backed.vercel.app)"


def _summary_image(title: str):
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    img = data.get("originalimage") or data.get("thumbnail")
    return img["source"] if img and img.get("source") else None


def _pageimages(title: str):
    params = urllib.parse.urlencode({
        "action": "query",
        "titles": title,
        "prop": "pageimages",
        "piprop": "original|thumbnail",
        "pithumbsize": "800",
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
    })
    url = "https://en.wikipedia.org/w/api.php?" + params
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    pages = data.get("query", {}).get("pages", [])
    if not pages:
        return None
    p = pages[0]
    return (p.get("original") or p.get("thumbnail") or {}).get("source")


def get_image_url(title: str):
    """Return the best thumbnail URL for a Wikipedia page, or None."""
    img = _summary_image(title)
    if img:
        return img, None
    img = _pageimages(title)
    if img:
        return img, None
    return None, "no-image-found"


def download(url: str, dest: str, retries: int = 4):
    import time
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            with open(dest, "wb") as f:
                f.write(data)
            return len(data)
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429:
                time.sleep(2 ** attempt)  # 1, 2, 4, 8
                continue
            raise
        except Exception as e:
            last_err = e
            time.sleep(1)
    raise last_err


def fetch_one(slug: str, title: str):
    dest = os.path.join(PHOTOS_DIR, slug + ".jpg")
    if os.path.exists(dest):
        return slug, "skip-exists", None

    img_url, err = get_image_url(title)
    if not img_url:
        return slug, "fail", err

    try:
        size = download(img_url, dest)
        return slug, "ok", f"{size // 1024}KB from {img_url.split('/')[-1]}"
    except Exception as e:
        return slug, "fail", f"download-error: {e}"


def main():
    ok = []
    failed = []
    skipped = []

    with ThreadPoolExecutor(max_workers=3) as ex:
        futures = {ex.submit(fetch_one, slug, title): slug for slug, title in PEOPLE.items()}
        for fut in as_completed(futures):
            slug, status, detail = fut.result()
            if status == "ok":
                ok.append((slug, detail))
                print(f"OK   {slug}  {detail}")
            elif status == "skip-exists":
                skipped.append(slug)
                print(f"SKIP {slug}  (already exists)")
            else:
                failed.append((slug, detail))
                print(f"FAIL {slug}  {detail}")

    print()
    print(f"Summary: {len(ok)} ok, {len(skipped)} skipped, {len(failed)} failed")
    if failed:
        print("\nFailed IDs (need manual handling):")
        for slug, err in failed:
            print(f"  {slug}: {err}")


if __name__ == "__main__":
    main()
