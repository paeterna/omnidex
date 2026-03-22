import { defineTool } from './registry.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { INDEX_DIR } from '../constants.js';

export function register() {
  defineTool(
    'describe',
    'Add or update a section in the project summary (.omnidex/summary.md). Sections: purpose, architecture, concepts, patterns, notes.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        section: {
          type: 'string',
          enum: ['purpose', 'architecture', 'concepts', 'patterns', 'notes'],
          description: 'Which section to write',
        },
        content: { type: 'string', description: 'Content for the section' },
        replace: {
          type: 'boolean',
          description: 'Replace the section entirely (default: append)',
        },
      },
      required: ['path', 'section', 'content'],
    },
    async (args) => {
      const path = args.path as string;
      const section = args.section as string;
      const content = args.content as string;
      const replace = (args.replace as boolean) ?? false;

      const summaryPath = join(path, INDEX_DIR, 'summary.md');
      const dir = dirname(summaryPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      let existing = '';
      if (existsSync(summaryPath)) {
        existing = readFileSync(summaryPath, 'utf-8');
      }

      const heading = `## ${section.charAt(0).toUpperCase() + section.slice(1)}`;
      const sectionRegex = new RegExp(
        `(${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\n([\\s\\S]*?)(?=\\n## |$)`,
      );
      const match = existing.match(sectionRegex);

      let updated: string;
      if (match) {
        if (replace) {
          updated = existing.replace(sectionRegex, `${heading}\n${content}\n`);
        } else {
          updated = existing.replace(sectionRegex, `${heading}\n${match[2].trimEnd()}\n${content}\n`);
        }
      } else {
        // Append new section
        updated = existing.trimEnd() + (existing ? '\n\n' : '') + `${heading}\n${content}\n`;
      }

      writeFileSync(summaryPath, updated, 'utf-8');

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ updated: true, section, path: summaryPath }) }],
      };
    },
  );
}
