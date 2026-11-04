import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperComponents, drain, elements } from './paper-component-harness.mjs';

// Exercise the complete production Viewer/Pages through the public plugin seams.
// The pinned plugin's viewport gate is checked separately in build/apps.test.mjs.
for (const mode of ['saved', 'focus', 'focus-before-layout']) {
  test(`PDF restoration honors numeric zoom and citation priority: ${mode}`, async () => {
    const document = { id: 'pdf', fileDigest: 'digest', paperId: 'paper', pages: [{ number: 1, text: '', width: 100, height: 200 }, { number: 2, text: '', width: 100, height: 200 }] };
    const initial = { schema: 1, documentId: 'pdf', fileDigest: 'digest', page: 1, zoom: 1.75, position: { x: 3, y: 7 }, selection: null, mode: 'pdf' };
    const focus = { documentId: 'pdf', page: 2, rects: [{ x: 0.2, y: 0.3 }] };
    const zooms = [], jumps = [], selections = [], listeners = new Set();
    let ready = false;
    const stop = () => () => {};
    const scroll = { getMetrics: () => ({ currentPage: 1, pageVisibilityMetrics: ready ? [{ pageNumber: 1, original: { pageX: 0, pageY: 0 }, viewportX: 0, viewportY: 0 }] : [] }), onScroll: stop, scrollToPage: value => jumps.push(value) };
    const scrollCapability = { forDocument: () => scroll, onLayoutReady: callback => { listeners.add(callback); return () => listeners.delete(callback); } };
    const zoom = { requestZoom: value => zooms.push(value), getState: () => ({ currentZoomLevel: 1 }), onStateChange: stop };
    const selectionEvents = { change: new Set(), begin: new Set(), end: new Set() };
    const subscribe = event => callback => { selectionEvents[event].add(callback); return () => selectionEvents[event].delete(callback); };
    let currentSelection = null;
    const changeSelection = value => { currentSelection = value; for (const callback of selectionEvents.change) callback(value); };
    const selected = { getState: () => ({ selection: currentSelection }),
      onSelectionChange: subscribe('change'), onBeginSelection: subscribe('begin'), onEndSelection: subscribe('end'), onEmptySpaceClick: stop,
      getSelectedText: () => ({ toPromise: () => Promise.resolve(['selected line']) }),
      clear: () => changeSelection(null),
      setSelection: value => { selections.push(value); changeSelection(value); return { toPromise: () => Promise.resolve() }; } };
    const selectionCapability = { forDocument: () => selected };
    const components = paperComponents({}, { modules: {
      '@embedpdf/pdfium/pdfium.wasm': '/pdfium.wasm',
      '@embedpdf/core': { createPluginRegistration: (plugin, config) => ({ plugin, config }) },
      '@embedpdf/core/react': { EmbedPDF: 'EmbedPDF', useStoreState: () => ({ plugins: {} }) },
      '@embedpdf/engines/react': { usePdfiumEngine: () => ({ engine: {} }) },
      '@embedpdf/plugin-scroll/react': { useScroll: () => ({ state: { currentPage: 1 } }), useScrollCapability: () => ({ provides: scrollCapability }) },
      '@embedpdf/plugin-zoom/react': { ZoomMode: { FitPage: 'fit-page' }, useZoom: () => ({ provides: zoom, state: { currentZoomLevel: 1 } }) },
      '@embedpdf/plugin-selection/react': { useSelectionCapability: () => ({ provides: selectionCapability }) },
      '@embedpdf/plugin-capture/react': { useCapture: () => ({ state: {} }) },
      '@embedpdf/plugin-viewport/react': { useViewportCapability: () => ({ provides: { forDocument: () => ({ getMetrics: () => ({ clientWidth: 800, clientHeight: 600 }), isGated: () => false, onViewportChange: stop }) } }) },
    }, globals: { URL, location: { href: 'https://reader.example/' }, window: { document: { addEventListener() {}, removeEventListener() {} } } } });
    components.storage.set('pero.paper.pdf-view:pdf:digest', JSON.stringify(initial));
    const viewer = components.mount(components.PdfViewer, { document, annotations: [], api: {}, t: key => key, active: true, focus: mode === 'focus' ? focus : null, chrome: { toolbar: null, preserveView: { current: null }, onNavigate() {} }, onText() {} });
    assert.ok(viewer.tree.props.plugins.some(plugin => plugin.config?.defaultZoomLevel === 'fit-page'));
    const content = viewer.tree.props.children[0]({ activeDocumentId: 'pdf' });
    const pages = content.props.children[0]({ isLoaded: true, isError: false });
    const host = components.mount(pages.type, pages.props);
    assert.deepEqual(zooms, [], 'saved zoom waits for real page geometry');
    if (mode === 'focus-before-layout') host.render({ ...host.props, focus });
    ready = true;
    for (const callback of listeners) callback({ documentId: 'pdf' });
    await drain();
    if (mode === 'saved') {
      assert.deepEqual(zooms, [1.75]);
      assert.equal(jumps.length, 1); assert.equal(jumps[0].pageNumber, 1);
      assert.equal(JSON.stringify(jumps[0].pageCoordinates), JSON.stringify(initial.position));
      assert.deepEqual(selections, [null]);
    } else {
      assert.deepEqual(zooms, [], 'explicit focus must not inherit saved zoom');
      assert.deepEqual(selections, [], 'explicit focus must not restore an old selection');
      assert.equal(jumps.length, 1); assert.equal(jumps[0].pageNumber, 2);
      assert.equal(JSON.stringify(jumps[0].pageCoordinates), JSON.stringify({ x: 20, y: 60 }));
    }
    for (const callback of listeners) callback({ documentId: 'pdf' });
    assert.equal(jumps.length, 1, 'repeated layout events must not restore twice');
    // A drag must not mount the in-flow toolbar and shift the page under the
    // pointer. Ending the drag reveals it; clearing and another drag still work.
    const toolbar = () => elements(host.render(), element => element.props?.role === 'toolbar' && element.props?.['aria-label'] === 'pdfSelection');
    for (let drag = 0; drag < 2; drag++) {
      for (const callback of selectionEvents.begin) callback();
      changeSelection({ page: 1, text: 'selected line' });
      await drain();
      assert.equal(toolbar().length, 0, 'selection toolbar stays absent during the drag');
      for (const callback of selectionEvents.end) callback();
      assert.equal(toolbar().length, 1, 'completed selection exposes the toolbar');
      selected.clear();
      assert.equal(toolbar().length, 0, 'cleared selection hides the toolbar');
    }
    host.unmount(); viewer.unmount();
    for (const subscriptions of Object.values(selectionEvents)) assert.equal(subscriptions.size, 0, 'unmount removes selection observers');
  });
}
