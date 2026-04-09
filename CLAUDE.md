# Stellaris Code Search — Instructions pour Claude

Ce fichier contient les instructions de développement et d'auto-maintenance pour le projet Stellaris MCP Server.

---

## Architecture du projet

Stellaris est un serveur MCP (Model Context Protocol) écrit en TypeScript/ESM. Il expose des outils de recherche sémantique, d'analyse AST, de graphe de dépendances, et de snapshot de schéma DB.

### Points d'entrée critiques
- `src/index.ts` — entrée principale, tableau `TOOLS[]`, switch de dispatch, shutdown
- `src/startup.ts` — fonctions non-bloquantes lancées au démarrage (`autoIndex`, `autoScanUsage`, `autoDbSnapshot`)
- `src/prompts.ts` — définitions des prompts MCP (`nova_explore`, `nova_db`, etc.)

### Structure des stores (dans `.vectors/` — gitignored)
- `.vectors/lancedb/` — vecteurs (LanceDB)
- `.vectors/fts.db` — recherche full-text (SQLite FTS5)
- `.vectors/graph.db` — graphe de dépendances (SQLite)
- `.vectors/meta.json` — index de hashes SHA-256 pour la détection incrémentale
- `.vectors/db-schema.json` — snapshot du schéma DB (créé par `db_snapshot`)

---

## Comment ajouter un nouvel outil MCP

Pattern à suivre (obligatoire) :

1. **Créer `src/tools/monOutil.ts`** — exporter `async function handleMonOutil(args: Record<string, unknown>)`
   - Retourner `{ content: [{ type: 'text', text: string }] }`
   - En cas d'erreur : `{ content: [...], isError: true }`
   - Utiliser `findProjectRoot(process.cwd())` pour localiser le projet

2. **`src/index.ts`** — 3 modifications :
   - Import en haut : `import { handleMonOutil } from './tools/monOutil.js';`
   - Entrée dans `TOOLS[]` : `{ name, description, inputSchema: { type: 'object' as const, properties: {...} } }`
   - Case dans le switch : `case 'mon_outil': return await handleMonOutil(args ?? {});`

3. **Build** : `npm run build` doit passer sans erreur

---

## Comment ajouter un provider DB

1. Implémenter `src/db/providers/monProvider.ts` qui implémente `DbProvider` (interface dans `src/db/providers/base.ts`)
2. Mettre à jour `src/db/providers/detect.ts` pour reconnaître le préfixe de connection string
3. Brancher dans `src/db/snapshot.ts` dans le switch de providers
4. Mettre à jour `src/db/parsers/detect.ts` si un parser local est associé

---

## Règles de développement

### Build
```bash
npm run build    # compile TypeScript vers dist/
npm run dev      # tsx watch (dev uniquement)
```

Toujours vérifier que `npm run build` passe avant de commit. Le CI n'existe pas sur ce projet — le build local est la seule vérification.

### Versionning
- Format : `MAJOR.MINOR.PATCH` dans `package.json` ET dans `src/index.ts` (champ `version` du `Server`)
- Mettre à jour `CHANGELOG.md` à chaque release avec la section architecture

### Stores SQLite — règles de sécurité
- Toujours utiliser WAL mode : `db.pragma('journal_mode = WAL')`
- Fermer proprement dans `shutdown()` dans `src/index.ts`
- Pattern singleton : `let db: Database | null = null` + `async function connect()`

### Sécurité
- Ne jamais logger une connection string complète : utiliser `maskConnectionString()` de `src/db/providers/detect.ts`
- Les credentials DB vont dans `.stellarisrc` (gitignored) ou en variables d'environnement (`DB_CONNECTION_STRING`, `DATABASE_URL`)
- Préférer `execFile` à `exec` pour les commandes shell (évite l'injection de commandes)

---

## Auto-maintenance du snapshot DB

Quand des changements de schéma DB sont faits dans un projet utilisant Stellaris :

1. Si `db_auto_snapshot=true` dans `.stellarisrc` → le snapshot se rafraîchit au prochain démarrage de Stellaris
2. Sinon → appeler manuellement `db_snapshot` (via MCP) avec la connection string
3. Le snapshot est dans `.vectors/db-schema.json` — jamais commité (gitignored via `.vectors/`)

---

## Workflow de release

1. Mettre à jour la version dans `package.json` et `src/index.ts`
2. Ajouter une section dans `CHANGELOG.md`
3. `npm run build` — doit passer sans erreur
4. Commit + push sur `main`

---

## Fichiers à ne pas modifier sans comprendre l'impact

| Fichier | Risque |
|---------|--------|
| `src/indexer/hasher.ts` | Change la détection incrémentale → peut forcer un reindex complet |
| `src/indexer/integrity.ts` | Peut purger des chunks valides si la logique de détection est cassée |
| `src/store/lancedb.ts` | Changements de schéma LanceDB nécessitent une migration ou un reindex complet |
| `src/store/fts.ts` | Idem — FTS5 est sensible aux changements de tokenizer |
| `src/usage/store.ts` | A un système de migration SQLite — suivre le pattern existant |
