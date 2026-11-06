# Pero design contract

`design.tsp` is the shared token and component contract. The web library and the GPUI theme are generated from it.

Component responsibilities, usage and the interactive catalog are documented in
[the component library](../../packages/pero-design/README.md). Platform dragging,
navigation, authorization and persistence stay in their existing owners.

```sh
npm run gen:design
npx tsp compile spec/pero-design
npm run check
```
