const nodemailer = require('nodemailer');

async function sendFormulaEmail({ formula, meta }) {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    LAB_EMAIL_TO,
    LAB_EMAIL_FROM
  } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !LAB_EMAIL_TO || !LAB_EMAIL_FROM) {
    throw new Error(
      'Configurazione email laboratorio mancante (SMTP_HOST, SMTP_PORT, LAB_EMAIL_FROM, LAB_EMAIL_TO).'
    );
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth:
      SMTP_USER && SMTP_PASS
        ? {
            user: SMTP_USER,
            pass: SMTP_PASS
          }
        : undefined
  });

  const name = meta?.name || 'Profumo senza nome';
  const createdAt = meta?.createdAt || new Date().toISOString();
  const volumeMl = meta?.volumeMl || formula.vol;
  const conc = meta?.conc || meta?.concentrazione || 'edp';

  const lines = [];
  lines.push(`Nuova formula generata con Parfum Studio`);
  lines.push('');
  lines.push(`Nome: ${name}`);
  lines.push(`Data creazione: ${createdAt}`);
  lines.push(`Volume finale: ${volumeMl} ml`);
  lines.push(`Concentrazione: ${conc}`);
  lines.push('');
  lines.push(`Ingredienti:`);
  for (const i of formula.items || []) {
    lines.push(
      `- ${i.n} | ${i.drops} gc | ${i.gr.toFixed(2)} g | diluizione ${Math.round(
        i.dil * 100
      )}% | % pura finale ${i.purePct.toFixed(3)}% | IFRA ${
        i.ifra != null ? i.ifra + '%' : 'ND'
      }`
    );
  }
  lines.push('');
  if (formula.costs) {
    lines.push(
      `Costi stimati: concentrato €${formula.costs.cConc.toFixed(
        2
      )}, alcol €${formula.costs.cAlc.toFixed(2)}, totale €${formula.costs.cTot.toFixed(2)}`
    );
  }

  const text = lines.join('\n');

  await transporter.sendMail({
    from: LAB_EMAIL_FROM,
    to: LAB_EMAIL_TO,
    subject: `Nuova formula Parfum Studio - ${name}`,
    text
  });
}

module.exports = {
  sendFormulaEmail
};

