// Dati: IndexedDB (Dexie) come archivio, copia in memoria (M) per ricerche e report.
// Tutte le scritture passano da qui: aggiornano IndexedDB, M e state.rev.

import {
  APP, RUOLI, GENERI, PROBLEMI, SENZA_TAGLIA, stagioneKey, stagioneOrd, stagioneSucc, oraIso, controllaCodice, totaleRiga,
  dataDiConsegna, normConsegna, meseRelativo, dataConsegna, piuGiorni, oggi,
} from './util.js';

const { reactive } = Vue;

const SCHEMA_V1 = {
  anag: 'k',
  ordini: '++id, stato',
  righe: '++id, ordineId',
  foto: '++id, rigaId',
  messaggi: '++id, a, ordineId',
  distinte: '++id, ordineId',
  log: '++id',
  meta: 'k',
};

export const db = new Dexie(APP.db);
db.version(1).stores({ ...SCHEMA_V1, budget: 'k' });

// Preferenze di chi usa il dispositivo (le regole del negozio sono nella configurazione)
const IMP_DEFAULT = { stagioneLavoro: null, genereDefault: 'U', aziendaDefault: 5 };

// ---------- configurazione del negozio (ruolo Configurazione, richiesta del 20/10/2026) ----------
// Campi che la configurazione può rendere obbligatori. Fornitore, stagione, codice articolo
// e quantità restano sempre obbligatori: senza, trasmissione, ricezione e analisi non funzionano.
export const CAMPI_OBBLIGATORI = {
  testata: [['aziendaId', 'Società'], ['pagamento', 'Condizioni di pagamento'], ['consegna', 'Periodo di consegna']],
  articolo: [['macroId', 'Categoria'], ['catId', 'Sottocategoria'], ['coloreId', 'Colore'], ['genere', 'Genere'], ['prezzo', 'Prezzo'],
    ['grigliaId', 'Griglia taglie'], ['descrizione', 'Descrizione commerciale'], ['composizione', 'Composizione']],
};
export const CAMPI_FISSI = { testata: ['Fornitore', 'Stagione'], articolo: ['Codice articolo', 'Quantità'] };
// campi che finiscono sul cartellino e nel gestionale (limite di caratteri sulla somma)
export const CAMPI_CARTELLINO = [['descrizione', 'Descrizione'], ['composizione', 'Composizione'], ['note', 'Note'], ['dettagli', 'Dettagli'], ['misure', 'Misure']];

// Valori iniziali: le decisioni del 15/10/2026 (foto facoltative, colore in fondo al codice) e del 20/10/2026
// (consegne al giorno 1, 15 o a fine mese; avviso oltre 150 caratteri di descrizione, composizione e note)
export const CFG_DEFAULT = () => ({
  obbligatori: {
    aziendaId: true, pagamento: false, consegna: false,
    macroId: true, catId: true, coloreId: false, genere: true, prezzo: true, grigliaId: false, descrizione: false, composizione: false,
  },
  minFoto: 0,
  coloreInCodice: true,
  cartellino: { limite: 150, campi: ['descrizione', 'composizione', 'note'] },
  // giorni ammessi; periodo proposto per stagione in mesi relativi a gennaio dell'anno della stagione
  consegne: { giorni: [1, 15, 'fine'], I: { da: -6, a: -4 }, E: { da: 0, a: 2 } },
  ritardoGiorni: 0,
  sovrappFornitori: 3,
  generi: [{ k: 'U', nome: 'Uomo' }, { k: 'D', nome: 'Donna' }, { k: 'X', nome: 'Unisex' }],
  problemi: ['Mancante', 'Difettoso', 'Non conforme al campione', 'Taglia errata', 'Colore errato', 'Altro'],
});
function unisciCfg(v) {
  const d = CFG_DEFAULT();
  if (!v) return d;
  return {
    ...d, ...v,
    obbligatori: { ...d.obbligatori, ...v.obbligatori },
    cartellino: { ...d.cartellino, ...v.cartellino },
    consegne: { ...d.consegne, ...v.consegne },
  };
}

export const state = reactive({
  pronto: false,
  haDati: false,
  rev: 0,
  ruolo: leggiLocale('ruolo') || 'buyer',
  imp: { ...IMP_DEFAULT },
  cfg: CFG_DEFAULT(),
  toast: null,
});

function leggiLocale(k) {
  try { return localStorage.getItem(APP.locale + k); } catch { return null; }
}
export function scriviLocale(k, v) {
  try { localStorage.setItem(APP.locale + k, v); } catch { /* storage non disponibile */ }
}

// Modello in memoria (non reattivo: la reattività passa da state.rev)
export const M = {
  aziende: [], fornitori: [], macro: [], categorie: [], colori: [], griglie: [], pagamenti: [],
  az: new Map(), forn: new Map(), mac: new Map(), cat: new Map(), col: new Map(), gri: new Map(),
  ord: new Map(), rig: new Map(), righePerOrdine: new Map(),
  foto: new Map(), fotoPerRiga: new Map(),
  messaggi: new Map(), distinte: new Map(), log: [], budget: new Map(),
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
  M.budget = new Map((await db.budget.toArray()).map((b) => [b.k, b.v]));
  const imp = await db.meta.get('impostazioni');
  state.imp = { ...IMP_DEFAULT, ...(imp ? imp.v : {}) };
  if (!state.imp.stagioneLavoro) state.imp.stagioneLavoro = stagioni()[0] || null;
  const cfg = await db.meta.get('configurazione');
  state.cfg = unisciCfg(cfg?.v);
  // il minimo di foto era un'impostazione del dispositivo: passa alla configurazione
  if (!cfg && imp?.v?.minFoto > 0) state.cfg.minFoto = imp.v.minFoto;
  applicaConfigurazione();
  await adegua();
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

// Archivio già caricato nella v1 sullo stesso dispositivo e browser (stesso dominio):
// si legge solo il file originale, senza modificare il database della v1.
export async function seedVersionePrecedente() {
  try {
    if (!(await Dexie.exists(APP.db1))) return null;
    const v1 = new Dexie(APP.db1);
    v1.version(1).stores(SCHEMA_V1);
    await v1.open();
    const rec = await v1.meta.get('seed');
    v1.close();
    return rec ? rec.v : null;
  } catch { return null; }
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

// Adeguamenti dell'archivio alle richieste del cliente, applicati una sola volta per archivio
// (anche a quello della v1 riusato al primo avvio)
const ADEGUAMENTI = {
  // taglie italiane fino alla 64 (20/10/2026)
  async griglia64() {
    const g = M.griglie.find((x) => x.nome === 'Italiana 44–60' && x.taglie[x.taglie.length - 1] === '60');
    if (!g) return;
    g.taglie.push('62', '64');
    g.nome = 'Italiana 44–64';
    await db.anag.put({ k: 'griglie', v: M.griglie });
  },
  // "Nessuna" e "Conto vendita" fra le condizioni di pagamento suggerite
  async pagamenti() {
    const a = M.pagamenti.filter(Boolean);
    for (const p of ['Conto vendita', 'Nessuna']) if (!a.includes(p)) a.push(p);
    M.pagamenti = a;
    await db.anag.put({ k: 'pagamenti', v: a });
  },
  // consegna al giorno: le date salvate come mese diventano primo e ultimo giorno del mese
  async consegnaGiorno() {
    const cambiati = [];
    for (const o of M.ord.values()) {
      const da = normConsegna(o.consegnaDa, false), a = normConsegna(o.consegnaA, true);
      if (da !== o.consegnaDa || a !== o.consegnaA) { o.consegnaDa = da; o.consegnaA = a; cambiati.push(o); }
    }
    if (cambiati.length) await db.ordini.bulkPut(cambiati);
  },
};
async function adegua() {
  const fatti = new Set((await db.meta.get('adeguamenti'))?.v || []);
  const da = Object.keys(ADEGUAMENTI).filter((k) => !fatti.has(k));
  if (!da.length) return;
  for (const k of da) { await ADEGUAMENTI[k](); fatti.add(k); }
  indicizzaAnagrafiche();
  await db.meta.put({ k: 'adeguamenti', v: [...fatti] });
}

// Generi e motivi di segnalazione della configurazione negli oggetti condivisi di util.js
function applicaConfigurazione() {
  for (const k of Object.keys(GENERI)) delete GENERI[k];
  for (const g of state.cfg.generi) GENERI[g.k] = g.nome;
  PROBLEMI.splice(0, PROBLEMI.length, ...state.cfg.problemi);
}

export async function salvaConfigurazione(nuova, dettagli = '') {
  state.cfg = unisciCfg(JSON.parse(JSON.stringify(nuova)));
  await db.meta.put({ k: 'configurazione', v: JSON.parse(JSON.stringify(state.cfg)) });
  applicaConfigurazione();
  if (dettagli) await logga('Modificata la configurazione', 'configurazione', null, dettagli);
  tocca();
}

// Anagrafiche modificabili dal ruolo Configurazione (e fornitori anche dal buyer)
export async function salvaAnagrafica(k, v, dettagli = '') {
  M[k] = JSON.parse(JSON.stringify(v));
  await db.anag.put({ k, v: M[k] });
  indicizzaAnagrafiche();
  if (dettagli) await logga('Modificata la configurazione', 'configurazione', null, dettagli);
  tocca();
}
export const nuovoId = (a) => a.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
// voce attiva: i fornitori usano "valido", le altre anagrafiche "attivo"
export const attivo = (x) => !!x && x.attivo !== false && x.valido !== false;

export async function nuovoFornitore(nome, cod = '') {
  const f = { id: nuovoId(M.fornitori), cod: cod.trim(), nome: nome.trim(), nuovo: true, creato: oraIso() };
  await salvaAnagrafica('fornitori', [...M.fornitori, f]);
  await logga('Nuovo fornitore', 'fornitore', f.id, f.nome);
  return f;
}
// Fornitori con un nome simile (per evitare doppioni scritti in modo diverso)
const normNome = (s) => (s || '').toLowerCase().replace(/\b(s\.?r\.?l|s\.?p\.?a|s\.?n\.?c|s\.?a\.?s|ltd|inc|gmbh|srls)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
export function fornitoriSimili(nome) {
  const n = normNome(nome);
  if (n.length < 3) return [];
  return M.fornitori.filter((f) => {
    const x = normNome(f.nome);
    return x === n || (Math.min(x.length, n.length) >= 4 && (x.includes(n) || n.includes(x)));
  }).slice(0, 6);
}

// Una sottocategoria spostata in un'altra categoria porta con sé i suoi articoli
export async function spostaArticoliCategoria(catId, macroId) {
  const righe = [...M.rig.values()].filter((r) => r.catId === catId && r.macroId !== macroId);
  for (const r of righe) r.macroId = macroId;
  if (righe.length) await db.righe.bulkPut(righe);
  tocca();
  return righe.length;
}

// Consegne: periodo proposto per la stagione e ritardi, secondo la configurazione
export function giorniConsegna() {
  const g = state.cfg.consegne.giorni.filter((x) => x !== 'fine').map(Number).sort((a, b) => a - b);
  return state.cfg.consegne.giorni.includes('fine') ? [...g, 'fine'] : g;
}
export function consegnaProposta(anno, s) {
  const c = state.cfg.consegne[s] || CFG_DEFAULT().consegne[s];
  const g = giorniConsegna();
  return [dataDiConsegna(meseRelativo(anno, c.da), g[0] ?? 1), dataDiConsegna(meseRelativo(anno, c.a), g[g.length - 1] ?? 'fine')];
}
export const inRitardo = (consegnaA) => !!consegnaA && piuGiorni(normConsegna(consegnaA, true), state.cfg.ritardoGiorni) < oggi();

// Testo del cartellino: somma dei caratteri dei campi configurati (avviso, non blocca)
export const lunghezzaCartellino = (r) => state.cfg.cartellino.campi.reduce((s, k) => s + (r[k] || '').trim().length, 0);
export function oltreCartellino(r) {
  const lim = state.cfg.cartellino.limite;
  const n = lunghezzaCartellino(r);
  return lim > 0 && n > lim ? n : 0;
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

// ---------- ricezione per taglia ----------
// Quantità ordinate per taglia; gli articoli senza griglia hanno un'unica chiave
export function taglieOrdinate(r) {
  if (r.taglie && Object.keys(r.taglie).length) {
    return Object.fromEntries(Object.entries(r.taglie).map(([t, q]) => [t, Number(q) || 0]));
  }
  return { [SENZA_TAGLIA]: r.qta || 0 };
}
const somma = (t) => Object.values(t || {}).reduce((s, q) => s + (Number(q) || 0), 0);
export { somma as sommaTaglie };

// Quantità già ricevute per riga e per taglia, sommando tutte le distinte dell'ordine
export function ricevutoPerTaglia(ordineId) {
  const m = new Map();
  for (const d of M.distinte.values()) {
    if (d.ordineId !== ordineId) continue;
    for (const r of d.righe) {
      const t = m.get(r.rigaId) || {};
      for (const [k, q] of Object.entries(r.ricevute || {})) t[k] = (t[k] || 0) + (Number(q) || 0);
      m.set(r.rigaId, t);
    }
  }
  return m;
}

// Totale ricevuto per riga (somma delle taglie)
export function ricevutoPerRiga(ordineId) {
  const m = new Map();
  for (const [id, t] of ricevutoPerTaglia(ordineId)) m.set(id, somma(t));
  return m;
}

const fmtDelta = (o) => Object.entries(o).map(([t, n]) => `${t === SENZA_TAGLIA ? 'pezzi' : t}: ${n > 0 ? '+' : '−'}${Math.abs(n)}`).join(' · ');

// Confronto ordinato/ricevuto di una riga: conforme solo se ogni taglia corrisponde
export function confrontoTaglie(ordinate, ricevute) {
  const mancanti = {}, eccedenze = {};
  for (const t of new Set([...Object.keys(ordinate), ...Object.keys(ricevute || {})])) {
    const d = (Number(ricevute?.[t]) || 0) - (Number(ordinate[t]) || 0);
    if (d < 0) mancanti[t] = d;
    else if (d > 0) eccedenze[t] = d;
  }
  const totOrd = somma(ordinate), totRic = somma(ricevute);
  const hasM = Object.keys(mancanti).length > 0, hasE = Object.keys(eccedenze).length > 0;
  let stato;
  if (!hasM && !hasE) stato = 'conforme';
  else if (!totRic) stato = 'non ricevuto';
  else if (hasM && !hasE) stato = 'da completare';
  else if (hasE && !hasM) stato = 'eccedenza';
  else stato = totRic === totOrd ? 'taglie diverse' : 'eccedenze e mancanze';
  const conformi = Object.keys(ordinate).reduce((s, t) => s + Math.min(ordinate[t] || 0, Number(ricevute?.[t]) || 0), 0);
  return { stato, mancanti, eccedenze, totOrd, totRic, conformi, descr: fmtDelta({ ...mancanti, ...eccedenze }) };
}
// Stati che sono una discrepanza da segnalare (non semplici consegne ancora attese)
export const DISCREPANZE = ['eccedenza', 'taglie diverse', 'eccedenze e mancanze'];

// Stato di ogni riga dell'ordine rispetto a quanto ricevuto finora
export function statoRigheOrdine(ordineId) {
  const ric = ricevutoPerTaglia(ordineId);
  const m = new Map();
  for (const r of righeOrdine(ordineId)) m.set(r.id, confrontoTaglie(taglieOrdinate(r), ric.get(r.id) || {}));
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
    case 'consegnaDa': case 'consegnaA': return dataConsegna(v);
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
  const [consegnaDa, consegnaA] = consegnaProposta(anno, stag);
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

// Controlli bloccanti prima della conferma dell'ordine. Sempre: stagione, fornitore, codice, quantità;
// gli altri campi secondo la configurazione (valori iniziali decisi con il cliente il 15/10/2026:
// società, categoria, sottocategoria, genere, prezzo; colore in fondo al codice).
export const obbligatorio = (k) => !!state.cfg.obbligatori[k];
const vuoto = (v) => !(v || '').trim();
export function erroriRiga(r) {
  const e = [];
  const ec = controllaCodice(r.codArt, state.cfg.coloreInCodice);
  if (ec) e.push(ec);
  if (obbligatorio('macroId') && !r.macroId) e.push('Categoria obbligatoria');
  if (obbligatorio('catId') && !r.catId) e.push('Sottocategoria obbligatoria');
  if (obbligatorio('coloreId') && !r.coloreId) e.push('Colore obbligatorio');
  if (obbligatorio('genere') && !r.genere) e.push('Genere obbligatorio');
  if (obbligatorio('prezzo') && !(r.prezzo > 0)) e.push('Prezzo obbligatorio');
  if (!(r.qta > 0)) e.push('Quantità obbligatoria');
  // la griglia si chiede solo se la sottocategoria ne propone almeno una
  if (obbligatorio('grigliaId') && !r.grigliaId && (M.cat.get(r.catId)?.griglie || []).some((id) => attivo(M.gri.get(id)))) {
    e.push('Griglia taglie obbligatoria');
  }
  if (obbligatorio('descrizione') && vuoto(r.descrizione)) e.push('Descrizione obbligatoria');
  if (obbligatorio('composizione') && vuoto(r.composizione)) e.push('Composizione obbligatoria');
  if (state.cfg.minFoto > 0) {
    const nf = fotoRiga(r.id).length;
    if (nf < state.cfg.minFoto) e.push(`Foto: ${nf} su ${state.cfg.minFoto} minime`);
  }
  return e;
}
export function erroriOrdine(o) {
  const e = [];
  if (obbligatorio('aziendaId') && !o.aziendaId) e.push('Società obbligatoria');
  if (!o.anno || !o.stagione) e.push('Stagione obbligatoria');
  if (!o.fornitoreId) e.push('Fornitore obbligatorio');
  if (obbligatorio('pagamento') && vuoto(o.pagamento)) e.push('Condizioni di pagamento obbligatorie (anche «Nessuna»)');
  if (obbligatorio('consegna') && (!o.consegnaDa || !o.consegnaA)) e.push('Periodo di consegna obbligatorio');
  if (o.consegnaDa && o.consegnaA && o.consegnaA < o.consegnaDa) e.push('Periodo di consegna non valido');
  const righe = righeOrdine(o.id);
  if (!righe.length) e.push('Nessun articolo inserito');
  for (const r of righe) {
    const er = erroriRiga(r);
    if (er.length) e.push(`${r.codArt || '(articolo senza codice)'}: ${er.join('; ')}`);
  }
  return e;
}

// Avvisi che non bloccano la conferma (testo del cartellino troppo lungo)
export function avvisiOrdine(o) {
  const lim = state.cfg.cartellino.limite;
  return righeOrdine(o.id).filter((r) => oltreCartellino(r))
    .map((r) => `${r.codArt || '(articolo senza codice)'}: testo del cartellino di ${lunghezzaCartellino(r)} caratteri (limite ${lim})`);
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

// Riepilogo delle differenze di un ordine, per notifiche e chiusura
function riepilogoDifferenze(ordineId) {
  const st = statoRigheOrdine(ordineId);
  let mancanti = 0, eccedenze = 0;
  const righe = [];
  for (const r of righeOrdine(ordineId)) {
    const c = st.get(r.id);
    mancanti -= somma(c.mancanti);
    eccedenze += somma(c.eccedenze);
    if (c.stato !== 'conforme') righe.push({ rigaId: r.id, codArt: r.codArt, stato: c.stato, descr: c.descr });
  }
  return { mancanti, eccedenze, righe, discrepanze: righe.filter((x) => DISCREPANZE.includes(x.stato)).length };
}

async function avvisa(ordineId, tipo, titolo, extra = {}) {
  for (const dest of ['amministrazione', 'buyer']) {
    await aggiungiMessaggio({ a: dest, da: state.ruolo, tipo, ordineId, data: oraIso(), letto: false, titolo, ...extra });
  }
}

// Distinta di ricezione per taglia. Aggiorna lo stato dell'ordine (simula il sistema centrale)
// e la invia ad amministrazione e buyer. righe: [{ rigaId, codArt, descrizione, ricevute: {taglia: n}, problema, nota }]
// chiusura: { nota } per chiudere l'ordine nonostante le differenze (responsabilità di chi riceve).
export async function inviaDistinta({ ordineId, msgId, righe, note, chiusura = null }) {
  const prima = ricevutoPerTaglia(ordineId);
  const ora = new Map(righe.map((r) => [r.rigaId, r]));
  const tutte = righeOrdine(ordineId);
  let pezziOrdinati = 0, pezziConformi = 0, valOrd = 0, valRic = 0;
  const righeDistinta = [];
  let tutteConformi = true;
  for (const r of tutte) {
    const ordinate = taglieOrdinate(r);
    const p = prima.get(r.id) || {};
    const x = ora.get(r.id);
    const ricevute = x ? Object.fromEntries(Object.entries(x.ricevute || {}).filter(([, q]) => Number(q) > 0)) : {};
    const cumulate = { ...p };
    for (const [t, q] of Object.entries(ricevute)) cumulate[t] = (cumulate[t] || 0) + Number(q);
    const c = confrontoTaglie(ordinate, cumulate);
    if (c.stato !== 'conforme') tutteConformi = false;
    pezziOrdinati += c.totOrd;
    pezziConformi += c.conformi;
    const pu = (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
    valOrd += pu * c.totOrd;
    valRic += pu * c.conformi;
    if (somma(ricevute) || x?.problema) {
      righeDistinta.push({
        rigaId: r.id, codArt: r.codArt, descrizione: r.descrizione || '', conGriglia: !!r.grigliaId,
        ordinate, prima: p, ricevute, cumulate, stato: c.stato, descr: c.descr,
        ordinati: c.totOrd, ricevuti: somma(ricevute), problema: x?.problema || '', nota: x?.nota || '',
      });
    }
  }
  const percentuale = pezziOrdinati ? (pezziConformi / pezziOrdinati) * 100 : 0;
  const tipo = tutteConformi ? 'totale' : 'parziale';
  const problemi = righeDistinta.filter((r) => r.problema).length;
  const d = {
    ordineId, msgId, ruolo: state.ruolo, data: oraIso(), righe: righeDistinta, note: note || '',
    pezziOrdinati, pezziRicevuti: righeDistinta.reduce((s, r) => s + r.ricevuti, 0), pezziConformi, perc: percentuale,
    valoreOrdinato: valOrd, valoreRicevuto: valRic, tipo, problemi,
  };
  d.id = await db.distinte.add(d);
  M.distinte.set(d.id, d);
  const diff = riepilogoDifferenze(ordineId);
  d.discrepanze = diff.discrepanze;
  await db.distinte.put(d);
  const o = M.ord.get(ordineId);
  const chiudi = tipo === 'totale' || !!chiusura;
  await salvaOrdine({
    ...o, stato: chiudi ? 'chiuso' : 'parziale',
    ...(chiusura && tipo !== 'totale' ? { chiusura: { conDifferenze: true, ruolo: state.ruolo, data: oraIso(), nota: chiusura.nota || '', mancanti: diff.mancanti, eccedenze: diff.eccedenze } } : {}),
  });
  const extraTitolo = chiusura && tipo !== 'totale' ? ' · chiuso con differenze' : diff.discrepanze ? ` · ${diff.discrepanze} discrepanz${diff.discrepanze === 1 ? 'a' : 'e'} di taglia` : '';
  await avvisa(ordineId, 'distinta', `Distinta ${tipo} – ${titoloOrdine(o)}${extraTitolo}`, { distintaId: d.id });
  await logga(`Inviata distinta ${tipo} (${Math.round(percentuale)}%)`, 'ordine', ordineId,
    [problemi ? `${problemi} segnalazion${problemi === 1 ? 'e' : 'i'}` : '', diff.discrepanze ? `${diff.discrepanze} discrepanze di taglia` : '']
      .filter(Boolean).join(' · '));
  if (chiusura && tipo !== 'totale') {
    await logga('Ordine chiuso con differenze', 'ordine', ordineId,
      `mancanti ${diff.mancanti}, eccedenze ${diff.eccedenze}${chiusura.nota ? ' – ' + chiusura.nota : ''}`);
  }
  tocca();
  return d;
}

// Chiusura di un ordine parzialmente ricevuto senza nuove consegne: chi riceve se ne assume la responsabilità
export async function chiudiConDifferenze(ordineId, nota) {
  const o = M.ord.get(ordineId);
  const diff = riepilogoDifferenze(ordineId);
  await salvaOrdine({
    ...o, stato: 'chiuso',
    chiusura: { conDifferenze: true, ruolo: state.ruolo, data: oraIso(), nota: nota || '', mancanti: diff.mancanti, eccedenze: diff.eccedenze },
  });
  await avvisa(ordineId, 'chiusura', `Ordine chiuso con differenze – ${titoloOrdine(o)}`);
  await logga('Ordine chiuso con differenze', 'ordine', ordineId,
    `mancanti ${diff.mancanti}, eccedenze ${diff.eccedenze}${nota ? ' – ' + nota : ''}`);
  tocca();
}

// ---------- budget ----------
export const chiaveBudget = (sk, livello, id) => `${sk}|${livello}|${id}`;
export async function salvaBudget(sk, livello, id, valore) {
  const k = chiaveBudget(sk, livello, id);
  const v = Number(valore) || 0;
  if (v > 0) { await db.budget.put({ k, v }); M.budget.set(k, v); }
  else { await db.budget.delete(k); M.budget.delete(k); }
  tocca();
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
