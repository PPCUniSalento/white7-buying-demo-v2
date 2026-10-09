// Costanti, formattazione ed elaborazione immagini.

export const RUOLI = {
  buyer: { nome: 'Buyer', breve: 'Buyer', colore: '#1d4f91', prezzi: true },
  amministrazione: { nome: 'Amministrazione', breve: 'Ammin.', colore: '#6a3fb0', prezzi: true },
  logistica: { nome: 'Logistica', breve: 'Logistica', colore: '#a55a12', prezzi: false },
  puntovendita: { nome: 'Punto vendita', breve: 'Negozio', colore: '#15705a', prezzi: false },
};

export const STATI = {
  bozza: { nome: 'Bozza', classe: 'st-bozza' },
  confermato: { nome: 'Confermato', classe: 'st-confermato' },
  trasmesso: { nome: 'Trasmesso', classe: 'st-trasmesso' },
  parziale: { nome: 'Parz. consegnato', classe: 'st-parziale' },
  chiuso: { nome: 'Chiuso', classe: 'st-chiuso' },
};

export const GENERI = { U: 'Uomo', D: 'Donna', X: 'Unisex' };

export const PROBLEMI = ['Mancante', 'Difettoso', 'Non conforme al campione', 'Taglia errata', 'Colore errato', 'Altro'];

export const stagioneKey = (anno, s) => `${anno}${s}`;
// L'anno è quello di fine stagione: A/I 2026 = autunno 2025 – inverno 2026, quindi A/I precede P/E
export const stagioneOrd = (k) => parseInt(k.slice(0, 4), 10) * 10 + (k.endsWith('I') ? 1 : 2);
export const stagioneSucc = (k) => (k.endsWith('I') ? `${k.slice(0, 4)}E` : `${parseInt(k.slice(0, 4), 10) + 1}I`);
// Periodo di consegna proposto: P/E gen–mar dell'anno; A/I lug–set dell'anno precedente
export const consegnaStagione = (anno, s) => (s === 'E' ? [`${anno}-01`, `${anno}-03`] : [`${anno - 1}-07`, `${anno - 1}-09`]);
export const stagioneNome = (k) => (k ? `${k.endsWith('I') ? 'A/I' : 'P/E'} ${k.slice(0, 4)}` : '');
export const stagionePrec = (k) => `${parseInt(k.slice(0, 4), 10) - 1}${k.slice(4)}`;

const fEuro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fEuro0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fNum = new Intl.NumberFormat('it-IT');
const fPerc = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });

export const euro = (v) => fEuro.format(v || 0);
export const euro0 = (v) => fEuro0.format(v || 0);
export const num = (v) => fNum.format(v || 0);
export const perc = (v) => (v == null || !isFinite(v) ? '–' : `${fPerc.format(v)}%`);
export const delta = (a, b) => (b ? ((a - b) / b) * 100 : null);

export function data(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function dataOra(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export function mese(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MESI[parseInt(m, 10) - 1]} ${y}`;
}
export const meseCorrente = () => new Date().toISOString().slice(0, 7);
export const oraIso = () => new Date().toISOString();

// Totale riga: prezzo × quantità al netto dello sconto di riga (%)
export const totaleRiga = (r) => (r.prezzo || 0) * (r.qta || 0) * (1 - (r.sconto || 0) / 100);

// Formato codice articolo: "CODICE+TESSUTO COLORE" (almeno due blocchi separati da spazio)
export function controllaCodice(cod) {
  const c = (cod || '').trim();
  if (!c) return 'Codice articolo obbligatorio';
  if (!/\s/.test(c)) return 'Formato: codice e tessuto uniti, poi uno spazio e il codice colore (es. UP563DS0369UMD7 999)';
  const [base, colore] = [c.slice(0, c.lastIndexOf(' ')).trim(), c.slice(c.lastIndexOf(' ') + 1)];
  if (base.length < 3) return 'Codice + tessuto troppo corto';
  if (!colore) return 'Manca il codice colore dopo lo spazio';
  return null;
}

// ---------- immagini ----------
function caricaImmagine(file) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); ko(e); };
    img.src = url;
  });
}
function ridimensiona(sorgente, lato, qualita) {
  const w0 = sorgente.videoWidth || sorgente.naturalWidth || sorgente.width;
  const h0 = sorgente.videoHeight || sorgente.naturalHeight || sorgente.height;
  const k = Math.min(1, lato / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k);
  c.height = Math.round(h0 * k);
  c.getContext('2d').drawImage(sorgente, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualita));
}
// Da file (fotocamera nativa o galleria) o da un <video> (mirino): foto ottimizzata + miniatura
export async function elaboraFoto(sorgente) {
  const img = sorgente instanceof Blob ? await caricaImmagine(sorgente) : sorgente;
  const [blob, thumb] = await Promise.all([ridimensiona(img, 1600, 0.82), ridimensiona(img, 360, 0.72)]);
  return { blob, thumb };
}

const urlCache = new Map();
export function urlBlob(chiave, blob) {
  if (!blob) return '';
  let u = urlCache.get(chiave);
  if (!u || u.blob !== blob) {
    if (u) URL.revokeObjectURL(u.url);
    u = { blob, url: URL.createObjectURL(blob) };
    urlCache.set(chiave, u);
  }
  return u.url;
}

export function blobBase64(blob) {
  return new Promise((ok) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result.split(',')[1]);
    fr.readAsDataURL(blob);
  });
}

// Condivide un file col menu di sistema; se non disponibile lo scarica.
export async function condividiFile(blob, nome) {
  const file = new File([blob], nome, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: nome });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  return f;
}

export function caricaScript(src) {
  return new Promise((ok, ko) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = ko;
    document.head.appendChild(s);
  });
}
