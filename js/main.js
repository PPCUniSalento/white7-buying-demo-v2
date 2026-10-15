// Avvio, router a hash, barra dei ruoli e navigazione.

import { state, carica, importaSeed, nonLetti, scriviLocale } from './db.js';
import { RUOLI } from './util.js';
import { registraComuni, toast } from './comp.js';
import { PannelloBuyer, Ordini, Ordine, Articolo, Trasmissione } from './views-buyer.js';
import { PannelloAdmin, PannelloNegozio, Arrivi, Pacchetto, Ricezione, Distinte, Distinta } from './views-arrivi.js';
import { Ricerca, Report } from './views-analisi.js';
import { Setup, Altro, Anagrafica, Registro } from './views-altro.js';

const { createApp, reactive, computed, watchEffect } = Vue;

const TUTTI = ['buyer', 'amministrazione', 'logistica', 'puntovendita'];
const RICEVONO = ['amministrazione', 'logistica', 'puntovendita'];

// nome rotta → componente per ruolo, parametri
const ROTTE = {
  '': { comp: { buyer: PannelloBuyer, amministrazione: PannelloAdmin, logistica: PannelloNegozio, puntovendita: PannelloNegozio } },
  ordini: { comp: Ordini, ruoli: ['buyer'] },
  ordine: { comp: Ordine, ruoli: ['buyer', 'amministrazione'], par: ['id'] },
  articolo: { comp: Articolo, ruoli: ['buyer', 'amministrazione'], par: ['ordineId', 'rigaId'] },
  trasmissione: { comp: Trasmissione, ruoli: ['buyer'] },
  ricerca: { comp: Ricerca, ruoli: ['buyer', 'amministrazione'] },
  report: { comp: Report, ruoli: ['buyer', 'amministrazione'] },
  arrivi: { comp: Arrivi, ruoli: RICEVONO },
  pacchetto: { comp: Pacchetto, ruoli: RICEVONO, par: ['msgId'] },
  // ogni negozio riceve direttamente la merce (15/10/2026): la logistica consulta soltanto
  ricezione: { comp: Ricezione, ruoli: ['puntovendita'], par: ['msgId'] },
  distinte: { comp: Distinte, ruoli: RICEVONO },
  distinta: { comp: Distinta, ruoli: TUTTI, par: ['id'] },
  altro: { comp: Altro, ruoli: TUTTI },
  anagrafica: { comp: Anagrafica, ruoli: TUTTI, par: ['tipo'] },
  registro: { comp: Registro, ruoli: TUTTI },
};

const NAV = {
  buyer: [['', 'home', 'Pannello'], ['ordini', 'list', 'Ordini'], ['ricerca', 'search', 'Ricerca'], ['report', 'chart', 'Report'], ['altro', 'more', 'Altro']],
  amministrazione: [['', 'home', 'Pannello'], ['arrivi', 'inbox', 'In arrivo'], ['distinte', 'clip', 'Distinte'], ['report', 'chart', 'Report'], ['altro', 'more', 'Altro']],
  logistica: [['', 'home', 'Pannello'], ['arrivi', 'inbox', 'In arrivo'], ['distinte', 'clip', 'Distinte'], ['altro', 'more', 'Altro']],
};
NAV.puntovendita = NAV.logistica;

// le sezioni "figlie" accendono la scheda madre nella barra in basso
const MADRE = { ordine: 'ordini', articolo: 'ordini', trasmissione: 'ordini', pacchetto: 'arrivi', ricezione: 'arrivi', distinta: 'distinte', anagrafica: 'altro', registro: 'altro' };

const route = reactive({ nome: '', parti: [], query: {} });
function leggiHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [percorso, qs] = h.split('?');
  const parti = percorso.split('/').filter(Boolean).map(decodeURIComponent);
  route.nome = parti[0] || '';
  route.parti = parti.slice(1);
  route.query = Object.fromEntries(new URLSearchParams(qs || ''));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', leggiHash);
leggiHash();

const App = {
  setup() {
    const def = computed(() => ROTTE[route.nome]);
    const consentita = computed(() => def.value && (!def.value.ruoli || def.value.ruoli.includes(state.ruolo)));
    const vista = computed(() => {
      if (!state.haDati) return Setup;
      if (!consentita.value) return typeof ROTTE[''].comp === 'object' ? ROTTE[''].comp[state.ruolo] : null;
      const c = def.value.comp;
      return c.setup || c.template ? c : c[state.ruolo];
    });
    const props = computed(() => {
      if (!state.haDati || !consentita.value) return {};
      const p = { query: route.query };
      (def.value.par || []).forEach((k, i) => {
        const v = route.parti[i];
        p[k] = k === 'tipo' ? v : Number(v);
      });
      return p;
    });
    const chiave = computed(() => `${state.ruolo}|${route.nome}|${route.parti.join('/')}`);
    const nav = computed(() => NAV[state.ruolo]);
    const attiva = computed(() => (consentita.value ? MADRE[route.nome] ?? route.nome : ''));
    const colore = computed(() => RUOLI[state.ruolo].colore);
    // il colore del ruolo vale anche per fogli e finestre fuori da .app (teleport)
    watchEffect(() => document.documentElement.style.setProperty('--ruolo', colore.value));
    function setRuolo(k) {
      if (k === state.ruolo) return;
      // prima si torna al pannello, poi si cambia ruolo: la vista aperta non deve
      // essere rimontata con il nuovo ruolo (segnerebbe come letti i suoi messaggi)
      if (location.hash !== '#/') {
        history.pushState(null, '', '#/');
        leggiHash();
      }
      state.ruolo = k;
      scriviLocale('ruolo', k);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = RUOLI[k].colore;
    }
    const nl = (k) => { state.rev; return nonLetti(k); };
    return { state, route, vista, props, chiave, nav, attiva, colore, setRuolo, nl, RUOLI };
  },
  template: `<div class="app" :data-ruolo="state.ruolo">
    <header class="topbar" v-if="state.haDati">
      <div class="brand"><b>WHITE.7</b> Buying <span>demo 2</span></div>
      <nav class="ruoli" aria-label="Ruolo">
        <button v-for="(r, k) in RUOLI" :key="k" :class="{on: state.ruolo === k}" :style="{'--c': r.colore}" @click="setRuolo(k)">
          {{ r.breve }}<i v-if="nl(k)" class="badge">{{ nl(k) }}</i></button>
      </nav>
    </header>
    <main class="contenuto" v-if="state.pronto">
      <component :is="vista" :key="chiave" v-bind="props"/>
    </main>
    <div v-else class="caricamento"><span class="spin"></span></div>
    <nav class="tabbar" v-if="state.haDati">
      <a v-for="[r, ic, nome] in nav" :key="r" :href="'#/' + r" :class="{on: attiva === r}">
        <ic :n="ic" :s="22"/><span>{{ nome }}</span>
        <i v-if="r === 'arrivi' && nl(state.ruolo)" class="badge">{{ nl(state.ruolo) }}</i></a>
    </nav>
    <div v-if="state.toast" class="toast" :class="state.toast.tipo" role="status">{{ state.toast.testo }}</div>
  </div>`,
};

async function avvia() {
  const app = createApp(App);
  registraComuni(app);
  app.config.globalProperties.$vai = (h) => { location.hash = h; };
  app.config.errorHandler = (err) => {
    console.error(err);
    toast('Errore: ' + (err && err.message ? err.message : err), 'err');
  };
  app.mount('#app');
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = RUOLI[state.ruolo]?.colore || '#16181d';
  if (!RUOLI[state.ruolo]) state.ruolo = 'buyer';

  await carica();

  // Sviluppo: ?seed=<url> carica l'archivio senza passare dal selettore di file
  const qs = new URLSearchParams(location.search);
  if (!state.haDati && qs.get('seed')) {
    try {
      const buf = await (await fetch(qs.get('seed'))).arrayBuffer();
      await importaSeed(buf);
      toast('Archivio caricato');
    } catch (e) {
      toast('Archivio non caricato: ' + e.message, 'err');
    }
  }

  const locale = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && (!locale || qs.has('sw'))) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
  }
}

avvia();
