# Omnidex

Code indexing + context recommendation MCP server for Claude Code.

A single, transparent, zero-telemetry MCP server for code indexing and context recommendation. It indexes your codebase using tree-sitter, builds a file relationship graph, and recommends which files to read based on your query — so Claude spends tokens on the right code, not exploring.

## Features

- **Context recommender** — `omnidex_continue` analyzes your query and recommends the most relevant files before you explore
- **Symbol search** — find functions, classes, variables by name with `omnidex_query`
- **File signatures** — see types and methods in a file without reading it with `omnidex_signature`
- **Import graph** — understands which files depend on which, boosting related files in recommendations
- **Session management** — tracks changes between sessions, auto-reindexes modified files
- **Task backlog** — create/track tasks that persist across sessions
- **Token tracking** — log and monitor token usage with cost estimates

## Install

```bash
npm install -g omnidex
```

## Setup

```bash
# Register with Claude Code
omnidex setup

# Index your project
omnidex scan /path/to/your/project

# Generate CLAUDE.md policy (optional — guides Claude to use omnidex)
omnidex policy >> CLAUDE.md
```

## How it works

1. **Indexing** — Omnidex walks your codebase, parses files with tree-sitter, and stores symbols (classes, methods, types, imports) in a local SQLite database at `.omnidex/index.db`
2. **Graph building** — Import/using statements are resolved to build edges between files
3. **Recommending** — When Claude asks `omnidex_continue("fix department versioning")`, Omnidex:
   - Extracts keywords, generates compound variants (`departmentversion`, `departmentversioning`)
   - Searches the symbol index with IDF weighting (rare terms score higher)
   - Boosts files with matching type/method names
   - Expands via the import graph (files connected to top results get a boost)
   - Applies conjunction bonus (files matching ALL keywords rank higher)
   - Returns the top 5 files with a confidence level

## Tools (17 total)

| Tool | Description |
|------|-------------|
| `omnidex_scan` | Index or re-index a project |
| `omnidex_update` | Re-index a single changed file |
| `omnidex_continue` | Recommend files for the current task |
| `omnidex_read` | Read a file or specific symbol (`file::symbol`) |
| `omnidex_query` | Search symbols by name (exact/contains/starts_with) |
| `omnidex_signature` | Get types + methods for a file |
| `omnidex_signatures` | Batch signatures via glob pattern |
| `omnidex_tree` | Project file tree |
| `omnidex_files` | List files by type/pattern |
| `omnidex_summary` | Project overview with top types and entry points |
| `omnidex_describe` | Add project description sections |
| `omnidex_session` | Start session, detect and reindex changed files |
| `omnidex_note` | Read/write session notes |
| `omnidex_task` | Create/read/update/delete tasks |
| `omnidex_tasks` | List and filter tasks |
| `omnidex_tokens` | Log and track token usage |
| `omnidex_fallback_rg` | Controlled ripgrep fallback |

## Supported languages

Tree-sitter parsers for: **C#**, **TypeScript/JavaScript**, **Python**, **Java**, **Go**. Other languages use a regex-based fallback.

## Design principles

- **Zero telemetry** — no heartbeats, no analytics, no external network calls
- **100% readable source** — TypeScript, no compiled binaries
- **stdio transport** — standard MCP protocol, no HTTP server or port management
- **Local storage** — everything in `.omnidex/` (gitignored), SQLite for the index
- **Token efficient** — compact response formats, truncation limits, grouped results

## Data stored

All data is local in `.omnidex/`:

```
.omnidex/
├── index.db       # SQLite database with all indexed data
└── summary.md     # Optional project description
```

## License

MIT
