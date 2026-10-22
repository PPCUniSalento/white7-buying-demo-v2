// Compilazione dell'articolo dalle foto con l'AI di Apple (solo nell'app iOS, vedi app-ios/).
// La pagina manda al modulo nativo le foto e gli elenchi della configurazione; il modulo restituisce
// i campi proposti, che il buyer accetta o scarta uno per uno (supervisione del progetto tecnico).

import {
  M, state, fotoRiga, attivo, righeOrdine, salvaRiga, salvaOrdine, nuovoOrdine, nuovoFornitore, aggiungiFoto, logga, scriviLocale, importaSeed,
} from './db.js';
import { blobBase64, nativo, elaboraFoto, bufferDaBase64 } from './util.js';

// Voci consentite al modello: solo quelle attive della configurazione del negozio
function elenchi() {
  const nomeMacro = (id) => M.mac.get(id)?.nome;
  const categorie = M.categorie.filter((c) => attivo(c) && attivo(M.mac.get(c.macroId))).map((c) => `${nomeMacro(c.macroId)} > ${c.nome}`);
  return {
    categorie: [...new Set(categorie)],
    colori: M.colori.filter(attivo).map((c) => c.nome),
    generi: state.cfg.generi.filter((g) => g.attivo !== false).map((g) => g.nome),
    limite: state.cfg.cartellino.limite || 150,
  };
}

export async function statoAI() {
  try { return JSON.parse(await nativo('stato')); } catch (e) { return { disponibile: false, motivo: e.message }; }
}

// Restituisce { proposte: [{ k, etichetta, attuale, proposto, applica(r), scelta }], info }
export async function proponiDaFoto(r) {
  const foto = fotoRiga(r.id);
  if (!foto.length) throw new Error('Scatta o scegli almeno una foto del capo (ed eventualmente dell\'etichetta)');
  const dati = { ...elenchi(), foto: await Promise.all(foto.map((f) => blobBase64(f.blob))) };
  const ris = JSON.parse(await nativo('analizza', dati));
  const c = ris.campi || {};
  const proposte = [];
  const aggiungi = (k, etichetta, attuale, proposto, applica) => {
    if (proposto == null || proposto === '' || proposto === attuale) return;
    // i dettagli scritti dal modello del telefono sono spesso imprecisi (prove del 21/10/2026): non preselezionati
    proposte.push({ k, etichetta, attuale: attuale || '', proposto, applica, scelta: !attuale && k !== 'dettagli' });
  };
  if (c.codiceArticolo) {
    const cod = String(c.codiceArticolo).toUpperCase().replace(/\s+/g, ' ').trim();
    aggiungi('codArt', 'Codice articolo', r.codArt, cod, (x) => { x.codArt = cod; });
  }
  if (c.sottocategoria) {
    const cat = M.categorie.find((y) => attivo(y) && `${M.mac.get(y.macroId)?.nome} > ${y.nome}` === c.sottocategoria);
    if (cat) {
      const att = r.catId ? `${M.mac.get(r.macroId)?.nome} > ${M.cat.get(r.catId)?.nome}` : '';
      aggiungi('catId', 'Categoria e sottocategoria', att, c.sottocategoria, (x) => { x.macroId = cat.macroId; x.catId = cat.id; });
    }
  }
  if (c.colore) {
    const col = M.colori.find((y) => y.nome === c.colore);
    if (col) aggiungi('coloreId', 'Colore', r.coloreId ? M.col.get(r.coloreId)?.nome : '', col.nome, (x) => { x.coloreId = col.id; x.coloreDedotto = false; });
  }
  if (c.genere) {
    const g = state.cfg.generi.find((y) => y.nome === c.genere);
    const att = state.cfg.generi.find((y) => y.k === r.genere)?.nome || '';
    // il genere ha sempre un valore predefinito: la proposta diversa si offre ma non è preselezionata
    if (g) aggiungi('genere', 'Genere', att, g.nome, (x) => { x.genere = g.k; });
  }
  for (const [k, etichetta] of [['descrizione', 'Descrizione commerciale'], ['composizione', 'Composizione'], ['dettagli', 'Dettagli']]) {
    if (c[k]) aggiungi(k, etichetta, r[k], String(c[k]).trim(), (x) => { x[k] = String(c[k]).trim(); });
  }
  return { proposte, info: { ...ris, campi: undefined } };
}

// ---------- azzerare i campi compilati dall'AI (richiesta del 22/10/2026) ----------
// aiOrigine: campi che l'AI ha compilato almeno una volta (resta anche dopo «Verificati»);
// aiCampi: campi ancora da verificare. Azzerare li svuota tutti e due, così una nuova analisi riparte da zero.
export const campiAI = (r) => [...new Set([...(r.aiOrigine || []), ...(r.aiCampi || [])])];
const ETICHETTE_AI = {
  codArt: 'codice', catId: 'categoria e sottocategoria', coloreId: 'colore', genere: 'genere',
  descrizione: 'descrizione', composizione: 'composizione', dettagli: 'dettagli',
};
export function azzeraAI(r) {
  const campi = campiAI(r);
  for (const k of campi) {
    if (k === 'codArt') r.codArt = '';
    else if (k === 'catId') { r.macroId = null; r.catId = null; }
    else if (k === 'coloreId') { r.coloreId = null; r.coloreDedotto = false; }
    else if (k === 'genere') r.genere = state.imp.genereDefault;
    else if (k in ETICHETTE_AI) r[k] = '';
  }
  r.aiCampi = [];
  r.aiOrigine = [];
  r.aiProva = null;
  return campi.map((k) => ETICHETTE_AI[k] || k);
}
// tutti gli articoli di un ordine in bozza
export async function azzeraAIOrdine(ordineId) {
  let n = 0;
  for (const riga of righeOrdine(ordineId)) {
    if (!campiAI(riga).length) continue;
    const r = { ...riga };
    azzeraAI(r);
    await salvaRiga(r);
    n++;
  }
  if (n) await logga('Azzerati i campi dell\'AI', 'ordine', ordineId, `${n} articol${n === 1 ? 'o' : 'i'}`);
  return n;
}

// ---------- ordine di prova con le foto vere del cliente (solo nell'app di sviluppo) ----------
// Le foto sono nel pacchetto dell'app (ProvaAI/articoli/<cartella>/); il ponte le passa una cartella alla volta.
// Crea un fornitore di prova, un ordine in bozza nella stagione di lavoro e un articolo vuoto per cartella,
// con le sue foto: i campi si compilano poi con «Compila dalle foto (AI)».
const NOTA_PROVA = 'Ordine di prova: articoli fotografati in negozio dal cliente (21/10/2026), per provare la compilazione con l\'AI.';
export async function creaOrdineProva() {
  for (let i = 0; i < 100 && !state.pronto; i++) await new Promise((ok) => setTimeout(ok, 100));
  if (!state.haDati) {
    // archivio non ancora caricato: si usa quello nei Documenti dell'app, se c'è
    const doc = await nativo('archivio').catch(() => null);
    if (!doc) return 'archivio dati non caricato';
    await importaSeed(bufferDaBase64(doc.base64));
  }
  const cartelle = await nativo('fotoProva');
  if (!cartelle?.length) return 'nessuna foto di prova nel pacchetto dell\'app';
  // ordine già creato: si aggiungono solo le cartelle nuove (quelle già presenti sono segnate negli articoli
  // con provaCartella o, per il primo ordine del 22/10/2026, elencate nel registro)
  let o = [...M.ord.values()].find((x) => x.note === NOTA_PROVA);
  const presenti = new Set();
  if (o) {
    for (const r of righeOrdine(o.id)) if (r.provaCartella) presenti.add(r.provaCartella);
    const voce = M.log.find((e) => e.entita === 'ordine' && e.entitaId === o.id && e.azione.startsWith('Creato ordine di prova'));
    for (const c of (voce?.dettagli.split('articoli: ')[1] || '').split(', ')) if (c) presenti.add(c);
  } else {
    const forn = M.fornitori.find((f) => f.nome === 'PROVE AI – FOTO DEL CLIENTE') || await nuovoFornitore('PROVE AI – FOTO DEL CLIENTE');
    const base = await nuovoOrdine();
    o = await salvaOrdine({ ...base, fornitoreId: forn.id, note: NOTA_PROVA });
  }
  const nuove = cartelle.filter((c) => !presenti.has(c));
  if (o.stato !== 'bozza' && nuove.length) return `l'ordine di prova n. ${o.id} non è più in bozza: articoli non aggiunti`;
  for (const nome of nuove) {
    const r = await salvaRiga({
      ordineId: o.id, codArt: '', continuativo: false, vecchiCodici: [], macroId: null, catId: null, coloreId: null,
      genere: state.imp.genereDefault, prezzo: null, sconto: 0, qta: null, grigliaId: null, taglie: null,
      descrizione: '', dettagli: '', misure: '', composizione: '', note: '', nuovo: false, provaCartella: nome,
    });
    for (const b64 of await nativo('fotoProva', { cartella: nome })) {
      await aggiungiFoto(r.id, await elaboraFoto(new Blob([bufferDaBase64(b64)], { type: 'image/jpeg' })));
    }
  }
  if (nuove.length) {
    await logga(presenti.size ? 'Aggiunti articoli all\'ordine di prova' : 'Creato ordine di prova con le foto del cliente', 'ordine', o.id,
      `${nuove.length} articoli: ${nuove.join(', ')}`);
  }
  state.ruolo = 'buyer';
  scriviLocale('ruolo', 'buyer');
  location.hash = `#/ordine/${o.id}`;
  if (!nuove.length) return `ordine di prova n. ${o.id}: nessuna cartella nuova`;
  return `ordine n. ${o.id}: ${presenti.size ? 'aggiunti' : 'creati'} ${nuove.length} articoli (${nuove.join(', ')})`;
}
if (typeof window !== 'undefined') window.w7CreaOrdineProva = creaOrdineProva;
