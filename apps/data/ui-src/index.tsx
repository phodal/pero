import { useEffect, useRef, useState } from 'react';
import { AppFrame, Button, EmptyState, Feedback, FilePicker, SearchField } from '@pero/app-sdk/ui';
import { chartEligible, formatInt, IMPORT_LIMIT, parseImported, visibleAssets, type Asset, type PreviewMode } from './model';
import { Preview } from './preview';
import { seedAssets } from './sample';
import './styles.css';

const initial = seedAssets();

export default function Data() {
  const dialog = useRef<HTMLDialogElement>(null);
  const nextId = useRef(1);
  const [assets, setAssets] = useState(initial);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? '');
  const [mode, setMode] = useState<PreviewMode>('chart');
  const [picker, setPicker] = useState(0);
  const [error, setError] = useState('');
  const visible = visibleAssets(assets, query);
  const selected = assets.find(asset => asset.id === selectedId) ?? null;

  useEffect(() => {
    const element = dialog.current;
    if (!element?.open) return;
    element.querySelector<HTMLButtonElement>('.pero-ui-file-picker button')?.focus();
  }, [picker]);

  function select(asset: Asset) {
    setSelectedId(asset.id);
    setMode(chartEligible(asset) ? 'chart' : 'rows');
  }

  function openAdd() {
    setError('');
    setPicker(value => value + 1);
    dialog.current?.showModal();
  }

  async function addFile(file: File) {
    setError('');
    if (file.size > IMPORT_LIMIT) {
      setError('File is larger than 5 MiB.');
      return;
    }
    try {
      const parsed = parseImported(file.name, await file.text());
      const number = nextId.current++;
      const asset: Asset = {
        id: `import-${number}`, name: file.name, kind: parsed.kind, format: parsed.format,
        source: 'Local files', description: '', updated: 'Just now', updatedRank: 100 + number,
        rows: parsed.rows, units: {},
      };
      setAssets(current => [asset, ...current]);
      setSelectedId(asset.id);
      setMode(chartEligible(asset) ? 'chart' : 'rows');
      setQuery('');
      dialog.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read this file.');
    }
  }

  return <AppFrame className="data-page" label="Data" actions={<Button variant="primary" onClick={openAdd}>Add data</Button>}>
    <div className="data-split">
      <section className="data-list" aria-label="Datasets">
        <div className="data-tools">
          <SearchField aria-label="Search data" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="data-table-scroll">
          {visible.length ? <table className="data-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Records</th><th scope="col">Source</th><th scope="col">Updated</th></tr></thead>
            <tbody>{visible.map(asset => <tr key={asset.id} aria-selected={asset.id === selectedId} onClick={() => select(asset)}>
              <td><button type="button" aria-pressed={asset.id === selectedId} onClick={() => select(asset)}>{asset.name}</button></td>
              <td>{asset.kind}</td>
              <td>{formatInt(asset.rows.length)}</td>
              <td>{asset.source}</td>
              <td>{asset.updated}</td>
            </tr>)}</tbody>
          </table> : <EmptyState heading="No matches" description="Try another name, field, or source." />}
        </div>
      </section>
      <Preview asset={selected} mode={mode} onMode={setMode} />
    </div>
    <dialog ref={dialog} className="data-add" aria-labelledby="data-add-title" {...{ closedby: 'any' }}>
      <form method="dialog">
        <header>
          <h2 id="data-add-title">Add data</h2>
          <Button type="submit" variant="ghost" value="cancel">Close</Button>
        </header>
        <p>CSV, TSV, JSON, or JSONL. Up to 5 MiB and 10,000 rows.</p>
        {error ? <Feedback kind="error">{error}</Feedback> : null}
        <FilePicker key={picker} label="Choose file" emptyLabel="No file chosen" accept=".csv,.tsv,.json,.jsonl,.ndjson,text/csv,text/tab-separated-values,application/json" onFile={file => { void addFile(file); }} />
      </form>
    </dialog>
  </AppFrame>;
}
