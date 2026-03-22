export function generatePolicy(): string {
  return `# Omnidex Context Policy

This project uses Omnidex for code indexing and context recommendation.

## Mandatory workflow

1. Call \`omnidex_continue\` first — before any file exploration, grep, or code reading.
2. If \`needs_project=true\`: call \`omnidex_scan\` with the project path.
3. If \`skip=true\`: project has fewer than 5 files. Do NOT explore broadly.
4. Read \`recommended_files\` using \`omnidex_read\` — one call per file.
   - Supports \`file::symbol\` notation (e.g., \`src/auth.ts::handleLogin\`).
5. Respect confidence levels:
   - \`high\` → Stop. Do NOT grep or explore further.
   - \`medium\` → At most \`max_supplementary_greps\` greps, \`max_supplementary_files\` additional reads.
   - \`low\` → At most \`max_supplementary_greps\` greps, \`max_supplementary_files\` additional reads.
6. After edits, call \`omnidex_update\` with changed files.

## Prefer Omnidex over Grep/Glob

| Task | Do NOT use | Use instead |
|------|-----------|-------------|
| Find a function/class/variable | \`Grep pattern="name"\` | \`omnidex_query term="name"\` |
| See all methods in a file | \`Read entire_file.cs\` | \`omnidex_signature file="..."\` |
| Explore multiple files | Multiple Read calls | \`omnidex_signatures pattern="src/**"\` |
| Project overview | Many Glob/Read calls | \`omnidex_summary\` + \`omnidex_tree\` |
| What changed recently? | \`git log\` + Read | \`omnidex_query term="X" modified_since="2h"\` |

## Token Tracking

Use \`omnidex_tokens\` to log and track token usage:
- \`omnidex_tokens action="log" input_tokens=N output_tokens=N model="claude-sonnet-4-6"\`
- \`omnidex_tokens action="stats"\` — session totals with cost estimate
- \`omnidex_tokens action="history"\` — usage log

## Rules

- Do NOT use \`rg\`, \`grep\`, or bash file exploration before calling \`omnidex_continue\`.
- Do NOT do broad/recursive exploration at any confidence level.
- \`max_supplementary_greps\` and \`max_supplementary_files\` are hard caps — never exceed them.
`;
}
