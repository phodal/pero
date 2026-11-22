export const browserNavigationPage = (page, foreignFrame) => `<!doctype html>
<title>Browser Use ${page}</title>
<style>
* { box-sizing: border-box }
body { margin:0; font: 16px system-ui; }
#marker { position:absolute; left:16px; top:16px; width:200px; height:72px; background:#2468b4; }
main { padding:100px 16px 0; min-height:2400px; }
#reveal { margin-top:500px; height:70px; }
</style>
<div id="marker"></div>
<main>
<h1>Browser Use ${page}</h1>
<label>Tab draft <input id="draft"></label>
<a href="/second">Open second page here</a>
<a href="#reveal">Jump to the section</a>
<div>
<a href="/second" target="_blank" rel="noopener">Open second page in a new tab</a>
</div>
${foreignFrame ? '<button id="foreign">Attach foreign frame</button><div id="frame-host"></div><p data-testid="frame-status">No frame</p>' : ''}
<p data-testid="wheel">Pending wheel</p>
<p data-testid="scroll-position">Page Y 0</p>
<p data-testid="scroll-ready">At top</p>
<p data-testid="anchor-status">Anchor cleared</p>
<button id="reveal">Below the viewport</button>
</main>
<script>
  const foreign = ${JSON.stringify(foreignFrame ?? null)};
  if (foreign) document.querySelector('#foreign').onclick = () => {
    const host = document.querySelector('#frame-host').attachShadow({mode:'closed'});
    const frame = document.createElement('iframe');
    frame.onload = () => document.querySelector('[data-testid="frame-status"]').textContent = 'Frame loaded';
    frame.src = foreign;
    host.append(frame);
  };
  addEventListener('hashchange', () => {
    document.querySelector('[data-testid="anchor-status"]').textContent = location.hash ? 'Anchor opened' : 'Anchor cleared';
  });
  addEventListener('wheel', event => {
    document.querySelector('[data-testid="wheel"]').textContent = 'Wheel trusted ' + event.isTrusted;
    document.querySelector('[data-testid="wheel"]').title = 'Pointer ' + event.clientX + ',' + event.clientY + ' in ' + innerWidth + 'x' + innerHeight;
  }, { passive: true });
  addEventListener('scroll', () => {
    const offset = Math.round(scrollY);
    document.querySelector('[data-testid="scroll-position"]').textContent = 'Page Y ' + offset;
    const ready = document.querySelector('[data-testid="scroll-ready"]');
    ready.title = 'Page Y ' + offset;
    ready.textContent = offset > 0 ? 'Scrolled' : 'At top';
  }, { passive: true });
</script>`;
