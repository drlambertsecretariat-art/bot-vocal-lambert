// ============================================================
// BOT VOCAL — CABINET DU DOCTEUR LAMBERT
// Version 3 — finale
// ============================================================
const express = require('express');
const twilio = require('twilio');
const SibApiV3Sdk = require('sib-api-v3-sdk');
const VoiceResponse = twilio.twiml.VoiceResponse;
 
const app = express();
app.use(express.urlencoded({ extended: false }));
 
// ============================================================
// CONFIGURATION — via variables d'environnement Render
// ============================================================
const CONFIG = {
  email: process.env.EMAIL || 'drlambertsecretariat@gmail.com',
  brevoApiKey: process.env.BREVO_API_KEY,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
};
 
// Init Brevo
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = CONFIG.brevoApiKey;
const brevoApi = new SibApiV3Sdk.TransactionalEmailsApi();
 
const GARDE = '0320332033';
const DOCTOLIB = 'Doctolib, Docteur Lambert à Emmerin';
 
// ============================================================
// EMAIL
// ============================================================
async function envoyerEmail(appelant, motif, details, priorite, audioUrl = null) {
  const emojis = { URGENTE: '🔴', RAPPEL_J1: '🟠', RAPPEL_48H: '🟡', INFO: '🟢' };
  const labels = {
    URGENTE: 'URGENT — rappeler rapidement',
    RAPPEL_J1: 'Rappel demain matin',
    RAPPEL_48H: 'Rappel sous 48h',
    INFO: 'Pour information'
  };
  const emoji = emojis[priorite] || '⚪';
  const label = labels[priorite] || priorite;
  const heure = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const sujet = `${emoji} [${label.toUpperCase()}] ${motif} — ${appelant}`;
  const corps = `📞 APPEL REÇU — ${heure}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Numéro appelant : ${appelant}
Motif : ${motif}
Priorité : ${emoji} ${label}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DÉTAILS :
${details}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cabinet du Docteur Lambert — Emmerin (59320)
03 20 38 56 88`;
 
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.to = [{ email: CONFIG.email }];
  sendSmtpEmail.sender = { email: CONFIG.email, name: 'Bot Vocal Dr Lambert' };
  sendSmtpEmail.subject = sujet;
  sendSmtpEmail.textContent = corps;
 
  // Pièce jointe audio si disponible
  if (audioUrl) {
    try {
      const https = require('https');
      const audioBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const url = new URL(audioUrl + '.mp3');
        const options = {
          hostname: url.hostname,
          path: url.pathname,
          auth: `${CONFIG.twilioAccountSid}:${CONFIG.twilioAuthToken}`
        };
        https.get(options, (res) => {
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
      });
      sendSmtpEmail.attachment = [{
        name: `message-${Date.now()}.mp3`,
        content: audioBuffer.toString('base64')
      }];
    } catch (e) {
      console.error('Erreur récupération audio:', e.message);
    }
  }
 
  try {
    await brevoApi.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Email envoyé : ${sujet}`);
  } catch (err) {
    console.error('❌ Erreur Brevo :', err.message);
  }
}
 
// ============================================================
// HELPERS
// ============================================================
function say(twiml, texte, voice = 'Polly.Lea') {
  twiml.say({ language: 'fr-FR', voice }, texte);
}
 
// Collecte nom (enregistrement vocal court)
function collecterNom(twiml, redirectUrl) {
  say(twiml, 'Après le bip, dites votre prénom et votre nom, puis patientez.');
  twiml.record({
    action: redirectUrl,
    transcribe: true,
    transcribeCallback: redirectUrl.replace('/nom-', '/transcription-'),
    maxLength: 10,
    playBeep: true,
    trim: 'trim-silence'
  });
}
 
// Collecte numéro téléphone par touches + confirmation
function collecterTelephone(twiml, redirectUrl) {
  const gather = twiml.gather({
    input: 'dtmf',
    finishOnKey: '#',
    timeout: 15,
    action: redirectUrl
  });
  say(gather, 'Tapez votre numéro de téléphone suivi de la touche dièse.');
}
 
// Message de fin standard
function finStandard(twiml, appelant) {
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `/garde-info?appelant=${encodeURIComponent(appelant)}`
  });
  say(gather, `Nous vous rappelons dès que possible.
    Pour prendre rendez-vous maintenant, consultez ${DOCTOLIB}.
    Appuyez sur étoile pour le numéro du service de garde dentaire.
    Tapez zéro pour revenir au menu.
    Ou vous pouvez raccrocher. Au revoir.`);
  twiml.hangup();
}
 
// ============================================================
// ACCUEIL
// ============================================================
app.post('/entree', (req, res) => {
  const appelant = req.body.From || 'Numéro masqué';
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/menu?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Bonjour, cabinet du Docteur Lambert.
    Je suis Marie, votre assistante virtuelle.
    Pour une urgence, tapez 1.
    Pour un rendez-vous, tapez 2.
    Pour une question administrative, tapez 3.
    Pour nos informations pratiques, tapez 4.`);
  say(twiml, 'Nous n\'avons pas reçu votre choix. Au revoir.');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/menu', (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  const routes = { '1': '/urgence', '2': '/rdv', '3': '/administratif', '4': '/infos' };
  if (routes[digit]) twiml.redirect(`${routes[digit]}?appelant=${encodeURIComponent(appelant)}`);
  else { say(twiml, 'Choix non reconnu. Au revoir.'); twiml.hangup(); }
  res.type('text/xml').send(twiml.toString());
});
 
// ============================================================
// TOUCHE ÉTOILE → GARDE
// ============================================================
app.post('/garde-info', (req, res) => {
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  if (digit === '*') {
    say(twiml, `En semaine et le vendredi, de neuf heures à dix-sept heures,
      la Faculté dentaire de Lille, Centre Abel Caumartin, reçoit sans rendez-vous.
      Le dimanche et les jours fériés le matin,
      appelez le service de garde du Nord au zéro trois vingt, trente-trois, vingt, trente-trois.
      En cas de gonflement important ou d'infection,
      rapprochez-vous de votre médecin traitant ou appelez le quinze.
      Au revoir.`);
    twiml.hangup();
  } else if (digit === '0') {
    twiml.redirect('/entree');
  } else {
    twiml.hangup();
  }
  res.type('text/xml').send(twiml.toString());
});
 
// ============================================================
// SESSIONS EN MÉMOIRE (évite les URLs trop longues)
// ============================================================
const sessions = {};
 
function sauvegarderSession(appelant, data) {
  sessions[appelant] = { ...sessions[appelant], ...data, ts: Date.now() };
  // Nettoyer les sessions > 1h
  Object.keys(sessions).forEach(k => {
    if (Date.now() - sessions[k].ts > 3600000) delete sessions[k];
  });
}
 
function getSession(appelant) {
  return sessions[appelant] || {};
}
 
// ============================================================
// COLLECTE GÉNÉRIQUE : NOM → TÉLÉPHONE → FIN
// ============================================================
app.post('/collecter-nom', (req, res) => {
  const { appelant, motif, details, priorite } = req.query;
  const twiml = new VoiceResponse();
  sauvegarderSession(appelant, { motif, details, priorite });
  say(twiml, 'Après le bip, dites votre prénom et votre nom, puis patientez.');
  twiml.record({
    action: `/collecter-nom-enregistre?appelant=${encodeURIComponent(appelant)}`,
    transcribe: true,
    maxLength: 10,
    playBeep: true,
    trim: 'trim-silence'
  });
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/collecter-nom-enregistre', (req, res) => {
  const { appelant } = req.query;
  const recordingUrl = req.body.RecordingUrl || '';
  const twiml = new VoiceResponse();
  sauvegarderSession(appelant, { audio: recordingUrl });
  const gather = twiml.gather({
    input: 'dtmf',
    finishOnKey: '#',
    timeout: 15,
    action: `/collecter-tel?appelant=${encodeURIComponent(appelant)}`
  });
  say(gather, 'Tapez votre numéro de téléphone suivi de la touche dièse. Pour revenir au menu, tapez zéro.');
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/collecter-tel', (req, res) => {
  const { appelant } = req.query;
  const tel = req.body.Digits || '';
  const twiml = new VoiceResponse();
 
  if (tel === '0') {
    twiml.redirect('/entree');
    return res.type('text/xml').send(twiml.toString());
  }
 
  sauvegarderSession(appelant, { tel });
  const telLu = tel.split('').join(' ');
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `/collecter-tel-confirm?appelant=${encodeURIComponent(appelant)}`
  });
  say(gather, `Vous avez tapé le ${telLu}. Si c'est correct, tapez 1. Pour recommencer, tapez 2.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/collecter-tel-confirm', async (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  const session = getSession(appelant);
 
  if (digit === '2') {
    const gather = twiml.gather({
      input: 'dtmf',
      finishOnKey: '#',
      timeout: 15,
      action: `/collecter-tel?appelant=${encodeURIComponent(appelant)}`
    });
    say(gather, 'Tapez votre numéro de téléphone suivi de la touche dièse.');
    return res.type('text/xml').send(twiml.toString());
  }
 
  // Envoyer l'email
  const detailsFinal = `${session.details || ''}\n→ Numéro rappel : ${session.tel || 'non fourni'}`;
  await envoyerEmail(appelant, session.motif || 'Message', detailsFinal, session.priorite || 'RAPPEL_J1', session.audio || null);
 
  say(twiml, 'Votre message a bien été enregistré.');
  finStandard(twiml, appelant);
  res.type('text/xml').send(twiml.toString());
});
 
// ============================================================
// BRANCHE 1 : URGENCE
// ============================================================
app.post('/urgence', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/urgence-type?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Quel est le motif de votre urgence ?
    Pour une douleur dentaire, tapez 1.
    Pour un problème de couronne ou de prothèse, tapez 2.
    Pour un pansement perdu, tapez 3.
    Pour un choc ou traumatisme, tapez 4.
    Pour revenir au menu, tapez 0.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/urgence-type', (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  const routes = {
    '1': '/douleur-q1', '2': '/prothese',
    '3': '/pansement-q1', '4': '/choc-q1', '0': '/entree'
  };
  if (routes[digit]) twiml.redirect(`${routes[digit]}?appelant=${encodeURIComponent(appelant)}`);
  else { say(twiml, 'Choix non reconnu.'); twiml.redirect(`/urgence?appelant=${encodeURIComponent(appelant)}`); }
  res.type('text/xml').send(twiml.toString());
});
 
// ---- DOULEUR ----
app.post('/douleur-q1', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/douleur-q2?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `En cas de gonflement important du visage, de difficultés à avaler ou à respirer,
    appelez le quinze immédiatement ou rapprochez-vous de votre médecin traitant.
    La douleur est-elle très intense, insupportable ?
    Tapez 1 pour oui, tapez 2 pour non.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/douleur-q2', (req, res) => {
  const { appelant } = req.query;
  const intense = req.body.Digits === '1';
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/douleur-fin?appelant=${encodeURIComponent(appelant)}&intense=${intense}`,
    timeout: 8
  });
  say(gather, `La douleur est-elle déclenchée par le chaud ou le froid ?
    Tapez 1 pour oui, tapez 2 pour non.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/douleur-fin', (req, res) => {
  const { appelant, intense } = req.query;
  const chaudFroid = req.body.Digits === '1';
  const twiml = new VoiceResponse();
  const priorite = intense === 'true' ? 'URGENTE' : 'RAPPEL_J1';
  const details = `Type : Douleur\n→ Intense : ${intense === 'true' ? 'OUI' : 'Non'}\n→ Chaud/froid : ${chaudFroid ? 'Oui' : 'Non'}`;
  twiml.redirect(`/collecter-nom?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent('Urgence – Douleur dentaire')}&details=${encodeURIComponent(details)}&priorite=${priorite}`);
  res.type('text/xml').send(twiml.toString());
});
 
// ---- COURONNE / PROTHÈSE ----
app.post('/prothese', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/prothese-type?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Quel est le problème ?
    Pour une couronne tombée, tapez 1.
    Pour une prothèse qui blesse ou irrite, tapez 2.
    Pour une prothèse perdue, tapez 3.
    Pour une prothèse cassée, tapez 4.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/prothese-type', (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  if (digit === '1') {
    twiml.redirect(`/couronne-visible?appelant=${encodeURIComponent(appelant)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  const map = {
    '2': { motif: 'Urgence – Prothèse qui blesse', priorite: 'RAPPEL_48H' },
    '3': { motif: 'Urgence – Prothèse perdue', priorite: 'RAPPEL_J1' },
    '4': { motif: 'Urgence – Prothèse cassée', priorite: 'RAPPEL_J1' }
  };
  if (map[digit]) {
    const { motif, priorite } = map[digit];
    twiml.redirect(`/collecter-nom?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}&details=${encodeURIComponent('Type : ' + motif)}&priorite=${priorite}`);
  } else {
    say(twiml, 'Choix non reconnu.');
    twiml.redirect(`/prothese?appelant=${encodeURIComponent(appelant)}`);
  }
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/couronne-visible', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/couronne-fin?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `La couronne est-elle visible quand vous souriez, c'est-à-dire sur une dent du devant ?
    Tapez 1 pour oui, tapez 2 pour non.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/couronne-fin', (req, res) => {
  const { appelant } = req.query;
  const devant = req.body.Digits === '1';
  const twiml = new VoiceResponse();
  const priorite = devant ? 'RAPPEL_J1' : 'RAPPEL_48H';
  const details = `Type : Couronne tombée\n→ Dent visible (devant) : ${devant ? 'Oui' : 'Non'}`;
  twiml.redirect(`/collecter-nom?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent('Urgence – Couronne tombée')}&details=${encodeURIComponent(details)}&priorite=${priorite}`);
  res.type('text/xml').send(twiml.toString());
});
 
// ---- PANSEMENT PERDU ----
app.post('/pansement-q1', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/pansement-q2?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Ressentez-vous une douleur ? Tapez 1 pour oui, tapez 2 pour non.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/pansement-q2', (req, res) => {
  const { appelant } = req.query;
  const douleur = req.body.Digits === '1';
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/pansement-fin?appelant=${encodeURIComponent(appelant)}&douleur=${douleur}`,
    timeout: 8
  });
  say(gather, `Où se situe la dent ?
    Tapez 1 pour une dent du devant, tapez 2 pour une dent du fond.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/pansement-fin', (req, res) => {
  const { appelant, douleur } = req.query;
  const localisation = req.body.Digits === '1' ? 'devant' : 'fond de bouche';
  const twiml = new VoiceResponse();
  const priorite = douleur === 'true' ? 'RAPPEL_J1' : 'RAPPEL_48H';
  const details = `Type : Pansement perdu\n→ Douleur : ${douleur === 'true' ? 'Oui' : 'Non'}\n→ Localisation : ${localisation}`;
  twiml.redirect(`/collecter-nom?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent('Urgence – Pansement perdu')}&details=${encodeURIComponent(details)}&priorite=${priorite}`);
  res.type('text/xml').send(twiml.toString());
});
 
// ---- CHOC / TRAUMATISME ----
app.post('/choc-q1', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/choc-q2?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Y a-t-il eu une perte de conscience, des vomissements ou une somnolence inhabituelle ?
    Tapez 1 pour oui, tapez 2 pour non.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/choc-q2', async (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  if (req.body.Digits === '1') {
    await envoyerEmail(appelant, 'Urgence – Choc (signe neurologique)',
      'Perte de conscience / vomissements / somnolence : OUI → orienté SAMU 15', 'URGENTE');
    say(twiml, `Ces signes sont importants.
      Appelez le quinze ou rendez-vous aux urgences hospitalières immédiatement. Au revoir.`);
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  const gather = twiml.gather({
    numDigits: 1,
    action: `/choc-fin?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Y a-t-il une dent complètement sortie, ou un saignement qui ne s'arrête pas ?
    Tapez 1 pour oui, tapez 2 pour non.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/choc-fin', (req, res) => {
  const { appelant } = req.query;
  const grave = req.body.Digits === '1';
  const twiml = new VoiceResponse();
  const priorite = grave ? 'URGENTE' : 'RAPPEL_J1';
  const details = `Type : Choc/traumatisme\n→ Dent expulsée ou saignement persistant : ${grave ? 'OUI' : 'Non'}`;
  if (grave) {
    say(twiml, `En cas de dent complètement sortie, conservez-la dans du lait ou dans votre salive.
      En cas de saignement, mordez sur une compresse propre pendant vingt minutes.
      Si le saignement ne s'arrête pas, consultez les urgences.
      En cas de gonflement, rapprochez-vous de votre médecin traitant.`);
  } else {
    say(twiml, `Surveillez attentivement.
      En cas d'aggravation ou de gonflement, appelez le quinze ou votre médecin traitant.`);
  }
  twiml.redirect(`/collecter-nom?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent('Urgence – Choc/traumatisme')}&details=${encodeURIComponent(details)}&priorite=${priorite}`);
  res.type('text/xml').send(twiml.toString());
});
 
// ============================================================
// BRANCHE 2 : RENDEZ-VOUS
// ============================================================
app.post('/rdv', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/rdv-type?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Pour prendre un rendez-vous, tapez 1.
    Pour annuler ou modifier un rendez-vous, tapez 2.
    Pour revenir au menu, tapez 0.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-type', (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  if (digit === '0') { twiml.redirect('/entree'); return res.type('text/xml').send(twiml.toString()); }
  if (digit === '1') { twiml.redirect(`/rdv-motif?appelant=${encodeURIComponent(appelant)}`); }
  else if (digit === '2') { twiml.redirect(`/rdv-annuler?appelant=${encodeURIComponent(appelant)}`); }
  else { say(twiml, 'Choix non reconnu.'); twiml.redirect(`/rdv?appelant=${encodeURIComponent(appelant)}`); }
  res.type('text/xml').send(twiml.toString());
});
 
// Prise de RDV → motif
app.post('/rdv-motif', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/rdv-motif-choix?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Quel est le motif de votre rendez-vous ?
    Contrôle ou détartrage, tapez 1.
    Extraction dentaire, tapez 2.
    Soins dentaires, tapez 3.
    Prothèse dentaire, tapez 4.
    Parodontologie, tapez 5.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-motif-choix', (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  const motifs = {
    '1': 'Contrôle / détartrage',
    '2': 'Extraction dentaire',
    '3': 'Soins dentaires',
    '4': 'Prothèse dentaire',
    '5': 'Parodontologie'
  };
  const motif = motifs[digit] || 'Rendez-vous (motif non précisé)';
  // Collecter nom puis date/heure
  say(twiml, 'Après le bip, dites votre prénom et votre nom, puis patientez.');
  twiml.record({
    action: `/rdv-nom-enregistre?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}`,
    transcribe: true,
    transcribeCallback: `/rdv-transcription-nom?appelant=${encodeURIComponent(appelant)}`,
    maxLength: 10,
    playBeep: true,
    trim: 'trim-silence'
  });
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-nom-enregistre', (req, res) => {
  const { appelant, motif } = req.query;
  const audioNom = req.body.RecordingUrl || '';
  const twiml = new VoiceResponse();
  // Demander date/heure souhaitée
  say(twiml, 'Après le bip, indiquez la date et l\'heure souhaitées pour votre rendez-vous, puis patientez.');
  twiml.record({
    action: `/rdv-date-enregistre?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}&audioNom=${encodeURIComponent(audioNom)}`,
    transcribe: true,
    maxLength: 10,
    playBeep: true,
    trim: 'trim-silence'
  });
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-date-enregistre', (req, res) => {
  const { appelant, motif, audioNom } = req.query;
  const audioDate = req.body.RecordingUrl || '';
  const twiml = new VoiceResponse();
  // Collecter téléphone
  collecterTelephone(twiml, `/rdv-tel?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}&audioNom=${encodeURIComponent(audioNom)}&audioDate=${encodeURIComponent(audioDate)}`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-tel', (req, res) => {
  const { appelant, motif, audioNom, audioDate } = req.query;
  const tel = req.body.Digits || '';
  const twiml = new VoiceResponse();
  const telLu = tel.split('').join(' ');
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `/rdv-tel-confirm?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}&audioNom=${encodeURIComponent(audioNom)}&audioDate=${encodeURIComponent(audioDate)}&tel=${encodeURIComponent(tel)}`
  });
  say(gather, `Vous avez tapé le ${telLu}. Si c'est correct, tapez 1. Pour recommencer, tapez 2.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-tel-confirm', async (req, res) => {
  const { appelant, motif, audioNom, audioDate, tel } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  if (digit === '2') {
    collecterTelephone(twiml, `/rdv-tel?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}&audioNom=${encodeURIComponent(audioNom)}&audioDate=${encodeURIComponent(audioDate)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  const details = `Motif : ${decodeURIComponent(motif)}\n→ Numéro rappel : ${tel}\n→ Audio nom : ${decodeURIComponent(audioNom)}\n→ Audio date souhaitée : ${decodeURIComponent(audioDate)}`;
  await envoyerEmail(appelant, `Demande de RDV – ${decodeURIComponent(motif)}`, details, 'RAPPEL_J1', decodeURIComponent(audioNom));
  finStandard(twiml, appelant);
  res.type('text/xml').send(twiml.toString());
});
 
// Annulation RDV
app.post('/rdv-annuler', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  say(twiml, 'Après le bip, dites votre prénom et votre nom, puis patientez.');
  twiml.record({
    action: `/rdv-annuler-nom?appelant=${encodeURIComponent(appelant)}`,
    transcribe: true,
    maxLength: 10,
    playBeep: true,
    trim: 'trim-silence'
  });
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-annuler-nom', (req, res) => {
  const { appelant } = req.query;
  const audioNom = req.body.RecordingUrl || '';
  const twiml = new VoiceResponse();
  say(twiml, 'Après le bip, indiquez la date et l\'heure du rendez-vous à annuler, puis patientez.');
  twiml.record({
    action: `/rdv-annuler-date?appelant=${encodeURIComponent(appelant)}&audioNom=${encodeURIComponent(audioNom)}`,
    transcribe: true,
    maxLength: 10,
    playBeep: true,
    trim: 'trim-silence'
  });
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-annuler-date', (req, res) => {
  const { appelant, audioNom } = req.query;
  const audioDate = req.body.RecordingUrl || '';
  const twiml = new VoiceResponse();
  collecterTelephone(twiml, `/rdv-annuler-tel?appelant=${encodeURIComponent(appelant)}&audioNom=${encodeURIComponent(audioNom)}&audioDate=${encodeURIComponent(audioDate)}`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-annuler-tel', (req, res) => {
  const { appelant, audioNom, audioDate } = req.query;
  const tel = req.body.Digits || '';
  const twiml = new VoiceResponse();
  const telLu = tel.split('').join(' ');
  const gather = twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `/rdv-annuler-confirm?appelant=${encodeURIComponent(appelant)}&audioNom=${encodeURIComponent(audioNom)}&audioDate=${encodeURIComponent(audioDate)}&tel=${encodeURIComponent(tel)}`
  });
  say(gather, `Vous avez tapé le ${telLu}. Si c'est correct, tapez 1. Pour recommencer, tapez 2.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/rdv-annuler-confirm', async (req, res) => {
  const { appelant, audioNom, audioDate, tel } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  if (digit === '2') {
    collecterTelephone(twiml, `/rdv-annuler-tel?appelant=${encodeURIComponent(appelant)}&audioNom=${encodeURIComponent(audioNom)}&audioDate=${encodeURIComponent(audioDate)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  const details = `→ Numéro rappel : ${tel}\n→ Audio nom : ${decodeURIComponent(audioNom)}\n→ Audio date RDV à annuler : ${decodeURIComponent(audioDate)}`;
  await envoyerEmail(appelant, 'Annulation / modification RDV', details, 'RAPPEL_J1', decodeURIComponent(audioNom));
  finStandard(twiml, appelant);
  res.type('text/xml').send(twiml.toString());
});
 
// Transcription callback générique
app.post('/rdv-transcription-nom', (req, res) => { res.sendStatus(200); });
 
// ============================================================
// BRANCHE 3 : ADMINISTRATIF
// ============================================================
app.post('/administratif', (req, res) => {
  const { appelant } = req.query;
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: `/admin-type?appelant=${encodeURIComponent(appelant)}`,
    timeout: 8
  });
  say(gather, `Votre demande concerne :
    Une facture ou un reçu, tapez 1.
    Un dossier médical, tapez 2.
    Un devis ou une prise en charge mutuelle, tapez 3.
    Un chèque non encaissé, tapez 4.
    Autre demande, tapez 5.
    Pour revenir au menu, tapez 0.`);
  res.type('text/xml').send(twiml.toString());
});
 
app.post('/admin-type', (req, res) => {
  const { appelant } = req.query;
  const digit = req.body.Digits;
  const twiml = new VoiceResponse();
  if (digit === '0') { twiml.redirect('/entree'); return res.type('text/xml').send(twiml.toString()); }
  const motifs = {
    '1': 'Demande de facture / reçu',
    '2': 'Demande de dossier médical',
    '3': 'Devis / prise en charge mutuelle',
    '4': 'Chèque non encaissé',
    '5': 'Autre demande administrative'
  };
  const motif = motifs[digit];
  if (motif) {
    say(twiml, 'Votre demande a bien été enregistrée. Nous la traitons dans les meilleurs délais.');
    twiml.redirect(`/collecter-nom?appelant=${encodeURIComponent(appelant)}&motif=${encodeURIComponent(motif)}&details=${encodeURIComponent('Demande reçue. Traitement sous 48h.')}&priorite=RAPPEL_48H`);
  } else {
    say(twiml, 'Choix non reconnu.');
    twiml.redirect(`/administratif?appelant=${encodeURIComponent(appelant)}`);
  }
  res.type('text/xml').send(twiml.toString());
});
 
// ============================================================
// BRANCHE 4 : INFOS PRATIQUES
// ============================================================
app.post('/infos', (req, res) => {
  const twiml = new VoiceResponse();
  say(twiml, `Cabinet du Docteur Lambert, Emmerin, cinq neuf trois deux zéro.
    Téléphone : zéro trois, vingt, trente-huit, cinquante-six, quatre-vingt-huit.
    Horaires : du lundi au jeudi, de neuf heures à dix-huit heures.
    Fermé le vendredi, les week-ends et les jours fériés.
    Cabinet de plain-pied, accessible aux personnes à mobilité réduite.
    Stationnement : parking sept places à proximité, et rue Auguste Potié.
    Paiement : carte bancaire, chèque et espèces.
    Cabinet conventionné. Tiers payant Sécu accepté.
    Bilan bucco-dentaire trois à vingt-quatre ans : pris en charge à cent pour cent.
    Rendez-vous sur ${DOCTOLIB}.
    En dehors des horaires : en semaine et le vendredi de neuf heures à dix-sept heures,
    la Faculté dentaire de Lille, Centre Abel Caumartin, reçoit sans rendez-vous.
    Le dimanche et les jours fériés le matin,
    service de garde du Nord : zéro trois vingt, trente-trois, vingt, trente-trois.
    En cas de gonflement ou d'infection, rapprochez-vous de votre médecin traitant.
    Bonne journée. Au revoir.`);
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});
 
// ============================================================
// DÉMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Bot vocal Dr Lambert démarré sur le port ${PORT}`));
module.exports = app;
