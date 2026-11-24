export const browserSnapshotPage = `<!doctype html><html lang="en"><title>Snapshot comparison</title>
<main><h1>Project review</h1>
<section aria-label="Draft"><h2>Draft</h2><label>Title <input value="Spec A"></label><button>Apply</button></section>
<section aria-label="Published"><h2>Published</h2><button disabled>Apply</button></section>
<table><caption>Runs</caption><thead><tr><th scope="col">Name</th><th scope="col">State</th></tr></thead><tbody><tr><th scope="row">A</th><td>Ready</td></tr></tbody></table>
<div role="status">Waiting</div>
<iframe title="Details" src="/details"></iframe>
</main><script>document.querySelector('button').onclick = (event) => {document.querySelector('[role=status]').textContent = 'Applied; trusted = ' + event.isTrusted;};</script>`;

export const browserSnapshotFrame = '<!doctype html><title>Details</title><main><h2>Run details</h2><button>Inspect</button></main>';

// Codex in-app browser playwright.domSnapshot() on this fixture.
export const browserSnapshotTree = `- main:
  - heading "Project review" [level=1]
  - region "Draft":
    - heading "Draft" [level=2]
    - text: Title
    - textbox "Title": Spec A
    - button "Apply"
  - region "Published":
    - heading "Published" [level=2]
    - button "Apply" [disabled]
  - table "Runs":
    - caption: Runs
    - rowgroup:
      - row "Name State":
        - columnheader "Name"
        - columnheader "State"
    - rowgroup:
      - row "A Ready":
        - rowheader "A"
        - cell "Ready"
  - status: Waiting
  - iframe:
    - main:
      - heading "Run details" [level=2]
      - button "Inspect"`;
