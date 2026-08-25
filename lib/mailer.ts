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

// Invitation d'un membre du back-office (§ /admin/tasks, gestion des pôles).
// Le lien pointe vers /reinitialiser-mot-de-passe du domaine ops : c'est le
// SEUL hôte où le cookie de session admin peut être posé, donc le seul où
// l'invité pourra ensuite se connecter. Même contrat de retour que
// sendPasswordResetEmail : `false` quand le SMTP n'est pas configuré, à charge
// de l'appelant de proposer le lien à copier à la main.
export async function sendInvitationEmail(
  to: string,
  nomComplet: string,
  activationUrl: string,
  equipeNom: string
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[mailer] SMTP non configuré (SMTP_HOST/PORT/USER/PASS) — invitation non envoyée.', {
      to,
      activationUrl,
    });
    return false;
  }

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `Votre accès à l'espace de travail — pôle ${equipeNom}`,
    text: `Bonjour ${nomComplet},\n\nUn compte vient d'être créé pour vous sur le pôle « ${equipeNom} ».\nChoisissez votre mot de passe via ce lien (valable 7 jours) : ${activationUrl}\n\nVous vous connecterez ensuite avec cet email sur la même adresse.`,
    html: `<p>Bonjour ${nomComplet},</p><p>Un compte vient d'être créé pour vous sur le pôle « ${equipeNom} ».</p><p>Choisissez votre mot de passe via ce lien (valable 7 jours) :</p><p><a href="${activationUrl}">${activationUrl}</a></p><p>Vous vous connecterez ensuite avec cet email sur la même adresse.</p>`,
  });
  return true;
}
