const fs = require('fs');
const path = require('path');

const modelPath = path.join(__dirname, '../../model/model.json');

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    throw new Error('CSV vuoto o con solo intestazione.');
  }
  const header = lines[0].split(',');
  const idx = {};
  header.forEach((h, i) => {
    idx[h.trim()] = i;
  });

  const requiredCols = [
    'split',
    'formula_name',
    'weight_percent',
    'olfactive_family',
    'longevity_hours',
    'sillage_rating'
  ];
  for (const c of requiredCols) {
    if (!(c in idx)) {
      throw new Error(`Colonna richiesta mancante nel CSV: ${c}`);
    }
  }

  const formulas = new Map();

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    const cols = line.split(',');
    if (cols.length !== header.length) continue;

    const split = cols[idx['split']];
    if (split !== 'train') continue;

    const name = cols[idx['formula_name']];
    const wp = parseFloat(cols[idx['weight_percent']]) || 0;
    const fam = cols[idx['olfactive_family']].toLowerCase();
    const longevity = parseFloat(cols[idx['longevity_hours']]) || 0;
    const sillage = parseFloat(cols[idx['sillage_rating']]) || 0;

    if (!formulas.has(name)) {
      formulas.set(name, {
        total: 0,
        top: 0,
        heart: 0,
        base: 0,
        sweet: 0,
        fresh: 0,
        deep: 0,
        longevity,
        sillage
      });
    }
    const f = formulas.get(name);

    f.total += wp;

    if (fam.startsWith('top ')) f.top += wp;
    else if (fam.startsWith('heart ')) f.heart += wp;
    else if (fam.startsWith('base ') || fam.startsWith('fixative ')) f.base += wp;

    if (fam.includes('gourmand') || fam.includes('amber') || fam.includes('vanil') || fam.includes('sweet'))
      f.sweet += wp;
    if (fam.includes('citrus') || fam.includes('green') || fam.includes('marine') || fam.includes('ozonic'))
      f.fresh += wp;
    if (
      fam.includes('woody') ||
      fam.includes('oriental') ||
      fam.includes('musk') ||
      fam.includes('resin') ||
      fam.includes('leather')
    )
      f.deep += wp;
  }

  const featureRows = [];
  const targets = [];
  let maxLon = 0;
  let maxSil = 0;

  for (const [, f] of formulas) {
    if (!f.total) continue;
    const total = f.total;
    const topFrac = f.top / total;
    const heartFrac = f.heart / total;
    const baseFrac = f.base / total;
    const sweetFamFrac = f.sweet / total;
    const freshFamFrac = f.fresh / total;
    const deepFamFrac = f.deep / total;

    featureRows.push([topFrac, heartFrac, baseFrac, sweetFamFrac, freshFamFrac, deepFamFrac]);
    targets.push({ longevity: f.longevity, sillage: f.sillage });
    if (f.longevity > maxLon) maxLon = f.longevity;
    if (f.sillage > maxSil) maxSil = f.sillage;
  }

  return { featureRows, targets, maxLon, maxSil };
}

function trainLinear(featureRows, targets, maxLon, maxSil) {
  const n = featureRows.length;
  if (!n) throw new Error('Nessuna formula valida trovata nel CSV per il training.');
  const d = featureRows[0].length;

  const X = featureRows;
  const y = targets.map(t => {
    const ln = maxLon ? t.longevity / maxLon : 0;
    const sl = maxSil ? t.sillage / maxSil : 0;
    return 0.5 * ln + 0.5 * sl;
  });

  let w = new Array(d).fill(0);
  let b = 0;
  const lr = 0.05;
  const epochs = 800;

  for (let ep = 0; ep < epochs; ep++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let pred = b;
      for (let j = 0; j < d; j++) pred += w[j] * xi[j];
      const err = pred - y[i];
      gradB += err;
      for (let j = 0; j < d; j++) {
        gradW[j] += err * xi[j];
      }
    }

    gradB /= n;
    for (let j = 0; j < d; j++) gradW[j] /= n;

    b -= lr * gradB;
    for (let j = 0; j < d; j++) {
      w[j] -= lr * gradW[j];
    }
  }

  return { w, b };
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Uso: node src/train/trainModelFromCsv.js /percorso/al/file.csv');
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`File CSV non trovato: ${csvPath}`);
    process.exit(1);
  }

  console.log('Carico CSV e preparo feature...');
  const { featureRows, targets, maxLon, maxSil } = parseCsv(csvPath);
  console.log(`Formule per il training: ${featureRows.length}`);

  console.log('Alleno modello lineare sulle feature di equilibrio...');
  const { w, b } = trainLinear(featureRows, targets, maxLon, maxSil);

  const featureKeys = [
    'topFrac',
    'heartFrac',
    'baseFrac',
    'sweetFamFrac',
    'freshFamFrac',
    'deepFamFrac'
  ];

  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  model.weights = model.weights || {};
  featureKeys.forEach((k, i) => {
    model.weights[k] = w[i];
  });
  model.bias = b;
  model.training_meta = {
    source: path.basename(csvPath),
    updatedAt: new Date().toISOString(),
    maxLongevity: maxLon,
    maxSillage: maxSil,
    samples: featureRows.length
  };

  fs.writeFileSync(modelPath, JSON.stringify(model, null, 2), 'utf8');
  console.log('Modello aggiornato in', modelPath);
}

if (require.main === module) {
  main();
}

