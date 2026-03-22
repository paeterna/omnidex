import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';

interface ProjectFileRecord {
  id: number;
  path: string;
  type: string;
  extension: string | null;
  indexed: number;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
  stats?: { items: number; methods: number; types: number };
}

function buildTree(files: ProjectFileRecord[], subpath?: string): TreeNode {
  const root: TreeNode = { name: '', children: new Map(), isFile: false };

  for (const file of files) {
    let path = file.path;
    if (subpath) {
      if (!path.startsWith(subpath)) continue;
      path = path.slice(subpath.length).replace(/^\//, '');
      if (!path) continue;
    }

    const parts = path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          children: new Map(),
          isFile: i === parts.length - 1,
        });
      }
      current = current.children.get(part)!;
    }
  }

  return root;
}

function renderTree(node: TreeNode, prefix: string, depth: number, maxDepth?: number): string[] {
  if (maxDepth !== undefined && depth > maxDepth) return [];

  const lines: string[] = [];
  const entries = [...node.children.entries()].sort(([a, aNode], [b, bNode]) => {
    // Directories first, then files
    if (!aNode.isFile && bNode.isFile) return -1;
    if (aNode.isFile && !bNode.isFile) return 1;
    return a.localeCompare(b);
  });

  for (let i = 0; i < entries.length; i++) {
    const [, child] = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    let label = child.name;
    if (child.stats) {
      const parts: string[] = [];
      if (child.stats.types > 0) parts.push(`${child.stats.types}T`);
      if (child.stats.methods > 0) parts.push(`${child.stats.methods}M`);
      if (child.stats.items > 0) parts.push(`${child.stats.items}I`);
      if (parts.length > 0) label += ` (${parts.join(', ')})`;
    }

    lines.push(`${prefix}${connector}${label}`);

    if (!child.isFile) {
      lines.push(...renderTree(child, prefix + childPrefix, depth + 1, maxDepth));
    }
  }

  return lines;
}

export function register() {
  defineTool(
    'tree',
    'Display the project file tree, optionally with per-file statistics (type/method/item counts).',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        subpath: { type: 'string', description: 'Relative subdirectory to show (default: root)' },
        depth: { type: 'number', description: 'Max depth of tree (default: unlimited)' },
        include_stats: { type: 'boolean', description: 'Include per-file item/method/type counts' },
      },
      required: ['path'],
    },
    async (args) => {
      const path = args.path as string;
      const subpath = args.subpath as string | undefined;
      const depth = args.depth as number | undefined;
      const includeStats = args.include_stats as boolean | undefined;

      const db = openDatabase(path);
      try {
        const q = createQueries(db);
        const allFiles = q.getAllProjectFiles.all() as ProjectFileRecord[];
        const tree = buildTree(allFiles, subpath);

        // Attach stats if requested
        if (includeStats) {
          const fileRecords = q.getAllFiles.all() as Array<{ id: number; path: string }>;
          const fileIdByPath = new Map<string, number>();
          for (const f of fileRecords) fileIdByPath.set(f.path, f.id);

          const attachStats = (node: TreeNode, currentPath: string) => {
            for (const [name, child] of node.children) {
              const childPath = currentPath ? `${currentPath}/${name}` : name;
              if (child.isFile) {
                const fileId = fileIdByPath.get(childPath) ?? fileIdByPath.get(subpath ? `${subpath}/${childPath}` : childPath);
                if (fileId !== undefined) {
                  const methods = q.getMethodsByFile.all(fileId) as unknown[];
                  const types = q.getTypesByFile.all(fileId) as unknown[];
                  const items = db
                    .prepare('SELECT COUNT(*) as cnt FROM occurrences WHERE file_id = ?')
                    .get(fileId) as { cnt: number };
                  child.stats = {
                    methods: methods.length,
                    types: types.length,
                    items: items.cnt,
                  };
                }
              }
              attachStats(child, childPath);
            }
          };
          attachStats(tree, '');
        }

        const projectName = subpath || (path.split('/').pop() ?? '');
        const lines = [`${projectName}/`, ...renderTree(tree, '', 0, depth)];

        if (lines.length > 200) {
          const truncated = lines.slice(0, 200).join('\n');
          return {
            content: [{ type: 'text' as const, text: truncated + '\n\n... truncated (' + lines.length + ' total lines). Use subpath parameter to explore specific directories.' }],
          };
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } finally {
        db.close();
      }
    },
  );
}
