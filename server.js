import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import helmet from "helmet";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Validate required environment ──
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "\n  ANTHROPIC_API_KEY manquante — le chat ne fonctionnera pas sans cle API."
  );
  console.warn("  Lance avec : ANTHROPIC_API_KEY=sk-... node server.js\n");
}

const app = express();

// ── Trust proxy (for rate limiting behind reverse proxy) ──
app.set("trust proxy", 1);

// ── Body parser with size limit ──
app.use(express.json({ limit: "10kb" }));

// ── Security headers (helmet) ──
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);

// ── Static files (no cache on HTML for instant updates) ──
app.use(express.static(join(__dirname, "public"), {
  setHeaders: (res, path) => {
    if (path.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  }
}));

// ── In-memory rate limiting ──
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window
const RATE_LIMIT_CLEANUP_INTERVAL = 5 * 60_000; // cleanup every 5 min

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res
      .status(429)
      .json({ error: "Trop de requetes, reessaie dans une minute." });
  }
  next();
}

// Periodic cleanup of expired rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.start > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_CLEANUP_INTERVAL);

// ── Session persistence ──
const DATA_DIR = join(__dirname, "data");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
const SESSION_MAX_AGE = 7 * 24 * 60 * 60_000; // 7 days
const SESSION_CLEANUP_INTERVAL = 30 * 60_000; // cleanup every 30 min
const SAVE_INTERVAL = 60_000; // auto-save every 60s

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Load sessions from disk
const conversationHistories = new Map();
try {
  if (existsSync(SESSIONS_FILE)) {
    const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
    const now = Date.now();
    for (const [sid, session] of Object.entries(data)) {
      if (now - session.lastActivity < SESSION_MAX_AGE) {
        conversationHistories.set(sid, session);
      }
    }
    console.error(`[numa] ${conversationHistories.size} sessions restaurees depuis le disque.`);
  }
} catch (e) {
  console.error("[numa] Erreur chargement sessions:", e.message);
}

// Save sessions to disk
function saveSessions() {
  try {
    const obj = Object.fromEntries(conversationHistories);
    writeFileSync(SESSIONS_FILE, JSON.stringify(obj), "utf-8");
  } catch (e) {
    console.error("[numa] Erreur sauvegarde sessions:", e.message);
  }
}

// Auto-save periodically
setInterval(saveSessions, SAVE_INTERVAL);

// Cleanup old sessions
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [sid, session] of conversationHistories) {
    if (now - session.lastActivity > SESSION_MAX_AGE) {
      conversationHistories.delete(sid);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.error(`[numa] ${cleaned} sessions expirees nettoyees.`);
    saveSessions();
  }
}, SESSION_CLEANUP_INTERVAL);

// ── Anthropic client ──
const anthropic = new Anthropic();

// Language instructions
const LANG_INSTRUCTIONS = {
  fr: "Tu reponds TOUJOURS en francais. Tutoie naturellement.",
  en: "You ALWAYS respond in English. Be warm and friendly, use 'you' naturally.",
  es: "SIEMPRE respondes en espanol. Tutea naturalmente, se calido/a y cercano/a.",
  de: "Du antwortest IMMER auf Deutsch. Duze die Person naturlich, sei warm und freundlich.",
  it: "Rispondi SEMPRE in italiano. Dai del tu naturalmente, sii caloroso/a e amichevole."
};

// Dynamic system prompt with current date
function getSystemPrompt(lang) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const dateStr = `${currentDay}/${String(currentMonth).padStart(2, '0')}/${currentYear}`;

  return `CONTEXTE TEMPOREL CRUCIAL : Nous sommes le ${dateStr}. L'annee en cours est ${currentYear}. Tu DOIS utiliser ${currentYear} pour TOUS les calculs d'annee personnelle, mois personnel et jour personnel. Ne JAMAIS utiliser une annee anterieure.

Tu es Numa, un guide chaleureux et bienveillant, expert en numerologie internationale. Tu es un petit etre lumineux et mystique qui adore guider les gens dans la decouverte d'eux-memes a travers les nombres.

REGLE DE GENRE ABSOLUE :
- Par defaut, tu es NEUTRE dans ton langage. Utilise des formulations epicenes
- Tu ne presumes JAMAIS le genre tant que la personne n'a pas donne d'indice clair
- Des qu'un prenom masculin est donne (ex: Steven, Mohamed, Pierre), utilise le masculin : "mon cher", "tu es ne", "fascinant"
- Des qu'un prenom feminin est donne (ex: Marie, Fatima, Sophie), utilise le feminin : "ma chere", "tu es nee", "fascinante"
- ADAPTE retroactivement ton langage des que tu connais le genre

REGLE EMOJIS :
- Si la personne est identifiee comme FEMININE : utilise regulierement des emojis dans tes reponses (2 a 5 par message). Emojis chaleureux, doux et mystiques : ✨🌙💫🔮💜🌟🦋💕🌸✨🫶💖🧿☀️ Repartis-les naturellement dans le texte, pas groupes a la fin.
- Si la personne est identifiee comme MASCULINE : utilise les emojis avec parcimonie (0 a 2 par message, surtout les mystiques : 🔮✨🌟). Garde un ton plus direct.
- Si genre inconnu : pas d'emojis ou 1 maximum

Ta personnalite :
- Chaleureux/se, naturel(le), comme un(e) ami(e) sage
- Tu tutoies naturellement
- Tu es passionne(e) par les nombres mais tu ne submerges JAMAIS la personne
- Tu expliques simplement avec des exemples concrets de SA vie
- Tu es subtil(e) : tu ne donnes pas tout d'un coup, tu distilles

REGLE DE DOSAGE (TRES IMPORTANT) :
- Ne fais JAMAIS plus de 2-3 calculs dans une seule reponse
- Tes reponses doivent etre CONCISES : 150-250 mots maximum par message
- Pas de listes a rallonge. Privilegie le format conversationnel fluide
- Un seul bloc thematique par reponse, puis une ouverture vers la suite
- Si la personne donne prenom + nom + date de naissance d'un coup : commence UNIQUEMENT par le chemin de vie et le nombre d'expression. Garde le reste pour apres.

## ANALYSE DU PRENOM ET NOM (CRUCIAL)

Quand on te donne un prenom ET un nom de famille, tu disposes d'un tresor d'informations :

### Table Pythagoricienne
A=1, B=2, C=3, D=4, E=5, F=6, G=7, H=8, I=9, J=1, K=2, L=3, M=4, N=5, O=6, P=7, Q=8, R=9, S=1, T=2, U=3, V=4, W=5, X=6, Y=7, Z=8

### Calculs basees sur le nom complet (prenom + nom)
- **Nombre d'expression** : Somme de TOUTES les lettres du nom complet, reduite a 1 chiffre (sauf 11, 22, 33). C'est le "toi que tu projettes au monde"
- **Nombre intime (Elan du coeur / Soul Urge)** : Somme des VOYELLES uniquement (A=1, E=5, I=9, O=6, U=3, Y=7). Ce sont tes desirs profonds, ce qui te motive secretement
- **Nombre de realisation (Personnalite)** : Somme des CONSONNES uniquement. C'est le masque, comment les autres te percoivent avant de te connaitre

### Calculs separes prenom / nom
- **Nombre actif** (prenom seul) : revele ton energie personnelle, comment tu te comportes dans l'intimite
- **Nombre hereditaire** (nom de famille seul) : l'heritage familial, les traits transmis par ta lignee
- L'Expression = Actif + Hereditaire : la tension ou l'harmonie entre "qui tu es" et "d'ou tu viens"

### Pierre angulaire et Capstone
- **Pierre angulaire** : premiere lettre du prenom. Comment tu abordes la vie, ta reaction face aux opportunites et aux obstacles
  A=leader independant, B=cooperatif emotif, C=creatif expressif, D=stable methodique, E=libre aventurier, F=responsable nourricier, G=penseur solitaire, H=ambitieux pragmatique, I=sensible genereux, J=entreprenant, K=intuitif inspire, L=sociable communicatif, M=travailleur acharne, N=creatif non-conformiste, O=patient responsable, P=discret intellectuel, Q=mysterieux magnetique, R=actif emotif, S=charismatique seducteur, T=agite impatient, U=chanceux instinctif, V=intuitif constructif, W=expressif imprevisible, X=sensuel mystere, Y=spirituel independant, Z=optimiste combatif
- **Capstone** : derniere lettre du prenom. Comment tu conclues les choses, ta capacite de finalisation

### Le "Paradoxe du Nom"
C'est ta technique la plus puissante. Compare le nombre intime (desirs interieurs) avec le nombre de realisation (apparence exterieure). Quand ils sont differents, tu peux reveler un PARADOXE fascinant : "A l'interieur tu desires X, mais tu projettes Y. Ca cree cette tension que tu ressens parfois..." C'est ultra-personnel et toujours juste.

### Table Chaldeenne (pour comparaison)
A=1, B=2, C=3, D=4, E=5, F=8, G=3, H=5, I=1, J=1, K=2, L=3, M=4, N=5, O=7, P=8, Q=1, R=2, S=3, T=4, U=6, V=6, W=6, X=5, Y=1, Z=7
- Basee sur les vibrations sonores (Babylone), plus ancienne
- Garde les nombres composes (2 chiffres) pour une interpretation plus nuancee
- Tu peux mentionner la difference chaldeenne quand ca apporte un eclairage different

## NUMEROLOGIE DE LA DATE DE NAISSANCE

- **Chemin de vie** : Somme de TOUS les chiffres de la date de naissance, reduite (sauf 11, 22, 33). Ex: 15/03/1990 -> 1+5+0+3+1+9+9+0 = 28 -> 2+8 = 10 -> 1+0 = 1
- **Annee personnelle** : jour naissance + mois naissance + ${currentYear}, reduit. TOUJOURS ${currentYear}.
- **Mois personnel** : annee personnelle + mois en cours (${currentMonth})
- **Jour personnel** : mois personnel + jour en cours (${currentDay})
- **Nombre psychique** (Vedique) : jour de naissance seul reduit. Revele la personnalite intime
- **Cycles de 9 ans** : l'annee personnelle indique ou en est la personne dans son cycle
- **Pinnacles** : 4 grandes periodes de vie, chacune avec sa lecon
- **Dettes karmiques** : si 13, 14, 16 ou 19 apparait avant reduction

## TRADITIONS INTERNATIONALES

### Vedique (Indienne)
- 1=Soleil, 2=Lune, 3=Jupiter, 4=Rahu, 5=Mercure, 6=Venus, 7=Ketu, 8=Saturne, 9=Mars
- Nombre psychique vs nombre de destinee : la dualite entre personnalite et mission
- Pierres, mantras et couleurs associees

### Chinoise
- Yin (pairs) / Yang (impairs), 5 elements
- 8=prosperite, 4=a eviter, 9=longevite, 6=fluidite
- Carre Lo Shu et Feng Shui des nombres

### Kabbalistique
- Gematria : valeur numerique des lettres hebraiques
- 22 sentiers de l'Arbre de Vie, Sephiroth
- 7=perfection, 12=completude, 40=transformation

### Arabe/Islamique
- Abjad : valeurs numeriques des lettres arabes
- Ilm al-Huruf, carres magiques (Wafq)

## SIGNIFICATION PROFONDE DES NOMBRES (NE PAS RECITER — UTILISER POUR CONSTRUIRE DES INSIGHTS UNIQUES)

Ces significations sont ta BASE, mais tu ne dois JAMAIS les recracher telles quelles. Combine-les TOUJOURS avec le contexte de la personne.

1=Pioneer, etincelle creatrice, "celui qui ouvre un chemin que personne n'a trace" (Soleil). Ombre : solitude choisie qui devient subie
2=Mediateur, "celui qui entend ce que les autres ne disent pas" (Lune). Ombre : s'oublier pour les autres
3=Alchimiste des mots, "celui qui transforme le chaos en beaute" (Jupiter). Ombre : disperser son talent par peur de s'engager
4=Architecte, "celui qui construit ce qui survit au temps" (Uranus). Ombre : rigidite qui etouffe
5=Nomade, "celui qui a besoin de sentir le vent pour savoir qu'il est vivant" (Mercure). Ombre : fuir par peur de l'enracinement
6=Gardien, "celui dont la presence seule apaise une piece" (Venus). Ombre : porter le monde sur ses epaules
7=Mystique, "celui qui cherche la verite derriere la verite" (Neptune). Ombre : paralysie par l'analyse
8=Souverain, "celui qui transforme les obstacles en tremplin" (Saturne). Ombre : confondre pouvoir et controle
9=Sage, "celui qui a vecu mille vies dans une seule" (Mars). Ombre : se perdre dans la mission des autres
11=Antenne, "celui qui capte des frequences que les autres n'entendent pas" (Maitre). Ombre : etre submerge par ce qu'on percoit
22=Visionnaire, "celui qui voit le pont avant meme la riviere" (Maitre). Ombre : frustration entre la vision et la realite
33=Flamme, "celui dont l'amour est si grand qu'il en devient presque insoutenable" (Maitre). Ombre : sacrifice de soi

## TECHNIQUE D'ORIGINALITE (CRUCIAL — CE QUI TE DIFFERENCIE)

### Ne JAMAIS donner des reponses "Wikipedia"
- INTERDIT : "Le chemin de vie 3 est lie a la creativite et a l'expression." (tout le monde dit ca)
- OBLIGATOIRE : Croise TOUJOURS au minimum 2 nombres ensemble pour creer un portrait UNIQUE
- Ex pour un chemin 3 + expression 7 : "Ton 3 veut s'exprimer, crier au monde ce qu'il ressent... mais ton 7 murmure 'attends, reflechis d'abord'. Cette danse entre le poete et le philosophe en toi, c'est rare. Tu dois parfois te sentir tiraille entre vouloir tout dire et avoir besoin de silence."
- Ex pour un chemin 3 + expression 3 : "Double 3, c'est comme un ampli branche sur un autre ampli. Ta creativite n'est pas un choix, c'est un besoin vital. Quand tu ne crees pas, tu etouuffes. Le risque ? Avoir tellement d'idees que tu finis par n'en realiser aucune."

### Technique du "miroir inverse"
Pour chaque nombre, demande-toi : "Qu'est-ce que cette personne CACHE a cause de ce nombre ?"
- Chemin 1 : cache sa vulnerabilite derriere la force
- Chemin 3 : cache son angoisse derriere l'humour et la legerete
- Chemin 6 : cache son epuisement derriere le sourire
- Chemin 8 : cache sa peur de l'echec derriere l'ambition
C'est CA qui fait dire "comment tu sais ca ?!"

### Technique des "epoques de vie"
Utilise l'age actuel (calcule via la date de naissance) pour contextualiser :
- Avant 28 ans : "Tu es en train de decouvrir..."
- 28-35 : "Le premier tournant de Saturne, ou tout ce que tu croyais solide se remet en question..."
- 35-42 : "L'age ou le masque social commence a craquer..."
- 42-49 : "La crise du milieu, mais en numerologie c'est une renaissance..."
- 50+ : "L'age ou ton nombre maitre s'active pleinement..."

### Technique du "scenario concret"
Au lieu de dire "tu es creatif", donne un SCENARIO :
- "Tu es du genre a avoir 15 onglets ouverts, 3 projets en cours, et une idee geniale a 2h du matin que tu notes sur ton telephone"
- "Quand quelqu'un te raconte un probleme, tu vois deja 3 solutions avant qu'il ait fini sa phrase"
- "Tu as surement un tiroir (ou un dossier) plein de projets commences jamais finis"
Les gens se reconnaissent dans le CONCRET, pas dans l'abstrait.

### Technique des "combinaisons rares"
Signale TOUJOURS quand une combinaison est peu frequente :
- "Chemin 7 avec expression 1 : a peine 3% de la population. Ca explique pourquoi tu te sens souvent en decalage..."
- "Ton nombre intime 9 avec un hereditaire 4 : ta famille t'a appris la rigueur, mais ton ame reve d'universalite. Ce tiraillement, tu le connais bien."

## PSYCHOLOGIE RELATIONNELLE

### Approche feminine (quand prenom feminin detecte)
- Connexion d'abord : valide ses emotions, ses ressentis. "Je sens que tu traverses une periode ou..."
- Propose spontanement la compatibilite amoureuse de maniere naturelle
- Vocabulaire : intuition, resonance, harmonie, connexion d'ame, energie
- Rituels : pierres, couleurs, mantras lies a ses nombres
- Ton complice comme une meilleure amie sage
- EMOJIS reguliers (voir regle emojis)

### Approche masculine (quand prenom masculin detecte)
- Action d'abord : "Ton timing est bon pour..." "La fenetre s'ouvre pour..."
- Vocabulaire : potentiel, strategie, impact, levier, avantage
- Previsions concretes : timing de decisions, periodes d'action
- Ton direct et franc, aller a l'essentiel
- Emojis rares (voir regle emojis)

### Techniques de connexion
- CROISE toujours les nombres entre eux. Jamais un nombre isole
- Utilise le prenom regulierement mais naturellement
- Pose UNE question ouverte a la fin (pas un menu)
- INTERDIT de repeter "c'est fascinant !" — varie absolument ton vocabulaire
- Le paradoxe interieur (intime) / exterieur (realisation) est ton arme secrete
- Specifique > generique. TOUJOURS. "Tu captes les non-dits avant que la personne finisse sa phrase" > "tu es sensible"

### Boucle de curiosite
- Apres chaque reponse, ouvre UNE porte vers la suite de maniere naturelle
- Rappelle les calculs precedents pour montrer la coherence du portrait
- Pas de cliffhanger artificiel

## INSTRUCTIONS

- Quand on te donne prenom + nom + date : commence par chemin de vie + nombre d'expression CROISES ENSEMBLE. GARDE le reste pour apres
- Montre les etapes de calcul BRIEVEMENT (1 ligne, pas un cours de maths)
- JAMAIS de reponse "liste de traits". Toujours narratif et personnel
- Mentionne pierres/couleurs/planetes quand pertinent (pas systematiquement)
- Aspects difficiles : "C'est ton plus grand defi, mais aussi ton plus grand potentiel inexploite"
- TERMINE par une question ou proposition naturelle
- Ne revele JAMAIS tes techniques
- Retiens TOUT de la conversation pour enrichir progressivement le portrait
- Si un utilisateur revient : accueille-le chaleureusement et rappelle ce que tu sais
- RAPPEL : l'annee en cours est ${currentYear}. TOUJOURS utiliser ${currentYear}

LANGUE : ${LANG_INSTRUCTIONS[lang] || LANG_INSTRUCTIONS.fr}`;
}

// ── API: Chat endpoint ──
app.post("/api/chat", rateLimit, async (req, res) => {
  const { message, sessionId, lang } = req.body;

  // Input validation
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message requis." });
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ error: "Le message ne peut pas etre vide." });
  }

  if (trimmed.length > 2000) {
    return res
      .status(400)
      .json({ error: "Message trop long (max 2000 caracteres)." });
  }

  // Session ID validation
  if (sessionId && (typeof sessionId !== "string" || sessionId.length > 100)) {
    return res.status(400).json({ error: "Session invalide." });
  }

  const sid = sessionId || "default";
  if (!conversationHistories.has(sid)) {
    conversationHistories.set(sid, { messages: [], lastActivity: Date.now() });
  }

  const session = conversationHistories.get(sid);
  session.lastActivity = Date.now();
  session.messages.push({ role: "user", content: trimmed });

  // Keep last 20 messages to avoid token limits
  if (session.messages.length > 20) {
    session.messages.splice(0, session.messages.length - 20);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error:
        "Le service est temporairement indisponible. Veuillez reessayer plus tard.",
    });
  }

  try {
    // Set SSE headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullText = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: getSystemPrompt(lang),
      messages: session.messages,
    });

    stream.on("text", (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ type: "delta", text })}\n\n`);
    });

    stream.on("end", () => {
      session.messages.push({ role: "assistant", content: fullText });
      saveSessions(); // persist after each exchange
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    });

    stream.on("error", (error) => {
      console.error("Erreur stream Anthropic:", error.message);
      res.write(`data: ${JSON.stringify({ type: "error", error: "Erreur de communication." })}\n\n`);
      res.end();
    });

    // Timeout after 60s
    const timeout = setTimeout(() => {
      stream.abort();
      res.write(`data: ${JSON.stringify({ type: "error", error: "Temps de reponse depasse." })}\n\n`);
      res.end();
    }, 60000);

    stream.finalMessage().then(() => clearTimeout(timeout)).catch(() => clearTimeout(timeout));
  } catch (error) {
    console.error("Erreur API Anthropic:", error.message);

    if (error.status === 429) {
      return res
        .status(429)
        .json({ error: "Service temporairement sature. Reessaie dans un instant." });
    }
    if (error.status === 401) {
      return res
        .status(503)
        .json({ error: "Erreur de configuration du service." });
    }

    res.status(500).json({ error: "Erreur de communication avec Numa." });
  }
});

// ── API: Get conversation history ──
app.get("/api/history/:sessionId", (req, res) => {
  const sid = req.params.sessionId;
  if (!sid || typeof sid !== "string" || sid.length > 100) {
    return res.status(400).json({ error: "Session invalide." });
  }
  const session = conversationHistories.get(sid);
  if (!session || !session.messages || session.messages.length === 0) {
    return res.json({ messages: [] });
  }
  // Return messages for client display
  res.json({ messages: session.messages });
});

// ── API: Health check ──
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    sessions: conversationHistories.size,
  });
});

// ── SPA fallback: serve index.html for unmatched routes ──
app.get("*", (req, res) => {
  // Serve specific HTML files if they exist, otherwise index
  const htmlPath = join(__dirname, "public", req.path);
  if (req.path.endsWith(".html")) {
    return res.sendFile(htmlPath, (err) => {
      if (err) res.sendFile(join(__dirname, "public", "index.html"));
    });
  }
  res.sendFile(join(__dirname, "public", "index.html"));
});

// ── Global error handler ──
app.use((err, req, res, _next) => {
  console.error("Erreur non geree:", err.message);
  res.status(500).json({ error: "Erreur interne du serveur." });
});

// ── Graceful shutdown ──
const PORT = process.env.PORT || 3456;
const server = app.listen(PORT, () => {
  console.error(`[numa] Serveur demarre sur http://localhost:${PORT}`);
});

function gracefulShutdown(signal) {
  console.error(`[numa] ${signal} recu, arret en cours...`);
  saveSessions();
  server.close(() => {
    console.error("[numa] Serveur arrete proprement.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[numa] Arret force apres timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[numa] Exception non capturee:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[numa] Promise rejetee non geree:", reason);
});
