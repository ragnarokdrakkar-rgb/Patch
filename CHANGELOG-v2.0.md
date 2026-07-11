# Depo Injekcije PSA v2.0

## Glavne spremembe

- Electron Windows aplikacija z lokalnim `data.json` v mapi Dokumenti.
- Takojšnji transakcijski autosave po vsaki potrjeni spremembi.
- Zadnja dobra kopija, prejšnja kopija, zgodovina sprememb in dnevni backupi.
- Prvi zagon z izbiro domače ambulante in njenega urnika.
- Večambulantna sinhronizacija protokola v7.
- Ločeni pacienti, termini, urniki in zaloge po ambulanti.
- Druga ambulanta vidi stanje zaloge, ne pa celotnega seznama tujih pacientov.
- Revizije in strežniški `LockService` preprečujejo tiho prepisovanje zastarele verzije.
- Dvostopenjska premestitev pacienta med ambulantama.
- PSA in celotna zgodovina pacienta se ob premestitvi ohranita.
- Opravljeni zgodovinski termini ostanejo pripisani ambulanti izvedbe.
- GitHub Actions in Electron Forge za izdelavo ter objavljanje Windows posodobitev.

## Prelomna sprememba

Apps Script v7 blokira staro metodo shranjevanja celotne baze. Pred prehodom zapri staro aplikacijo v obeh ambulantah in naredi JSON backup.

## 2.0.1 - Windows build popravek
- Electron Forge/Squirrel zamenjan z electron-builder/NSIS.
- Odpravljen zastoj pri postPackage/postMake na Windows.
- Lokalni podatki in Apps Script v7 ostanejo nespremenjeni.
