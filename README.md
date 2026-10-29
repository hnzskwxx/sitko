# Sítko

Sítko pomáhá malým firmám s prvním tříděním životopisů. Personalista vloží inzerát, zkontroluje požadavky navržené AI a nahraje životopisy. Sítko u každého kandidáta vyhodnotí každý požadavek zvlášť a připojí doslovnou citaci z CV, kterou server ověří v textu dokumentu. Kandidáty seřadí podle **doložené shody** s požadavky. O každém kandidátovi rozhoduje člověk a Sítko nikoho automaticky nezamítá.

## Rychlý start

Potřebujete **Node.js 22.13 nebo novější** (doporučeno 24 LTS). Databáze je vestavěné SQLite z Node.js, takže instalace nic nekompiluje a funguje stejně na Windows, macOS i Linuxu.

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
# do .env doplňte ANTHROPIC_API_KEY (klíč z platform.claude.com)
npm run seed:demo             # volitelné: ukázková organizace s fiktivními daty
npm run dev                   # http://localhost:3000
```

- **Windows:** stačí dvakrát kliknout na `spustit.cmd`. Zkontroluje Node.js, nainstaluje závislosti, připraví ukázku a otevře prohlížeč.
- **Ukázka bez API klíče:** po `npm run seed:demo` se přihlaste jako `demo@sitko.local` / `ukazka-sitko-2026`. Ukázková organizace má zřetelně označená předpřipravená hodnocení. Citace se ale ověřují stejným kódem jako v ostrém provozu.
- **Ostrý provoz:** zaregistrujte firmu na `/registrace`. Bez `ANTHROPIC_API_KEY` půjde připravit pozice a požadavky ručně, ale životopisy skončí srozumitelnou chybou „AI není nastavená“.

## Online provoz a instalace jako aplikace

Nasazení na Render (region EU), zálohy a instalace jako aplikace (PWA) popisuje **[docs/nasazeni.md](docs/nasazeni.md)**. Repozitář obsahuje `Dockerfile`, `render.yaml` (bezplatná ukázka) a `render-produkce.yaml` (ostrý provoz s diskem, cca 7,25 USD/měsíc).

```bash
npm run build
npm start                     # servíruje API i sestavený frontend
```

- Data jsou ve složce `DATA_DIR` (SQLite + soubory). Patří na trvalý disk a je potřeba je zálohovat.
- Na veřejném serveru nastavte `REGISTRATION_CODE`, jinak se může zaregistrovat kdokoli a hodnotit na váš API klíč.
- Lokální test produkčního sestavení přes http mimo `localhost`: `COOKIE_SECURE=false`.

## Proměnné prostředí

| Proměnná | Výchozí | Význam |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | klíč pro Claude API; bez něj se nehodnotí |
| `AI_MODEL` | `claude-sonnet-5-5` | model |
| `AI_EFFORT` | – | `low` / `medium` / `high`, jinak výchozí modelu |
| `AI_CONCURRENCY` | 3 | souběžně hodnocené životopisy |
| `MONTHLY_EVALUATION_LIMIT` | 1000 | měsíční limit hodnocení na organizaci |
| `PORT` | 3000 | port |
| `DATA_DIR` | `data` | databáze `sitko.db` a nahrané soubory |
| `PUBLIC_URL` | `RENDER_EXTERNAL_URL` | veřejná adresa (odkazy pozvánek, kontrola Origin) |
| `ALLOW_REGISTRATION` | `true` | registrace nových firem |
| `REGISTRATION_CODE` | – | když je vyplněný, registrace firmy vyžaduje tento kód |
| `SUBSCRIPTIONS` | `false` | placené členství: AI jen pro firmy s aktivním tarifem |
| `ADMIN_EMAILS` | – | e-maily provozovatelů (čárkou), vidí Správu firem a tarifů |
| `BILLING_CONTACT` | – | kontakt, který firmy vidí u předplatného |
| `SEED_DEMO_ON_START` | `false` | při startu připravit ukázku (`demo@sitko.local`); přihlašovací stránka pak nabídne „Otevřít ukázku“ |
| `SESSION_DAYS` | 14 | platnost přihlášení |
| `COOKIE_SECURE` | v produkci `true` | cookie jen přes HTTPS |
| `MAX_FILE_MB` / `MAX_FILES_PER_UPLOAD` | 10 / 50 | limity nahrávání |

## Kontroly

```bash
npm test             # unit + API testy (Vitest + Supertest), 45 testů
npm run typecheck    # TypeScript server i web
npm run lint         # ESLint
npm run build        # produkční sestavení
```

E2E v prohlížeči (Playwright, mimo `npm install`) s napodobeninou Claude API:

```bash
node e2e/mock-anthropic.mjs 4999 &
PORT=3300 DATA_DIR=/tmp/sitko-e2e ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4999 npm run dev &
npx playwright install chromium   # jednou
node e2e/run.cjs http://localhost:3300 ./e2e-vystup
```

## Struktura

```
server/            Express API (TypeScript)
  db/              SQLite, migrace
  routes/          endpointy (auth, organizace, pozice, kandidáti)
  services/        doménová logika: fronta, extrakce textu, ověření citací, skóre, AI
  services/ai/     prompty, schémata výstupu, Anthropic a ukázkový poskytovatel
web/src/           React aplikace (Vite)
web/public/        ikony, manifest a service worker (instalace jako aplikace)
  components/      design systém a sdílené komponenty
  pages/           obrazovky
shared/types.ts    typy API sdílené serverem a webem
tests/             Vitest testy
e2e/               scénáře v prohlížeči + napodobenina Claude API
ukazka/            fiktivní inzerát a 5 životopisů pro demo
docs/              audit, architektura, API, design systém, plán, nasazení
Dockerfile          produkční image
render*.yaml        Blueprinty pro Render (ukázka zdarma / ostrý provoz)
```

Podrobnosti: [nasazení](docs/nasazeni.md) · [architektura](docs/architecture.md) · [API](docs/api.md) · [design systém](docs/design-system.md) · [audit v0.1](docs/audit.md) · [plán](docs/implementation-plan.md)

## Důležité upozornění

Třídění uchazečů pomocí AI je podle AI Actu vysoce riziková oblast (povinnosti od 2. 12. 2027) a podléhá GDPR. Sítko je navržené s lidským rozhodováním, dohledatelnými důkazy a auditní stopou, ale **nejde o ověřený soulad**. Před nasazením u klienta je potřeba právní posouzení, zpracovatelská smlouva a informace pro uchazeče. Viz `docs/architecture.md`.
