// Viste del buyer: pannello, ordini, ordine, articolo, trasmissione.

import {
  M, state, righeOrdine, fotoRiga, nomeFornitore, nomeAzienda, nomeCat, nomeColore, stagioni, stagioneOrdine,
  salvaOrdine, nuovoOrdine, eliminaOrdine, salvaRiga, eliminaRiga, erroriRiga, erroriOrdine, cambiaStato,
  trasmetti, riepilogo, logga, salvaImpostazioni, nonLetti, segnaLetto, titoloOrdine, descriviCambio, chiaveBudget,
  consegnaProposta, avvisiOrdine, oltreCartellino, lunghezzaCartellino, inRitardo, attivo, CAMPI_CARTELLINO,
} from './db.js';
import { apriMessaggio } from './views-arrivi.js';
import { avvisi } from './analisi.js';
import { esportaRighe } from './excel.js';
import {
  RUOLI, DESTINATARI, STATI, euro, euro0, num, perc, data, dataOra, dataConsegna, stagioneNome, stagionePrec, stagioneOrd,
  totaleRiga, controllaCodice, debounce,
} from './util.js';
import { toast } from './comp.js';

const { ref, reactive, computed, watch, onBeforeUnmount } = Vue;

const vai = (h) => { location.hash = h; };

function totaliOrdine(id) {
  let pezzi = 0, valore = 0;
  for (const r of righeOrdine(id)) { pezzi += r.qta || 0; valore += totaleRiga(r); }
  return { pezzi, valore };
}

function stagioniDisponibili() {
  const s = new Set(stagioni());
  const y = new Date().getFullYear();
  for (let a = y - 1; a <= y + 2; a++) { s.add(`${a}E`); s.add(`${a}I`); }
  return [...s].sort((a, b) => stagioneOrd(b) - stagioneOrd(a));
}

// Barra in basso con il totale dell'ordine; tocco = riepilogo per categoria
const BarraTotale = {
  props: { ordineId: Number },
  setup(p) {
    const aperto = ref(false);
    const o = computed(() => { state.rev; return M.ord.get(p.ordineId); });
    const righe = computed(() => { state.rev; return [...righeOrdine(p.ordineId)]; });
    const r = computed(() => riepilogo(righe.value, o.value?.scontoExtra));
    return { aperto, o, righe, r, euro, num };
  },
  template: `<div class="barra-tot" role="button" @click="aperto = true">
      <div class="bt-v"><b>{{ euro(r.valore) }}</b><span>{{ num(r.pezzi) }} capi · {{ righe.length }} articol{{ righe.length === 1 ? 'o' : 'i' }}</span></div>
      <div class="bt-c"><span v-for="m in r.macro.slice(0, 3)" :key="m.id">{{ m.nome }} {{ num(m.pezzi) }}</span></div>
      <ic n="up" :s="18"/>
    </div>
    <sheet v-if="aperto" :titolo="'Riepilogo ordine n. ' + ordineId" @chiudi="aperto = false">
      <riepilogo :righe="righe" :sconto-extra="o?.scontoExtra"/>
    </sheet>`,
};

// Riepilogo sempre visibile a destra su schermi larghi (iPad): totali per categoria e sottocategoria
const PannelloRiepilogo = {
  props: { ordineId: Number },
  setup(p) {
    const o = computed(() => { state.rev; return M.ord.get(p.ordineId); });
    const righe = computed(() => { state.rev; return [...righeOrdine(p.ordineId)]; });
    const r = computed(() => riepilogo(righe.value, o.value?.scontoExtra));
    return { o, righe, r, euro, num };
  },
  template: `<aside class="col-riep"><section class="card riep-fisso">
    <div class="card-h"><h2>Riepilogo ordine n. {{ ordineId }}</h2></div>
    <div class="riep-tot"><b>{{ euro(r.valore) }}</b><span>{{ num(r.pezzi) }} capi · {{ righe.length }} articol{{ righe.length === 1 ? 'o' : 'i' }}</span></div>
    <riepilogo :righe="righe" :sconto-extra="o?.scontoExtra"/>
  </section></aside>`,
};

// Suggerimenti per le condizioni di pagamento (campo libero; l'elenco si gestisce dal ruolo Configurazione)
const elencoPagamenti = () => (M.pagamenti || []).filter(Boolean);
// Voci selezionabili: le attive, più quella già scelta anche se nel frattempo è stata disattivata
const selezionabili = (elenco, scelto) => elenco.filter((x) => attivo(x) || x.id === scelto);

// ---------------------------------------------------------------- pannello
export const PannelloBuyer = {
  setup() {
    const tutti = ref(false);
    const sk = computed({
      get: () => state.imp.stagioneLavoro,
      set: (v) => { state.imp.stagioneLavoro = v; salvaImpostazioni(); },
    });
    const conteggi = computed(() => {
      state.rev;
      const c = { bozza: 0, confermato: 0, trasmesso: 0, parziale: 0 };
      for (const o of M.ord.values()) if (o.stato in c) c[o.stato]++;
      return c;
    });
    const stag = computed(() => {
      state.rev;
      const tot = (k) => {
        let n = 0, p = 0, v = 0;
        for (const o of M.ord.values()) {
          if (stagioneOrdine(o) !== k) continue;
          n++;
          const t = totaliOrdine(o.id);
          p += t.pezzi; v += t.valore;
        }
        return { k, n, p, v };
      };
      return [tot(sk.value), tot(stagionePrec(sk.value))];
    });
    const al = computed(() => { state.rev; return avvisi(sk.value); });
    const budget = computed(() => {
      state.rev;
      let b = 0;
      const pre = `${sk.value}|macro|`;
      for (const [k, v] of M.budget) if (k.startsWith(pre)) b += v;
      return b;
    });
    const notifiche = computed(() => {
      state.rev;
      return [...M.messaggi.values()].filter((m) => m.a === 'buyer').sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
    });
    const ritardi = computed(() => {
      state.rev;
      return [...M.ord.values()].filter((o) => (o.stato === 'trasmesso' || o.stato === 'parziale') && inRitardo(o.consegnaA));
    });
    const ultimi = computed(() => {
      state.rev;
      return [...M.ord.values()].filter((o) => !o.storico || o.stato !== 'chiuso')
        .sort((a, b) => (b.modificato || b.data || '').localeCompare(a.modificato || a.data || '')).slice(0, 6);
    });
    async function nuovo() { const o = await nuovoOrdine(); vai(`#/ordine/${o.id}`); }
    return {
      tutti, sk, conteggi, stag, al, budget, notifiche, ritardi, ultimi, nuovo, apriNotifica: apriMessaggio, stagioni: stagioniDisponibili(),
      stagioneNome, euro0, num, perc, dataConsegna, dataOra, nomeFornitore, totaliOrdine, euro, STATI,
    };
  },
  template: `<div class="pagina">
    <page-head titolo="Pannello" sotto="Buyer · ufficio acquisti">
      <button class="btn primario" @click="nuovo"><ic n="plus"/> Nuovo ordine</button></page-head>

    <div class="kpi">
      <a href="#/ordini?stato=bozza" class="kpi-c"><b>{{ conteggi.bozza }}</b><span>Bozze</span></a>
      <a href="#/trasmissione" class="kpi-c evid"><b>{{ conteggi.confermato }}</b><span>Da trasmettere</span></a>
      <a href="#/ordini?stato=trasmesso" class="kpi-c"><b>{{ conteggi.trasmesso }}</b><span>Consegne attese</span></a>
      <a href="#/ordini?stato=parziale" class="kpi-c"><b>{{ conteggi.parziale }}</b><span>Parz. consegnati</span></a>
    </div>

    <section class="card">
      <div class="card-h"><h2>Stagione di lavoro</h2>
        <select class="sel-mini" v-model="sk"><option v-for="s in stagioni" :value="s">{{ stagioneNome(s) }}</option></select></div>
      <div class="stag-conf">
        <div v-for="(s, i) in stag" :key="s.k" :class="{prec: i === 1}">
          <small>{{ stagioneNome(s.k) }}</small><b>{{ euro0(s.v) }}</b><span>{{ num(s.p) }} capi · {{ s.n }} ordin{{ s.n === 1 ? 'e' : 'i' }}</span></div>
      </div>
      <div v-if="budget" class="budget-mini">
        <span>Budget {{ euro0(budget) }} · usato {{ perc(stag[0].v / budget * 100) }}</span>
        <div class="barra-perc" :class="{oltre: stag[0].v > budget}"><i :style="{width: Math.min(100, stag[0].v / budget * 100) + '%'}"></i></div>
      </div>
      <a class="link" href="#/report">Apri report, confronto stagioni e budget <ic n="next" :s="16"/></a>
    </section>

    <section class="card" v-if="notifiche.length">
      <div class="card-h"><h2>Notifiche</h2></div>
      <ul class="lista">
        <li v-for="m in notifiche" :key="m.id" :class="{nuovo: !m.letto}" @click="apriNotifica(m)">
          <ic :n="m.tipo === 'distinta' ? 'clip' : m.tipo === 'chiusura' ? 'lock' : 'inbox'"/><div><b>{{ m.titolo }}</b><small>{{ dataOra(m.data) }}</small></div></li>
      </ul>
    </section>

    <section class="card">
      <div class="card-h"><h2>Avvisi sulla stagione</h2><small class="muted">confronto con {{ stagioneNome(stag[1].k) }}</small></div>
      <ul class="lista avvisi" v-if="al.length">
        <li v-for="(a, i) in (tutti ? al : al.slice(0, 6))" :key="i"><ic n="alert"/><div><b>{{ a.testo }}</b><small>{{ a.det }}</small></div></li>
      </ul>
      <p v-else class="muted">Nessuna mancanza rispetto alla stagione precedente.</p>
      <button v-if="al.length > 6" class="link" @click="tutti = !tutti">{{ tutti ? 'Mostra meno' : 'Mostra tutti (' + al.length + ')' }}</button>
    </section>

    <section class="card" v-if="ritardi.length">
      <div class="card-h"><h2>Consegne in ritardo</h2></div>
      <ul class="lista">
        <li v-for="o in ritardi" :key="o.id" @click="$vai('#/ordine/' + o.id)">
          <ic n="truck"/><div><b>n. {{ o.id }} · {{ nomeFornitore(o.fornitoreId) }}</b><small>attesa entro {{ dataConsegna(o.consegnaA) }} · {{ STATI[o.stato].nome }}</small></div></li>
      </ul>
    </section>

    <section class="card">
      <div class="card-h"><h2>Ultimi ordini</h2><a class="link" href="#/ordini">Tutti</a></div>
      <ul class="lista">
        <li v-for="o in ultimi" :key="o.id" @click="$vai('#/ordine/' + o.id)">
          <div class="grow"><b>n. {{ o.id }} · {{ nomeFornitore(o.fornitoreId) }}</b>
            <small>{{ stagioneNome(o.anno + o.stagione) }} · {{ num(totaliOrdine(o.id).pezzi) }} capi · {{ euro(totaliOrdine(o.id).valore) }}</small></div>
          <stato-badge :stato="o.stato"/></li>
      </ul>
    </section>
  </div>`,
};

// ---------------------------------------------------------------- elenco ordini
export const Ordini = {
  props: { query: Object },
  setup(p) {
    const f = reactive({ stagione: '', stato: p.query?.stato || '', testo: '' });
    const limite = ref(40);
    const elenco = computed(() => {
      state.rev;
      const t = f.testo.trim().toLowerCase();
      return [...M.ord.values()].filter((o) => {
        if (f.stagione && stagioneOrdine(o) !== f.stagione) return false;
        if (f.stato && o.stato !== f.stato) return false;
        if (t && !(`${o.id} ${nomeFornitore(o.fornitoreId)}`.toLowerCase().includes(t))) return false;
        return true;
      }).sort((a, b) => stagioneOrd(stagioneOrdine(b)) - stagioneOrd(stagioneOrdine(a)) || (b.data || '').localeCompare(a.data || ''));
    });
    const daTrasm = computed(() => { state.rev; return [...M.ord.values()].filter((o) => o.stato === 'confermato').length; });
    async function nuovo() { const o = await nuovoOrdine(); vai(`#/ordine/${o.id}`); }
    return { f, limite, elenco, daTrasm, nuovo, stagioni: stagioni(), STATI, stagioneNome, nomeFornitore, nomeAzienda, totaliOrdine, euro, num, data };
  },
  template: `<div class="pagina">
    <page-head titolo="Ordini" :sotto="elenco.length + (elenco.length === 1 ? ' ordine' : ' ordini')">
      <button class="btn primario" @click="nuovo"><ic n="plus"/> Nuovo</button></page-head>
    <a v-if="daTrasm" href="#/trasmissione" class="banner"><ic n="send"/> {{ daTrasm }} ordin{{ daTrasm === 1 ? 'e confermato' : 'i confermati' }} da trasmettere</a>
    <div class="filtri-riga">
      <input class="inp" v-model="f.testo" placeholder="N. ordine o fornitore" type="search">
      <select class="inp" v-model="f.stagione"><option value="">Tutte le stagioni</option>
        <option v-for="s in stagioni" :value="s">{{ stagioneNome(s) }}</option></select>
    </div>
    <div class="chips">
      <button :class="{on: !f.stato}" @click="f.stato = ''">Tutti</button>
      <button v-for="(s, k) in STATI" :key="k" :class="{on: f.stato === k}" @click="f.stato = k">{{ s.nome }}</button>
    </div>
    <ul class="lista schede">
      <li v-for="o in elenco.slice(0, limite)" :key="o.id" @click="$vai('#/ordine/' + o.id)">
        <div class="grow"><b>n. {{ o.id }} · {{ nomeFornitore(o.fornitoreId) }}</b>
          <small>{{ stagioneNome(o.anno + o.stagione) }} · {{ nomeAzienda(o.aziendaId) }} · {{ data(o.data) }}</small>
          <small>{{ num(totaliOrdine(o.id).pezzi) }} capi · {{ euro(totaliOrdine(o.id).valore) }}</small></div>
        <stato-badge :stato="o.stato"/></li>
    </ul>
    <button v-if="elenco.length > limite" class="btn pieno" @click="limite += 60">Mostra altri ({{ elenco.length - limite }})</button>
  </div>`,
};

// ---------------------------------------------------------------- ordine
export const Ordine = {
  props: { id: Number },
  components: { BarraTotale, PannelloRiepilogo },
  setup(p) {
    const orig = M.ord.get(p.id);
    if (!orig) return { mancante: true };
    const o = reactive(JSON.parse(JSON.stringify(orig)));
    const snapshot = JSON.stringify(orig);
    const modificabile = computed(() => o.stato === 'bozza' && state.ruolo === 'buyer');
    const errori = ref(null), avvisi = ref(null), cronologia = ref(false), esporta = ref(false);
    const salva = debounce(() => salvaOrdine(o), 400);
    watch(o, () => { if (modificabile.value) salva(); }, { deep: true });
    watch(() => [o.anno, o.stagione], () => { /* stagione cambiata: aggiorna periodo di consegna proposto */
      if (!modificabile.value) return;
      [o.consegnaDa, o.consegnaA] = consegnaProposta(o.anno, o.stagione);
    });
    const stagioneSel = computed({
      get: () => `${o.anno}${o.stagione}`,
      set: (v) => { o.anno = parseInt(v.slice(0, 4), 10); o.stagione = v.slice(4); },
    });
    onBeforeUnmount(() => {
      if (!modificabile.value) return;
      salva.flush();
      const prima = JSON.parse(snapshot);
      const cambi = ['aziendaId', 'fornitoreId', 'anno', 'stagione', 'pagamento', 'consegnaDa', 'consegnaA', 'scontoExtra', 'note']
        .filter((k) => JSON.stringify(prima[k]) !== JSON.stringify(o[k]))
        .map((k) => descriviCambio(k, prima[k], o[k]));
      if (cambi.length) logga('Modificata testata ordine', 'ordine', o.id, cambi.join('; '));
    });
    const righe = computed(() => { state.rev; return [...righeOrdine(p.id)]; });
    const nErr = (r) => { state.rev; return erroriRiga(r).length; };
    const nFoto = (r) => { state.rev; return fotoRiga(r.id).length; };
    const cartellino = (r) => { state.rev; return oltreCartellino(r); };
    const log = computed(() => {
      state.rev;
      const ids = new Set(righe.value.map((r) => r.id));
      return M.log.filter((e) => (e.entita === 'ordine' && e.entitaId === p.id) || e.ordineId === p.id || (e.entita === 'articolo' && ids.has(e.entitaId)))
        .slice().reverse();
    });
    const distinte = computed(() => { state.rev; return [...M.distinte.values()].filter((d) => d.ordineId === p.id); });

    async function nuovoArticolo() {
      const ultimo = righe.value[righe.value.length - 1];
      const r = await salvaRiga({
        ordineId: p.id, codArt: '', continuativo: false, vecchiCodici: [],
        macroId: ultimo?.macroId || null, catId: ultimo?.catId || null, coloreId: null,
        genere: ultimo?.genere || state.imp.genereDefault, prezzo: null, sconto: 0, qta: null,
        grigliaId: ultimo?.grigliaId || null, taglie: null, descrizione: '', dettagli: '', misure: '', composizione: '', note: '',
        nuovo: true,
      });
      vai(`#/articolo/${p.id}/${r.id}`);
    }
    async function conferma(comunque = false) {
      salva.flush();
      const e = erroriOrdine(o);
      if (e.length) { errori.value = e; return; }
      const a = avvisiOrdine(o);
      if (a.length && !comunque) { avvisi.value = a; return; }
      avvisi.value = null;
      await cambiaStato(p.id, 'confermato');
      o.stato = 'confermato';
      toast('Ordine confermato: ora può essere trasmesso');
    }
    async function riapri() {
      await cambiaStato(p.id, 'bozza', 'riaperto per modifiche');
      o.stato = 'bozza';
    }
    async function elimina() {
      if (!confirm(`Eliminare la bozza n. ${p.id} e tutti i suoi articoli?`)) return;
      await eliminaOrdine(p.id);
      toast('Bozza eliminata');
      vai('#/ordini');
    }
    async function excel(prezzi) {
      esporta.value = false;
      toast('Preparazione file Excel…');
      await esportaRighe(righe.value, {
        nomeFile: `Ordine ${p.id} ${nomeFornitore(o.fornitoreId)}${prezzi ? '' : ' (senza prezzi)'}.xlsx`,
        titolo: `Ordine n. ${p.id} – ${nomeFornitore(o.fornitoreId)} – ${stagioneNome(stagioneSel.value)}`, prezzi,
      });
    }
    return {
      mancante: false, o, modificabile, errori, avvisi, cronologia, esporta, stagioneSel, righe, nErr, nFoto, cartellino, log, distinte,
      nuovoArticolo, conferma, riapri, elimina, excel, M, state, stagioni: stagioniDisponibili(), aziende: computed(() => selezionabili(M.aziende, o.aziendaId)),
      stagioneNome, nomeFornitore, nomeCat, nomeColore, euro, num, data, dataOra, totaleRiga, RUOLI, elencoPagamenti,
    };
  },
  template: `<div class="pagina con-barra layout-ordine" v-if="!mancante"><div class="col-main">
    <page-head :titolo="'Ordine n. ' + o.id" :sotto="nomeFornitore(o.fornitoreId)" indietro="#/ordini"><stato-badge :stato="o.stato"/></page-head>

    <div v-if="!modificabile" class="banner neutro"><ic n="lock"/>
      <span v-if="o.stato === 'confermato'">Ordine confermato. <button class="link" @click="riapri">Riporta in bozza</button> per modificarlo.</span>
      <span v-else-if="o.storico">Ordine dello storico (sola lettura).</span>
      <span v-else>Ordine trasmesso: sola lettura.</span></div>
    <div v-if="o.chiusura?.conDifferenze" class="banner avviso"><ic n="alert"/>
      <span>Chiuso con differenze da {{ RUOLI[o.chiusura.ruolo]?.nome }} il {{ dataOra(o.chiusura.data) }}:
        {{ $diff(o.chiusura.mancanti, o.chiusura.eccedenze) }}.<template v-if="o.chiusura.nota"> «{{ o.chiusura.nota }}»</template></span></div>

    <section class="card">
      <div class="card-h"><h2>Testata</h2><small class="muted">inserito il {{ data(o.data) }}</small></div>
      <div class="form">
        <label>Società{{ $ob('aziendaId') }}<select class="inp" v-model.number="o.aziendaId" :disabled="!modificabile">
          <option :value="null">–</option><option v-for="a in aziende" :value="a.id">{{ a.nome }}</option></select></label>
        <label>Stagione *<select class="inp" v-model="stagioneSel" :disabled="!modificabile">
          <option v-for="s in stagioni" :value="s">{{ stagioneNome(s) }}</option></select></label>
        <label class="largo">Fornitore *<fornitore-picker v-model="o.fornitoreId" :disabled="!modificabile"/></label>
        <label class="largo">Condizioni di pagamento{{ $ob('pagamento') }}<input class="inp" list="elenco-pagamenti" v-model="o.pagamento" :disabled="!modificabile"
            placeholder="Scegli o scrivi (es. conto vendita, nessuna)" autocomplete="off">
          <datalist id="elenco-pagamenti"><option v-for="p in elencoPagamenti()" :key="p" :value="p"></option></datalist></label>
        <label class="cons">Consegna da{{ $ob('consegna') }}<data-consegna v-model="o.consegnaDa" :disabled="!modificabile"/></label>
        <label class="cons">Consegna entro{{ $ob('consegna') }}<data-consegna v-model="o.consegnaA" fine :disabled="!modificabile"/></label>
        <label>Sconto extra %<input class="inp" type="number" inputmode="decimal" min="0" max="100" v-model.number="o.scontoExtra" :disabled="!modificabile"></label>
        <label class="largo">Note generali / riferimenti interni<textarea class="inp" rows="2" v-model="o.note" :disabled="!modificabile"></textarea></label>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Articoli ({{ righe.length }})</h2>
        <button v-if="modificabile" class="btn primario" @click="nuovoArticolo"><ic n="plus"/> Articolo</button></div>
      <ul class="lista articoli">
        <li v-for="r in righe" :key="r.id" @click="$vai('#/articolo/' + o.id + '/' + r.id)">
          <thumb :riga-id="r.id"/>
          <div class="grow"><b class="mono">{{ r.codArt || '(senza codice)' }}</b>
            <small>{{ r.descrizione || '–' }}</small>
            <small>{{ r.catId ? nomeCat(r.catId) : '–' }} · {{ r.coloreId ? nomeColore(r.coloreId) : '–' }}</small>
            <span v-if="modificabile && nErr(r)" class="err-mini">{{ nErr(r) }} da completare</span>
            <span v-else-if="!o.storico && nFoto(r) < state.cfg.minFoto" class="err-mini">{{ nFoto(r) }} foto</span>
            <span v-if="!o.storico && cartellino(r)" class="avv-mini">cartellino {{ cartellino(r) }}/{{ state.cfg.cartellino.limite }} caratteri</span></div>
          <div class="dx"><b>{{ num(r.qta) }} pz</b><small>{{ euro(r.prezzo) }}</small><small v-if="r.sconto">−{{ r.sconto }}%</small>
            <b>{{ euro(totaleRiga(r)) }}</b></div></li>
        <li v-if="!righe.length" class="vuoto">Nessun articolo. <button v-if="modificabile" class="link" @click="nuovoArticolo">Aggiungi il primo</button></li>
      </ul>
    </section>

    <div class="azioni-pagina">
      <button v-if="o.stato === 'bozza'" class="btn primario" @click="conferma()"><ic n="check"/> Conferma ordine</button>
      <a v-if="o.stato === 'confermato'" class="btn primario" :href="'#/trasmissione?sel=' + o.id"><ic n="send"/> Trasmetti</a>
      <button class="btn" @click="esporta = true" :disabled="!righe.length"><ic n="download"/> Excel</button>
      <button class="btn" @click="cronologia = true"><ic n="list"/> Cronologia</button>
      <button v-if="o.stato === 'bozza'" class="btn rosso" @click="elimina"><ic n="trash"/> Elimina bozza</button>
    </div>

    <section class="card" v-if="distinte.length">
      <div class="card-h"><h2>Distinte di ricezione</h2></div>
      <ul class="lista">
        <li v-for="d in distinte" :key="d.id" @click="$vai('#/distinta/' + d.id)"><ic n="clip"/>
          <div class="grow"><b>Distinta {{ d.tipo }} · {{ Math.round(d.perc) }}% conforme</b>
            <small>{{ dataOra(d.data) }} · {{ RUOLI[d.ruolo].nome }}<span v-if="d.discrepanze"> · {{ d.discrepanze }} discrepanze di taglia</span><span v-if="d.problemi"> · {{ d.problemi }} segnalazioni</span></small></div></li>
      </ul>
    </section>

    </div>
    <pannello-riepilogo :ordine-id="o.id"/>
    <barra-totale :ordine-id="o.id"/>

    <sheet v-if="errori" titolo="Ordine incompleto" @chiudi="errori = null">
      <p>Per confermare l'ordine completa:</p>
      <ul class="lista-err"><li v-for="e in errori">{{ e }}</li></ul>
      <p class="muted">Gli articoli incompleti sono segnalati in rosso nell'elenco.</p>
    </sheet>
    <sheet v-if="avvisi" titolo="Prima di confermare" @chiudi="avvisi = null">
      <p>L'ordine è completo, ma:</p>
      <ul class="lista-avv"><li v-for="a in avvisi">{{ a }}</li></ul>
      <p class="muted">Il testo oltre il limite potrebbe non entrare nel gestionale o sul cartellino. Si può accorciare o confermare lo stesso.</p>
      <div class="azioni-pagina"><button class="btn primario" @click="conferma(true)"><ic n="check"/> Conferma comunque</button>
        <button class="btn" @click="avvisi = null">Torna all'ordine</button></div>
    </sheet>
    <sheet v-if="esporta" titolo="Esporta in Excel" @chiudi="esporta = false">
      <div class="menu-azioni">
        <button @click="excel(true)"><ic n="download"/> Completo (con prezzi e sconti)</button>
        <button @click="excel(false)"><ic n="download"/> Per logistica e negozi (senza dati economici)</button>
      </div>
    </sheet>
    <sheet v-if="cronologia" titolo="Cronologia modifiche" alto @chiudi="cronologia = false">
      <ul class="lista log"><li v-for="e in log" :key="e.id"><div><b>{{ e.azione }}</b>
        <small>{{ dataOra(e.ts) }} · {{ RUOLI[e.ruolo]?.nome }}</small><small v-if="e.dettagli">{{ e.dettagli }}</small></div></li>
        <li v-if="!log.length" class="muted">Nessuna modifica registrata in questa demo.</li></ul>
    </sheet>
  </div>
  <div v-else class="pagina"><page-head titolo="Ordine non trovato" indietro="#/ordini"/></div>`,
};

// ---------------------------------------------------------------- articolo
export const Articolo = {
  props: { ordineId: Number, rigaId: Number },
  components: { BarraTotale, PannelloRiepilogo },
  setup(p) {
    const orig = M.rig.get(p.rigaId);
    const ord = M.ord.get(p.ordineId);
    if (!orig || !ord) return { mancante: true };
    const r = reactive(JSON.parse(JSON.stringify(orig)));
    if (!r.vecchiCodici) r.vecchiCodici = [];
    if (r.grigliaId && !r.taglie && M.gri.get(r.grigliaId)) {
      r.taglie = Object.fromEntries(M.gri.get(r.grigliaId).taglie.map((t) => [t, 0]));
    }
    const snapshot = JSON.stringify(orig);
    const eraNuovo = !!orig.nuovo;
    const modificabile = ord.stato === 'bozza' && state.ruolo === 'buyer';
    const nuovoCod = ref('');

    const copiaPerSalvare = () => {
      const n = (v) => (v === '' || v == null ? null : Number(v));
      return { ...r, prezzo: n(r.prezzo), sconto: n(r.sconto) || 0, qta: n(r.qta) };
    };
    const salva = debounce(() => salvaRiga(copiaPerSalvare()), 350);
    watch(r, () => { if (modificabile) salva(); }, { deep: true });

    const macro = computed(() => selezionabili(M.macro, r.macroId));
    const categorie = computed(() => selezionabili(M.categorie.filter((c) => c.macroId === r.macroId), r.catId).sort((a, b) => a.nome.localeCompare(b.nome)));
    const colori = computed(() => selezionabili(M.colori, r.coloreId));
    const generi = computed(() => Object.fromEntries(state.cfg.generi.filter((g) => g.attivo !== false || g.k === r.genere).map((g) => [g.k, g.nome])));
    watch(() => r.macroId, () => { if (r.catId && M.cat.get(r.catId)?.macroId !== r.macroId) r.catId = null; });
    const griglie = computed(() => {
      const c = M.cat.get(r.catId);
      return (c?.griglie || []).map((id) => M.gri.get(id)).filter((g) => attivo(g) || (g && g.id === r.grigliaId));
    });
    watch(() => r.catId, () => {
      if (!modificabile) return;
      if (r.grigliaId && !griglie.value.some((g) => g.id === r.grigliaId)) { r.grigliaId = null; r.taglie = null; }
    });
    const griglia = computed(() => (r.grigliaId ? M.gri.get(r.grigliaId) : null));
    // taglie da mostrare: quelle della griglia, più quelle già compilate e poi tolte dalla griglia in configurazione
    const taglieVista = computed(() => {
      const t = [...(griglia.value?.taglie || [])];
      for (const [k, q] of Object.entries(r.taglie || {})) if (q && !t.includes(k)) t.push(k);
      return t;
    });
    watch(() => r.grigliaId, (g, prima) => {
      if (!modificabile || g === prima) return;
      if (!g) { r.taglie = null; return; }
      const t = {};
      for (const s of M.gri.get(g).taglie) t[s] = r.taglie?.[s] || 0;
      r.taglie = t;
    });
    watch(() => r.taglie, (t) => {
      if (!t || !modificabile) return;
      r.qta = Object.values(t).reduce((s, q) => s + (Number(q) || 0), 0);
    }, { deep: true });
    function distribuisci(n) {
      for (const k of Object.keys(r.taglie)) r.taglie[k] = (Number(r.taglie[k]) || 0) + n;
    }

    const erroreCodice = computed(() => (r.codArt ? controllaCodice(r.codArt, state.cfg.coloreInCodice) : null));
    // testo del cartellino (somma dei campi configurati): avviso oltre il limite, non blocca
    const cartellino = computed(() => {
      const lim = state.cfg.cartellino.limite;
      const campi = CAMPI_CARTELLINO.filter(([k]) => state.cfg.cartellino.campi.includes(k)).map(([, n]) => n.toLowerCase());
      return { n: lunghezzaCartellino(r), lim, oltre: lim > 0 && lunghezzaCartellino(r) > lim, campi: campi.join(' + ') };
    });
    const duplicato = computed(() => !!r.codArt && righeOrdine(p.ordineId).some((x) => x.id !== r.id && x.codArt === r.codArt.trim()));
    // Sovrapposizioni: quanto si è già comprato della stessa sottocategoria (e colore) nella stagione,
    // da quanti fornitori, e quanto nella stessa stagione dell'anno prima (errori di acquisto per eccesso o prudenza)
    const sovrapp = computed(() => {
      state.rev;
      if (!r.catId) return null;
      const sk = stagioneOrdine(ord), prec = stagionePrec(sk);
      let capi = 0, capiCol = 0, capiPrec = 0;
      const forn = new Set(), fornCol = new Set();
      for (const x of M.rig.values()) {
        if (x.id === r.id || x.catId !== r.catId) continue;
        const o = M.ord.get(x.ordineId);
        if (!o) continue;
        const so = stagioneOrdine(o);
        if (so === sk) {
          capi += x.qta || 0;
          forn.add(o.fornitoreId);
          if (r.coloreId && x.coloreId === r.coloreId) { capiCol += x.qta || 0; fornCol.add(o.fornitoreId); }
        } else if (so === prec) capiPrec += x.qta || 0;
      }
      return { sk, prec, capi, forn: forn.size, capiCol, fornCol: fornCol.size, capiPrec, cat: nomeCat(r.catId), col: r.coloreId ? nomeColore(r.coloreId) : '' };
    });
    const linkRicerca = computed(() => (sovrapp.value
      ? `#/ricerca?stagione=${sovrapp.value.sk}&macroId=${r.macroId}&catId=${r.catId}${r.coloreId ? '&coloreId=' + r.coloreId : ''}` : '#/ricerca'));

    const storico = computed(() => {
      const cod = (r.codArt || '').trim();
      if (cod.length < 4) return null;
      const codici = new Set([cod, ...(r.vecchiCodici || [])]);
      const trovate = [];
      for (const x of M.rig.values()) {
        if (x.ordineId === p.ordineId) continue;
        if (codici.has(x.codArt) || (x.vecchiCodici || []).includes(cod)) trovate.push(x);
      }
      if (!trovate.length) return null;
      const st = [...new Set(trovate.map((x) => stagioneOrdine(M.ord.get(x.ordineId))))].sort((a, b) => stagioneOrd(b) - stagioneOrd(a));
      const ultima = trovate.find((x) => stagioneOrdine(M.ord.get(x.ordineId)) === st[0]);
      return { n: st.length, ultima: st[0], prezzo: ultima?.prezzo, pezzi: trovate.reduce((s, x) => s + (x.qta || 0), 0) };
    });
    const totale = computed(() => totaleRiga(copiaPerSalvare()));
    const errori = computed(() => { state.rev; return erroriRiga(copiaPerSalvare()); });

    function maiuscolo() { r.codArt = (r.codArt || '').toUpperCase().replace(/\s+/g, ' '); }
    function aggiungiVecchio() {
      const c = nuovoCod.value.trim().toUpperCase();
      if (c && !r.vecchiCodici.includes(c)) r.vecchiCodici.push(c);
      nuovoCod.value = '';
    }

    let eliminato = false;
    onBeforeUnmount(async () => {
      if (!modificabile || eliminato) return;
      salva.flush();
      const vuoto = !r.codArt && !fotoRiga(r.id).length && !r.prezzo && !r.descrizione;
      if (vuoto) { await eliminaRiga(r.id, { silenzioso: true }); return; }
      if (eraNuovo) {
        await salvaRiga({ ...copiaPerSalvare(), nuovo: false });
        await logga('Creato articolo', 'articolo', r.id, r.codArt, { ordineId: p.ordineId });
        return;
      }
      const prima = JSON.parse(snapshot), dopo = copiaPerSalvare();
      const cambi = Object.keys(dopo).filter((k) => !['modificato', 'nuovo'].includes(k) && JSON.stringify(prima[k]) !== JSON.stringify(dopo[k]))
        .map((k) => descriviCambio(k, prima[k], dopo[k]));
      if (cambi.length) await logga('Modificato articolo', 'articolo', r.id, `${r.codArt} – ${cambi.join('; ')}`, { ordineId: p.ordineId });
    });

    async function nuovoSimile(variante) {
      salva.flush();
      const base = copiaPerSalvare();
      const nuovo = {
        ordineId: p.ordineId, codArt: variante ? (base.codArt.includes(' ') ? base.codArt.slice(0, base.codArt.lastIndexOf(' ') + 1) : base.codArt + ' ') : '',
        continuativo: variante ? base.continuativo : false, vecchiCodici: [], macroId: base.macroId, catId: base.catId,
        coloreId: null, genere: base.genere, prezzo: variante ? base.prezzo : null, sconto: variante ? base.sconto : 0, qta: null,
        grigliaId: base.grigliaId, taglie: base.taglie ? Object.fromEntries(Object.keys(base.taglie).map((k) => [k, 0])) : null,
        descrizione: variante ? base.descrizione : '', dettagli: variante ? base.dettagli : '', misure: variante ? base.misure : '',
        composizione: variante ? base.composizione : '', note: '', nuovo: true,
      };
      const x = await salvaRiga(nuovo);
      vai(`#/articolo/${p.ordineId}/${x.id}`);
    }
    async function elimina() {
      if (!confirm('Eliminare questo articolo e le sue foto?')) return;
      eliminato = true;
      await eliminaRiga(r.id);
      vai(`#/ordine/${p.ordineId}`);
    }

    return {
      mancante: false, r, ord, modificabile, nuovoCod, macro, categorie, colori, generi, griglie, griglia, taglieVista, distribuisci, erroreCodice, duplicato,
      cartellino, storico, sovrapp, linkRicerca, totale, errori, maiuscolo, aggiungiVecchio, nuovoSimile, elimina, M, state, euro, num, stagioneNome, nomeFornitore,
    };
  },
  template: `<div class="pagina con-barra layout-ordine" v-if="!mancante"><div class="col-main">
    <page-head :titolo="r.codArt || 'Nuovo articolo'" :sotto="'Ordine n. ' + ord.id + ' · ' + nomeFornitore(ord.fornitoreId)" :indietro="'#/ordine/' + ord.id"/>

    <section class="card">
      <foto-articolo :riga-id="r.id" :modificabile="modificabile"/>
    </section>

    <section class="card">
      <div class="form">
        <label class="largo">Codice articolo *
          <input class="inp mono" v-model="r.codArt" @blur="maiuscolo" :disabled="!modificabile" autocapitalize="characters"
            autocomplete="off" spellcheck="false" placeholder="CODICETESSUTO COLORE">
          <small v-if="erroreCodice" class="err">{{ erroreCodice }}</small>
          <small v-else-if="duplicato" class="err">Codice già presente in questo ordine</small>
          <small v-else-if="state.cfg.coloreInCodice" class="aiuto">Codice e tessuto uniti, poi uno spazio e il codice colore</small>
          <small v-if="storico" class="info">Già acquistato in {{ storico.n }} stagion{{ storico.n === 1 ? 'e' : 'i' }} ({{ storico.pezzi }} capi);
            ultima {{ stagioneNome(storico.ultima) }} a {{ euro(storico.prezzo) }}</small></label>
        <label class="largo check"><input type="checkbox" v-model="r.continuativo" :disabled="!modificabile"> Articolo continuativo</label>
        <div v-if="r.continuativo || r.vecchiCodici.length" class="largo vecchi">
          <span class="lbl">Vecchi codici agganciati</span>
          <div class="chips"><span v-for="(c, i) in r.vecchiCodici" :key="c" class="chip mono">{{ c }}
            <button v-if="modificabile" @click="r.vecchiCodici.splice(i, 1)" aria-label="Rimuovi">×</button></span></div>
          <div v-if="modificabile" class="riga-inp"><input class="inp mono" v-model="nuovoCod" placeholder="Vecchio codice" @keyup.enter="aggiungiVecchio">
            <button class="btn" @click="aggiungiVecchio">Aggiungi</button></div>
        </div>
        <label>Categoria{{ $ob('macroId') }}<select class="inp" v-model.number="r.macroId" :disabled="!modificabile">
          <option :value="null" disabled>Seleziona…</option><option v-for="m in macro" :value="m.id">{{ m.nome }}</option></select></label>
        <label>Sottocategoria{{ $ob('catId') }}<select class="inp" v-model.number="r.catId" :disabled="!modificabile || !r.macroId">
          <option :value="null" disabled>Seleziona…</option><option v-for="c in categorie" :value="c.id">{{ c.nome }}</option></select></label>
        <label>Colore{{ $ob('coloreId') }}<select class="inp" v-model.number="r.coloreId" :disabled="!modificabile">
          <option :value="null" disabled>Seleziona…</option><option v-for="c in colori" :value="c.id">{{ c.nome }}</option></select>
          <small v-if="r.coloreDedotto" class="aiuto">dedotto dalla descrizione</small></label>
        <div class="lbl-grp largo">Genere{{ $ob('genere') }}<div class="seg">
          <button v-for="(g, k) in generi" :key="k" :class="{on: r.genere === k}" :disabled="!modificabile" @click="r.genere = k">{{ g }}</button></div></div>
      </div>
    </section>

    <section v-if="sovrapp" class="card sovrapp" :class="{attenzione: sovrapp.forn >= state.cfg.sovrappFornitori}">
      <div class="card-h"><h2><ic n="alert" :s="16"/> Già in {{ stagioneNome(sovrapp.sk) }}</h2>
        <a class="link" :href="linkRicerca">Vedi <ic n="next" :s="14"/></a></div>
      <p v-if="sovrapp.capi"><b>{{ num(sovrapp.capi) }} capi</b> di {{ sovrapp.cat.toLowerCase() }} da <b>{{ sovrapp.forn }} fornitor{{ sovrapp.forn === 1 ? 'e' : 'i' }}</b>
        <template v-if="sovrapp.col && sovrapp.capiCol">, di cui {{ num(sovrapp.capiCol) }} {{ sovrapp.col.toLowerCase() }} da {{ sovrapp.fornCol }}</template><template v-else-if="sovrapp.col">, nessuno {{ sovrapp.col.toLowerCase() }}</template>.</p>
      <p v-else>Nessun altro capo di {{ sovrapp.cat.toLowerCase() }} in questa stagione.</p>
      <small class="muted">{{ stagioneNome(sovrapp.prec) }}: {{ num(sovrapp.capiPrec) }} capi di {{ sovrapp.cat.toLowerCase() }}</small>
    </section>

    <section class="card">
      <div class="card-h"><h2>Quantità e prezzo</h2></div>
      <div class="form">
        <label class="largo">Griglia taglie{{ $ob('grigliaId') }}<select class="inp" v-model.number="r.grigliaId" :disabled="!modificabile || !griglie.length">
          <option :value="null">Nessuna (solo quantità totale)</option><option v-for="g in griglie" :value="g.id">{{ g.nome }}</option></select></label>
        <div v-if="griglia && r.taglie" class="largo taglie">
          <label v-for="t in taglieVista" :key="t"><span>{{ t }}</span>
            <input class="inp" type="number" inputmode="numeric" min="0" v-model.number="r.taglie[t]" :disabled="!modificabile"></label>
          <div v-if="modificabile" class="taglie-az"><button class="btn piccolo" @click="distribuisci(1)">+1 a tutte</button>
            <button class="btn piccolo" @click="distribuisci(2)">+2 a tutte</button></div>
        </div>
        <label>N. pezzi *<input class="inp" type="number" inputmode="numeric" min="0" v-model.number="r.qta" :disabled="!modificabile || !!griglia"></label>
        <label>Prezzo €{{ $ob('prezzo') }}<input class="inp" type="number" inputmode="decimal" min="0" step="0.01" v-model.number="r.prezzo" :disabled="!modificabile"></label>
        <label>Sconto %<input class="inp" type="number" inputmode="decimal" min="0" max="100" v-model.number="r.sconto" :disabled="!modificabile"></label>
        <div class="totale-riga"><span>Importo</span><b>{{ euro(totale) }}</b></div>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Descrizione e note</h2>
        <small v-if="cartellino.lim > 0" class="cont-cart" :class="{oltre: cartellino.oltre}">cartellino {{ cartellino.n }}/{{ cartellino.lim }}</small></div>
      <div class="form">
        <label class="largo">Descrizione commerciale{{ $ob('descrizione') }}<input class="inp" v-model="r.descrizione" :disabled="!modificabile"></label>
        <label class="largo">Composizione / materiali{{ $ob('composizione') }}<input class="inp" v-model="r.composizione" :disabled="!modificabile"></label>
        <label class="largo">Dettagli<textarea class="inp" rows="3" v-model="r.dettagli" :disabled="!modificabile"></textarea></label>
        <label class="largo">Misure<input class="inp" v-model="r.misure" :disabled="!modificabile"></label>
        <label class="largo">Note operative (da verificare alla consegna)
          <textarea class="inp nota" rows="3" v-model="r.note" :disabled="!modificabile" placeholder="Es. il fornitore ha promesso di correggere il difetto del campione sul collo"></textarea></label>
      </div>
      <p v-if="cartellino.lim > 0" class="nota-cart" :class="{oltre: cartellino.oltre}">
        <template v-if="cartellino.oltre"><ic n="alert" :s="15"/> {{ cartellino.n }} caratteri: oltre il limite di {{ cartellino.lim }} per il cartellino e il gestionale ({{ cartellino.campi }}). Non blocca la conferma.</template>
        <template v-else>Testo del cartellino ({{ cartellino.campi }}): {{ cartellino.n }} caratteri su {{ cartellino.lim }}.</template></p>
    </section>

    <section class="card" v-if="modificabile && errori.length">
      <div class="card-h"><h2>Da completare</h2></div>
      <ul class="lista-err"><li v-for="e in errori">{{ e }}</li></ul>
    </section>

    <div class="azioni-pagina" v-if="modificabile">
      <button class="btn primario" @click="nuovoSimile(true)"><ic n="copy"/> Nuova variante colore</button>
      <button class="btn" @click="nuovoSimile(false)"><ic n="plus"/> Nuovo articolo</button>
      <button class="btn rosso" @click="elimina"><ic n="trash"/> Elimina articolo</button>
    </div>
    </div>
    <pannello-riepilogo :ordine-id="ord.id"/>
    <barra-totale :ordine-id="ord.id"/>
  </div>
  <div v-else class="pagina"><page-head titolo="Articolo non trovato" indietro="#/ordini"/></div>`,
};

// ---------------------------------------------------------------- trasmissione
export const Trasmissione = {
  props: { query: Object },
  setup(p) {
    const sel = reactive(new Set(p.query?.sel ? [Number(p.query.sel)] : []));
    const dest = reactive(Object.fromEntries(DESTINATARI.map((k) => [k, true])));
    const elenco = computed(() => { state.rev; return [...M.ord.values()].filter((o) => o.stato === 'confermato'); });
    const recenti = computed(() => {
      state.rev;
      return [...M.ord.values()].filter((o) => o.dtTrasm && !o.storico).sort((a, b) => b.dtTrasm.localeCompare(a.dtTrasm)).slice(0, 8);
    });
    if (!p.query?.sel && elenco.value.length === 1) sel.add(elenco.value[0].id);
    const tutti = computed({
      get: () => elenco.value.length > 0 && elenco.value.every((o) => sel.has(o.id)),
      set: (v) => elenco.value.forEach((o) => (v ? sel.add(o.id) : sel.delete(o.id))),
    });
    const toggle = (id) => (sel.has(id) ? sel.delete(id) : sel.add(id));
    const destinatari = computed(() => Object.keys(dest).filter((k) => dest[k]));
    async function invia() {
      if (!sel.size || !destinatari.value.length) return;
      const n = sel.size;
      await trasmetti([...sel], destinatari.value);
      toast(`${n} ordin${n === 1 ? 'e trasmesso' : 'i trasmessi'} a ${destinatari.value.map((d) => RUOLI[d].nome).join(', ')}`);
      sel.clear();
    }
    return { sel, dest, elenco, recenti, tutti, toggle, destinatari, invia, RUOLI, DESTINATARI, nomeFornitore, totaliOrdine, euro, num, stagioneNome, dataOra };
  },
  template: `<div class="pagina">
    <page-head titolo="Trasmissione" sotto="Ordini confermati pronti per l'invio" indietro="#/ordini"/>
    <section class="card">
      <div class="card-h"><h2>Ordini confermati</h2>
        <label v-if="elenco.length" class="check"><input type="checkbox" v-model="tutti"> Tutti</label></div>
      <ul class="lista">
        <li v-for="o in elenco" :key="o.id" @click="toggle(o.id)" :class="{sel: sel.has(o.id)}">
          <input type="checkbox" :checked="sel.has(o.id)" @click.stop="toggle(o.id)">
          <div class="grow"><b>n. {{ o.id }} · {{ nomeFornitore(o.fornitoreId) }}</b>
            <small>{{ stagioneNome(o.anno + o.stagione) }} · {{ num(totaliOrdine(o.id).pezzi) }} capi · {{ euro(totaliOrdine(o.id).valore) }}</small></div></li>
        <li v-if="!elenco.length" class="vuoto">Nessun ordine confermato. Conferma un ordine dalla sua scheda per poterlo trasmettere.</li>
      </ul>
    </section>
    <section class="card">
      <div class="card-h"><h2>Destinatari</h2></div>
      <div class="dest">
        <label v-for="k in DESTINATARI" :key="k" class="dest-c" :style="{'--c': RUOLI[k].colore}">
          <input type="checkbox" v-model="dest[k]"><div><b>{{ RUOLI[k].nome }}</b>
          <small>{{ RUOLI[k].prezzi ? 'Dati completi: prezzi, sconti, pagamento' : 'Senza prezzi d’acquisto, sconti e pagamento' }}</small></div></label>
      </div>
    </section>
    <button class="btn primario pieno grande" :disabled="!sel.size || !destinatari.length" @click="invia">
      <ic n="send"/> Trasmetti {{ sel.size || '' }} ordin{{ sel.size === 1 ? 'e' : 'i' }}</button>
    <section class="card" v-if="recenti.length">
      <div class="card-h"><h2>Trasmessi di recente</h2></div>
      <ul class="lista"><li v-for="o in recenti" :key="o.id" @click="$vai('#/ordine/' + o.id)">
        <div class="grow"><b>n. {{ o.id }} · {{ nomeFornitore(o.fornitoreId) }}</b><small>{{ dataOra(o.dtTrasm) }}</small></div>
        <stato-badge :stato="o.stato"/></li></ul>
    </section>
  </div>`,
};
