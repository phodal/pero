---
kind: issue
status: resolved
---

# Literature search failed while encoding an unpaired surrogate

Searching “harness” across alphaXiv, OpenAlex, bioRxiv and PubMed returned
HTTP 400 `request_invalid`. The request itself was valid. A provider JSON
string contained the unpaired UTF-16 surrogate U+D835. Python’s `json.loads`
keeps that code point, and `canonical()` then refuses to encode it as UTF-8.
The failure was reported for the whole search, so one bad character dropped
every source.

Valid surrogate pairs, such as mathematical italic letters, were already
decoded to real Unicode scalars and must stay intact. Only unpaired
surrogates are replaced with U+FFFD at the literature response boundary,
before search results are encoded.
