// Ricerca, report per categoria/brand, confronto stagioni, avvisi.

import { M, state, stagioneOrdine, nomeMacro, nomeCat, nomeFornitore, nomeColore, statoConsegna, chiaveBudget } from './db.js';
import { totaleRiga, stagioneNome, stagionePrec } from './util.js';

let cache = { rev: -1, righe: [] };

// Righe d'ordine unite alla testata (ricalcolate solo quando i dati cambiano)
export function righeArricchite() {
  if (cache.rev === state.rev) return cache.righe;
  const out = [];
  for (const r of M.rig.values()) {
    const o = M.ord.get(r.ordineId);
    if (!o) continue;
    out.push({ r, o, sk: stagioneOrdine(o), tot: totaleRiga(r) });
  }
  cache = { rev: state.rev, righe: out };
  return out;
}

export const FILTRI_VUOTI = () => ({
  testo: '', stagione: '', aziendaId: '', fornitoreId: '', macroId: '', catId: '', coloreId: '',
  genere: '', prezzoMin: '', prezzoMax: '', statoOrdine: '', statoConsegna: '',
});

export function cerca(f) {
  const parole = (f.testo || '').toLowerCase().split(/\s+/).filter(Boolean);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const pMin = num(f.prezzoMin), pMax = num(f.prezzoMax);
  return righeArricchite().filter(({ r, o, sk }) => {
    if (f.stagione && sk !== f.stagione) return false;
    if (f.aziendaId && o.aziendaId !== +f.aziendaId) return false;
    if (f.fornitoreId && o.fornitoreId !== +f.fornitoreId) return false;
    if (f.macroId && r.macroId !== +f.macroId) return false;
    if (f.catId && r.catId !== +f.catId) return false;
    if (f.coloreId && r.coloreId !== +f.coloreId) return false;
    if (f.genere && r.genere !== f.genere) return false;
    if (pMin != null && (r.prezzo || 0) < pMin) return false;
    if (pMax != null && (r.prezzo || 0) > pMax) return false;
    if (f.statoOrdine && o.stato !== f.statoOrdine) return false;
    if (f.statoConsegna && statoConsegna(o) !== f.statoConsegna) return false;
    if (parole.length) {
      const t = `${r.codArt} ${r.descrizione} ${r.dettagli} ${(r.vecchiCodici || []).join(' ')} ${r.composizione}`.toLowerCase();
      if (!parole.every((p) => t.includes(p))) return false;
    }
    return true;
  });
}

function somma(mappa, chiave, nome, x) {
  let g = mappa.get(chiave);
  if (!g) mappa.set(chiave, (g = { chiave, nome, pezzi: 0, valore: 0, n: 0 }));
  g.pezzi += x.r.qta || 0;
  g.valore += x.tot;
  g.n++;
  return g;
}

export function perFornitore(righe) {
  const m = new Map();
  for (const x of righe) {
    const g = somma(m, x.o.fornitoreId, nomeFornitore(x.o.fornitoreId), x);
    (g.righe || (g.righe = [])).push(x);
  }
  return [...m.values()].sort((a, b) => b.valore - a.valore);
}

function righeStagione(sk, aziendaId) {
  return righeArricchite().filter((x) => x.sk === sk && (!aziendaId || x.o.aziendaId === +aziendaId));
}

// Report sintetico: macro → sottocategoria → brand
export function sintesi(sk, aziendaId) {
  const righe = righeStagione(sk, aziendaId);
  const macro = new Map();
  let pezzi = 0, valore = 0;
  for (const x of righe) {
    pezzi += x.r.qta || 0;
    valore += x.tot;
    const g = somma(macro, x.r.macroId || 0, nomeMacro(x.r.macroId), x);
    g.cat = g.cat || new Map();
    const c = somma(g.cat, x.r.catId || 0, x.r.catId ? nomeCat(x.r.catId) : '(senza sottocategoria)', x);
    c.brand = c.brand || new Map();
    somma(c.brand, x.o.fornitoreId, nomeFornitore(x.o.fornitoreId), x);
  }
  const ord = (m) => [...m.values()].sort((a, b) => b.valore - a.valore);
  return {
    pezzi, valore,
    macro: ord(macro).map((g) => ({
      ...g, cat: ord(g.cat).map((c) => ({ ...c, brand: ord(c.brand) })),
    })),
  };
}

const CHIAVI = {
  macro: (x) => [x.r.macroId || 0, nomeMacro(x.r.macroId)],
  cat: (x) => [x.r.catId || 0, x.r.catId ? nomeCat(x.r.catId) : '(senza sottocategoria)'],
  brand: (x) => [x.o.fornitoreId, nomeFornitore(x.o.fornitoreId)],
};

// opz.finoB ('AAAA-MM-GG'): confronto "a parità di data", della stagione B si contano solo gli ordini
// inseriti entro quella data (stesso punto della campagna acquisti dell'anno prima)
export function confronto(skA, skB, livello, aziendaId, opz = {}) {
  const k = CHIAVI[livello];
  const m = new Map();
  const tot = { pA: 0, vA: 0, pB: 0, vB: 0 };
  const add = (righe, lato) => {
    for (const x of righe) {
      const [id, nome] = k(x);
      let g = m.get(id);
      if (!g) m.set(id, (g = { id, nome, pA: 0, vA: 0, pB: 0, vB: 0 }));
      g['p' + lato] += x.r.qta || 0;
      g['v' + lato] += x.tot;
      tot['p' + lato] += x.r.qta || 0;
      tot['v' + lato] += x.tot;
    }
  };
  add(righeStagione(skA, aziendaId), 'A');
  add(righeStagione(skB, aziendaId).filter((x) => !opz.finoB || (x.o.data || '').slice(0, 10) <= opz.finoB), 'B');
  const righe = [...m.values()]
    .map((g) => ({ ...g, iA: tot.vA ? (g.vA / tot.vA) * 100 : 0, iB: tot.vB ? (g.vB / tot.vB) * 100 : 0 }))
    .sort((a, b) => Math.max(b.vA, b.vB) - Math.max(a.vA, a.vB));
  return { righe, tot };
}

// Controlli semplici (non AI): cosa si comprava nella stessa stagione dell'anno prima e ora manca
export function avvisi(sk) {
  if (!sk) return [];
  const prec = stagionePrec(sk);
  const cur = righeStagione(sk), old = righeStagione(prec);
  if (!old.length) return [];
  const perCat = (righe) => {
    const m = new Map();
    for (const x of righe) if (x.r.catId) m.set(x.r.catId, (m.get(x.r.catId) || 0) + (x.r.qta || 0));
    return m;
  };
  const perCatCol = (righe) => {
    const m = new Map();
    for (const x of righe) {
      if (!x.r.catId || !x.r.coloreId) continue;
      const k = `${x.r.catId}|${x.r.coloreId}`;
      m.set(k, (m.get(k) || 0) + (x.r.qta || 0));
    }
    return m;
  };
  const cC = perCat(cur), cO = perCat(old);
  const out = [];
  for (const [cat, n] of cO) {
    if (n >= 10 && !cC.get(cat)) {
      out.push({ peso: n, testo: `Nessun acquisto di ${nomeCat(cat).toLowerCase()}`, det: `${stagioneNome(prec)}: ${n} capi` });
    }
  }
  const kC = perCatCol(cur), kO = perCatCol(old);
  for (const [k, n] of kO) {
    const [cat, col] = k.split('|').map(Number);
    if (n >= 15 && cC.get(cat) && !kC.get(k)) {
      out.push({
        peso: n * 0.8,
        testo: `${nomeCat(cat)}: nessun capo ${nomeColore(col).toLowerCase()}`,
        det: `${stagioneNome(prec)}: ${n} capi`,
      });
    }
  }
  return out.sort((a, b) => b.peso - a.peso);
}

// Budget di una stagione per livello (macro, cat, brand): voci con ordinato o budget
const NOMI = { macro: nomeMacro, cat: (id) => (id ? nomeCat(id) : '(senza sottocategoria)'), brand: nomeFornitore };
export function budgetVoci(sk, livello, aziendaId) {
  const k = CHIAVI[livello];
  const m = new Map();
  for (const x of righeStagione(sk, aziendaId)) {
    const [id, nome] = k(x);
    let g = m.get(id);
    if (!g) m.set(id, (g = { id, nome, pezzi: 0, valore: 0, budget: 0 }));
    g.pezzi += x.r.qta || 0;
    g.valore += x.tot;
  }
  const pre = `${sk}|${livello}|`;
  for (const [key, v] of M.budget) {
    if (!key.startsWith(pre)) continue;
    const raw = key.slice(pre.length);
    const id = raw === 'null' ? null : Number(raw);
    if (!m.has(id)) m.set(id, { id, nome: NOMI[livello](id), pezzi: 0, valore: 0, budget: 0 });
    m.get(id).budget = v;
  }
  for (const g of m.values()) if (!g.budget) g.budget = M.budget.get(chiaveBudget(sk, livello, g.id)) || 0;
  const voci = [...m.values()].sort((a, b) => Math.max(b.budget, b.valore) - Math.max(a.budget, a.valore));
  const tot = voci.reduce((t, g) => ({ budget: t.budget + g.budget, valore: t.valore + g.valore, pezzi: t.pezzi + g.pezzi }), { budget: 0, valore: 0, pezzi: 0 });
  return { voci, tot };
}
