// Ricerca articoli e report (sintesi per categoria/brand, confronto stagioni).

import { M, state, stagioni, nomeAzienda, nomeFornitore, nomeCat, nomeColore, nomeMacro, salvaBudget } from './db.js';
import { cerca, perFornitore, sintesi, confronto, budgetVoci, FILTRI_VUOTI } from './analisi.js';
import { esportaRighe } from './excel.js';
import { STATI, GENERI, euro, euro0, num, perc, delta, data, stagioneNome, stagionePrec, stagioneOrd, stagioneSucc } from './util.js';
import { toast } from './comp.js';

const { ref, reactive, computed, watch } = Vue;

const ETICHETTE = {
  stagione: (v) => stagioneNome(v), aziendaId: (v) => nomeAzienda(+v), fornitoreId: (v) => nomeFornitore(+v),
  macroId: (v) => nomeMacro(+v), catId: (v) => nomeCat(+v), coloreId: (v) => nomeColore(+v), genere: (v) => GENERI[v],
  prezzoMin: (v) => `da ${euro0(v)}`, prezzoMax: (v) => `fino a ${euro0(v)}`, statoOrdine: (v) => STATI[v]?.nome,
  statoConsegna: (v) => `consegna ${v}`,
};

const nOrdini = (k) => [...M.ord.values()].filter((o) => `${o.anno}${o.stagione}` === k).length;
// la stagione più recente con almeno 10 ordini: proposta di default per report ed esempi
const stagioneRicca = (elenco) => elenco.find((x) => nOrdini(x) >= 10) || elenco[0];

// ---------------------------------------------------------------- ricerca
export const Ricerca = {
  props: { query: Object },
  setup(p) {
    const f = reactive(FILTRI_VUOTI());
    // filtri passati nel link (es. dall'avviso di sovrapposizione nella scheda articolo)
    for (const k of ['stagione', 'macroId', 'catId', 'coloreId', 'fornitoreId']) if (p.query?.[k]) f[k] = p.query[k];
    const pannello = ref(false), aperti = reactive(new Set()), limiteGruppi = ref(25);
    const elencoStagioni = stagioni();
    const categorie = computed(() => M.categorie.filter((c) => !f.macroId || c.macroId === +f.macroId).sort((a, b) => a.nome.localeCompare(b.nome)));
    const attivi = computed(() => Object.keys(ETICHETTE).filter((k) => f[k] !== '' && f[k] != null));
    const nessunFiltro = computed(() => !attivi.value.length && !f.testo.trim());
    const risultati = computed(() => { state.rev; return nessunFiltro.value ? [] : cerca(f); });
    const gruppi = computed(() => perFornitore(risultati.value));
    const tot = computed(() => risultati.value.reduce((s, x) => ({ p: s.p + (x.r.qta || 0), v: s.v + x.tot }), { p: 0, v: 0 }));
    const toggle = (k) => (aperti.has(k) ? aperti.delete(k) : aperti.add(k));
    function preset(nomeCat_, colore, sk) {
      Object.assign(f, FILTRI_VUOTI());
      const c = M.categorie.find((x) => x.nome.toLowerCase() === nomeCat_);
      const col = M.colori.find((x) => x.nome.toLowerCase() === colore);
      if (c) { f.macroId = c.macroId; f.catId = c.id; }
      if (col) f.coloreId = col.id;
      if (sk) f.stagione = sk;
    }
    const azzera = () => Object.assign(f, FILTRI_VUOTI());
    async function excel() {
      toast('Preparazione file Excel…');
      await esportaRighe(risultati.value.slice(0, 3000).map((x) => x.r), {
        nomeFile: 'Ricerca articoli.xlsx',
        titolo: 'Ricerca: ' + [f.testo, ...attivi.value.map((k) => ETICHETTE[k](f[k]))].filter(Boolean).join(' · '),
        prezzi: true,
      });
    }
    const vai = (x) => { location.hash = `#/articolo/${x.o.id}/${x.r.id}`; };
    const skEsempio = stagioneRicca(elencoStagioni);
    return {
      f, pannello, aperti, limiteGruppi, elencoStagioni, categorie, attivi, nessunFiltro, risultati, gruppi, tot, toggle, preset, azzera,
      excel, vai, skEsempio, ETICHETTE, M, STATI, GENERI, euro, euro0, num, stagioneNome, nomeCat, nomeColore,
    };
  },
  template: `<div class="pagina">
    <page-head titolo="Ricerca" sotto="Articoli di tutti gli ordini"/>
    <div class="filtri-riga">
      <input class="inp" v-model="f.testo" type="search" placeholder="Codice, descrizione, composizione…">
      <button class="btn" :class="{primario: pannello}" @click="pannello = !pannello"><ic n="filter"/> Filtri<span v-if="attivi.length"> ({{ attivi.length }})</span></button>
    </div>
    <div class="chips" v-if="attivi.length">
      <span v-for="k in attivi" :key="k" class="chip">{{ ETICHETTE[k](f[k]) }} <button @click="f[k] = ''" aria-label="Rimuovi">×</button></span>
      <button class="link" @click="azzera">Azzera</button>
    </div>

    <section class="card" v-if="pannello">
      <div class="form">
        <label>Stagione<select class="inp" v-model="f.stagione"><option value="">Tutte</option>
          <option v-for="s in elencoStagioni" :value="s">{{ stagioneNome(s) }}</option></select></label>
        <label>Società<select class="inp" v-model="f.aziendaId"><option value="">Tutte</option>
          <option v-for="a in M.aziende" :value="a.id">{{ a.nome }}</option></select></label>
        <label class="largo">Fornitore<fornitore-picker :model-value="f.fornitoreId ? +f.fornitoreId : null" @update:model-value="f.fornitoreId = $event"/></label>
        <label>Categoria<select class="inp" v-model="f.macroId" @change="f.catId = ''"><option value="">Tutte</option>
          <option v-for="m in M.macro" :value="m.id">{{ m.nome }}</option></select></label>
        <label>Sottocategoria<select class="inp" v-model="f.catId"><option value="">Tutte</option>
          <option v-for="c in categorie" :value="c.id">{{ c.nome }}</option></select></label>
        <label>Colore<select class="inp" v-model="f.coloreId"><option value="">Tutti</option>
          <option v-for="c in M.colori" :value="c.id">{{ c.nome }}</option></select></label>
        <label>Genere<select class="inp" v-model="f.genere"><option value="">Tutti</option>
          <option v-for="(g, k) in GENERI" :value="k">{{ g }}</option></select></label>
        <label>Prezzo da €<input class="inp" type="number" inputmode="decimal" v-model="f.prezzoMin"></label>
        <label>Prezzo fino a €<input class="inp" type="number" inputmode="decimal" v-model="f.prezzoMax"></label>
        <label>Stato ordine<select class="inp" v-model="f.statoOrdine"><option value="">Tutti</option>
          <option v-for="(s, k) in STATI" :value="k">{{ s.nome }}</option></select></label>
        <label>Stato consegna<select class="inp" v-model="f.statoConsegna"><option value="">Tutti</option>
          <option value="non trasmesso">Non trasmesso</option><option value="in attesa">In attesa</option>
          <option value="parziale">Parziale</option><option value="consegnato">Consegnato</option></select></label>
      </div>
    </section>

    <section v-if="nessunFiltro" class="card">
      <div class="card-h"><h2>Ricerche rapide</h2></div>
      <div class="menu-azioni">
        <button @click="preset('giacche', 'blu', skEsempio)"><ic n="search"/> Giacche blu · {{ stagioneNome(skEsempio) }}</button>
        <button @click="preset('sneakers', 'bianco', '')"><ic n="search"/> Sneakers bianche · tutte le stagioni</button>
        <button @click="preset('maglioni', 'verde', skEsempio)"><ic n="search"/> Maglioni verdi · {{ stagioneNome(skEsempio) }}</button>
      </div>
    </section>

    <template v-else>
      <div class="ris-tot">
        <span><b>{{ num(risultati.length) }}</b> articoli · <b>{{ num(tot.p) }}</b> capi · <b>{{ euro0(tot.v) }}</b> · {{ gruppi.length }} fornitori</span>
        <button class="btn piccolo" :disabled="!risultati.length" @click="excel"><ic n="download" :s="16"/> Excel</button>
      </div>
      <section v-for="g in gruppi.slice(0, limiteGruppi)" :key="g.chiave" class="card gruppo">
        <button class="card-h gruppo-h" @click="toggle(g.chiave)">
          <h2>{{ g.nome }}</h2><span class="muted">{{ g.n }} art. · {{ num(g.pezzi) }} capi · {{ euro0(g.valore) }}</span>
          <ic :n="aperti.has(g.chiave) ? 'up' : 'down'" :s="18"/></button>
        <ul v-if="aperti.has(g.chiave) || gruppi.length <= 3" class="lista articoli">
          <li v-for="x in g.righe.slice(0, 60)" :key="x.r.id" @click="vai(x)">
            <thumb :riga-id="x.r.id" :w="44"/>
            <div class="grow"><b class="mono">{{ x.r.codArt }}</b><small>{{ x.r.descrizione }}</small>
              <small>{{ x.r.catId ? nomeCat(x.r.catId) : '–' }} · {{ x.r.coloreId ? nomeColore(x.r.coloreId) : '–' }} · {{ stagioneNome(x.sk) }} · ord. {{ x.o.id }}</small></div>
            <div class="dx"><b>{{ num(x.r.qta) }} pz</b><small>{{ euro(x.r.prezzo) }}</small></div></li>
          <li v-if="g.righe.length > 60" class="muted">… altri {{ g.righe.length - 60 }} articoli (usa l'export Excel)</li>
        </ul>
      </section>
      <button v-if="gruppi.length > limiteGruppi" class="btn pieno" @click="limiteGruppi += 25">Altri fornitori ({{ gruppi.length - limiteGruppi }})</button>
      <p v-if="!risultati.length" class="vuoto">Nessun articolo corrisponde ai filtri.</p>
    </template>
  </div>`,
};

// ---------------------------------------------------------------- report
export const Report = {
  setup() {
    const elencoStagioni = stagioni();
    const scheda = ref('sintesi');
    const azienda = ref('');
    const skS = ref(nOrdini(state.imp.stagioneLavoro) >= 10 ? state.imp.stagioneLavoro : stagioneRicca(elencoStagioni));
    const skA = ref(skS.value);
    const skB = ref(elencoStagioni.includes(stagionePrec(skA.value)) ? stagionePrec(skA.value) : elencoStagioni[1]);
    // la variazione si calcola sempre dalla stagione più vecchia (B) alla più recente (A)
    watch([skA, skB], ([a, b]) => { if (a && b && stagioneOrd(a) < stagioneOrd(b)) { skA.value = b; skB.value = a; } });
    // confronto a parità di data: della stagione B solo gli ordini inseriti entro la stessa data, n anni prima
    const paritaData = ref(false);
    const finoB = computed(() => {
      const anni = parseInt(skA.value.slice(0, 4), 10) - parseInt(skB.value.slice(0, 4), 10);
      if (anni <= 0) return null;
      const d = new Date();
      d.setFullYear(d.getFullYear() - anni);
      return d.toISOString().slice(0, 10);
    });
    // budget
    const skBud = ref(state.imp.stagioneLavoro || elencoStagioni[0]);
    const stagioniBudget = [...new Set([stagioneSucc(elencoStagioni[0]), ...elencoStagioni])].sort((a, b) => stagioneOrd(b) - stagioneOrd(a));
    const livBud = ref('macro'), modBud = ref(false), nuovaVoce = ref(null);
    const extra = ref([]);
    const NOMI = { macro: nomeMacro, cat: nomeCat, brand: nomeFornitore };
    const b = computed(() => {
      state.rev;
      const r = budgetVoci(skBud.value, livBud.value, azienda.value);
      const presenti = new Set(r.voci.map((v) => v.id));
      const agg = extra.value.filter((e) => e.liv === livBud.value && !presenti.has(e.id))
        .map((e) => ({ id: e.id, nome: NOMI[e.liv](e.id), pezzi: 0, valore: 0, budget: 0 }));
      return { voci: [...r.voci, ...agg], tot: r.tot };
    });
    const opzioniNuove = computed(() => {
      const presenti = new Set(b.value.voci.map((v) => v.id));
      if (livBud.value === 'macro') return M.macro.filter((x) => !presenti.has(x.id));
      if (livBud.value === 'cat') return M.categorie.filter((x) => !presenti.has(x.id)).sort((x, y) => x.nome.localeCompare(y.nome));
      return [];
    });
    const imposta = (v, valore) => salvaBudget(skBud.value, livBud.value, v.id, valore);
    function aggiungi(id) { if (id) extra.value.push({ liv: livBud.value, id: Number(id) }); nuovaVoce.value = null; }
    const livello = ref('macro');
    const tabella = ref(false);
    const aperte = reactive(new Set());
    const s = computed(() => { state.rev; return sintesi(skS.value, azienda.value); });
    const c = computed(() => { state.rev; return confronto(skA.value, skB.value, livello.value, azienda.value, { finoB: paritaData.value ? finoB.value : null }); });
    const maxV = computed(() => Math.max(1, ...c.value.righe.map((r) => Math.max(r.vA, r.vB))));
    const toggle = (k) => (aperte.has(k) ? aperte.delete(k) : aperte.add(k));
    const marchi = (cat) => cat.brand.map((b) => `${b.nome.split(/\s+/).slice(0, 2).join(' ')} ${num(b.pezzi)}`).join(', ');
    const dCls = (v) => (v == null ? '' : v >= 0 ? 'su' : 'giu');
    const dTxt = (v) => (v == null ? 'nuovo' : `${v >= 0 ? '+' : ''}${perc(v)}`);
    return {
      elencoStagioni, scheda, azienda, skS, skA, skB, livello, tabella, aperte, s, c, maxV, toggle, marchi, dCls, dTxt,
      paritaData, finoB, skBud, stagioniBudget, livBud, modBud, nuovaVoce, b, opzioniNuove, imposta, aggiungi, state,
      M, euro0, num, perc, delta, data, stagioneNome,
    };
  },
  template: `<div class="pagina">
    <page-head titolo="Report" sotto="Distribuzione degli acquisti"/>
    <div class="seg pieno"><button :class="{on: scheda === 'sintesi'}" @click="scheda = 'sintesi'">Sintesi</button>
      <button :class="{on: scheda === 'confronto'}" @click="scheda = 'confronto'">Confronto</button>
      <button :class="{on: scheda === 'budget'}" @click="scheda = 'budget'">Budget</button></div>

    <template v-if="scheda === 'sintesi'">
      <div class="filtri-riga">
        <select class="inp" v-model="skS"><option v-for="x in elencoStagioni" :value="x">{{ stagioneNome(x) }}</option></select>
        <select class="inp" v-model="azienda"><option value="">Tutte le società</option><option v-for="a in M.aziende" :value="a.id">{{ a.nome }}</option></select>
      </div>
      <div class="ris-tot"><span>{{ stagioneNome(skS) }}: <b>{{ num(s.pezzi) }}</b> capi · <b>{{ euro0(s.valore) }}</b></span></div>
      <p v-if="!s.macro.length" class="vuoto">Nessun acquisto in questa stagione.</p>
      <section v-for="m in s.macro" :key="m.chiave" class="card">
        <div class="card-h"><h2>{{ m.nome }}</h2><span class="muted">{{ num(m.pezzi) }} capi · {{ euro0(m.valore) }} · {{ perc(s.valore ? m.valore / s.valore * 100 : 0) }}</span></div>
        <div class="barra-perc"><i :style="{width: (s.valore ? m.valore / s.valore * 100 : 0) + '%'}"></i></div>
        <div v-for="cat in m.cat" :key="cat.chiave" class="rep-cat" @click="toggle(m.chiave + '-' + cat.chiave)">
          <div class="rep-cat-h"><b>{{ cat.nome.toUpperCase() }}</b><span>{{ num(cat.pezzi) }} capi · {{ euro0(cat.valore) }}</span></div>
          <p class="rep-brand">{{ marchi(cat) }}</p>
          <ul v-if="aperte.has(m.chiave + '-' + cat.chiave)" class="rep-brand-det">
            <li v-for="b in cat.brand" :key="b.chiave"><span>{{ b.nome }}</span><span>{{ num(b.pezzi) }} capi · {{ euro0(b.valore) }}</span></li></ul>
        </div>
      </section>
    </template>

    <template v-else-if="scheda === 'confronto'">
      <div class="filtri-riga">
        <select class="inp" v-model="skA"><option v-for="x in elencoStagioni" :value="x">{{ stagioneNome(x) }}</option></select>
        <span class="vs">vs</span>
        <select class="inp" v-model="skB"><option v-for="x in elencoStagioni" :value="x">{{ stagioneNome(x) }}</option></select>
      </div>
      <div class="seg pieno"><button :class="{on: livello === 'macro'}" @click="livello = 'macro'">Categoria</button>
        <button :class="{on: livello === 'cat'}" @click="livello = 'cat'">Sottocat.</button>
        <button :class="{on: livello === 'brand'}" @click="livello = 'brand'">Brand</button></div>
      <div class="filtri-riga">
        <select class="inp" v-model="azienda"><option value="">Tutte le società</option><option v-for="a in M.aziende" :value="a.id">{{ a.nome }}</option></select>
      </div>
      <label v-if="finoB" class="check parita"><input type="checkbox" v-model="paritaData"> A parità di data
        <small v-if="paritaData">· {{ stagioneNome(skB) }} con i soli ordini inseriti entro il {{ data(finoB) }}</small></label>
      <section class="card">
        <div class="conf-tot">
          <div><small>{{ stagioneNome(skA) }}</small><b>{{ euro0(c.tot.vA) }}</b><span>{{ num(c.tot.pA) }} capi</span></div>
          <div><small>{{ stagioneNome(skB) }}</small><b>{{ euro0(c.tot.vB) }}</b><span>{{ num(c.tot.pB) }} capi</span></div>
          <div><small>Variazione su {{ stagioneNome(skB) }}</small><b :class="dCls(delta(c.tot.vA, c.tot.vB))">{{ dTxt(delta(c.tot.vA, c.tot.vB)) }}</b>
            <span>capi {{ dTxt(delta(c.tot.pA, c.tot.pB)) }}</span></div>
        </div>
        <div class="legenda"><span class="la"></span>{{ stagioneNome(skA) }} <span class="lb"></span>{{ stagioneNome(skB) }}
          <button class="link" @click="tabella = !tabella">{{ tabella ? 'Vista grafica' : 'Tabella completa' }}</button></div>
      </section>
      <section class="card" v-if="!tabella">
        <div v-for="r in c.righe.slice(0, 40)" :key="r.id" class="conf-r">
          <div class="conf-h"><b>{{ r.nome }}</b><span :class="dCls(delta(r.vA, r.vB))">{{ dTxt(delta(r.vA, r.vB)) }}</span></div>
          <div class="conf-b"><span class="trk"><i class="a" :style="{width: r.vA / maxV * 100 + '%'}"></i></span><em>{{ euro0(r.vA) }} · {{ perc(r.iA) }}</em></div>
          <div class="conf-b"><span class="trk"><i class="b" :style="{width: r.vB / maxV * 100 + '%'}"></i></span><em>{{ euro0(r.vB) }} · {{ perc(r.iB) }}</em></div>
        </div>
        <p v-if="c.righe.length > 40" class="muted">Mostrate le prime 40 voci su {{ c.righe.length }}: vedi la tabella completa.</p>
      </section>
      <div class="scroll-x card" v-else>
        <table class="tab larga">
          <thead><tr><th></th><th class="n">Capi A</th><th class="n">Capi B</th><th class="n">Δ capi</th><th class="n">Valore A</th><th class="n">Valore B</th>
            <th class="n">Δ valore</th><th class="n">Incid. A</th><th class="n">Incid. B</th></tr></thead>
          <tbody><tr v-for="r in c.righe" :key="r.id"><td>{{ r.nome }}</td><td class="n">{{ num(r.pA) }}</td><td class="n">{{ num(r.pB) }}</td>
            <td class="n" :class="dCls(delta(r.pA, r.pB))">{{ dTxt(delta(r.pA, r.pB)) }}</td><td class="n">{{ euro0(r.vA) }}</td><td class="n">{{ euro0(r.vB) }}</td>
            <td class="n" :class="dCls(delta(r.vA, r.vB))">{{ dTxt(delta(r.vA, r.vB)) }}</td><td class="n">{{ perc(r.iA) }}</td><td class="n">{{ perc(r.iB) }}</td></tr></tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="filtri-riga">
        <select class="inp" v-model="skBud"><option v-for="x in stagioniBudget" :value="x">{{ stagioneNome(x) }}</option></select>
        <select class="inp" v-model="azienda"><option value="">Tutte le società</option><option v-for="a in M.aziende" :value="a.id">{{ a.nome }}</option></select>
      </div>
      <div class="seg pieno"><button :class="{on: livBud === 'macro'}" @click="livBud = 'macro'">Categoria</button>
        <button :class="{on: livBud === 'cat'}" @click="livBud = 'cat'">Sottocat.</button>
        <button :class="{on: livBud === 'brand'}" @click="livBud = 'brand'">Brand</button></div>
      <section class="card">
        <div class="conf-tot">
          <div><small>Budget</small><b>{{ euro0(b.tot.budget) }}</b></div>
          <div><small>Ordinato</small><b>{{ euro0(b.tot.valore) }}</b><span>{{ num(b.tot.pezzi) }} capi</span></div>
          <div><small>{{ b.tot.valore > b.tot.budget ? 'Oltre il budget' : 'Disponibile' }}</small>
            <b :class="b.tot.valore > b.tot.budget ? 'giu' : 'su'">{{ euro0(Math.abs(b.tot.budget - b.tot.valore)) }}</b>
            <span v-if="b.tot.budget">usato {{ perc(b.tot.valore / b.tot.budget * 100) }}</span></div>
        </div>
        <div class="riga-az"><span class="muted">Budget di acquisto per {{ livBud === 'macro' ? 'categoria' : livBud === 'cat' ? 'sottocategoria' : 'brand' }}, a valore</span>
          <button class="btn piccolo" :class="{primario: modBud}" @click="modBud = !modBud">{{ modBud ? 'Fatto' : 'Modifica budget' }}</button></div>
      </section>
      <section class="card">
        <div v-for="v in b.voci" :key="String(v.id)" class="bud-r">
          <div class="conf-h"><b>{{ v.nome }}</b>
            <span v-if="v.budget" :class="v.valore > v.budget ? 'giu' : ''">{{ perc(v.valore / v.budget * 100) }}</span></div>
          <div class="bud-v">
            <span>{{ euro0(v.valore) }} · {{ num(v.pezzi) }} capi</span>
            <input v-if="modBud" class="inp bud-inp" type="number" inputmode="decimal" min="0" step="100" :value="v.budget || ''"
              placeholder="Budget €" @change="imposta(v, $event.target.value)">
            <span v-else class="muted">{{ v.budget ? 'budget ' + euro0(v.budget) : 'nessun budget' }}</span>
          </div>
          <div v-if="v.budget" class="barra-perc" :class="{oltre: v.valore > v.budget}"><i :style="{width: Math.min(100, v.valore / v.budget * 100) + '%'}"></i></div>
        </div>
        <p v-if="!b.voci.length" class="vuoto">Nessun ordine e nessun budget per questa stagione.</p>
        <div v-if="modBud" class="bud-agg">
          <select v-if="livBud !== 'brand'" class="inp" v-model="nuovaVoce" @change="aggiungi(nuovaVoce)">
            <option :value="null">Aggiungi {{ livBud === 'macro' ? 'categoria' : 'sottocategoria' }}…</option>
            <option v-for="o in opzioniNuove" :key="o.id" :value="o.id">{{ o.nome }}</option></select>
          <fornitore-picker v-else :model-value="null" @update:model-value="aggiungi($event)"/>
        </div>
      </section>
    </template>
  </div>`,
};
