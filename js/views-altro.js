// Primo avvio, impostazioni, anagrafiche, registro modifiche.

import { M, state, db, importaSeed, ripristina, salvaImpostazioni, stagioni, spazioOccupato, seedVersionePrecedente } from './db.js';
import { RUOLI, num, dataOra, stagioneNome, stagioneOrd, stagioneSucc, inApp, nativo } from './util.js';
import { toast } from './comp.js';

const { ref, computed, onMounted } = Vue;

async function chiediPersistenza() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* facoltativo */ }
}

export async function caricaDaFile(file) {
  const buf = await file.arrayBuffer();
  await importaSeed(buf);
  await chiediPersistenza();
}

// ---------------------------------------------------------------- primo avvio
export const Setup = {
  setup() {
    const inp = ref(null), lavoro = ref(false), errore = ref('');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    // archivio già caricato nella versione precedente, sullo stesso dispositivo e browser
    const v1 = ref(null), doc = ref(null);
    onMounted(async () => {
      v1.value = await seedVersionePrecedente();
      // nell'app iOS: archivio copiato nei Documenti dell'app (app File, Finder)
      if (inApp()) doc.value = await nativo('archivio').catch(() => null);
    });
    async function daDocumenti() {
      lavoro.value = true;
      errore.value = '';
      try {
        const bin = atob(doc.value.base64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        await importaSeed(u8.buffer);
        await chiediPersistenza();
        toast('Archivio caricato');
        location.hash = '#/';
      } catch (e) {
        errore.value = e.message || String(e);
      } finally { lavoro.value = false; }
    }
    async function daV1() {
      lavoro.value = true;
      errore.value = '';
      try {
        await importaSeed(await v1.value.arrayBuffer());
        await chiediPersistenza();
        toast('Archivio caricato');
        location.hash = '#/';
      } catch (e) {
        errore.value = e.message || String(e);
      } finally { lavoro.value = false; }
    }
    async function scelto(ev) {
      const f = ev.target.files?.[0];
      ev.target.value = '';
      if (!f) return;
      lavoro.value = true;
      errore.value = '';
      try {
        await caricaDaFile(f);
        toast('Archivio caricato');
        location.hash = '#/';
      } catch (e) {
        errore.value = e.message || String(e);
      } finally { lavoro.value = false; }
    }
    return { inp, lavoro, errore, scelto, ios, v1, daV1, doc, daDocumenti, inApp: inApp() };
  },
  template: `<div class="pagina setup">
    <div class="setup-logo">W7</div>
    <h1>WHITE.7 Buying</h1>
    <p class="muted">Demo offline del nuovo software di buying · versione 2</p>
    <section class="card">
      <h2>1. Carica l'archivio dati</h2>
      <p>Seleziona il file <b class="mono">seed_white7.json.gz</b> (dalla cartella OneDrive del progetto, da File o da AirDrop).
        I dati restano solo su questo dispositivo: l'app non li invia a nessun server.</p>
      <button v-if="doc" class="btn primario pieno grande" :disabled="lavoro" @click="daDocumenti">
        <ic n="download"/> Usa l'archivio nei Documenti</button>
      <p v-if="doc" class="muted">Trovato <span class="mono">{{ doc.nome }}</span> nei Documenti dell'app.</p>
      <button v-if="v1" class="btn primario pieno grande" :disabled="lavoro" @click="daV1">
        <ic n="copy"/> Usa l'archivio già caricato</button>
      <p v-if="v1" class="muted">Su questo dispositivo è già caricato l'archivio della prima versione della demo: si può riusare senza cercare il file.</p>
      <button class="btn pieno grande" :class="{primario: !v1}" :disabled="lavoro" @click="inp.click()">
        <span v-if="lavoro" class="spin"></span><ic v-else n="download"/> {{ lavoro ? 'Importazione in corso…' : 'Carica archivio' }}</button>
      <input ref="inp" type="file" hidden @change="scelto">
      <p v-if="errore" class="err">{{ errore }}</p>
    </section>
    <section v-if="!inApp" class="card">
      <h2>2. Installa l'app</h2>
      <p v-if="ios">In Safari: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>. Aprendola dall'icona funziona anche in modalità aereo.
        Nota: su iPhone l'app installata e Safari hanno archivi separati, quindi carica l'archivio dall'app installata.</p>
      <p v-else>Nel menu del browser scegli <b>Installa app</b> o <b>Aggiungi a schermata Home</b>. Dopo l'installazione funziona anche offline.</p>
    </section>
  </div>`,
};

// ---------------------------------------------------------------- altro
export const Altro = {
  setup() {
    const spazio = ref(null), inp = ref(null), lavoro = ref(false), info = ref(null);
    const conteggi = computed(() => { state.rev; return { ordini: M.ord.size, righe: M.rig.size, foto: M.foto.size, msg: M.messaggi.size, log: M.log.length }; });
    const elencoStagioni = computed(() => {
      const s = stagioni();
      const tutte = new Set(s);
      if (s[0]) { tutte.add(stagioneSucc(s[0])); tutte.add(stagioneSucc(stagioneSucc(s[0]))); }
      return [...tutte].sort((a, b) => stagioneOrd(b) - stagioneOrd(a));
    });
    onMounted(async () => {
      const u = await spazioOccupato();
      spazio.value = u == null ? null : u / 1048576;
      info.value = (await db.meta.get('seedInfo'))?.v || null;
    });
    const salva = () => salvaImpostazioni();
    async function reset() {
      if (!confirm('Ripristinare i dati originali? Ordini, foto, trasmissioni e distinte creati nella demo verranno cancellati.')) return;
      lavoro.value = true;
      try { await ripristina(); toast('Dati demo ripristinati'); location.hash = '#/'; } catch (e) { toast(e.message, 'err'); } finally { lavoro.value = false; }
    }
    async function altroArchivio(ev) {
      const f = ev.target.files?.[0];
      ev.target.value = '';
      if (!f || !confirm('Caricare questo archivio? I dati attuali verranno sostituiti.')) return;
      lavoro.value = true;
      try { await caricaDaFile(f); toast('Archivio caricato'); location.hash = '#/'; } catch (e) { toast(e.message, 'err'); } finally { lavoro.value = false; }
    }
    const online = navigator.onLine;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const generi = computed(() => state.cfg.generi.filter((g) => g.attivo !== false));
    const aziende = computed(() => M.aziende.filter((a) => a.attivo !== false));
    return { spazio, inp, lavoro, info, conteggi, elencoStagioni, salva, reset, altroArchivio, online, standalone, state, M, RUOLI, generi, aziende, num, dataOra, stagioneNome };
  },
  template: `<div class="pagina">
    <page-head titolo="Altro" :sotto="'Ruolo: ' + RUOLI[state.ruolo].nome"/>
    <section class="card">
      <div class="card-h"><h2>Impostazioni</h2></div>
      <div class="form">
        <label>Stagione di lavoro<select class="inp" v-model="state.imp.stagioneLavoro" @change="salva">
          <option v-for="s in elencoStagioni" :value="s">{{ stagioneNome(s) }}</option></select></label>
        <label>Genere predefinito<select class="inp" v-model="state.imp.genereDefault" @change="salva">
          <option v-for="g in generi" :value="g.k">{{ g.nome }}</option></select></label>
        <label>Società predefinita<select class="inp" v-model.number="state.imp.aziendaDefault" @change="salva">
          <option v-for="a in aziende" :value="a.id">{{ a.nome }}</option></select></label>
      </div>
      <p class="muted">Foto minime, campi obbligatori e le altre regole del negozio si impostano dal ruolo <b>Configurazione</b>.</p>
    </section>
    <section class="card">
      <div class="card-h"><h2>Anagrafiche</h2><small class="muted">si modificano dal ruolo Configurazione</small></div>
      <div class="menu-azioni">
        <a href="#/anagrafica/aziende"><ic n="list"/> Società <small>{{ M.aziende.length }}</small></a>
        <a href="#/anagrafica/fornitori"><ic n="list"/> Fornitori <small>{{ M.fornitori.length }}</small></a>
        <a href="#/anagrafica/categorie"><ic n="list"/> Categorie e sottocategorie <small>{{ M.macro.length }} / {{ M.categorie.length }}</small></a>
        <a href="#/anagrafica/colori"><ic n="list"/> Colori <small>{{ M.colori.length }}</small></a>
        <a href="#/anagrafica/griglie"><ic n="list"/> Griglie taglie <small>{{ M.griglie.length }}</small></a>
        <a href="#/anagrafica/pagamenti"><ic n="list"/> Condizioni di pagamento <small>{{ M.pagamenti.length }}</small></a>
        <a href="#/registro"><ic n="clip"/> Registro modifiche <small>{{ conteggi.log }}</small></a>
      </div>
    </section>
    <section class="card">
      <div class="card-h"><h2>Dati sul dispositivo</h2></div>
      <div class="kv">
        <div><span>Ordini</span><b>{{ num(conteggi.ordini) }}</b></div>
        <div><span>Righe articolo</span><b>{{ num(conteggi.righe) }}</b></div>
        <div><span>Foto</span><b>{{ num(conteggi.foto) }}</b></div>
        <div><span>Spazio occupato</span><b>{{ spazio == null ? '–' : spazio.toFixed(1) + ' MB' }}</b></div>
        <div v-if="info"><span>Archivio generato</span><b>{{ dataOra(info.generato) }}</b></div>
        <div><span>Connessione</span><b>{{ online ? 'online' : 'offline' }} · {{ standalone ? 'app installata' : 'nel browser' }}</b></div>
      </div>
      <div class="menu-azioni">
        <button @click="reset" :disabled="lavoro"><ic n="back"/> Ripristina i dati demo originali</button>
        <button @click="inp.click()" :disabled="lavoro"><ic n="download"/> Carica un altro archivio</button>
      </div>
      <input ref="inp" type="file" hidden @change="altroArchivio">
    </section>
    <p class="muted centro">WHITE.7 Buying · demo offline, versione 2 · i dati restano su questo dispositivo</p>
  </div>`,
};

// ---------------------------------------------------------------- anagrafiche (consultazione)
const TITOLI = {
  aziende: 'Società', fornitori: 'Fornitori', categorie: 'Categorie e sottocategorie', colori: 'Colori',
  griglie: 'Griglie taglie', pagamenti: 'Condizioni di pagamento',
};

export const Anagrafica = {
  props: { tipo: String },
  setup(p) {
    const q = ref(''), limite = ref(100);
    const nOrdini = computed(() => {
      const m = new Map();
      for (const o of M.ord.values()) m.set(o.fornitoreId, (m.get(o.fornitoreId) || 0) + 1);
      return m;
    });
    const fornitori = computed(() => {
      const t = q.value.trim().toLowerCase();
      return M.fornitori.filter((f) => !t || f.nome.toLowerCase().includes(t) || (f.cod || '').toLowerCase().includes(t))
        .sort((a, b) => (nOrdini.value.get(b.id) || 0) - (nOrdini.value.get(a.id) || 0) || a.nome.localeCompare(b.nome));
    });
    const macro = computed(() => M.macro.map((m) => ({
      ...m, cat: M.categorie.filter((c) => c.macroId === m.id).sort((a, b) => a.nome.localeCompare(b.nome)),
    })));
    const nomiGriglie = (ids) => (ids || []).map((id) => M.gri.get(id)?.nome).filter(Boolean).join(', ');
    const catDiGriglia = (id) => M.categorie.filter((c) => (c.griglie || []).includes(id)).map((c) => c.nome).join(', ');
    return { q, limite, nOrdini, fornitori, macro, nomiGriglie, catDiGriglia, M, titolo: TITOLI[p.tipo] || 'Anagrafica', num };
  },
  template: `<div class="pagina">
    <page-head :titolo="titolo" sotto="Consultazione · si modificano dal ruolo Configurazione" indietro="#/altro"/>
    <template v-if="tipo === 'fornitori'">
      <input class="inp" v-model="q" type="search" placeholder="Cerca fornitore">
      <ul class="lista"><li v-for="f in fornitori.slice(0, limite)" :key="f.id"><div class="grow"><b>{{ f.nome }}</b><small>codice {{ f.cod }}</small></div>
        <small v-if="nOrdini.get(f.id)">{{ nOrdini.get(f.id) }} ordin{{ nOrdini.get(f.id) === 1 ? 'e' : 'i' }}</small></li></ul>
      <button v-if="fornitori.length > limite" class="btn pieno" @click="limite += 200">Altri ({{ fornitori.length - limite }})</button>
    </template>
    <template v-else-if="tipo === 'categorie'">
      <section v-for="m in macro" :key="m.id" class="card"><div class="card-h"><h2>{{ m.nome }}</h2><small class="muted">{{ m.cat.length }} sottocategorie</small></div>
        <ul class="lista compatta"><li v-for="c in m.cat" :key="c.id"><div class="grow"><b>{{ c.nome }}</b><small>griglie: {{ nomiGriglie(c.griglie) || '–' }}</small></div></li></ul></section>
    </template>
    <template v-else-if="tipo === 'griglie'">
      <section v-for="g in M.griglie" :key="g.id" class="card"><div class="card-h"><h2>{{ g.nome }}</h2></div>
        <div class="chips"><span v-for="t in g.taglie" :key="t" class="chip">{{ t }}</span></div>
        <p class="muted">Usata da: {{ catDiGriglia(g.id) || '–' }}</p></section>
    </template>
    <ul v-else class="lista">
      <li v-for="x in (tipo === 'aziende' ? M.aziende : tipo === 'colori' ? M.colori : M.pagamenti.map((n, i) => ({id: i, nome: n})))" :key="x.id">
        <div class="grow"><b>{{ x.nome }}</b></div></li>
    </ul>
  </div>`,
};

// ---------------------------------------------------------------- registro modifiche
export const Registro = {
  setup() {
    const ruolo = ref(''), limite = ref(100);
    const elenco = computed(() => { state.rev; return M.log.filter((e) => !ruolo.value || e.ruolo === ruolo.value).slice().reverse(); });
    const link = (e) => (e.entita === 'ordine' && e.entitaId ? `#/ordine/${e.entitaId}` : e.ordineId ? `#/ordine/${e.ordineId}` : null);
    return { ruolo, limite, elenco, link, RUOLI, dataOra };
  },
  template: `<div class="pagina">
    <page-head titolo="Registro modifiche" sotto="Chi ha fatto cosa e quando" indietro="#/altro"/>
    <select class="inp" v-model="ruolo"><option value="">Tutti i ruoli</option><option v-for="(r, k) in RUOLI" :value="k">{{ r.nome }}</option></select>
    <ul class="lista log">
      <li v-for="e in elenco.slice(0, limite)" :key="e.id" @click="link(e) && $vai(link(e))">
        <div class="grow"><b>{{ e.azione }}<template v-if="e.entita === 'ordine' && e.entitaId"> · ordine {{ e.entitaId }}</template></b>
          <small>{{ dataOra(e.ts) }} · {{ RUOLI[e.ruolo]?.nome }}</small><small v-if="e.dettagli" class="det">{{ e.dettagli }}</small></div></li>
      <li v-if="!elenco.length" class="vuoto">Nessuna operazione registrata.</li>
    </ul>
    <button v-if="elenco.length > limite" class="btn pieno" @click="limite += 200">Altri</button>
  </div>`,
};
