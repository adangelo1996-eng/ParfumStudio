const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { generateFormula, getIngredients } = require('./engine/formulaEngine');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

app.get('/api/ingredients', (_req, res) => {
  try {
    const data = getIngredients();
    res.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Errore nel caricamento ingredienti' });
  }
});

app.post('/api/formula/generate', (req, res) => {
  try {
    const input = req.body || {};
    if (!input.famiglia && !input.family) {
      return res.status(400).json({ ok: false, error: 'Famiglia olfattiva richiesta.' });
    }
    if (!input.concentrazione && !input.concentration) {
      return res.status(400).json({ ok: false, error: 'Concentrazione richiesta.' });
    }

    const formula = generateFormula(input);

    res.json({
      ok: true,
      data: {
        vol: formula.vol,
        concMl: formula.concMl,
        alcMl: formula.alcMl,
        items: formula.items,
        costs: formula.costs,
        summary: formula.summary,
        scores: formula.scores
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || 'Errore nella generazione formula.' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`ParfumStudio backend in ascolto su http://localhost:${port}`);
});

