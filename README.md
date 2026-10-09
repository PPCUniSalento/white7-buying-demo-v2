# WHITE.7 Buying – demo offline

Progressive Web App dimostrativa del software di buying per l'abbigliamento descritto in `Manuale_SW_Buying_definitivo.docx`. Gira interamente sul telefono: dopo la prima apertura funziona anche in modalità aereo e non invia dati a nessun server.

## Cosa contiene

- **Selettore di ruolo** in alto: Buyer, Amministrazione, Logistica, Punto vendita. Ogni ruolo ha il suo colore, il suo pannello e la sua casella in arrivo.
- **Buyer:** pannello con avvisi sulla stagione, ordini (testata, articoli, foto, griglie taglie, riepilogo per categoria), conferma con controlli bloccanti, trasmissione, ricerca con filtri, report per categoria e brand, confronto fra stagioni, export Excel con immagine principale.
- **Trasmissione:** crea un pacchetto per ogni destinatario. Logistica e punto vendita lo ricevono senza prezzi, sconti e pagamento.
- **Logistica e punto vendita:** ordini in arrivo con foto e note, ricezione merce, distinta parziale o totale con segnalazioni.
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

1. Incrementare `VERSIONE` in `sw.js`, altrimenti i telefoni continuano a usare i file in cache.
2. Pubblicare il contenuto di questa cartella nel repository usato da GitHub Pages.
3. Sul telefono: aprire l'indirizzo in Safari o Chrome, aggiungere alla schermata Home e caricare l'archivio **dall'app installata**. Su iPhone l'app installata e Safari hanno archivi separati.
