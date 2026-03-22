import type { LanguageConfig } from '../types.js';
import { csharpConfig } from './csharp.js';
import { typescriptConfig } from './typescript.js';
import { pythonConfig } from './python.js';
import { javaConfig } from './java.js';
import { goConfig } from './go.js';

const configs: Record<string, LanguageConfig> = {
  csharp: csharpConfig,
  typescript: typescriptConfig,
  javascript: typescriptConfig, // JS uses the same tree-sitter grammar structure
  python: pythonConfig,
  java: javaConfig,
  go: goConfig,
};

export function getLanguageConfig(language: string): LanguageConfig | null {
  return configs[language] ?? null;
}
