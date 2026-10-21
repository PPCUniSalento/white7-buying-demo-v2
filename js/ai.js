// Compilazione dell'articolo dalle foto con l'AI di Apple (solo nell'app iOS, vedi app-ios/).
// La pagina manda al modulo nativo le foto e gli elenchi della configurazione; il modulo restituisce
// i campi proposti, che il buyer accetta o scarta uno per uno (supervisione del progetto tecnico).

import { M, state, fotoRiga, attivo } from './db.js';
import { blobBase64, nativo } from './util.js';

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
    proposte.push({ k, etichetta, attuale: attuale || '', proposto, applica, scelta: !attuale });
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
