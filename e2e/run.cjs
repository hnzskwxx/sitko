// E2E scénáře v prohlížeči (Playwright). Předpoklad: běží Sítko a e2e/mock-anthropic.mjs.
//   node e2e/mock-anthropic.mjs 4999 &
//   PORT=3300 DATA_DIR=/tmp/sitko-e2e ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://127.0.0.1:4999 npm run dev &
//   node e2e/run.cjs http://localhost:3300 ./e2e-vystup
// Vyžaduje balíček playwright s prohlížečem Chromium (npx playwright install chromium).

const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:3300';
const OUT = process.argv[3] ?? 'e2e-vystup';
const SAMPLES = path.join(__dirname, '..', 'ukazka');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✔ ${name}`);
  } catch (err) {
    const detail = err.message.split('\n').filter((l) => /waiting for|Error|expected/i.test(l)).slice(0, 3).join(' | ');
    results.push({ name, ok: false, error: detail || err.message.split('\n')[0] });
    console.log(`✘ ${name}: ${detail || err.message.split('\n')[0]}`);
    throw err;
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const shot = (n, full = true) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
  const email = `e2e-${Date.now()}@firma.cz`;
  let jobUrl = '';

  try {
    await step('1. Registrace, odhlášení a přihlášení', async () => {
      await page.goto(`${BASE}/registrace`);
      await page.getByLabel('Název firmy').fill('Testovací s.r.o.');
      await page.getByLabel('Vaše jméno').fill('Tereza Testová');
      await page.getByLabel('Pracovní e-mail').fill(email);
      await page.getByLabel('Heslo').fill('kratke');
      await page.getByRole('button', { name: 'Vytvořit účet' }).click();
      await page.getByText('Heslo musí mít aspoň 10 znaků.').waitFor();
      await page.getByLabel('Heslo').fill('dlouhe-heslo-pro-e2e');
      await page.getByRole('button', { name: 'Vytvořit účet' }).click();
      await page.getByRole('heading', { name: 'Přehled' }).waitFor();
      await shot('01-prehled-prazdny');
      await page.getByRole('button', { name: 'Účet a odhlášení' }).click();
      await page.getByRole('menuitem', { name: 'Odhlásit se' }).click();
      await page.getByRole('heading', { name: 'Přihlášení' }).waitFor();
      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Heslo').fill('spatne-heslo-xx');
      await page.getByRole('button', { name: 'Přihlásit se' }).click();
      await page.getByText('E-mail nebo heslo nesedí.').waitFor();
      await page.getByLabel('Heslo').fill('dlouhe-heslo-pro-e2e');
      await page.getByRole('button', { name: 'Přihlásit se' }).click();
      await page.getByRole('heading', { name: 'Přehled' }).waitFor();
    });

    await step('2–3. Vytvoření pozice a vložení inzerátu (i ze souboru)', async () => {
      await page.keyboard.press('n');
      await page.getByRole('heading', { name: 'Nová pozice' }).waitFor();
      await page.getByRole('button', { name: 'Pokračovat k požadavkům' }).click();
      await page.getByText('Vyplňte název pozice.').waitFor();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Načíst inzerát ze souboru' }).click()]);
      await chooser.setFiles(path.join(SAMPLES, 'inzerat.txt'));
      await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('Zahradník'));
      await page.getByLabel('Název pozice').fill('Obchodní referent/ka');
      await shot('02-nova-pozice');
      await page.getByRole('button', { name: 'Pokračovat k požadavkům' }).click();
      await page.getByRole('heading', { name: 'Zkontrolujte požadavky' }).waitFor();
      jobUrl = page.url().replace(/\/pozadavky$/, '');
    });

    await step('4. Návrh a úprava požadavků', async () => {
      await page.getByText('Citaci jsme v inzerátu nenašli').waitFor();
      const vs = page.locator('.req').filter({ has: page.locator('input[value="Vysokoškolské vzdělání"]') });
      expect(!(await vs.getByRole('checkbox').isChecked()), 'Vymyšlený požadavek nesmí být povinný');
      await shot('03-pozadavky-navrh');
      await vs.getByRole('button', { name: 'Odebrat požadavek' }).click();
      await page.getByRole('button', { name: 'Přidat požadavek' }).click();
      await page.getByLabel(/Název požadavku \d+/).last().fill('Angličtina');
      await page.getByRole('button', { name: 'Potvrdit požadavky a aktivovat pozici' }).click();
      await page.getByRole('dialog', { name: 'Nahrát životopisy' }).waitFor();
    });

    await step('5. Nahrání životopisů včetně chybných souborů', async () => {
      const bad = path.join(OUT, 'poskozeny.pdf');
      fs.writeFileSync(bad, '%PDF-1.4\nToto neni platne PDF');
      const doc = path.join(OUT, 'stary.doc');
      fs.writeFileSync(doc, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
      const files = ['Kristyna_Vlckova_CV.pdf', 'Michal_Dolezal_CV.docx', 'Anna_Sykorova.txt', 'Daniel_Ruzicka_Resume_EN.pdf', 'Radek_Polak_zivotopis.pdf']
        .map((f) => path.join(SAMPLES, f)).concat([bad, doc]);
      await page.locator('.drop input[type=file]').setInputFiles(files);
      await page.getByText('Formát souboru neumíme přečíst').or(page.getByText('Tento formát neumíme přečíst')).first().waitFor();
      await page.locator('.upload-row .badge-success').nth(5).waitFor();
      await shot('04-nahravani', false);
      await page.locator('.drop input[type=file]').setInputFiles([path.join(SAMPLES, 'Anna_Sykorova.txt')]);
      await page.getByText('Tento soubor už u pozice je.').waitFor();
      await page.getByRole('button', { name: 'Hotovo' }).click();
    });

    await step('6. Průběh zpracování', async () => {
      await page.locator('[role=status]').filter({ hasText: /Ve frontě|Čtu dokument|Hodnotím/ }).first().waitFor({ timeout: 10_000 });
      await shot('05-zpracovani');
    });

    await step('7. Výsledky v tabulce, filtry a řazení', async () => {
      await page.waitForFunction(() => !document.querySelector('table[aria-label="Kandidáti"] .spin'), null, { timeout: 60_000 });
      await page.getByText('PDF je poškozené a nejde přečíst.').waitFor();
      const rows = await page.locator('table[aria-label="Kandidáti"] tbody tr').count();
      expect(rows === 6, `Čekáno 6 řádků, je ${rows}`);
      await shot('06-vysledky');
      await page.keyboard.press('/');
      await page.keyboard.type('Anna');
      await page.waitForFunction(() => document.querySelectorAll('table[aria-label="Kandidáti"] tbody tr').length === 1);
      expect(page.url().includes('q=Anna'), 'Filtr musí být v URL');
      await page.getByRole('button', { name: 'Zrušit filtry' }).first().click();
      await page.getByRole('button', { name: /^Kandidát/ }).click();
      await page.waitForFunction(() => location.search.includes('sort=name'));
    });

    await step('8. Detail kandidáta: důkazy, oprava verdiktu, rozhodnutí, poznámka', async () => {
      await page.locator('table[aria-label="Kandidáti"] tbody tr').filter({ hasText: 'Kristýna' }).click();
      await page.getByRole('heading', { name: 'Požadavky a důkazy' }).waitFor();
      expect(await page.locator('.evidence-quote mark').count() > 0, 'Chybí ověřené citace');
      await shot('07-detail');
      await page.getByRole('button', { name: 'Opravit' }).first().click();
      await page.getByRole('dialog').getByText('Nelze ověřit').click();
      await page.getByRole('button', { name: 'Uložit opravu' }).click();
      await page.getByText('Vyplňte důvod opravy.').or(page.getByText('Napište krátce, proč verdikt opravujete.')).first().waitFor();
      await page.getByLabel('Důvod opravy').fill('Ověřím na pohovoru.');
      await page.getByRole('button', { name: 'Uložit opravu' }).click();
      await page.getByText('Verdikt opraven, shoda přepočítána.').waitFor();
      await page.getByText(/Podle AI původně/).waitFor();
      await page.getByRole('button', { name: 'Pozvat', exact: true }).click();
      await page.getByText('Uloženo: pozvat na pohovor.').waitFor();
      await page.getByLabel('Nová poznámka').fill('Zavolat v pondělí.');
      await page.getByRole('button', { name: 'Přidat poznámku' }).click();
      await page.locator('.note-body', { hasText: 'Zavolat v pondělí.' }).waitFor();
      await page.reload();
      await page.locator('.note-body', { hasText: 'Zavolat v pondělí.' }).waitFor();
      expect(await page.getByRole('button', { name: 'Pozvat', exact: true }).getAttribute('aria-pressed') === 'true', 'Rozhodnutí nepřetrvalo obnovení');
      await page.getByRole('button', { name: 'Text s citacemi' }).click();
      await page.getByRole('dialog', { name: 'Text životopisu' }).locator('mark').first().waitFor();
      await page.waitForTimeout(300);
      await shot('08-text-cv', false);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByRole('link', { name: 'Zpět na kandidáty' }).click();
      await page.waitForFunction(() => location.search.includes('sort=name'));
    });

    await step('9. Chybný dokument: chyba a opakování', async () => {
      const row = page.locator('table[aria-label="Kandidáti"] tbody tr').filter({ hasText: 'poskozeny.pdf' });
      await row.getByText('PDF je poškozené a nejde přečíst.').waitFor();
      await row.getByRole('button', { name: 'Zkusit znovu' }).click();
      await page.getByText('Zpracování spuštěno znovu.').waitFor();
      await row.getByText('PDF je poškozené a nejde přečíst.').waitFor({ timeout: 20_000 });
    });

    await step('Ovládání klávesnicí a paleta příkazů', async () => {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('obchod');
      await page.getByRole('option', { name: /Obchodní referent/ }).waitFor();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /^\/pozice\/[0-9a-f-]+$/.test(location.pathname) && !location.search);
      const first = page.locator('table[aria-label="Kandidáti"] tbody tr').first();
      await first.focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.getByRole('link', { name: 'Zpět na kandidáty' }).waitFor();
    });

    await step('Tým: pozvánka a nastavení', async () => {
      await page.goto(`${BASE}/nastaveni/tym`);
      await page.getByRole('button', { name: 'Vytvořit odkaz' }).click();
      await page.getByText('/pozvanka/').waitFor();
      await shot('09-tym');
      await page.goto(`${BASE}/nastaveni/zpracovani`);
      await page.getByText('Připraveno').waitFor();
    });

    await step('10. Menší displej a tmavý režim', async () => {
      const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(), colorScheme: 'light' });
      const mp = await m.newPage();
      await mp.goto(jobUrl);
      await mp.locator('table[aria-label="Kandidáti"]').waitFor();
      const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow <= 0, `Stránka přetéká o ${overflow}px`);
      await mp.screenshot({ path: path.join(OUT, '10-mobil-kandidati.png'), fullPage: true });
      await mp.locator('table[aria-label="Kandidáti"] tbody tr').filter({ hasText: 'Michal' }).click();
      await mp.getByRole('heading', { name: 'Požadavky a důkazy' }).waitFor();
      const overflow2 = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow2 <= 0, `Detail přetéká o ${overflow2}px`);
      await mp.screenshot({ path: path.join(OUT, '11-mobil-detail.png'), fullPage: true });
      await mp.getByRole('button', { name: 'Otevřít menu' }).click();
      await mp.getByRole('link', { name: 'Nastavení' }).waitFor();
      await m.close();
      const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await ctx.storageState(), colorScheme: 'dark' });
      const dp = await dctx.newPage();
      await dp.goto(jobUrl);
      await dp.locator('table[aria-label="Kandidáti"]').waitFor();
      await dp.screenshot({ path: path.join(OUT, '12-tmavy.png'), fullPage: true });
      await dctx.close();
    });
  } catch {
    await shot('chyba').catch(() => {});
  } finally {
    // 4xx odpovědi na úmyslně chybné vstupy (validace, špatné heslo) prohlížeč loguje jako chybu načtení
    const ignorable = (e) => /favicon/.test(e) || /status of 4\d\d/.test(e);
    const errs = consoleErrors.filter((e) => !ignorable(e));
    fs.writeFileSync(path.join(OUT, 'vysledek.json'), JSON.stringify({ results, consoleErrors: errs }, null, 2));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scénářů prošlo. Chyby v konzoli: ${errs.length}`);
    if (errs.length) console.log(errs.slice(0, 10).join('\n'));
    await browser.close();
    process.exit(results.every((r) => r.ok) && !errs.length ? 0 : 1);
  }
})();
