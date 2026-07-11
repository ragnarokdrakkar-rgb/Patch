# Depo Injekcije PSA v2.0 — Windows EXE in dve ambulanti

Ta mapa vsebuje celoten Electron projekt in Google Apps Script v7.

## Kaj je vključeno

- Windows `Setup.exe` brez podpisa;
- takojšnji lokalni autosave po vsaki potrjeni spremembi;
- `data.json` v `Dokumenti\Depo Injekcije`;
- zadnja dobra kopija, prejšnja kopija, 30 sprememb in 90 dnevnih backupov;
- prvi zagon z izbiro domače ambulante;
- ločeni urniki, termini in zaloge za Ljubljana/Koper;
- prikaz stanja zaloge druge ambulante v načinu samo za ogled;
- pacienti druge ambulante se ne nalagajo lokalno;
- dvostopenjska premestitev pacienta;
- Apps Script v7 z revizijami in `LockService`;
- izdelava installerja z enim `.bat` ukazom;
- opcijske posodobitve prek GitHub Releases.

---

# A. Najprej posodobi sinhronizacijo

Pred izdelavo oziroma uporabo novega EXE preberi:

```text
APPS-SCRIPT-POSODOBITEV.md
```

Koda za Google Apps Script:

```text
Koda.gs
```

Med prehodom zapri staro aplikacijo na obeh lokacijah. Apps Script v7 namerno zavrne star način shranjevanja cele baze.

---

# B. Izdelava `Setup.exe` na Windowsu

## 1. Namesti Node.js

Namesti aktualni Node.js LTS za Windows. Git potrebuješ samo za objavljanje posodobitev.

V PowerShellu preveri:

```powershell
node -v
npm -v
```

## 2. Razširi ZIP

Primer:

```text
C:\DepoApp\depo-injekcije-desktop
```

Projekta ne zaganjaj neposredno iz ZIP datoteke.

## 3. Testni zagon

Dvoklikni:

```text
TESTIRAJ-APP.bat
```

Prvi zagon prenese Electron in knjižnice, izvede teste in odpre aplikacijo.

## 4. Izdelaj installer

Dvoklikni:

```text
USTVARI-EXE.bat
```

Končni installer bo tukaj:

```text
READY-EXE\Depo-Injekcije-PSA-Setup.exe
```

Ročni ukazi so:

```powershell
npm install --no-audit --no-fund
npm test
npm run make
```

## 5. Namesti

Zaženi:

```text
READY-EXE\Depo-Injekcije-PSA-Setup.exe
```

Ker aplikacija ni podpisana, lahko Windows pokaže SmartScreen. Izberi **Več informacij → Vseeno zaženi**.

---

# C. Prvi zagon v Ljubljani

1. Aplikacija uporabi vgrajeni Apps Script URL.
2. Iz oblaka prenese samo seznam ambulant.
3. Izberi obstoječo ambulanto Ljubljana ali ustvari novo.
4. Vpiši ime računalnika, na primer `Ljubljana PC`.
5. Nastavi začetek, konec, malico, dolžino termina, kapaciteto in delovne dni.
6. Po izbiri aplikacija prenese samo ljubljanske paciente in termine.

Domača ambulanta se shrani lokalno v:

```text
Dokumenti\Depo Injekcije\device-settings.json
```

# D. Prvi zagon v Kopru

1. Namesti isti `Setup.exe`.
2. Zaženi aplikacijo.
3. Izberi obstoječo ambulanto Koper ali jo ustvari.
4. Vpiši `Koper PC` in nastavi koprski urnik.
5. Aplikacija prenese samo koprske paciente in termine.

Koper ne dobi vseh ljubljanskih pacientov. Prenese pa seznam ambulant in njihove zaloge, zato lahko vidi stanje druge lokacije v načinu samo za ogled.

---

# E. Kako deluje sinhronizacija

Vsaka ambulanta ima svojo številko revizije.

Primer:

```text
Ljubljana revizija 25
Koper revizija 11
```

Ko Koper spremeni svojega pacienta, Apps Script zamenja samo koprski del centralne baze. Ljubljanski pacienti in termini ostanejo nedotaknjeni.

Če bi dva računalnika iste ambulante delala na isti stari reviziji, drugi zapis ni tiho sprejet. Aplikacija pokaže konflikt in zahteva prenos svežih podatkov.

Lokalni zapis na disk se zgodi takoj. Cloud zapis se sproži približno 1,2 sekunde po zadnji spremembi.

---

# F. Premestitev pacienta

V izvorni ambulanti:

1. Odpri **Pacienti**.
2. Pri pacientu klikni `↔`.
3. Izberi drugo ambulanto.
4. Vpiši razlog in pošlji zahtevo.

V ciljni ambulanti:

1. Odpri **Urejanje**.
2. V kartici **Premestitve med ambulantama** klikni **Sprejmi** ali **Zavrni**.

Ob sprejemu:

- pacient postane aktiven v novi ambulanti;
- njegov PSA in zgodovina ostaneta;
- prihodnji čakajoči termini stare ambulante se prekličejo;
- opravljeni zgodovinski termini ostanejo pripisani ambulanti, kjer so bili izvedeni;
- zaloga se ne prenaša samodejno.

---

# G. Lokalno shranjevanje

Glavna datoteka:

```text
C:\Users\TVOJE_IME\Documents\Depo Injekcije\data.json
```

Struktura:

```text
Dokumenti\Depo Injekcije\
├── data.json
├── data-last-good.json
├── data-previous.json
├── device-settings.json
├── History\
└── Backups\
```

Ob vsaki potrjeni spremembi:

1. staro stanje se shrani kot prejšnja kopija;
2. novo stanje se zapiše v začasno datoteko;
3. datoteka se fizično sinhronizira na disk;
4. JSON se preveri;
5. začasna datoteka zamenja `data.json`;
6. aplikacija šele nato pokaže, da je lokalno shranjeno.

Odstranitev ali posodobitev aplikacije mape v Dokumentih ne izbriše.

---

# H. Posodobitve aplikacije

## Ročno

1. V projekt zamenjaj popravljene datoteke.
2. Povečaj `version` v `package.json`.
3. Zaženi `USTVARI-EXE.bat`.
4. Novi installer zaženi na obeh računalnikih.

Lokalni podatki ostanejo.

## Samodejno prek GitHub Releases

1. Ustvari javni GitHub repozitorij.
2. Dvoklikni `NASTAVI-GITHUB.bat`.
3. Projekt naloži na GitHub.
4. Za novo izdajo dvoklikni `IZDAJ-POSODOBITEV.bat`.
5. GitHub Actions na Windowsu izdela in objavi installer.
6. Nameščena aplikacija preverja posodobitve približno enkrat na uro.

Prva oznaka za ta projekt mora ustrezati `package.json`:

```powershell
git tag v2.0.0
git push origin v2.0.0
```

---

# I. Datoteke projekta

```text
index.html                    glavna aplikacija
main.js                       Electron glavni proces
preload.js                    varen most med UI in diskom
storage-core.js               lokalni autosave in backupi
Koda.gs                       Google Apps Script v7
APPS-SCRIPT-POSODOBITEV.md    migracija oblaka
package.json                  verzija in ukazi
forge.config.js               Windows installer
USTVARI-EXE.bat               enoklikna izdelava
TESTIRAJ-APP.bat              testi in testni zagon
NASTAVI-GITHUB.bat            nastavitev repozitorija
IZDAJ-POSODOBITEV.bat         nova izdaja
.github\workflows\release.yml GitHub Windows build
```

# J. Pred produkcijsko uporabo

Izvedi najmanj ta preizkus:

1. ustvari testnega pacienta v Ljubljani;
2. preveri, da ga Koper ne vidi;
3. preveri, da Koper vidi ljubljansko zalogo samo za ogled;
4. pošlji pacienta v Koper;
5. v Kopru sprejmi premestitev;
6. preveri PSA in staro zgodovino;
7. potrdi novo injekcijo v Kopru;
8. preveri, da se zmanjša samo koprska zaloga;
9. zapri aplikacijo in preveri `data.json`;
10. ponovno odpri obe aplikaciji in preveri končno stanje.
