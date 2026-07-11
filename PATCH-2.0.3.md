# Patch 2.0.3

## Popravki

- samodejno popravi star lokalni ID ambulante, če se ime ujema z ambulanto v oblaku;
- računalnik se ob napačnem ID-ju ne odpre več v prvi tuji ambulanti in se ne zaklene v samo-ogled;
- domača ambulanta se lokalno hrani z ID-jem in imenom;
- po izbiri obstoječe ambulante se vedno odpre njen svež cloud snapshot;
- jasnejše obvestilo ob konfliktu revizije; lokalni zapis ostane v History/Backups;
- dodan bootstrap za prihodnje GitHub posodobitve prek `Dokumenti\Depo Injekcije\update-config.json`;
- priložen ročni patch `app.asar`, zato za 2.0.3 ni potreben nov installer.

## Podatki

Patch ne spreminja in ne briše `data.json`, `device-settings.json`, `History` ali `Backups`.
