# Posodobitev Google Apps Script na sinhronizacijo v7

Datoteka za Apps Script je `Koda.gs` v tej mapi.

## Kaj v7 spremeni

- Ljubljana in Koper ne pošiljata več cele baze drug čez drugega.
- Vsaka ambulanta shranjuje samo svoje paciente, svoje termine, urnik in zalogo.
- Druga ambulanta prejme seznam ambulant in stanje zalog, ne pa vseh tujih pacientov.
- Vsaka ambulanta ima svojo revizijo. Zastarela kopija ne more prepisati novejše.
- Strežnik uporablja `LockService` pri vsakem zapisu.
- Pacient se premesti z zahtevo in sprejemom v ciljni ambulanti.
- Ob premestitvi ostanejo PSA, opravljene injekcije in zgodovina pacienta.
- Stari način `save`, ki je prepisal celoten JSON, je namenoma blokiran.

## Varen vrstni red prehoda

1. V obstoječi aplikaciji izvozi JSON backup.
2. Zapri aplikacijo v Ljubljani in Kopru. Med prehodom naj nihče ne spreminja podatkov.
3. V Google Sheets odpri **Extensions → Apps Script**.
4. Kopiraj staro kodo v varnostno datoteko na računalniku.
5. Celotno staro kodo zamenjaj z vsebino `Koda.gs`.
6. Klikni **Save**.
7. Odpri **Deploy → Manage deployments**.
8. Pri obstoječem Web App deploymentu klikni svinčnik.
9. Pri **Version** izberi **New version**.
10. Klikni **Deploy**.

Ne ustvarjaj novega deploymenta, če želiš ohraniti isti `/exec` URL. Pri urejanju obstoječega deploymenta URL ostane isti.

## Test

V brskalniku odpri obstoječi URL in dodaj:

```text
?action=ping
```

Pravilen odgovor vsebuje:

```json
{"ok":true,"protocol":7,"msg":"pong"}
```

Nato lahko namestiš novo EXE aplikacijo.

## Migracija starih podatkov

Ob prvem v7 zahtevku strežnik prebere obstoječi JSON. Če stara baza še nima seznama ambulant, jo samodejno pretvori v eno ambulanto z imenom iz stare nastavitve `ordinacija`.

Stari listi `DATA`, `META` in `PACIENTI` ostanejo. Dodajo oziroma uporabljajo se tudi:

- `PREMESTITVE`
- `AUDIT_LOG`
- nova oblika lista `ZGODOVINA`

Če je bila `ZGODOVINA` iz stare verzije v nezdružljivi obliki, jo v7 ob prvem novem snapshotu začne na novo. Pred prehodom zato obvezno izvozi lokalni JSON backup.

## Kako deluje premestitev

1. V izvorni ambulanti pri pacientu klikni `↔`.
2. Izberi ciljno ambulanto in vpiši razlog.
3. Pacient ostane v izvorni ambulanti s statusom čakajoče premestitve.
4. Ciljna ambulanta v zavihku **Urejanje** vidi zahtevo.
5. Ko klikne **Sprejmi**, se pacient prenese v ciljno ambulanto.
6. Prihodnji čakajoči termini v stari ambulanti se prekličejo.
7. Opravljeni termini, PSA in pacientova zgodovina ostanejo.

## Pomembno

Stara aplikacija po namestitvi skripte v7 ne more več shranjevati, ker bi lahko prepisala podatke druge ambulante. Zato posodobitev Apps Scripta in namestitev novega EXE izvedi v istem vzdrževalnem oknu.
