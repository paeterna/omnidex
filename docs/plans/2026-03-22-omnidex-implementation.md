# Omnidex Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single MCP server that replaces both AiDex (symbol indexing) and dual-graph (context recommendation) with full source transparency, zero telemetry, and zero compiled binaries.

**Architecture:** TypeScript + Node.js MCP server using stdio transport. Uses tree-sitter for parsing (same as AiDex), SQLite for storage (same schema concept as AiDex), and a keyword-scoring recommender for `omnidex_continue`. All tools prefixed with `omnidex_`.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk`, `better-sqlite3`, `tree-sitter` + language grammars, `minimatch` (glob), `ignore` (gitignore)

---

### Task 0: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `src/constants.ts`
- Create: `src/server.ts`

**Step 1: Initialize the project**

```bash
cd /Users/omar/development/omnidex
git init
```

**Step 2: Create package.json**

```json
{
  "name": "omnidex",
  "version": "0.1.0",
  "description": "Code indexing + context recommendation MCP server",
  "type": "module",
  "bin": {
    "omnidex": "./build/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node build/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.0",
    "better-sqlite3": "^11.0.0",
    "ignore": "^7.0.0",
    "minimatch": "^10.0.0",
    "tree-sitter": "^0.22.0",
    "tree-sitter-c-sharp": "^0.23.0",
    "tree-sitter-typescript": "^0.23.0",
    "tree-sitter-python": "^0.23.0",
    "tree-sitter-javascript": "^0.23.0",
    "tree-sitter-java": "^0.23.0",
    "tree-sitter-go": "^0.23.0",
    "tree-sitter-json": "^0.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
build/
*.tsbuildinfo
```

**Step 5: Create src/constants.ts**

```typescript
export const PRODUCT_NAME = 'Omnidex';
export const PRODUCT_VERSION = '0.1.0';
export const INDEX_DIR = '.omnidex';
export const TOOL_PREFIX = 'omnidex_';
```

**Step 6: Create src/server.ts — minimal MCP server**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PRODUCT_NAME, PRODUCT_VERSION } from './constants.js';
import { registerTools, handleToolCall } from './tools/registry.js';

export function createServer() {
  const server = new Server(
    { name: PRODUCT_NAME.toLowerCase(), version: PRODUCT_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registerTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  return {
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error(`${PRODUCT_NAME} MCP server started`);
    },
  };
}
```

**Step 7: Create src/index.ts — entry point**

```typescript
#!/usr/bin/env node
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  await server.start();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

**Step 8: Create src/tools/registry.ts — empty tool registry**

```typescript
import { TOOL_PREFIX } from '../constants.js';

const tools: Array<{ name: string; description: string; inputSchema: object }> = [];
const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

export function registerTools() {
  return tools;
}

export function handleToolCall(name: string, args: Record<string, unknown>) {
  const handler = handlers.get(name);
  if (!handler) {
    return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
  }
  return handler(args);
}

export function defineTool(
  name: string,
  description: string,
  inputSchema: object,
  handler: (args: Record<string, unknown>) => Promise<unknown>
) {
  const fullName = `${TOOL_PREFIX}${name}`;
  tools.push({ name: fullName, description, inputSchema });
  handlers.set(fullName, handler);
}
```

**Step 9: Install dependencies, build, verify it starts**

```bash
cd /Users/omar/development/omnidex
npm install
npm run build
echo '{}' | timeout 3 node build/index.js 2>&1 || true
```

Expected: see "Omnidex MCP server started" on stderr.

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: project scaffold with MCP server skeleton"
```

---

### Task 1: Database Layer (SQLite)

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/database.ts`
- Create: `src/db/queries.ts`

**Step 1: Create src/db/schema.sql**

Same schema as AiDex (files, lines, items, occurrences, signatures, methods, types, project_files, tasks, task_log, metadata) plus additions for omnidex:

```sql
-- graph edges for the recommender
CREATE TABLE IF NOT EXISTS edges (
  source_file_id INTEGER NOT NULL,
  target_file_id INTEGER NOT NULL,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('imports', 'uses_type', 'inherits', 'implements')),
  weight INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_file_id, target_file_id, edge_type),
  FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE CASCADE,
  FOREIGN KEY (target_file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- session notes
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- token usage log
CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  description TEXT,
  created_at INTEGER NOT NULL
);

-- session tracking
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- action history (for recommender memory)
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT NOT NULL,
  query TEXT,
  files TEXT,  -- JSON array of file paths
  created_at INTEGER NOT NULL
);
```

Include the full AiDex schema tables (files, lines, items, occurrences, signatures, methods, types, project_files, tasks, task_log, metadata, dependencies) verbatim from AiDex.

**Step 2: Create src/db/database.ts**

```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function openDatabase(projectPath: string): Database.Database {
  const indexDir = join(projectPath, '.omnidex');
  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
  }
  const dbPath = join(indexDir, 'index.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply schema
  const schema = readFileSync(join(__dirname, '..', '..', 'src', 'db', 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}
```

Note: In the build step, copy schema.sql to the build output so it can be found at runtime. Add a `postbuild` script or include it via a different approach (embed as string constant).

**Step 3: Create src/db/queries.ts — prepared statement helpers**

Wrap common queries: insertFile, insertLine, insertItem, insertOccurrence, insertMethod, insertType, insertEdge, queryByTerm, getSignature, getFilesModifiedSince, etc. Each is a thin wrapper around a prepared statement.

**Step 4: Verify DB creates and schema applies**

```bash
npm run build
node -e "
  const { openDatabase } = await import('./build/db/database.js');
  const db = openDatabase('/tmp/test-omnidex');
  console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\"').all());
  db.close();
"
```

Expected: list of all tables from the schema.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: SQLite database layer with full schema"
```

---

### Task 2: File Scanner (Walk + Gitignore)

**Files:**
- Create: `src/indexer/scanner.ts`

**Step 1: Create the scanner**

The scanner walks the project directory, respects `.gitignore` patterns (using the `ignore` npm package), skips common non-code directories (`node_modules`, `.git`, `bin`, `obj`, `build`, `dist`), and returns an array of file paths with metadata.

Key behaviors:
- Read `.gitignore` at project root + nested `.gitignore` files
- Skip binary files (check first 512 bytes for null bytes)
- Classify files by type: code, config, doc, asset, test, other (same categories as AiDex)
- Detect language from extension for code files
- Compute file hash (SHA-256 of contents) for change detection

```typescript
export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  type: 'code' | 'config' | 'doc' | 'asset' | 'test' | 'other';
  language: string | null;  // 'csharp', 'typescript', 'python', etc.
  hash: string;
}

export async function scanProject(projectPath: string, exclude?: string[]): Promise<ScannedFile[]>;
```

**Step 2: Verify scanner works on HRIS project**

```bash
node -e "
  const { scanProject } = await import('./build/indexer/scanner.js');
  const files = await scanProject('/Users/omar/development/HRIS');
  console.log('Total files:', files.length);
  console.log('By type:', Object.entries(files.reduce((acc, f) => { acc[f.type] = (acc[f.type]||0)+1; return acc; }, {})));
  console.log('Sample:', files.slice(0, 5).map(f => f.relativePath));
"
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: file scanner with gitignore support"
```

---

### Task 3: Tree-Sitter Parsers

**Files:**
- Create: `src/parser/parser.ts` — dispatcher
- Create: `src/parser/extractor.ts` — symbol extraction from tree-sitter AST
- Create: `src/parser/languages/csharp.ts`
- Create: `src/parser/languages/typescript.ts`
- Create: `src/parser/languages/python.ts`
- Create: `src/parser/languages/java.ts`
- Create: `src/parser/languages/go.ts`
- Create: `src/parser/languages/generic.ts` — fallback regex parser
- Create: `src/parser/languages/index.ts` — language config registry

**Step 1: Define the extraction result interface**

```typescript
export interface ExtractionResult {
  items: Array<{ term: string; lineNumber: number }>;
  lines: Array<{ lineNumber: number; type: 'code' | 'comment' | 'struct' | 'method' | 'property' | 'string' }>;
  methods: Array<{ name: string; prototype: string; lineNumber: number; visibility?: string; isStatic?: boolean; isAsync?: boolean }>;
  types: Array<{ name: string; kind: 'class' | 'struct' | 'interface' | 'enum' | 'type'; lineNumber: number }>;
  headerComments: string[];
  imports: Array<{ source: string; lineNumber: number }>;  // NEW: for graph edges
}
```

Note the `imports` field — this is what dual-graph uses for edges. AiDex didn't track imports.

**Step 2: Create language configs**

Each language config specifies:
- `commentNodes`: tree-sitter node types that are comments
- `typeNodes`: node types for class/struct/interface/enum
- `methodNodes`: node types for function/method declarations
- `importNodes`: node types for import/using/require statements
- `extractImportSource(node)`: extracts the imported module/file path from an import node
- `isKeyword(term)`: filters out language keywords from the index

Follow the same pattern as AiDex's language configs but add `importNodes` and `extractImportSource`.

Priority languages (matching HRIS project):
1. C# — `using` statements, `class`, `record`, `interface`, `struct`, methods
2. TypeScript — `import` statements, `class`, `interface`, `type`, functions, Angular decorators
3. Python, Java, Go — standard patterns

**Step 3: Create the extractor**

Same recursive AST visitor pattern as AiDex:
- Walk tree-sitter nodes
- Classify lines by type
- Extract identifiers (terms)
- Extract method signatures (prototypes)
- Extract type declarations
- Extract header comments
- **NEW:** Extract import sources for graph edge building

**Step 4: Create the dispatcher**

```typescript
export function parse(sourceCode: string, filePath: string): ExtractionResult | null;
```

Detects language from file extension, loads tree-sitter grammar, parses, extracts.

**Step 5: Test parsing on sample HRIS files**

```bash
node -e "
  const { parse } = await import('./build/parser/parser.js');
  const fs = await import('fs');
  const code = fs.readFileSync('/Users/omar/development/HRIS/src/Modules/HrMaster/HRIS.Modules.HrMaster.Domain/Aggregates/Department/Department.cs', 'utf-8');
  const result = parse(code, 'Department.cs');
  console.log('Types:', result.types);
  console.log('Methods:', result.methods.length);
  console.log('Imports:', result.imports);
"
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: tree-sitter parsers for C#, TypeScript, Python, Java, Go"
```

---

### Task 4: Indexer (Scan + Parse + Store)

**Files:**
- Create: `src/indexer/indexer.ts`

**Step 1: Create the indexer**

The indexer orchestrates: scan files → parse each → store results in SQLite.

```typescript
export async function indexProject(projectPath: string, options?: { exclude?: string[] }): Promise<IndexResult>;
export async function updateFile(projectPath: string, filePath: string): Promise<void>;

interface IndexResult {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  duration: number;
}
```

Indexing flow:
1. `scanProject()` to get all files
2. For each code file:
   a. Check hash — skip if unchanged
   b. `parse()` to extract symbols
   c. Store in DB: file record, lines, items, occurrences, methods, types, signatures
   d. Store import edges in the `edges` table (resolve import paths to file IDs)
3. Store non-code files in `project_files` table (for tree view)
4. Clean up removed files from DB

Edge resolution for imports:
- C# `using X.Y.Z` → find files containing namespace `X.Y.Z` or type `Z`
- TypeScript `import { X } from './path'` → resolve relative path to file
- The edges don't need to be perfect — they're for scoring, not navigation

**Step 2: Test full indexing on HRIS project**

```bash
node -e "
  const { indexProject } = await import('./build/indexer/indexer.js');
  const result = await indexProject('/Users/omar/development/HRIS');
  console.log(result);
"
```

Expected: indexes 3000+ files in reasonable time (<30s).

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: full project indexer with graph edge building"
```

---

### Task 5: Recommender (omnidex_continue)

**Files:**
- Create: `src/recommender/recommender.ts`
- Create: `src/recommender/keywords.ts`

**Step 1: Create keyword extractor**

```typescript
export function extractKeywords(query: string): string[];
```

- Split on whitespace and common delimiters
- Remove stop words (the, a, an, is, to, from, in, of, etc.)
- Detect camelCase/PascalCase and split (e.g., "DepartmentVersion" → ["Department", "Version"])
- Detect file paths and extract filename + directory parts
- Return unique lowercase terms

**Step 2: Create the recommender**

```typescript
export interface Recommendation {
  ok: boolean;
  needs_project?: boolean;
  skip?: boolean;
  mode: 'memory_first' | 'graph_search' | 'bootstrap';
  confidence: 'high' | 'medium' | 'low';
  max_supplementary_greps: number;
  max_supplementary_files: number;
  recommended_files: Array<{ file: string; access_type: 'new' | 'read' | 'write'; score: number }>;
  query: string;
}

export function recommend(db: Database, query: string, limit?: number): Recommendation;
```

Scoring algorithm:
1. Extract keywords from query
2. **Phase 1 — Action memory:** Check recent actions table for files associated with similar queries. If strong match → `confidence: high`, return those files.
3. **Phase 2 — Symbol search:** Query the items/occurrences tables for keyword matches. Score each file:
   - Exact symbol name match: +10 points
   - Symbol contains keyword: +5 points
   - Type name (class/interface) match: +8 bonus
   - Method name match: +6 bonus
   - File path contains keyword: +3 points
4. **Phase 3 — Graph expansion:** For top-scoring files, boost connected files (via edges table):
   - File that imports a top file: +3 points
   - File imported by a top file: +2 points
5. Sort by score, take top N.
6. Set confidence: top score >= 10 → high, >= 4 → medium, else low.
7. Set supplementary caps: high → 0/0, medium → 2/2, low → 3/3.

**Step 3: Test recommender on HRIS queries**

```bash
node -e "
  const { recommend } = await import('./build/recommender/recommender.js');
  const { openDatabase } = await import('./build/db/database.js');
  const db = openDatabase('/Users/omar/development/HRIS');
  console.log(recommend(db, 'department versioning'));
  console.log(recommend(db, 'add a new field to position'));
  db.close();
"
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: context recommender with keyword scoring and graph expansion"
```

---

### Task 6: Core MCP Tools — Indexing & Search

**Files:**
- Create: `src/tools/scan.ts`
- Create: `src/tools/update.ts`
- Create: `src/tools/query.ts`
- Create: `src/tools/signature.ts`
- Create: `src/tools/signatures.ts`
- Create: `src/tools/tree.ts`
- Create: `src/tools/files.ts`
- Create: `src/tools/summary.ts`
- Create: `src/tools/describe.ts`
- Modify: `src/tools/registry.ts` — import and register all tools

**Step 1: Implement each tool**

Each tool file exports a single function that calls `defineTool()` from the registry. Pattern:

```typescript
// src/tools/scan.ts
import { defineTool } from './registry.js';
import { indexProject } from '../indexer/indexer.js';

export function register() {
  defineTool('scan', 'Index/re-index the project...', {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project path' },
      exclude: { type: 'array', items: { type: 'string' } },
    },
    required: ['path'],
  }, async (args) => {
    const result = await indexProject(args.path as string, { exclude: args.exclude as string[] });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
}
```

Tool implementations:
- **scan** → calls `indexProject()`
- **update** → calls `updateFile()` for a single file
- **query** → searches items/occurrences by term with mode (exact/contains/starts_with), file_filter, type_filter, modified_since/before, limit
- **signature** → returns header comments + types + methods for one file
- **signatures** → same but for multiple files via glob pattern
- **tree** → returns project file tree from project_files table, with optional depth/subpath/stats
- **files** → lists files from project_files, filterable by type/pattern/modified_since
- **summary** → returns project stats (file counts by type, top types, entry points) + summary.md content
- **describe** → add/update sections in `.omnidex/summary.md`

**Step 2: Update registry.ts to import and call all register functions**

```typescript
import { register as registerScan } from './scan.js';
import { register as registerUpdate } from './update.js';
// ... etc

// Call in registerTools():
registerScan();
registerUpdate();
// ...
```

**Step 3: Build and test tools via MCP**

```bash
npm run build
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node build/index.js 2>/dev/null
```

Expected: JSON response listing all registered tools.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: core MCP tools — scan, query, signature, tree, files, summary"
```

---

### Task 7: Context Recommender MCP Tools

**Files:**
- Create: `src/tools/continue.ts`
- Create: `src/tools/read.ts`
- Create: `src/tools/fallback-rg.ts`

**Step 1: Implement omnidex_continue**

```typescript
defineTool('continue', 'Auto-recommend files for the current turn...', {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'The user query or task description' },
    limit: { type: 'number', description: 'Max recommended files (default: 5)' },
  },
  required: ['query'],
}, async (args) => {
  // Check if project is indexed
  // Call recommend()
  // Record this action in actions table
  // Return recommendation
});
```

**Step 2: Implement omnidex_read**

Reads a file or a specific symbol within a file. Supports `file::symbol` notation:
- `src/auth.ts` → read entire file
- `src/auth.ts::handleLogin` → find the function/class `handleLogin` in the file and return only those lines

For symbol extraction, look up the methods/types tables to find the line range, then read just those lines from the actual file.

**Step 3: Implement omnidex_fallback_rg**

A controlled ripgrep fallback with a per-turn call counter:
- Runs `rg` subprocess with the given pattern
- Tracks call count per session
- Refuses if called more than the max allowed by the confidence tier

**Step 4: Test the continue flow end-to-end**

Index HRIS first, then test continue:

```bash
node -e "
  // Assumes already indexed from Task 4 test
  const { openDatabase } = await import('./build/db/database.js');
  const { recommend } = await import('./build/recommender/recommender.js');
  const db = openDatabase('/Users/omar/development/HRIS');
  const r = recommend(db, 'fix department version effective date');
  console.log(JSON.stringify(r, null, 2));
  db.close();
"
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: context recommender tools — continue, read, fallback_rg"
```

---

### Task 8: Session, Notes & Tasks Tools

**Files:**
- Create: `src/tools/session.ts`
- Create: `src/tools/note.ts`
- Create: `src/tools/task.ts`
- Create: `src/tools/tasks.ts`

**Step 1: Implement omnidex_session**

- Creates a new session record in `sessions` table
- Detects files changed since last session (compare file hashes)
- Auto-reindexes changed files
- Returns: session ID, files changed count, last session time, current note

**Step 2: Implement omnidex_note**

- Read/write/append/clear session notes in `notes` table
- Simple CRUD — matches AiDex's `aidex_note` API exactly

**Step 3: Implement omnidex_task and omnidex_tasks**

- Full CRUD for task backlog: create, read, update, delete, log
- `omnidex_tasks` lists/filters by status, priority, tag
- Same schema and behavior as AiDex's task system

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: session, note, and task management tools"
```

---

### Task 9: Token Usage Tracking

**Files:**
- Create: `src/tools/tokens.ts`
- Create: `src/tokens/tracker.ts`

**Step 1: Create the tracker**

```typescript
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  model?: string;
  description?: string;
}

export function logUsage(db: Database, usage: TokenUsage): void;
export function getSessionStats(db: Database, sessionId?: number): SessionStats;
export function getUsageHistory(db: Database, limit?: number): TokenUsage[];
export function resetSession(db: Database): void;
```

Cost estimation based on model:
- claude-opus-4-6: $15/M input, $75/M output
- claude-sonnet-4-6: $3/M input, $15/M output
- claude-haiku-4-5: $0.80/M input, $4/M output
- Cache read: 10% of input price
- Cache creation: 25% of input price

**Step 2: Implement omnidex_tokens tool**

Actions: `log`, `stats`, `history`, `reset`

```typescript
defineTool('tokens', 'Track token usage...', {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['log', 'stats', 'history', 'reset'] },
    input_tokens: { type: 'number' },
    output_tokens: { type: 'number' },
    cache_creation_tokens: { type: 'number' },
    cache_read_tokens: { type: 'number' },
    model: { type: 'string' },
    description: { type: 'string' },
    limit: { type: 'number' },
  },
  required: ['action'],
}, async (args) => { ... });
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: token usage tracking with cost estimation"
```

---

### Task 10: Integration, CLI, and Registration

**Files:**
- Modify: `src/index.ts` — add CLI commands (scan, init)
- Create: `src/commands/setup.ts` — `claude mcp add` helper

**Step 1: Add CLI mode to index.ts**

```typescript
const args = process.argv.slice(2);
if (args[0] === 'scan' || args[0] === 'init') {
  await indexProject(args[1] || process.cwd());
  process.exit(0);
}
// Default: start MCP server
const server = createServer();
await server.start();
```

**Step 2: Create setup command**

```typescript
// Registers omnidex with Claude Code
export async function setup() {
  execSync('claude mcp remove omnidex 2>/dev/null || true');
  execSync('claude mcp add omnidex -- omnidex');
  console.log('Omnidex registered with Claude Code');
}
```

**Step 3: Add to package.json bin**

Already done in Task 0. After `npm install -g .`, `omnidex` command should be available.

**Step 4: Build, install globally, register with Claude**

```bash
npm run build
npm install -g .
omnidex scan /Users/omar/development/HRIS
claude mcp add omnidex -- omnidex
claude mcp list | grep omnidex
```

Expected: `omnidex: omnidex (stdio) - Connected`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: CLI commands and Claude Code registration"
```

---

### Task 11: CLAUDE.md Policy Template

**Files:**
- Create: `src/policy.ts` — generates CLAUDE.md policy block

**Step 1: Create the policy generator**

Generates a CLAUDE.md policy block (similar to dual-graph's but for omnidex). The policy should be added to the project's CLAUDE.md by the user, not auto-injected.

```typescript
export function generatePolicy(): string {
  return `
# Omnidex Context Policy

This project uses Omnidex for code indexing and context recommendation.

## Mandatory workflow

1. Call \`omnidex_continue\` first — before any file exploration, grep, or code reading.
2. If \`needs_project=true\`: call \`omnidex_scan\` with the project path.
3. Read \`recommended_files\` using \`omnidex_read\` — one call per file.
4. Respect confidence levels:
   - high → Stop. Do not grep or explore further.
   - medium → At most \`max_supplementary_greps\` greps, \`max_supplementary_files\` additional reads.
   - low → At most \`max_supplementary_greps\` greps, \`max_supplementary_files\` additional reads.
5. After edits, call \`omnidex_update\` with changed files.

## Prefer Omnidex over Grep/Glob

| Task | Use |
|------|-----|
| Find a function/class | \`omnidex_query\` |
| See methods in a file | \`omnidex_signature\` |
| Explore multiple files | \`omnidex_signatures\` |
| Project overview | \`omnidex_summary\` + \`omnidex_tree\` |
`;
}
```

**Step 2: Add `omnidex policy` CLI command that prints the policy**

```bash
omnidex policy >> CLAUDE.md
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: CLAUDE.md policy template generator"
```

---

### Task 12: End-to-End Testing on HRIS

**Step 1: Remove dual-graph and AiDex from HRIS**

```bash
claude mcp remove dual-graph
# Kill running dual-graph server
kill $(cat /Users/omar/development/HRIS/.dual-graph/mcp_server.pid) 2>/dev/null || true
```

Do NOT delete `.dual-graph/` or `.aidex/` directories yet — keep as backup.

**Step 2: Register omnidex**

```bash
claude mcp add omnidex -- omnidex
```

**Step 3: Index HRIS**

```bash
omnidex scan /Users/omar/development/HRIS
```

**Step 4: Update HRIS CLAUDE.md**

Replace the dual-graph policy section with the omnidex policy.

**Step 5: Start a new Claude Code session and verify**

Test these flows:
- `omnidex_continue` returns sensible recommendations for "department versioning"
- `omnidex_query` finds `DepartmentVersion` class
- `omnidex_signature` shows methods for a specific file
- `omnidex_read` with `file::symbol` notation works
- `omnidex_tokens` logs and shows stats
- `omnidex_session` detects changed files
- `omnidex_task` CRUD works

**Step 6: Clean up old tools if everything works**

```bash
rm -rf /Users/omar/development/HRIS/.dual-graph
rm -rf /Users/omar/development/HRIS/.aidex
# Remove dual-graph hooks from settings.local.json
# Remove aidex from .mcp.json
```

**Step 7: Commit HRIS changes**

```bash
git add -A
git commit -m "chore: migrate from dual-graph + aidex to omnidex"
```
