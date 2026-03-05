const fs = require('fs');
const path = require('path');

const ingredientsPath = path.join(__dirname, '../../data/ingredients.json');
const pricingPath = path.join(__dirname, '../../data/pricing.json');
const modelPath = path.join(__dirname, '../../model/model.json');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const INGREDIENTS = loadJson(ingredientsPath);
const PRICING = loadJson(pricingPath);
const MODEL = loadJson(modelPath);

function getPricingMap() {
  const map = new Map();
  for (const p of PRICING.ingredients) {
    map.set(p.id, p.prezzoPer10ml);
  }
  return map;
}

const PRICE_MAP = getPricingMap();

function getConcPct(conc) {
  if (conc === 'edc') return 5;
  if (conc === 'edt') return 10;
  return 17;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function combinations(arr, k) {
  const res = [];
  const n = arr.length;
  if (k > n || k <= 0) return res;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    res.push(idx.map(i => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) {
      idx[j] = idx[j - 1] + 1;
    }
  }
  return res;
}

function baseNoteTargets(depth) {
  const tBase = 0.3;
  const hBase = 0.4;
  const fBase = 0.3;
  const depthNorm = depth / 100;
  const f = clamp(fBase + 0.1 * (depthNorm - 0.5), 0.25, 0.4);
  const t = clamp(tBase - 0.05 * (depthNorm - 0.5), 0.2, 0.35);
  const h = clamp(1 - t - f, 0.3, 0.5);
  return { t, c: h, f };
}

function ingredientBaseScore(ing, prefs) {
  let score = 0;
  if (ing.fam === prefs.family) score += 2;

  const sweetNorm = prefs.sweet / 100;
  const freshNorm = prefs.fresh / 100;
  const depthNorm = prefs.depth / 100;

  const name = ing.n.toLowerCase();
  const isSweet = ing.fam === 'gourmand' || name.includes('vanill') || name.includes('cumar');
  const isFresh = ing.fam === 'agrumato' || ing.fam === 'marino';
  const isDeep = ing.fam === 'legnoso' || ing.fam === 'orientale';

  if (isSweet) score += 2 * sweetNorm;
  if (isFresh) score += 2 * freshNorm;
  if (isDeep) score += 2 * depthNorm;

  if (ing.note === 't') score += 0.5 * freshNorm;
  if (ing.note === 'f') score += 0.5 * depthNorm;

  if (ing.ifra && ing.ifra < 0.1) score -= 1;

  score += ing.w / 10;
  return score;
}

function scoreFormulaEquilibrio(summary, prefs, targets) {
  const { topFrac, heartFrac, baseFrac, sweetFamFrac, freshFamFrac, deepFamFrac } = summary;
  const { t: tTarget, c: hTarget, f: fTarget } = targets;

  const dt = Math.abs(topFrac - tTarget);
  const dh = Math.abs(heartFrac - hTarget);
  const df = Math.abs(baseFrac - fTarget);
  const balanceScore = 1 - clamp((dt + dh + df) / 1.5, 0, 1);

  const sweetNorm = prefs.sweet / 100;
  const freshNorm = prefs.fresh / 100;
  const depthNorm = prefs.depth / 100;

  const sweetScore = 1 - Math.abs(sweetFamFrac - sweetNorm);
  const freshScore = 1 - Math.abs(freshFamFrac - freshNorm);
  const depthScore = 1 - Math.abs(deepFamFrac - depthNorm);

  const avgStyle = (sweetScore + freshScore + depthScore) / 3;

  return 0.6 * balanceScore + 0.4 * avgStyle;
}

function scoreML(summary, prefs) {
  const sweetNorm = prefs.sweet / 100;
  const freshNorm = prefs.fresh / 100;
  const depthNorm = prefs.depth / 100;

  const features = {
    topFrac: summary.topFrac,
    heartFrac: summary.heartFrac,
    baseFrac: summary.baseFrac,
    sweetSlider: sweetNorm,
    freshSlider: freshNorm,
    depthSlider: depthNorm,
    sweetFamFrac: summary.sweetFamFrac,
    freshFamFrac: summary.freshFamFrac,
    deepFamFrac: summary.deepFamFrac
  };

  let s = MODEL.bias || 0;
  for (const [k, w] of Object.entries(MODEL.weights)) {
    s += (features[k] || 0) * w;
  }
  return s;
}

function buildSummary(items, concMl) {
  const totalMl = concMl;
  let topMl = 0;
  let heartMl = 0;
  let baseMl = 0;
  let sweetMl = 0;
  let freshMl = 0;
  let deepMl = 0;

  for (const i of items) {
    const ml = i.drops * 0.05;
    if (i.note === 't') topMl += ml;
    if (i.note === 'c') heartMl += ml;
    if (i.note === 'f') baseMl += ml;
    if (i.fam === 'gourmand') sweetMl += ml;
    if (i.fam === 'agrumato' || i.fam === 'marino') freshMl += ml;
    if (i.fam === 'legnoso' || i.fam === 'orientale') deepMl += ml;
  }

  const safeDiv = (a, b) => (b > 0 ? a / b : 0);

  return {
    topFrac: safeDiv(topMl, totalMl),
    heartFrac: safeDiv(heartMl, totalMl),
    baseFrac: safeDiv(baseMl, totalMl),
    sweetFamFrac: safeDiv(sweetMl, totalMl),
    freshFamFrac: safeDiv(freshMl, totalMl),
    deepFamFrac: safeDiv(deepMl, totalMl)
  };
}

function applyIfraAndCosts(ings, vol, concMl) {
  const alcoholPricePerMl = PRICING.alcohol.pricePerMl;
  const dropsPerMl = 20;
  const F = [];

  for (const ing of ings) {
    let drops = ing._rawDrops;
    let tara = false;

    if (ing.ifra != null) {
      const maxDrops = Math.floor((ing.ifra * vol) / (5 * ing.dil));
      if (drops > maxDrops) {
        drops = maxDrops;
        tara = true;
      }
    }

    const gr = drops * 0.05;
    const prezzoPer10ml = PRICE_MAP.get(ing.id) ?? ing.p;
    const pricePerMl = prezzoPer10ml / 10;
    const cost = pricePerMl * gr;
    const purePct = (drops * 0.05 * ing.dil * 100) / vol;

    F.push({
      ...ing,
      drops,
      gr,
      cost,
      tara,
      purePct
    });
  }

  const alcMl = vol - concMl;
  const cAlc = alcMl * alcoholPricePerMl;
  const cConc = F.reduce((sum, i) => sum + i.cost, 0);

  return {
    items: F,
    cAlc,
    cConc,
    cTot: cAlc + cConc
  };
}

function generateFormula(input) {
  const volume = input.volumeMl || 50;
  const concKey = input.concentrazione || input.concentration || 'edp';
  const concPct = getConcPct(concKey);
  const concMl = (volume * concPct) / 100;

  const prefs = {
    family: input.famiglia || input.family,
    sweet: typeof input.sweet === 'number' ? input.sweet : 50,
    fresh: typeof input.fresh === 'number' ? input.fresh : 50,
    depth: typeof input.depth === 'number' ? input.depth : 50
  };

  const pool = INGREDIENTS.filter(
    x =>
      x.fam === prefs.family ||
      x.fam === 'floreale' ||
      x.fam === 'legnoso' ||
      x.fam === 'gourmand'
  );

  const scored = pool
    .map(ing => ({ ...ing, _score: ingredientBaseScore(ing, prefs) }))
    .sort((a, b) => b._score - a._score);

  const topPool = scored.filter(i => i.note === 't');
  const heartPool = scored.filter(i => i.note === 'c');
  const basePool = scored.filter(i => i.note === 'f');

  const topCount = 3;
  const heartCount = 3;
  const baseCount = 3;

  const topCandidates = topPool.slice(0, 4);
  const heartCandidates = heartPool.slice(0, 4);
  const baseCandidates = basePool.slice(0, 4);

  const topCombos = combinations(topCandidates, Math.min(topCount, topCandidates.length)) || [];
  const heartCombos =
    combinations(heartCandidates, Math.min(heartCount, heartCandidates.length)) || [];
  const baseCombos =
    combinations(baseCandidates, Math.min(baseCount, baseCandidates.length)) || [];

  if (!topCombos.length || !heartCombos.length || !baseCombos.length) {
    throw new Error('Ingredienti insufficienti per generare una formula equilibrata.');
  }

  const targets = baseNoteTargets(prefs.depth);
  let best = null;

  for (const tCombo of topCombos) {
    for (const hCombo of heartCombos) {
      for (const bCombo of baseCombos) {
        const all = [...tCombo, ...hCombo, ...bCombo];

        const sweetNorm = prefs.sweet / 100;
        const freshNorm = prefs.fresh / 100;
        const depthNorm = prefs.depth / 100;

        const adjusted = all.map(ing => {
          let w = ing.w;
          if (ing.fam === 'gourmand') w *= 1 + 0.4 * (sweetNorm - 0.5);
          if (ing.fam === 'agrumato' || ing.fam === 'marino') w *= 1 + 0.4 * (freshNorm - 0.5);
          if (ing.fam === 'legnoso' || ing.fam === 'orientale') w *= 1 + 0.4 * (depthNorm - 0.5);
          return { ...ing, _adjW: w };
        });

        const totW = adjusted.reduce((s, i) => s + i._adjW, 0);
        const mlPerW = concMl / (totW || 1);

        const withDrops = adjusted.map(i => ({
          ...i,
          _rawDrops: Math.round(i._adjW * mlPerW * 20)
        }));

        const applied = applyIfraAndCosts(withDrops, volume, concMl);
        const summary = buildSummary(applied.items, concMl);
        const scoreEq = scoreFormulaEquilibrio(summary, prefs, targets);
        const scoreM = scoreML(summary, prefs);
        const combinedScore = scoreEq * 0.6 + scoreM * 0.4;

        const candidate = {
          vol: volume,
          concMl,
          alcMl: volume - concMl,
          items: applied.items,
          costs: {
            cAlc: applied.cAlc,
            cConc: applied.cConc,
            cTot: applied.cTot
          },
          summary,
          scores: {
            equilibrio: scoreEq,
            ml: scoreM,
            total: combinedScore
          }
        };

        if (!best || candidate.scores.total > best.scores.total) {
          best = candidate;
        }
      }
    }
  }

  if (!best) {
    throw new Error('Nessuna formula valida trovata.');
  }

  return best;
}

function getIngredients() {
  return INGREDIENTS;
}

module.exports = {
  generateFormula,
  getIngredients
};

