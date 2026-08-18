#!/usr/bin/env python3
"""
Email enrichment for RateTap prospect lists.

Reads:
  - data/leads/leon-prospects.json
  - data/research/mx-group-prospects-enriched.json

Uses GOOGLE_PLACES_API_KEY env var (sourced from platform/.env.local).

Writes:
  - data/leads/email-prospects-2026-08-05.json
  - data/leads/email-prospects-2026-08-05-report.json

Run from repo root:
  source platform/.env.local && python3 scripts/enrich_emails.py
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.parse
from collections import Counter
from typing import Any

import requests
from bs4 import BeautifulSoup

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
})

API_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")
GOOGLE_PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"

EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE,
)

# Prefer these local-part prefixes when ranking within a domain.
ROLE_PREFIXES = [
    "contacto", "hola", "reservaciones", "reservas", "gerencia", "admin",
    "info", "ventas", "marketing", "rh", "reclutamiento", "franquicias",
    "soporte", "atencion", "atención", "servicio", "servicios",
]

# Blocked local parts / domains / substrings.
BLOCKED_LOCAL_PARTS = {
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
    "example", "test", "admin@example", "info@example", "user@example",
    "sentry", "wix", "godaddy", "support@wix", "domain", "hostmaster",
    "webmaster", "postmaster", "abuse", "security", "billing",
    "hello@example", "yourname", "nombre", "micorreo", "correo@correo",
    "mail@mail", "email@email",
}

BLOCKED_DOMAIN_SUBSTRINGS = {
    "example.com", "wix.com", "wixpress.com", "godaddy.com", "sentry.io",
    "sentry-next.wixpress.com", "amazonaws.com", "gstatic.com",
    "googleusercontent.com", "whatsapp.com", "facebook.com",
    "instagram.com", "tiktok.com", "twitter.com", "x.com", "sentry.wixpress.com",
}

# Blocked file extensions that indicate image filenames / assets.
BLOCKED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".ico",
    ".pdf", ".zip", ".doc", ".docx", ".xls", ".xlsx", ".mp4", ".mp3",
}


def is_image_filename(email: str) -> bool:
    local = email.split("@")[0].lower()
    return any(local.endswith(ext.rstrip(".")) for ext in BLOCKED_EXTENSIONS)


def is_junk_email(email: str) -> bool:
    e = email.lower().strip()
    if not e or "@" not in e or e.count("@") != 1:
        return True
    local, domain = e.split("@", 1)
    if local in BLOCKED_LOCAL_PARTS:
        return True
    if any(blocked in e for blocked in BLOCKED_DOMAIN_SUBSTRINGS):
        return True
    if is_image_filename(e):
        return True
    # Catch obviously auto-generated platform emails.
    if "sentry" in local or "wix" in local or "godaddy" in local:
        return True
    # Reject emails whose local part is only digits/nonsense.
    if re.fullmatch(r"[0-9_\-\.]+", local):
        return True
    return False


def normalize_url(url: str) -> str | None:
    url = url.strip()
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url
    # Strip trailing slash for consistent root detection.
    return url.rstrip("/")


def get_root_domain(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def get_base_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def join_url(base: str, path: str) -> str:
    path = path.strip()
    if not path:
        return base
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("//"):
        return "https:" + path
    if path.startswith("/"):
        parsed = urllib.parse.urlparse(base)
        return f"{parsed.scheme}://{parsed.netloc}{path}"
    if not base.endswith("/"):
        base = base + "/"
    return base + path


def fetch_url(url: str, timeout: int = 12) -> tuple[str | None, int]:
    """Fetch a URL; return (text, status_code)."""
    try:
        resp = SESSION.get(url, timeout=timeout, allow_redirects=True)
        if resp.status_code == 403:
            # Try with http if https is blocked.
            if url.startswith("https://"):
                resp = SESSION.get(
                    url.replace("https://", "http://", 1),
                    timeout=timeout,
                    allow_redirects=True,
                )
        # Some Wix sites return 200 with JS-rendered content; we still parse.
        if resp.status_code >= 400:
            return None, resp.status_code
        # Prefer text, but decode bytes if needed.
        if "text" in resp.headers.get("Content-Type", ""):
            return resp.text, resp.status_code
        return resp.text, resp.status_code
    except Exception:
        return None, 0


def decode_entities(text: str) -> str:
    if not text:
        return ""
    # Decode HTML entities like &#64; -> @, &#46; -> .
    decoded = html.unescape(text)
    # Some sites use hex entities; run unescape twice to be safe.
    decoded = html.unescape(decoded)
    return decoded


def extract_obfuscated_emails(text: str) -> list[str]:
    """Find emails obfuscated with (at), [at], at, dot, etc."""
    if not text:
        return []
    emails: list[str] = []
    # Pattern: word (at) domain (dot) tld  or  word [at] domain [dot] tld
    patterns = [
        r"([a-zA-Z0-9._%+-]+)\s*\(at\)\s*([a-zA-Z0-9.-]+)\s*\(dot\)\s*([a-zA-Z]{2,})",
        r"([a-zA-Z0-9._%+-]+)\s*\[at\]\s*([a-zA-Z0-9.-]+)\s*\[dot\]\s*([a-zA-Z]{2,})",
        r"([a-zA-Z0-9._%+-]+)\s*\bat\b\s*([a-zA-Z0-9.-]+)\s*\bdot\b\s*([a-zA-Z]{2,})",
        r"([a-zA-Z0-9._%+-]+)\s*&#64;\s*([a-zA-Z0-9.-]+)\s*&#46;\s*([a-zA-Z]{2,})",
    ]
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            email = f"{m.group(1)}@{m.group(2)}.{m.group(3)}".lower()
            if not is_junk_email(email):
                emails.append(email)
    return emails


def extract_emails_from_text(text: str) -> list[str]:
    if not text:
        return []
    text = decode_entities(text)
    candidates = EMAIL_RE.findall(text)
    cleaned = []
    for c in candidates:
        # Remove trailing punctuation sometimes captured.
        c = re.sub(r"[\)\]\'\"\,\.\;\:\>\<]+$", "", c)
        if not is_junk_email(c):
            cleaned.append(c.lower())
    cleaned.extend(extract_obfuscated_emails(text))
    return cleaned


def extract_emails_from_soup(soup: BeautifulSoup) -> list[str]:
    emails: list[str] = []
    # mailto: links
    for a in soup.find_all("a", href=True):
        href = a["href"].strip().lower()
        if href.startswith("mailto:"):
            addr = href.split(":", 1)[1].split("?")[0].strip()
            if not is_junk_email(addr):
                emails.append(addr.lower())
    # data-* attributes that may contain emails
    for tag in soup.find_all(attrs={"data-email": True}):
        val = tag.get("data-email", "")
        if val:
            emails.extend(extract_emails_from_text(val))
    # JSON-LD / scripts
    for script in soup.find_all("script"):
        if script.string:
            emails.extend(extract_emails_from_text(script.string))
    # comments
    for comment in soup.find_all(string=lambda t: isinstance(t, type(soup.string)) and "--" in str(t)):
        emails.extend(extract_emails_from_text(str(comment)))
    # Plain text
    emails.extend(extract_emails_from_text(soup.get_text(" ", strip=True)))
    return emails


def dedupe_preserve_order(emails: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for e in emails:
        if e not in seen:
            seen.add(e)
            out.append(e)
    return out


def email_score(email: str, root_domain: str) -> int:
    """Higher score = better email."""
    local, domain = email.lower().split("@", 1)
    score = 0
    # Domain match is huge.
    if root_domain and (domain == root_domain or domain.endswith("." + root_domain)):
        score += 100
    elif root_domain and root_domain.replace("www.", "") in domain:
        score += 50
    # Role prefix.
    for i, prefix in enumerate(ROLE_PREFIXES):
        if local.startswith(prefix):
            score += 30 - i  # earlier prefixes score higher
            break
    # Penalize generic free providers unless domain matches site.
    free_providers = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com"}
    if domain in free_providers:
        score -= 40
    # Penalize very long locals.
    if len(local) > 30:
        score -= 10
    # Penalize numeric-only locals.
    if re.fullmatch(r"[0-9]+", local):
        score -= 50
    return score


def pick_best_email(emails: list[str], root_domain: str) -> str | None:
    emails = dedupe_preserve_order(emails)
    if not emails:
        return None
    emails.sort(key=lambda e: email_score(e, root_domain), reverse=True)
    return emails[0]


def scrape_website_emails(website: str) -> tuple[str | None, str | None, list[str]]:
    """
    Scrape a website for emails.
    Returns (best_email, source_url, all_emails).
    """
    root = normalize_url(website)
    if not root:
        return None, None, []
    root_domain = get_root_domain(root)
    # Use the site's root for standard legal/contact pages, because location-specific
    # URLs (e.g. /sonora-grill-reforma) would yield wrong paths.
    base_root = get_base_url(root)

    pages_to_try = [
        (root, "homepage"),
        (join_url(base_root, "/aviso-de-privacidad"), "aviso-de-privacidad"),
        (join_url(base_root, "/aviso-de-privacidad/"), "aviso-de-privacidad"),
        (join_url(base_root, "/aviso-privacidad"), "aviso-de-privacidad"),
        (join_url(base_root, "/politica-de-privacidad"), "aviso-de-privacidad"),
        (join_url(base_root, "/politica-privacidad"), "aviso-de-privacidad"),
        (join_url(base_root, "/privacidad"), "aviso-de-privacidad"),
        (join_url(base_root, "/terminos-y-condiciones"), "aviso-de-privacidad"),
        (join_url(base_root, "/terminos"), "aviso-de-privacidad"),
        (join_url(base_root, "/aviso-legal"), "aviso-de-privacidad"),
        (join_url(base_root, "/contacto"), "contacto"),
        (join_url(base_root, "/contacto/"), "contacto"),
        (join_url(base_root, "/contact"), "contacto"),
        (join_url(base_root, "/contact/"), "contacto"),
        (join_url(base_root, "/nosotros"), "homepage"),
        (join_url(base_root, "/franquicias"), "homepage"),
    ]

    all_emails: list[str] = []
    for url, page_type in pages_to_try:
        text, status = fetch_url(url)
        if text is None:
            continue
        soup = BeautifulSoup(text, "html.parser")
        emails = extract_emails_from_soup(soup)
        if emails:
            all_emails.extend(emails)
            # aviso-de-privacidad is the highest-yield page per the brief.
            if page_type == "aviso-de-privacidad":
                best = pick_best_email(emails, root_domain)
                return best, url, dedupe_preserve_order(all_emails)
            best = pick_best_email(emails, root_domain)
            if best:
                return best, url, dedupe_preserve_order(all_emails)

    # Try to discover additional linked contact pages by scanning homepage.
    homepage_text, _ = fetch_url(root)
    if homepage_text:
        homepage_soup = BeautifulSoup(homepage_text, "html.parser")
        contact_links = set()
        for a in homepage_soup.find_all("a", href=True):
            href = a["href"].lower()
            text = a.get_text(" ", strip=True).lower()
            if any(k in href for k in ["contacto", "contact", "privacidad", "aviso"]) or \
               any(k in text for k in ["contacto", "contact", "privacidad", "aviso"]):
                contact_links.add(join_url(root, a["href"]))
        for url in contact_links:
            if url in [u for u, _ in pages_to_try]:
                continue
            text, status = fetch_url(url)
            if text:
                soup = BeautifulSoup(text, "html.parser")
                emails = extract_emails_from_soup(soup)
                if emails:
                    all_emails.extend(emails)
                    best = pick_best_email(emails, root_domain)
                    return best, url, dedupe_preserve_order(all_emails)

    best = pick_best_email(all_emails, root_domain)
    return best, root if best else None, dedupe_preserve_order(all_emails)


def fetch_website_from_places(place_id: str) -> str | None:
    if not API_KEY or not place_id:
        return None
    try:
        resp = SESSION.get(
            GOOGLE_PLACES_DETAILS_URL,
            params={
                "place_id": place_id,
                "fields": "website",
                "key": API_KEY,
            },
            timeout=15,
        )
        data = resp.json()
        return data.get("result", {}).get("website")
    except Exception:
        return None


def scrape_facebook_about(facebook_url: str) -> tuple[str | None, str | None]:
    """
    Try to grab an email from a public Facebook page's about section.
    Facebook blocks most scraping, but sometimes the mobile/about page exposes info.
    """
    variants = [
        facebook_url.replace("facebook.com", "m.facebook.com"),
        facebook_url + "about/",
        facebook_url + "about",
    ]
    for url in variants:
        text, status = fetch_url(url)
        if text:
            emails = extract_emails_from_text(text)
            if emails:
                best = pick_best_email(emails, get_root_domain(facebook_url))
                return best, url
    return None, None


def process_leon_prospect(p: dict[str, Any]) -> dict[str, Any] | None:
    name = p.get("name", "")
    place_id = p.get("placeId") or p.get("place_id")
    phone = p.get("phone")
    rating = p.get("rating")
    website = p.get("website")

    if not website and place_id:
        website = fetch_website_from_places(place_id)
        if website:
            time.sleep(0.05)

    if not website:
        return None

    best, source_url, _ = scrape_website_emails(website)
    confidence = "high" if best and source_url and "aviso-de-privacidad" in source_url else "high" if best else None

    # If no email from website and website is Facebook, try Facebook about.
    if not best and "facebook.com" in website.lower():
        best, source_url = scrape_facebook_about(website)
        confidence = "medium" if best else None

    if not best:
        return None

    return {
        "name": name,
        "email": best,
        "source_url": source_url or website,
        "kind": "leon",
        "place_id": place_id,
        "phone": phone,
        "rating": rating,
        "city": "León",
        "confidence": confidence or "high",
    }


def normalize_brand(brand: str) -> str:
    """Return a lowercase, alphanumeric-only version of the brand for matching."""
    return re.sub(r"[^a-z0-9]", "", brand.lower())


def choose_group_websites(group: dict[str, Any]) -> list[tuple[str, str | None]]:
    """Return list of (website, place_id) candidates for a group, best first."""
    locations = group.get("locations", [])
    brand = group.get("brand", "")
    brand_norm = normalize_brand(brand)
    candidates: list[tuple[str, str | None]] = []
    root_counts: Counter[str] = Counter()

    # Collect all location websites (excluding Facebook-only pages).
    for loc in locations:
        w = loc.get("website")
        if not w:
            continue
        if "facebook.com" in w.lower():
            continue
        candidates.append((w, loc.get("place_id")))
        root_counts[get_root_domain(w)] += 1

    if not candidates:
        # Try to fetch website for strongest location.
        strongest = group.get("strongest")
        if strongest and strongest.get("place_id"):
            website = fetch_website_from_places(strongest["place_id"])
            if website:
                return [(website, strongest["place_id"])]
        return []

    def score(item: tuple[str, str | None]) -> tuple[int, int, int]:
        root = get_root_domain(item[0])
        brand_score = int(brand_norm and brand_norm in re.sub(r"[^a-z0-9]", "", root))
        # Prefer Mexican ccTLDs for Mexican groups.
        mx_score = int(root.endswith(".com.mx") or root.endswith(".mx"))
        count = root_counts[root]
        return (brand_score, count, mx_score)

    candidates.sort(key=lambda x: score(x), reverse=True)

    # Deduplicate by root domain while preserving order.
    seen_roots: set[str] = set()
    deduped: list[tuple[str, str | None]] = []
    for w, pid in candidates:
        root = get_root_domain(w)
        if root not in seen_roots:
            seen_roots.add(root)
            deduped.append((w, pid))

    return deduped


def process_group(group: dict[str, Any]) -> dict[str, Any] | None:
    brand = group.get("brand", "")
    hq = group.get("hq", "")
    locations = group.get("locations", [])

    website_candidates = choose_group_websites(group)
    if not website_candidates:
        return None

    best = None
    source_url = None
    used_place_id = None
    used_website = None

    for website, place_id in website_candidates:
        best, source_url, _ = scrape_website_emails(website)
        if best:
            used_place_id = place_id
            used_website = website
            break
        if "facebook.com" in website.lower():
            best, source_url = scrape_facebook_about(website)
            if best:
                used_place_id = place_id
                used_website = website
                break

    if not best:
        return None

    # Pick representative phone/rating from the location we used or strongest.
    rep_loc = next(
        (loc for loc in locations if loc.get("place_id") == used_place_id),
        locations[0] if locations else {},
    )

    return {
        "name": brand,
        "email": best,
        "source_url": source_url or used_website,
        "kind": "group",
        "place_id": used_place_id,
        "phone": rep_loc.get("phone"),
        "rating": rep_loc.get("rating"),
        "city": hq or "",
        "confidence": "high",
    }


def main() -> int:
    if not API_KEY:
        print("ERROR: GOOGLE_PLACES_API_KEY not set. Source platform/.env.local first.", file=sys.stderr)
        return 1

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    leon_path = os.path.join(repo_root, "data", "leads", "leon-prospects.json")
    groups_path = os.path.join(repo_root, "data", "research", "mx-group-prospects-enriched.json")
    out_path = os.path.join(repo_root, "data", "leads", "email-prospects-2026-08-05.json")
    report_path = os.path.join(repo_root, "data", "leads", "email-prospects-2026-08-05-report.json")

    with open(leon_path, "r", encoding="utf-8") as f:
        leon_prospects = json.load(f)
    with open(groups_path, "r", encoding="utf-8") as f:
        groups = json.load(f)

    results: list[dict[str, Any]] = []
    method_counter = Counter()

    print(f"Processing {len(leon_prospects)} León prospects...")
    for p in leon_prospects:
        result = process_leon_prospect(p)
        if result:
            results.append(result)
            if "aviso-de-privacidad" in result["source_url"]:
                method_counter["website_aviso_privacidad"] += 1
            elif "contact" in result["source_url"].lower() or "contacto" in result["source_url"].lower():
                method_counter["website_contacto"] += 1
            elif "facebook.com" in result["source_url"].lower():
                method_counter["facebook"] += 1
            else:
                method_counter["website_homepage"] += 1

    print(f"Processing {len(groups)} group prospects...")
    for g in groups:
        result = process_group(g)
        if result:
            results.append(result)
            if "aviso-de-privacidad" in result["source_url"]:
                method_counter["website_aviso_privacidad"] += 1
            elif "contact" in result["source_url"].lower() or "contacto" in result["source_url"].lower():
                method_counter["website_contacto"] += 1
            elif "facebook.com" in result["source_url"].lower():
                method_counter["facebook"] += 1
            else:
                method_counter["website_homepage"] += 1

    # Merge manual overrides (e.g. emails found via web search / directories).
    overrides_path = os.path.join(repo_root, "data", "leads", "email-prospects-2026-08-05-overrides.json")
    if os.path.exists(overrides_path):
        with open(overrides_path, "r", encoding="utf-8") as f:
            overrides = json.load(f)
        existing_keys = {(r["name"], r["kind"]) for r in results}
        for override in overrides:
            key = (override.get("name"), override.get("kind"))
            if key not in existing_keys:
                results.append(override)
                existing_keys.add(key)
                # Track manual/search methods separately.
                method_counter["manual_or_search"] += 1

    # Sort groups first, then by name.
    results.sort(key=lambda r: (0 if r["kind"] == "group" else 1, r["name"]))

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    leon_found = [r for r in results if r["kind"] == "leon"]
    groups_found = [r for r in results if r["kind"] == "group"]

    report = {
        "date": "2026-08-05",
        "summary": {
            "total_prospects_processed": len(leon_prospects) + len(groups),
            "total_emails_found": len(results),
            "overall_coverage_pct": round(100 * len(results) / (len(leon_prospects) + len(groups)), 1),
        },
        "leon": {
            "prospects_processed": len(leon_prospects),
            "emails_found": len(leon_found),
            "coverage_pct": round(100 * len(leon_found) / len(leon_prospects), 1),
        },
        "groups": {
            "prospects_processed": len(groups),
            "emails_found": len(groups_found),
            "coverage_pct": round(100 * len(groups_found) / len(groups), 1),
        },
        "confidence_breakdown": dict(Counter(r["confidence"] for r in results)),
        "method_breakdown": dict(method_counter),
        "top_5_groups_with_email": [
            {"name": r["name"], "email": r["email"], "city": r["city"]}
            for r in groups_found[:5]
        ],
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
