# API Sítka (v1)

Základ: `/api/v1`. JSON, autentizace session cookie `sitko_session` (HttpOnly, SameSite=Lax).

**Zápisové požadavky** (POST, PUT, PATCH, DELETE) musí mít hlavičku `X-Sitko-Request: 1`, jinak vrátí 403 (ochrana proti CSRF).

**Odpovědi:**
- úspěch: `{ "data": … }`, seznamy `{ "data": [...], "meta": { "page", "pageSize", "total } }`
- chyba: `{ "error": { "code", "message", "fields"? } }`. Zpráva je česky a bezpečná k zobrazení, interní detaily se neposílají.

**Stavové kódy:** 400 validace (`fields` u jednotlivých polí), 401 nepřihlášen, 403 bez oprávnění/CSRF, 404 neexistuje **nebo patří jiné organizaci**, 409 konflikt stavu, 413 příliš velké, 422 nečitelný vstup, 429 rate limit, 503 AI nedostupná.

Typy odpovědí jsou v `shared/types.ts`.

## Přístup

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/auth/registration` | `{open, codeRequired}`: jestli je registrace zapnutá a jestli vyžaduje kód. |
| POST | `/auth/register` | `{organizationName, name, email, password, code?}` → nová firma + vlastník, přihlásí. Vypnutelné `ALLOW_REGISTRATION=false`; s `REGISTRATION_CODE` musí `code` sedět (jinak 403 `registration_code`). Rate limit 10/h na IP. |
| POST | `/auth/login` | `{email, password}`. Rate limit 10 / 15 min na IP+e-mail. |
| POST | `/auth/logout` | Zruší session. |
| GET | `/auth/me` | `Me`, nebo `null`, když nikdo není přihlášen. |
| GET | `/invites/:token` | Veřejné: informace o pozvánce. |
| POST | `/invites/:token/accept` | `{name, email, password}` → účet v organizaci, přihlásí. |

## Uživatel a organizace (přihlášení)

| Metoda | Cesta | Role | Popis |
|---|---|---|---|
| PATCH | `/me` | všichni | `{name}` |
| POST | `/me/password` | všichni | `{currentPassword, newPassword}`, ukončí ostatní session |
| PATCH | `/organization` | vlastník | `{name?, retentionDays?}` (30–3650) |
| GET | `/organization/usage` | všichni | stav AI, model, měsíční využití a limit |
| GET | `/organization/members` | všichni | členové týmu |
| PATCH | `/organization/members/:userId` | vlastník | `{role}`, poslední vlastník nejde ponížit |
| DELETE | `/organization/members/:userId` | vlastník | odebere člena, smaže jeho účet a session |
| GET | `/organization/invites` | vlastník | platné pozvánky |
| POST | `/organization/invites` | vlastník | `{role, email?}` → `url` s tokenem (zobrazí se jen jednou, platí 7 dní) |
| DELETE | `/organization/invites/:id` | vlastník | zruší pozvánku |

## Předplatné (firma)

Platí jen se `SUBSCRIPTIONS=true`. Bez aktivního předplatného vrací akce, které spouštějí AI (návrh požadavků, nahrání CV, nové hodnocení, opakování), **402 `subscription_inactive`**. Čtení, úpravy a mazání dat fungují dál. Stav je i v `Me.organization.subscription`.

| Metoda | Cesta | Role | Popis |
|---|---|---|---|
| GET | `/organization/subscription` | všichni | `{subscription, plans (nabízené), billing, contact, monthEvaluations}` |
| PUT | `/organization/billing` | vlastník | `{name, ico (8 číslic nebo prázdné), dic, address, email}` |
| POST | `/organization/subscription/order` | vlastník | `{planId}`: objednávka tarifu. Vyžaduje vyplněný název, adresu a e-mail (jinak 400 `billing_incomplete` s `fields`). |
| DELETE | `/organization/subscription/order` | vlastník | zruší objednávku |

## Správa (provozovatel)

Jen pro e-maily z `ADMIN_EMAILS`, ostatním vrací 404. Nevidí pozice, kandidáty ani dokumenty firem: izolace organizací platí i pro provozovatele.

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/admin/organizations` | firmy (bez ukázkové): vlastník, předplatné, objednávka, využití tento měsíc. Objednávky první. |
| GET | `/admin/organizations/:id` | navíc fakturační údaje, interní poznámka, počty pozic/kandidátů, poslední aktivita |
| PATCH | `/admin/organizations/:id` | `{planId?, paidUntil? (RRRR-MM-DD, včetně), adminNote?}`. Datum bez tarifu → 400. Přidělení objednaného tarifu s datem objednávku uzavře. Zapisuje se do auditního logu firmy. |
| GET | `/admin/plans` | všechny tarify s počtem firem |
| POST | `/admin/plans` | `{name, monthlyCvLimit, priceCzk \| null, isPublic}` |
| PATCH | `/admin/plans/:id` | totéž; změna limitu platí hned pro všechny firmy s tarifem |
| DELETE | `/admin/plans/:id` | jen nepoužitý tarif (jinak 409 `plan_in_use`) |

## Přehled a pozice

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/dashboard` | rozpracované pozice, co vyžaduje pozornost, aktivita, souhrny |
| GET | `/jobs?status=open\|draft\|active\|closed\|archived\|all&q=&page=&pageSize=` | seznam se stránkováním |
| POST | `/jobs` | `{title, adText}` → koncept |
| POST | `/jobs/ad-text` | multipart `file` (PDF/DOCX/TXT, 5 MB) → `{text}` |
| GET | `/jobs/:id` | detail včetně požadavků a počtů |
| PATCH | `/jobs/:id` | `{title?, adText?, status?}`. Přechody: aktivní ↔ uzavřená, cokoli → archiv, archiv → aktivní/uzavřená. Koncept se aktivuje jen potvrzením požadavků. |
| DELETE | `/jobs/:id` | jen vlastník; smaže přihlášky a osiřelé soubory |
| POST | `/jobs/:id/requirements/suggest` | návrh požadavků od AI (neukládá). U každého `sourceFound`: byla citace z inzerátu v inzerátu nalezena? Bez nalezené citace nikdy `mustHave: true`. Rate limit 30/h na organizaci. |
| PUT | `/jobs/:id/requirements` | `{requirements: [{id?, name, description, category, weight 1–3, mustHave, origin, adQuote?}]}` (1–20). Nahradí sadu, zvýší verzi, potvrdí a aktivuje koncept. |
| GET | `/jobs/:id/activity` | historie změn pozice |
| GET | `/jobs/:id/export.csv` | CSV pro Excel (středník, BOM, ochrana proti vzorcům) |

## Kandidáti (přihlášky)

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/jobs/:id/applications?q=&decision=none\|pozvat\|mozna\|odmitnout&must=met\|unmet\|unknown&status=processing\|failed\|done&sort=match\|name\|created\|coverage&dir=asc\|desc&page=&pageSize=` | seznam se stránkováním na serveru |
| POST | `/jobs/:id/applications` | multipart `files` (max. `MAX_FILES_PER_UPLOAD` × `MAX_FILE_MB`). Pro každý soubor `outcome: queued \| duplicate \| rejected` + důvod. Jen aktivní pozice. Rate limit 60/h na organizaci. |
| POST | `/jobs/:id/applications/reevaluate` | `{ids: [...]}` nebo `{staleOnly: true}` → nové hodnocení (nová verze) |
| GET | `/applications/:id` | detail: kandidát, dokument, poslední hodnocení s položkami, historie verzí, poznámky |
| PATCH | `/applications/:id` | `{decision: "pozvat" \| "mozna" \| "odmitnout" \| null}` (jen po vyhodnocení) |
| POST | `/applications/:id/retry` | znovu zpracovat neúspěšný dokument |
| POST | `/applications/:id/reevaluate` | nové hodnocení jedné přihlášky |
| DELETE | `/applications/:id` | odebrat z pozice (smaže i soubor, pokud nepatří jinam) |
| PATCH | `/evaluation-items/:id` | `{verdict \| null, note}`: oprava verdiktu personalistou (důvod je povinný), přepočítá skóre; `null` vrátí verdikt AI |
| POST | `/applications/:id/notes` | `{body}` → seznam poznámek |
| DELETE | `/notes/:id` | autor nebo vlastník |
| PATCH | `/candidates/:id` | `{name, email, phone}`: oprava extrahovaných údajů, další hodnocení ji nepřepíše |
| DELETE | `/candidates/:id` | výmaz kandidáta a všech jeho dat v organizaci (GDPR) |
| GET | `/documents/:id/file` | originální soubor (`attachment`, `nosniff`, `no-store`) |
| GET | `/documents/:id/text` | extrahovaný text po stránkách |

## Ostatní

`GET /health` → `{ok: true}` (bez přihlášení, pro monitoring).
