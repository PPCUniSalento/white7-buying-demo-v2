// Viste dei ruoli che ricevono: pannelli, casella in arrivo, pacchetto, ricezione merce per taglia, distinte.
// Decisioni del 15/10/2026: ogni negozio riceve direttamente (la logistica consulta soltanto);
// la ricezione è per taglia, "Tutti" vuol dire corrispondenza esatta; chi riceve può chiudere
// l'ordine nonostante le differenze, assumendosene la responsabilità.

import {
  M, state, righeOrdine, segnaLetto, inviaDistinta, chiudiConDifferenze, nomeFornitore, stagioneOrdine,
  taglieOrdinate, ricevutoPerTaglia, confrontoTaglie, statoRigheOrdine, sommaTaglie, DISCREPANZE,
} from './db.js';
import { esportaRighe } from './excel.js';
import {
  RUOLI, STATI, GENERI, PROBLEMI, SENZA_TAGLIA, euro, euro0, num, perc, dataOra, mese, meseCorrente, stagioneNome, totaleRiga,
} from './util.js';
import { toast } from './comp.js';

const { ref, reactive, computed } = Vue;

const vai = (h) => { location.hash = h; };

// Etichette e colori dello stato di una riga rispetto all'ordinato
export const STATI_RIGA = {
  conforme: { nome: 'Conforme', classe: 'sr-ok' },
  'da completare': { nome: 'Da completare', classe: 'sr-attesa' },
  'non ricevuto': { nome: 'Non ricevuto', classe: 'sr-vuoto' },
  mancante: { nome: 'Mancante', classe: 'sr-diff' },
  eccedenza: { nome: 'Eccedenza', classe: 'sr-diff' },
  'taglie diverse': { nome: 'Taglie diverse', classe: 'sr-diff' },
  'eccedenze e mancanze': { nome: 'Eccedenze e mancanze', classe: 'sr-diff' },
};
const etichettaTaglia = (t) => (t === SENZA_TAGLIA ? 'Pezzi' : t);
// a ordine chiuso, ciò che manca non arriverà più: "da completare" / "non ricevuto" diventano "mancante"
export const statoRigaVisto = (stato, chiuso) => (chiuso && (stato === 'da completare' || stato === 'non ricevuto') ? 'mancante' : stato);

function messaggiRuolo(ruolo, tipo) {
  return [...M.messaggi.values()].filter((m) => m.a === ruolo && (!tipo || m.tipo === tipo)).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}
const pezziPacchetto = (m) => m.payload.righe.reduce((s, r) => s + (r.qta || 0), 0);
const valorePacchetto = (m) => m.payload.righe.reduce((s, r) => s + totaleRiga(r), 0);
function percRicevuto(ordineId) {
  let o = 0, c = 0;
  for (const x of statoRigheOrdine(ordineId).values()) { o += x.totOrd; c += x.conformi; }
  return o ? (c / o) * 100 : 0;
}
function primaFoto(m) {
  for (const r of m.payload.righe) if (r.foto && r.foto.length && M.foto.has(r.foto[0])) return r.foto[0];
  return null;
}
// Messaggio "ordine" ricevuto da un ruolo per un certo ordine (per aprire il pacchetto giusto)
const msgOrdine = (ordineId, ruolo) => [...M.messaggi.values()].find((x) => x.tipo === 'ordine' && x.ordineId === ordineId && x.a === ruolo);

export function apriMessaggio(m) {
  segnaLetto(m.id);
  if (m.tipo === 'distinta') return vai(`#/distinta/${m.distintaId}`);
  if (m.tipo === 'chiusura') {
    if (state.ruolo === 'buyer') return vai(`#/ordine/${m.ordineId}`);
    const x = msgOrdine(m.ordineId, state.ruolo);
    return vai(x ? `#/pacchetto/${x.id}` : '#/distinte');
  }
  return vai(`#/pacchetto/${m.id}`);
}

// Ordini con discrepanze di taglia o chiusi con differenze: da verificare per amministrazione e logistica
function differenzeAperte() {
  const out = [];
  for (const o of M.ord.values()) {
    if (!['parziale', 'chiuso'].includes(o.stato) || o.storico) continue;
    const st = [...statoRigheOrdine(o.id).values()];
    const disc = st.filter((x) => DISCREPANZE.includes(x.stato)).length;
    if (!disc && !o.chiusura?.conDifferenze) continue;
    out.push({ o, disc, chiusura: o.chiusura });
  }
  return out.sort((a, b) => (b.o.modificato || '').localeCompare(a.o.modificato || ''));
}
const icona = (m) => (m.tipo === 'distinta' ? 'clip' : m.tipo === 'chiusura' ? 'lock' : 'inbox');

// Tabellina taglie: riga dell'ordinato e righe di confronto (la riga "confronta" è colorata per differenza)
export const TaglieTabella = {
  props: { ordinate: Object, righe: { type: Array, default: () => [] }, confronta: String },
  setup(p) {
    // si mostrano solo le taglie ordinate o ricevute (le altre della griglia sono tutte a zero)
    const taglie = computed(() => Object.keys(p.ordinate).filter((t) => (Number(p.ordinate[t]) || 0) > 0
      || p.righe.some((r) => (Number(r.val?.[t]) || 0) > 0)));
    const cls = (riga, t) => {
      if (riga.nome !== p.confronta) return '';
      const d = (Number(riga.val?.[t]) || 0) - (Number(p.ordinate[t]) || 0);
      return d < 0 ? 'meno' : d > 0 ? 'piu' : 'pari';
    };
    const extra = computed(() => {
      const s = new Set();
      for (const r of p.righe) for (const t of Object.keys(r.val || {})) if (!(t in p.ordinate)) s.add(t);
      return [...s];
    });
    return { taglie, cls, extra, etichettaTaglia };
  },
  template: `<div class="scroll-x"><table class="tab-taglie">
    <thead><tr><th></th><th v-for="t in [...taglie, ...extra]" :key="t">{{ etichettaTaglia(t) }}</th></tr></thead>
    <tbody>
      <tr><th>Ordinato</th><td v-for="t in [...taglie, ...extra]" :key="t">{{ ordinate[t] || 0 }}</td></tr>
      <tr v-for="r in righe" :key="r.nome"><th>{{ r.nome }}</th>
        <td v-for="t in [...taglie, ...extra]" :key="t" :class="cls(r, t)">{{ r.val?.[t] || 0 }}</td></tr>
    </tbody></table></div>`,
};

// ---------------------------------------------------------------- pannello amministrazione
export const PannelloAdmin = {
  components: { },
  setup() {
    const dati = computed(() => {
      state.rev;
      const ordini = messaggiRuolo('amministrazione', 'ordine');
      const avvisi = [...messaggiRuolo('amministrazione', 'distinta'), ...messaggiRuolo('amministrazione', 'chiusura')];
      const sk = state.imp.stagioneLavoro;
      let trasm = 0, cons = 0;
      for (const o of M.ord.values()) {
        if (stagioneOrdine(o) !== sk || !['trasmesso', 'parziale', 'chiuso'].includes(o.stato)) continue;
        const st = statoRigheOrdine(o.id);
        for (const r of righeOrdine(o.id)) {
          const pu = (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
          trasm += pu * (r.qta || 0);
          cons += pu * (o.storico && o.stato === 'chiuso' ? r.qta || 0 : st.get(r.id)?.conformi || 0);
        }
      }
      const ora = meseCorrente();
      return {
        ordini, trasm, cons, sk, diff: differenzeAperte(),
        attese: [...M.ord.values()].filter((o) => o.stato === 'trasmesso').length,
        parziali: [...M.ord.values()].filter((o) => o.stato === 'parziale').length,
        ritardi: [...M.ord.values()].filter((o) => ['trasmesso', 'parziale'].includes(o.stato) && o.consegnaA && o.consegnaA < ora),
        nuove: avvisi.filter((m) => !m.letto).length,
        recenti: [...ordini, ...avvisi].sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 8),
      };
    });
    const apriDiff = (o) => { const x = msgOrdine(o.id, 'amministrazione'); if (x) vai(`#/pacchetto/${x.id}`); };
    return { dati, apri: apriMessaggio, apriDiff, icona, euro0, num, perc, dataOra, mese, stagioneNome, nomeFornitore, STATI };
  },
  template: `<div class="pagina">
    <page-head titolo="Pannello" sotto="Amministrazione"/>
    <div class="kpi">
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.ordini.length }}</b><span>Ordini ricevuti</span></a>
      <a href="#/distinte" class="kpi-c evid"><b>{{ dati.nuove }}</b><span>Distinte e avvisi da leggere</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.attese }}</b><span>Consegne attese</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.parziali }}</b><span>Parz. consegnati</span></a>
    </div>
    <section class="card" v-if="dati.diff.length">
      <div class="card-h"><h2>Differenze da verificare</h2></div>
      <ul class="lista avvisi">
        <li v-for="x in dati.diff" :key="x.o.id" @click="apriDiff(x.o)"><ic n="alert"/>
          <div class="grow"><b>n. {{ x.o.id }} · {{ nomeFornitore(x.o.fornitoreId) }}</b>
            <small v-if="x.disc">{{ x.disc }} articol{{ x.disc === 1 ? 'o' : 'i' }} con taglie diverse o eccedenze</small>
            <small v-if="x.chiusura">chiuso con differenze: {{ $diff(x.chiusura.mancanti, x.chiusura.eccedenze) }}</small></div></li>
      </ul>
    </section>
    <section class="card">
      <div class="card-h"><h2>{{ stagioneNome(dati.sk) }}: trasmesso e consegnato</h2></div>
      <div class="stag-conf">
        <div><small>Trasmesso</small><b>{{ euro0(dati.trasm) }}</b></div>
        <div><small>Consegnato conforme</small><b>{{ euro0(dati.cons) }}</b><span>{{ perc(dati.trasm ? dati.cons / dati.trasm * 100 : 0) }} dell'ordinato</span></div>
      </div>
      <div class="barra-perc"><i :style="{width: (dati.trasm ? dati.cons / dati.trasm * 100 : 0) + '%'}"></i></div>
    </section>
    <section class="card">
      <div class="card-h"><h2>Ultimi arrivi</h2></div>
      <ul class="lista">
        <li v-for="m in dati.recenti" :key="m.id" :class="{nuovo: !m.letto}" @click="apri(m)">
          <ic :n="icona(m)"/><div class="grow"><b>{{ m.titolo }}</b><small>{{ dataOra(m.data) }}</small></div></li>
        <li v-if="!dati.recenti.length" class="vuoto">Nessun messaggio.</li>
      </ul>
    </section>
    <section class="card" v-if="dati.ritardi.length">
      <div class="card-h"><h2>Consegne in ritardo</h2></div>
      <ul class="lista"><li v-for="o in dati.ritardi" :key="o.id"><ic n="truck"/>
        <div class="grow"><b>n. {{ o.id }} · {{ nomeFornitore(o.fornitoreId) }}</b><small>attesa entro {{ mese(o.consegnaA) }} · {{ STATI[o.stato].nome }}</small></div></li></ul>
    </section>
  </div>`,
};

// ---------------------------------------------------------------- pannello negozio / logistica
export const PannelloNegozio = {
  setup() {
    const dati = computed(() => {
      state.rev;
      const ruolo = state.ruolo;
      const msg = messaggiRuolo(ruolo, 'ordine');
      const daRic = msg.filter((m) => ['trasmesso', 'parziale'].includes(M.ord.get(m.ordineId)?.stato));
      const ora = meseCorrente();
      const perMese = new Map();
      for (const m of daRic) {
        const k = m.payload.testa.consegnaA || '';
        if (!perMese.has(k)) perMese.set(k, { k, n: 0, pezzi: 0 });
        const g = perMese.get(k);
        g.n++; g.pezzi += pezziPacchetto(m);
      }
      return {
        msg, daRic, nuovi: msg.filter((m) => !m.letto),
        parziali: daRic.filter((m) => M.ord.get(m.ordineId)?.stato === 'parziale').length,
        ritardi: daRic.filter((m) => m.payload.testa.consegnaA && m.payload.testa.consegnaA < ora),
        mesi: [...perMese.values()].sort((a, b) => a.k.localeCompare(b.k)),
        diff: ruolo === 'logistica' ? differenzeAperte() : [],
      };
    });
    const apri = (m) => { segnaLetto(m.id); vai(`#/pacchetto/${m.id}`); };
    const apriDiff = (o) => { const x = msgOrdine(o.id, state.ruolo); if (x) vai(`#/pacchetto/${x.id}`); };
    const sotto = computed(() => (state.ruolo === 'logistica' ? 'Logistica · consultazione delle consegne ai negozi' : 'Punto vendita'));
    return { dati, apri, apriDiff, sotto, primaFoto, pezziPacchetto, num, mese, dataOra, stagioneNome, nomeFornitore, RUOLI, state, meseCorrente };
  },
  template: `<div class="pagina">
    <page-head titolo="Pannello" :sotto="sotto"/>
    <div class="kpi">
      <a href="#/arrivi" class="kpi-c evid"><b>{{ dati.nuovi.length }}</b><span>Nuovi in arrivo</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.daRic.length }}</b><span>Da ricevere</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.parziali }}</b><span>Parz. ricevuti</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.ritardi.length }}</b><span>In ritardo</span></a>
    </div>
    <section class="card" v-if="dati.diff.length">
      <div class="card-h"><h2>Differenze da verificare</h2></div>
      <ul class="lista avvisi">
        <li v-for="x in dati.diff" :key="x.o.id" @click="apriDiff(x.o)"><ic n="alert"/>
          <div class="grow"><b>n. {{ x.o.id }} · {{ nomeFornitore(x.o.fornitoreId) }}</b>
            <small v-if="x.disc">{{ x.disc }} articol{{ x.disc === 1 ? 'o' : 'i' }} con taglie diverse o eccedenze</small>
            <small v-if="x.chiusura">chiuso con differenze dal negozio</small></div></li>
      </ul>
    </section>
    <section class="card" v-if="dati.nuovi.length">
      <div class="card-h"><h2>Capi in arrivo: nuovi ordini</h2></div>
      <ul class="lista">
        <li v-for="m in dati.nuovi" :key="m.id" class="nuovo" @click="apri(m)">
          <thumb :foto-id="primaFoto(m)" :w="44"/>
          <div class="grow"><b>{{ m.payload.testa.fornitore }}</b>
            <small>{{ stagioneNome(m.payload.testa.stagione) }} · {{ m.payload.righe.length }} articoli · {{ num(pezziPacchetto(m)) }} capi</small>
            <small>consegna {{ mese(m.payload.testa.consegnaDa) }} – {{ mese(m.payload.testa.consegnaA) }}</small></div></li>
      </ul>
    </section>
    <section class="card">
      <div class="card-h"><h2>Consegne attese per mese</h2></div>
      <ul class="lista">
        <li v-for="g in dati.mesi" :key="g.k" :class="{ritardo: g.k < meseCorrente()}"><ic n="truck"/>
          <div class="grow"><b>entro {{ mese(g.k) }}</b><small>{{ g.n }} ordin{{ g.n === 1 ? 'e' : 'i' }} · {{ num(g.pezzi) }} capi<span v-if="g.k < meseCorrente()"> · in ritardo</span></small></div></li>
        <li v-if="!dati.mesi.length" class="vuoto">Nessuna consegna attesa.</li>
      </ul>
    </section>
  </div>`,
};

// ---------------------------------------------------------------- casella in arrivo
export const Arrivi = {
  setup() {
    const scheda = ref('da');
    const q = ref('');
    const elenco = computed(() => {
      state.rev;
      const t = q.value.trim().toLowerCase();
      return messaggiRuolo(state.ruolo, 'ordine').filter((m) => {
        const st = M.ord.get(m.ordineId)?.stato;
        const daRic = st === 'trasmesso' || st === 'parziale';
        if (scheda.value === 'da' ? !daRic : daRic) return false;
        return !t || `${m.payload.testa.id} ${m.payload.testa.fornitore}`.toLowerCase().includes(t);
      });
    });
    const apri = (m) => { segnaLetto(m.id); vai(`#/pacchetto/${m.id}`); };
    const stato = (m) => M.ord.get(m.ordineId)?.stato;
    return { scheda, q, elenco, apri, stato, primaFoto, pezziPacchetto, valorePacchetto, percRicevuto, num, euro, mese, dataOra, stagioneNome, RUOLI, state };
  },
  template: `<div class="pagina">
    <page-head titolo="In arrivo" :sotto="'Ordini trasmessi a ' + RUOLI[state.ruolo].nome"/>
    <div class="seg pieno"><button :class="{on: scheda === 'da'}" @click="scheda = 'da'">Da ricevere</button>
      <button :class="{on: scheda === 'ric'}" @click="scheda = 'ric'">Ricevuti</button></div>
    <input class="inp" v-model="q" type="search" placeholder="Cerca fornitore o n. ordine">
    <ul class="lista schede">
      <li v-for="m in elenco" :key="m.id" :class="{nuovo: !m.letto}" @click="apri(m)">
        <thumb :foto-id="primaFoto(m)" :w="48"/>
        <div class="grow"><b>n. {{ m.payload.testa.id }} · {{ m.payload.testa.fornitore }}</b>
          <small>{{ stagioneNome(m.payload.testa.stagione) }} · {{ m.payload.righe.length }} art. · {{ num(pezziPacchetto(m)) }} capi
            <span v-if="m.payload.prezzi"> · {{ euro(valorePacchetto(m)) }}</span></small>
          <small>consegna {{ mese(m.payload.testa.consegnaDa) }} – {{ mese(m.payload.testa.consegnaA) }} · trasmesso il {{ dataOra(m.data) }}</small>
          <div v-if="stato(m) === 'parziale'" class="barra-perc piccola"><i :style="{width: percRicevuto(m.ordineId) + '%'}"></i></div></div>
        <stato-badge :stato="stato(m)"/></li>
      <li v-if="!elenco.length" class="vuoto">Nessun ordine.</li>
    </ul>
  </div>`,
};

// ---------------------------------------------------------------- pacchetto ricevuto
export const Pacchetto = {
  props: { msgId: Number },
  components: { TaglieTabella },
  setup(p) {
    const m = M.messaggi.get(p.msgId);
    if (!m || m.tipo !== 'ordine') return { mancante: true };
    segnaLetto(m.id);
    const { testa, righe, prezzi } = m.payload;
    const q = ref(''), visore = ref(null), chiudi = ref(false), notaChiusura = ref(''), conferma = ref(false);
    const ordine = computed(() => { state.rev; return M.ord.get(m.ordineId); });
    const stato = computed(() => ordine.value?.stato);
    const ric = computed(() => { state.rev; return ricevutoPerTaglia(m.ordineId); });
    const stRighe = computed(() => { state.rev; return statoRigheOrdine(m.ordineId); });
    const pr = computed(() => { state.rev; return percRicevuto(m.ordineId); });
    const filtrate = computed(() => {
      const t = q.value.trim().toLowerCase();
      return t ? righe.filter((r) => `${r.codArt} ${r.descrizione} ${r.categoria} ${r.colore}`.toLowerCase().includes(t)) : righe;
    });
    const riep = computed(() => {
      const g = new Map();
      for (const r of righe) {
        const k = r.macro || '–';
        if (!g.has(k)) g.set(k, { nome: k, pezzi: 0, valore: 0, cat: new Map() });
        const x = g.get(k);
        x.pezzi += r.qta || 0; x.valore += totaleRiga(r);
        const c = r.categoria || '–';
        x.cat.set(c, (x.cat.get(c) || 0) + (r.qta || 0));
      }
      return [...g.values()].sort((a, b) => b.pezzi - a.pezzi);
    });
    const distinte = computed(() => { state.rev; return [...M.distinte.values()].filter((d) => d.ordineId === m.ordineId); });
    const puoRicevere = computed(() => state.ruolo === 'puntovendita' && ['trasmesso', 'parziale'].includes(stato.value));
    const puoChiudere = computed(() => state.ruolo === 'puntovendita' && stato.value === 'parziale');
    const diff = computed(() => {
      let mancanti = 0, eccedenze = 0;
      for (const x of stRighe.value.values()) { mancanti -= sommaTaglie(x.mancanti); eccedenze += sommaTaglie(x.eccedenze); }
      return { mancanti, eccedenze };
    });
    async function eseguiChiusura() {
      await chiudiConDifferenze(m.ordineId, notaChiusura.value.trim());
      chiudi.value = false;
      toast('Ordine chiuso con differenze: amministrazione e buyer avvisati');
    }
    async function excel() {
      toast('Preparazione file Excel…');
      await esportaRighe(righeOrdine(m.ordineId), {
        nomeFile: `Ordine ${testa.id} ${testa.fornitore}${prezzi ? '' : ' (senza prezzi)'}.xlsx`,
        titolo: `Ordine n. ${testa.id} – ${testa.fornitore} – ${stagioneNome(testa.stagione)}`, prezzi,
      });
    }
    return {
      mancante: false, m, testa, righe, prezzi, q, visore, chiudi, notaChiusura, conferma, ordine, stato, ric, stRighe, pr, filtrate, riep,
      distinte, puoRicevere, puoChiudere, diff, eseguiChiusura, excel, taglieOrdinate, STATI_RIGA, statoRigaVisto,
      GENERI, RUOLI, euro, num, perc, mese, dataOra, stagioneNome,
    };
  },
  template: `<div class="pagina" v-if="!mancante">
    <page-head :titolo="'Ordine n. ' + testa.id" :sotto="testa.fornitore" indietro="#/arrivi"><stato-badge :stato="stato"/></page-head>
    <div v-if="!prezzi" class="banner neutro"><ic n="lock"/> Vista filtrata: senza prezzi d'acquisto, sconti e condizioni di pagamento.</div>
    <div v-if="ordine?.chiusura?.conDifferenze" class="banner avviso"><ic n="alert"/>
      <span>Chiuso con differenze da {{ RUOLI[ordine.chiusura.ruolo]?.nome }} il {{ dataOra(ordine.chiusura.data) }}:
        {{ $diff(ordine.chiusura.mancanti, ordine.chiusura.eccedenze) }}.<template v-if="ordine.chiusura.nota"> «{{ ordine.chiusura.nota }}»</template></span></div>

    <section class="card">
      <div class="kv">
        <div><span>Società</span><b>{{ testa.azienda }}</b></div>
        <div><span>Stagione</span><b>{{ stagioneNome(testa.stagione) }}</b></div>
        <div><span>Consegna</span><b>{{ testa.consegnaDa ? mese(testa.consegnaDa) + ' – ' + mese(testa.consegnaA) : '–' }}</b></div>
        <div><span>Trasmesso</span><b>{{ dataOra(m.data) }}</b></div>
        <div v-if="prezzi"><span>Pagamento</span><b>{{ testa.pagamento || '–' }}</b></div>
        <div v-if="prezzi && testa.scontoExtra"><span>Sconto extra</span><b>{{ testa.scontoExtra }}%</b></div>
      </div>
      <p v-if="testa.note" class="nota-box">{{ testa.note }}</p>
      <div v-if="stato === 'parziale' || stato === 'chiuso'" class="ric-stato">
        <span>Ricevuto conforme {{ perc(pr) }} dei capi</span><div class="barra-perc"><i :style="{width: pr + '%'}"></i></div></div>
    </section>

    <div class="azioni-pagina">
      <a v-if="puoRicevere" class="btn primario grande" :href="'#/ricezione/' + m.id"><ic n="clip"/> Ricezione merce</a>
      <button v-if="puoChiudere" class="btn" @click="chiudi = true"><ic n="lock"/> Chiudi con differenze</button>
      <button class="btn" @click="excel"><ic n="download"/> Excel</button>
    </div>

    <section class="card">
      <div class="card-h"><h2>Riepilogo</h2><small class="muted">{{ righe.length }} articoli</small></div>
      <table class="tab riep"><tbody>
        <template v-for="g in riep" :key="g.nome">
          <tr class="riep-m"><td>{{ g.nome }}</td><td class="n">{{ num(g.pezzi) }} capi</td><td v-if="prezzi" class="n">{{ euro(g.valore) }}</td></tr>
          <tr v-for="[c, n] in g.cat" :key="g.nome + c" class="riep-c"><td>{{ c }}</td><td class="n">{{ num(n) }}</td><td v-if="prezzi"></td></tr>
        </template></tbody></table>
    </section>

    <section class="card" v-if="distinte.length">
      <div class="card-h"><h2>Distinte</h2></div>
      <ul class="lista"><li v-for="d in distinte" :key="d.id" @click="$vai('#/distinta/' + d.id)"><ic n="clip"/>
        <div class="grow"><b>Distinta {{ d.tipo }} · {{ Math.round(d.perc) }}% conforme</b>
          <small>{{ dataOra(d.data) }} · {{ RUOLI[d.ruolo].nome }}<span v-if="d.discrepanze"> · {{ d.discrepanze }} discrepanze di taglia</span></small></div></li></ul>
    </section>

    <input class="inp" v-model="q" type="search" placeholder="Cerca negli articoli">
    <ul class="lista articoli grandi">
      <li v-for="r in filtrate" :key="r.id">
        <div class="art-top">
          <div class="grow"><b class="mono">{{ r.codArt }}</b><small>{{ r.descrizione }}</small></div>
          <div class="dx"><b>{{ num(r.qta) }} pz</b>
            <span v-if="stato !== 'trasmesso' && stRighe.get(r.id)" class="badge-riga" :class="STATI_RIGA[statoRigaVisto(stRighe.get(r.id).stato, stato === 'chiuso')].classe">{{ STATI_RIGA[statoRigaVisto(stRighe.get(r.id).stato, stato === 'chiuso')].nome }}</span>
            <small v-if="prezzi">{{ euro(r.prezzo) }}</small></div>
        </div>
        <div class="art-foto">
          <button v-for="(f, k) in r.foto" :key="f" @click="visore = {ids: r.foto, i: k}"><thumb :foto-id="f" :w="72"/></button>
          <span v-if="!r.foto.length" class="muted">Nessuna foto</span>
        </div>
        <div class="art-det">
          <small>{{ r.categoria || r.macro }} · {{ r.colore || '–' }} · {{ GENERI[r.genere] }}</small>
          <small v-if="r.composizione">{{ r.composizione }}</small>
          <small v-if="r.dettagli">{{ r.dettagli }}</small>
          <taglie-tabella :ordinate="taglieOrdinate(r)" :righe="stato !== 'trasmesso' ? [{nome: 'Ricevuto', val: ric.get(r.id) || {}}] : []" confronta="Ricevuto"/>
          <p v-if="r.note" class="nota-box"><ic n="alert" :s="14"/> {{ r.note }}</p>
        </div>
      </li>
    </ul>
    <visore v-if="visore" :foto-ids="visore.ids" :indice="visore.i" @chiudi="visore = null"/>

    <sheet v-if="chiudi" titolo="Chiudi l'ordine con differenze" @chiudi="chiudi = false">
      <p>L'ordine risulta ancora <b>parziale</b>: {{ $diff(diff.mancanti, diff.eccedenze) }}.
        Chiudendolo non si attendono altre consegne.</p>
      <label class="largo">Motivo (es. il fornitore non consegnerà i capi mancanti)<textarea class="inp" rows="3" v-model="notaChiusura"></textarea></label>
      <label class="check"><input type="checkbox" v-model="conferma"> Chiudo l'ordine nonostante le differenze e me ne assumo la responsabilità</label>
      <p class="muted">Amministrazione e buyer ricevono la notifica con il dettaglio delle differenze.</p>
      <button class="btn primario pieno grande" :disabled="!conferma" @click="eseguiChiusura"><ic n="lock"/> Chiudi l'ordine</button>
    </sheet>
  </div>
  <div v-else class="pagina"><page-head titolo="Messaggio non trovato" indietro="#/arrivi"/></div>`,
};

// ---------------------------------------------------------------- ricezione merce per taglia
export const Ricezione = {
  props: { msgId: Number },
  setup(p) {
    const m = M.messaggi.get(p.msgId);
    if (!m || m.tipo !== 'ordine') return { mancante: true };
    const { testa, righe } = m.payload;
    const prima = ricevutoPerTaglia(m.ordineId);
    const ordinate = Object.fromEntries(righe.map((r) => [r.id, taglieOrdinate(r)]));
    const residuo = (r, t) => Math.max(0, (ordinate[r.id][t] || 0) - (prima.get(r.id)?.[t] || 0));
    const residuoTot = (r) => Object.keys(ordinate[r.id]).reduce((s, t) => s + residuo(r, t), 0);
    const stato = reactive(Object.fromEntries(righe.map((r) => [r.id, {
      ric: Object.fromEntries(Object.keys(ordinate[r.id]).map((t) => [t, 0])), problema: '', nota: '',
    }])));
    const soloAperti = ref(true), segnala = ref(null), conferma = ref(false), note = ref(''), visore = ref(null), invio = ref(false);
    const chiudiComunque = ref(false), notaChiusura = ref(''), responsabilita = ref(false);

    // stato della riga dopo questa consegna (già ricevuto + ricevuto ora)
    const dopo = (r) => {
      const cum = { ...(prima.get(r.id) || {}) };
      for (const [t, q] of Object.entries(stato[r.id].ric)) cum[t] = (cum[t] || 0) + (Number(q) || 0);
      return confrontoTaglie(ordinate[r.id], cum);
    };
    const giaConforme = (r) => confrontoTaglie(ordinate[r.id], prima.get(r.id) || {}).stato === 'conforme';
    const visibili = computed(() => righe.filter((r) => !soloAperti.value || !giaConforme(r)));
    const tot = computed(() => {
      let ord = 0, gia = 0, ora = 0, conformi = 0, probl = 0, disc = 0, tutte = true;
      for (const r of righe) {
        const c = dopo(r);
        ord += c.totOrd;
        gia += sommaTaglie(prima.get(r.id));
        ora += sommaTaglie(stato[r.id].ric);
        conformi += c.conformi;
        if (stato[r.id].problema) probl++;
        if (DISCREPANZE.includes(c.stato)) disc++;
        if (c.stato !== 'conforme') tutte = false;
      }
      return { ord, gia, ora, conformi, perc: ord ? (conformi / ord) * 100 : 0, probl, disc, tipo: tutte ? 'totale' : 'parziale' };
    });
    const piu = (r, t, d) => { const s = stato[r.id].ric; s[t] = Math.max(0, (Number(s[t]) || 0) + d); };
    const tutti = (r) => { for (const t of Object.keys(ordinate[r.id])) stato[r.id].ric[t] = residuo(r, t); };
    const azzera = (r) => { for (const t of Object.keys(ordinate[r.id])) stato[r.id].ric[t] = 0; };
    const tuttoArrivato = () => righe.forEach(tutti);
    const clsCella = (r, t) => {
      const q = Number(stato[r.id].ric[t]) || 0, att = residuo(r, t);
      if (q === att) return att ? 'pari' : 'zero';
      return q > att ? 'piu' : 'meno';
    };
    const clsRiga = (r) => {
      const c = dopo(r).stato;
      if (stato[r.id].problema || DISCREPANZE.includes(c)) return 'prob';
      if (c === 'conforme') return giaConforme(r) ? 'fatto' : 'ok';
      return sommaTaglie(stato[r.id].ric) ? 'parz' : '';
    };
    async function invia() {
      invio.value = true;
      try {
        const d = await inviaDistinta({
          ordineId: m.ordineId, msgId: m.id, note: note.value,
          righe: righe.map((r) => ({
            rigaId: r.id, codArt: r.codArt, descrizione: r.descrizione,
            ricevute: { ...stato[r.id].ric }, problema: stato[r.id].problema, nota: stato[r.id].nota,
          })),
          chiusura: chiudiComunque.value && tot.value.tipo !== 'totale' ? { nota: notaChiusura.value.trim() } : null,
        });
        toast(`Distinta ${d.tipo} inviata (${Math.round(d.perc)}% conforme)`);
        vai(`#/distinta/${d.id}`);
      } finally { invio.value = false; }
    }
    return {
      mancante: false, m, testa, righe, prima, ordinate, stato, residuo, residuoTot, soloAperti, segnala, conferma, note, visore, invio,
      chiudiComunque, notaChiusura, responsabilita, dopo, visibili, tot, piu, tutti, azzera, tuttoArrivato, clsCella, clsRiga, invia,
      giaConforme, sommaTaglie, etichettaTaglia, STATI_RIGA, PROBLEMI, num, perc,
    };
  },
  template: `<div class="pagina con-barra" v-if="!mancante">
    <page-head titolo="Ricezione merce" :sotto="'Ordine n. ' + testa.id + ' · ' + testa.fornitore" :indietro="'#/pacchetto/' + m.id"/>
    <section class="card">
      <div class="ric-tot">
        <div><small>Ordinati</small><b>{{ num(tot.ord) }}</b></div>
        <div><small>Già ricevuti</small><b>{{ num(tot.gia) }}</b></div>
        <div><small>Questa consegna</small><b class="acc">{{ num(tot.ora) }}</b></div>
        <div><small>Conformi</small><b>{{ perc(tot.perc) }}</b></div>
      </div>
      <div class="barra-perc"><i :style="{width: tot.perc + '%'}"></i></div>
      <div class="riga-az">
        <label class="check"><input type="checkbox" v-model="soloAperti"> Solo articoli da ricevere</label>
        <button class="btn piccolo" @click="tuttoArrivato">Tutto arrivato</button>
      </div>
      <p class="muted aiuto-ric">Per ogni taglia scrivi i capi arrivati. «Tutti» vuol dire esattamente le quantità attese, taglia per taglia: ogni differenza viene segnalata.</p>
    </section>

    <ul class="lista ricez">
      <li v-for="r in visibili" :key="r.id" :class="clsRiga(r)">
        <div class="ricez-testa">
          <button class="ricez-foto" @click="r.foto.length && (visore = {ids: r.foto, i: 0})"><thumb :foto-id="r.foto[0]" :w="56"/>
            <small v-if="r.foto.length > 1">+{{ r.foto.length - 1 }}</small></button>
          <div class="grow">
            <b class="mono">{{ r.codArt }}</b>
            <small>{{ r.descrizione }}</small>
            <small>{{ r.categoria || r.macro }} · {{ r.colore || '–' }}<template v-if="r.griglia"> · {{ r.griglia }}</template></small>
          </div>
        </div>
        <p v-if="r.note" class="nota-box"><ic n="alert" :s="14"/> Verificare: {{ r.note }}</p>
        <div v-if="giaConforme(r)" class="ok-txt"><ic n="check" :s="14"/> già ricevuto tutto, conforme</div>
        <template v-else>
          <div class="griglia-ric">
            <div v-for="(q, t) in ordinate[r.id]" :key="t" class="cella-ric" :class="clsCella(r, t)">
              <span class="t">{{ etichettaTaglia(t) }}</span>
              <span class="att">attesi {{ residuo(r, t) }}<template v-if="prima.get(r.id)?.[t]"> di {{ q }}</template></span>
              <div class="stepper mini">
                <button @click="piu(r, t, -1)" aria-label="Meno">−</button>
                <input type="number" inputmode="numeric" min="0" v-model.number="stato[r.id].ric[t]">
                <button @click="piu(r, t, 1)" aria-label="Più">+</button>
              </div>
            </div>
          </div>
          <div class="ricez-q">
            <button class="btn piccolo" @click="tutti(r)">Tutti ({{ residuoTot(r) }})</button>
            <button class="btn piccolo" @click="azzera(r)">Azzera</button>
            <span class="badge-riga" :class="STATI_RIGA[dopo(r).stato].classe">{{ STATI_RIGA[dopo(r).stato].nome }}</span>
          </div>
          <small v-if="dopo(r).stato !== 'conforme' && dopo(r).descr" class="diff-txt">Rispetto all'ordinato: {{ dopo(r).descr }}</small>
        </template>
        <div class="ricez-prob">
          <button class="link" :class="{rosso: stato[r.id].problema}" @click="segnala = r"><ic n="alert" :s="14"/>
            {{ stato[r.id].problema ? stato[r.id].problema + (stato[r.id].nota ? ': ' + stato[r.id].nota : '') : 'Segnala problema' }}</button>
        </div>
      </li>
      <li v-if="!visibili.length" class="vuoto">Tutti gli articoli risultano già ricevuti e conformi.</li>
    </ul>

    <div class="barra-tot azione">
      <div class="bt-v"><b>Distinta {{ tot.tipo }}</b><span>{{ num(tot.ora) }} capi · {{ perc(tot.perc) }} conforme<template v-if="tot.disc"> · {{ tot.disc }} discrepanz{{ tot.disc === 1 ? 'a' : 'e' }}</template><template v-if="tot.probl"> · {{ tot.probl }} segnalazion{{ tot.probl === 1 ? 'e' : 'i' }}</template></span></div>
      <button class="btn primario" :disabled="!tot.ora && !tot.probl" @click="conferma = true"><ic n="send"/> Invia</button>
    </div>

    <sheet v-if="segnala" :titolo="'Problema · ' + segnala.codArt" @chiudi="segnala = null">
      <div class="chips"><button v-for="pr in PROBLEMI" :key="pr" :class="{on: stato[segnala.id].problema === pr}"
        @click="stato[segnala.id].problema = stato[segnala.id].problema === pr ? '' : pr">{{ pr }}</button></div>
      <textarea class="inp" rows="3" v-model="stato[segnala.id].nota" placeholder="Descrivi il problema"></textarea>
      <button class="btn primario pieno" @click="segnala = null">Fatto</button>
    </sheet>
    <sheet v-if="conferma" titolo="Invia distinta" @chiudi="conferma = false">
      <p>Distinta <b>{{ tot.tipo }}</b>: {{ num(tot.ora) }} capi in questa consegna, {{ perc(tot.perc) }} dell'ordinato ricevuto conforme.</p>
      <p v-if="tot.disc"><b>{{ tot.disc }}</b> articol{{ tot.disc === 1 ? 'o' : 'i' }} con eccedenze o taglie diverse dall'ordinato.</p>
      <p v-if="tot.probl"><b>{{ tot.probl }}</b> {{ tot.probl === 1 ? 'articolo con segnalazione' : 'articoli con segnalazioni' }}.</p>
      <label class="largo">Note sulla consegna<textarea class="inp" rows="2" v-model="note"></textarea></label>
      <template v-if="tot.tipo !== 'totale'">
        <label class="check"><input type="checkbox" v-model="chiudiComunque"> Chiudi l'ordine nonostante le differenze</label>
        <template v-if="chiudiComunque">
          <label class="largo">Motivo della chiusura<textarea class="inp" rows="2" v-model="notaChiusura" placeholder="Es. il fornitore non consegnerà i capi mancanti"></textarea></label>
          <label class="check"><input type="checkbox" v-model="responsabilita"> Me ne assumo la responsabilità</label>
        </template>
      </template>
      <p class="muted">La distinta, con il dettaglio per taglia, arriva all'amministrazione e al buyer; lo stato dell'ordine si aggiorna in automatico.</p>
      <button class="btn primario pieno grande" :disabled="invio || (chiudiComunque && !responsabilita)" @click="invia"><ic n="send"/> Invia distinta</button>
    </sheet>
    <visore v-if="visore" :foto-ids="visore.ids" :indice="visore.i" @chiudi="visore = null"/>
  </div>
  <div v-else class="pagina"><page-head titolo="Ordine non trovato" indietro="#/arrivi"/></div>`,
};

// ---------------------------------------------------------------- distinte
export const Distinte = {
  setup() {
    const elenco = computed(() => {
      state.rev;
      let d = [...M.distinte.values()];
      if (state.ruolo === 'puntovendita') d = d.filter((x) => x.ruolo === 'puntovendita');
      return d.sort((a, b) => b.data.localeCompare(a.data));
    });
    const nonLetta = (d) => { state.rev; return [...M.messaggi.values()].some((m) => m.distintaId === d.id && m.a === state.ruolo && !m.letto); };
    const sotto = computed(() => ({ amministrazione: 'Ricevute dai negozi', logistica: 'Consegne registrate dai negozi', puntovendita: 'Inviate' }[state.ruolo]));
    return { elenco, nonLetta, sotto, nomeFornitore, dataOra, perc, RUOLI, state, M };
  },
  template: `<div class="pagina">
    <page-head titolo="Distinte" :sotto="sotto"/>
    <ul class="lista schede">
      <li v-for="d in elenco" :key="d.id" :class="{nuovo: nonLetta(d)}" @click="$vai('#/distinta/' + d.id)">
        <ic n="clip"/><div class="grow"><b>Ordine n. {{ d.ordineId }} · {{ nomeFornitore(M.ord.get(d.ordineId)?.fornitoreId) }}</b>
          <small>{{ dataOra(d.data) }} · {{ RUOLI[d.ruolo].nome }} · {{ d.pezziRicevuti }} capi</small>
          <div class="barra-perc piccola"><i :style="{width: d.perc + '%'}"></i></div></div>
        <div class="dx"><span class="badge-stato" :class="d.tipo === 'totale' ? 'st-chiuso' : 'st-parziale'">{{ d.tipo === 'totale' ? 'Totale' : 'Parziale' }}</span>
          <small>{{ perc(d.perc) }}</small><small v-if="d.discrepanze" class="err">{{ d.discrepanze }} discrep.</small>
          <small v-if="d.problemi" class="err">{{ d.problemi }} segnal.</small></div></li>
      <li v-if="!elenco.length" class="vuoto">Nessuna distinta.</li>
    </ul>
  </div>`,
};

export const Distinta = {
  props: { id: Number },
  components: { TaglieTabella },
  setup(p) {
    const d = M.distinte.get(p.id);
    if (!d) return { mancante: true };
    for (const m of M.messaggi.values()) if (m.distintaId === d.id && m.a === state.ruolo) segnaLetto(m.id);
    const o = computed(() => { state.rev; return M.ord.get(d.ordineId); });
    const prezzi = computed(() => RUOLI[state.ruolo].prezzi);
    const ritorno = computed(() => {
      if (state.ruolo === 'buyer') return `#/ordine/${d.ordineId}`;
      const m = msgOrdine(d.ordineId, state.ruolo);
      return m ? `#/pacchetto/${m.id}` : '#/distinte';
    });
    const righeTab = (r) => [
      ...(sommaTaglie(r.prima) ? [{ nome: 'Già ricevuto', val: r.prima }] : []),
      { nome: 'Questa consegna', val: r.ricevute },
      ...(sommaTaglie(r.prima) ? [{ nome: 'Totale', val: r.cumulate }] : []),
    ];
    const confronta = (r) => (sommaTaglie(r.prima) ? 'Totale' : 'Questa consegna');
    return { mancante: false, d, o, prezzi, ritorno, righeTab, confronta, STATI_RIGA, nomeFornitore, dataOra, num, euro, perc, RUOLI };
  },
  template: `<div class="pagina" v-if="!mancante">
    <page-head :titolo="'Distinta ' + d.tipo" :sotto="'Ordine n. ' + d.ordineId + ' · ' + nomeFornitore(o?.fornitoreId)" :indietro="ritorno"/>
    <div v-if="o?.chiusura?.conDifferenze" class="banner avviso"><ic n="alert"/>
      <span>Ordine chiuso con differenze da {{ RUOLI[o.chiusura.ruolo]?.nome }}: {{ $diff(o.chiusura.mancanti, o.chiusura.eccedenze) }}.<template v-if="o.chiusura.nota"> «{{ o.chiusura.nota }}»</template></span></div>
    <section class="card">
      <div class="kv">
        <div><span>Data</span><b>{{ dataOra(d.data) }}</b></div>
        <div><span>Compilata da</span><b>{{ RUOLI[d.ruolo].nome }}</b></div>
        <div><span>Capi in questa consegna</span><b>{{ num(d.pezziRicevuti) }}</b></div>
        <div><span>Conformi sul totale</span><b>{{ num(d.pezziConformi) }} / {{ num(d.pezziOrdinati) }} · {{ perc(d.perc) }}</b></div>
        <template v-if="prezzi">
          <div><span>Valore ordinato</span><b>{{ euro(d.valoreOrdinato) }}</b></div>
          <div><span>Valore ricevuto conforme</span><b>{{ euro(d.valoreRicevuto) }} · {{ perc(d.valoreOrdinato ? d.valoreRicevuto / d.valoreOrdinato * 100 : 0) }}</b></div>
        </template>
      </div>
      <div class="barra-perc"><i :style="{width: d.perc + '%'}"></i></div>
      <p v-if="d.note" class="nota-box">{{ d.note }}</p>
    </section>
    <section class="card">
      <div class="card-h"><h2>Articoli</h2><small class="muted">{{ d.discrepanze || 0 }} discrepanze · {{ d.problemi }} segnalazioni</small></div>
      <div v-for="r in d.righe" :key="r.rigaId" class="dist-riga" :class="{prob: r.problema || ['eccedenza', 'taglie diverse', 'eccedenze e mancanze'].includes(r.stato)}">
        <div class="art-top"><div class="grow"><b class="mono">{{ r.codArt }}</b><small>{{ r.descrizione }}</small></div>
          <span class="badge-riga" :class="STATI_RIGA[r.stato].classe">{{ STATI_RIGA[r.stato].nome }}</span></div>
        <taglie-tabella :ordinate="r.ordinate" :righe="righeTab(r)" :confronta="confronta(r)"/>
        <small v-if="r.stato !== 'conforme' && r.descr" class="diff-txt">Rispetto all'ordinato: {{ r.descr }}</small>
        <div v-if="r.problema" class="err"><ic n="alert" :s="13"/> {{ r.problema }}<span v-if="r.nota">: {{ r.nota }}</span></div>
      </div>
    </section>
  </div>
  <div v-else class="pagina"><page-head titolo="Distinta non trovata" indietro="#/distinte"/></div>`,
};
