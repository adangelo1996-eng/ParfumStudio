function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function computeSummaryByFam(items, vol, concMl) {
  const totalMl = concMl || items.reduce((s, i) => s + i.drops * 0.05, 0);
  const famMl = {};
  for (const i of items) {
    const ml = i.drops * 0.05;
    famMl[i.fam] = (famMl[i.fam] || 0) + ml;
  }
  const byFam = {};
  Object.keys(famMl).forEach(f => {
    byFam[f] = totalMl ? famMl[f] / totalMl : 0;
  });
  return { totalMl, byFam };
}

const DEFAULT_CONSTRAINTS = {
  maxSweetFracLowSweet: 0.25,
  maxSweetFracMidSweet: 0.4,
  maxSweetFracHighSweet: 0.7,
  maxGourmandFracBase: 0.5,
  maxPerIngredientFrac: 0.4,
  maxCostPerMl: null
};

function isFormulaValid(candidate, prefs, configOverride) {
  const cfg = { ...DEFAULT_CONSTRAINTS, ...(configOverride || {}) };
  const items = candidate.items || [];
  if (!items.length) return false;

  const totalMl = candidate.concMl || items.reduce((s, i) => s + i.drops * 0.05, 0);
  if (!totalMl) return false;

  for (const it of items) {
    const ml = it.drops * 0.05;
    const frac = ml / totalMl;
    if (frac > cfg.maxPerIngredientFrac) {
      return false;
    }
  }

  const { byFam } = computeSummaryByFam(items, candidate.vol, candidate.concMl);

  const sweetNorm = (prefs?.sweet ?? 50) / 100;
  const gourmandFrac = byFam['gourmand'] || 0;

  let maxSweetAllowed;
  if (sweetNorm < 0.33) maxSweetAllowed = cfg.maxSweetFracLowSweet;
  else if (sweetNorm < 0.66) maxSweetAllowed = cfg.maxSweetFracMidSweet;
  else maxSweetAllowed = cfg.maxSweetFracHighSweet;

  if (gourmandFrac > maxSweetAllowed) {
    return false;
  }

  if (gourmandFrac > cfg.maxGourmandFracBase) {
    const baseMl = items
      .filter(i => i.note === 'f')
      .reduce((s, i) => s + i.drops * 0.05, 0);
    if (baseMl / totalMl < 0.25) {
      return false;
    }
  }

  if (cfg.maxCostPerMl != null && candidate.costs && candidate.costs.cTot != null) {
    const costPerMl = candidate.costs.cTot / candidate.vol;
    if (costPerMl > cfg.maxCostPerMl) {
      return false;
    }
  }

  return true;
}

module.exports = {
  isFormulaValid
};

