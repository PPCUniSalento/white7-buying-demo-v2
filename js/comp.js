// Componenti condivisi.

import { M, state, fotoRiga, fotoPrincipale, aggiungiFoto, eliminaFoto, riordinaFoto, riepilogo, attivo, nuovoFornitore, fornitoriSimili, giorniConsegna } from './db.js';
import { STATI, euro, num, perc, urlBlob, elaboraFoto, dataDiConsegna, giornoDiConsegna, nomeGiorno } from './util.js';

const { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;

const P = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  chart: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z',
  check: 'M20 6 9 17l-5-5',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M3 5h18v14H3zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 19',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  x: 'M18 6 6 18M6 6l12 12',
  truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  clip: 'M9 2h6v4H9zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 13l2 2 4-4',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  down: 'M6 9l6 6 6-6',
  up: 'M18 15l-6-6-6 6',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  gallery: 'M4 4h12v12H4zM20 8v12H8M8 12l2-2 3 3',
  aperture: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
};

export const Ic = {
  props: { n: String, s: { type: Number, default: 20 } },
  setup: () => ({ P }),
  template: `<svg :width="s" :height="s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ic"><path :d="P[n]"/></svg>`,
};

export const Thumb = {
  props: { rigaId: Number, fotoId: Number, w: { type: Number, default: 52 } },
  setup(p) {
    const src = computed(() => {
      state.rev;
      const f = p.fotoId ? M.foto.get(p.fotoId) : fotoPrincipale(p.rigaId);
      return f ? urlBlob('t' + f.id, f.thumb) : '';
    });
    return { src };
  },
  template: `<div class="thumb" :style="{width: w + 'px', height: Math.round(w * 1.25) + 'px'}">
    <img v-if="src" :src="src" alt=""><ic v-else n="image" :s="Math.round(w / 2.6)"/></div>`,
};

export const StatoBadge = {
  props: { stato: String },
  setup: () => ({ STATI }),
  template: `<span class="badge-stato" :class="STATI[stato]?.classe">{{ STATI[stato]?.nome || stato }}</span>`,
};

export const Sheet = {
  props: { titolo: String, alto: Boolean },
  emits: ['chiudi'],
  template: `<teleport to="body"><div class="sheet-bg" @click.self="$emit('chiudi')">
    <div class="sheet" :class="{alto}" role="dialog" aria-modal="true">
      <div class="sheet-h"><b>{{ titolo }}</b>
        <button class="btn-ic" @click="$emit('chiudi')" aria-label="Chiudi"><ic n="x"/></button></div>
      <div class="sheet-c"><slot/></div>
    </div></div></teleport>`,
};

export const PageHead = {
  props: { titolo: String, sotto: String, indietro: String },
  template: `<div class="pagehead">
    <a v-if="indietro" class="btn-ic" :href="indietro" aria-label="Indietro"><ic n="back" :s="22"/></a>
    <div class="ph-t"><h1>{{ titolo }}</h1><div v-if="sotto" class="ph-s">{{ sotto }}</div></div>
    <div class="ph-a"><slot/></div></div>`,
};

// Scelta del fornitore fra ~900 voci: ricerca testuale, i più usati in cima.
// "Nuovo fornitore" lo aggiunge all'anagrafica (richiesta del 20/10/2026), con un avviso sui nomi simili.
export const FornitorePicker = {
  props: { modelValue: Number, disabled: Boolean, nuovo: { type: Boolean, default: true } },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    const aperto = ref(false), q = ref('');
    const crea = ref(null);
    const conteggio = computed(() => {
      state.rev;
      const m = new Map();
      for (const o of M.ord.values()) m.set(o.fornitoreId, (m.get(o.fornitoreId) || 0) + 1);
      return m;
    });
    const elenco = computed(() => {
      const t = q.value.trim().toLowerCase();
      let a = M.fornitori.filter((f) => attivo(f) || f.id === p.modelValue);
      if (t) a = a.filter((f) => f.nome.toLowerCase().includes(t) || (f.cod || '').toLowerCase() === t);
      a = [...a].sort((x, y) => (conteggio.value.get(y.id) || 0) - (conteggio.value.get(x.id) || 0) || x.nome.localeCompare(y.nome));
      return a.slice(0, 80);
    });
    const nome = computed(() => (p.modelValue ? M.forn.get(p.modelValue)?.nome : ''));
    const scegli = (f) => { emit('update:modelValue', f.id); aperto.value = false; q.value = ''; crea.value = null; };
    const simili = computed(() => (crea.value ? fornitoriSimili(crea.value.nome) : []));
    const apriCrea = () => { crea.value = { nome: q.value.trim(), cod: '' }; };
    async function aggiungi() {
      const n = crea.value.nome.trim();
      if (!n) return;
      if (M.fornitori.some((f) => f.nome.trim().toLowerCase() === n.toLowerCase())) {
        toast('Esiste già un fornitore con questo nome', 'err');
        return;
      }
      const f = await nuovoFornitore(n, crea.value.cod);
      toast(`Fornitore «${f.nome}» aggiunto`);
      scegli(f);
    }
    return { aperto, q, elenco, nome, scegli, conteggio, crea, simili, apriCrea, aggiungi };
  },
  template: `<div>
    <button type="button" class="campo-btn" :class="{vuoto: !nome}" :disabled="disabled" @click="aperto = true">
      <span>{{ nome || 'Seleziona fornitore…' }}</span><ic n="down" :s="18"/></button>
    <sheet v-if="aperto" :titolo="crea ? 'Nuovo fornitore' : 'Fornitore'" alto @chiudi="aperto = false; crea = null">
      <template v-if="crea">
        <div class="form">
          <label class="largo">Nome *<input class="inp" v-model="crea.nome" autofocus></label>
          <label class="largo">Codice (facoltativo)<input class="inp mono" v-model="crea.cod" placeholder="Codice del gestionale, se c'è già"></label>
        </div>
        <div v-if="simili.length" class="banner avviso col"><b>Ci sono già fornitori con un nome simile:</b>
          <button v-for="f in simili" :key="f.id" class="link" @click="scegli(f)">{{ f.nome }}<template v-if="f.cod"> ({{ f.cod }})</template></button>
          <span>Tocca un nome per sceglierlo invece di crearne uno nuovo.</span></div>
        <div class="azioni-pagina"><button class="btn primario" :disabled="!crea.nome.trim()" @click="aggiungi"><ic n="plus"/> Aggiungi e scegli</button>
          <button class="btn" @click="crea = null">Annulla</button></div>
        <p class="muted">Il nuovo fornitore resta segnato come «nuovo» finché non riceve il codice del gestionale.</p>
      </template>
      <template v-else>
      <div class="riga-inp"><input class="inp" v-model="q" placeholder="Cerca per nome o codice" autofocus>
        <button v-if="nuovo" class="btn" @click="apriCrea"><ic n="plus"/> Nuovo</button></div>
      <button v-if="nuovo && q.trim() && !elenco.some(f => f.nome.toLowerCase() === q.trim().toLowerCase())" class="btn pieno nuovo-forn" @click="apriCrea">
        <ic n="plus"/> Aggiungi «{{ q.trim() }}» come nuovo fornitore</button>
      <ul class="lista-scelta">
        <li v-for="f in elenco" :key="f.id"><button @click="scegli(f)" :class="{on: f.id === modelValue}">
          <span>{{ f.nome }}<i v-if="f.nuovo" class="tag-nuovo">nuovo</i></span><small v-if="conteggio.get(f.id)">{{ conteggio.get(f.id) }} ordin{{ conteggio.get(f.id) === 1 ? 'e' : 'i' }}</small></button></li>
        <li v-if="!elenco.length" class="muted pad">Nessun fornitore trovato</li>
      </ul>
      </template>
    </sheet></div>`,
};

// Mirino della fotocamera nella pagina: scatti a raffica senza uscire dall'app
export const Mirino = {
  emits: ['foto', 'chiudi'],
  props: { conteggio: Number },
  setup(p, { emit }) {
    const video = ref(null), errore = ref(''), lampo = ref(false), occupato = ref(false);
    let stream = null;
    onMounted(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false,
        });
        video.value.srcObject = stream;
        await video.value.play();
      } catch (e) {
        errore.value = 'Fotocamera non disponibile (' + (e.name || e.message) + '). Usa "Scatta" o "Galleria".';
      }
    });
    onBeforeUnmount(() => stream && stream.getTracks().forEach((t) => t.stop()));
    async function cattura() {
      if (occupato.value || !video.value?.videoWidth) return;
      occupato.value = true;
      lampo.value = true;
      setTimeout(() => (lampo.value = false), 140);
      try { emit('foto', await elaboraFoto(video.value)); } finally { occupato.value = false; }
    }
    return { video, errore, lampo, cattura, occupato };
  },
  template: `<teleport to="body"><div class="mirino">
    <video ref="video" playsinline muted autoplay></video>
    <div class="lampo" v-if="lampo"></div>
    <div v-if="errore" class="mirino-err">{{ errore }}</div>
    <div class="mirino-bar">
      <button class="btn chiaro" @click="$emit('chiudi')">Fine</button>
      <button class="scatto" :disabled="!!errore || occupato" @click="cattura" aria-label="Cattura"></button>
      <span class="mirino-n">{{ conteggio }} foto</span>
    </div></div></teleport>`,
};

export const Visore = {
  props: { fotoIds: Array, indice: { type: Number, default: 0 } },
  emits: ['chiudi'],
  setup(p) {
    const i = ref(p.indice);
    const src = computed(() => {
      const f = M.foto.get(p.fotoIds[i.value]);
      return f ? urlBlob('b' + f.id, f.blob) : '';
    });
    return { i, src };
  },
  template: `<teleport to="body"><div class="visore" @click.self="$emit('chiudi')">
    <img :src="src" alt="">
    <button class="vis-x btn-ic" @click="$emit('chiudi')" aria-label="Chiudi"><ic n="x" :s="26"/></button>
    <button v-if="i > 0" class="vis-p btn-ic" @click="i--" aria-label="Precedente"><ic n="back" :s="30"/></button>
    <button v-if="i < fotoIds.length - 1" class="vis-n btn-ic" @click="i++" aria-label="Successiva"><ic n="next" :s="30"/></button>
    <div class="vis-c">{{ i + 1 }} / {{ fotoIds.length }}</div></div></teleport>`,
};

// Foto di un articolo: mirino, fotocamera nativa, galleria; prima foto = principale
export const FotoArticolo = {
  props: { rigaId: Number, modificabile: Boolean },
  setup(p) {
    const mirino = ref(false), visore = ref(null), elab = ref(0), sel = ref(null);
    const inpCam = ref(null), inpGal = ref(null);
    const haMirino = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const foto = computed(() => { state.rev; return [...fotoRiga(p.rigaId)]; });
    const min = computed(() => state.cfg.minFoto);
    async function daFile(ev) {
      const files = [...(ev.target.files || [])];
      ev.target.value = '';
      for (const f of files) {
        elab.value++;
        try { await aggiungiFoto(p.rigaId, await elaboraFoto(f)); } finally { elab.value--; }
      }
    }
    const daMirino = (r) => aggiungiFoto(p.rigaId, r);
    async function principale(f) {
      const ids = foto.value.map((x) => x.id).filter((id) => id !== f.id);
      await riordinaFoto(p.rigaId, [f.id, ...ids]);
      sel.value = null;
    }
    async function sposta(f, d) {
      const ids = foto.value.map((x) => x.id);
      const i = ids.indexOf(f.id), j = i + d;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await riordinaFoto(p.rigaId, ids);
      sel.value = null;
    }
    async function elimina(f) {
      if (!confirm('Eliminare questa foto?')) return;
      await eliminaFoto(f.id);
      sel.value = null;
    }
    const apri = (k) => (visore.value = k);
    return { mirino, visore, elab, sel, inpCam, inpGal, haMirino, foto, min, daFile, daMirino, principale, sposta, elimina, apri };
  },
  template: `<div class="foto-art">
    <div class="foto-griglia">
      <button v-for="(f, k) in foto" :key="f.id" class="foto-cella" @click="modificabile ? (sel = f) : apri(k)">
        <thumb :foto-id="f.id" :w="78"/><span v-if="k === 0" class="foto-princ"><ic n="star" :s="11"/> Principale</span>
      </button>
      <div v-for="n in Math.max(foto.length ? 0 : 1, min - foto.length)" :key="'v' + n" class="foto-cella vuota"><ic n="camera" :s="22"/></div>
      <div v-if="elab" class="foto-cella vuota"><span class="spin"></span></div>
    </div>
    <div class="foto-info" :class="{ko: min > 0 && foto.length < min}">{{ foto.length ? foto.length + ' foto' : 'Nessuna foto' }}
      · {{ min > 0 ? 'minimo ' + min : 'facoltative, anche tre o più' }}<span v-if="foto.length"> · la prima è l'immagine principale</span></div>
    <div v-if="modificabile" class="foto-azioni">
      <button v-if="haMirino" class="btn" @click="mirino = true"><ic n="aperture"/> Mirino</button>
      <button class="btn" @click="inpCam.click()"><ic n="camera"/> Scatta</button>
      <button class="btn" @click="inpGal.click()"><ic n="gallery"/> Galleria</button>
      <input ref="inpCam" type="file" accept="image/*" capture="environment" hidden @change="daFile">
      <input ref="inpGal" type="file" accept="image/*" multiple hidden @change="daFile">
    </div>
    <mirino v-if="mirino" :conteggio="foto.length" @foto="daMirino" @chiudi="mirino = false"/>
    <visore v-if="visore !== null" :foto-ids="foto.map(f => f.id)" :indice="visore" @chiudi="visore = null"/>
    <sheet v-if="sel" titolo="Foto" @chiudi="sel = null">
      <div class="menu-azioni">
        <button @click="apri(foto.indexOf(sel)); sel = null"><ic n="image"/> Visualizza</button>
        <button v-if="foto[0] !== sel" @click="principale(sel)"><ic n="star"/> Imposta come principale</button>
        <button v-if="foto[0] !== sel" @click="sposta(sel, -1)"><ic n="back"/> Sposta prima</button>
        <button v-if="foto[foto.length - 1] !== sel" @click="sposta(sel, 1)"><ic n="next"/> Sposta dopo</button>
        <button class="rosso" @click="elimina(sel)"><ic n="trash"/> Elimina immagine</button>
      </div>
    </sheet></div>`,
};

// Data di consegna: mese + giorno fra quelli ammessi dalla configurazione (1, 15, fine mese…).
// fine: se si sceglie solo il mese, propone l'ultimo giorno ammesso invece del primo.
export const DataConsegna = {
  props: { modelValue: String, disabled: Boolean, fine: Boolean },
  emits: ['update:modelValue'],
  setup(p, { emit }) {
    const ym = computed(() => (p.modelValue || '').slice(0, 7));
    const giorno = computed(() => giornoDiConsegna(p.modelValue));
    const opzioni = computed(() => {
      const g = giorniConsegna().map(String);
      if (giorno.value && !g.includes(giorno.value)) g.push(giorno.value);
      return g.sort((a, b) => (a === 'fine') - (b === 'fine') || Number(a) - Number(b));
    });
    function setMese(v) {
      if (!v) { emit('update:modelValue', null); return; }
      const g = giorno.value || (p.fine ? opzioni.value[opzioni.value.length - 1] : opzioni.value[0]) || 1;
      emit('update:modelValue', dataDiConsegna(v, g));
    }
    const setGiorno = (g) => { if (ym.value) emit('update:modelValue', dataDiConsegna(ym.value, g)); };
    return { ym, giorno, opzioni, setMese, setGiorno, nomeGiorno };
  },
  template: `<div class="data-cons">
    <input class="inp" type="month" :value="ym" :disabled="disabled" @change="setMese($event.target.value)">
    <select class="inp" :value="giorno" :disabled="disabled || !ym" @change="setGiorno($event.target.value)">
      <option v-for="g in opzioni" :key="g" :value="g">{{ nomeGiorno(g) }}</option></select></div>`,
};

// Riepilogo ordine per categoria e sottocategoria
export const Riepilogo = {
  props: { righe: Array, scontoExtra: Number, prezzi: { type: Boolean, default: true } },
  setup(p) {
    const r = computed(() => riepilogo(p.righe, p.scontoExtra));
    return { r, euro, num, perc };
  },
  template: `<table class="tab riep">
    <thead><tr><th>Categoria</th><th class="n">Capi</th><th v-if="prezzi" class="n">Importo</th><th v-if="prezzi" class="n">%</th></tr></thead>
    <tbody>
      <template v-for="m in r.macro" :key="m.id">
        <tr class="riep-m"><td>{{ m.nome }}</td><td class="n">{{ num(m.pezzi) }}</td><td v-if="prezzi" class="n">{{ euro(m.valore) }}</td>
          <td v-if="prezzi" class="n">{{ perc(r.valore ? m.valore / r.valore * 100 : 0) }}</td></tr>
        <tr v-for="c in m.cat" :key="m.id + '-' + c.id" class="riep-c"><td>{{ c.nome }}</td><td class="n">{{ num(c.pezzi) }}</td>
          <td v-if="prezzi" class="n">{{ euro(c.valore) }}</td><td v-if="prezzi"></td></tr>
      </template>
      <tr v-if="!r.macro.length"><td colspan="4" class="muted">Nessun articolo</td></tr>
    </tbody>
    <tfoot><tr><td>Totale</td><td class="n">{{ num(r.pezzi) }}</td><td v-if="prezzi" class="n">{{ euro(r.valore) }}</td><td v-if="prezzi"></td></tr>
      <tr v-if="prezzi && scontoExtra"><td>Scontato ({{ scontoExtra }}%)</td><td></td><td class="n">{{ euro(r.scontato) }}</td><td></td></tr></tfoot>
  </table>`,
};

export function toast(testo, tipo = 'ok') {
  state.toast = { testo, tipo, t: Date.now() };
  const t = state.toast.t;
  setTimeout(() => { if (state.toast && state.toast.t === t) state.toast = null; }, 2800);
}

export function registraComuni(app) {
  Object.entries({ Ic, Thumb, StatoBadge, Sheet, PageHead, FornitorePicker, DataConsegna, Mirino, Visore, FotoArticolo, Riepilogo })
    .forEach(([k, v]) => app.component(k, v));
}

export { nextTick, watch };
