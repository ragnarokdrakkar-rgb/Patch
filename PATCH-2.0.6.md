# Patch 2.0.6

## Popravek

- Ob preklopu med Medurjem in Koprom aplikacija zdaj prenese podatke izbrane ambulante iz Apps Scripta.
- Druga ambulanta ostane samo za ogled.
- Pred odhodom iz domače ambulante se neposlane spremembe najprej varno pošljejo v oblak.
- Samodejna osvežitev vsakih 60 sekund osvežuje ambulanto, ki je trenutno odprta.
- Ročni gumb za prenos iz oblaka osveži trenutno odprto ambulanto.

## Izdaja

`package.json` je že nastavljen na `2.0.6`. Ne zaganjaj `npm version patch`.

```cmd
npm.cmd test
git add index.html package.json package-lock.json release-config.js tests/cloud-contract.test.js tests/project.test.js PATCH-2.0.6.md
git commit -m "Release v2.0.6: load selected clinic from cloud"
git push origin main
git tag -a v2.0.6 -m "Depo Injekcije PSA 2.0.6"
git push origin v2.0.6
```
