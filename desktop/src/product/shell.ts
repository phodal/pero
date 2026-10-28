import { mountAppSurfaces } from '../../../web/src/apps';
import type { HostEvent } from '../../../web/src/bootstrap';
import type { ProductFields } from '../../../packages/product/product';
import themes from '../../../web/src/theme.generated.json';
type Context = { product: ProductFields; locale: string; dark: boolean };
const bridge = (window as unknown as { product: {
  connect(): Promise<Context>; open(name?: string): Promise<void>;
  onEvent(receive: (value: HostEvent) => void): void;
  onContext(receive: (value: Context) => void): void;
} }).product;
let context: Context;
let selected: { app: string; panel?: string };
const report = (error: Error) => surface.event({ kind: 'apps_error', text: error.message } as HostEvent);
const surface = mountAppSurfaces(async () => bridge.open(selected.app).catch(report));
const navigation = document.createElement('nav');
navigation.hidden = true;
const selector = document.createElement('select');
navigation.append(selector);
document.body.append(navigation);
function update() {
  if (!context || !selected) return;
  document.title = context.product.name;
  navigation.hidden = context.product.apps.length < 2;
  selector.setAttribute('aria-label', context.locale === 'zh-CN' ? '切换应用' : 'Switch App');
  for (const [name, value] of Object.entries(context.dark ? themes.dark : themes.light)) document.documentElement.style.setProperty(`--pero-${name}`, value);
  const top = navigation.hidden ? 0 : navigation.getBoundingClientRect().height;
  surface.surface({ visible: true, name: selected.app, panel: selected.panel, top,
    dark: context.dark, locale: context.locale, width: innerWidth, height: innerHeight - top });
}
selector.onchange = () => {
  selected = { app: selector.value };
  update();
  void bridge.open(selected.app).catch(report);
};
bridge.onEvent(event => {
  if (event.kind === 'apps_catalog') {
    const catalog = event.data as { name: string; displayName: string }[];
    for (const option of selector.options) option.textContent = catalog.find(app => app.name === option.value)?.displayName || option.value;
  }
  if (event.kind === 'apps_opened') {
    const value = event.data as { name: string; panel: string };
    // A late response to another selection can be retained without changing the current App.
    if (value.name === selected.app) { selected.panel = value.panel; update(); }
  }
  surface.event(event);
});
bridge.onContext(value => { context = value; update(); });
window.addEventListener('resize', update);
bridge.connect().then(value => {
  context = value; selected = value.product.entry!;
  for (const name of value.product.apps) selector.add(new Option(name, name));
  selector.value = selected.app;
  update();
  return bridge.open(selected.app);
}).catch(report);
