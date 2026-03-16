# Audit Production — Numa (numerologie-chatbot)

**Date** : 2026-03-15
**Dossier** : ~/Medium/numerologie-chatbot/
**Stack** : Express.js 4, Helmet 8, Claude API, OpenAI API
**Port** : 3456
**Deploiement** : LOCAL (LaunchAgent com.numa.service)

---

## Resultats de l'audit

### 1. Git remote (erreur #21)
- **Statut** : OK
- **Remote** : `origin https://github.com/riviaai/numa-chatbot.git`

### 2. Cle API partagee (erreur #20)
- **Statut** : A VERIFIER MANUELLEMENT
- La cle `ANTHROPIC_API_KEY` presente dans `.env` n'a pas ete trouvee dans d'autres apps du dossier `~/Medium/`.
- **Action requise** : Verifier sur console.anthropic.com que cette cle n'est pas utilisee par d'autres apps (Clozia, RiviaTranscript, etc.). Si oui, generer une cle dediee pour Numa.

### 3. Timeout sur appels API externes (erreur #19)
- **Statut** : DEJA EN PLACE
- AbortController avec timeout 45s sur les appels Anthropic (ligne ~995) et OpenAI (ligne ~1042).
- Le timeout est de 45s (au-dessus des 30s recommandes mais acceptable pour le streaming LLM).

### 4. Security Headers
- **Statut** : OK (ameliore)
- Helmet configure avec CSP, HSTS, Referrer-Policy, X-Frame-Options, X-Content-Type-Options.
- **CORRIGE** : Ajout du header `Permissions-Policy: camera=(), microphone=(), geolocation=()` (manquant car retire de Helmet v8).
- **Note** : CSP contient `'unsafe-inline'` pour scriptSrc et styleSrc. Idealement migrer vers des nonces, mais acceptable pour une app locale sans formulaires sensibles.

### 5. Rate Limiting
- **Statut** : OK (ameliore)
- Rate limiter en memoire : 10 requetes/minute par IP avec cleanup periodique.
- **CORRIGE** : Ajout du header `Retry-After` sur les reponses 429 (manquant, requis par best practices).

### 6. Graceful Shutdown
- **Statut** : OK (ameliore)
- Handlers SIGTERM et SIGINT presents, sauvegarde des sessions avant arret.
- **CORRIGE** :
  - Timeout passe de 10s a 30s (conforme aux best practices).
  - Ajout du flag `isShuttingDown` pour eviter les double shutdowns.
  - Ajout du rejet des requetes `/api/chat` pendant le shutdown (503).
  - Le endpoint `/health/ready` retourne 503 pendant le shutdown.

### 7. Health Endpoints
- **Statut** : OK (ameliore)
- `/api/health` existait deja avec infos providers.
- **CORRIGE** :
  - Ajout de `version` et `uptime` au endpoint `/api/health`.
  - Ajout de `/health/live` → `{ status: "alive" }` (liveness probe).
  - Ajout de `/health/ready` → `{ status: "ready" }` ou 503 si shutdown (readiness probe).

---

## Conformite Best Practices

| Critere | Statut | Notes |
|---------|--------|-------|
| Health /live + /ready | OK | Ajoute |
| Graceful Shutdown 30s | OK | Corrige (etait 10s) |
| isShuttingDown flag | OK | Ajoute |
| Security Headers Helmet | OK | CSP, HSTS, Referrer, X-Frame |
| Permissions-Policy | OK | Ajoute manuellement |
| Rate Limiting + 429 | OK | Ajoute Retry-After |
| Timeout API externes | OK | 45s AbortController |
| Git remote | OK | github.com/riviaai/numa-chatbot |
| Cle API dediee | A VERIFIER | Pas trouvee ailleurs localement |
| Provider fallback | OK | Anthropic → OpenAI avec circuit breaker |
| Session persistence | OK | Fichier JSON, cleanup 7 jours |
| Input validation | OK | Taille message, sessionId |
| Body size limit | OK | 10kb |
| Global error handler | OK | Express error middleware |
| uncaughtException handler | OK | Present |

---

## Points restants (non critiques, a planifier)

1. **CSP unsafe-inline** : Migrer vers des nonces pour scriptSrc/styleSrc (necessite un build step pour le frontend).
2. **Structured logging JSON** : Les logs utilisent `console.error` au lieu du format JSON structure recommande.
3. **Cle API dediee** : Confirmer sur console.anthropic.com que la cle est unique a Numa.
4. **Monitoring memoire** : Pas de surveillance heapUsed (recommande toutes les 30s avec alerte > 500MB).
5. **RGPD** : Pas de politique de confidentialite ni bandeau cookies (obligatoire avant premier utilisateur externe).

---

## Fichiers modifies

- `server.js` : Graceful shutdown 30s, isShuttingDown, /health/live, /health/ready, Retry-After, Permissions-Policy, rejet requetes pendant shutdown.
