import { useState } from 'react';
import { ContentPane, ContentSection, InspectorHeader, LibraryHeader, ListRow, MetadataList, SearchField, contentLayout } from '../src';
import { Button } from '../../app-sdk/src/components/button';
import { Split, SplitPane } from '../../app-sdk/src/components/split';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../app-sdk/src/components/tabs';

/** Reference compositions. They are catalog examples, not a second runtime. */
export function ContentPanesExample() {
  const [selected, setSelected] = useState('batch-7');
  const [query, setQuery] = useState('');
  const rows = ['batch-7', 'plate-map'].filter(name => name.includes(query.trim().toLowerCase()));
  return <>
    <section>
      <h2>Explorer</h2>
      <p className="catalog-muted">Search, filters, and the resource list stay in the list pane. Row and figure preview use the wide workspace. Properties stay in the inspector ({contentLayout.inspectorWidth} / min {contentLayout.inspectorMin}).</p>
      <div className="catalog-pane-frame">
        <Split collapseBelow={contentLayout.collapseBelow}>
          <SplitPane id="explorer-list" as="section" aria-label="Example datasets" size={contentLayout.listSize} min={contentLayout.listMin}>
            <ContentPane id="explorer-catalog" label="Datasets" as="div" surface="list" inset="compact" scroll="pane"
              header={<LibraryHeader density="compact" title="Datasets" subtitle={String(rows.length)} />}
              toolbar={<SearchField aria-label="Search datasets" placeholder="Search datasets" value={query} onChange={event => setQuery(event.target.value)} />}>
              {rows.map(name => <ListRow key={name} title={name} meta="CSV" current={selected === name} onOpen={() => setSelected(name)} />)}
            </ContentPane>
          </SplitPane>
          <SplitPane id="explorer-preview" as="section" aria-label="Preview" min={contentLayout.mainMin}>
            <ContentPane id="explorer-preview-content" label="Preview" as="div" surface="workspace" inset="none" scroll="content">
              <div className="catalog-scroll-owner">Table, schema, and figure preview own this scroll. {selected}</div>
            </ContentPane>
          </SplitPane>
          <SplitPane id="explorer-inspector" as="aside" aria-label="Properties" size={contentLayout.inspectorWidth} min={contentLayout.inspectorMin}>
            <ContentPane id="explorer-inspector-content" label={selected} as="div" surface="reading" inset="compact" scroll="pane"
              header={<InspectorHeader title={selected} identity="Dataset" subtitle="Example object" status={<span>Indexed</span>}
                actions={<Button variant="primary">Open in Notebook</Button>}
                dismiss={{ label: 'Close details', onDismiss: () => setSelected('batch-7') }} />}>
              <ContentSection id="explorer-properties" title="Properties">
                <MetadataList items={[
                  { id: 'format', label: 'Format', value: 'CSV' },
                  { id: 'id', label: 'Identifier', value: `dataset_${selected}`, format: 'code', action: <Button variant="ghost">Copy</Button> },
                ]} />
              </ContentSection>
            </ContentPane>
          </SplitPane>
        </Split>
      </div>
    </section>
    <section>
      <h2>Operations</h2>
      <div className="catalog-pane-frame">
        <Tabs defaultValue="jobs">
          <ContentPane id="operations-pane" label="Jobs" surface="workspace" inset="compact" scroll="pane"
            toolbar={<TabsList aria-label="Operations"><TabsTrigger value="jobs">Jobs</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger></TabsList>}>
            <TabsContent value="jobs"><ListRow title="job-14" meta="Running" onOpen={() => undefined} /></TabsContent>
            <TabsContent value="reports"><p>The report stays in this pane.</p></TabsContent>
          </ContentPane>
        </Tabs>
      </div>
    </section>
    <section>
      <h2>Editor</h2>
      <div className="catalog-pane-frame">
        <ContentPane id="editor-pane" label="Notes" surface="workspace" inset="compact" scroll="content"
          header={<InspectorHeader title="Assay notes" identity="Draft" actions={<Button variant="primary">Save revision</Button>} />}
          feedback={<p role="status">Saved with this revision.</p>}>
          <div className="catalog-editor">The editor keeps its own scroll and selection.</div>
        </ContentPane>
      </div>
    </section>
  </>;
}
