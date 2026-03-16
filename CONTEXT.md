# Numa

Chatbot intelligent specialise en numerologie internationale.

## Stack

- **Runtime** : Express.js 4 (ESM modules)
- **APIs** : Claude API (@anthropic-ai/sdk), OpenAI
- **Securite** : Helmet

## Architecture

```
server.js              # Point d'entree (Express + routes)
public/                # Frontend statique
data/                  # Donnees de reference numerologie
logs/                  # Fichiers de log
```

## Variables d'environnement

- `ANTHROPIC_API_KEY` — Cle API Claude (DOIT etre dediee a Numa)
- `PORT` — Port serveur (3456)
- `NODE_ENV` — production/development

## Problemes connus

- Pas de timeout sur les appels Anthropic API (ajouter AbortController 30s)
- Cle API partagee avec d'autres apps (chaque app doit avoir sa propre cle)
- Pas de git remote configure

## Deploiement

- **LOCAL** : LaunchAgent `com.numa.service`, port 3456
