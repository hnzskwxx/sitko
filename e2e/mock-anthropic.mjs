// Napodobenina Claude Messages API pro E2E testy (bez skutečného API klíče).
// Odpovědi jsou jednoduché heuristiky nad textem, slouží jen k ověření celé cesty
// aplikace (fronta, ověřování citací, UI). O kvalitě skutečného modelu nic neříká.
// Spuštění: node e2e/mock-anthropic.mjs [port]   (výchozí 4999)

import http from 'node:http';

const port = Number(process.argv[2] ?? 4999);
const DELAY = Number(process.env.MOCK_DELAY_MS ?? 1200);
const strip = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function suggest(ad) {
  const bullets = ad.split('\n').map((l) => l.trim()).filter((l) => /^[-•–]/.test(l)).map((l) => l.replace(/^[-•–]\s*/, ''));
  const reqs = bullets
    .filter((b) => /praxe|znalost|průkaz|němčin|zkušenost|maturit|excel/i.test(b))
    .map((b) => ({
      name: b.replace(/\(.*?\)/g, '').replace(/\s+–.*$/, '').trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 60),
      description: b,
      category: /němčin|angli/i.test(b) ? 'jazyky' : /maturit|vzdělání/i.test(b) ? 'vzdelani' : /praxe/i.test(b) ? 'zkusenosti' : /průkaz/i.test(b) ? 'ostatni' : 'dovednosti',
      weight: /podmínk/i.test(b) ? 3 : /výhod/i.test(b) ? 1 : 2,
      must_have: /podmínk/i.test(b),
      ad_quote: b,
    }));
  // Úmyslně vymyšlený povinný požadavek bez opory v inzerátu: server ho nesmí přijmout jako povinný
  reqs.push({ name: 'Vysokoškolské vzdělání', description: 'VŠ v oboru', category: 'vzdelani', weight: 3, must_have: true, ad_quote: 'vysokoškolské vzdělání v oboru nutné' });
  return { position: ad.split('\n')[0].trim(), requirements: reqs };
}

function evaluate(text) {
  const reqs = [...text.matchAll(/- id: (\S+)\n {2}název: (.+)\n {2}co ověřit: (.+)/g)].map((m) => ({ id: m[1], name: m[2], what: m[3] }));
  const cv = (text.split('<zivotopis>')[1] ?? '').split('</zivotopis>')[0].replace(/=== Strana \d+ ===\n?/g, '');
  const lines = cv.split('\n').map((l) => l.replace(/^[–\-•\s]+/, '').trim()).filter((l) => l.length > 3);
  const results = reqs.map((r) => {
    const keys = strip(`${r.name} ${r.what}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !['praxe', 'aspon', 'komunikativni', 'urovni', 'vzdelani'].includes(w));
    const hit = lines.find((l) => keys.some((k) => strip(l).includes(k.slice(0, 6))));
    return hit
      ? { id: r.id, verdict: 'splnuje', quote: hit.slice(0, 160), quote_cs: '', explanation: 'Doloženo v životopise.', limitations: '' }
      : { id: r.id, verdict: 'nelze_overit', quote: '', quote_cs: '', explanation: 'V životopise neuvedeno.', limitations: '' };
  });
  return {
    candidate: { name: lines[0] ?? 'Neznámý', email: (cv.match(/[\w.]+@[\w.]+\.\w+/) ?? [''])[0], phone: '', current_role: lines[2] ?? '' },
    profile: { skills: [], experience: [], education: [], languages: [], certifications: [] },
    requirements: results,
    summary: `Doloženo ${results.filter((r) => r.verdict === 'splnuje').length} z ${results.length} požadavků (testovací napodobenina AI).`,
    strengths: ['Testovací silná stránka'], concerns: ['Testovací bod k ověření'], interview_questions: ['Testovací otázka?'],
    injection_detected: /ignore all previous/i.test(cv),
  };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const j = JSON.parse(body || '{}');
    const system = String(j.system ?? '');
    const content = j.messages?.[0]?.content;
    const text = typeof content === 'string' ? content : (content ?? []).map((b) => b.text ?? '').join('\n');
    let out;
    if (system.includes('pracovního inzerátu')) out = suggest(text.replace(/<\/?inzerat>/g, ''));
    else if (system.includes('PRVNÍM tříděním')) { await new Promise((r) => setTimeout(r, DELAY)); out = evaluate(text); }
    else out = { readable: false, pages: [] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_mock', type: 'message', role: 'assistant', model: j.model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 2000, output_tokens: 600 },
    }));
  });
}).listen(port, () => console.log(`mock-anthropic na http://127.0.0.1:${port}`));
