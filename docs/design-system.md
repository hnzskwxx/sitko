# Design systém Sítka

Pracovní nástroj pro personalistu, který denně prochází desítky životopisů. Rozhraní má být klidné, husté tam, kde se pracuje s daty, a vzdušné tam, kde se čte. Jediný výrazný prvek identity je **žlutý zvýrazňovač citací z CV**, vizuální podpis toho, že každé hodnocení stojí na doložitelném textu. Všechno ostatní je neutrální.

Zdroj pravdy jsou tokeny v `web/src/styles/tokens.css`. Komponenty používají jen tokeny, nikdy přímé barvy.

## Barvy

Výchozí paleta ze zadání, upravená tak, aby text splnil WCAG AA (4,5 : 1).

| Token | Světlý | Tmavý | Použití |
|---|---|---|---|
| `--bg` | #F7F7F5 | #151515 | pozadí aplikace |
| `--surface` | #FFFFFF | #1C1C1B | panely, tabulky, dialogy |
| `--surface-2` | #EFEFEC | #242423 | hover řádku, neutrální štítky |
| `--text` | #191919 | #EDEDEA | hlavní text |
| `--text-2` | **#6B6B67** | #A1A19C | sekundární text (zadání #777773 má na pozadí jen 4,2 : 1) |
| `--border` | #E8E8E5 | #2C2C2A | oddělovače, okraje panelů |
| `--border-strong` | #C9C9C4 | #42423F | okraje polí formuláře |
| `--primary` | #252525 | #EDEDEA | hlavní akce |
| `--success` / `-bg` | #1F6E4B / #E9F4EE | #7CC9A0 / #1E2B24 | splňuje, hotovo |
| `--warning` / `-bg` | **#8F5E12** / #FBF1E1 | #E3B464 / #2E2616 | částečně, k ověření (zadání #B7791F má jen 3,6 : 1, zůstává pro ikony) |
| `--error` / `-bg` | #B23B3B / #FAEAEA | #EE9A9A / #311E1E | nesplňuje, chyba |
| `--focus` | #2D5BD3 | #7EA2FF | focus ring, jediná modrá v systému |
| `--evidence` | #FFE45C | #E8C93A | zvýrazňovač citací |

**Stav nikdy jen barvou.** Každý stavový štítek má text („Splňuje“, „Nelze ověřit“) a u verdiktů i ikonu (✓ fajfka, ½ kruh, ✕, ?).

## Typografie

- **Inter Variable** (hostovaný lokálně přes `@fontsource-variable/inter`, žádné volání Google Fonts), záložně systémový sans-serif.
- Čísla v tabulkách a skóre: `font-variant-numeric: tabular-nums`.

| Role | Velikost / řádkování | Řez |
|---|---|---|
| Titulek stránky | 20 / 28 | 600 |
| Nadpis sekce | 15 / 22 | 600 |
| Běžný text, tabulky | 14 / 20 | 400 |
| Popisky, metadata | 13 / 18 | 400 / 500 |
| Drobný text (štítky) | 12 / 16 | 500 |
| Velké skóre v detailu | 32 / 36 | 600 |

Žádné obří nadpisy. Text do 72 znaků na řádek (`--measure`).

## Prostor a tvar

- Mřížka 4 px: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-8` 32, `--s-10` 40.
- Poloměry: 6 px ovládací prvky, 8 px panely, 999 px štítky.
- Stíny jen u vrstev nad obsahem (dialog, menu, toast). Panely mají okraj, ne stín.
- Výška ovládacích prvků: 32 px (kompaktní, v tabulkách) a 36 px (formuláře).

## Layout

- Levý sidebar 232 px: logo, navigace (Přehled, Pozice, Nastavení), dole organizace a uživatel. Pod 900 px se změní na horní lištu s menu v drawer panelu.
- Obsah: hlavička stránky (drobečková navigace, titulek, hlavní akce vpravo), pod ní obsah. Tabulky max. 1280 px, formuláře max. 720 px.
- Zarovnání vlevo. Čísla v tabulkách vpravo.

## Komponenty (`web/src/components/ui`)

| Komponenta | Poznámka |
|---|---|
| `Button` | varianty `primary`, `secondary`, `ghost`, `danger`; velikosti `sm`, `md`; stav `loading` |
| `IconButton` | vždy `aria-label` a tooltip |
| `Input`, `Textarea`, `Select`, `SearchInput` | label nad polem, chyba pod polem, `aria-invalid` |
| `Dialog`, `ConfirmDialog` | Radix; potvrzení destruktivních akcí opakuje, co přesně se smaže |
| `Drawer` | Radix Dialog vysunutý zprava (mobilní menu) |
| `DropdownMenu` | Radix; akce řádku tabulky |
| `Tooltip` | Radix; vysvětlení skóre a ikon |
| `Tabs` | navigační záložky pozice (každá má vlastní URL) |
| `Table` | sticky hlavička, řaditelné sloupce (`aria-sort`), výběr řádků, klávesy ↑/↓ a Enter |
| `Badge` | tóny `neutral`, `success`, `warning`, `error`, `info` |
| `VerdictBadge` | verdikt požadavku s ikonou a textem |
| `ScoreBar` | číslo + tenký pruh + úplnost hodnocení v tooltipu |
| `Avatar` | iniciály, neutrální barva (ne barva podle jména) |
| `Progress` | stav zpracování dokumentů |
| `Toast` | potvrzení provedené akce, jen po úspěšné odpovědi serveru |
| `EmptyState`, `ErrorState`, `Skeleton` | každá stránka má všechny tři |
| `Pagination` | stránkování seznamů ze serveru |
| `FileDrop` | drag & drop + výběr, seznam souborů s výsledkem nahrání |
| `Evidence` | citace se zvýrazňovačem, stránka, stav ověření citace |
| `CommandPalette` | Ctrl/⌘ K: přechod na pozici, nová pozice, nastavení |

## Texty

- Česky, věcně, v činném rodě. Tlačítko říká, co se stane („Nahrát životopisy“, „Potvrdit požadavky“), a toast použije stejné sloveso („Požadavky potvrzeny“).
- Chyba řekne, co se stalo a co s tím dělat. Žádné omlouvání.
- Prázdný stav nabídne první krok.
- Skóre se jmenuje **„Doložená shoda“**, nikdy „hodnocení kandidáta“.

## Pohyb

Jen tam, kde odpovídá na akci: otevření dialogu (120 ms), rozbalení menu, změna šířky pruhu skóre. `prefers-reduced-motion` vypne přechody.

## Klávesnice

- `Ctrl/⌘ K` paleta příkazů, `/` hledání v seznamu, `N` nová pozice (na přehledu a v seznamu pozic).
- Tabulka kandidátů: `↑/↓` posun, `Enter` otevře detail, `Esc` zavře dialog.
- Viditelný focus ring na všech ovládacích prvcích.
