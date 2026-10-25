# Event source maintenance

The browser reads the permitted ScrapedDuck summary feed. Missing bonus details
come from a versioned factual catalog in data/event-details.json. The current
catalog includes 15 reviewed records. Preserve source references, verification
dates, ticket/rank conditions, exclusions and bonus-specific time windows.

The follow-on removes all automated detail-HTML fetching. The refresh command
accepts only the exact ScrapedDuck feed URL. Neither Leek Duck nor official
announcement pages are fetched by automation. Existing source links are for
human fact verification; no downstream HTML-scraping permission is asserted.

Run `python3 scripts/events/refresh-event-details.py --output candidate.json` to
refresh the feed candidate while preserving detail verification dates. `--write`
updates the versioned bundled catalog and embedded runtime. It does not reverify
the curated bonus facts. Verify/correct facts manually before a tested release.

The read-only workflow is scheduled daily at 08:35 UTC. It refreshes only the
permitted feed and creates a review candidate, never publishes. Non-PR runs do
not install browsers. Failed requests cannot become successful detail checks.
The runtime marks detail records older than 48 hours as last-known; a successful
feed refresh never updates those separate detail timestamps. Cached/bundled feed
fallback and native Spotlight/Community Day detail fields remain available.

Small visible Events footer links credit ScrapedDuck and Leek Duck. Individual
facts link to their source, with detailed provenance in the event detail view.
Factual eligibility and timing caveats remain visible beside benefits.

## Future commercial use

Current ScrapedDuck conditions exclude ads and paywalls and require credit to
ScrapedDuck and Leek Duck. The present app remains free. Before monetization,
obtain suitable commercial permission or replace that dependency with a licensed
alternative. Permission for the feed does not establish permission for direct
HTML extraction from Leek Duck or official sites. No provider outreach or new
paid source integration has been performed. Keep the normalized event/bonus
records independent of their provider so a later approved replacement does not
require redesigning the event cards.
