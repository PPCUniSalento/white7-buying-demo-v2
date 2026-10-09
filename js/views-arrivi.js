// Viste dei ruoli che ricevono: pannelli, casella in arrivo, pacchetto, ricezione merce, distinte.

import {
  M, state, righeOrdine, ricevutoPerRiga, segnaLetto, inviaDistinta, nomeFornitore, stagioneOrdine, nonLetti,
} from './db.js';
import { esportaRighe } from './excel.js';
import { RUOLI, STATI, GENERI, PROBLEMI, euro, euro0, num, perc, data, dataOra, mese, meseCorrente, stagioneNome, totaleRiga } from './util.js';
import { toast } from './comp.js';

const { ref, reactive, computed } = Vue;

const vai = (h) => { location.hash = h; };

function messaggiRuolo(ruolo, tipo) {
  return [...M.messaggi.values()].filter((m) => m.a === ruolo && (!tipo || m.tipo === tipo)).sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}
const pezziPacchetto = (m) => m.payload.righe.reduce((s, r) => s + (r.qta || 0), 0);
const valorePacchetto = (m) => m.payload.righe.reduce((s, r) => s + totaleRiga(r), 0);
function percRicevuto(ordineId) {
  const ric = ricevutoPerRiga(ordineId);
  let o = 0, r = 0;
  for (const x of righeOrdine(ordineId)) { o += x.qta || 0; r += Math.min(x.qta || 0, ric.get(x.id) || 0); }
  return o ? (r / o) * 100 : 0;
}
function primaFoto(m) {
  for (const r of m.payload.righe) if (r.foto && r.foto.length && M.foto.has(r.foto[0])) return r.foto[0];
  return null;
}

// ---------------------------------------------------------------- pannello amministrazione
export const PannelloAdmin = {
  setup() {
    const dati = computed(() => {
      state.rev;
      const ordini = messaggiRuolo('amministrazione', 'ordine');
      const distinte = messaggiRuolo('amministrazione', 'distinta');
      const sk = state.imp.stagioneLavoro;
      let trasm = 0, cons = 0;
      for (const o of M.ord.values()) {
        if (stagioneOrdine(o) !== sk || !['trasmesso', 'parziale', 'chiuso'].includes(o.stato)) continue;
        const ric = ricevutoPerRiga(o.id);
        for (const r of righeOrdine(o.id)) {
          const pu = (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
          trasm += pu * (r.qta || 0);
          cons += pu * (o.storico && o.stato === 'chiuso' ? r.qta || 0 : Math.min(r.qta || 0, ric.get(r.id) || 0));
        }
      }
      const ora = meseCorrente();
      return {
        ordini, distinte, trasm, cons, sk,
        attese: [...M.ord.values()].filter((o) => o.stato === 'trasmesso').length,
        parziali: [...M.ord.values()].filter((o) => o.stato === 'parziale').length,
        ritardi: [...M.ord.values()].filter((o) => ['trasmesso', 'parziale'].includes(o.stato) && o.consegnaA && o.consegnaA < ora),
        nuove: distinte.filter((m) => !m.letto).length,
        recenti: [...ordini, ...distinte].sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 8),
      };
    });
    function apri(m) { segnaLetto(m.id); vai(m.tipo === 'distinta' ? `#/distinta/${m.distintaId}` : `#/pacchetto/${m.id}`); }
    return { dati, apri, euro0, num, perc, dataOra, mese, stagioneNome, nomeFornitore, STATI };
  },
  template: `<div class="pagina">
    <page-head titolo="Pannello" sotto="Amministrazione"/>
    <div class="kpi">
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.ordini.length }}</b><span>Ordini ricevuti</span></a>
      <a href="#/distinte" class="kpi-c evid"><b>{{ dati.nuove }}</b><span>Distinte da leggere</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.attese }}</b><span>Consegne attese</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.parziali }}</b><span>Parz. consegnati</span></a>
    </div>
    <section class="card">
      <div class="card-h"><h2>{{ stagioneNome(dati.sk) }}: trasmesso e consegnato</h2></div>
      <div class="stag-conf">
        <div><small>Trasmesso</small><b>{{ euro0(dati.trasm) }}</b></div>
        <div><small>Consegnato</small><b>{{ euro0(dati.cons) }}</b><span>{{ perc(dati.trasm ? dati.cons / dati.trasm * 100 : 0) }} dell'ordinato</span></div>
      </div>
      <div class="barra-perc"><i :style="{width: (dati.trasm ? dati.cons / dati.trasm * 100 : 0) + '%'}"></i></div>
    </section>
    <section class="card">
      <div class="card-h"><h2>Ultimi arrivi</h2></div>
      <ul class="lista">
        <li v-for="m in dati.recenti" :key="m.id" :class="{nuovo: !m.letto}" @click="apri(m)">
          <ic :n="m.tipo === 'distinta' ? 'clip' : 'inbox'"/><div class="grow"><b>{{ m.titolo }}</b><small>{{ dataOra(m.data) }}</small></div></li>
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

// ---------------------------------------------------------------- pannello logistica / negozio
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
      };
    });
    function apri(m) { segnaLetto(m.id); vai(`#/pacchetto/${m.id}`); }
    return { dati, apri, primaFoto, pezziPacchetto, num, mese, dataOra, stagioneNome, RUOLI, state, meseCorrente };
  },
  template: `<div class="pagina">
    <page-head titolo="Pannello" :sotto="RUOLI[state.ruolo].nome"/>
    <div class="kpi">
      <a href="#/arrivi" class="kpi-c evid"><b>{{ dati.nuovi.length }}</b><span>Nuovi in arrivo</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.daRic.length }}</b><span>Da ricevere</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.parziali }}</b><span>Parz. ricevuti</span></a>
      <a href="#/arrivi" class="kpi-c"><b>{{ dati.ritardi.length }}</b><span>In ritardo</span></a>
    </div>
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
          <div class="grow"><b>entro {{ mese(g.k) }}</b><small>{{ g.n }} ordini · {{ num(g.pezzi) }} capi<span v-if="g.k < meseCorrente()"> · in ritardo</span></small></div></li>
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
      const msg = messaggiRuolo(state.ruolo, 'ordine').filter((m) => {
        const st = M.ord.get(m.ordineId)?.stato;
        const daRic = st === 'trasmesso' || st === 'parziale';
        if (scheda.value === 'da' ? !daRic : daRic) return false;
        return !t || `${m.payload.testa.id} ${m.payload.testa.fornitore}`.toLowerCase().includes(t);
      });
      return msg;
    });
    function apri(m) { segnaLetto(m.id); vai(`#/pacchetto/${m.id}`); }
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
          <small>consegna {{ mese(m.payload.testa.consegnaDa) }} – {{ mese(m.payload.testa.consegnaA) }} · ricevuto il {{ dataOra(m.data) }}</small>
          <div v-if="stato(m) === 'parziale'" class="barra-perc piccola"><i :style="{width: percRicevuto(m.ordineId) + '%'}"></i></div></div>
        <stato-badge :stato="stato(m)"/></li>
      <li v-if="!elenco.length" class="vuoto">Nessun ordine.</li>
    </ul>
  </div>`,
};

// ---------------------------------------------------------------- pacchetto ricevuto
export const Pacchetto = {
  props: { msgId: Number },
  setup(p) {
    const m = M.messaggi.get(p.msgId);
    if (!m || m.tipo !== 'ordine') return { mancante: true };
    segnaLetto(m.id);
    const { testa, righe, prezzi } = m.payload;
    const q = ref(''), visore = ref(null), esporta = ref(false);
    const stato = computed(() => { state.rev; return M.ord.get(m.ordineId)?.stato; });
    const ric = computed(() => { state.rev; return ricevutoPerRiga(m.ordineId); });
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
    const puoRicevere = computed(() => ['logistica', 'puntovendita'].includes(state.ruolo) && ['trasmesso', 'parziale'].includes(stato.value));
    async function excel() {
      toast('Preparazione file Excel…');
      await esportaRighe(righeOrdine(m.ordineId), {
        nomeFile: `Ordine ${testa.id} ${testa.fornitore}${prezzi ? '' : ' (senza prezzi)'}.xlsx`,
        titolo: `Ordine n. ${testa.id} – ${testa.fornitore} – ${stagioneNome(testa.stagione)}`, prezzi,
      });
    }
    const taglie = (r) => (r.taglie ? Object.entries(r.taglie).filter(([, n]) => n) : []);
    return {
      mancante: false, m, testa, righe, prezzi, q, visore, esporta, stato, ric, pr, filtrate, riep, distinte, puoRicevere, excel, taglie,
      GENERI, RUOLI, euro, num, perc, mese, data, dataOra, stagioneNome, totaleRiga,
    };
  },
  template: `<div class="pagina" v-if="!mancante">
    <page-head :titolo="'Ordine n. ' + testa.id" :sotto="testa.fornitore" indietro="#/arrivi"><stato-badge :stato="stato"/></page-head>
    <div v-if="!prezzi" class="banner neutro"><ic n="lock"/> Vista filtrata: senza prezzi d'acquisto, sconti e condizioni di pagamento.</div>

    <section class="card">
      <div class="kv">
        <div><span>Società</span><b>{{ testa.azienda }}</b></div>
        <div><span>Stagione</span><b>{{ stagioneNome(testa.stagione) }}</b></div>
        <div><span>Consegna</span><b>{{ mese(testa.consegnaDa) }} – {{ mese(testa.consegnaA) }}</b></div>
        <div><span>Trasmesso</span><b>{{ dataOra(m.data) }}</b></div>
        <div v-if="prezzi"><span>Pagamento</span><b>{{ testa.pagamento || '–' }}</b></div>
        <div v-if="prezzi && testa.scontoExtra"><span>Sconto extra</span><b>{{ testa.scontoExtra }}%</b></div>
      </div>
      <p v-if="testa.note" class="nota-box">{{ testa.note }}</p>
      <div v-if="stato === 'parziale' || stato === 'chiuso'" class="ric-stato">
        <span>Ricevuto {{ perc(pr) }} dei capi</span><div class="barra-perc"><i :style="{width: pr + '%'}"></i></div></div>
    </section>

    <div class="azioni-pagina">
      <a v-if="puoRicevere" class="btn primario grande" :href="'#/ricezione/' + m.id"><ic n="clip"/> Ricezione merce</a>
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
        <div class="grow"><b>Distinta {{ d.tipo }} · {{ Math.round(d.perc) }}%</b><small>{{ dataOra(d.data) }} · {{ RUOLI[d.ruolo].nome }}</small></div></li></ul>
    </section>

    <input class="inp" v-model="q" type="search" placeholder="Cerca negli articoli">
    <ul class="lista articoli grandi">
      <li v-for="r in filtrate" :key="r.id">
        <div class="art-top">
          <div class="grow"><b class="mono">{{ r.codArt }}</b><small>{{ r.descrizione }}</small></div>
          <div class="dx"><b>{{ num(r.qta) }} pz</b>
            <small v-if="ric.get(r.id)">ricevuti {{ ric.get(r.id) }}</small>
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
          <small v-if="taglie(r).length" class="mono">{{ taglie(r).map(([t, n]) => t + ':' + n).join('  ') }}</small>
          <p v-if="r.note" class="nota-box"><ic n="alert" :s="14"/> {{ r.note }}</p>
        </div>
      </li>
    </ul>
    <visore v-if="visore" :foto-ids="visore.ids" :indice="visore.i" @chiudi="visore = null"/>
  </div>
  <div v-else class="pagina"><page-head titolo="Messaggio non trovato" indietro="#/arrivi"/></div>`,
};

// ---------------------------------------------------------------- ricezione merce
export const Ricezione = {
  props: { msgId: Number },
  setup(p) {
    const m = M.messaggi.get(p.msgId);
    if (!m || m.tipo !== 'ordine') return { mancante: true };
    const { testa, righe } = m.payload;
    const prima = ricevutoPerRiga(m.ordineId);
    const stato = reactive(Object.fromEntries(righe.map((r) => [r.id, { ricevuti: 0, problema: '', nota: '' }])));
    const residuo = (r) => Math.max(0, (r.qta || 0) - (prima.get(r.id) || 0));
    const soloAperti = ref(true), segnala = ref(null), conferma = ref(false), note = ref(''), visore = ref(null), invio = ref(false);
    const visibili = computed(() => righe.filter((r) => !soloAperti.value || residuo(r) > 0));
    const tot = computed(() => {
      let ord = 0, giaRic = 0, ora = 0, probl = 0;
      for (const r of righe) {
        ord += r.qta || 0;
        giaRic += Math.min(r.qta || 0, prima.get(r.id) || 0);
        ora += stato[r.id].ricevuti || 0;
        if (stato[r.id].problema) probl++;
      }
      const totRic = Math.min(ord, giaRic + ora);
      return { ord, giaRic, ora, totRic, perc: ord ? (totRic / ord) * 100 : 0, probl, tipo: totRic >= ord ? 'totale' : 'parziale' };
    });
    const piu = (r, d) => {
      const s = stato[r.id];
      s.ricevuti = Math.max(0, Math.min(residuo(r), (Number(s.ricevuti) || 0) + d));
    };
    const tutti = (r) => { stato[r.id].ricevuti = residuo(r); };
    const tuttoArrivato = () => righe.forEach((r) => { stato[r.id].ricevuti = residuo(r); });
    const classe = (r) => {
      const n = Number(stato[r.id].ricevuti) || 0;
      if (stato[r.id].problema) return 'prob';
      if (!residuo(r)) return 'fatto';
      return n >= residuo(r) ? 'ok' : n > 0 ? 'parz' : '';
    };
    async function invia() {
      invio.value = true;
      try {
        const d = await inviaDistinta({
          ordineId: m.ordineId, msgId: m.id, note: note.value,
          righe: righe.filter((r) => stato[r.id].ricevuti || stato[r.id].problema).map((r) => ({
            rigaId: r.id, codArt: r.codArt, descrizione: r.descrizione, ordinati: r.qta || 0, ricevutiPrima: prima.get(r.id) || 0,
            ricevuti: Number(stato[r.id].ricevuti) || 0, problema: stato[r.id].problema, nota: stato[r.id].nota,
          })),
        });
        toast(`Distinta ${d.tipo} inviata all'amministrazione (${Math.round(d.perc)}%)`);
        vai(`#/distinta/${d.id}`);
      } finally { invio.value = false; }
    }
    return {
      mancante: false, m, testa, righe, prima, stato, residuo, soloAperti, segnala, conferma, note, visore, invio, visibili, tot,
      piu, tutti, tuttoArrivato, classe, invia, PROBLEMI, GENERI, num, perc, mese,
    };
  },
  template: `<div class="pagina con-barra" v-if="!mancante">
    <page-head titolo="Ricezione merce" :sotto="'Ordine n. ' + testa.id + ' · ' + testa.fornitore" :indietro="'#/pacchetto/' + m.id"/>
    <section class="card">
      <div class="ric-tot">
        <div><small>Ordinati</small><b>{{ num(tot.ord) }}</b></div>
        <div><small>Già ricevuti</small><b>{{ num(tot.giaRic) }}</b></div>
        <div><small>Questa consegna</small><b class="acc">{{ num(tot.ora) }}</b></div>
        <div><small>Totale</small><b>{{ perc(tot.perc) }}</b></div>
      </div>
      <div class="barra-perc"><i class="prima" :style="{width: (tot.ord ? tot.giaRic / tot.ord * 100 : 0) + '%'}"></i><i :style="{width: (tot.ord ? tot.ora / tot.ord * 100 : 0) + '%'}"></i></div>
      <div class="riga-az">
        <label class="check"><input type="checkbox" v-model="soloAperti"> Solo articoli da ricevere</label>
        <button class="btn piccolo" @click="tuttoArrivato">Tutto arrivato</button>
      </div>
    </section>

    <ul class="lista ricez">
      <li v-for="r in visibili" :key="r.id" :class="classe(r)">
        <button class="ricez-foto" @click="r.foto.length && (visore = {ids: r.foto, i: 0})"><thumb :foto-id="r.foto[0]" :w="64"/>
          <small v-if="r.foto.length > 1">+{{ r.foto.length - 1 }}</small></button>
        <div class="grow">
          <b class="mono">{{ r.codArt }}</b>
          <small>{{ r.descrizione }}</small>
          <small>{{ r.categoria || r.macro }} · {{ r.colore || '–' }}</small>
          <p v-if="r.note" class="nota-box"><ic n="alert" :s="14"/> Verificare: {{ r.note }}</p>
          <div class="ricez-q">
            <span>Attesi <b>{{ residuo(r) }}</b><template v-if="prima.get(r.id)"> (di {{ r.qta }})</template></span>
            <div class="stepper" v-if="residuo(r)">
              <button @click="piu(r, -1)" aria-label="Meno">−</button>
              <input type="number" inputmode="numeric" min="0" :max="residuo(r)" v-model.number="stato[r.id].ricevuti">
              <button @click="piu(r, 1)" aria-label="Più">+</button>
            </div>
            <button v-if="residuo(r)" class="btn piccolo" @click="tutti(r)">Tutti</button>
            <span v-else class="ok-txt"><ic n="check" :s="14"/> già ricevuto</span>
          </div>
          <div class="ricez-prob">
            <button class="link" :class="{rosso: stato[r.id].problema}" @click="segnala = r"><ic n="alert" :s="14"/>
              {{ stato[r.id].problema ? stato[r.id].problema + (stato[r.id].nota ? ': ' + stato[r.id].nota : '') : 'Segnala problema' }}</button>
          </div>
        </div>
      </li>
      <li v-if="!visibili.length" class="vuoto">Tutti gli articoli risultano già ricevuti.</li>
    </ul>

    <div class="barra-tot azione">
      <div class="bt-v"><b>Distinta {{ tot.tipo }}</b><span>{{ num(tot.ora) }} capi · {{ perc(tot.perc) }} dell'ordinato<template v-if="tot.probl"> · {{ tot.probl }} segnalazion{{ tot.probl === 1 ? 'e' : 'i' }}</template></span></div>
      <button class="btn primario" :disabled="!tot.ora && !tot.probl" @click="conferma = true"><ic n="send"/> Invia</button>
    </div>

    <sheet v-if="segnala" :titolo="'Problema · ' + segnala.codArt" @chiudi="segnala = null">
      <div class="chips"><button v-for="pr in PROBLEMI" :key="pr" :class="{on: stato[segnala.id].problema === pr}"
        @click="stato[segnala.id].problema = stato[segnala.id].problema === pr ? '' : pr">{{ pr }}</button></div>
      <textarea class="inp" rows="3" v-model="stato[segnala.id].nota" placeholder="Descrivi il problema"></textarea>
      <button class="btn primario pieno" @click="segnala = null">Fatto</button>
    </sheet>
    <sheet v-if="conferma" titolo="Invia distinta" @chiudi="conferma = false">
      <p>Distinta <b>{{ tot.tipo }}</b>: {{ num(tot.ora) }} capi ricevuti in questa consegna.
        Totale ricevuto {{ num(tot.totRic) }} su {{ num(tot.ord) }} ({{ perc(tot.perc) }}).</p>
      <p v-if="tot.probl"><b>{{ tot.probl }}</b> {{ tot.probl === 1 ? 'articolo con segnalazione' : 'articoli con segnalazioni' }}.</p>
      <label class="largo">Note sulla consegna<textarea class="inp" rows="2" v-model="note"></textarea></label>
      <p class="muted">La distinta arriva all'amministrazione e al buyer; lo stato dell'ordine si aggiorna in automatico.</p>
      <button class="btn primario pieno grande" :disabled="invio" @click="invia"><ic n="send"/> Invia distinta</button>
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
      const r = state.ruolo;
      let d = [...M.distinte.values()];
      if (r === 'logistica' || r === 'puntovendita') d = d.filter((x) => x.ruolo === r);
      return d.sort((a, b) => b.data.localeCompare(a.data));
    });
    const nonLetta = (d) => { state.rev; return [...M.messaggi.values()].some((m) => m.distintaId === d.id && m.a === state.ruolo && !m.letto); };
    return { elenco, nonLetta, nomeFornitore, dataOra, perc, RUOLI, state, M };
  },
  template: `<div class="pagina">
    <page-head titolo="Distinte" :sotto="state.ruolo === 'amministrazione' ? 'Ricevute da logistica e negozi' : 'Inviate'"/>
    <ul class="lista schede">
      <li v-for="d in elenco" :key="d.id" :class="{nuovo: nonLetta(d)}" @click="$vai('#/distinta/' + d.id)">
        <ic n="clip"/><div class="grow"><b>Ordine n. {{ d.ordineId }} · {{ nomeFornitore(M.ord.get(d.ordineId)?.fornitoreId) }}</b>
          <small>{{ dataOra(d.data) }} · {{ RUOLI[d.ruolo].nome }} · {{ d.pezziRicevuti }} capi</small>
          <div class="barra-perc piccola"><i :style="{width: d.perc + '%'}"></i></div></div>
        <div class="dx"><span class="badge-stato" :class="d.tipo === 'totale' ? 'st-chiuso' : 'st-parziale'">{{ d.tipo }}</span>
          <small>{{ perc(d.perc) }}</small><small v-if="d.problemi" class="err">{{ d.problemi }} segnal.</small></div></li>
      <li v-if="!elenco.length" class="vuoto">Nessuna distinta.</li>
    </ul>
  </div>`,
};

export const Distinta = {
  props: { id: Number },
  setup(p) {
    const d = M.distinte.get(p.id);
    if (!d) return { mancante: true };
    for (const m of M.messaggi.values()) if (m.distintaId === d.id && m.a === state.ruolo) segnaLetto(m.id);
    const o = M.ord.get(d.ordineId);
    const prezzi = computed(() => RUOLI[state.ruolo].prezzi);
    const ritorno = computed(() => {
      if (state.ruolo === 'buyer') return `#/ordine/${d.ordineId}`;
      const m = [...M.messaggi.values()].find((x) => x.tipo === 'ordine' && x.ordineId === d.ordineId && x.a === state.ruolo);
      return m ? `#/pacchetto/${m.id}` : '#/distinte';
    });
    return { mancante: false, d, o, prezzi, ritorno, nomeFornitore, dataOra, num, euro, perc, RUOLI, stagioneNome, stagioneOrdine };
  },
  template: `<div class="pagina" v-if="!mancante">
    <page-head :titolo="'Distinta ' + d.tipo" :sotto="'Ordine n. ' + d.ordineId + ' · ' + nomeFornitore(o?.fornitoreId)" :indietro="ritorno"/>
    <section class="card">
      <div class="kv">
        <div><span>Data</span><b>{{ dataOra(d.data) }}</b></div>
        <div><span>Compilata da</span><b>{{ RUOLI[d.ruolo].nome }}</b></div>
        <div><span>Capi in questa consegna</span><b>{{ num(d.pezziRicevuti) }}</b></div>
        <div><span>Ricevuto sul totale</span><b>{{ num(d.pezziRicevutiTot) }} / {{ num(d.pezziOrdinati) }} · {{ perc(d.perc) }}</b></div>
        <template v-if="prezzi">
          <div><span>Valore ordinato</span><b>{{ euro(d.valoreOrdinato) }}</b></div>
          <div><span>Valore ricevuto</span><b>{{ euro(d.valoreRicevuto) }} · {{ perc(d.valoreOrdinato ? d.valoreRicevuto / d.valoreOrdinato * 100 : 0) }}</b></div>
        </template>
      </div>
      <div class="barra-perc"><i :style="{width: d.perc + '%'}"></i></div>
      <p v-if="d.note" class="nota-box">{{ d.note }}</p>
    </section>
    <section class="card">
      <div class="card-h"><h2>Articoli</h2><small class="muted">{{ d.problemi }} segnalazioni</small></div>
      <table class="tab">
        <thead><tr><th>Articolo</th><th class="n">Ord.</th><th class="n">Ric.</th></tr></thead>
        <tbody><tr v-for="r in d.righe" :key="r.rigaId" :class="{prob: r.problema}">
          <td><b class="mono">{{ r.codArt }}</b><br><small>{{ r.descrizione }}</small>
            <div v-if="r.problema" class="err"><ic n="alert" :s="13"/> {{ r.problema }}<span v-if="r.nota">: {{ r.nota }}</span></div></td>
          <td class="n">{{ r.ordinati }}</td><td class="n"><b>{{ r.ricevuti }}</b><small v-if="r.ricevutiPrima"><br>+{{ r.ricevutiPrima }} prima</small></td></tr></tbody>
      </table>
    </section>
  </div>
  <div v-else class="pagina"><page-head titolo="Distinta non trovata" indietro="#/distinte"/></div>`,
};
