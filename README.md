# WHITE.7 Buying – demo offline (versione 2)

Progressive Web App dimostrativa del software di buying per l'abbigliamento descritto in `Manuale_SW_Buying_definitivo.docx`. Gira interamente sul telefono o sull'iPad: dopo la prima apertura funziona anche in modalità aereo e non invia dati a nessun server.

- **Versione 2** (questa): https://ppcunisalento.github.io/white7-buying-demo-v2/
- **Versione 1** (mostrata al cliente il 15/10/2026, invariata): https://ppcunisalento.github.io/white7-buying-demo/

Le due versioni stanno sullo stesso dominio ma non si toccano: la v2 usa un archivio locale (`white7-buying-v2`), chiavi locali (`w7v2.`) e cache (`w7v2-…`) propri. Al primo avvio, se sullo stesso dispositivo e browser c'è l'archivio della v1, la v2 propone di riusarlo.

## Novità della versione 2 (dalla demo al cliente del 15/10/2026)

- Controlli bloccanti: società, stagione, fornitore; per l'articolo codice (colore in fondo dopo uno spazio), categoria, sottocategoria, genere, prezzo, quantità. Pagamento, consegna, sconti, colore e foto sono facoltativi; il pagamento è un campo libero con suggerimenti (anche "conto vendita").
- Foto facoltative, tre o più se si vuole (minimo regolabile in Altro).
- Ricezione merce per taglia: griglia con gli attesi per taglia, «Tutti» = esattamente l'ordinato; stati per articolo (conforme, da completare, eccedenza, taglie diverse); consegne in più tranche; chiusura con differenze da parte di chi riceve, con assunzione di responsabilità. Riceve solo il punto vendita; la logistica consulta.
- Distinte e notifiche con il dettaglio per taglia; differenze da verificare nei pannelli di amministrazione e logistica.
- Confronto stagioni: variazione sempre dalla stagione più vecchia alla più recente; confronto a parità di data. Budget per categoria, sottocategoria o brand.
- Avviso di sovrapposizione nella scheda articolo (quanto già comprato della stessa sottocategoria e colore, da quanti fornitori).
- Su iPad (schermi da 900 px) il riepilogo dell'ordine resta fisso a destra.

## Cosa contiene

- **Selettore di ruolo** in alto: Buyer, Amministrazione, Logistica, Punto vendita. Ogni ruolo ha il suo colore, il suo pannello e la sua casella in arrivo.
- **Buyer:** pannello con avvisi sulla stagione, ordini (testata, articoli, foto, griglie taglie, riepilogo per categoria), conferma con controlli bloccanti, trasmissione, ricerca con filtri, report per categoria e brand, confronto fra stagioni, export Excel con immagine principale.
- **Trasmissione:** crea un pacchetto per ogni destinatario. Logistica e punto vendita lo ricevono senza prezzi, sconti e pagamento.
- **Punto vendita:** ordini in arrivo con foto e note, ricezione merce per taglia, distinta parziale o totale con segnalazioni, chiusura con differenze.
- **Logistica:** consultazione di consegne attese, distinte dei negozi e differenze da verificare.
- **Amministrazione:** ordini ricevuti con dati economici, distinte con percentuale sull'ordinato in capi e valore.
- **Registro modifiche:** chi ha fatto cosa e quando, con i valori cambiati.

## Dati

L'app non contiene dati. Al primo avvio chiede l'archivio `seed_white7.json.gz`, generato da `script/genera_seed.py` a partire dagli Excel del database Access. Il file sta nella cartella `dati demo/` del progetto, fuori da questa cartella, e **non va mai pubblicato**.

Sul telefono l'archivio si carica dal selettore di file (app File, OneDrive, AirDrop). Dati, foto e trasmissioni restano in IndexedDB sul dispositivo. Da **Altro → Ripristina i dati demo originali** si torna allo stato iniziale.

## Struttura

| File | Contenuto |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js` | pagina, installazione, cache offline |
| `js/main.js` | avvio, router, barra dei ruoli |
| `js/db.js` | archivio (Dexie/IndexedDB), trasmissione, distinte, registro |
| `js/analisi.js` | ricerca, report, confronto stagioni, avvisi |
| `js/excel.js` | export Excel (ExcelJS) |
| `js/comp.js` | componenti comuni: foto, mirino, scelta fornitore, riepilogo |
| `js/views-*.js` | schermate per ruolo |
| `vendor/` | Vue 3.5.13, Dexie 4.0.10, ExcelJS 4.4.0 (copie locali, niente CDN) |

Non serve una fase di build: la cartella si pubblica così com'è.

## Sviluppo

```bash
python3 script/server_sviluppo.py
```

Il comando va lanciato dalla cartella del progetto. Poi si apre `http://127.0.0.1:8765/demo-pwa/?seed=../dati%20demo/seed_white7.json.gz`, che carica l'archivio senza selettore. In locale il service worker non si registra (si attiva aggiungendo `?sw`).

## Pubblicazione (GitHub Pages)

1. Incrementare `VERSIONE` in `sw.js` (prefisso `w7v2-`), altrimenti i dispositivi continuano a usare i file in cache.
2. `git push` sul remote `origin` (repository `white7-buying-demo-v2`). Il remote `v1` punta al repository della prima versione: non va più aggiornato.
3. Sul telefono: aprire l'indirizzo in Safari o Chrome, aggiungere alla schermata Home e caricare l'archivio **dall'app installata**. Su iPhone l'app installata e Safari hanno archivi separati.
