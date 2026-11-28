# Task Inbox fixture

Run `python3 api.py /absolute/path/inbox.db`. The service prints its loopback port.
The baseline supports `POST /tasks` with a JSON title and `GET /tasks`.

## Feature request

Implement task archive and restore end to end in `api.py` and `store.py`.

- `POST /tasks/{positive integer id}/archive` and `POST /tasks/{id}/restore`
  accept an empty body and return 200 with the current task's `id`, `title`,
  and boolean `archived`. Repeating an action returns the same task state.
  Unknown IDs and malformed action routes return 404.
- `GET /tasks` and `GET /tasks?view=active` list active tasks.
  `view=archived` lists archived tasks and `view=all` lists both.
  Preserve ID order and return an `archived` boolean for every item.
  Invalid or repeated view values return 400.
- `POST /tasks` keeps its existing title validation and creates active tasks.
  It returns the new item with `archived: false`.
- Preserve existing SQLite rows and IDs. Existing rows are active when the
  service first opens a pre-feature database. Archive state survives restarts.
