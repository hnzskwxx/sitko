# Nasazení Sítka na internet

Sítko je jedna webová aplikace (Node.js + SQLite). Návod popisuje [Render](https://render.com) s regionem ve Frankfurtu. Repozitář má dva hotové Blueprinty:

| Soubor | K čemu | Cena |
|---|---|---|
| `render.yaml` | **bezplatná ukázka** pro předvádění zákazníkům | zdarma |
| `render-produkce.yaml` | **ostrý provoz** s trvalým diskem a AI | cca 7,25 USD/měsíc + Claude API |

Stejný `Dockerfile` poběží i jinde (Railway, Fly.io, vlastní VPS).

## Bezplatná ukázka (5 minut)

1. Na [render.com](https://render.com) se přihlaste přes GitHub (workspace Hobby, bez platební karty).
2. **New → Blueprint** → povolte Renderu přístup k repozitáři `sitko` → vyberte ho. Render načte `render.yaml` a ukáže službu `sitko-ukazka` (plán Free).
3. **Apply.** První sestavení trvá pár minut. Adresa bude `https://sitko-ukazka.onrender.com` (případně s příponou, když je jméno obsazené).
4. Na přihlašovací stránce je tlačítko **Otevřít ukázku**. Zákazník ji tedy vyzkouší bez hesla a bez registrace.

Jak se ukázka chová:

- Po 15 minutách bez návštěvy se uspí. První načtení po probuzení trvá asi minutu, ukázku proto otevřete chvíli před schůzkou.
- Při uspání se smaže všechno, co v ní kdo změnil, a po probuzení se připraví znovu.
- Skutečnou AI nevolá a nic nestojí. Hodnotí jen pět ukázkových životopisů. Jiný soubor odmítne ještě před uložením, protože ukázku sdílí všichni návštěvníci.
- Registrace firem je vypnutá.

## Co potřebuje ostrý provoz

| Co | Proč | Cena (říjen 2026) |
|---|---|---|
| Účet na GitHubu se soukromým repozitářem | Render si odtud bere kód | zdarma |
| Účet na Renderu, workspace Hobby | hosting | 0 USD + služby |
| Web service `0.5c-512mb` | aplikace (0,5 CPU, 512 MB RAM) | 7 USD/měsíc |
| Disk 1 GB | databáze a soubory | 0,25 USD/měsíc |
| Klíč Claude API (platform.claude.com) | hodnocení životopisů | podle spotřeby |

Ceny se mění, ověřte je na [render.com/pricing](https://render.com/pricing). Bezplatný plán Renderu **nemá trvalý disk** a po 15 minutách nečinnosti se uspí, proto se hodí jen na ukázku.

## Ostrý provoz

1. **Kód na GitHubu** v soukromém repozitáři. Soubor `.env` se nenahrává (je v `.gitignore`), klíče patří jen do nastavení na Renderu.
2. **Render → New → Blueprint** → vyberte repozitář a do pole **Blueprint Path** napište `render-produkce.yaml`. Render ukáže službu `sitko` s diskem `sitko-data`. Plán je placený, platbu zadáváte sami.
3. Render se zeptá na tři hodnoty:
   - `ANTHROPIC_API_KEY`: klíč z platform.claude.com. Doporučuji si tam nastavit měsíční limit útraty.
   - `ADMIN_EMAILS`: váš e-mail, se kterým se v Sítku zaregistrujete. Uvidíte pak **Správu**.
   - `BILLING_CONTACT`: kontakt, který firmy uvidí u předplatného (e-mail, telefon).
4. **Apply.** Render sestaví Docker image (pár minut) a spustí službu. Hotovo je, když `https://<služba>.onrender.com/api/v1/health` vrátí `{"data":{"ok":true}}`.
5. Zaregistrujte svou firmu pod e-mailem z `ADMIN_EMAILS`. V levém menu se objeví **Správa**.
6. Ve Správě → **Tarify** doplňte ceny (Start 100 CV a Firma 500 CV jsou připravené bez ceny, můžete je upravit nebo přidat další).
7. Pokud chcete Sítko používat i sami, aktivujte si ve Správě vlastní firmu stejně jako zákazníkovi.

Veřejnou adresu Sítko zjistí samo z proměnné `RENDER_EXTERNAL_URL`. `PUBLIC_URL` nastavte, jen když připojíte vlastní doménu (např. `https://sitko.vasefirma.cz`).

## Placené členství: jak to běží

Ostrý provoz má zapnuté `SUBSCRIPTIONS=true`. Firma se zaregistruje sama a může si připravit pozice a požadavky. Hodnocení životopisů a návrhy z inzerátu (cokoli, co stojí peníze za AI) se zapnou až po aktivaci.

1. **Firma objedná tarif:** Nastavení → Předplatné → vyplní fakturační údaje → Objednat.
2. **Vy to uvidíte ve Správě:** filtr „Objednávky“ s počtem, objednávka je v seznamu nahoře. Otevřete firmu a tlačítkem **Kopírovat** si vezmete fakturační údaje.
3. **Vystavíte fakturu** ve svém fakturačním programu (Fakturoid, iDoklad…) a pošlete ji na e-mail firmy. Sítko faktury nevystavuje ani neposílá.
4. **Po zaplacení** otevřete firmu ve Správě, tarif už je předvyplněný, kliknete **1 měsíc** (nebo 3 / 12) a **Uložit**. Firma může hned hodnotit a objednávka zmizí.
5. **Prodloužení:** firma klikne „Prodloužit“ (vznikne nová objednávka), nebo jí rovnou pošlete další fakturu a po zaplacení přidáte měsíc. Tlačítka prodlužují od konce stávajícího předplatného.

Co se děje automaticky:

- Týden před koncem vidí firma upozornění. Po posledním zaplaceném dni se hodnocení zastaví, data jí zůstanou.
- Limit tarifu platí za kalendářní měsíc. Po vyčerpání se další životopisy nezpracují a firma uvidí, ať objedná vyšší tarif.
- Správa nevidí kandidáty ani životopisy firem, jen firmu, tarif, fakturační údaje a počty.

Sítko zatím neposílá e-maily: o nové objednávce se dozvíte ve Správě, firmě fakturu posíláte vy.

## Aktualizace

Každý push do hlavní větve na GitHubu spustí nové nasazení. Databáze i soubory zůstávají na disku a migrace databáze proběhnou při startu samy. Při přepnutí na novou verzi je aplikace na několik sekund nedostupná, protože služba s diskem nemůže běžet ve dvou kopiích najednou.

## Zálohy

Render u disku dělá snapshot jednou za 24 hodin a drží ho 7 dní, takže se lze vrátit k některému z posledních dnů. Ruční záloha: Shell služby → `cp /data/sitko.db /data/zaloha-$(date +%F).db`. Kopírujte i složku `/data/uploads`, jsou v ní originály životopisů.

## Instalace jako aplikace (PWA)

Na nasazené adrese (HTTPS) lze Sítko nainstalovat jako aplikaci:

- **Chrome / Edge na počítači:** tlačítko „Nainstalovat aplikaci“ v levém panelu Sítka, nebo ikona instalace v adresním řádku. Sítko se pak otevírá ve vlastním okně a má ikonu v nabídce Start.
- **Android (Chrome):** nabídka ⋮ → Přidat na plochu / Instalovat aplikaci.
- **iPhone/iPad (Safari):** Sdílet → Přidat na plochu.

Aplikace potřebuje připojení k internetu. Service worker záměrně neukládá data kandidátů do zařízení, při výpadku jen ukáže stránku „Sítko je offline“.

## Před prvním zákazníkem

Technicky je Sítko připravené, právně to ověřené není. Před ostrým použitím u zákazníka je potřeba:

- **Zpracovatelská smlouva (GDPR čl. 28)** mezi vámi a zákazníkem. Vy zpracováváte osobní údaje uchazečů jeho jménem. Render a Anthropic jsou vaši subdodavatelé, mají vlastní DPA.
- **Informace pro uchazeče**, že jejich CV předtřídí AI a rozhoduje člověk.
- **AI Act:** třídění uchazečů je vysoce riziková oblast. Hlavní povinnosti platí od 2. 12. 2027, ale pravidla je dobré nastavit už teď (lidský dohled, záznamy, transparentnost). Sítko na to má podklady (důkazy u každého verdiktu, auditní log, žádné automatické zamítání), samo o sobě ale soulad nezaručuje.
- Nastavte zákazníkům rozumnou **dobu uchování dat** (Nastavení → Doba uchování dat; výchozí 180 dní).

Doporučuji to projít s právníkem, který se věnuje GDPR.
