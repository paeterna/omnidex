import type Database from 'better-sqlite3';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  model?: string;
  description?: string;
}

export interface SessionStats {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  estimated_cost_usd: number;
  entries: number;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.80, output: 4 },
};

export function logUsage(db: Database.Database, usage: TokenUsage): void {
  db.prepare(
    'INSERT INTO token_usage (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, model, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    usage.input_tokens, usage.output_tokens,
    usage.cache_creation_tokens ?? 0, usage.cache_read_tokens ?? 0,
    usage.model ?? null, usage.description ?? null,
    Date.now()
  );
}

export function getSessionStats(db: Database.Database, sinceTimestamp?: number): SessionStats {
  const since = sinceTimestamp ?? 0;
  const rows = db.prepare('SELECT * FROM token_usage WHERE created_at >= ?').all(since) as any[];

  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
  let cost = 0;

  for (const row of rows) {
    totalInput += row.input_tokens;
    totalOutput += row.output_tokens;
    totalCacheCreate += row.cache_creation_tokens;
    totalCacheRead += row.cache_read_tokens;

    const pricing = MODEL_PRICING[row.model] ?? MODEL_PRICING['claude-sonnet-4-6'];
    cost += (row.input_tokens / 1_000_000) * pricing.input;
    cost += (row.output_tokens / 1_000_000) * pricing.output;
    cost += (row.cache_creation_tokens / 1_000_000) * pricing.input * 0.25;
    cost += (row.cache_read_tokens / 1_000_000) * pricing.input * 0.10;
  }

  return {
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cache_creation_tokens: totalCacheCreate,
    total_cache_read_tokens: totalCacheRead,
    estimated_cost_usd: Math.round(cost * 10000) / 10000,
    entries: rows.length,
  };
}

export function getUsageHistory(db: Database.Database, limit?: number): any[] {
  return db.prepare('SELECT * FROM token_usage ORDER BY created_at DESC LIMIT ?').all(limit ?? 50);
}

export function resetSession(db: Database.Database): void {
  db.prepare('DELETE FROM token_usage').run();
}
