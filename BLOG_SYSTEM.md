# Blog System

This repo now has a generator-driven blog for high-intent restaurant reputation topics.

## Files

- `content/blog/posts.json`
  Source of truth for published article clusters and localized copy.
- `scripts/build_blog.py`
  Builds `blog/*.html`, `es/blog/*.html`, both blog hub pages, and injects blog URLs into `sitemap.xml`.

## Workflow

1. Add or edit a post cluster in `content/blog/posts.json`.
2. Keep both locales aligned by intent, not necessarily by literal sentence structure.
3. Run:

```bash
python3 scripts/build_blog.py --check
python3 scripts/build_blog.py
```

## Publishing Guardrails

This system is designed for useful, operator-grade pages, not bulk filler.

- Every post should target one real operating pain and one clear outcome.
- Keep examples grounded in restaurant operations you actually understand.
- Do not ship thin keyword variants that all resolve to the same answer.
- Do not auto-translate and publish without review.
- Visible page content should match the structured data on the page.

Relevant Google guidance:

- [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Spam policies for Google web search](https://developers.google.com/search/docs/essentials/spam-policies)
- [Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article)
- [General structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [FAQ structured data availability](https://developers.google.com/search/docs/appearance/structured-data/faqpage)

## Notes

- The generated articles use `BlogPosting` and `BreadcrumbList`.
- The FAQ sections are visible on-page, but the generator does not emit `FAQPage` markup because Google currently limits FAQ rich results to a narrow set of site types.
- `sitemap.xml` keeps the existing manual entries and appends a generated blog block on each build.
