"""Opt-in Chromium renderer acceptance; synthetic fixture, not full Desktop.

Requires Playwright in the test interpreter and an installed Chromium executable.
No remote page, model or package download occurs during this script.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from paper_agent.arxiv_html import parse_arxiv_html
from paper_agent.document_html import render_document


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', required=True, help='Installed Chromium executable')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    from playwright.sync_api import sync_playwright
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    fixture = Path(__file__).resolve().parents[1] / 'fixtures/scientific-document.html'
    document = parse_arxiv_html(fixture.read_bytes(), 'https://arxiv.org/html/2606.03979v2')
    page_file = output / 'reader.html'
    page_file.write_text(render_document(document), encoding='utf-8')
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True,
                                             args=['--no-sandbox'])
        try:
            for name, width, scheme in [('light', 1280, 'light'), ('dark', 1280, 'dark'), ('narrow', 390, 'light')]:
                page = browser.new_page(viewport={'width': width, 'height': 1000}, color_scheme=scheme)
                requests, errors = [], []
                page.on('request', lambda request: requests.append(request.url))
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.set_content(page_file.read_text(encoding='utf-8'))
                assert page.locator('h1').inner_text() == document.title
                assert page.locator('math').count() >= 2
                assert page.locator('math').first.bounding_box()['height'] > 0
                assert page.locator('th[colspan="2"]').count() == 1
                assert '−1.20' in page.locator('table').inner_text()
                page.locator('nav summary').click()
                target = page.locator('nav a').first.get_attribute('href')
                assert page.locator(target).count() == 1
                page.locator('header summary').click()
                assert document.source.digest in page.locator('header').inner_text()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert not errors, errors
                assert not requests, requests
                page.screenshot(path=str(output / (name + '.png')), full_page=True)
                results.append(dict(name=name, width=width, colorScheme=scheme,
                                    requests=requests, pageErrors=errors, passed=True))
                page.close()
            version = browser.version
        finally:
            browser.close()
    result = dict(scope='Chromium set_content renderer; synthetic source, not HTTP, Desktop or real arXiv',
                  chromium=version, documentId=document.id, results=results)
    (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
