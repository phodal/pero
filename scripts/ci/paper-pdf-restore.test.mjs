import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperComponents, drain } from './paper-component-harness.mjs';

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
    const selected = { getState: () => ({ selection: null }), onSelectionChange: stop, onBeginSelection: stop, onEndSelection: stop, onEmptySpaceClick: stop, setSelection: value => { selections.push(value); return { toPromise: () => Promise.resolve() }; } };
    const components = paperComponents({}, { modules: {
      '@embedpdf/pdfium/pdfium.wasm': '/pdfium.wasm',
      '@embedpdf/core': { createPluginRegistration: (plugin, config) => ({ plugin, config }) },
      '@embedpdf/core/react': { EmbedPDF: 'EmbedPDF', useStoreState: () => ({ plugins: {} }) },
      '@embedpdf/engines/react': { usePdfiumEngine: () => ({ engine: {} }) },
      '@embedpdf/plugin-scroll/react': { useScroll: () => ({ state: { currentPage: 1 } }), useScrollCapability: () => ({ provides: scrollCapability }) },
      '@embedpdf/plugin-zoom/react': { ZoomMode: { FitPage: 'fit-page' }, useZoom: () => ({ provides: zoom, state: { currentZoomLevel: 1 } }) },
      '@embedpdf/plugin-selection/react': { useSelectionCapability: () => ({ provides: { forDocument: () => selected } }) },
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
    host.unmount(); viewer.unmount();
  });
}
