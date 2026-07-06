# Détection du project root : cohérence + agent-driven

**Date :** 2026-07-06
**Statut :** validé, prêt pour implémentation
**Version cible :** 4.8.0

## Problème

Deux bugs distincts se combinent pour produire un `NO_GRAPH` insoluble sur un projet imbriqué (ex. plugin WordPress `aaia-chat-WP/aaia-chat/` où le `.git` est sur le plugin, mais le MCP est déclaré et lancé depuis le parent `aaia-chat-WP/`).

**Bug 1 — incohérence de résolution du root.**
`handleReindex` calcule `projectRoot = path ?? findProjectRoot(process.cwd())` : il accepte un `path` explicite. Les ~30 autres outils utilisent `findProjectRoot(process.cwd())` sans paramètre. Conséquence : si on indexe un projet en passant un `path` (ou depuis un cwd différent), le graphe est écrit à un endroit et lu à un autre. Les outils graphe renvoient `NO_GRAPH` alors que `graph.db` existe et est peuplé.

**Bug 2 — `findProjectRoot` ne trouve pas un projet situé sous le cwd.**
`findProjectRoot(startPath)` remonte vers les parents jusqu'à trouver un `.git/`, sinon retombe sur `startPath`. Quand le serveur démarre dans un dossier parent sans marqueur (`aaia-chat-WP/` n'a pas de `.git`) alors que le projet réel est un sous-dossier (`aaia-chat/` a le `.git`), la remontée échoue et le fallback ancre sur le parent — le mauvais dossier.

**Contrainte produit :** le MCP doit être plug-and-play. L'utilisateur colle la déclaration MCP dans sa config et ça fonctionne, sans réglage manuel obscur. Corollaire : le comportement doit être **prévisible**, pas seulement automatique. Deviner en silence (choisir un sous-dossier au hasard) est automatique mais imprévisible — on l'exclut.

## Principe directeur

Le MCP ne devine jamais en silence. Il résout le root de façon déterministe et prévisible. Quand la situation est ambiguë (aucun index, aucun marqueur à cwd, mais des sous-projets existent), il **le signale à l'agent Claude** via les messages d'erreur, et l'agent gère (reindex avec le bon path, ou relance depuis le bon dossier). C'est la stratégie « s'appuyer sur l'agent » plutôt que sur une heuristique fragile.

## Architecture

### Nouveau module : `src/config/projectRoot.ts`

Source unique de vérité pour la résolution du root. Deux fonctions exportées.

#### `resolveProjectRoot(startDir?, explicitPath?): string`

`startDir` défaut `process.cwd()`. Cascade déterministe, premier match gagne :

1. **`explicitPath`** fourni → retourné tel quel (résolu en absolu). C'est l'override utilisé par le paramètre `path` de reindex.
2. **`.vectors/` présent à `startDir`** → `startDir`. Un index existe déjà ici : on reste cohérent avec les sessions précédentes. Vérification à `startDir` uniquement — pas de remontée, pas de descente.
3. **Marqueur projet en remontant** depuis `startDir` vers les parents (borné à la racine FS). Marqueurs reconnus, dans l'ordre où on teste un dossier donné : `.git`, `composer.json`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`. Premier dossier (le plus proche en remontant) qui contient au moins un marqueur → ce dossier.
4. **`startDir`** en dernier recours (comportement historique conservé).

Pas de recherche descendante dans les sous-dossiers : la descente est réservée à la détection d'ambiguïté (voir ci-dessous), qui signale au lieu de choisir.

#### `detectNestedProjects(startDir?): string[]`

Retourne la liste des sous-dossiers de profondeur 1 (relatifs à `startDir`) contenant un marqueur projet, **uniquement si `startDir` lui-même n'a ni `.vectors/` ni marqueur** (sinon retourne `[]` — pas d'ambiguïté à signaler). Ignore les dossiers systèmes (`node_modules`, `.git`, `vendor`, `dist`, etc. — réutiliser la liste `SKIP_DIRS` déjà présente dans `src/config/loader.ts`). Sert à enrichir les messages `NO_GRAPH`, jamais à choisir un root.

### Façade de compatibilité

`findProjectRoot` (actuellement dans `src/indexer/scanner.ts`, importée par ~30 fichiers) est réimplémentée pour déléguer :

```
export function findProjectRoot(startPath: string): string {
  return resolveProjectRoot(startPath);
}
```

Aucun appelant ne change de signature. La logique de remontée `.git` actuelle est absorbée par la priorité 3 de `resolveProjectRoot`.

**Anti-circularité :** `findProjectRoot` est *déplacée* de `scanner.ts` vers `projectRoot.ts` (implémentation canonique). `scanner.ts` la ré-exporte (`export { findProjectRoot } from '../config/projectRoot.js'`) pour que ses ~30 importateurs actuels (`import { findProjectRoot } from '../indexer/scanner.js'`) continuent de fonctionner sans modification. Aucun import de `scanner.ts` depuis `projectRoot.ts` → pas de cycle.

### Migration des consommateurs

- `handleReindex` (`src/tools/reindex.ts:368`) : `path ?? findProjectRoot(process.cwd())` → `resolveProjectRoot(process.cwd(), path as string | undefined)`.
- Les ~30 autres outils : inchangés (ils appellent `findProjectRoot`, qui délègue désormais).
- Messages `NO_GRAPH` : les outils graphe (et `session_briefing`) qui détectent l'absence de graphe appellent `detectNestedProjects(cwd)` et, si non vide, enrichissent le message.

## Flux de données

```
Outil MCP appelé
  → resolveProjectRoot(cwd, path?)   [source unique]
      1. explicitPath ? → retour
      2. cwd/.vectors/ ? → cwd
      3. marqueur en remontant ? → ce dossier
      4. → cwd
  → root utilisé pour TOUTES les opérations (.vectors/, graph.db, scan)
```

Écriture (reindex) et lecture (graphe) passent par la même fonction → même root garanti.

## Format des messages NO_GRAPH enrichis

Actuel :
```json
{ "error": "NO_GRAPH", "message": "No dependency graph found. Please run reindex first." }
```

Enrichi quand `detectNestedProjects` renvoie des candidats :
```json
{
  "error": "NO_GRAPH",
  "message": "No dependency graph at <root>. Nested projects detected: aaia-chat. Run reindex with path=\"<root>/aaia-chat\", or restart Stellaris from that directory.",
  "nested_projects": ["aaia-chat"]
}
```

Sans candidats : message actuel conservé.

## Gestion d'erreurs

- `resolveProjectRoot` ne throw jamais : chaque étape est un test `existsSync` en try/catch implicite ; en cas d'échec FS, on passe à l'étape suivante et in fine au fallback `startDir`.
- `detectNestedProjects` : `readdir` en try/catch → `[]` si échec (dossier illisible).
- Chemins normalisés en absolu via `resolve()` ; séparateurs en forward-slash pour cohérence avec le reste du code.

## Tests (`test/project-root.test.ts`, ajouté à `npm test`)

Fixtures créées à la volée dans un dossier temp (pattern des tests existants) :

1. **explicitPath prioritaire** : `resolveProjectRoot(cwd, '/foo')` → `/foo`.
2. **`.vectors/` local gagne** : cwd avec `.vectors/` ET un `.git` parent → retourne cwd, pas le parent.
3. **marqueur en remontant** : cwd sans marqueur, parent avec `.git` → parent.
4. **fallback cwd** : ni `.vectors/` ni marqueur nulle part → cwd.
5. **non-régression `.git` direct** : cwd avec `.git` → cwd.
6. **`detectNestedProjects` — cas aaia-chat** : parent sans marqueur + sous-dossier avec `.git`/`composer.json` → `['sous-dossier']`.
7. **`detectNestedProjects` — pas d'ambiguïté** : cwd avec marqueur → `[]`.
8. **cohérence reindex/lecture** : `resolveProjectRoot(cwd, path)` et `resolveProjectRoot(path)` renvoient le même root.

## Ce qui n'est PAS fait (YAGNI)

- Pas de cache mémoire du root (résolution FS locale négligeable ; le cache figerait le root si l'utilisateur change de projet sans redémarrer).
- Pas de descente récursive profonde (profondeur 1 uniquement, et seulement pour signaler).
- Pas de choix automatique sur layout ambigu (on signale, l'agent tranche).
- Résolution PSR-4 des `use` PHP : hors scope, déjà noté pour une version ultérieure.

## Cas concret aaia-chat

Serveur démarre dans `aaia-chat-WP/` (ni `.vectors/`, ni marqueur ; le `.git` du plugin est en dessous). `resolveProjectRoot` : priorité 2 non → priorité 3 remonte sans trouver de marqueur → fallback priorité 4 = `aaia-chat-WP/`. En parallèle, tout outil graphe renvoyant `NO_GRAPH` appelle `detectNestedProjects('aaia-chat-WP')` → `['aaia-chat']` → message enrichi. Claude lit, relance `reindex path="aaia-chat-WP/aaia-chat"`. Dès lors `aaia-chat/.vectors/` existe ; si l'utilisateur relance ensuite Stellaris depuis `aaia-chat/`, la priorité 2 le verrouille. Tous les outils convergent → fin du `NO_GRAPH`.
