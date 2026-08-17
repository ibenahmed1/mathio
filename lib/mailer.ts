import nodemailer from 'nodemailer';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
  });
}

// Retourne false si le SMTP n'est pas configuré (dev sans .env rempli) : dans
// ce cas l'appelant doit quand même répondre succès côté API (RG-12) et
// l'admin reste le recours via la réinitialisation manuelle.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[mailer] SMTP non configuré (SMTP_HOST/PORT/USER/PASS) — email non envoyé.', { to, resetUrl });
    return false;
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Réinitialisation de votre mot de passe',
    text: `Pour réinitialiser votre mot de passe, ouvrez ce lien (valable 30 minutes) : ${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
    html: `<p>Pour réinitialiser votre mot de passe, cliquez sur ce lien (valable 30 minutes) :</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
  });
  return true;
}
