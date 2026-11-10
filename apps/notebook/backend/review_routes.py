"""HTTP mapping for the local review domain; no transition rules live here."""

import re

from reviews import MissingReviewObject, ReviewConflict


REVIEW_PATH = re.compile(r'/api/entries/([a-f0-9]{32})/review-workspace')


def review_route(reviews, method, path, read_body):
    """Return (status, JSON) for this route, or None without reading another route's body."""
    match = REVIEW_PATH.fullmatch(path)
    if not match or method not in ('GET', 'POST'):
        return None
    try:
        return (200, reviews.read(match[1]) if method == 'GET' else reviews.apply(match[1], read_body()))
    except ReviewConflict as error:
        return 409, {'error': str(error), 'detail': str(error), 'code': 'review-conflict', 'currentVersion': error.current_version}
    except MissingReviewObject as error:
        return 404, {'error': str(error), 'detail': str(error), 'code': 'not-found'}
