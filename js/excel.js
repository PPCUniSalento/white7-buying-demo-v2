// Export Excel (ExcelJS, caricato solo quando serve) con l'immagine principale.

import { M, nomeAzienda, nomeFornitore, nomeMacro, nomeCat, nomeColore, fotoPrincipale, stagioneOrdine, statoConsegna, statoRigheOrdine } from './db.js';
import { GENERI, STATI, stagioneNome, totaleRiga, blobBase64, condividiFile, caricaScript, data } from './util.js';

const MAX_IMMAGINI = 400;

// Stato di consegna della riga, confrontando ordinato e ricevuto taglia per taglia
function statoConsegnaRiga(r, o, stati) {
  if (o.storico && o.stato === 'chiuso') return 'Consegnato';
  const sc = statoConsegna(o);
  if (sc === 'non trasmesso' || sc === 'in attesa') return sc === 'in attesa' ? 'In attesa' : 'Non trasmesso';
  const c = stati.get(r.id);
  if (!c || c.stato === 'conforme') return 'Consegnato conforme';
  const st = o.stato === 'chiuso' && (c.stato === 'da completare' || c.stato === 'non ricevuto') ? 'mancante' : c.stato;
  const nome = st.charAt(0).toUpperCase() + st.slice(1);
  return c.descr ? `${nome} (${c.descr})` : nome;
}

// righe: array di righe d'ordine; prezzi: false per logistica e punti vendita
export async function esportaRighe(righe, { nomeFile, titolo, prezzi = true }) {
  await caricaScript('vendor/exceljs.min.js');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WHITE.7 Buying (demo)';
  const ws = wb.addWorksheet('Articoli', { views: [{ state: 'frozen', ySplit: 2 }] });

  const col = [
    ['Società', 12], ['Stagione', 10], ['Fornitore', 26], ['Ordine', 8], ['Codice articolo', 24], ['Vecchio codice', 18],
    ['Categoria', 14], ['Sottocategoria', 18], ['Colore', 11], ['Genere', 8],
    ...(prezzi ? [['Prezzo', 10], ['Sconto %', 8]] : []), ['Quantità', 9], ...(prezzi ? [['Totale riga', 12]] : []),
    ['Taglie', 22], ['Descrizione', 34], ['Composizione', 20], ['Dettagli', 24], ['Note', 24],
    ['Immagine principale', 14], ['Stato ordine', 13], ['Stato consegna', 14], ['Data inserimento', 12],
  ];
  ws.columns = col.map(([header, width]) => ({ header, width }));
  ws.spliceRows(1, 0, [titolo || '']);
  ws.getRow(1).font = { bold: true, size: 13 };
  const h = ws.getRow(2);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16181D' } };
  h.alignment = { vertical: 'middle', wrapText: true };
  h.height = 30;
  const colImg = col.findIndex((c) => c[0] === 'Immagine principale');

  const ricevutiPerOrdine = new Map();
  let immagini = 0;
  for (const r of righe) {
    const o = M.ord.get(r.ordineId);
    if (!ricevutiPerOrdine.has(o.id)) ricevutiPerOrdine.set(o.id, statoRigheOrdine(o.id));
    const taglie = r.taglie ? Object.entries(r.taglie).filter(([, q]) => q).map(([t, q]) => `${t}:${q}`).join(' ') : '';
    const valori = [
      nomeAzienda(o.aziendaId), stagioneNome(stagioneOrdine(o)), nomeFornitore(o.fornitoreId), o.id, r.codArt,
      (r.vecchiCodici || []).join(', '), r.macroId ? nomeMacro(r.macroId) : '', r.catId ? nomeCat(r.catId) : '',
      r.coloreId ? nomeColore(r.coloreId) : '', GENERI[r.genere] || '',
      ...(prezzi ? [r.prezzo || 0, r.sconto || 0] : []), r.qta || 0, ...(prezzi ? [totaleRiga(r)] : []),
      taglie, r.descrizione || '', r.composizione || '', r.dettagli || '', r.note || '',
      '', STATI[o.stato]?.nome || o.stato, statoConsegnaRiga(r, o, ricevutiPerOrdine.get(o.id)), data(o.data),
    ];
    const row = ws.addRow(valori);
    row.alignment = { vertical: 'top', wrapText: true };
    const f = fotoPrincipale(r.id);
    if (f && immagini < MAX_IMMAGINI) {
      const id = wb.addImage({ base64: await blobBase64(f.thumb), extension: 'jpeg' });
      ws.addImage(id, { tl: { col: colImg + 0.1, row: row.number - 1 + 0.1 }, ext: { width: 84, height: 104 } });
      row.height = 82;
      immagini++;
    }
  }
  if (prezzi) {
    for (const nome of ['Prezzo', 'Totale riga']) {
      ws.getColumn(col.findIndex((c) => c[0] === nome) + 1).numFmt = '#,##0.00 €';
    }
  }
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: col.length } };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await condividiFile(blob, nomeFile.replace(/[\\/:*?"<>|]/g, '-'));
}
