// Export PDF dell'ordine (jsPDF, caricato solo quando serve). Risposta del cliente del 10/11/2026:
// PDF per l'amministrazione (con prezzi d'acquisto e di vendita) e per logistica e negozi (senza dati
// economici); le foto ci sono sempre. A4 orizzontale, una scheda per articolo.

import {
  M, righeOrdine, fotoRiga, nomeAzienda, nomeFornitore, nomeMacro, nomeCat, nomeColore, stagioneOrdine, taglieOrdinate,
} from './db.js';
import {
  GENERI, STATI, RUOLI, SENZA_TAGLIA, stagioneNome, euro, num, data, dataOra, dataConsegna, totaleRiga, lordoRiga, prezzoNetto,
  scontoComm, scontoFin, testoReso, testoAcconto, blobBase64, condividiFile, caricaScript, oraIso,
} from './util.js';

const FOTO_MAX = 4;          // foto per articolo
const W = 297, H = 210;      // A4 orizzontale, mm
const MARG = 12;
const FOTO_W = 30, FOTO_H = 38, FOTO_SP = 3;

// I font standard di jsPDF coprono il Latin-1: i caratteri tipografici fuori da quell'insieme si sostituiscono
const pulisci = (t) => String(t ?? '')
  .replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/…/g, '...').replace(/[  ]/g, ' ').replace(/€/g, 'EUR')
  .replace(/[^\x00-\xff]/g, '?');
const eur = (v) => pulisci(euro(v));

async function immagine(doc, f) {
  const b64 = await blobBase64(f.thumb || f.blob);
  const dati = `data:image/jpeg;base64,${b64}`;
  const p = doc.getImageProperties(dati);
  return { dati, w: p.width, h: p.height };
}

export async function esportaPdf(ordineId, { prezzi = false } = {}) {
  await caricaScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const o = M.ord.get(ordineId);
  const righe = righeOrdine(ordineId);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: `Ordine ${o.id} ${nomeFornitore(o.fornitoreId)}`, creator: 'WHITE.7 Buying (demo)' });
  const T = (t, x, y, opz) => doc.text(Array.isArray(t) ? t.map(pulisci) : pulisci(t), x, y, opz);
  const testoLargo = (t, larg) => doc.splitTextToSize(pulisci(t), larg);

  // ---- testata (prima pagina) e intestazione corta (pagine seguenti)
  let y = MARG;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  T(`Ordine n. ${o.id} - ${nomeFornitore(o.fornitoreId)}`, MARG, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
  T(prezzi ? 'Per l\'amministrazione: con prezzi e sconti' : 'Per logistica e punti vendita: senza dati economici', W - MARG, y + 5, { align: 'right' });
  y += 11;
  doc.setTextColor(0); doc.setFontSize(10);
  const kv = [
    ['Società', nomeAzienda(o.aziendaId)], ['Stagione', stagioneNome(stagioneOrdine(o))],
    ['Consegna', o.consegnaDa ? `${dataConsegna(o.consegnaDa)} - ${dataConsegna(o.consegnaA)}` : '-'],
    ['Data ordine', data(o.data)], ['Stato', STATI[o.stato]?.nome || o.stato],
  ];
  if (prezzi) {
    kv.push(['Pagamento', o.pagamento || '-']);
    kv.push(['Sconti', o.scontiArticolo ? 'per articolo' : `commerciale ${o.scontoComm || 0}% + finanziario ${o.scontoFin || 0}%`]);
    if (testoReso(o)) kv.push(['Diritto di reso', testoReso(o)]);
    if (testoAcconto(o)) kv.push(['Acconto', testoAcconto(o)]);
  }
  let x = MARG;
  for (const [k, v] of kv) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(110); doc.setFontSize(8); T(k, x, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.setFontSize(10); T(v, x, y + 4.5);
    x += Math.max(32, doc.getTextWidth(pulisci(v)) + 8);
    if (x > W - MARG - 40) { x = MARG; y += 11; }
  }
  y += x > MARG ? 15 : 4;
  if (o.note) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const l = testoLargo(`Note: ${o.note}`, W - 2 * MARG);
    T(l, MARG, y); y += l.length * 4 + 2;
  }
  // totali
  const pezzi = righe.reduce((s, r) => s + (r.qta || 0), 0);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  T(`${righe.length} articol${righe.length === 1 ? 'o' : 'i'} · ${num(pezzi)} capi${prezzi ? ` · netto ${eur(righe.reduce((s, r) => s + totaleRiga(r), 0))} (lordo ${eur(righe.reduce((s, r) => s + lordoRiga(r), 0))})` : ''}`.replace(/·/g, '-'), MARG, y);
  y += 4;
  doc.setDrawColor(30); doc.setLineWidth(0.4); doc.line(MARG, y, W - MARG, y);
  y += 4;

  const intestazione = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    T(`Ordine n. ${o.id} - ${nomeFornitore(o.fornitoreId)} - ${stagioneNome(stagioneOrdine(o))}${prezzi ? '' : ' - senza dati economici'}`, MARG, MARG);
    doc.setTextColor(0);
    return MARG + 5;
  };

  // ---- una scheda per articolo
  const xTesto = MARG + FOTO_MAX * (FOTO_W + FOTO_SP) + 2;
  const largTesto = W - MARG - xTesto - (prezzi ? 58 : 0);
  for (const r of righe) {
    const foto = fotoRiga(r.id).slice(0, FOTO_MAX);
    // testo della scheda
    doc.setFontSize(9);
    const det = [
      [r.macroId ? nomeMacro(r.macroId) : '', r.catId ? nomeCat(r.catId) : ''].filter(Boolean).join(' > '),
      r.coloreId ? `colore ${nomeColore(r.coloreId)}` : '', GENERI[r.genere] || '', r.continuativo ? 'continuativo' : '',
    ].filter(Boolean).join(' - ');
    doc.setFontSize(8.5);
    const detRighe = testoLargo(det, largTesto);
    doc.setFontSize(9);
    const blocchi = [];
    if (r.descrizione) blocchi.push(['normal', testoLargo(r.descrizione, largTesto)]);
    if (r.composizione) blocchi.push(['normal', testoLargo(`Composizione: ${r.composizione}`, largTesto)]);
    if (r.dettagli) blocchi.push(['normal', testoLargo(`Dettagli: ${r.dettagli}`, largTesto)]);
    if (r.misure) blocchi.push(['normal', testoLargo(`Misure: ${r.misure}`, largTesto)]);
    if (r.note) blocchi.push(['nota', testoLargo(`Da verificare alla consegna: ${r.note}`, largTesto)]);
    // taglie
    const tg = Object.entries(taglieOrdinate(r)).filter(([, q]) => q > 0);
    const conTaglie = tg.length && !(tg.length === 1 && tg[0][0] === SENZA_TAGLIA);
    const righeTesto = 1 + detRighe.length + blocchi.reduce((s, [, l]) => s + l.length, 0);
    const hTaglie = conTaglie ? 11 * Math.ceil(tg.length / Math.max(1, Math.floor(largTesto / 11))) + (r.grigliaId ? 5 : 0) + 1 : 0;
    const h = Math.max(foto.length ? FOTO_H : 0, righeTesto * 4 + hTaglie + 2, prezzi ? 26 : 0) + 4;
    if (y + h > H - MARG) { doc.addPage(); y = intestazione(); }

    // foto
    let xf = MARG;
    for (const f of foto) {
      try {
        const im = await immagine(doc, f);
        const k = Math.min(FOTO_W / im.w, FOTO_H / im.h);
        const w = im.w * k, hh = im.h * k;
        doc.addImage(im.dati, 'JPEG', xf + (FOTO_W - w) / 2, y + (FOTO_H - hh) / 2, w, hh);
      } catch { /* foto non leggibile: si salta */ }
      xf += FOTO_W + FOTO_SP;
    }
    if (!foto.length) {
      doc.setFontSize(8); doc.setTextColor(140); T('Nessuna foto', MARG, y + 4); doc.setTextColor(0);
    }

    // codice e testo
    let yt = y + 4;
    doc.setFont('courier', 'bold'); doc.setFontSize(11);
    T(r.codArt || '(senza codice)', xTesto, yt);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    T(`${num(r.qta)} pz`, xTesto + largTesto, yt, { align: 'right' });
    yt += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
    T(detRighe, xTesto, yt); doc.setTextColor(0);
    yt += 4.2 * detRighe.length + 0.3;
    doc.setFontSize(9);
    for (const [tipo, l] of blocchi) {
      if (tipo === 'nota') { doc.setFont('helvetica', 'bold'); doc.setTextColor(150, 70, 0); }
      T(l, xTesto, yt);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
      yt += l.length * 4;
    }
    if (conTaglie) {
      yt += 1;
      let xt = xTesto;
      doc.setFontSize(8);
      for (const [t, q] of tg) {
        if (xt + 10 > xTesto + largTesto) { xt = xTesto; yt += 11; }
        doc.setDrawColor(180); doc.setLineWidth(0.2); doc.rect(xt, yt, 10, 9);
        doc.setTextColor(110); T(t, xt + 5, yt + 3.4, { align: 'center' });
        doc.setTextColor(0); doc.setFont('helvetica', 'bold'); T(String(q), xt + 5, yt + 7.6, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        xt += 11;
      }
      if (r.grigliaId) {
        const g = M.gri.get(r.grigliaId);
        doc.setTextColor(110); T(`griglia ${g?.cod ? g.cod + ' ' : ''}${g?.nome || ''}`, xTesto, yt + 12); doc.setTextColor(0);
      }
    }

    // prezzi (solo amministrazione)
    if (prezzi) {
      const xp = W - MARG - 54;
      const vv = [
        ['Prezzo d\'acquisto', eur(r.prezzo)],
        ['Sconti', `${scontoComm(r)}% + ${scontoFin(r)}%`],
        ['Netto unitario', eur(prezzoNetto(r))],
        ['Totale netto', eur(totaleRiga(r))],
        ['Prezzo di vendita', r.prezzoVendita != null ? eur(r.prezzoVendita) : '-'],
      ];
      let yp = y + 4;
      doc.setFontSize(8.5);
      for (const [k, v] of vv) {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(110); T(k, xp, yp);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(0); T(v, W - MARG, yp, { align: 'right' });
        yp += 4.6;
      }
    }
    y += h;
    doc.setDrawColor(210); doc.setLineWidth(0.2); doc.line(MARG, y - 2, W - MARG, y - 2);
  }

  // numeri di pagina
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
    T(`Generato il ${dataOra(oraIso())} - pagina ${i} di ${n}`, W - MARG, H - 6, { align: 'right' });
  }
  const blob = doc.output('blob');
  const nome = `Ordine ${o.id} ${nomeFornitore(o.fornitoreId)}${prezzi ? '' : ' (senza prezzi)'}.pdf`;
  await condividiFile(blob, nome.replace(/[\\/:*?"<>|]/g, '-'));
}

// ---------------------------------------------------------------- distinta di ricezione
// PDF di una distinta (proposta del 01/11/2026: le distinte si vedevano solo a schermo). A4 verticale:
// testata, eventuale chiusura con differenze, poi per ogni articolo la tabella delle taglie (ordinato,
// già ricevuto, questa consegna, totale) con le celle diverse dall'ordinato evidenziate e le segnalazioni.
// prezzi: valore ordinato e ricevuto (solo amministrazione e buyer).
const SENZA = SENZA_TAGLIA;
const nomeStatoRiga = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export async function esportaPdfDistinta(distintaId, { prezzi = false } = {}) {
  await caricaScript('vendor/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const d = M.distinte.get(distintaId);
  const o = M.ord.get(d.ordineId);
  const PW = 210, PH = 297, larg = PW - 2 * MARG;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const fornitore = nomeFornitore(o?.fornitoreId);
  doc.setProperties({ title: `Distinta ordine ${d.ordineId} ${fornitore}`, creator: 'WHITE.7 Buying (demo)' });
  const T = (t, x, y, opz) => doc.text(Array.isArray(t) ? t.map(pulisci) : pulisci(t), x, y, opz);
  const testoLargo = (t, l) => doc.splitTextToSize(pulisci(t), l);

  let y = MARG;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  T(`Distinta ${d.tipo} - ordine n. ${d.ordineId}`, MARG, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
  T(`${fornitore} - ${o ? stagioneNome(stagioneOrdine(o)) : ''}`, MARG, y + 11);
  doc.setFontSize(8.5);
  T(prezzi ? 'Con i valori economici' : 'Senza dati economici', PW - MARG, y + 5, { align: 'right' });
  doc.setTextColor(0);
  y += 18;

  const kv = [
    ['Data', dataOra(d.data)], ['Compilata da', RUOLI[d.ruolo]?.nome || d.ruolo],
    ['Capi in questa consegna', num(d.pezziRicevuti)],
    ['Conformi sul totale', `${num(d.pezziConformi)} / ${num(d.pezziOrdinati)} - ${Math.round(d.perc)}%`],
  ];
  if (prezzi) {
    kv.push(['Valore ordinato', eur(d.valoreOrdinato)]);
    kv.push(['Valore ricevuto conforme', `${eur(d.valoreRicevuto)} - ${Math.round(d.valoreOrdinato ? d.valoreRicevuto / d.valoreOrdinato * 100 : 0)}%`]);
  }
  const colW = larg / 3;
  kv.forEach(([k, v], i) => {
    const x = MARG + (i % 3) * colW, yy = y + Math.floor(i / 3) * 11;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110); T(k, x, yy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0); T(v, x, yy + 4.5);
  });
  y += Math.ceil(kv.length / 3) * 11 + 2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  if (o?.chiusura?.conDifferenze) {
    doc.setTextColor(150, 70, 0); doc.setFont('helvetica', 'bold');
    const c = o.chiusura;
    const l = testoLargo(`Ordine chiuso con differenze da ${RUOLI[c.ruolo]?.nome || c.ruolo} il ${dataOra(c.data)}: mancanti ${c.mancanti}, eccedenze ${c.eccedenze}${c.nota ? ` - "${c.nota}"` : ''}`, larg);
    T(l, MARG, y); y += l.length * 4 + 2;
    doc.setTextColor(0); doc.setFont('helvetica', 'normal');
  }
  if (d.note) { const l = testoLargo(`Note sulla consegna: ${d.note}`, larg); T(l, MARG, y); y += l.length * 4 + 2; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  T(`${d.righe.length} articol${d.righe.length === 1 ? 'o' : 'i'} - ${d.discrepanze || 0} discrepanze di taglia - ${d.problemi || 0} segnalazioni`, MARG, y + 2);
  y += 5;
  doc.setDrawColor(30); doc.setLineWidth(0.4); doc.line(MARG, y, PW - MARG, y);
  y += 5;

  const intestazione = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    T(`Distinta ${d.tipo} - ordine n. ${d.ordineId} - ${fornitore} - ${dataOra(d.data)}`, MARG, MARG);
    doc.setTextColor(0);
    return MARG + 6;
  };

  const ETI = 30;   // colonna delle etichette della tabella
  for (const r of d.righe) {
    const taglie = [...new Set([...Object.keys(r.ordinate || {}), ...Object.keys(r.cumulate || {})])];
    const conPrima = Object.values(r.prima || {}).some((q) => q > 0);
    const righeTab = [['Ordinato', r.ordinate], ...(conPrima ? [['Già ricevuto', r.prima]] : []), ['Questa consegna', r.ricevute], ...(conPrima ? [['Totale', r.cumulate]] : [])];
    const confronta = conPrima ? 'Totale' : 'Questa consegna';
    const cella = Math.min(12, (larg - ETI) / Math.max(1, taglie.length));
    doc.setFontSize(8.5);
    const probl = r.problema ? testoLargo(`${r.problema}${r.nota ? ': ' + r.nota : ''}`, larg) : [];
    const diffTxt = r.stato !== 'conforme' && r.descr ? testoLargo(`Rispetto all'ordinato: ${r.descr}`, larg) : [];
    const h = 10 + 5 * (righeTab.length + 1) + 4 * (probl.length + diffTxt.length) + 5;
    if (y + h > PH - MARG - 6) { doc.addPage(); y = intestazione(); }

    doc.setFont('courier', 'bold'); doc.setFontSize(10.5); T(r.codArt || '(senza codice)', MARG, y + 3);
    const diversa = r.stato !== 'conforme';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    if (diversa) doc.setTextColor(170, 60, 0); else doc.setTextColor(20, 110, 60);
    T(nomeStatoRiga(r.stato), PW - MARG, y + 3, { align: 'right' });
    doc.setTextColor(90); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    if (r.descrizione) T(testoLargo(r.descrizione, larg - 40)[0], MARG, y + 7.5);
    doc.setTextColor(0);
    let yt = y + 10;
    // tabella delle taglie
    doc.setFontSize(8); doc.setDrawColor(190); doc.setLineWidth(0.2);
    doc.setTextColor(110);
    taglie.forEach((t, k) => T(t === SENZA ? 'Pezzi' : t, MARG + ETI + k * cella + cella / 2, yt + 3.5, { align: 'center' }));
    doc.setTextColor(0);
    yt += 5;
    for (const [nome, val] of righeTab) {
      doc.setFont('helvetica', nome === confronta ? 'bold' : 'normal');
      T(nome, MARG, yt + 3.5);
      taglie.forEach((t, k) => {
        const x = MARG + ETI + k * cella;
        const q = Number(val?.[t]) || 0, attesa = Number(r.ordinate?.[t]) || 0;
        if (nome === confronta && q !== attesa) { doc.setFillColor(253, 226, 196); doc.rect(x, yt, cella, 5, 'F'); }
        doc.rect(x, yt, cella, 5);
        T(q ? String(q) : '-', x + cella / 2, yt + 3.5, { align: 'center' });
      });
      yt += 5;
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    if (diffTxt.length) { yt += 1; doc.setTextColor(90); T(diffTxt, MARG, yt + 3); yt += diffTxt.length * 4; doc.setTextColor(0); }
    if (probl.length) { yt += 1; doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 30, 30); T(probl, MARG, yt + 3); yt += probl.length * 4; doc.setTextColor(0); doc.setFont('helvetica', 'normal'); }
    y = yt + 3;
    doc.setDrawColor(215); doc.setLineWidth(0.2); doc.line(MARG, y, PW - MARG, y);
    y += 4;
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120);
    T(`Generato il ${dataOra(oraIso())} - pagina ${i} di ${n}`, PW - MARG, PH - 6, { align: 'right' });
  }
  const nome = `Distinta ${d.tipo} ordine ${d.ordineId} ${fornitore} ${d.data.slice(0, 10)}.pdf`;
  await condividiFile(doc.output('blob'), nome.replace(/[\\/:*?"<>|]/g, '-'));
}
