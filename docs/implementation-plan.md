# Plán implementace (v0.2)

Vychází z `docs/audit.md`. Pořadí podle priorit ze zadání.

| # | Celek | Obsah | Stav |
|---|---|---|---|
| 1 | Kritické opravy | odstranit náhodné demo výsledky; zálohovat v0.1 | hotovo |
| 2 | Základ projektu | TypeScript, Vite, struktura `server/`, `web/`, `shared/`, `tests/`; ESLint | hotovo |
| 3 | Data | SQLite, migrace `server/db/migrations`, datový model z `architecture.md` | hotovo |
| 4 | Přístup | registrace firmy, přihlášení, session cookie, CSRF, role, pozvánky, rate limit | hotovo |
| 5 | Pozice | CRUD, stavy, archivace, historie změn, nahrání inzerátu z PDF/DOCX | hotovo |
| 6 | Požadavky | návrh AI s citací z inzerátu, kontrola zdroje, úpravy, potvrzení, verzování | hotovo |
| 7 | Životopisy | hromadný upload, duplicity, fronta, retry, obnova po výpadku, limit nákladů | hotovo |
| 8 | AI pipeline | extrakce textu, OCR pro skeny, hodnocení + profil, ověření citací, injection | hotovo |
| 9 | Design systém | tokeny, komponenty, layout, tmavý režim | hotovo |
| 10 | Obrazovky | přihlášení, přehled, pozice, nová pozice, kandidáti, detail, nastavení | hotovo |
| 11 | Detail kandidáta | důkazy, oprava verdiktu, poznámky, historie, originál, text CV, výmaz | hotovo |
| 12 | Bezpečnost | hlavičky, CSP, izolace organizací, retence | hotovo |
| 13 | Testy | unit, API (vč. izolace organizací), E2E v prohlížeči, typy, lint, build | hotovo |
| 14 | Demo | `npm run seed:demo`, demo organizace se zřetelným označením | hotovo |
| 15 | Aplikace (PWA) | manifest, ikony, service worker s offline stránkou, tlačítko instalace | hotovo |
| 16 | Online provoz | `node:sqlite` místo nativního modulu, Dockerfile, `render.yaml`, registrační kód, `docs/nasazeni.md` | hotovo, nasazení čeká na účty |

Skutečný výsledek testů je v závěrečné zprávě a v `README.md`.

## Mimo rozsah v0.2 (vědomě)

- Odesílání e-mailů (pozvánky se předávají odkazem).
- Fakturace.
- SSO, 2FA.
- Import z e-mailu a pracovních portálů.
- Postgres a víc instancí serveru.
