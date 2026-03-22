#!/usr/bin/env node
/**
 * Comprehensive comparison: Omnidex vs AiDex vs Dual-Graph
 * Uses proper MCP client for all three tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDatabase } from '../build/db/database.js';
import { recommend } from '../build/recommender/recommender.js';
import { parse } from '../build/parser/parser.js';
import { scanProject } from '../build/indexer/scanner.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const HRIS = '/Users/omar/development/HRIS';
const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️';
let passed = 0, failed = 0, warned = 0;

function assert(condition, testName, details = '') {
  if (condition) { console.log(`${PASS} ${testName}`); passed++; }
  else { console.log(`${FAIL} ${testName}${details ? ': ' + details : ''}`); failed++; }
}

function warn(testName, details) { console.log(`${WARN} ${testName}: ${details}`); warned++; }

// ── MCP Clients ──────────────────────────────────────────────

let aidexClient, dualGraphClient, omnidexClient;

async function setupClients() {
  // AiDex (stdio)
  console.log('Connecting AiDex...');
  const aidexTransport = new StdioClientTransport({ command: 'aidex', args: [] });
  aidexClient = new Client({ name: 'test-aidex', version: '1.0' }, { capabilities: {} });
  await aidexClient.connect(aidexTransport);
  console.log('  AiDex connected');

  // Dual-Graph (HTTP streamable)
  console.log('Connecting Dual-Graph...');
  const dgTransport = new StreamableHTTPClientTransport(new URL('http://localhost:8080/mcp'));
  dualGraphClient = new Client({ name: 'test-dg', version: '1.0' }, { capabilities: {} });
  await dualGraphClient.connect(dgTransport);
  console.log('  Dual-Graph connected');

  // Omnidex (stdio)
  console.log('Connecting Omnidex...');
  const omnidexTransport = new StdioClientTransport({ command: 'omnidex', args: [] });
  omnidexClient = new Client({ name: 'test-omnidex', version: '1.0' }, { capabilities: {} });
  await omnidexClient.connect(omnidexTransport);
  console.log('  Omnidex connected');
}

async function teardownClients() {
  try { await aidexClient?.close(); } catch {}
  try { await dualGraphClient?.close(); } catch {}
  try { await omnidexClient?.close(); } catch {}
}

function getText(result) {
  return result?.content?.[0]?.text || '';
}

function parseJson(result) {
  try { return JSON.parse(getText(result)); } catch { return null; }
}

// ── Helpers ──────────────────────────────────────────────────

async function aidexQuery(term, mode = 'exact', limit = 20) {
  const r = await aidexClient.callTool({ name: 'aidex_query', arguments: { path: HRIS, term, mode, limit } });
  return getText(r);
}

async function aidexSignature(file) {
  const r = await aidexClient.callTool({ name: 'aidex_signature', arguments: { path: HRIS, file } });
  return getText(r);
}

async function dgContinue(query) {
  const r = await dualGraphClient.callTool({ name: 'graph_continue', arguments: { query } });
  return parseJson(r);
}

async function dgRead(file) {
  const r = await dualGraphClient.callTool({ name: 'graph_read', arguments: { file } });
  return getText(r);
}

async function omnidexQuery(term, mode = 'exact', limit = 20) {
  const r = await omnidexClient.callTool({ name: 'omnidex_query', arguments: { path: HRIS, term, mode, limit } });
  return parseJson(r);
}

async function omnidexSignature(file) {
  const r = await omnidexClient.callTool({ name: 'omnidex_signature', arguments: { path: HRIS, file } });
  return getText(r);
}

async function omnidexContinue(query) {
  const r = await omnidexClient.callTool({ name: 'omnidex_continue', arguments: { path: HRIS, query } });
  return parseJson(r);
}

async function omnidexRead(file) {
  const r = await omnidexClient.callTool({ name: 'omnidex_read', arguments: { path: HRIS, file } });
  return getText(r);
}

// ── Tests ────────────────────────────────────────────────────

async function main() {
  await setupClients();

  console.log('\n' + '='.repeat(80));
  console.log('OMNIDEX vs AIDEX vs DUAL-GRAPH — Comprehensive Comparison');
  console.log('='.repeat(80));

  // ═══════════════════════════════════════════════════════════
  // SECTION 1: EXACT SYMBOL SEARCH
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 1. EXACT SYMBOL SEARCH\n');

  const exactTerms = [
    'Department', 'DepartmentVersion', 'PositionId', 'LeaveBalance',
    'GetDepartmentTreeQueryHandler', 'StartupMigrationService',
    'TenantsDbContext', 'IEmployeeRepository',
  ];

  for (const term of exactTerms) {
    const aidex = await aidexQuery(term, 'exact', 5);
    const omnidex = await omnidexQuery(term, 'exact', 5);

    // Parse counts
    const aidexMatch = aidex.match(/Found (\d+) match/);
    const aidexCount = aidexMatch ? parseInt(aidexMatch[1]) : 0;
    const omnidexCount = omnidex?.length || 0;

    const bothFound = aidexCount > 0 && omnidexCount > 0;
    const eitherFound = aidexCount > 0 || omnidexCount > 0;

    if (bothFound) {
      assert(true, `"${term}": aidex=${aidexCount}, omnidex=${omnidexCount}`);
    } else if (eitherFound) {
      warn(`"${term}"`, `aidex=${aidexCount}, omnidex=${omnidexCount} — one missed`);
    } else {
      assert(false, `"${term}": both returned 0`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: CONTAINS SEARCH
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 2. CONTAINS SEARCH\n');

  const containsTerms = ['Department', 'Version', 'Leave', 'Employee', 'Position'];

  for (const term of containsTerms) {
    const aidex = await aidexQuery(term, 'contains', 5);
    const omnidex = await omnidexQuery(term, 'contains', 5);

    const aidexMatch = aidex.match(/Found (\d+) match/);
    const aidexCount = aidexMatch ? parseInt(aidexMatch[1]) : 0;
    const omnidexCount = omnidex?.length || 0;

    assert(aidexCount > 0 && omnidexCount > 0,
      `Contains "${term}": aidex=${aidexCount}, omnidex=${omnidexCount}`);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 3: SIGNATURE COMPARISON
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 3. SIGNATURE COMPARISON\n');

  const sigFiles = [
    'src/Modules/HrMaster/HRIS.Modules.HrMaster.Domain/Aggregates/Department/Department.cs',
    'src/Modules/HrMaster/HRIS.Modules.HrMaster.Api/Controllers/DepartmentsController.cs',
  ];

  for (const file of sigFiles) {
    const shortName = file.split('/').pop();
    const aidexSig = await aidexSignature(file);
    const omnidexSig = await omnidexSignature(file);

    const aidexHasMethods = aidexSig.includes('(') && aidexSig.includes(')');
    const omnidexHasMethods = omnidexSig.includes('(') && omnidexSig.includes(')');

    assert(aidexHasMethods && omnidexHasMethods,
      `Signature ${shortName}: both have methods`,
      `aidex=${aidexHasMethods}, omnidex=${omnidexHasMethods}`);

    // Compare method count roughly
    const aidexMethodCount = (aidexSig.match(/\(/g) || []).length;
    const omnidexMethodCount = (omnidexSig.match(/\(/g) || []).length;
    console.log(`   AiDex: ~${aidexMethodCount} methods, Omnidex: ~${omnidexMethodCount} methods`);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 4: RECOMMENDER — omnidex_continue vs graph_continue
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 4. RECOMMENDER: omnidex_continue vs graph_continue\n');

  const recQueries = [
    'department versioning',
    'add a new field to position',
    'fix leave balance calculation',
    'employee onboarding workflow',
    'angular position dialog component',
    'EF Core migration for HrMaster module',
    'fix authentication middleware',
    'API endpoint for departments',
    'tenant schema migration',
    'i18n translation keys',
  ];

  for (const query of recQueries) {
    const omnidex = await omnidexContinue(query);
    const dg = await dgContinue(query);

    const omnidexFiles = omnidex?.recommended_files?.map(f => f.file?.split('/').pop()) || [];
    const dgFiles = (dg?.recommended_files || []).map(f => {
      const file = typeof f === 'string' ? f : f.file;
      return file?.split('/').pop();
    });

    const omnidexConf = omnidex?.confidence || 'N/A';
    const dgConf = dg?.confidence || 'N/A';

    console.log(`  Query: "${query}"`);
    console.log(`    Omnidex [${omnidexConf}]: ${omnidexFiles.join(', ') || 'none'}`);
    console.log(`    DualG   [${dgConf}]: ${dgFiles.join(', ') || 'none'}`);

    // Both should return something
    const omnidexOk = omnidexFiles.length > 0;
    const dgOk = dgFiles.length > 0;

    if (omnidexOk && dgOk) {
      // Check overlap — do they recommend similar files?
      const omnidexSet = new Set(omnidexFiles.map(f => f?.toLowerCase()));
      const overlap = dgFiles.filter(f => omnidexSet.has(f?.toLowerCase())).length;
      const overlapPct = Math.round((overlap / Math.max(dgFiles.length, 1)) * 100);
      console.log(`    Overlap: ${overlap}/${dgFiles.length} (${overlapPct}%)`);
      assert(true, `    → Both returned results for "${query.substring(0, 35)}"`);
    } else if (omnidexOk) {
      warn(`    → "${query.substring(0, 35)}"`, `omnidex returned results but dual-graph didn't`);
    } else {
      assert(false, `    → "${query.substring(0, 35)}"`, 'omnidex returned no results');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 5: READ — omnidex_read vs graph_read
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 5. FILE READ COMPARISON\n');

  const readFiles = [
    'src/Modules/HrMaster/HRIS.Modules.HrMaster.Domain/Aggregates/Department/Department.cs',
    'hris-web/src/app/api-client/api/departments.service.ts',
  ];

  for (const file of readFiles) {
    const shortName = file.split('/').pop();
    const omnidexContent = await omnidexRead(file);
    const dgContent = await dgRead(file);

    const omnidexLines = omnidexContent.split('\n').length;
    const dgLines = dgContent.split('\n').length;

    assert(omnidexLines > 5 && dgLines > 0,
      `Read ${shortName}: omnidex=${omnidexLines} lines, dual-graph=${dgLines} lines`);
  }

  // Symbol read (file::symbol)
  console.log('\n  Symbol read (file::symbol):');
  {
    const file = 'src/Modules/HrMaster/HRIS.Modules.HrMaster.Domain/Aggregates/Department/Department.cs::Department';
    const omnidexContent = await omnidexRead(file);
    const dgContent = await dgRead(file);

    const omnidexLines = omnidexContent.split('\n').length;
    const dgLines = dgContent.split('\n').length;

    // Symbol read should be shorter than full file
    assert(omnidexLines > 0 && omnidexLines < 200,
      `Symbol read omnidex: ${omnidexLines} lines (should be partial)`);
    assert(dgLines > 0,
      `Symbol read dual-graph: ${dgLines} lines`);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 6: EDGE CASES
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 6. EDGE CASES\n');

  // Empty query
  {
    const r = await omnidexContinue('');
    assert(r?.ok === true, 'Empty query: ok=true');
    assert(r?.confidence === 'low', 'Empty query: low confidence', `got ${r?.confidence}`);
  }

  // Nonsense query
  {
    const r = await omnidexContinue('xyzzy foobarbaz qux');
    assert(r?.ok === true, 'Nonsense query: ok=true');
    assert(r?.confidence === 'low', 'Nonsense query: low confidence', `got ${r?.confidence}`);
  }

  // Very long query
  {
    const r = await omnidexContinue('department '.repeat(100));
    assert(r?.ok === true, 'Very long query: ok=true (no crash)');
  }

  // Special characters
  {
    const r = await omnidexContinue("it's a test with 'quotes' and \"double\" and (parens) and {braces}");
    assert(r?.ok === true, 'Special characters: ok=true');
  }

  // SQL injection
  {
    const r = await omnidexContinue("'; DROP TABLE files; --");
    assert(r?.ok === true, 'SQL injection: ok=true');
    const db = openDatabase(HRIS);
    const count = db.prepare('SELECT COUNT(*) as c FROM files').get().c;
    db.close();
    assert(count > 0, 'Files table intact after injection', `count=${count}`);
  }

  // Unicode
  {
    const r = await omnidexContinue('قسم الموارد البشرية');
    assert(r?.ok === true, 'Unicode/Arabic query: ok=true');
  }

  // Non-existent file read
  {
    try {
      const r = await omnidexRead('nonexistent/file.ts');
      assert(r.includes('ENOENT') || r.includes('Error') || r === '', 'Non-existent file: error returned');
    } catch {
      assert(true, 'Non-existent file: threw error (expected)');
    }
  }

  // Query for a term that exists only once
  {
    const r = await omnidexQuery('StartupMigrationService', 'exact', 100);
    const fileCount = new Set((r || []).map(row => row.path)).size;
    assert(fileCount >= 1, `Rare term: found in ${fileCount} files`);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 7: PARSER EDGE CASES
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 7. PARSER EDGE CASES\n');

  // Empty file
  assert(parse('', 'empty.cs') !== undefined, 'Parse empty file: no crash');

  // Only comments
  {
    const r = parse('// Comment\n// Another\n', 'comments.cs');
    assert(r !== null, 'Parse comment-only: not null');
    assert(r?.headerComments?.length > 0, 'Parse comment-only: header comments found');
    assert(r?.methods?.length === 0, 'Parse comment-only: no methods');
  }

  // Syntax errors
  assert(parse('class Broken { method( { }', 'broken.cs') !== null, 'Parse syntax error: tree-sitter error-tolerant');

  // Large file
  {
    let large = 'using System;\n';
    for (let i = 0; i < 1000; i++) large += `public class C${i} { public void M${i}() {} }\n`;
    const r = parse(large, 'large.cs');
    assert(r !== null, 'Parse 1000-class file: ok');
    assert(r?.types?.length >= 500, `Parse 1000-class file: ${r?.types?.length} types found`);
  }

  // Angular component
  {
    const r = parse(`import { Component } from '@angular/core';\n@Component({ template: '<div>hello</div>' })\nexport class TestComponent {}`, 'test.ts');
    assert(r !== null && r?.types?.length > 0, 'Parse Angular component: class found');
  }

  // Deeply nested C#
  {
    const r = parse(`
namespace A.B.C {
  public class Outer {
    public class Inner {
      public void DeepMethod() {}
    }
    public void OuterMethod() {}
  }
}`, 'nested.cs');
    assert(r !== null, 'Parse nested classes: ok');
    assert(r?.methods?.length >= 2, `Parse nested classes: ${r?.methods?.length} methods found`);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 8: SCANNER EDGE CASES
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 8. SCANNER EDGE CASES\n');

  {
    const files = await scanProject(HRIS);
    assert(!files.some(f => f.relativePath.includes('node_modules')), 'Scanner: no node_modules');
    assert(!files.some(f => f.relativePath.match(/\/(bin|obj)\//)), 'Scanner: no bin/obj');
    assert(!files.some(f => f.relativePath.startsWith('.git/')), 'Scanner: no .git');
    assert(files.some(f => f.language === 'csharp'), 'Scanner: found C# files');
    assert(files.some(f => f.language === 'typescript'), 'Scanner: found TypeScript files');
    assert(files.some(f => f.type === 'config'), 'Scanner: found config files');
    assert(files.some(f => f.type === 'doc'), 'Scanner: found doc files');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 9: GRAPH EDGE QUALITY
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 9. GRAPH EDGE QUALITY\n');

  {
    const db = openDatabase(HRIS);
    const edgeCount = db.prepare('SELECT COUNT(*) as c FROM edges').get().c;
    assert(edgeCount > 1000, `Edge count: ${edgeCount} (expected >1000)`);

    const edgeTypes = db.prepare('SELECT edge_type, COUNT(*) as c FROM edges GROUP BY edge_type').all();
    console.log(`  Edge types: ${edgeTypes.map(e => `${e.edge_type}:${e.c}`).join(', ')}`);

    // Controller → Domain edges
    const ctrl = db.prepare("SELECT id FROM files WHERE path LIKE '%DepartmentsController%'").get();
    if (ctrl) {
      const outEdges = db.prepare('SELECT f.path FROM edges e JOIN files f ON e.target_file_id = f.id WHERE e.source_file_id = ?').all(ctrl.id);
      assert(outEdges.length > 0, `DepartmentsController outgoing edges: ${outEdges.length}`);
    }

    // Domain entity inbound edges
    const dept = db.prepare("SELECT id FROM files WHERE path LIKE '%/Department.cs' AND path LIKE '%Aggregates%'").get();
    if (dept) {
      const inEdges = db.prepare('SELECT f.path FROM edges e JOIN files f ON e.source_file_id = f.id WHERE e.target_file_id = ?').all(dept.id);
      assert(inEdges.length > 0, `Department.cs inbound edges: ${inEdges.length}`);
    }

    db.close();
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 10: RECOMMENDER RELEVANCE QUALITY
  // ═══════════════════════════════════════════════════════════
  console.log('\n## 10. RECOMMENDER RELEVANCE\n');

  // Each test checks that recommended files are topically relevant

  {
    const r = await omnidexContinue('DepartmentVersion effective date');
    const files = r?.recommended_files?.map(f => f.file) || [];
    assert(files.some(f => f.toLowerCase().includes('department')),
      'DepartmentVersion → Department files', files.map(f => f.split('/').pop()).join(', '));
  }

  {
    const r = await omnidexContinue('angular component position dialog');
    const files = r?.recommended_files?.map(f => f.file) || [];
    assert(files.some(f => f.includes('hris-web') || f.endsWith('.ts') || f.endsWith('.html')),
      'Angular query → frontend files', files.map(f => f.split('/').pop()).join(', '));
  }

  {
    const r = await omnidexContinue('EF Core migration add column');
    const files = r?.recommended_files?.map(f => f.file) || [];
    assert(files.some(f => f.toLowerCase().includes('migration') || f.toLowerCase().includes('infrastructure') || f.toLowerCase().includes('dbcontext')),
      'Migration query → infrastructure files', files.map(f => f.split('/').pop()).join(', '));
  }

  {
    const r = await omnidexContinue('i18n translation arabic');
    const files = r?.recommended_files?.map(f => f.file) || [];
    assert(files.some(f => f.toLowerCase().includes('translat') || f.toLowerCase().includes('i18n') || f.toLowerCase().includes('localiz')),
      'i18n query → localization files', files.map(f => f.split('/').pop()).join(', '));
  }

  {
    const r = await omnidexContinue('leave request approval');
    const files = r?.recommended_files?.map(f => f.file) || [];
    assert(files.some(f => f.toLowerCase().includes('leave')),
      'Leave query → leave module files', files.map(f => f.split('/').pop()).join(', '));
  }

  // ═══════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${warned} warnings`);
  console.log('='.repeat(80));

  await teardownClients();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Test runner error:', err);
  await teardownClients();
  process.exit(1);
});
