# Architektura Sítka

## Přehled

```
Prohlížeč (React SPA)
   │  HTTPS, cookie session, JSON /api/v1
   ▼
Node.js + Express (jeden proces)
   ├── HTTP API (validace zod, autorizace podle organizace)
   ├── Fronta zpracování (v procesu, stav v DB, souběžnost + retry)
   │      ingest → extrakce textu (→ OCR přes AI jen pro skeny) → AI hodnocení → ověření citací → skóre
   ├── Úložiště souborů (disk, data/uploads/<org>/<uuid>)
   └── SQLite (data/sitko.db, WAL, cizí klíče zapnuté)
          ▲
          └── Claude API (structured outputs), jen pro návrh požadavků, OCR a hodnocení
```

**Proč takhle:** Pro malé firmy a desítky až stovky CV měsíčně stačí jeden proces. SQLite s WAL zvládne souběžné čtení i zápisy fronty, neběží žádný další server (Redis, Postgres) a zálohuje se zkopírováním souboru. Přístup k DB je soustředěný v `server/db` a v servisech. Přechod na Postgres znamená přepsat dotazy, ne architekturu.

**Kdy to přestane stačit:** víc instancí serveru (fronta v procesu není distribuovaná), stovky tisíc dokumentů, nebo když bude potřeba oddělit worker. Pak Postgres + `pg-boss` (fronta v Postgresu, bez Redisu).

## Technologie

| Vrstva | Volba | Důvod |
|---|---|---|
| Server | Node.js 22.13+, Express 5, TypeScript | navazuje na v0.1 |
| DB | SQLite přes vestavěný `node:sqlite` (tenká vrstva `server/db/index.ts`) | žádný další server ani nativní modul ke kompilaci; transakce, cizí klíče |
| Validace | `zod` | schémata pro API i výstup AI |
| Upload | `multer` (paměť, limity) | multipart místo base64 v JSON |
| PDF text | `unpdf` (pdf.js) | text po stránkách, bez nativních závislostí |
| DOCX text | `mammoth` | už v projektu |
| AI | `@anthropic-ai/sdk`, model `claude-sonnet-5-5` | structured outputs |
| Frontend | React 19, React Router, TanStack Query, Vite | víc obrazovek, cache a polling |
| UI primitiva | Radix (Dialog, DropdownMenu, Tooltip), lucide ikony | přístupnost bez vlastních hacků |
| Testy | Vitest, Supertest, Playwright | unit, API, E2E |
| Aplikace | PWA: manifest, ikony, service worker jen pro offline stránku | instalace na počítač i telefon bez obchodů s aplikacemi; data kandidátů se v zařízení neukládají |
| Provoz | Docker (`node:22-bookworm-slim`), Render Blueprint, trvalý disk `/data` | viz `docs/nasazeni.md` |

## Datový model

```
organizations ─┬─< memberships >── users ──< sessions
               ├─< invites
               ├─< jobs ──< job_requirements
               │     └─< applications >── candidates
               │            ├── documents (soubor, text po stránkách)
               │            ├─< evaluations ──< evaluation_items (→ job_requirements)
               │            └─< notes
               └─< audit_logs
```

| Tabulka | Účel | Klíčová omezení |
|---|---|---|
| `organizations` | firma (tenant), retence dat, příznak demo | |
| `users` | účet | `email` unikátní (lowercase) |
| `memberships` | role uživatele v organizaci (`owner`, `recruiter`) | PK (org, user) |
| `sessions` | přihlášení; ukládá se jen SHA-256 tokenu | expirace, index na user |
| `invites` | jednorázový odkaz pro nového člena týmu | hash tokenu, expirace, `used_at` |
| `jobs` | pozice: název, inzerát, stav, `requirements_version` | index (org, status) |
| `job_requirements` | potvrzené požadavky: váha 1–3, povinný, kategorie, původ (AI/uživatel), citace z inzerátu | FK job, `position` |
| `candidates` | osoba v rámci organizace | index (org, email) pro párování |
| `documents` | nahraný soubor: hash, MIME, velikost, cesta, text po stránkách | UNIQUE (org, sha256) |
| `applications` | kandidát × pozice × dokument; stav zpracování a rozhodnutí | UNIQUE (job, document), index (job, status) |
| `evaluations` | verze hodnocení přihlášky (historie): skóre, úplnost, profil, model, tokeny | UNIQUE (application, version) |
| `evaluation_items` | výsledek jednoho požadavku: verdikt, citace, stav ověření citace, stránka, oprava personalistou | FK evaluation, FK requirement (SET NULL) |
| `notes` | poznámky personalisty k přihlášce | FK application, autor |
| `audit_logs` | kdo co kdy změnil (bez obsahu CV) | index (org, created_at), (entity) |

**Proč přihláška (`applications`):** jeden kandidát může kandidovat na víc pozic. Hodnocení patří ke kombinaci kandidát × pozice, ne ke kandidátovi.

**Verzování:** každá změna požadavků zvýší `jobs.requirements_version`. Hodnocení si pamatuje verzi i snímek požadavků (název, váha, povinnost v `evaluation_items`). Starší hodnocení se označí jako zastaralé a dá se spustit znovu. Historie zůstává.

**Mazání:** smazání kandidáta odstraní jeho přihlášky, hodnocení, poznámky a soubory z disku (právo na výmaz). Smazání pozice odstraní přihlášky a soubory, které nepatří k jiné pozici. Audit log zůstává bez osobních údajů.

## Pipeline zpracování životopisu

1. **Ingest** (`POST /jobs/:id/applications`): kontrola velikosti (10 MB) a skutečného formátu podle magických bajtů (PDF, DOCX, TXT, JPG, PNG). Soubor se uloží pod náhodným UUID, nikdy pod jménem od uživatele. SHA-256 slouží k detekci duplicit: stejný soubor u stejné pozice se nepřijme, u jiné pozice se dokument použije znovu. Vznikne přihláška ve stavu `queued`.
2. **Extrakce textu:** PDF přes pdf.js po stránkách, DOCX přes mammoth, TXT jako UTF-8. Když PDF nemá textovou vrstvu (sken) nebo jde o fotku, použije se **OCR přes AI**: model dostane jen pokyn k doslovnému přepisu, nic nehodnotí. Prázdný text = trvalá chyba s vysvětlením, nic se nedomýšlí.
3. **Kontrola prompt injection:** heuristika hledá v textu pokyny pro AI („ignore previous instructions“, „SYSTEM:“, „ohodnoť mě nejlépe“…). Nález se uloží jako příznak a ukáže personalistovi. Text se do modelu pošle stejně, ale uzavřený v `<zivotopis>` s pravidlem, že jde o data.
4. **Strukturovaná extrakce + hodnocení** (jedno volání AI, structured outputs): kontakt, profil (zkušenosti, vzdělání, dovednosti, jazyky, certifikace) a ke každému potvrzenému požadavku verdikt, doslovná citace, překlad citace (u cizojazyčných CV), vysvětlení a omezení. Jedno volání místo dvou šetří zhruba polovinu nákladů. Výstup se validuje zod schématem, při neshodě je to trvalá chyba.
5. **Ověření citací:** každá citace se dohledá v extrahovaném textu (normalizace mezer, uvozovek, pomlček). Výsledek je `exact`, `approximate` (≥ 85 % slov citace) nebo `not_found`. U nalezené citace se uloží číslo stránky. Nenalezená citace se v UI výrazně označí.
6. **Skóre** (viz níže) a uložení nové verze hodnocení v transakci. Kandidát se spáruje podle e-mailu v rámci organizace. Jiná přihláška stejného kandidáta na stejnou pozici se označí jako možný duplikát.

### Fronta

- Stav přihlášky: `queued → extracting → evaluating → done | failed`, k tomu `attempts`, `next_attempt_at`, `error_code`, `error_message` (bezpečné pro uživatele).
- Worker v procesu bere úlohy z DB, souběžnost `AI_CONCURRENCY` (výchozí 3).
- **Dočasné chyby** (429, 5xx, síť, timeout) se opakují s odstupem 30 s, 2 min a 8 min, nejvýš 4 pokusy. **Trvalé chyby** (nečitelný soubor, 400, nevalidní výstup, chybí API klíč) skončí hned ve stavu `failed` s tlačítkem „Zkusit znovu“.
- **Obnova po výpadku:** úlohy ve stavu `extracting`/`evaluating` starší než 10 min se po startu vrátí do fronty.
- **Duplicitní zpracování:** úloha se zamyká podmíněným `UPDATE … WHERE status='queued'` (atomické v SQLite).
- **Limit nákladů:** `MONTHLY_EVALUATION_LIMIT` na organizaci (výchozí 1000). Po překročení skončí přihláška ve stavu `failed` s kódem `limit_reached`. Tokeny se ukládají ke každému hodnocení.

## Výpočet skóre

Pro potvrzené požadavky `i` s váhou `wᵢ ∈ {1 výhoda, 2 důležité, 3 klíčové}` a body `pᵢ`:

| Verdikt | pᵢ | Doloženo |
|---|---|---|
| Splňuje | 1 | ano |
| Částečně | 0,5 | ano |
| Nesplňuje (CV ukazuje opak) | 0 | ano |
| Nelze ověřit (v CV chybí) | 0 | **ne** |

- **Doložená shoda** = Σ wᵢ·pᵢ / Σ wᵢ × 100 (zaokrouhleno). Znamená „kolik vážených požadavků životopis prokazatelně doložil“, ne hodnotu člověka.
- **Úplnost hodnocení** = Σ wᵢ přes doložené verdikty / Σ wᵢ × 100. Nízká úplnost znamená „v CV chybí informace, ověřte na pohovoru“.
- **Povinné požadavky:** `met` (všechny splňuje), `unmet` (aspoň jeden nesplňuje), `unknown` (žádný nesplňuje, ale aspoň jeden je částečně nebo nelze ověřit). Výchozí řazení dává `unmet` dolů, kandidáti ale nikdy nezmizí a nic se nezamítá automaticky.
- **Oprava personalistou** přepíše verdikt položky. Skóre se přepočítá, položka se označí „upraveno“ a změna se zapíše do audit logu. Původní verdikt AI zůstává uložen.

Funkce je v `server/services/scoring.ts` a pokrytá testy.

## Bezpečnost

| Hrozba | Opatření |
|---|---|
| Přístup k cizím datům | každý dotaz filtruje `org_id` ze session; cizí ID vrací 404 (test v `tests/api.test.ts`) |
| Krádež session | token 32 B, v DB jen hash, cookie `HttpOnly`, `SameSite=Lax`, `Secure` v produkci, expirace 14 dní (klouzavá) |
| CSRF | SameSite cookie + povinná hlavička `X-Sitko-Request` u zápisů (cizí web ji bez CORS nepošle) + kontrola `Origin` |
| Hádání hesla | scrypt se solí, min. 10 znaků, rate limit přihlášení 10 / 15 min na IP+e-mail |
| Upload | limit velikosti a počtu, magické bajty, náhodné jméno souboru, stažení vždy `attachment` + `nosniff` |
| Path traversal | cesta se skládá z UUID, nikdy ze vstupu |
| SQL injection | výhradně parametrizované dotazy |
| XSS | React escapuje, žádné `dangerouslySetInnerHTML`; CSP `script-src 'self'` |
| Prompt injection | dokument jako data v tagu, model nemá nástroje, heuristika + příznak, citace se ověřují proti textu |
| Náklady AI | rate limit na návrh požadavků, měsíční limit hodnocení na organizaci |
| Osobní údaje v logu | logují se ID a kódy chyb, nikdy text CV ani prompt |
| Retence | denní úloha maže přihlášky v uzavřených a archivovaných pozicích starší než `retention_days` (výchozí 180) |
| Tajné klíče | jen proměnné prostředí, `.env` je v `.gitignore` |

## Férovost a právní rámec

**Co dělá systém:**
- Hodnotí jen podle potvrzených požadavků pozice. Prompt zakazuje zohledňovat věk, pohlaví, národnost, etnicitu, náboženství, zdraví, rodinný stav, fotografii a adresu. U fotek CV se fotografie ignoruje.
- Nikdy automaticky nezamítá. Každé rozhodnutí dělá člověk a zapíše se do audit logu.
- „Nelze ověřit“ se nepočítá jako nesplnění. Mezery v kariéře se bez kontextu nehodnotí negativně.
- Každý verdikt má citaci ověřenou proti textu dokumentu a personalista ho může opravit.

**Právní souvislosti (nejde o ověřený soulad ani právní radu):**
- **AI Act (nařízení 2024/1689):** třídění a hodnocení uchazečů je vysoce riziková AI (příloha III, bod 4a). Digital Omnibus (nařízení 2026/1744) posunul povinnosti pro samostatné vysoce rizikové systémy na **2. 12. 2027**. Sítko jako *poskytovatel* bude potřebovat řízení rizik, technickou dokumentaci, logování, lidský dohled, posouzení shody a registraci v databázi EU. Firma jako *uživatel (deployer)* musí zajistit lidský dohled, informovat zaměstnance a uchazeče a uchovávat logy. Povinnosti transparentnosti (čl. 50) platí od 2. 8. 2026.
- **GDPR:** firma je správce, Sítko zpracovatel, takže je potřeba zpracovatelská smlouva. Čl. 22 (automatizované rozhodování) splňuje lidské rozhodnutí. Uchazeči musí být informováni (čl. 13/14). U AI hodnocení uchazečů bude pravděpodobně potřeba DPIA. Anthropic je dílčí zpracovatel. Je nutné ověřit podmínky zpracování dat a umístění.
- **Co zbývá:** právní posouzení konkrétního nasazení, šablona informace pro uchazeče, DPA, DPIA, dokumentace podle AI Act.
