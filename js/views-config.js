// Ruolo Configurazione (richiesta del 20/10/2026): classificazione merceologica, griglie taglie,
// liste (fornitori, colori, pagamenti, generi, segnalazioni, società) e regole dell'ordine.
// Ogni negozio adatta la propria configurazione; le modifiche non cambiano gli ordini già inseriti.

import {
  M, state, salvaAnagrafica, salvaConfigurazione, spostaArticoliCategoria, nuovoId, attivo, giorniConsegna,
  CAMPI_OBBLIGATORI, CAMPI_FISSI, CAMPI_CARTELLINO, CFG_DEFAULT,
} from './db.js';
import { esportaConfigurazione, leggiConfigurazione } from './config.js';
import { num, dataOra, stagioneNome, nomeGiorno, nomeMeseRelativo, meseRelativo, dataDiConsegna, dataConsegna } from './util.js';
import { toast } from './comp.js';

const { ref, reactive, computed } = Vue;
const vai = (h) => { location.hash = h; };
const perNome = (a, b) => a.nome.localeCompare(b.nome);
const UNITA = { ordini: 'ordine', articoli: 'articolo', segnalazioni: 'segnalazione' };
const quanti = (n, unita) => `${num(n)} ${n === 1 ? UNITA[unita] : unita}`;
const uguale = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Conteggi d'uso: una voce usata non si elimina (si disattiva)
function conta(elenco, chiave) {
  const m = new Map();
  for (const x of elenco) { const k = chiave(x); if (k != null) m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
const usoRighe = (campo) => conta(M.rig.values(), (r) => r[campo]);
const usoOrdini = (campo) => conta(M.ord.values(), (o) => o[campo]);
const usoSegnalazioni = () => conta([...M.distinte.values()].flatMap((d) => d.righe), (r) => r.problema || null);
const nomiGriglie = (ids) => (ids || []).map((id) => M.gri.get(id)?.nome).filter(Boolean).join(', ');
const descrObbligatori = (c) => [...CAMPI_OBBLIGATORI.testata, ...CAMPI_OBBLIGATORI.articolo].filter(([k]) => c.obbligatori[k]).map(([, n]) => n.toLowerCase());

// ---------------------------------------------------------------- pannello
const LISTE_MENU = [
  ['fornitori', 'Fornitori'], ['colori', 'Colori'], ['pagamenti', 'Condizioni di pagamento'],
  ['generi', 'Generi'], ['problemi', 'Motivi di segnalazione in ricezione'], ['aziende', 'Società'],
];

export const PannelloConfig = {
  setup() {
    const n = computed(() => {
      state.rev;
      return {
        macro: M.macro.length, cat: M.categorie.length, catOff: M.categorie.filter((c) => !attivo(c)).length,
        griglie: M.griglie.length, fornitori: M.fornitori.length, fornNuovi: M.fornitori.filter((f) => f.nuovo).length,
        liste: {
          fornitori: M.fornitori.length, colori: M.colori.length, pagamenti: M.pagamenti.length,
          generi: state.cfg.generi.length, problemi: state.cfg.problemi.length, aziende: M.aziende.length,
        },
      };
    });
    const regole = computed(() => {
      const c = state.cfg;
      return {
        obbligatori: ['fornitore', 'stagione', 'codice', 'quantità', ...descrObbligatori(c)].join(', '),
        cartellino: c.cartellino.limite ? `${c.cartellino.limite} caratteri (${CAMPI_CARTELLINO.filter(([k]) => c.cartellino.campi.includes(k)).map(([, x]) => x.toLowerCase()).join(' + ')})` : 'nessun controllo',
        giorni: giorniConsegna().map(nomeGiorno).join(', '),
        foto: c.minFoto ? `almeno ${c.minFoto}` : 'facoltative',
      };
    });
    const ultime = computed(() => {
      state.rev;
      return M.log.filter((e) => e.entita === 'configurazione' || e.entita === 'fornitore').slice(-6).reverse();
    });
    const inp = ref(null), anteprima = ref(null), lavoro = ref(false);
    async function esporta() {
      toast('Preparazione file Excel…');
      try { await esportaConfigurazione(); } catch (e) { toast(e.message, 'err'); }
    }
    async function scelto(ev) {
      const f = ev.target.files?.[0];
      ev.target.value = '';
      if (!f) return;
      lavoro.value = true;
      try { anteprima.value = await leggiConfigurazione(f); } catch (e) { toast(e.message, 'err'); } finally { lavoro.value = false; }
    }
    async function applica() {
      lavoro.value = true;
      try {
        await anteprima.value.applica();
        anteprima.value = null;
        toast('Configurazione importata');
      } catch (e) { toast(e.message, 'err'); } finally { lavoro.value = false; }
    }
    return { n, regole, ultime, inp, anteprima, lavoro, esporta, scelto, applica, LISTE_MENU, num, dataOra };
  },
  template: `<div class="pagina">
    <page-head titolo="Configurazione" sotto="Classificazione, taglie, liste e regole del negozio"/>
    <div class="kpi">
      <a href="#/cfg-categorie" class="kpi-c"><b>{{ n.macro }}</b><span>Categorie</span></a>
      <a href="#/cfg-categorie" class="kpi-c"><b>{{ n.cat }}</b><span>Sottocategorie</span></a>
      <a href="#/cfg-taglie" class="kpi-c"><b>{{ n.griglie }}</b><span>Griglie taglie</span></a>
      <a href="#/cfg-lista/fornitori" class="kpi-c" :class="{evid: n.fornNuovi}"><b>{{ n.fornNuovi }}</b><span>Fornitori nuovi da codificare</span></a>
    </div>

    <section class="card">
      <div class="card-h"><h2>Classificazione e taglie</h2></div>
      <div class="menu-azioni">
        <a href="#/cfg-categorie"><ic n="list"/> Categorie e sottocategorie <small>{{ n.macro }} / {{ n.cat }}<template v-if="n.catOff"> · {{ n.catOff }} disattivate</template></small></a>
        <a href="#/cfg-taglie"><ic n="grid"/> Griglie taglie <small>{{ n.griglie }}</small></a>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Liste</h2></div>
      <div class="menu-azioni">
        <a v-for="[k, nome] in LISTE_MENU" :key="k" :href="'#/cfg-lista/' + k"><ic n="tag"/> {{ nome }} <small>{{ num(n.liste[k]) }}</small></a>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Regole dell'ordine</h2><a class="link" href="#/cfg-regole">Modifica <ic n="next" :s="16"/></a></div>
      <div class="kv">
        <div class="largo"><span>Campi obbligatori</span><b>{{ regole.obbligatori }}</b></div>
        <div><span>Foto</span><b>{{ regole.foto }}</b></div>
        <div><span>Cartellino</span><b>{{ regole.cartellino }}</b></div>
        <div class="largo"><span>Giorni di consegna</span><b>{{ regole.giorni }}</b></div>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Excel della configurazione</h2></div>
      <p class="muted">Tutta la configurazione in un file, un foglio per parte: si prepara alla scrivania, si copia su un altro negozio,
        si tiene come copia di sicurezza. All'importazione l'app mostra prima cosa cambia; se c'è un errore non applica nulla.</p>
      <div class="menu-azioni">
        <button @click="esporta"><ic n="download"/> Esporta in Excel</button>
        <button @click="inp.click()" :disabled="lavoro"><span v-if="lavoro" class="spin"></span><ic v-else n="upload"/> Importa da Excel</button>
      </div>
      <input ref="inp" type="file" accept=".xlsx" hidden @change="scelto">
    </section>

    <section class="card" v-if="ultime.length">
      <div class="card-h"><h2>Ultime modifiche</h2><a class="link" href="#/registro">Registro</a></div>
      <ul class="lista log"><li v-for="e in ultime" :key="e.id"><div class="grow"><b>{{ e.azione }}</b>
        <small>{{ dataOra(e.ts) }}</small><small v-if="e.dettagli" class="det">{{ e.dettagli }}</small></div></li></ul>
    </section>
    <p class="muted centro">Le modifiche valgono su questo dispositivo e non cambiano gli ordini già inseriti:
      ogni articolo conserva sottocategoria, griglia e quantità.</p>

    <sheet v-if="anteprima" :titolo="'Importazione di ' + anteprima.nome" alto @chiudi="anteprima = null">
      <template v-if="anteprima.errori.length">
        <p><b>Il file ha {{ anteprima.errori.length }} error{{ anteprima.errori.length === 1 ? 'e' : 'i' }}: non viene applicato nulla.</b> Correggi il file e riprova.</p>
        <ul class="lista-err"><li v-for="e in anteprima.errori.slice(0, 40)">{{ e }}</li></ul>
        <p v-if="anteprima.errori.length > 40" class="muted">… e altri {{ anteprima.errori.length - 40 }}.</p>
      </template>
      <template v-else>
        <p v-if="anteprima.nienteDaFare"><b>Il file corrisponde già alla configurazione attuale:</b> non c'è niente da cambiare.</p>
        <template v-else><p><b>Cosa cambia:</b></p><ul class="lista-ok"><li v-for="r in anteprima.riepilogo">{{ r }}</li></ul></template>
      </template>
      <template v-if="anteprima.avvisi.length"><p><b>Da sapere:</b></p><ul class="lista-avv"><li v-for="a in anteprima.avvisi.slice(0, 30)">{{ a }}</li></ul></template>
      <div class="azioni-pagina">
        <button v-if="!anteprima.errori.length && !anteprima.nienteDaFare" class="btn primario" :disabled="lavoro" @click="applica"><ic n="check"/> Applica le modifiche</button>
        <button class="btn" @click="anteprima = null">{{ anteprima.errori.length || anteprima.nienteDaFare ? 'Chiudi' : 'Annulla' }}</button>
      </div>
    </sheet>
  </div>`,
};

// ---------------------------------------------------------------- categorie e sottocategorie
export const CfgCategorie = {
  setup() {
    const q = ref(''), edMacro = ref(null), edCat = ref(null);
    const uso = computed(() => { state.rev; return { cat: usoRighe('catId'), mac: usoRighe('macroId') }; });
    const macroOrd = computed(() => { state.rev; return [...M.macro].sort(perNome); });
    const gruppi = computed(() => {
      state.rev;
      const t = q.value.trim().toLowerCase();
      return macroOrd.value.map((m) => ({
        m,
        cat: M.categorie.filter((c) => c.macroId === m.id && (!t || c.nome.toLowerCase().includes(t) || m.nome.toLowerCase().includes(t))).sort(perNome),
      })).filter((g) => !t || g.cat.length);
    });
    const nCat = (m) => M.categorie.filter((c) => c.macroId === m.id).length;

    const nuovaMacro = () => { edMacro.value = { id: null, nome: '', attivo: true }; };
    const modMacro = (m) => { edMacro.value = { id: m.id, nome: m.nome, attivo: attivo(m) }; };
    async function salvaMacro() {
      const e = edMacro.value, nome = e.nome.trim();
      if (!nome) { toast('Il nome è obbligatorio', 'err'); return; }
      if (M.macro.some((x) => x.id !== e.id && uguale(x.nome, nome))) { toast('Esiste già una categoria con questo nome', 'err'); return; }
      if (e.id == null) {
        await salvaAnagrafica('macro', [...M.macro, { id: nuovoId(M.macro), cod: '', nome, attivo: e.attivo }], `Nuova categoria «${nome}»`);
      } else {
        const p = M.mac.get(e.id);
        const det = [p.nome !== nome && `«${p.nome}» rinominata «${nome}»`, attivo(p) !== e.attivo && `${nome} ${e.attivo ? 'riattivata' : 'disattivata'}`].filter(Boolean);
        if (det.length) await salvaAnagrafica('macro', M.macro.map((x) => (x.id === e.id ? { ...x, nome, attivo: e.attivo } : x)), `Categoria: ${det.join('; ')}`);
      }
      edMacro.value = null;
      toast('Categoria salvata');
    }
    async function eliminaMacro() {
      const e = edMacro.value;
      if (!confirm(`Eliminare la categoria «${e.nome}»?`)) return;
      await salvaAnagrafica('macro', M.macro.filter((x) => x.id !== e.id), `Eliminata la categoria «${e.nome}»`);
      edMacro.value = null;
    }

    const nuovaCat = (m) => { edCat.value = { id: null, nome: '', macroId: m.id, griglie: [], attivo: true }; };
    const modCat = (c) => { edCat.value = { id: c.id, nome: c.nome, macroId: c.macroId, griglie: [...(c.griglie || [])], attivo: attivo(c) }; };
    const spostata = computed(() => edCat.value?.id != null && M.cat.get(edCat.value.id)?.macroId !== edCat.value.macroId);
    const toggleGriglia = (id) => {
      const g = edCat.value.griglie;
      edCat.value.griglie = g.includes(id) ? g.filter((x) => x !== id) : [...g, id];
    };
    async function salvaCat() {
      const e = edCat.value, nome = e.nome.trim();
      if (!nome) { toast('Il nome è obbligatorio', 'err'); return; }
      if (M.categorie.some((x) => x.id !== e.id && x.macroId === e.macroId && uguale(x.nome, nome))) {
        toast('Questa categoria ha già una sottocategoria con questo nome', 'err');
        return;
      }
      // griglie nell'ordine dell'elenco griglie
      const griglie = M.griglie.map((g) => g.id).filter((id) => e.griglie.includes(id));
      const nomeMac = M.mac.get(e.macroId)?.nome;
      if (e.id == null) {
        const c = { id: nuovoId(M.categorie), cod: '', nome, macroId: e.macroId, griglie, attivo: e.attivo };
        await salvaAnagrafica('categorie', [...M.categorie, c], `Nuova sottocategoria «${nome}» in ${nomeMac}`);
      } else {
        const p = M.cat.get(e.id), n = uso.value.cat.get(e.id) || 0;
        if (spostata.value && n && !confirm(`Gli articoli di «${p.nome}» (${n}) passano nella categoria «${nomeMac}», anche negli ordini già inseriti: report e confronti ne terranno conto. Continuare?`)) return;
        const det = [
          p.nome !== nome && `rinominata «${nome}»`, spostata.value && `spostata in ${nomeMac}`,
          (p.griglie || []).join() !== griglie.join() && `griglie: ${nomiGriglie(griglie) || 'nessuna'}`,
          attivo(p) !== e.attivo && (e.attivo ? 'riattivata' : 'disattivata'),
        ].filter(Boolean);
        if (det.length) {
          await salvaAnagrafica('categorie', M.categorie.map((x) => (x.id === e.id ? { ...x, nome, macroId: e.macroId, griglie, attivo: e.attivo } : x)),
            `Sottocategoria «${p.nome}»: ${det.join('; ')}`);
        }
        if (spostata.value && n) await spostaArticoliCategoria(e.id, e.macroId);
      }
      edCat.value = null;
      toast('Sottocategoria salvata');
    }
    async function eliminaCat() {
      const e = edCat.value;
      if (!confirm(`Eliminare la sottocategoria «${e.nome}»?`)) return;
      await salvaAnagrafica('categorie', M.categorie.filter((x) => x.id !== e.id), `Eliminata la sottocategoria «${e.nome}»`);
      edCat.value = null;
    }
    return {
      q, edMacro, edCat, uso, macroOrd, gruppi, nCat, spostata, nuovaMacro, modMacro, salvaMacro, eliminaMacro,
      nuovaCat, modCat, toggleGriglia, salvaCat, eliminaCat, nomiGriglie, attivo, M, num, quanti,
    };
  },
  template: `<div class="pagina">
    <page-head titolo="Categorie e sottocategorie" :sotto="M.macro.length + ' categorie · ' + M.categorie.length + ' sottocategorie'" indietro="#/">
      <button class="btn primario" @click="nuovaMacro"><ic n="plus"/> Categoria</button></page-head>
    <input class="inp cerca" v-model="q" type="search" placeholder="Cerca categoria o sottocategoria">
    <section v-for="g in gruppi" :key="g.m.id" class="card" :class="{spenta: !attivo(g.m)}">
      <div class="card-h"><h2>{{ g.m.nome }} <i v-if="!attivo(g.m)" class="tag-off">disattivata</i></h2>
        <div class="az-h"><button class="btn piccolo" @click="modMacro(g.m)"><ic n="edit" :s="15"/> Modifica</button>
          <button class="btn piccolo" @click="nuovaCat(g.m)"><ic n="plus" :s="15"/> Sottocategoria</button></div></div>
      <ul class="lista compatta">
        <li v-for="c in g.cat" :key="c.id" :class="{spenta: !attivo(c)}" @click="modCat(c)">
          <div class="grow"><b>{{ c.nome }} <i v-if="!attivo(c)" class="tag-off">disattivata</i></b>
            <small>griglie: {{ nomiGriglie(c.griglie) || '–' }}</small></div>
          <small>{{ num(uso.cat.get(c.id) || 0) }} art.</small><ic n="next" :s="16"/></li>
        <li v-if="!g.cat.length" class="vuoto">Nessuna sottocategoria.</li>
      </ul>
    </section>
    <p v-if="!gruppi.length" class="vuoto">Nessuna categoria trovata.</p>

    <sheet v-if="edMacro" :titolo="edMacro.id == null ? 'Nuova categoria' : 'Categoria'" @chiudi="edMacro = null">
      <div class="form">
        <label class="largo">Nome *<input class="inp" v-model="edMacro.nome" placeholder="Es. Abbigliamento"></label>
        <label class="largo check"><input type="checkbox" v-model="edMacro.attivo"> Attiva: si può scegliere nei nuovi articoli</label>
      </div>
      <p v-if="edMacro.id != null" class="muted">{{ quanti(uso.mac.get(edMacro.id) || 0, 'articoli') }} e {{ nCat(edMacro) }} sottocategori{{ nCat(edMacro) === 1 ? 'a' : 'e' }}.
        Una categoria in uso si disattiva, non si elimina.</p>
      <div class="azioni-pagina"><button class="btn primario" @click="salvaMacro"><ic n="check"/> Salva</button>
        <button class="btn" @click="edMacro = null">Annulla</button>
        <button v-if="edMacro.id != null && !uso.mac.get(edMacro.id) && !nCat(edMacro)" class="btn rosso" @click="eliminaMacro"><ic n="trash"/> Elimina</button></div>
    </sheet>

    <sheet v-if="edCat" :titolo="edCat.id == null ? 'Nuova sottocategoria' : 'Sottocategoria'" alto @chiudi="edCat = null">
      <div class="form">
        <label class="largo">Nome *<input class="inp" v-model="edCat.nome" placeholder="Es. Pantaloni chino"></label>
        <label class="largo">Categoria<select class="inp" v-model.number="edCat.macroId">
          <option v-for="m in macroOrd" :key="m.id" :value="m.id">{{ m.nome }}{{ attivo(m) ? '' : ' (disattivata)' }}</option></select>
          <small v-if="spostata && uso.cat.get(edCat.id)" class="err">Spostandola, i suoi {{ uso.cat.get(edCat.id) }} articoli passano nella nuova categoria.</small></label>
        <div class="lbl-grp largo">Griglie taglie proposte nei nuovi articoli
          <div class="chips"><button v-for="g in M.griglie" :key="g.id" :class="{on: edCat.griglie.includes(g.id)}" @click="toggleGriglia(g.id)">{{ g.nome }}</button></div></div>
        <label class="largo check"><input type="checkbox" v-model="edCat.attivo"> Attiva: si può scegliere nei nuovi articoli</label>
      </div>
      <p v-if="edCat.id != null" class="muted">{{ quanti(uso.cat.get(edCat.id) || 0, 'articoli') }}. Una sottocategoria in uso si disattiva, non si elimina:
        gli articoli già inseriti la conservano.</p>
      <div class="azioni-pagina"><button class="btn primario" @click="salvaCat"><ic n="check"/> Salva</button>
        <button class="btn" @click="edCat = null">Annulla</button>
        <button v-if="edCat.id != null && !uso.cat.get(edCat.id)" class="btn rosso" @click="eliminaCat"><ic n="trash"/> Elimina</button></div>
    </sheet>
  </div>`,
};

// ---------------------------------------------------------------- griglie taglie
export const CfgGriglie = {
  setup() {
    const uso = computed(() => { state.rev; return usoRighe('grigliaId'); });
    const nSub = (g) => M.categorie.filter((c) => (c.griglie || []).includes(g.id)).length;
    return { uso, nSub, attivo, M, quanti, state };
  },
  template: `<div class="pagina">
    <page-head titolo="Griglie taglie" :sotto="M.griglie.length + ' griglie'" indietro="#/">
      <a class="btn primario" href="#/cfg-griglia/0"><ic n="plus"/> Griglia</a></page-head>
    <section v-for="g in M.griglie" :key="g.id" class="card cliccabile" :class="{spenta: !attivo(g)}" @click="$vai('#/cfg-griglia/' + g.id)">
      <div class="card-h"><h2>{{ g.nome }} <i v-if="!attivo(g)" class="tag-off">disattivata</i></h2><ic n="next" :s="18"/></div>
      <div class="chips"><span v-for="t in g.taglie" :key="t" class="chip">{{ t }}</span></div>
      <p class="muted">{{ g.taglie.length }} taglie · proposta in {{ nSub(g) }} sottocategori{{ nSub(g) === 1 ? 'a' : 'e' }} · {{ quanti(uso.get(g.id) || 0, 'articoli') }}</p>
    </section>
  </div>`,
};

export const CfgGriglia = {
  props: { id: Number },
  setup(p) {
    const orig = p.id ? M.gri.get(p.id) : null;
    if (p.id && !orig) return { mancante: true };
    const g = reactive(orig ? { nome: orig.nome, taglie: [...orig.taglie], attivo: attivo(orig) } : { nome: '', taglie: [], attivo: true });
    const subs = reactive(new Set(orig ? M.categorie.filter((c) => (c.griglie || []).includes(orig.id)).map((c) => c.id) : []));
    const nuova = ref(''), serie = reactive({ da: '', a: '', passo: '2' }), sel = ref(null), aperte = reactive(new Set());
    const righe = orig ? [...M.rig.values()].filter((r) => r.grigliaId === orig.id) : [];
    const taglieUsate = new Set(righe.flatMap((r) => Object.entries(r.taglie || {}).filter(([, q]) => q).map(([t]) => t)));
    const rimosseUsate = computed(() => (orig ? orig.taglie.filter((t) => !g.taglie.includes(t) && taglieUsate.has(t)) : []));
    const macroOrd = computed(() => [...M.macro].sort(perNome).map((m) => ({ ...m, cat: M.categorie.filter((c) => c.macroId === m.id).sort(perNome) })));
    const scelte = (m) => m.cat.filter((c) => subs.has(c.id)).length;

    function aggiungi() {
      const doppie = [];
      for (const t of nuova.value.split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
        if (g.taglie.includes(t)) doppie.push(t); else g.taglie.push(t);
      }
      if (doppie.length) toast(`Già presenti: ${doppie.join(', ')}`, 'err');
      nuova.value = '';
    }
    function aggiungiSerie() {
      const n = (v) => Number(String(v).replace(',', '.'));
      const da = n(serie.da), a = n(serie.a), passo = n(serie.passo);
      if (![da, a, passo].every(Number.isFinite) || passo <= 0 || a < da) { toast('Serie non valida: servono «da», «a» (non minore) e un passo positivo', 'err'); return; }
      if ((a - da) / passo > 60) { toast('Serie troppo lunga (al massimo 60 taglie)', 'err'); return; }
      for (let x = da; x <= a + 1e-9; x += passo) {
        const t = String(Math.round(x * 100) / 100);
        if (!g.taglie.includes(t)) g.taglie.push(t);
      }
    }
    const togli = (i) => { g.taglie.splice(i, 1); sel.value = null; };
    function sposta(i, d) {
      const j = i + d;
      if (j < 0 || j >= g.taglie.length) return;
      [g.taglie[i], g.taglie[j]] = [g.taglie[j], g.taglie[i]];
      sel.value = j;
    }
    const toggleSub = (id) => (subs.has(id) ? subs.delete(id) : subs.add(id));
    const tutte = (m, si) => m.cat.forEach((c) => (si ? subs.add(c.id) : subs.delete(c.id)));
    const toggleAperta = (id) => (aperte.has(id) ? aperte.delete(id) : aperte.add(id));

    async function salva() {
      const nome = g.nome.trim();
      if (!nome) { toast('Il nome è obbligatorio', 'err'); return; }
      if (M.griglie.some((x) => x.id !== orig?.id && uguale(x.nome, nome))) { toast('Esiste già una griglia con questo nome', 'err'); return; }
      if (!g.taglie.length) { toast('Inserisci almeno una taglia', 'err'); return; }
      if (rimosseUsate.value.length && !confirm(`Le taglie ${rimosseUsate.value.join(', ')} sono già compilate in alcuni articoli: lì restano con le loro quantità. Continuare?`)) return;
      const id = orig ? orig.id : nuovoId(M.griglie);
      const rec = { ...(orig || {}), id, nome, taglie: [...g.taglie], attivo: g.attivo };
      const griglie = orig ? M.griglie.map((x) => (x.id === id ? rec : x)) : [...M.griglie, rec];
      let nCambi = 0;
      const categorie = M.categorie.map((c) => {
        const ha = (c.griglie || []).includes(id), vuole = subs.has(c.id);
        if (ha === vuole) return c;
        nCambi++;
        return { ...c, griglie: vuole ? [...(c.griglie || []), id] : c.griglie.filter((x) => x !== id) };
      });
      const det = orig
        ? [orig.nome !== nome && `rinominata «${nome}»`, orig.taglie.join() !== rec.taglie.join() && `taglie: ${rec.taglie.join(' ')}`,
          attivo(orig) !== g.attivo && (g.attivo ? 'riattivata' : 'disattivata'), nCambi && `sottocategorie cambiate: ${nCambi}`].filter(Boolean).join('; ')
        : `taglie: ${rec.taglie.join(' ')}; ${subs.size} sottocategorie`;
      await salvaAnagrafica('griglie', griglie, det ? `Griglia ${orig ? '«' + orig.nome + '»' : 'nuova «' + nome + '»'}: ${det}` : '');
      if (nCambi) await salvaAnagrafica('categorie', categorie);
      toast('Griglia salvata');
      vai('#/cfg-taglie');
    }
    async function duplica() {
      let nome = `${orig.nome} (copia)`;
      while (M.griglie.some((x) => uguale(x.nome, nome))) nome += '+';
      const id = nuovoId(M.griglie);
      await salvaAnagrafica('griglie', [...M.griglie, { id, nome, taglie: [...orig.taglie], attivo: true }], `Griglia «${nome}» copiata da «${orig.nome}»`);
      toast('Copia creata: ora puoi modificarla');
      vai(`#/cfg-griglia/${id}`);
    }
    async function elimina() {
      if (!confirm(`Eliminare la griglia «${orig.nome}»?`)) return;
      await salvaAnagrafica('griglie', M.griglie.filter((x) => x.id !== orig.id), `Eliminata la griglia «${orig.nome}»`);
      await salvaAnagrafica('categorie', M.categorie.map((c) => ((c.griglie || []).includes(orig.id) ? { ...c, griglie: c.griglie.filter((x) => x !== orig.id) } : c)));
      vai('#/cfg-taglie');
    }
    return {
      mancante: false, orig, g, subs, nuova, serie, sel, aperte, nArt: righe.length, rimosseUsate, macroOrd, scelte,
      aggiungi, aggiungiSerie, togli, sposta, toggleSub, tutte, toggleAperta, salva, duplica, elimina, quanti,
    };
  },
  template: `<div class="pagina cfg" v-if="!mancante">
    <page-head :titolo="orig ? orig.nome : 'Nuova griglia'" sotto="Griglia taglie" indietro="#/cfg-taglie"/>
    <section class="card"><div class="form">
      <label class="largo">Nome *<input class="inp" v-model="g.nome" placeholder="Es. Italiana 44–64"></label>
      <label class="largo check"><input type="checkbox" v-model="g.attivo"> Attiva: proposta nei nuovi articoli</label>
    </div></section>

    <section class="card">
      <div class="card-h"><h2>Taglie ({{ g.taglie.length }})</h2><small class="muted">nell'ordine in cui compaiono; tocca una taglia per spostarla o toglierla</small></div>
      <div class="chips taglie-ed">
        <button v-for="(t, i) in g.taglie" :key="t" :class="{on: sel === i}" @click="sel = sel === i ? null : i">{{ t }}</button>
        <span v-if="!g.taglie.length" class="muted">Nessuna taglia.</span></div>
      <div v-if="sel !== null" class="az-taglia">
        <button class="btn piccolo" :disabled="sel === 0" @click="sposta(sel, -1)"><ic n="back" :s="15"/> Prima</button>
        <button class="btn piccolo" :disabled="sel === g.taglie.length - 1" @click="sposta(sel, 1)">Dopo <ic n="next" :s="15"/></button>
        <button class="btn piccolo rosso" @click="togli(sel)"><ic n="trash" :s="15"/> Togli {{ g.taglie[sel] }}</button></div>
      <div class="form">
        <label class="largo">Aggiungi taglie<div class="riga-inp"><input class="inp" v-model="nuova" placeholder="Es. 62; 64" @keyup.enter="aggiungi">
          <button class="btn" @click="aggiungi">Aggiungi</button></div>
          <small class="aiuto">Una o più, separate da punto e virgola: vanno in fondo.</small></label>
        <div class="lbl-grp largo">Serie numerica<div class="riga-inp serie">
          <input class="inp" v-model="serie.da" inputmode="decimal" placeholder="da (44)" aria-label="Da">
          <input class="inp" v-model="serie.a" inputmode="decimal" placeholder="a (64)" aria-label="A">
          <input class="inp" v-model="serie.passo" inputmode="decimal" placeholder="passo" aria-label="Passo">
          <button class="btn" @click="aggiungiSerie">Aggiungi serie</button></div>
          <small class="aiuto">Es. da 44 a 64 di 2 in 2; per le scarpe da 39 a 46 di 0,5 in 0,5.</small></div>
      </div>
      <p v-if="rimosseUsate.length" class="nota-cart oltre"><ic n="alert" :s="15"/> Le taglie {{ rimosseUsate.join(', ') }} sono già compilate
        in alcuni articoli: lì restano con le loro quantità.</p>
    </section>

    <section class="card">
      <div class="card-h"><h2>Proposta nelle sottocategorie ({{ subs.size }})</h2></div>
      <div v-for="m in macroOrd" :key="m.id" class="grp-sub">
        <button class="grp-h" @click="toggleAperta(m.id)"><b>{{ m.nome }}</b><small>{{ scelte(m) }} / {{ m.cat.length }}</small>
          <ic :n="aperte.has(m.id) ? 'up' : 'down'" :s="16"/></button>
        <div v-if="aperte.has(m.id)" class="chips">
          <button class="link" @click="tutte(m, true)">Tutte</button><button class="link" @click="tutte(m, false)">Nessuna</button>
          <button v-for="c in m.cat" :key="c.id" :class="{on: subs.has(c.id)}" @click="toggleSub(c.id)">{{ c.nome }}</button></div>
      </div>
    </section>

    <p v-if="orig" class="muted">Usata da {{ quanti(nArt, 'articoli') }}: le quantità già inserite non cambiano.</p>
    <div class="azioni-pagina">
      <button class="btn primario" @click="salva"><ic n="check"/> Salva</button>
      <a class="btn" href="#/cfg-taglie">Annulla</a>
      <button v-if="orig" class="btn" @click="duplica"><ic n="copy"/> Duplica</button>
      <button v-if="orig && !nArt" class="btn rosso" @click="elimina"><ic n="trash"/> Elimina</button>
    </div>
  </div>
  <div v-else class="pagina"><page-head titolo="Griglia non trovata" indietro="#/cfg-taglie"/></div>`,
};

// ---------------------------------------------------------------- liste
// Adattatori: ogni lista si legge e si scrive come [{ id, nome, cod, attivo, nuovo }]
function listaAnagrafica(k, { campoAttivo = 'attivo' } = {}) {
  return {
    leggi: () => M[k].map((x) => ({ id: x.id, nome: x.nome, cod: x.cod || '', attivo: attivo(x), nuovo: !!x.nuovo })),
    scrivi: async (v, det) => {
      const vecchi = new Map(M[k].map((x) => [x.id, x]));
      await salvaAnagrafica(k, v.map((x) => {
        const p = vecchi.get(x.id) || { id: x.id };
        const r = { ...p, nome: x.nome, cod: x.cod, [campoAttivo]: x.attivo };
        if (k === 'fornitori') r.nuovo = !x.cod;
        return r;
      }), det);
    },
  };
}
function listaTesti(leggiV, scriviV) {
  return {
    leggi: () => leggiV().map((t, i) => ({ id: i + 1, nome: t, cod: '', attivo: true })),
    scrivi: (v, det) => scriviV(v.map((x) => x.nome), det),
  };
}
const LISTE = {
  fornitori: {
    titolo: 'Fornitori', voce: 'fornitore', codice: 'Codice', ...listaAnagrafica('fornitori', { campoAttivo: 'valido' }),
    uso: () => usoOrdini('fornitoreId'), unita: 'ordini', alfabetico: true,
    nota: 'I fornitori aggiunti durante l\'inserimento degli ordini restano «nuovi» finché non ricevono il codice del gestionale.',
  },
  colori: { titolo: 'Colori', voce: 'colore', ...listaAnagrafica('colori'), uso: () => usoRighe('coloreId'), unita: 'articoli' },
  aziende: { titolo: 'Società', voce: 'società', ...listaAnagrafica('aziende'), uso: () => usoOrdini('aziendaId'), unita: 'ordini' },
  generi: {
    titolo: 'Generi', voce: 'genere', codice: 'Sigla', codiceObbligatorio: true, unita: 'articoli',
    leggi: () => state.cfg.generi.map((g) => ({ id: g.k, cod: g.k, nome: g.nome, attivo: g.attivo !== false })),
    scrivi: (v, det) => salvaConfigurazione({ ...state.cfg, generi: v.map((x) => ({ k: x.cod, nome: x.nome, ...(x.attivo ? {} : { attivo: false }) })) }, det),
    uso: () => usoRighe('genere'),
  },
  pagamenti: {
    titolo: 'Condizioni di pagamento', voce: 'condizione', ordinabile: true, testi: true, unita: 'ordini',
    ...listaTesti(() => M.pagamenti, (v, det) => salvaAnagrafica('pagamenti', v, det)),
    uso: () => conta(M.ord.values(), (o) => o.pagamento || null), usoPerNome: true,
    nota: 'Sono i suggerimenti del campo «Condizioni di pagamento»: il buyer può comunque scrivere un testo libero.',
  },
  problemi: {
    titolo: 'Motivi di segnalazione', voce: 'motivo', ordinabile: true, testi: true, unita: 'segnalazioni',
    ...listaTesti(() => state.cfg.problemi, (v, det) => salvaConfigurazione({ ...state.cfg, problemi: v }, det)),
    uso: usoSegnalazioni, usoPerNome: true,
    nota: 'Sono i motivi che il punto vendita sceglie quando segnala un capo in ricezione.',
  },
};

export const CfgLista = {
  props: { tipo: String },
  setup(p) {
    const L = LISTE[p.tipo];
    if (!L) return { mancante: true };
    const q = ref(''), limite = ref(100), ed = ref(null);
    const elenco = computed(() => { state.rev; return L.leggi(); });
    const uso = computed(() => { state.rev; return L.uso(); });
    const usoDi = (x) => uso.value.get(L.usoPerNome ? x.nome : x.id) || 0;
    const visibili = computed(() => {
      const t = q.value.trim().toLowerCase();
      let a = elenco.value.filter((x) => !t || x.nome.toLowerCase().includes(t) || x.cod.toLowerCase().includes(t));
      if (L.alfabetico) a = [...a].sort((x, y) => (y.nuovo - x.nuovo) || perNome(x, y));
      return a;
    });
    const nuova = () => { ed.value = { id: null, nome: q.value.trim(), cod: '', attivo: true }; };
    const apri = (x) => { ed.value = { ...x, nomePrima: x.nome }; };
    async function salva() {
      const e = ed.value, nome = e.nome.trim();
      const cod = L.codiceObbligatorio ? (e.cod || '').trim().toUpperCase() : (e.cod || '').trim();
      if (!nome) { toast('Il nome è obbligatorio', 'err'); return; }
      if (elenco.value.some((x) => x.id !== e.id && uguale(x.nome, nome))) { toast(`Esiste già: «${nome}»`, 'err'); return; }
      if (L.codiceObbligatorio && (!cod || cod.length > 3)) { toast(`${L.codice} obbligatoria, al massimo 3 caratteri`, 'err'); return; }
      if (cod && elenco.value.some((x) => x.id !== e.id && x.cod && uguale(x.cod, cod))) { toast(`${L.codice} già usato da un'altra voce`, 'err'); return; }
      if (L.codiceObbligatorio && e.id != null && cod !== e.id && usoDi(e)) { toast('La sigla di un genere già usato non si cambia', 'err'); return; }
      const v = elenco.value.map((x) => ({ ...x }));
      let det;
      if (e.id == null) {
        const id = L.codiceObbligatorio ? cod : nuovoId(v);
        v.push({ id, nome, cod, attivo: e.attivo });
        det = `${L.titolo}: aggiunto «${nome}»`;
      } else {
        const x = v.find((y) => y.id === e.id);
        det = `${L.titolo}: ${[x.nome !== nome && `«${x.nome}» → «${nome}»`, x.cod !== cod && `${L.codice?.toLowerCase()} ${cod || '–'}`,
          x.attivo !== e.attivo && `«${nome}» ${e.attivo ? 'riattivato' : 'disattivato'}`].filter(Boolean).join('; ') || 'nessun cambiamento'}`;
        Object.assign(x, { nome, cod, attivo: e.attivo });
        if (L.codiceObbligatorio) x.id = cod;
      }
      await L.scrivi(v, det);
      ed.value = null;
      toast('Salvato');
    }
    async function elimina() {
      const e = ed.value;
      if (!confirm(`Eliminare «${e.nomePrima}»?`)) return;
      await L.scrivi(elenco.value.filter((x) => x.id !== e.id), `${L.titolo}: eliminato «${e.nomePrima}»`);
      ed.value = null;
    }
    async function sposta(i, d) {
      const v = elenco.value.map((x) => ({ ...x })), j = i + d;
      if (j < 0 || j >= v.length) return;
      [v[i], v[j]] = [v[j], v[i]];
      await L.scrivi(v, '');
    }
    return { mancante: false, L, q, limite, ed, elenco, visibili, usoDi, nuova, apri, salva, elimina, sposta, num, quanti };
  },
  template: `<div class="pagina" v-if="!mancante">
    <page-head :titolo="L.titolo" :sotto="elenco.length + ' voci'" indietro="#/">
      <button class="btn primario" @click="nuova"><ic n="plus"/> Aggiungi</button></page-head>
    <input v-if="elenco.length > 20" class="inp cerca" v-model="q" type="search" :placeholder="'Cerca ' + L.voce">
    <section class="card"><ul class="lista compatta">
      <li v-for="(x, i) in visibili.slice(0, limite)" :key="x.id" :class="{spenta: !x.attivo}" @click="apri(x)">
        <div class="grow"><b>{{ x.nome }} <i v-if="x.nuovo" class="tag-nuovo">nuovo</i><i v-if="!x.attivo" class="tag-off">disattivato</i></b>
          <small v-if="L.codice">{{ L.codice }} {{ x.cod || '–' }}</small></div>
        <small>{{ quanti(usoDi(x), L.unita) }}</small>
        <span v-if="L.ordinabile && !q" class="ord-btn" @click.stop>
          <button class="btn-ic" :disabled="i === 0" @click="sposta(i, -1)" aria-label="Su"><ic n="up" :s="18"/></button>
          <button class="btn-ic" :disabled="i === visibili.length - 1" @click="sposta(i, 1)" aria-label="Giù"><ic n="down" :s="18"/></button></span>
        <ic v-else n="next" :s="16"/></li>
      <li v-if="!visibili.length" class="vuoto">Nessuna voce.</li>
    </ul></section>
    <button v-if="visibili.length > limite" class="btn pieno" @click="limite += 200">Altri ({{ visibili.length - limite }})</button>
    <p v-if="L.nota" class="muted">{{ L.nota }}</p>

    <sheet v-if="ed" :titolo="ed.id == null ? 'Nuovo: ' + L.voce : L.titolo" @chiudi="ed = null">
      <div class="form">
        <label class="largo">Nome *<input class="inp" v-model="ed.nome"></label>
        <label v-if="L.codice" class="largo">{{ L.codice }}{{ L.codiceObbligatorio ? ' *' : ' (facoltativo)' }}<input class="inp mono" v-model="ed.cod"></label>
        <label v-if="!L.testi" class="largo check"><input type="checkbox" v-model="ed.attivo"> Attivo: si può scegliere nei nuovi ordini</label>
      </div>
      <p v-if="ed.id != null && usoDi(ed)" class="muted">Usato in {{ quanti(usoDi(ed), L.unita) }}<template v-if="!L.testi">: si può disattivare, non eliminare</template>.</p>
      <div class="azioni-pagina"><button class="btn primario" @click="salva"><ic n="check"/> Salva</button>
        <button class="btn" @click="ed = null">Annulla</button>
        <button v-if="ed.id != null && (L.testi || !usoDi(ed))" class="btn rosso" @click="elimina"><ic n="trash"/> Elimina</button></div>
    </sheet>
  </div>
  <div v-else class="pagina"><page-head titolo="Lista non trovata" indietro="#/"/></div>`,
};

// ---------------------------------------------------------------- regole
const GIORNI_POSSIBILI = [1, 5, 10, 15, 20, 25, 'fine'];
const giorniDaMostrare = (scelti) => [...new Set([...GIORNI_POSSIBILI, ...scelti])].sort((x, y) => (x === 'fine') - (y === 'fine') || x - y);
const MESI_OPZ = Array.from({ length: 24 }, (_, i) => i - 12);

function descriviRegole(a, b) {
  const d = [];
  for (const [k, n] of [...CAMPI_OBBLIGATORI.testata, ...CAMPI_OBBLIGATORI.articolo]) {
    if (a.obbligatori[k] !== b.obbligatori[k]) d.push(`${n}: ${b.obbligatori[k] ? 'obbligatorio' : 'facoltativo'}`);
  }
  if (a.minFoto !== b.minFoto) d.push(`foto minime ${b.minFoto}`);
  if (a.coloreInCodice !== b.coloreInCodice) d.push(`colore in fondo al codice: ${b.coloreInCodice ? 'sì' : 'no'}`);
  if (a.cartellino.limite !== b.cartellino.limite) d.push(`cartellino ${b.cartellino.limite} caratteri`);
  if (a.cartellino.campi.join() !== b.cartellino.campi.join()) d.push(`campi del cartellino: ${b.cartellino.campi.join(', ')}`);
  if (a.consegne.giorni.join() !== b.consegne.giorni.join()) d.push(`giorni di consegna: ${b.consegne.giorni.map(nomeGiorno).join(', ')}`);
  for (const [s, n] of [['I', 'A/I'], ['E', 'P/E']]) {
    if (a.consegne[s].da !== b.consegne[s].da || a.consegne[s].a !== b.consegne[s].a) {
      d.push(`consegna ${n}: ${nomeMeseRelativo(b.consegne[s].da)} – ${nomeMeseRelativo(b.consegne[s].a)}`);
    }
  }
  if (a.ritardoGiorni !== b.ritardoGiorni) d.push(`tolleranza ritardi ${b.ritardoGiorni} giorni`);
  if (a.sovrappFornitori !== b.sovrappFornitori) d.push(`avviso sovrapposizione da ${b.sovrappFornitori} fornitori`);
  return d.join('; ');
}

export const CfgRegole = {
  setup() {
    const c = reactive(JSON.parse(JSON.stringify(state.cfg)));
    const cambiato = computed(() => JSON.stringify(c) !== JSON.stringify(state.cfg));
    const toggleGiorno = (g) => {
      const v = c.consegne.giorni;
      if (v.includes(g)) { if (v.length > 1) c.consegne.giorni = v.filter((x) => x !== g); }
      else c.consegne.giorni = [...v, g].sort((x, y) => (x === 'fine') - (y === 'fine') || x - y);
    };
    const toggleCampo = (k) => {
      const v = c.cartellino.campi;
      c.cartellino.campi = v.includes(k) ? v.filter((x) => x !== k) : CAMPI_CARTELLINO.map(([x]) => x).filter((x) => x === k || v.includes(x));
    };
    // esempio sulla stagione di lavoro, con le regole non ancora salvate
    const esempio = computed(() => {
      const sk = state.imp.stagioneLavoro;
      if (!sk) return '';
      const anno = parseInt(sk.slice(0, 4), 10), s = sk.slice(4);
      const g = c.consegne.giorni.filter((x) => x !== 'fine').map(Number).sort((x, y) => x - y);
      if (c.consegne.giorni.includes('fine')) g.push('fine');
      const da = dataDiConsegna(meseRelativo(anno, c.consegne[s].da), g[0]);
      const a = dataDiConsegna(meseRelativo(anno, c.consegne[s].a), g[g.length - 1]);
      return `${stagioneNome(sk)}: consegna proposta dal ${dataConsegna(da)} al ${dataConsegna(a)}`;
    });
    async function salva() {
      for (const [s, n] of [['I', 'A/I'], ['E', 'P/E']]) {
        if (c.consegne[s].a < c.consegne[s].da) { toast(`Consegna ${n}: il mese finale viene prima di quello iniziale`, 'err'); return; }
      }
      const intero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
      if (!intero(c.minFoto, 0, 10) || !intero(c.cartellino.limite, 0, 2000) || !intero(c.ritardoGiorni, 0, 365) || !intero(c.sovrappFornitori, 1, 50)) {
        toast('Controlla i numeri: foto 0–10, cartellino 0–2000, ritardo 0–365 giorni, fornitori 1–50', 'err');
        return;
      }
      await salvaConfigurazione(c, descriviRegole(state.cfg, c) || 'regole salvate');
      toast('Regole salvate');
    }
    const annulla = () => Object.assign(c, JSON.parse(JSON.stringify(state.cfg)));
    // valori iniziali delle regole (liste di generi e motivi escluse)
    const iniziali = () => { const d = CFG_DEFAULT(); Object.assign(c, { ...d, generi: c.generi, problemi: c.problemi }); };
    return {
      c, cambiato, toggleGiorno, toggleCampo, esempio, salva, annulla, iniziali,
      CAMPI_OBBLIGATORI, CAMPI_FISSI, CAMPI_CARTELLINO, giorniDaMostrare, MESI_OPZ, nomeGiorno, nomeMeseRelativo,
    };
  },
  template: `<div class="pagina con-barra cfg">
    <page-head titolo="Regole dell'ordine" sotto="Valgono per i nuovi controlli: gli ordini già confermati non cambiano" indietro="#/"/>

    <section class="card">
      <div class="card-h"><h2>Campi obbligatori</h2><small class="muted">bloccano la conferma dell'ordine</small></div>
      <div class="col2">
        <div><h3>Testata</h3>
          <label v-for="n in CAMPI_FISSI.testata" :key="n" class="check fisso"><input type="checkbox" checked disabled> {{ n }} <small>sempre</small></label>
          <label v-for="[k, n] in CAMPI_OBBLIGATORI.testata" :key="k" class="check"><input type="checkbox" v-model="c.obbligatori[k]"> {{ n }}</label></div>
        <div><h3>Articolo</h3>
          <label v-for="n in CAMPI_FISSI.articolo" :key="n" class="check fisso"><input type="checkbox" checked disabled> {{ n }} <small>sempre</small></label>
          <label v-for="[k, n] in CAMPI_OBBLIGATORI.articolo" :key="k" class="check"><input type="checkbox" v-model="c.obbligatori[k]"> {{ n }}</label></div>
      </div>
      <div class="form sotto">
        <label>Foto minime per articolo<input class="inp" type="number" min="0" max="10" v-model.number="c.minFoto"><small class="aiuto">0 = facoltative</small></label>
        <label class="largo check"><input type="checkbox" v-model="c.coloreInCodice"> Il codice articolo termina con il colore, separato da uno spazio</label>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Cartellino e gestionale</h2><small class="muted">avviso, non blocca</small></div>
      <div class="form">
        <label>Limite di caratteri<input class="inp" type="number" min="0" v-model.number="c.cartellino.limite"><small class="aiuto">0 = nessun controllo</small></label>
        <div class="lbl-grp largo">Campi contati (somma)
          <div class="chips"><button v-for="[k, n] in CAMPI_CARTELLINO" :key="k" :class="{on: c.cartellino.campi.includes(k)}" @click="toggleCampo(k)">{{ n }}</button></div></div>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Consegne</h2></div>
      <div class="form">
        <div class="lbl-grp largo">Giorni ammessi per «consegna da» ed «entro»
          <div class="chips"><button v-for="g in giorniDaMostrare(c.consegne.giorni)" :key="g" :class="{on: c.consegne.giorni.includes(g)}" @click="toggleGiorno(g)">{{ nomeGiorno(g) }}</button></div></div>
        <label>A/I: dal mese<select class="inp" v-model.number="c.consegne.I.da"><option v-for="o in MESI_OPZ" :key="o" :value="o">{{ nomeMeseRelativo(o) }}</option></select></label>
        <label>A/I: al mese<select class="inp" v-model.number="c.consegne.I.a"><option v-for="o in MESI_OPZ" :key="o" :value="o">{{ nomeMeseRelativo(o) }}</option></select></label>
        <label>P/E: dal mese<select class="inp" v-model.number="c.consegne.E.da"><option v-for="o in MESI_OPZ" :key="o" :value="o">{{ nomeMeseRelativo(o) }}</option></select></label>
        <label>P/E: al mese<select class="inp" v-model.number="c.consegne.E.a"><option v-for="o in MESI_OPZ" :key="o" :value="o">{{ nomeMeseRelativo(o) }}</option></select></label>
        <p v-if="esempio" class="largo aiuto-ric">{{ esempio }}</p>
        <label>Tolleranza sui ritardi (giorni)<input class="inp" type="number" min="0" v-model.number="c.ritardoGiorni"></label>
      </div>
    </section>

    <section class="card">
      <div class="card-h"><h2>Avvisi al buyer</h2></div>
      <div class="form">
        <label class="largo">Avviso di sovrapposizione evidenziato da quanti fornitori della stessa sottocategoria
          <input class="inp" type="number" min="1" v-model.number="c.sovrappFornitori"></label>
      </div>
    </section>

    <div class="barra-salva">
      <span>{{ cambiato ? 'Modifiche non salvate' : 'Nessuna modifica' }}</span>
      <button class="btn" :disabled="!cambiato" @click="annulla">Annulla</button>
      <button class="btn" @click="iniziali">Valori iniziali</button>
      <button class="btn primario" :disabled="!cambiato" @click="salva"><ic n="check"/> Salva</button>
    </div>
  </div>`,
};
