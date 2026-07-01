#!/usr/bin/env python3
"""Reclassify vague Business-CRM records ('other' / 'local_business') into the
canonical Business type taxonomy, but only when confident.

Canonical values mirror BUSINESS_SUBTYPE_OPTIONS in src/lib/crm/types.ts.
The model is asked to keep the current bucket whenever it is not confident, so
non-pet / unknown venues stay put rather than being force-fit.

Usage:
    set -a; source .secrets/enrich.env; set +a
    python scripts/standardize_business_types.py            # writes .data/_type_updates.sql + prints summary
    ./scripts/supabase-sql.sh -f .data/_type_updates.sql    # apply
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, ".data")
SQL_HELPER = os.path.join(ROOT, "scripts", "supabase-sql.sh")
OUT_SQL = os.path.join(DATA, "_type_updates.sql")
DECISIONS = os.path.join(DATA, "_type_decisions.json")

OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Canonical taxonomy (value -> description used to guide the model).
CANON = {
    "groomer": "dog/cat grooming salon or mobile groomer",
    "daycare_boarding": "dog daycare, boarding, kennel, pet hotel",
    "pet_business": "dog walking, pet sitting, dog training, or other pet service",
    "pet_retail": "pet supply / pet retail store or boutique",
    "food_vendor": "pet food / nutrition brand or specialty food store",
    "exotic_shop": "exotic pet, reptile, bird, or aquarium/fish store",
    "merch_vendor": "merchandise / branded products / apparel vendor",
    "rescue": "animal rescue, shelter, foundation, or adoption group",
    "chamber": "chamber of commerce, business/community association, or nonprofit alliance",
    "media": "newspaper, press, news outlet, blog, or media page",
    "entertainment": "DJ, photo booth, photographer, animation, party/event entertainment",
    "print_vendor": "printing, signage, graphics, or design vendor",
    "local_business": "a local non-pet business partner (yoga, bar, hotel, gym, salon, real estate, restaurant)",
    "other": "unclear / does not fit any category",
}
ALLOWED = set(CANON)

DUMP_QUERY = (
    "select id, name, subtype, coalesce(services,'') as services, "
    "coalesce(website,'') as website "
    "from greendogops.crm_organization "
    "where org_type='marketing_partner' and subtype in ('other','local_business') "
    "order by name;"
)

PROMPT = """You are classifying business records into a fixed taxonomy. For each item, \
choose the SINGLE best category value from this list:

{taxonomy}

Rules:
- Choose the most specific category you are CONFIDENT about from the record's name/services.
- A clear pet-services/retail/rescue/media/entertainment/print business should get that category.
- A clearly NON-pet local venue (yoga, gym, bar, hotel, restaurant, real estate, spa) -> "local_business".
- If you are not confident what it is, return "other". Never guess wildly.
- Output ONLY a JSON array, same length/order as input, each element {{"i": <index>, "type": "<value>"}}.

Items:
{items}"""


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def dump_rows() -> list[dict]:
    res = subprocess.run([SQL_HELPER, "-q", DUMP_QUERY],
                         capture_output=True, text=True, cwd=ROOT)
    if res.returncode != 0:
        log("!! dump failed:", res.stderr[:400])
        sys.exit(1)
    return json.loads(res.stdout)


def classify_batch(rows: list[dict]) -> dict[int, str]:
    taxonomy = "\n".join(f'  "{k}": {v}' for k, v in CANON.items())
    items = "\n".join(
        f'{i}. name="{r["name"]}" services="{(r.get("services") or "")[:80]}" '
        f'website="{(r.get("website") or "")[:60]}"'
        for i, r in enumerate(rows)
    )
    body = {
        "model": MODEL,
        "messages": [{"role": "user",
                      "content": PROMPT.format(taxonomy=taxonomy, items=items)}],
        "temperature": 0,
    }
    req = urllib.request.Request(
        f"{OPENAI_BASE}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {OPENAI_KEY}",
                 "Content-Type": "application/json"},
    )
    content = None
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(req, timeout=120)
            content = json.load(r)["choices"][0]["message"]["content"]
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 4:
                wait = 2 ** attempt * 5
                log(f"  ! HTTP {e.code}, retry in {wait}s")
                time.sleep(wait)
                continue
            log(f"  ! HTTP {e.code}: {e.read().decode()[:160]}")
            return {}
    if content is None:
        return {}
    m = re.search(r"\[.*\]", content, re.DOTALL)
    if not m:
        log("  ? no json array in batch response")
        return {}
    out = {}
    for el in json.loads(m.group(0)):
        if isinstance(el, dict) and "i" in el and el.get("type") in ALLOWED:
            out[int(el["i"])] = el["type"]
    return out


def qstr(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# Deterministic keyword classifier (fallback used when the OpenAI quota is
# unavailable). Conservative: only reassigns on a high-confidence keyword,
# otherwise keeps the record's current bucket. Rules are ordered most-specific
# first; the first match wins.
# ---------------------------------------------------------------------------
RULES: list[tuple[str, list[str]]] = [
    ("rescue", ["rescue", "shelter", "humane", "spca", "sanctuary", "adoption",
                "animal society", "angel rescue", "animal foundation",
                "rescue foundation", "cat foundation", "paws for", "stray",
                "feral", "tnr", "cat alliance", "dog alliance"]),
    ("exotic_shop", ["reptile", "aquarium", "aquatic", "parrot", "canary",
                     "birdhouse", "exotic", "scales & tails", "scales and tails",
                     "fish & reptile", "fish and reptile", "tortoise", "aviary"]),
    ("groomer", ["groom"]),
    ("daycare_boarding", ["daycare", "day care", "boarding", "kennel",
                          "pet hotel", "pet resort", "doggie day", "doggy day",
                          "dog day", "pet lodge", "pet camp"]),
    ("pet_business", ["dog walk", "dog walker", "pet sit", "pet sitter",
                      "pet sitting", "dog training", "dog trainer", "obedience",
                      "pet care", "pet nanny", "pet taxi"]),
    ("food_vendor", ["pet food", "dog food", "nutrition", "kibble", "raw feed",
                     "barkery", "dog bakery", "pet bakery", "dog treats",
                     "pet treats"]),
    ("pet_retail", ["pet shop", "pet store", "pet supply", "pet supplies",
                    "pet boutique", "pet center", "pet club", "petco",
                    "petsmart", "pet food express", "pet food less", "petland",
                    "pet emporium", "pet naturally"]),
    ("media", ["press", " news", "news ", "magazine", "gazette", "journal",
               "the current", "west side current", "westside current",
               "media", "podcast", "radio", "tv "]),
    ("entertainment", ["dj ", "dj-", "d.j.", "photo booth", "photobooth",
                       "paparazzi", "papparazzi", "animation", "photography",
                       "photo studio", "party", "balloon", "magician"]),
    ("print_vendor", ["printing", "printer", "signage", "sign shop",
                      "sign co", "graphics", "banner", "embroider",
                      "screen print", "apparel print"]),
    ("chamber", ["chamber", "association", "alliance", "coalition",
                 "business improvement", "main street", "merchants",
                 "business council", "rotary", "kiwanis"]),
    # Clearly non-pet local venues -> local_business (only reassigns 'other').
    ("local_business", ["yoga", "pilates", "hotel", "brewery", "restaurant",
                        "cafe", "real estate", "keller williams", "fitness",
                        " gym", "recreation center", "wellness spa",
                        "beach house", "surf", "tattoo"]),
]

# local_business target only applied to records currently 'other'.
LOCAL_ONLY_FROM_OTHER = {"local_business"}
# Pet-spa disambiguation: "spa" alone is ambiguous (dog spa = grooming).
PET_HINT = ("dog", "pet", "cat", "pup", "paw", "canine", "feline", "hound", "k9", "k-9")


def deterministic_classify(name: str, services: str, current: str) -> str:
    text = f"{name} {services}".lower()
    is_pet = any(h in text for h in PET_HINT)
    for target, kws in RULES:
        if any(kw in text for kw in kws):
            if target in LOCAL_ONLY_FROM_OTHER:
                if current != "other" or is_pet:
                    continue  # don't relabel a pet business as local_business
                return target
            return target
    return current


def main():
    rows = dump_rows()
    log(f"loaded {len(rows)} records to review (other/local_business)")

    decisions: list[dict] = []
    changes: list[tuple[str, str, str, str]] = []  # id, name, old, new
    for r in rows:
        new = deterministic_classify(
            r["name"], r.get("services") or "", r["subtype"]
        )
        decisions.append({"name": r["name"], "old": r["subtype"], "new": new})
        if new != r["subtype"]:
            changes.append((r["id"], r["name"], r["subtype"], new))

    os.makedirs(DATA, exist_ok=True)
    json.dump(decisions, open(DECISIONS, "w"), indent=1)

    with open(OUT_SQL, "w") as f:
        f.write("-- Standardize Business-CRM types (other/local_business reclass)\n")
        f.write("-- generated by scripts/standardize_business_types.py\n")
        f.write("begin;\n")
        for oid, _name, _old, new in changes:
            f.write(
                f"update greendogops.crm_organization set subtype={qstr(new)}, "
                f"updated_at=now() where id='{oid}';\n"
            )
        f.write("commit;\n")

    # summary
    from collections import Counter
    moved = Counter(new for _, _, _, new in changes)
    log(f"\n{len(changes)} reclassified of {len(rows)}:")
    for t, c in moved.most_common():
        log(f"  -> {t}: {c}")
    log(f"\nSQL: {OUT_SQL}\nDecisions: {DECISIONS}")
    # print a few examples for review
    for oid, name, old, new in changes[:25]:
        log(f"  {name[:40]:40s} {old} -> {new}")


if __name__ == "__main__":
    main()
