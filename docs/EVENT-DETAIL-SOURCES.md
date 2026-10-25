# Event detail maintenance

The summary feed does not contain bonus details for most events. The versioned
runtime includes a checked source snapshot. It resolves reviewed official rules
first, then explicit bonus sections on the exact Leek Duck event detail page,
then the last known checked details. Native Spotlight/Community Day feed fields
remain a runtime fallback. Source HTML is never executed or injected in the app.

Every enriched bonus field records its URL, successful check time, source hash
and fallback failures. Rank, ticket, time and starred restrictions are retained.
Unknown is not equivalent to no bonuses or unannounced. Raid rotations show
featured bosses instead of an empty bonus panel. Non-English UI labels clearly
identify English source details. Source checks older than 48 hours are labeled.
The main summary feed retains its separate two-hour freshness indicator.

Run `python3 scripts/events/refresh-event-details.py --output candidate.json`
to generate a bounded next-32-day candidate from public sources. Review current
records and constraints, then use `--write` to update both data/event-details.json
and the embedded runtime record. This avoids adding a browser CORS dependency,
CSP exception or paid service. Test with
`python3 tests/events-source-pipeline.test.py` and the Events browser checks.

The read-only GitHub workflow checks daily at 08:35 UTC and offers manual runs.
It uploads a candidate and coverage summary, **not an automatic publication**.
It cannot change repository content or deploy. A tested release is still needed
to refresh the bundled details. Automated content publication would need a
separately reviewed release integration; it is not claimed by this change.

If all sources fail, old successful timestamps are retained. Missing/changed
reviewed evidence cannot become newly verified. A failed live summary feed uses
cached data first, then the bundled dated feed, with a stale indicator. No account
or private list data enters these requests. ScrapedDuck and Leek Duck attribution
remains in the app; the app is free, with no advertising or paid content access.
