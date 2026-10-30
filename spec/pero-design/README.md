# Pero design contract

`design.tsp` is the shared token and component contract. The web library and the GPUI theme are generated from it.

```sh
npm run gen:design
npx tsp compile spec/pero-design
npm run gen:design -- --check
```
