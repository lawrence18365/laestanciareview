#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import UTC, datetime
from html import escape
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CONTENT_PATH = ROOT / "content" / "blog" / "posts.json"
SITEMAP_PATH = ROOT / "sitemap.xml"

SITE_DOMAIN = "https://ratetapmx.com"
LOGO_URL = f"{SITE_DOMAIN}/assets/logo-new.png"
OG_IMAGE_URL = f"{SITE_DOMAIN}/assets/og-image.png"

GENERATED_SITEMAP_START = "  <!-- Generated blog pages start -->"
GENERATED_SITEMAP_END = "  <!-- Generated blog pages end -->"

LOCALE_CONFIG = {
    "en": {
        "lang": "en",
        "locale_tag": "en-US",
        "og_locale": "en_US",
        "asset_prefix": "../",
        "home_prefix": "../",
        "blog_prefix": "blog",
        "lang_toggle_label": "ES",
        "lang_toggle_path": "../es/blog",
        "home_label": "Home",
        "blog_label": "Playbooks",
        "nav_how": "How It Works",
        "nav_features": "Features",
        "nav_faq": "FAQ",
        "hub_eyebrow": "RateTap Operator Journal",
        "hub_title": "Restaurant operator playbooks built around real review pain.",
        "hub_description": (
            "Practical guides for owners and GMs trying to recover ratings, "
            "capture more Google reviews, and make staff accountability measurable."
        ),
        "hub_featured_label": "Featured playbook",
        "hub_cluster_title": "What this library is built to solve",
        "hub_cluster_cards": [
            {
                "title": "Rating Recovery",
                "body": "For operators reacting to a slip in average rating, review streak, or service reputation.",
            },
            {
                "title": "Review Capture",
                "body": "For teams with happy guests who still leave without posting public feedback.",
            },
            {
                "title": "Staff Accountability",
                "body": "For restaurants that need a clear signal on who is asking well and who needs coaching.",
            },
        ],
        "hub_cta_title": "Want the software behind these playbooks?",
        "hub_cta_body": (
            "RateTap turns the advice into an operating system: instant private feedback, "
            "clean Google review routing, and server-level accountability."
        ),
        "hub_cta_primary": "Book a demo",
        "hub_cta_secondary": "See the platform",
        "hub_cta_secondary_href": "../restaurant-review-management-software",
        "hub_chips": ["Google reviews", "Restaurant reputation", "Staff accountability"],
        "featured_primary_label": "Read playbook",
        "summary_label": "Quick summary",
        "pain_label": "Primary pain",
        "best_for_label": "Best for",
        "toc_label": "In this article",
        "faq_title": "Questions operators usually ask next",
        "related_title": "Keep reading",
        "related_link_label": "Explore",
        "footer_tagline": "The standard in premium hospitality reputation management.",
        "footer_platform": "Platform",
        "footer_company": "Company",
        "footer_connect": "Connect",
        "footer_platform_links": [
            ("Sentiment Flow", "#"),
            ("Staff Tracking", "#"),
            ("Enterprise", "#"),
        ],
        "footer_company_links": [
            ("Playbooks", "blog/"),
            ("Case Studies", "case-studies"),
            ("ROI Calculator", "roi-calculator"),
            ("Contact", "demo#demo-form"),
        ],
        "footer_legal": [("Privacy Policy", "#"), ("Terms of Service", "#")],
        "footer_rights": "&copy; 2026 RateTap. All rights reserved.",
        "updated_prefix": "Updated",
        "read_suffix": "read",
        "cta_secondary_label": "See the software",
        "breadcrumbs": ["Home", "Playbooks"],
        "meta_description_suffix": " | RateTap",
    },
    "es": {
        "lang": "es",
        "locale_tag": "es-MX",
        "og_locale": "es_MX",
        "asset_prefix": "../../",
        "home_prefix": "../",
        "blog_prefix": "es/blog",
        "lang_toggle_label": "EN",
        "lang_toggle_path": "../../blog",
        "home_label": "Inicio",
        "blog_label": "Guías",
        "nav_how": "Cómo funciona",
        "nav_features": "Funciones",
        "nav_faq": "FAQ",
        "hub_eyebrow": "Biblioteca operativa de RateTap",
        "hub_title": "Guías para restaurantes diseñadas alrededor de dolores reales de reputación.",
        "hub_description": (
            "Material práctico para dueños y gerentes que necesitan recuperar su calificación, "
            "capturar más reseñas de Google y medir con claridad la ejecución del equipo."
        ),
        "hub_featured_label": "Guía destacada",
        "hub_cluster_title": "Problemas operativos que esta biblioteca ayuda a resolver",
        "hub_cluster_cards": [
            {
                "title": "Recuperación de calificación",
                "body": "Para operadores que reaccionan a una baja en promedio, racha de reseñas o reputación de servicio.",
            },
            {
                "title": "Captura de reseñas",
                "body": "Para equipos con clientes satisfechos que aun así se van sin dejar feedback público.",
            },
            {
                "title": "Responsabilidad del staff",
                "body": "Para restaurantes que necesitan medir quién está pidiendo bien la reseña y quién necesita coaching.",
            },
        ],
        "hub_cta_title": "¿Quieres el software detrás de estas guías?",
        "hub_cta_body": (
            "RateTap convierte la estrategia en operación: feedback privado en tiempo real, "
            "ruta limpia hacia Google y seguimiento por mesero."
        ),
        "hub_cta_primary": "Agendar demo",
        "hub_cta_secondary": "Ver la plataforma",
        "hub_cta_secondary_href": "../software-gestion-resenas-restaurantes",
        "hub_chips": ["Reseñas en Google", "Reputación del restaurante", "Responsabilidad del staff"],
        "featured_primary_label": "Leer guía",
        "summary_label": "Resumen rápido",
        "pain_label": "Dolor principal",
        "best_for_label": "Ideal para",
        "toc_label": "En esta guía",
        "faq_title": "Preguntas que suelen venir después",
        "related_title": "Sigue leyendo",
        "related_link_label": "Explorar",
        "footer_tagline": "El estándar en gestión de reputación para hotelería premium.",
        "footer_platform": "Plataforma",
        "footer_company": "Compañía",
        "footer_connect": "Conectar",
        "footer_platform_links": [
            ("Flujo de sentimiento", "#"),
            ("Seguimiento de staff", "#"),
            ("Empresas", "#"),
        ],
        "footer_company_links": [
            ("Guías", "blog/"),
            ("Casos de éxito", "case-studies"),
            ("Calculadora ROI", "roi-calculator"),
            ("Contacto", "demo#demo-form"),
        ],
        "footer_legal": [("Privacidad", "#"), ("Términos", "#")],
        "footer_rights": "&copy; 2026 RateTap. Todos los derechos reservados.",
        "updated_prefix": "Actualizado",
        "read_suffix": "de lectura",
        "cta_secondary_label": "Ver la plataforma",
        "breadcrumbs": ["Inicio", "Guías"],
        "meta_description_suffix": " | RateTap",
    },
}


def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9\s-]", "", value).strip().lower()
    return re.sub(r"[\s-]+", "-", value)


def load_content() -> dict:
    return json.loads(CONTENT_PATH.read_text(encoding="utf-8"))


def article_url(locale: str, slug: str) -> str:
    if locale == "en":
        return f"{SITE_DOMAIN}/blog/{slug}"
    return f"{SITE_DOMAIN}/es/blog/{slug}"


def index_url(locale: str) -> str:
    if locale == "en":
        return f"{SITE_DOMAIN}/blog/"
    return f"{SITE_DOMAIN}/es/blog/"


def article_file(locale: str, slug: str) -> Path:
    directory = ROOT / "blog" if locale == "en" else ROOT / "es" / "blog"
    return directory / f"{slug}.html"


def index_file(locale: str) -> Path:
    directory = ROOT / "blog" if locale == "en" else ROOT / "es" / "blog"
    return directory / "index.html"


def relative_locale_url(locale: str, target: str) -> str:
    if target.startswith("/"):
        target = target[1:]
    return f"{LOCALE_CONFIG[locale]['home_prefix']}{target}"


def render_nav(locale: str, lang_toggle_href: str) -> str:
    cfg = LOCALE_CONFIG[locale]
    home = cfg["home_prefix"]
    assets = cfg["asset_prefix"]
    return f"""
    <nav class="navbar" id="navbar">
        <a class="nav-brand" href="{home}">
            <img src="{assets}assets/logo-new.png" alt="RateTap" width="1536" height="1024" decoding="async" loading="eager">
        </a>
        <div class="nav-menu" id="nav-menu">
            <a class="nav-link" href="{home}#how-it-works">{escape(cfg['nav_how'])}</a>
            <a class="nav-link" href="{home}#features">{escape(cfg['nav_features'])}</a>
            <a class="nav-link" href="{home}blog/">{escape(cfg['blog_label'])}</a>
            <a class="nav-link" href="{home}#faq">{escape(cfg['nav_faq'])}</a>
        </div>
        <div class="nav-actions">
            <a href="{escape(lang_toggle_href)}" class="nav-lang-toggle" style="margin-right: 1.5rem; color: var(--text-secondary); text-decoration: none; font-weight: 700; font-size: 0.95rem; transition: color 0.2s; display: flex; align-items: center; gap: 0.5rem;">
                <i class="fa-solid fa-globe"></i> {escape(cfg['lang_toggle_label'])}
            </a>
            <a class="btn btn-primary" href="{home}demo" style="padding: 0.7rem 1.8rem; font-size: 0.9rem;">{escape(cfg['hub_cta_primary'])}</a>
        </div>
    </nav>
    """


def render_footer(locale: str) -> str:
    cfg = LOCALE_CONFIG[locale]
    assets = cfg["asset_prefix"]
    home = cfg["home_prefix"]
    platform_links = "\n".join(
        f'                    <a href="{escape(href)}">{escape(label)}</a>'
        for label, href in cfg["footer_platform_links"]
    )
    company_links = "\n".join(
        f'                    <a href="{escape(home + href)}">{escape(label)}</a>'
        for label, href in cfg["footer_company_links"]
    )
    legal_links = "\n".join(
        f'                    <a href="{escape(href)}">{escape(label)}</a>'
        for label, href in cfg["footer_legal"]
    )
    return f"""
    <footer class="footer">
        <div class="container">
            <div class="footer-grid">
                <div class="footer-brand">
                    <img src="{assets}assets/logo-new.png" alt="RateTap" width="1536" height="1024" decoding="async" loading="eager">
                    <p style="color: var(--text-secondary); font-size: 0.95rem; line-height: 1.6; max-width: 320px;">{escape(cfg['footer_tagline'])}</p>
                </div>
                <div class="footer-links">
                    <h4>{escape(cfg['footer_platform'])}</h4>
{platform_links}
                </div>
                <div class="footer-links">
                    <h4>{escape(cfg['footer_company'])}</h4>
{company_links}
                </div>
                <div class="footer-links">
                    <h4>{escape(cfg['footer_connect'])}</h4>
                    <div class="social-links">
                        <a href="#"><i class="fa-brands fa-twitter"></i></a>
                        <a href="#"><i class="fa-brands fa-instagram"></i></a>
                        <a href="#"><i class="fa-brands fa-linkedin"></i></a>
                    </div>
                </div>
            </div>
            <div class="footer-bottom">
                <p>{cfg['footer_rights']}</p>
                <div class="legal-links">
{legal_links}
                </div>
            </div>
        </div>
    </footer>
    """


def render_head(
    *,
    locale: str,
    title: str,
    description: str,
    canonical: str,
    alternate_en: str,
    alternate_es: str,
    og_type: str,
    asset_prefix: str,
    structured_data: str,
) -> str:
    cfg = LOCALE_CONFIG[locale]
    alternate_locale = "es_MX" if locale == "en" else "en_US"
    return f"""<!DOCTYPE html>
<html lang="{cfg['lang']}">
<head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>{escape(title)}</title>
    <meta name="description" content="{escape(description)}"/>
    <link rel="canonical" href="{canonical}"/>
    <link rel="alternate" hreflang="en-US" href="{alternate_en}"/>
    <link rel="alternate" hreflang="es-MX" href="{alternate_es}"/>
    <link rel="alternate" hreflang="x-default" href="{alternate_en}"/>
    <meta property="og:type" content="{escape(og_type)}"/>
    <meta property="og:url" content="{canonical}"/>
    <meta property="og:title" content="{escape(title)}"/>
    <meta property="og:description" content="{escape(description)}"/>
    <meta property="og:image" content="{OG_IMAGE_URL}"/>
    <meta property="og:locale" content="{cfg['og_locale']}"/>
    <meta property="og:locale:alternate" content="{alternate_locale}"/>
    <meta property="og:site_name" content="RateTap"/>
    <meta name="twitter:card" content="summary_large_image"/>
    <meta name="twitter:title" content="{escape(title)}"/>
    <meta name="twitter:description" content="{escape(description)}"/>
    <meta name="twitter:image" content="{OG_IMAGE_URL}"/>
    <link rel="preload" href="{asset_prefix}styles.css" as="style"/>
    <link rel="stylesheet" href="{asset_prefix}styles.css"/>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"/>
    <script type="application/ld+json">{structured_data}</script>
</head>
"""


def render_list(items: list[str]) -> str:
    return "\n".join(f"                    <li>{escape(item)}</li>" for item in items)


def render_post(post: dict, locale: str) -> str:
    cfg = LOCALE_CONFIG[locale]
    variant = post["locales"][locale]
    alt_locale = "es" if locale == "en" else "en"
    alt_variant = post["locales"][alt_locale]
    asset_prefix = cfg["asset_prefix"]
    lang_toggle_href = f"{cfg['lang_toggle_path']}/{alt_variant['slug']}"

    headings = []
    for section in variant["sections"]:
        anchor = slugify(section["heading"])
        headings.append((anchor, section["heading"]))

    breadcrumbs = [
        {"name": cfg["breadcrumbs"][0], "item": f"{SITE_DOMAIN}/{'es/' if locale == 'es' else ''}"},
        {"name": cfg["breadcrumbs"][1], "item": index_url(locale)},
        {"name": variant["title"], "item": article_url(locale, variant["slug"])},
    ]

    structured_data = json.dumps(
        {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "BlogPosting",
                    "headline": variant["title"],
                    "description": variant["description"],
                    "image": [OG_IMAGE_URL],
                    "datePublished": variant["datePublished"],
                    "dateModified": variant["dateModified"],
                    "inLanguage": cfg["locale_tag"],
                    "mainEntityOfPage": article_url(locale, variant["slug"]),
                    "keywords": [post["targetKeyword"]] + post.get("supportingKeywords", []),
                    "author": {
                        "@type": "Organization",
                        "name": "RateTap Editorial Team",
                        "url": SITE_DOMAIN,
                    },
                    "publisher": {
                        "@type": "Organization",
                        "name": "RateTap",
                        "logo": {"@type": "ImageObject", "url": LOGO_URL},
                    },
                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {
                            "@type": "ListItem",
                            "position": index + 1,
                            "name": crumb["name"],
                            "item": crumb["item"],
                        }
                        for index, crumb in enumerate(breadcrumbs)
                    ],
                },
            ],
        },
        ensure_ascii=False,
    )

    sections_html = []
    for section in variant["sections"]:
        anchor = slugify(section["heading"])
        paragraphs = "\n".join(
            f"                <p>{escape(paragraph)}</p>" for paragraph in section.get("paragraphs", [])
        )
        bullets = ""
        if section.get("bullets"):
            bullets = f"""
                <ul class="blog-list">
{render_list(section['bullets'])}
                </ul>
            """
        callout = ""
        if section.get("callout"):
            callout = f"""
                <div class="blog-callout">
                    <strong>{escape(section['callout']['title'])}</strong>
                    <p>{escape(section['callout']['body'])}</p>
                </div>
            """
        sections_html.append(
            f"""
            <section class="blog-section reveal" id="{anchor}">
                <h2>{escape(section['heading'])}</h2>
{paragraphs}
{bullets}
{callout}
            </section>
            """
        )

    faq_html = "\n".join(
        f"""
                <div class="blog-faq-card reveal">
                    <h3>{escape(item['question'])}</h3>
                    <p>{escape(item['answer'])}</p>
                </div>
        """
        for item in variant["faqs"]
    )

    related_html = "\n".join(
        f"""
                <a class="blog-related-card reveal" href="{escape(item['href'])}">
                    <span class="blog-related-label">{escape(item['label'])}</span>
                    <p>{escape(item['description'])}</p>
                    <span class="blog-related-link">{escape(cfg['related_link_label'])} <i class="fa-solid fa-arrow-right"></i></span>
                </a>
        """
        for item in variant["relatedLinks"]
    )

    toc_html = "\n".join(
        f'                    <a href="#{escape(anchor)}">{escape(heading)}</a>'
        for anchor, heading in headings
    )
    best_for_html = "\n".join(f"                    <li>{escape(item)}</li>" for item in variant["bestFor"])
    chips_html = "".join(
        f'<span class="blog-chip">{escape(chip)}</span>' for chip in variant.get("chips", [])
    )

    head = render_head(
        locale=locale,
        title=variant["pageTitle"],
        description=variant["description"],
        canonical=article_url(locale, variant["slug"]),
        alternate_en=article_url("en", post["locales"]["en"]["slug"]),
        alternate_es=article_url("es", post["locales"]["es"]["slug"]),
        og_type="article",
        asset_prefix=asset_prefix,
        structured_data=structured_data,
    )

    return f"""{head}
<body>
    <div class="ambient-canvas"></div>
    {render_nav(locale, lang_toggle_href)}
    <section class="section blog-hero" style="padding-top: 10rem;">
        <div class="container blog-shell">
            <span class="hero-eyebrow blog-kicker">{escape(variant['eyebrow'])}</span>
            <h1>{escape(variant['title'])}</h1>
            <p class="blog-hero-copy">{escape(variant['heroSubtitle'])}</p>
            <div class="blog-meta">
                <span>{escape(variant['readTime'])}</span>
                <span>&bull;</span>
                <span>{escape(cfg['updated_prefix'])} {escape(variant['updatedLabel'])}</span>
            </div>
            <div class="blog-chip-row">{chips_html}</div>
        </div>
    </section>

    <section class="section" style="padding-top: 2rem;">
        <div class="container blog-shell blog-article-grid">
            <aside class="blog-rail">
                <div class="blog-rail-card reveal">
                    <span class="blog-rail-label">{escape(cfg['pain_label'])}</span>
                    <p>{escape(variant['painPoint'])}</p>
                </div>
                <div class="blog-rail-card reveal">
                    <span class="blog-rail-label">{escape(cfg['best_for_label'])}</span>
                    <ul class="blog-rail-list">
{best_for_html}
                    </ul>
                </div>
                <div class="blog-rail-card reveal">
                    <span class="blog-rail-label">{escape(cfg['toc_label'])}</span>
{toc_html}
                </div>
                <a class="btn btn-primary blog-rail-cta" href="{escape(variant['cta']['primaryHref'])}">{escape(variant['cta']['primaryLabel'])}</a>
                <a class="blog-rail-secondary" href="{escape(variant['cta']['secondaryHref'])}">{escape(variant['cta']['secondaryLabel'])}</a>
            </aside>

            <article class="blog-article">
                <div class="blog-summary-card reveal">
                    <strong>{escape(cfg['summary_label'])}</strong>
                    <p>{escape(variant['quickSummary'])}</p>
                </div>
{''.join(sections_html)}
            </article>
        </div>
    </section>

    <section class="section">
        <div class="container blog-shell">
            <div class="blog-cta-card reveal">
                <span class="hero-eyebrow blog-kicker">{escape(variant['cta']['eyebrow'])}</span>
                <h2>{escape(variant['cta']['title'])}</h2>
                <p>{escape(variant['cta']['body'])}</p>
                <div class="blog-cta-actions">
                    <a class="btn btn-primary" href="{escape(variant['cta']['primaryHref'])}">{escape(variant['cta']['primaryLabel'])}</a>
                    <a class="btn btn-secondary" href="{escape(variant['cta']['secondaryHref'])}">{escape(variant['cta']['secondaryLabel'])}</a>
                </div>
            </div>
        </div>
    </section>

    <section class="section blog-faq-section">
        <div class="container blog-shell">
            <div class="section-header" style="margin-bottom: 2rem;">
                <span class="hero-eyebrow blog-kicker">{escape(cfg['faq_title'])}</span>
                <h2>{escape(variant['faqHeading'])}</h2>
            </div>
            <div class="blog-faq-grid">
{faq_html}
            </div>
        </div>
    </section>

    <section class="section" style="padding-top: 2rem;">
        <div class="container blog-shell">
            <div class="section-header" style="margin-bottom: 2rem;">
                <span class="hero-eyebrow blog-kicker">{escape(cfg['related_title'])}</span>
                <h2>{escape(variant['relatedHeading'])}</h2>
            </div>
            <div class="blog-related-grid">
{related_html}
            </div>
        </div>
    </section>
    {render_footer(locale)}
    <script src="{asset_prefix}script.js"></script>
</body>
</html>
"""


def render_index(posts: list[dict], locale: str) -> str:
    cfg = LOCALE_CONFIG[locale]
    asset_prefix = cfg["asset_prefix"]
    lang_toggle_href = f"{cfg['lang_toggle_path']}/"
    sorted_posts = sorted(
        posts,
        key=lambda item: (
            0 if item.get("featured") else 1,
            item["locales"][locale]["dateModified"],
        ),
        reverse=False,
    )
    featured = sorted_posts[0]
    cards = []
    for post in sorted_posts:
        variant = post["locales"][locale]
        cards.append(
            f"""
                <a class="blog-card reveal" href="{escape(variant['slug'])}">
                    <span class="blog-card-tag">{escape(variant['eyebrow'])}</span>
                    <h3>{escape(variant['title'])}</h3>
                    <p>{escape(variant['cardSummary'])}</p>
                    <div class="blog-card-meta">
                        <span>{escape(variant['readTime'])}</span>
                        <span>{escape(cfg['updated_prefix'])} {escape(variant['updatedLabel'])}</span>
                    </div>
                </a>
            """
        )

    featured_variant = featured["locales"][locale]
    cluster_cards = "\n".join(
        f"""
                <div class="blog-cluster-card reveal">
                    <h3>{escape(card['title'])}</h3>
                    <p>{escape(card['body'])}</p>
                </div>
        """
        for card in cfg["hub_cluster_cards"]
    )

    structured_data = json.dumps(
        {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "CollectionPage",
                    "name": cfg["hub_title"],
                    "description": cfg["hub_description"],
                    "url": index_url(locale),
                    "inLanguage": cfg["locale_tag"],
                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {
                            "@type": "ListItem",
                            "position": 1,
                            "name": cfg["breadcrumbs"][0],
                            "item": f"{SITE_DOMAIN}/{'es/' if locale == 'es' else ''}",
                        },
                        {
                            "@type": "ListItem",
                            "position": 2,
                            "name": cfg["breadcrumbs"][1],
                            "item": index_url(locale),
                        },
                    ],
                },
            ],
        },
        ensure_ascii=False,
    )

    head = render_head(
        locale=locale,
        title=f"{cfg['hub_title']}{cfg['meta_description_suffix']}",
        description=cfg["hub_description"],
        canonical=index_url(locale),
        alternate_en=index_url("en"),
        alternate_es=index_url("es"),
        og_type="website",
        asset_prefix=asset_prefix,
        structured_data=structured_data,
    )

    return f"""{head}
<body>
    <div class="ambient-canvas"></div>
    {render_nav(locale, lang_toggle_href)}

    <section class="section blog-index-hero" style="padding-top: 10rem;">
        <div class="container blog-shell">
            <span class="hero-eyebrow blog-kicker">{escape(cfg['hub_eyebrow'])}</span>
            <h1>{escape(cfg['hub_title'])}</h1>
            <p class="blog-hero-copy">{escape(cfg['hub_description'])}</p>
            <div class="blog-chip-row">
                {''.join(f'<span class="blog-chip">{escape(chip)}</span>' for chip in cfg['hub_chips'])}
            </div>
        </div>
    </section>

    <section class="section" style="padding-top: 2rem;">
        <div class="container blog-shell">
            <div class="blog-featured-card reveal">
                <div>
                    <span class="blog-card-tag">{escape(cfg['hub_featured_label'])}</span>
                    <h2>{escape(featured_variant['title'])}</h2>
                    <p>{escape(featured_variant['cardSummary'])}</p>
                    <div class="blog-card-meta">
                        <span>{escape(featured_variant['readTime'])}</span>
                        <span>{escape(cfg['updated_prefix'])} {escape(featured_variant['updatedLabel'])}</span>
                    </div>
                </div>
                <div class="blog-featured-actions">
                    <a class="btn btn-primary" href="{escape(featured_variant['slug'])}">{escape(cfg['featured_primary_label'])}</a>
                    <a class="btn btn-secondary" href="../demo">{escape(cfg['hub_cta_primary'])}</a>
                </div>
            </div>
        </div>
    </section>

    <section class="section">
        <div class="container blog-shell">
            <div class="blog-card-grid">
{''.join(cards)}
            </div>
        </div>
    </section>

    <section class="section">
        <div class="container blog-shell">
            <div class="section-header" style="margin-bottom: 2rem;">
                <span class="hero-eyebrow blog-kicker">{escape(cfg['hub_cluster_title'])}</span>
                <h2>{escape(cfg['hub_cluster_title'])}</h2>
            </div>
            <div class="blog-cluster-grid">
{cluster_cards}
            </div>
        </div>
    </section>

    <section class="section">
        <div class="container blog-shell">
            <div class="blog-cta-card reveal">
                <span class="hero-eyebrow blog-kicker">RateTap</span>
                <h2>{escape(cfg['hub_cta_title'])}</h2>
                <p>{escape(cfg['hub_cta_body'])}</p>
                <div class="blog-cta-actions">
                    <a class="btn btn-primary" href="../demo">{escape(cfg['hub_cta_primary'])}</a>
                    <a class="btn btn-secondary" href="{escape(cfg['hub_cta_secondary_href'])}">{escape(cfg['hub_cta_secondary'])}</a>
                </div>
            </div>
        </div>
    </section>
    {render_footer(locale)}
    <script src="{asset_prefix}script.js"></script>
</body>
</html>
"""


def validate_posts(posts: list[dict]) -> None:
    required_variant_fields = {
        "slug",
        "pageTitle",
        "title",
        "description",
        "eyebrow",
        "heroSubtitle",
        "readTime",
        "updatedLabel",
        "painPoint",
        "bestFor",
        "quickSummary",
        "sections",
        "faqs",
        "faqHeading",
        "relatedLinks",
        "relatedHeading",
        "cta",
        "cardSummary",
        "datePublished",
        "dateModified",
    }
    seen_paths: set[str] = set()
    for post in posts:
        if post.get("status") != "publish":
            continue
        if "targetKeyword" not in post:
            raise ValueError(f"Post {post.get('id')} is missing targetKeyword")
        for locale in ("en", "es"):
            variant = post["locales"][locale]
            missing = sorted(required_variant_fields - set(variant.keys()))
            if missing:
                raise ValueError(f"Post {post.get('id')} locale {locale} missing fields: {', '.join(missing)}")
            path = f"{locale}:{variant['slug']}"
            if path in seen_paths:
                raise ValueError(f"Duplicate slug detected: {path}")
            seen_paths.add(path)


def build_sitemap_entries(posts: list[dict]) -> str:
    blocks = [GENERATED_SITEMAP_START]
    for locale in ("en", "es"):
        url = index_url(locale)
        alternate_en = index_url("en")
        alternate_es = index_url("es")
        blocks.append(
            f"""  <url>
    <loc>{url}</loc>
    <xhtml:link rel="alternate" hreflang="en-US" href="{alternate_en}"/>
    <xhtml:link rel="alternate" hreflang="es-MX" href="{alternate_es}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="{alternate_en}"/>
    <lastmod>{datetime.now(UTC).date().isoformat()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
  </url>"""
        )

    for post in posts:
        if post.get("status") != "publish":
            continue
        en_variant = post["locales"]["en"]
        es_variant = post["locales"]["es"]
        for locale in ("en", "es"):
            variant = post["locales"][locale]
            blocks.append(
                f"""  <url>
    <loc>{article_url(locale, variant['slug'])}</loc>
    <xhtml:link rel="alternate" hreflang="en-US" href="{article_url('en', en_variant['slug'])}"/>
    <xhtml:link rel="alternate" hreflang="es-MX" href="{article_url('es', es_variant['slug'])}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="{article_url('en', en_variant['slug'])}"/>
    <lastmod>{variant['dateModified']}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.75</priority>
  </url>"""
            )
    blocks.append(GENERATED_SITEMAP_END)
    return "\n".join(blocks)


def update_sitemap(posts: list[dict]) -> None:
    sitemap_text = SITEMAP_PATH.read_text(encoding="utf-8")
    generated_block = build_sitemap_entries(posts)
    pattern = re.compile(
        rf"{re.escape(GENERATED_SITEMAP_START)}.*?{re.escape(GENERATED_SITEMAP_END)}\n?",
        re.DOTALL,
    )
    sitemap_text = re.sub(pattern, "", sitemap_text)
    sitemap_text = sitemap_text.replace("</urlset>", f"{generated_block}\n</urlset>")
    SITEMAP_PATH.write_text(sitemap_text, encoding="utf-8")


def write_posts(posts: list[dict]) -> list[Path]:
    generated_paths: list[Path] = []
    for locale in ("en", "es"):
        index_destination = index_file(locale)
        index_destination.parent.mkdir(parents=True, exist_ok=True)
        published_posts = [post for post in posts if post.get("status") == "publish"]
        index_destination.write_text(render_index(published_posts, locale), encoding="utf-8")
        generated_paths.append(index_destination)

        for post in published_posts:
            variant = post["locales"][locale]
            destination = article_file(locale, variant["slug"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(render_post(post, locale), encoding="utf-8")
            generated_paths.append(destination)
    return generated_paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Build static blog pages and sitemap entries.")
    parser.add_argument("--check", action="store_true", help="Validate content without writing files.")
    args = parser.parse_args()

    payload = load_content()
    posts = payload["posts"]
    validate_posts(posts)

    if args.check:
        published = [post for post in posts if post.get("status") == "publish"]
        print(f"Validated {len(published)} published post clusters across 2 locales.")
        return

    generated = write_posts(posts)
    update_sitemap(posts)
    print("Generated blog pages:")
    for path in generated:
        print(f" - {path.relative_to(ROOT)}")
    print("Updated sitemap.xml")


if __name__ == "__main__":
    main()
