// Configurazione del negozio in Excel: esportazione e importazione con anteprima.
// Solo per la demo: nell'app reale la configurazione si gestirà dagli editor con controlli
// e storico delle versioni, non con un file compilato a mano (decisione del 20/10/2026).
//
// Regole dell'importazione, scritte anche nel foglio «Istruzioni» del file esportato:
// - le voci si riconoscono dal nome (i fornitori dal codice, se c'è; i generi dalla sigla);
// - non si cancella niente: le voci assenti dal file restano come sono;
// - un nome cambiato nel file crea una voce nuova (i nomi si cambiano dall'app);
// - nel foglio Griglie la colonna delle sottocategorie sostituisce le associazioni delle griglie elencate;
// - condizioni di pagamento e motivi di segnalazione: il foglio sostituisce l'intero elenco;
// - con anche un solo errore non si applica nulla.

import {
  M, state, salvaAnagrafica, salvaConfigurazione, logga, nuovoId, attivo, CAMPI_OBBLIGATORI, CAMPI_CARTELLINO,
} from './db.js';
import { caricaScript, condividiFile, nomeMeseRelativo, oggi } from './util.js';

const SI_NO = (v) => (v ? 'sì' : 'no');
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ');
const clona = (x) => JSON.parse(JSON.stringify(x));

// Testo di una cella ExcelJS (testo ricco, formule, collegamenti, numeri)
function testoCella(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return testoCella(v.result);
    if (v.text != null) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}
// L'archivio originale ha voci ripetute (fornitori con lo stesso nome o codice, due «Borse > Marsupi»):
// la k-esima riga del file con una certa chiave corrisponde alla k-esima voce dell'archivio con quella chiave.
function abbinatore(elenco, chiave) {
  const per = new Map();
  for (const x of elenco) {
    const k = chiave(x);
    if (!per.has(k)) per.set(k, []);
    per.get(k).push(x);
  }
  const usati = new Map();
  return (k) => {
    const i = usati.get(k) || 0;
    usati.set(k, i + 1);
    const a = per.get(k) || [];
    return { x: a[i] || null, ripetuta: i > 0 && !a[i] };
  };
}
const contaPer = (elenco, chiave) => {
  const m = new Map();
  for (const x of elenco) m.set(chiave(x), (m.get(chiave(x)) || 0) + 1);
  return m;
};

// sì/no; vuoto = non cambiare (undefined); altro = errore (null)
function siNo(v) {
  const t = norm(v);
  if (!t) return undefined;
  if (['sì', 'si', 's', 'x', '1', 'vero', 'true', 'yes'].includes(t)) return true;
  if (['no', 'n', '0', 'falso', 'false'].includes(t)) return false;
  return null;
}

// ---------------------------------------------------------------- regole (foglio «Regole»)
const MESI_REL = Array.from({ length: 24 }, (_, i) => i - 12);
const GIORNI_TESTO = (g) => g.map((x) => (x === 'fine' ? 'fine mese' : x)).join('; ');
function intero(min, max, imposta) {
  return (v, c) => {
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isInteger(n) || n < min || n > max) return `un numero intero da ${min} a ${max}`;
    imposta(c, n);
    return null;
  };
}
const REGOLE = [
  ...[...CAMPI_OBBLIGATORI.testata, ...CAMPI_OBBLIGATORI.articolo].map(([k, nome]) => ({
    etichetta: `Obbligatorio: ${nome.toLowerCase()}`,
    scrivi: (c) => SI_NO(c.obbligatori[k]),
    elenco: 'SiNo',
    leggi: (v, c) => { const x = siNo(v); if (x == null) return 'sì oppure no'; c.obbligatori[k] = x; return null; },
  })),
  { etichetta: 'Foto minime per articolo', scrivi: (c) => c.minFoto, leggi: intero(0, 10, (c, n) => { c.minFoto = n; }) },
  {
    etichetta: 'Colore in fondo al codice, dopo uno spazio', scrivi: (c) => SI_NO(c.coloreInCodice), elenco: 'SiNo',
    leggi: (v, c) => { const x = siNo(v); if (x == null) return 'sì oppure no'; c.coloreInCodice = x; return null; },
  },
  {
    etichetta: 'Limite di caratteri del cartellino (0 = nessun controllo)', scrivi: (c) => c.cartellino.limite,
    leggi: intero(0, 2000, (c, n) => { c.cartellino.limite = n; }),
  },
  {
    etichetta: 'Campi contati per il cartellino',
    scrivi: (c) => CAMPI_CARTELLINO.filter(([k]) => c.cartellino.campi.includes(k)).map(([, n]) => n).join('; '),
    leggi: (v, c) => {
      const nomi = String(v).split(/[;,]/).map(norm).filter(Boolean);
      const campi = [];
      for (const n of nomi) {
        const x = CAMPI_CARTELLINO.find(([, et]) => norm(et) === n);
        if (!x) return `nomi di campo fra: ${CAMPI_CARTELLINO.map(([, et]) => et).join(', ')}`;
        campi.push(x[0]);
      }
      if (!campi.length) return 'almeno un campo';
      c.cartellino.campi = campi;
      return null;
    },
  },
  {
    etichetta: 'Giorni di consegna ammessi', scrivi: (c) => GIORNI_TESTO(c.consegne.giorni),
    leggi: (v, c) => {
      const g = [];
      for (const t of String(v).split(/[;,]/).map(norm).filter(Boolean)) {
        if (t === 'fine' || t === 'fine mese') { if (!g.includes('fine')) g.push('fine'); continue; }
        const n = Number(t);
        if (!Number.isInteger(n) || n < 1 || n > 28) return 'giorni da 1 a 28 e/o «fine mese», separati da punto e virgola';
        if (!g.includes(n)) g.push(n);
      }
      if (!g.length) return 'almeno un giorno';
      c.consegne.giorni = g;
      return null;
    },
  },
  ...[['I', 'A/I'], ['E', 'P/E']].flatMap(([s, nome]) => [['da', 'dal mese'], ['a', 'al mese']].map(([k, et]) => ({
    etichetta: `Consegna proposta ${nome}: ${et}`, scrivi: (c) => nomeMeseRelativo(c.consegne[s][k]), elenco: 'Mesi',
    leggi: (v, c) => {
      const o = MESI_REL.find((x) => norm(nomeMeseRelativo(x)) === norm(v));
      if (o == null) return 'un mese dall\'elenco (es. «lug anno prima», «gen anno stagione»)';
      c.consegne[s] = { ...c.consegne[s], [k]: o };
      return null;
    },
  }))),
  { etichetta: 'Tolleranza sui ritardi di consegna (giorni)', scrivi: (c) => c.ritardoGiorni, leggi: intero(0, 365, (c, n) => { c.ritardoGiorni = n; }) },
  {
    etichetta: 'Avviso di sovrapposizione evidenziato da quanti fornitori', scrivi: (c) => c.sovrappFornitori,
    leggi: intero(1, 50, (c, n) => { c.sovrappFornitori = n; }),
  },
];

// ---------------------------------------------------------------- esportazione
const ISTRUZIONI = [
  'Configurazione del negozio – WHITE.7 Buying (demo)',
  '',
  'Ogni foglio è una parte della configurazione. Si può reimportare il file intero o solo alcuni fogli',
  '(dal ruolo Configurazione → Pannello → Importa da Excel). Prima di applicare, l\'app mostra un\'anteprima.',
  '',
  'Regole dell\'importazione',
  '• Le voci si riconoscono dal nome; i fornitori dal codice, se c\'è; i generi dalla sigla.',
  '• Non si cancella niente: le voci che mancano nel file restano come sono. Per non usare più una voce, scrivere «no» in Attiva.',
  '• Un nome cambiato nel file crea una voce nuova: per rinominare, usare l\'app.',
  '• Colonne Attiva/Attivo: sì oppure no (vuoto = non cambiare).',
  '• Griglie: taglie in ordine separate da punto e virgola; nella colonna Sottocategorie il nome semplice vale per tutte le',
  '  sottocategorie con quel nome, «Categoria > Sottocategoria» per una sola. La colonna sostituisce le associazioni della griglia.',
  '• Condizioni di pagamento e Segnalazioni: il foglio sostituisce l\'intero elenco, nell\'ordine scritto.',
  '• Regole: modificare solo la colonna Valore.',
  '• Se c\'è anche un solo errore, l\'app non applica nulla e indica foglio e riga da correggere.',
  '',
  'Le modifiche non cambiano gli ordini già inseriti: ogni articolo conserva sottocategoria, griglia e quantità.',
];

export async function esportaConfigurazione() {
  await caricaScript('vendor/exceljs.min.js');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WHITE.7 Buying (demo)';
  const ist = wb.addWorksheet('Istruzioni');
  ist.getColumn(1).width = 120;
  ISTRUZIONI.forEach((t, i) => { ist.getCell(i + 1, 1).value = t; });
  ist.getCell(1, 1).font = { bold: true, size: 14 };
  ist.getCell(6, 1).font = { bold: true };

  // elenchi per i menu a tendina (foglio nascosto)
  const el = wb.addWorksheet('Elenchi', { state: 'hidden' });
  el.getCell('A1').value = 'sì';
  el.getCell('A2').value = 'no';
  MESI_REL.forEach((o, i) => { el.getCell(i + 1, 2).value = nomeMeseRelativo(o); });
  const ELENCHI = { SiNo: 'Elenchi!$A$1:$A$2', Mesi: `Elenchi!$B$1:$B$${MESI_REL.length}` };
  const tendina = (ws, col, da, a, elenco) => {
    for (let r = da; r <= a; r++) ws.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, formulae: [ELENCHI[elenco]] };
  };

  const foglio = (nome, colonne, righe, colSiNo) => {
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = colonne.map(([header, width]) => ({ header, width }));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A5562' } };
    righe.forEach((r) => ws.addRow(r).alignment = { vertical: 'top', wrapText: true });
    if (colSiNo) tendina(ws, colSiNo, 2, righe.length + 200, 'SiNo');
    return ws;
  };
  const perNome = (a, b) => a.nome.localeCompare(b.nome);
  const macro = [...M.macro].sort(perNome);
  foglio('Categorie', [['Categoria', 30], ['Attiva', 9]], macro.map((m) => [m.nome, SI_NO(attivo(m))]), 2);
  foglio('Sottocategorie', [['Categoria', 24], ['Sottocategoria', 30], ['Attiva', 9]],
    macro.flatMap((m) => M.categorie.filter((c) => c.macroId === m.id).sort(perNome).map((c) => [m.nome, c.nome, SI_NO(attivo(c))])), 3);
  const nomeSub = (c) => `${M.mac.get(c.macroId)?.nome || '?'} > ${c.nome}`;
  foglio('Griglie', [['Griglia', 26], ['Taglie (separate da ;)', 40], ['Sottocategorie (separate da ;)', 80], ['Attiva', 9]],
    M.griglie.map((g) => [g.nome, g.taglie.join('; '),
      M.categorie.filter((c) => (c.griglie || []).includes(g.id)).map(nomeSub).sort().join('; '), SI_NO(attivo(g))]), 4);
  foglio('Fornitori', [['Codice', 14], ['Fornitore', 40], ['Attivo', 9]],
    [...M.fornitori].sort(perNome).map((f) => [f.cod || '', f.nome, SI_NO(attivo(f))]), 3);
  foglio('Colori', [['Colore', 24], ['Attivo', 9]], M.colori.map((c) => [c.nome, SI_NO(attivo(c))]), 2);
  foglio('Società', [['Società', 30], ['Attiva', 9]], M.aziende.map((a) => [a.nome, SI_NO(attivo(a))]), 2);
  foglio('Pagamenti', [['Condizione di pagamento', 40]], M.pagamenti.map((p) => [p]));
  foglio('Generi', [['Sigla', 8], ['Genere', 24], ['Attivo', 9]], state.cfg.generi.map((g) => [g.k, g.nome, SI_NO(g.attivo !== false)]), 3);
  foglio('Segnalazioni', [['Motivo di segnalazione', 40]], state.cfg.problemi.map((p) => [p]));
  const reg = foglio('Regole', [['Regola', 58], ['Valore', 34]], REGOLE.map((r) => [r.etichetta, r.scrivi(state.cfg)]));
  reg.getColumn(1).font = { color: { argb: 'FF555555' } };
  REGOLE.forEach((r, i) => { if (r.elenco) tendina(reg, 2, i + 2, i + 2, r.elenco); });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await condividiFile(blob, `Configurazione WHITE7 ${oggi()}.xlsx`);
}

// ---------------------------------------------------------------- importazione
// Restituisce { errori, avvisi, riepilogo, applica() }: applica() scrive solo se non ci sono errori.
export async function leggiConfigurazione(file) {
  await caricaScript('vendor/exceljs.min.js');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); } catch { throw new Error('Il file non è un Excel (.xlsx) leggibile'); }
  const errori = [], avvisi = [], riepilogo = [];
  const A = clona({ aziende: M.aziende, fornitori: M.fornitori, macro: M.macro, categorie: M.categorie, colori: M.colori, griglie: M.griglie, pagamenti: M.pagamenti });
  const C = clona(state.cfg);
  const prima = JSON.stringify({ A, C });
  let fogli = 0;

  function leggiFoglio(nome) {
    const ws = wb.worksheets.find((w) => norm(w.name) === norm(nome));
    if (!ws) return null;
    fogli++;
    // Array.from: le righe di ExcelJS sono array con buchi (celle vuote)
    const testata = Array.from((ws.getRow(1).values || []).slice(1), testoCella);
    const righe = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const v = Array.from((row.values || []).slice(1), testoCella);
      if (v.some(Boolean)) righe.push({ n, v });
    });
    // colonna Attiva/Attivo, se c'è
    const colAtt = testata.findIndex((t) => norm(t).startsWith('attiv'));
    return { nome: ws.name, righe, colAtt };
  }
  const err = (f, n, t) => errori.push(`${f}, riga ${n}: ${t}`);
  const conta = () => ({ nuove: 0, modificate: 0 });
  const riassumi = (nome, c) => {
    const p = [c.nuove && `${c.nuove} nuov${c.nuove === 1 ? 'a' : 'e'}`, c.modificate && `${c.modificate} modificat${c.modificate === 1 ? 'a' : 'e'}`].filter(Boolean);
    if (p.length) riepilogo.push(`${nome}: ${p.join(', ')}`);
  };
  // stato attivo letto dalla colonna Attiva (undefined = non cambiare)
  function statoAttivo(f, r, colAtt) {
    if (colAtt < 0) return undefined;
    const x = siNo(r.v[colAtt]);
    if (x === null) { err(f.nome, r.n, `nella colonna Attiva scrivere sì oppure no, non «${r.v[colAtt]}»`); return undefined; }
    return x;
  }
  // elenchi semplici di voci {id, nome, attivo}
  function elencoNomi(nomeFoglio, k, campoAttivo = 'attivo') {
    const f = leggiFoglio(nomeFoglio);
    if (!f) return;
    const c = conta(), trova = abbinatore(A[k], (y) => norm(y.nome));
    for (const r of f.righe) {
      const nome = r.v[0];
      if (!nome) { err(f.nome, r.n, 'manca il nome'); continue; }
      const { x, ripetuta } = trova(norm(nome));
      if (ripetuta) { err(f.nome, r.n, `«${nome}» è ripetuto`); continue; }
      const att = statoAttivo(f, r, f.colAtt);
      if (x) {
        if (att !== undefined && attivo(x) !== att) { x[campoAttivo] = att; c.modificate++; }
      } else {
        A[k].push({ id: nuovoId(A[k]), cod: '', nome, [campoAttivo]: att !== false });
        c.nuove++;
      }
    }
    riassumi(f.nome, c);
  }

  elencoNomi('Società', 'aziende');
  elencoNomi('Colori', 'colori');
  elencoNomi('Categorie', 'macro');

  // Fornitori: codice + nome; altrimenti il codice, se è di un solo fornitore (nome cambiato),
  // o il nome, se è di un solo fornitore senza codice (codice assegnato)
  {
    const f = leggiFoglio('Fornitori');
    if (f) {
      const c = conta();
      const chiave = (cod, nome) => `${norm(cod)}|${norm(nome)}`;
      const trova = abbinatore(A.fornitori, (y) => chiave(y.cod, y.nome));
      const perCod = contaPer(A.fornitori.filter((y) => y.cod), (y) => norm(y.cod));
      const perNomeSenzaCod = contaPer(A.fornitori.filter((y) => !y.cod), (y) => norm(y.nome));
      const giaAbbinati = new Set();
      for (const r of f.righe) {
        const cod = r.v[0], nome = r.v[1];
        if (!nome) { err(f.nome, r.n, 'manca il nome del fornitore'); continue; }
        let { x, ripetuta } = trova(chiave(cod, nome));
        if (ripetuta) { err(f.nome, r.n, `«${nome}»${cod ? ' (' + cod + ')' : ''} è ripetuto`); continue; }
        if (!x && cod && perCod.get(norm(cod)) === 1) x = A.fornitori.find((y) => norm(y.cod) === norm(cod));
        if (!x && cod && perNomeSenzaCod.get(norm(nome)) === 1) x = A.fornitori.find((y) => !y.cod && norm(y.nome) === norm(nome));
        if (x && giaAbbinati.has(x.id)) { err(f.nome, r.n, `«${nome}» corrisponde a un fornitore già indicato in un'altra riga`); continue; }
        if (x) giaAbbinati.add(x.id);
        const att = statoAttivo(f, r, f.colAtt);
        if (x) {
          let mod = false;
          if (x.nome !== nome) { x.nome = nome; mod = true; }
          if (cod && norm(x.cod) !== norm(cod)) { x.cod = cod; x.nuovo = false; mod = true; }
          if (att !== undefined && attivo(x) !== att) { x.valido = att; mod = true; }
          if (mod) c.modificate++;
        } else {
          A.fornitori.push({ id: nuovoId(A.fornitori), cod, nome, nuovo: !cod, valido: att !== false });
          c.nuove++;
        }
      }
      riassumi(f.nome, c);
    }
  }

  // Sottocategorie: categoria + nome; la categoria mancante si crea
  {
    const f = leggiFoglio('Sottocategorie');
    if (f) {
      const c = conta();
      const trova = abbinatore(A.categorie, (y) => `${y.macroId}>${norm(y.nome)}`);
      for (const r of f.righe) {
        const nomeMacro = r.v[0];
        let nome = r.v[1];
        if (!nomeMacro || !nome) { err(f.nome, r.n, 'servono categoria e sottocategoria'); continue; }
        // «Borse > Marsupi» nella colonna Sottocategoria (modello griglie del 15/10/2026): basta «Marsupi»
        const prefisso = `${norm(nomeMacro)} >`;
        if (norm(nome).startsWith(prefisso)) nome = nome.slice(nome.indexOf('>') + 1).trim();
        let m = A.macro.find((y) => norm(y.nome) === norm(nomeMacro));
        if (!m) {
          m = { id: nuovoId(A.macro), cod: '', nome: nomeMacro, attivo: true };
          A.macro.push(m);
          avvisi.push(`Categoria nuova: «${nomeMacro}»`);
        }
        const { x, ripetuta } = trova(`${m.id}>${norm(nome)}`);
        if (ripetuta) { err(f.nome, r.n, `«${nomeMacro} > ${nome}» è ripetuta`); continue; }
        const att = statoAttivo(f, r, f.colAtt);
        if (x) {
          if (att !== undefined && attivo(x) !== att) { x.attivo = att; c.modificate++; }
        } else {
          const altrove = A.categorie.find((y) => norm(y.nome) === norm(nome));
          if (altrove) avvisi.push(`«${nome}» esiste già in ${A.macro.find((y) => y.id === altrove.macroId)?.nome}: verrà creata anche in ${m.nome}`);
          A.categorie.push({ id: nuovoId(A.categorie), cod: '', nome, macroId: m.id, griglie: [], attivo: att !== false });
          c.nuove++;
        }
      }
      riassumi(f.nome, c);
    }
  }

  // Griglie: nome, taglie, sottocategorie (stesso formato del modello griglie mandato al cliente)
  {
    const f = leggiFoglio('Griglie');
    if (f) {
      const c = conta(), visti = new Set(), assoc = new Map();
      const nomeMacro = (id) => A.macro.find((m) => m.id === id)?.nome || '';
      const perNome = new Map();
      for (const s of A.categorie) {
        for (const k of [norm(s.nome), `${norm(nomeMacro(s.macroId))} > ${norm(s.nome)}`]) {
          if (!perNome.has(k)) perNome.set(k, []);
          perNome.get(k).push(s.id);
        }
      }
      for (const r of f.righe) {
        const [nome, taglieTxt, subTxt] = r.v;
        if (!nome) { err(f.nome, r.n, 'manca il nome della griglia'); continue; }
        if (visti.has(norm(nome))) { err(f.nome, r.n, `«${nome}» è ripetuta`); continue; }
        visti.add(norm(nome));
        const taglie = String(taglieTxt || '').split(';').map((t) => t.trim()).filter(Boolean);
        if (!taglie.length) { err(f.nome, r.n, `la griglia «${nome}» non ha taglie`); continue; }
        const dup = taglie.filter((t, i) => taglie.indexOf(t) !== i);
        if (dup.length) { err(f.nome, r.n, `taglie ripetute in «${nome}»: ${[...new Set(dup)].join(', ')}`); continue; }
        const ids = new Set();
        let ok = true;
        for (const s of String(subTxt || '').split(';').map((t) => t.trim()).filter(Boolean)) {
          const trovate = perNome.get(s.split('>').map(norm).join(' > '));
          if (!trovate) { err(f.nome, r.n, `sottocategoria sconosciuta «${s}»`); ok = false; continue; }
          trovate.forEach((id) => ids.add(id));
        }
        if (!ok) continue;
        const att = statoAttivo(f, r, f.colAtt);
        let g = A.griglie.find((y) => norm(y.nome) === norm(nome));
        if (g) {
          let mod = false;
          if (g.taglie.join('|') !== taglie.join('|')) {
            const tolte = g.taglie.filter((t) => !taglie.includes(t));
            if (tolte.length) avvisi.push(`«${g.nome}»: tolte le taglie ${tolte.join(', ')} (gli articoli già inseriti restano invariati)`);
            g.taglie = taglie;
            mod = true;
          }
          if (att !== undefined && attivo(g) !== att) { g.attivo = att; mod = true; }
          if (mod) c.modificate++;
        } else {
          g = { id: nuovoId(A.griglie), nome, taglie, attivo: att !== false };
          A.griglie.push(g);
          c.nuove++;
        }
        assoc.set(g.id, ids);
      }
      // la colonna Sottocategorie sostituisce le associazioni delle griglie elencate;
      // l'ordine delle griglie già proposte resta, le nuove vanno in fondo
      let subMod = 0;
      for (const s of A.categorie) {
        const primaG = (s.griglie || []).join(',');
        const restano = (s.griglie || []).filter((id) => !assoc.has(id) || assoc.get(id).has(s.id));
        const nuove = [...assoc.keys()].filter((id) => assoc.get(id).has(s.id) && !restano.includes(id));
        s.griglie = [...restano, ...nuove];
        if (s.griglie.join(',') !== primaG) subMod++;
      }
      riassumi(f.nome, c);
      if (subMod) riepilogo.push(`Griglie proposte cambiate in ${subMod} sottocategori${subMod === 1 ? 'a' : 'e'}`);
    }
  }

  // Elenchi di testi: il foglio sostituisce l'elenco
  function elencoTesti(nomeFoglio, attuale, imposta) {
    const f = leggiFoglio(nomeFoglio);
    if (!f) return;
    const v = [];
    for (const r of f.righe) if (r.v[0] && !v.some((x) => norm(x) === norm(r.v[0]))) v.push(r.v[0]);
    if (!v.length) { avvisi.push(`${f.nome}: foglio vuoto, elenco non cambiato`); return; }
    if (v.join('|') !== attuale.join('|')) { imposta(v); riepilogo.push(`${f.nome}: elenco sostituito (${v.length} voci)`); }
  }
  elencoTesti('Pagamenti', A.pagamenti, (v) => { A.pagamenti = v; });
  elencoTesti('Segnalazioni', C.problemi, (v) => { C.problemi = v; });

  // Generi: per sigla
  {
    const f = leggiFoglio('Generi');
    if (f) {
      const c = conta(), visti = new Set();
      for (const r of f.righe) {
        const k = (r.v[0] || '').toUpperCase(), nome = r.v[1];
        if (!k || !nome) { err(f.nome, r.n, 'servono sigla e nome'); continue; }
        if (k.length > 3) { err(f.nome, r.n, `sigla «${k}» troppo lunga (al massimo 3 caratteri)`); continue; }
        if (visti.has(k)) { err(f.nome, r.n, `sigla «${k}» ripetuta`); continue; }
        visti.add(k);
        const att = statoAttivo(f, r, f.colAtt);
        const g = C.generi.find((y) => y.k === k);
        if (g) {
          let mod = false;
          if (g.nome !== nome) { g.nome = nome; mod = true; }
          if (att !== undefined && (g.attivo !== false) !== att) { g.attivo = att; mod = true; }
          if (mod) c.modificate++;
        } else {
          C.generi.push({ k, nome, ...(att === false ? { attivo: false } : {}) });
          c.nuove++;
        }
      }
      riassumi(f.nome, c);
    }
  }

  // Regole: solo la colonna Valore
  {
    const f = leggiFoglio('Regole');
    if (f) {
      let mod = 0;
      for (const r of f.righe) {
        const regola = REGOLE.find((x) => norm(x.etichetta) === norm(r.v[0]));
        if (!regola) { avvisi.push(`${f.nome}, riga ${r.n}: regola «${r.v[0]}» non riconosciuta, ignorata`); continue; }
        if (!r.v[1] && r.v[1] !== '0') { err(f.nome, r.n, `manca il valore di «${regola.etichetta}»`); continue; }
        const primaR = String(regola.scrivi(C));
        const e = regola.leggi(r.v[1], C);
        if (e) err(f.nome, r.n, `«${regola.etichetta}»: serve ${e}`);
        else if (String(regola.scrivi(C)) !== primaR) mod++;
      }
      for (const s of ['I', 'E']) {
        if (C.consegne[s].a < C.consegne[s].da) errori.push(`${f.nome}: per ${s === 'I' ? 'A/I' : 'P/E'} il mese finale della consegna viene prima di quello iniziale`);
      }
      if (mod) riepilogo.push(`${f.nome}: ${mod} regol${mod === 1 ? 'a cambiata' : 'e cambiate'}`);
    }
  }

  if (!fogli) errori.push('Nessun foglio riconosciuto: il file deve avere fogli come Categorie, Sottocategorie, Griglie, Fornitori, Regole…');
  const nienteDaFare = JSON.stringify({ A, C }) === prima;

  async function applica() {
    if (errori.length) throw new Error('Il file contiene errori');
    for (const k of Object.keys(A)) if (JSON.stringify(A[k]) !== JSON.stringify(M[k])) await salvaAnagrafica(k, A[k]);
    if (JSON.stringify(C) !== JSON.stringify(state.cfg)) await salvaConfigurazione(C);
    await logga('Importata la configurazione da Excel', 'configurazione', null, `${file.name}: ${riepilogo.join(' · ')}`);
  }
  return { nome: file.name, errori, avvisi, riepilogo, nienteDaFare, applica };
}
