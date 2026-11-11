"""Readable offline evidence dossier; the existing QualityPacket owns grading."""
from html import escape
import json

from research_quality import QualityPacket


def render_review(packet: QualityPacket):
    value = packet.value

    def text(item):
        return escape(str(item))

    def records(title, rows):
        return '<section><h2>' + title + '</h2>' + ''.join(
            '<details><summary>' + text(row.get('title') or row.get('id') or row.get('question') or title)
            + '</summary><pre>' + text(json.dumps(row, indent=2, ensure_ascii=False)) + '</pre></details>'
            for row in rows) + '</section>'

    sources = {source['id']: source for source in value['sources']}
    claims = []
    for claim in value['claims']:
        source = sources.get(claim['sourceId'])
        # The collector creates this relative path from the retained original's hash.
        link = ('<a href="' + text(source['file']) + '#page=' + text(claim['page']) + '">'
                + text(source['title']) + ' · page ' + text(claim['page']) + '</a>') if source else 'Original unavailable'
        claims.append('<article><h3>' + text(claim['id']) + ' · Round ' + text(claim['round']) + '</h3>'
            + '<p class="tag">' + text(claim['stance']) + ' · '
            + ('Exact citation matched' if claim['citationVerified'] else 'Citation verification failed') + '</p>'
            + '<p>' + text(claim['text']) + '</p><blockquote>' + text(claim['quote']) + '</blockquote><p>' + link + '</p>'
            + '<details><summary>Observed passage and saved report identity</summary><pre>'
            + text(claim['observedText'] or 'No observed passage') + '</pre><p>Report: <code>' + text(claim['reportId'])
            + '</code></p><p>Passage: <code>' + text(claim.get('passageId')) + '</code></p></details></article>')
    original_links = ''.join('<li><a href="' + text(s['file']) + '">' + text(s['title'])
        + '</a><p>Observed pages: ' + text(', '.join(map(str, s['observedPages'])))
        + '</p><small>SHA-256: ' + text(s['sha256']) + '</small></li>' for s in sources.values())
    errors = '<ul>' + ''.join('<li>' + text(error) + '</li>' for error in value['integrityErrors']) + '</ul>'
    return '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Independent research review</title>
<style>
:root{color-scheme:light dark;font:16px/1.65 system-ui;color:#263849;background:#f3f6f8}
body{max-width:960px;margin:0 auto;padding:32px 24px 80px}h1,h2,h3{line-height:1.3}
h1{font-size:2rem}h2{margin-top:36px}p,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}
article,details,li{overflow-wrap:anywhere}article{background:#fff;border:1px solid #c8d5dd;border-radius:12px;padding:22px;margin:16px 0}
.notice{background:#fff3d5;border-left:4px solid #977024;padding:16px}.tag{font-size:.88rem;color:#526675}
blockquote{margin:16px 0;padding:12px 18px;background:#eff5f8;border-left:3px solid #548195}
details{margin:12px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
a{color:#15648d}a:focus-visible,summary:focus-visible{outline:3px solid #ba6c1e;outline-offset:4px}small,code{overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){:root{color:#e0e9ee;background:#17232d}article{background:#202f3a;border-color:#4c6575}.tag{color:#b0c5d2}blockquote{background:#263d4a}.notice{background:#3e3420}a{color:#8bcdea}}
@media(max-width:600px){body{padding:20px 14px}article{padding:16px}}
</style><body><header><p>Independent evidence review</p><h1>''' + text(value['protocol']['question']) + '''</h1>
<p class="notice">Unreviewed. Exact citation matching establishes location only. An independent human must inspect originals,
judge entailment, check omitted counterevidence and review the complete final answer before any scientific acceptance.</p>
<nav><a href="#claims">Claims</a> · <a href="#originals">Originals</a> · <a href="#final">Final answer</a> ·
<a href="packet.json">Frozen packet</a> · <a href="review-template.json">Blank review form</a></nav></header>
<section><h2>Run and integrity</h2><p>Case: ''' + text(value['caseId']) + ' · Mode: ' + text(value['run']['mode']) + '''</p>
<p>Packet SHA-256: <code>''' + text(value['sha256']) + '</code></p>' + errors + '<pre>' + text(json.dumps(value['run'], indent=2, ensure_ascii=False)) + '</pre></section>' + records('Registered requirements', value['requirements']) + records('Expected source versions', value['referenceSources']) + '''
<section id="claims"><h2>Claims to review</h2>''' + (''.join(claims) or '<p>No completed round claims. Inspect retained reports and the final answer below.</p>') + '''</section>
<section id="originals"><h2>Retained originals</h2><ul>''' + original_links + '</ul></section>' + records('Complete saved reports', value['reports']) + records('Gaps and next actions', value['nextActions']) + '''
<section id="final"><h2>Final assistant answer</h2><pre>''' + text(value['finalAssistantText'] or 'No final assistant text was recorded.') + '''</pre></section>
<section><h2>Complete the independent review</h2><p>Save a copy of the blank form as review.json. Inspect each original, fill every verdict and rationale,
and record all material errors or omissions, including assertions outside the claim list. Keep the packet hash unchanged.</p>
<p>From this quality directory, run the repository's scorer using its absolute script path:</p>
<pre>python /path/to/pero/tests/runtime/paper-program-quality.py score packet.json review.json --output score.json</pre>
<p>This dossier does not submit a review, assign scientific scores or modify the saved evidence.</p></section></body></html>'''
