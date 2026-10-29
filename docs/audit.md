# Audit Sítka v0.1 (stav k 29. 10. 2026)

Audit vychází z kódu v repozitáři, ne z předpokladů. Záloha původní verze: `sitko-v0.1-zaloha/`.

## Shrnutí

Sítko v0.1 je **funkční jednostránkový prototyp**. AI hodnocení životopisu proti kritériím funguje end-to-end (ověřeno proti napodobenině API, se skutečným klíčem netestováno). Chybí ale vše, co dělá z prototypu produkt: ukládání dat, uživatelé, organizace, práce na pozadí, testy. Po obnovení stránky se všechny výsledky ztratí.

| Oblast | Stav | Hodnocení |
|---|---|---|
| AI hodnocení CV vůči kritériím | funguje (structured outputs, česky) | zachovat a rozšířit |
| Návrh kritérií z inzerátu | funguje | zachovat, přidat ověření zdroje |
| Výpočet skóre | funguje (váhy 1–3, body 1 / 0,5 / 0 / 0) | zachovat, doplnit úplnost hodnocení |
| Ukládání dat | **neexistuje** | kritické |
| Přihlášení, organizace, role | **neexistuje** (jen volitelné Basic Auth heslo) | kritické |
| Zpracování na pozadí | **neexistuje** (fronta běží v prohlížeči) | kritické |
| Testy, typy, linter | **neexistují** | vysoká priorita |
| Demo režim | náhodné výsledky pro neznámé soubory | **porušuje pravidlo „žádná falešná data“** |

## Frontend

- **Technologie:** jeden soubor `public/index.html` (724 řádků), vanilla JS, inline CSS. Bez frameworku a bez buildu.
- **Stránky:** jediná obrazovka (zadání vlevo, výsledky vpravo). Žádné routování.
- **Stav:** jeden objekt `state` v paměti prohlížeče, nic se neukládá.
- **Vykreslování:** 8× `innerHTML` se šablonovými řetězci. Escapování přes `esc()` je správné, ale křehké: jedno zapomenuté `esc()` = XSS.
- **Design:** vlastní tokeny (navy + žlutý zvýrazňovač citací, Bricolage Grotesque + IBM Plex Sans), světlý i tmavý režim, responzivní (opraveno v 0.1.1 přes container queries).
- **Stavy:** empty state je, loading je jen spinner na tlačítku, chyby se zobrazují u souborů. Skeletony nejsou.
- **Přístupnost:** focus ring, `aria-expanded`, `aria-live` na výsledcích. Chybí popisky u některých polí (skrytý `<label class="sr">` bez stylu), `confirm()` dialog nativní.
- **Funkce:** export CSV, tisk, skrytí jmen, rozhodnutí (pozvat/možná/odmítnout). Rozhodnutí se zapíše do logu, ale po obnovení stránky v UI zmizí.

## Backend

- **Technologie:** Node.js ≥ 20.12, Express 5.3, `@anthropic-ai/sdk` 1.3, `mammoth` (DOCX). JavaScript bez typů.
- **Endpointy:**
  - `GET /api/config`: demo režim, model
  - `GET /api/samples`, statické `/ukazka/*`: ukázková data
  - `POST /api/criteria`: návrh kritérií z inzerátu (synchronní volání AI)
  - `POST /api/evaluate`: hodnocení jednoho CV; soubor jako base64 v JSON, limit těla 20 MB
  - `POST /api/decision`: zápis rozhodnutí do logu
- **Databáze:** žádná. Jediné trvalé úložiště je `logs/audit.jsonl` (hash souboru, verdikty, skóre).
- **Autentizace/autorizace:** volitelně jedno sdílené heslo (HTTP Basic). Žádní uživatelé, role ani organizace.
- **Zpracování souborů:** detekce formátu podle magických bajtů (PDF, PNG, JPEG, DOCX, odmítnutí .doc). PDF a obrázky jdou do modelu přímo (vision), DOCX přes mammoth, TXT napřímo.
- **Extrakce textu z PDF:** vlastní **neexistuje**, PDF čte model. Důsledek: citace z CV nejde na serveru ověřit, ani určit stránku.
- **AI:** structured outputs (`output_config.format`), prompty v češtině, pravidla férovosti, ochrana proti prompt injection v promptu a příznak `injection_detected`. Retry jen výchozí v SDK. Citace se neověřují proti textu.
- **Asynchronní úlohy:** žádné. Prohlížeč posílá 3 souběžné požadavky. Zavření záložky = ztráta rozpracované práce.
- **Validace:** ruční sanitizace (`cleanText`, `sanitizeCriteria`). Funkční, ale bez schématu.
- **Chyby:** centrální handler, uživatelsky srozumitelné české hlášky, interní detaily se neposílají. Dobré, zachovat.
- **Logování:** `console` + audit JSONL bez obsahu CV. Dobré, převést do DB.

## Bezpečnost

| Riziko | Stav |
|---|---|
| Izolace dat mezi firmami | neexistuje (není multi-tenant) |
| Rate limiting | žádný, AI endpointy jdou zahltit a prodražit |
| Limit nákladů | žádný |
| Upload | magické bajty OK, velikost OK; base64 v JSON zbytečně zvyšuje paměť |
| Path traversal | nehrozí (soubory se neukládají) |
| SQL injection | nehrozí (není DB) |
| XSS | escapováno ručně, křehké |
| CSRF | není relevantní (žádné cookies) |
| Tajné klíče | jen v `.env`, v repozitáři nejsou ✔ |
| Osobní údaje v logu | jen hashe ✔ |
| Bezpečnostní hlavičky (CSP apod.) | chybí |
| Závislosti | `npm audit`: 0 zranitelností ✔ |

## Datová vrstva

Neexistuje. Nejsou tabulky, migrace, relace kandidát–pozice ani správa organizací.

## Provoz

- `.env.example` (ANTHROPIC_API_KEY, MODEL, APP_PASSWORD, PORT), načítání přes `process.loadEnvFile()`.
- Spuštění `npm start`, demo bez klíče. Docker ani CI nejsou.
- Projekt **není pod Gitem**.
- Testy: žádné.

## Co zachovat

1. Prompty a pravidla férovosti (rozšířit o extrakci profilu a doslovné citace).
2. Výpočet skóre (váhy a body), přidat úplnost hodnocení.
3. Detekci formátu podle magických bajtů.
4. Čtyři verdikty včetně „nelze ověřit“.
5. Zvýrazněné citace jako hlavní vizuální prvek důkazů.
6. Ukázková data (5 fiktivních CV) pro demo.

## Priority

1. **Kritické:** trvalé ukládání (DB + migrace), přihlášení a izolace organizací, zpracování na pozadí s retry.
2. **Kritické:** odstranit náhodné demo výsledky, demo jen jako jasně označený režim.
3. **Vysoká:** vlastní extrakce textu z PDF/DOCX a ověřování citací proti textu (důkazy musí být dohledatelné).
4. **Vysoká:** informační architektura pro více pozic (dashboard, pozice, kandidáti, detail).
5. **Vysoká:** testy, typová kontrola, linter.
6. **Střední:** rate limiting, limit nákladů, bezpečnostní hlavičky, retence dat.
7. **Střední:** oprava chybných výsledků personalistou, poznámky, historie hodnocení.
