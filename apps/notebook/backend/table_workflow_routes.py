"""Authenticated HTTP composition delegates table and collection transitions to their owners."""
import re
from catalog_archive import MissingCatalogRecord


def table_workflow_route(collections, workflows, archives, method, path, read_body):
    if path == '/api/template-collections':
        if method == 'GET':
            return 200, collections.read()
        if method == 'POST':
            return 200, collections.apply(read_body())
    if path == '/api/template-collections/history' and method == 'GET':
        return 200, {'history': collections.history()}
    match = re.fullmatch(r'/api/template-collections/revisions/([0-9]+)', path)
    if match and method == 'GET':
        return 200, collections.read(int(match[1]))
    match = re.fullmatch(r'/api/entries/([a-f0-9]{32})/table-workflows/([A-Za-z0-9_-]{1,128})(?:/(preview|apply))?', path)
    if match:
        entry_id, identity, action = match.groups()
        if method == 'GET' and action is None:
            return 200, workflows.read(entry_id, identity)
        if method == 'POST':
            operation = workflows.preview if action == 'preview' else workflows.apply if action == 'apply' else workflows.configure
            return 200, operation(entry_id, identity, read_body())
    match = re.fullmatch(r'/api/catalog/records/([A-Za-z0-9_-]{1,128})(/archive)?', path)
    if match:
        try:
            if method == 'GET' and not match[2]:
                return 200, archives.read(match[1])
            if method == 'POST' and match[2]:
                return 200, archives.apply(match[1], read_body())
        except MissingCatalogRecord as error:
            return 404, dict(error=str(error), detail=str(error), code='not-found')
    return None
