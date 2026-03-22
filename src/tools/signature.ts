import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';

interface FileRecord {
  id: number;
  path: string;
}

interface TypeRecord {
  id: number;
  file_id: number;
  name: string;
  kind: string;
  line_number: number;
}

interface MethodRecord {
  id: number;
  file_id: number;
  name: string;
  prototype: string;
  line_number: number;
  visibility: string | null;
  is_static: number;
  is_async: number;
}

interface SignatureRecord {
  file_id: number;
  header_comments: string | null;
}

export function getFileSignature(
  q: ReturnType<typeof createQueries>,
  fileId: number,
  filePath: string,
): string {
  const sig = q.getSignatureByFile.get(fileId) as SignatureRecord | undefined;
  const types = q.getTypesByFile.all(fileId) as TypeRecord[];
  const methods = q.getMethodsByFile.all(fileId) as MethodRecord[];

  const lines: string[] = [];
  lines.push(`── ${filePath}`);

  if (sig?.header_comments) {
    lines.push(sig.header_comments);
    lines.push('');
  }

  // Group methods by the type they belong to (by line range)
  const sortedTypes = [...types].sort((a, b) => a.line_number - b.line_number);
  const sortedMethods = [...methods].sort((a, b) => a.line_number - b.line_number);

  // Assign methods to types based on line proximity
  const assignedMethods = new Set<number>();

  for (const type of sortedTypes) {
    lines.push(`  ${type.kind} ${type.name} (L${type.line_number})`);

    // Find methods that belong to this type (between this type and next type)
    const nextType = sortedTypes.find((t) => t.line_number > type.line_number);
    const upperBound = nextType ? nextType.line_number : Infinity;

    for (const method of sortedMethods) {
      if (
        method.line_number > type.line_number &&
        method.line_number < upperBound &&
        !assignedMethods.has(method.id)
      ) {
        assignedMethods.add(method.id);
        const prefix = method.visibility ? `${method.visibility} ` : '';
        const staticStr = method.is_static ? 'static ' : '';
        const asyncStr = method.is_async ? 'async ' : '';
        lines.push(`    ${prefix}${staticStr}${asyncStr}${method.prototype} (L${method.line_number})`);
      }
    }
  }

  // Any unassigned methods (top-level functions)
  const unassigned = sortedMethods.filter((m) => !assignedMethods.has(m.id));
  if (unassigned.length > 0) {
    if (sortedTypes.length > 0) lines.push('');
    for (const method of unassigned) {
      const prefix = method.visibility ? `${method.visibility} ` : '';
      const staticStr = method.is_static ? 'static ' : '';
      const asyncStr = method.is_async ? 'async ' : '';
      lines.push(`  ${prefix}${staticStr}${asyncStr}${method.prototype} (L${method.line_number})`);
    }
  }

  return lines.join('\n');
}

export function register() {
  defineTool(
    'signature',
    'Get the structural signature of a single file: types, methods, and header comments.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        file: { type: 'string', description: 'Relative path to the file within the project' },
      },
      required: ['path', 'file'],
    },
    async (args) => {
      const path = args.path as string;
      const file = args.file as string;

      const db = openDatabase(path);
      try {
        const q = createQueries(db);
        const fileRow = q.getFileByPath.get(file) as FileRecord | undefined;
        if (!fileRow) {
          return {
            content: [{ type: 'text' as const, text: `File not found in index: ${file}` }],
            isError: true as const,
          };
        }

        const output = getFileSignature(q, fileRow.id, file);
        return {
          content: [{ type: 'text' as const, text: output }],
        };
      } finally {
        db.close();
      }
    },
  );
}
