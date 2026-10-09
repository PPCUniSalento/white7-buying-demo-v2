// Dati: IndexedDB (Dexie) come archivio, copia in memoria (M) per ricerche e report.
// Tutte le scritture passano da qui: aggiornano IndexedDB, M e state.rev.

import { RUOLI, stagioneKey, stagioneOrd, stagioneSucc, consegnaStagione, oraIso, controllaCodice, totaleRiga } from './util.js';

const { reactive } = Vue;

export const db = new Dexie('white7-buying');
db.version(1).stores({
  anag: 'k',
  ordini: '++id, stato',
  righe: '++id, ordineId',
  foto: '++id, rigaId',
  messaggi: '++id, a, ordineId',
  distinte: '++id, ordineId',
  log: '++id',
  meta: 'k',
});

const IMP_DEFAULT = { stagioneLavoro: null, minFoto: 3, genereDefault: 'U', aziendaDefault: 5 };

export const state = reactive({
  pronto: false,
  haDati: false,
  rev: 0,
  ruolo: leggiLocale('ruolo') || 'buyer',
  imp: { ...IMP_DEFAULT },
  toast: null,
});

function leggiLocale(k) {
  try { return localStorage.getItem('w7.' + k); } catch { return null; }
}
export function scriviLocale(k, v) {
  try { localStorage.setItem('w7.' + k, v); } catch { /* storage non disponibile */ }
}

// Modello in memoria (non reattivo: la reattività passa da state.rev)
export const M = {
  aziende: [], fornitori: [], macro: [], categorie: [], colori: [], griglie: [], pagamenti: [],
  az: new Map(), forn: new Map(), mac: new Map(), cat: new Map(), col: new Map(), gri: new Map(),
  ord: new Map(), rig: new Map(), righePerOrdine: new Map(),
  foto: new Map(), fotoPerRiga: new Map(),
  messaggi: new Map(), distinte: new Map(), log: [],
};

const tocca = () => { state.rev++; };

function indicizzaAnagrafiche() {
  M.az = new Map(M.aziende.map((x) => [x.id, x]));
  M.forn = new Map(M.fornitori.map((x) => [x.id, x]));
  M.mac = new Map(M.macro.map((x) => [x.id, x]));
  M.cat = new Map(M.categorie.map((x) => [x.id, x]));
  M.col = new Map(M.colori.map((x) => [x.id, x]));
  M.gri = new Map(M.griglie.map((x) => [x.id, x]));
}
function aggiungiARigheOrdine(r) {
  let a = M.righePerOrdine.get(r.ordineId);
  if (!a) M.righePerOrdine.set(r.ordineId, (a = []));
  const i = a.findIndex((x) => x.id === r.id);
  if (i >= 0) a[i] = r; else a.push(r);
}
function ordinaFotoRiga(rigaId) {
  const a = M.fotoPerRiga.get(rigaId);
  if (a) a.sort((x, y) => x.ord - y.ord || x.id - y.id);
}

export async function carica() {
  const anag = await db.anag.toArray();
  for (const { k, v } of anag) M[k] = v;
  indicizzaAnagrafiche();
  M.ord = new Map((await db.ordini.toArray()).map((o) => [o.id, o]));
  M.rig = new Map();
  M.righePerOrdine = new Map();
  for (const r of await db.righe.toArray()) { M.rig.set(r.id, r); aggiungiARigheOrdine(r); }
  M.foto = new Map();
  M.fotoPerRiga = new Map();
  for (const f of await db.foto.toArray()) {
    M.foto.set(f.id, f);
    if (!M.fotoPerRiga.has(f.rigaId)) M.fotoPerRiga.set(f.rigaId, []);
    M.fotoPerRiga.get(f.rigaId).push(f);
  }
  for (const k of M.fotoPerRiga.keys()) ordinaFotoRiga(k);
  M.messaggi = new Map((await db.messaggi.toArray()).map((m) => [m.id, m]));
  M.distinte = new Map((await db.distinte.toArray()).map((d) => [d.id, d]));
  M.log = await db.log.toArray();
  const imp = await db.meta.get('impostazioni');
  state.imp = { ...IMP_DEFAULT, ...(imp ? imp.v : {}) };
  if (!state.imp.stagioneLavoro) state.imp.stagioneLavoro = stagioni()[0] || null;
  state.haDati = M.ord.size > 0 || M.fornitori.length > 0;
  state.pronto = true;
  tocca();
}

// ---------- archivio iniziale ----------
async function decomprimi(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const testo = await new Response(new Blob([u8]).stream().pipeThrough(ds)).text();
    return JSON.parse(testo);
  }
  return JSON.parse(new TextDecoder().decode(u8));
}

export async function importaSeed(buf) {
  const s = await decomprimi(buf);
  if (s.formato !== 'white7-seed') throw new Error('Il file non è un archivio WHITE.7 valido');
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
    for (const k of ['aziende', 'fornitori', 'macro', 'categorie', 'colori', 'griglie', 'pagamenti']) {
      await db.anag.put({ k, v: s[k] || [] });
    }
    await db.ordini.bulkAdd(s.ordini);
    await db.righe.bulkAdd(s.righe);
    await db.meta.put({ k: 'seed', v: new Blob([buf]) });
    await db.meta.put({ k: 'seedInfo', v: { generato: s.generato, caricato: oraIso() } });
  });
  await carica();
  // stagione di lavoro proposta: quella successiva all'ultima presente nei dati
  state.imp.stagioneLavoro = stagioni()[0] ? stagioneSucc(stagioni()[0]) : null;
  await salvaImpostazioni();
  // Gli ordini già trasmessi nello storico arrivano nelle caselle dei ruoli destinatari
  const trasmessi = [...M.ord.values()].filter((o) => o.stato === 'trasmesso');
  for (const o of trasmessi) {
    for (const dest of ['amministrazione', 'logistica', 'puntovendita']) {
      await aggiungiMessaggio({
        a: dest, da: 'buyer', tipo: 'ordine', ordineId: o.id, data: o.dtTrasm || o.data, letto: true,
        titolo: titoloOrdine(o), payload: pacchetto(o.id, dest),
      });
    }
  }
  await logga('Importazione archivio dati', 'archivio', null, `${M.ord.size} ordini, ${M.rig.size} righe`);
  tocca();
}

export async function ripristina() {
  const rec = await db.meta.get('seed');
  if (!rec) throw new Error('Archivio originale non disponibile: ricaricare il file');
  const buf = await rec.v.arrayBuffer();
  await importaSeed(buf);
}

export async function salvaImpostazioni() {
  await db.meta.put({ k: 'impostazioni', v: { ...state.imp } });
  tocca();
}

// ---------- letture ----------
export const nomeAzienda = (id) => M.az.get(id)?.nome || '–';
export const nomeFornitore = (id) => M.forn.get(id)?.nome || (id == null ? 'Fornitore da scegliere' : 'Fornitore sconosciuto');
export const nomeMacro = (id) => M.mac.get(id)?.nome || 'Senza categoria';
export const nomeCat = (id) => M.cat.get(id)?.nome || '–';
export const nomeColore = (id) => M.col.get(id)?.nome || '–';
export const righeOrdine = (id) => M.righePerOrdine.get(id) || [];
export const fotoRiga = (id) => M.fotoPerRiga.get(id) || [];
export const fotoPrincipale = (id) => fotoRiga(id)[0] || null;
export const stagioneOrdine = (o) => stagioneKey(o.anno, o.stagione);
export const titoloOrdine = (o) => `Ordine n. ${o.id} – ${nomeFornitore(o.fornitoreId)}`;

export function stagioni() {
  const s = new Set();
  for (const o of M.ord.values()) s.add(stagioneOrdine(o));
  return [...s].sort((a, b) => stagioneOrd(b) - stagioneOrd(a));
}

export function riepilogo(righe, scontoExtra = 0) {
  const perMacro = new Map();
  let pezzi = 0, valore = 0;
  for (const r of righe) {
    const v = totaleRiga(r);
    pezzi += r.qta || 0;
    valore += v;
    const mk = r.macroId || 0;
    if (!perMacro.has(mk)) perMacro.set(mk, { id: mk, nome: nomeMacro(r.macroId), pezzi: 0, valore: 0, cat: new Map() });
    const m = perMacro.get(mk);
    m.pezzi += r.qta || 0;
    m.valore += v;
    const ck = r.catId || 0;
    if (!m.cat.has(ck)) m.cat.set(ck, { id: ck, nome: r.catId ? nomeCat(r.catId) : '(senza sottocategoria)', pezzi: 0, valore: 0 });
    const c = m.cat.get(ck);
    c.pezzi += r.qta || 0;
    c.valore += v;
  }
  const macro = [...perMacro.values()].sort((a, b) => b.valore - a.valore)
    .map((m) => ({ ...m, cat: [...m.cat.values()].sort((a, b) => b.valore - a.valore) }));
  return { pezzi, valore, scontato: valore * (1 - (scontoExtra || 0) / 100), macro };
}

// Quantità già ricevuta per riga, sommando tutte le distinte dell'ordine
export function ricevutoPerRiga(ordineId) {
  const m = new Map();
  for (const d of M.distinte.values()) {
    if (d.ordineId !== ordineId) continue;
    for (const r of d.righe) m.set(r.rigaId, (m.get(r.rigaId) || 0) + (r.ricevuti || 0));
  }
  return m;
}

export function statoConsegna(o) {
  if (o.stato === 'bozza' || o.stato === 'confermato') return 'non trasmesso';
  if (o.stato === 'trasmesso') return 'in attesa';
  if (o.stato === 'parziale') return 'parziale';
  return 'consegnato';
}

// Testo leggibile di una modifica per il registro (nomi al posto degli ID)
const ETICHETTE_CAMPI = {
  aziendaId: 'società', fornitoreId: 'fornitore', anno: 'anno', stagione: 'stagione', pagamento: 'pagamento',
  consegnaDa: 'consegna da', consegnaA: 'consegna a', scontoExtra: 'sconto extra %', note: 'note',
  codArt: 'codice', continuativo: 'continuativo', vecchiCodici: 'vecchi codici', macroId: 'categoria', catId: 'sottocategoria',
  coloreId: 'colore', genere: 'genere', prezzo: 'prezzo', sconto: 'sconto %', qta: 'pezzi', grigliaId: 'griglia',
  taglie: 'taglie', descrizione: 'descrizione', dettagli: 'dettagli', misure: 'misure', composizione: 'composizione',
};
function valoreLeggibile(k, v) {
  if (v == null || v === '') return '–';
  switch (k) {
    case 'aziendaId': return nomeAzienda(v);
    case 'fornitoreId': return nomeFornitore(v);
    case 'macroId': return nomeMacro(v);
    case 'catId': return nomeCat(v);
    case 'coloreId': return nomeColore(v);
    case 'grigliaId': return M.gri.get(v)?.nome || v;
    case 'continuativo': return v ? 'sì' : 'no';
    case 'vecchiCodici': return v.join(', ') || '–';
    case 'taglie': return Object.entries(v).filter(([, q]) => q).map(([t, q]) => `${t}:${q}`).join(' ') || '–';
    default: return String(v);
  }
}
export const descriviCambio = (k, prima, dopo) =>
  `${ETICHETTE_CAMPI[k] || k}: ${valoreLeggibile(k, prima)} → ${valoreLeggibile(k, dopo)}`;

// ---------- scritture ----------
export async function logga(azione, entita, entitaId, dettagli = '', extra = {}) {
  const e = { ts: oraIso(), ruolo: state.ruolo, azione, entita, entitaId, dettagli, ...extra };
  e.id = await db.log.add(e);
  M.log.push(e);
}

export async function salvaOrdine(o) {
  const x = JSON.parse(JSON.stringify(o));
  x.modificato = oraIso();
  x.id = await db.ordini.put(x);
  M.ord.set(x.id, x);
  tocca();
  return x;
}

export async function nuovoOrdine() {
  const sk = state.imp.stagioneLavoro || stagioni()[0];
  const anno = parseInt(sk.slice(0, 4), 10), stag = sk.slice(4);
  const [consegnaDa, consegnaA] = consegnaStagione(anno, stag);
  const o = await salvaOrdine({
    aziendaId: state.imp.aziendaDefault, fornitoreId: null, data: oraIso(), anno, stagione: stag,
    stato: 'bozza', pagamento: null,
    consegnaDa, consegnaA,
    scontoExtra: 0, note: '', dtTrasm: null, storico: false, creatoDa: state.ruolo, creato: oraIso(),
  });
  await logga('Creato ordine', 'ordine', o.id);
  return o;
}

export async function eliminaOrdine(id) {
  for (const r of [...righeOrdine(id)]) await eliminaRiga(r.id, { silenzioso: true });
  await db.ordini.delete(id);
  M.ord.delete(id);
  M.righePerOrdine.delete(id);
  await logga('Eliminato ordine (bozza)', 'ordine', id);
  tocca();
}

export async function salvaRiga(r) {
  const x = JSON.parse(JSON.stringify(r));
  x.modificato = oraIso();
  x.id = await db.righe.put(x);
  M.rig.set(x.id, x);
  aggiungiARigheOrdine(x);
  tocca();
  return x;
}

export async function eliminaRiga(id, { silenzioso = false } = {}) {
  const r = M.rig.get(id);
  if (!r) return;
  for (const f of [...fotoRiga(id)]) {
    await db.foto.delete(f.id);
    M.foto.delete(f.id);
  }
  M.fotoPerRiga.delete(id);
  await db.righe.delete(id);
  M.rig.delete(id);
  const a = M.righePerOrdine.get(r.ordineId);
  if (a) a.splice(a.findIndex((x) => x.id === id), 1);
  if (!silenzioso) await logga('Eliminato articolo', 'articolo', id, r.codArt, { ordineId: r.ordineId });
  tocca();
}

export async function aggiungiFoto(rigaId, { blob, thumb }) {
  const elenco = fotoRiga(rigaId);
  const f = { rigaId, ord: elenco.length ? elenco[elenco.length - 1].ord + 1 : 0, blob, thumb, creata: oraIso() };
  f.id = await db.foto.add(f);
  M.foto.set(f.id, f);
  if (!M.fotoPerRiga.has(rigaId)) M.fotoPerRiga.set(rigaId, []);
  M.fotoPerRiga.get(rigaId).push(f);
  tocca();
  return f;
}

export async function eliminaFoto(id) {
  const f = M.foto.get(id);
  if (!f) return;
  await db.foto.delete(id);
  M.foto.delete(id);
  const a = M.fotoPerRiga.get(f.rigaId);
  if (a) a.splice(a.indexOf(f), 1);
  tocca();
}

export async function riordinaFoto(rigaId, ids) {
  ids.forEach((id, i) => { const f = M.foto.get(id); if (f) f.ord = i; });
  await db.foto.bulkPut(ids.map((id) => M.foto.get(id)));
  ordinaFotoRiga(rigaId);
  tocca();
}

// Controlli bloccanti prima della conferma dell'ordine
export function erroriRiga(r) {
  const e = [];
  const ec = controllaCodice(r.codArt);
  if (ec) e.push(ec);
  if (!r.macroId) e.push('Categoria obbligatoria');
  if (!r.catId) e.push('Sottocategoria obbligatoria');
  if (!r.coloreId) e.push('Colore obbligatorio');
  if (!r.genere) e.push('Genere obbligatorio');
  if (!(r.prezzo > 0)) e.push('Prezzo obbligatorio');
  if (!(r.qta > 0)) e.push('Quantità obbligatoria');
  const nf = fotoRiga(r.id).length;
  if (nf < state.imp.minFoto) e.push(`Foto: ${nf} su ${state.imp.minFoto} minime`);
  return e;
}
export function erroriOrdine(o) {
  const e = [];
  if (!o.aziendaId) e.push('Società obbligatoria');
  if (!o.fornitoreId) e.push('Fornitore obbligatorio');
  if (!o.pagamento) e.push('Condizioni di pagamento obbligatorie');
  if (!o.consegnaDa || !o.consegnaA) e.push('Periodo di consegna obbligatorio');
  else if (o.consegnaA < o.consegnaDa) e.push('Periodo di consegna non valido');
  const righe = righeOrdine(o.id);
  if (!righe.length) e.push('Nessun articolo inserito');
  const conErrori = righe.filter((r) => erroriRiga(r).length).length;
  if (conErrori) e.push(`${conErrori} articol${conErrori === 1 ? 'o incompleto' : 'i incompleti'}`);
  return e;
}

export async function cambiaStato(id, stato, nota = '') {
  const o = M.ord.get(id);
  const da = o.stato;
  await salvaOrdine({ ...o, stato });
  await logga(`Stato ordine: ${da} → ${stato}`, 'ordine', id, nota);
}

// Pacchetto trasmesso: copia dell'ordine filtrata secondo il ruolo destinatario
export function pacchetto(ordineId, ruoloDest) {
  const o = M.ord.get(ordineId);
  const prezzi = RUOLI[ruoloDest].prezzi;
  const testa = {
    id: o.id, azienda: nomeAzienda(o.aziendaId), fornitore: nomeFornitore(o.fornitoreId),
    stagione: stagioneOrdine(o), data: o.data, consegnaDa: o.consegnaDa, consegnaA: o.consegnaA, note: o.note || '',
  };
  if (prezzi) Object.assign(testa, { pagamento: o.pagamento, scontoExtra: o.scontoExtra || 0 });
  const righe = righeOrdine(ordineId).map((r) => {
    const x = {
      id: r.id, codArt: r.codArt, vecchiCodici: r.vecchiCodici || [], continuativo: !!r.continuativo,
      macro: nomeMacro(r.macroId), categoria: r.catId ? nomeCat(r.catId) : '', colore: r.coloreId ? nomeColore(r.coloreId) : '',
      genere: r.genere, qta: r.qta || 0, taglie: r.taglie || null, griglia: r.grigliaId ? M.gri.get(r.grigliaId)?.nome : null,
      descrizione: r.descrizione || '', dettagli: r.dettagli || '', misure: r.misure || '',
      composizione: r.composizione || '', note: r.note || '', foto: fotoRiga(r.id).map((f) => f.id),
    };
    if (prezzi) Object.assign(x, { prezzo: r.prezzo, sconto: r.sconto || 0 });
    return x;
  });
  return { testa, righe, prezzi, ruolo: ruoloDest };
}

async function aggiungiMessaggio(m) {
  m.id = await db.messaggi.add(m);
  M.messaggi.set(m.id, m);
  return m;
}

export async function segnaLetto(id) {
  const m = M.messaggi.get(id);
  if (!m || m.letto) return;
  m.letto = true;
  await db.messaggi.put(m);
  tocca();
}

export async function trasmetti(ids, destinatari) {
  const ora = oraIso();
  for (const id of ids) {
    const o = M.ord.get(id);
    await salvaOrdine({ ...o, stato: 'trasmesso', dtTrasm: ora });
    for (const dest of destinatari) {
      await aggiungiMessaggio({
        a: dest, da: state.ruolo, tipo: 'ordine', ordineId: id, data: ora, letto: false,
        titolo: titoloOrdine(o), payload: pacchetto(id, dest),
      });
    }
    await logga('Trasmesso ordine', 'ordine', id, destinatari.map((d) => RUOLI[d].nome).join(', '));
  }
  tocca();
}

// Distinta di ricezione: aggiorna lo stato dell'ordine (simula il sistema centrale)
// e la invia ad amministrazione e buyer.
export async function inviaDistinta({ ordineId, msgId, righe, note }) {
  const prima = ricevutoPerRiga(ordineId);
  const tutte = righeOrdine(ordineId);
  const pezziOrdinati = tutte.reduce((s, r) => s + (r.qta || 0), 0);
  const pezziRicevuti = righe.reduce((s, r) => s + (r.ricevuti || 0), 0);
  let pezziTot = 0, valOrd = 0, valRic = 0;
  const ora = new Map(righe.map((r) => [r.rigaId, r.ricevuti || 0]));
  for (const r of tutte) {
    const ric = Math.min(r.qta || 0, (prima.get(r.id) || 0) + (ora.get(r.id) || 0));
    pezziTot += ric;
    const pu = (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
    valOrd += pu * (r.qta || 0);
    valRic += pu * ric;
  }
  const percentuale = pezziOrdinati ? (pezziTot / pezziOrdinati) * 100 : 0;
  const tipo = pezziTot >= pezziOrdinati ? 'totale' : 'parziale';
  const problemi = righe.filter((r) => r.problema).length;
  const d = {
    ordineId, msgId, ruolo: state.ruolo, data: oraIso(), righe, note: note || '',
    pezziOrdinati, pezziRicevuti, pezziRicevutiTot: pezziTot, perc: percentuale,
    valoreOrdinato: valOrd, valoreRicevuto: valRic, tipo, problemi,
  };
  d.id = await db.distinte.add(d);
  M.distinte.set(d.id, d);
  const o = M.ord.get(ordineId);
  await salvaOrdine({ ...o, stato: tipo === 'totale' ? 'chiuso' : 'parziale' });
  for (const dest of ['amministrazione', 'buyer']) {
    await aggiungiMessaggio({
      a: dest, da: state.ruolo, tipo: 'distinta', ordineId, distintaId: d.id, data: d.data, letto: false,
      titolo: `Distinta ${tipo} – ${titoloOrdine(o)}`,
    });
  }
  await logga(`Inviata distinta ${tipo} (${Math.round(percentuale)}%)`, 'ordine', ordineId,
    problemi ? `${problemi} segnalazion${problemi === 1 ? 'e' : 'i'}` : '');
  tocca();
  return d;
}

export function nonLetti(ruolo) {
  let n = 0;
  for (const m of M.messaggi.values()) if (m.a === ruolo && !m.letto) n++;
  return n;
}

export async function spazioOccupato() {
  try {
    const s = await navigator.storage.estimate();
    return s.usage || 0;
  } catch { return null; }
}
