# Goodreads scraping feasibility — 11 October 2026

Draft evidence collection in progress. Direct anonymous HTML exposed usable work
ratings for The Hunger Games and The Way of Kings, but the next three book pages
were blocked with HTTP 202. Warbreaker returned a different edition ISBN and was
rejected. An isolated headless browser also received HTTP 202. No production
data, collector circuit, background schedule or mobile code was changed.

The temporary PR-only workflow performs two anonymous requests (robots and one
book page) on a public GitHub Actions runner to compare environments. It will
be removed from the final diff after its result is recorded. The final report
will include all controlled targets, dataset findings and validation boundaries.
