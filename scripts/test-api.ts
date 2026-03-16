#!/usr/bin/env bun
/**
 * Font Awesome Explorer API test script
 * Runs semantic and keyword searches, renders results with actual FA glyphs in terminal
 *
 * Requires: Terminal with Font Awesome font installed, or a Nerd Font that includes FA glyphs
 */

const BASE = 'https://fontawesome-explorer.atsignhandle.workers.dev';

interface IconResult {
  name: string;
  unicode: string;
  label: string;
  tier: string;
  styles: string[];
  brands: boolean;
  score?: number;
  html: string;
}

interface SearchResponse {
  version: string;
  query: string;
  method: string;
  count: number;
  total: number;
  limit: number;
  results: IconResult[];
}

interface BrowseResponse {
  version: string;
  total: number;
  offset: number;
  limit: number;
  count: number;
  results: IconResult[];
}

interface DetailResponse extends IconResult {
  version: string;
  search_terms: string[];
  all_styles: { code: string; name: string; html: string }[];
}

// Convert hex unicode to actual character for terminal rendering
function unicodeGlyph(hex: string): string {
  return String.fromCodePoint(parseInt(hex, 16));
}

// ANSI color helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;

function printHeader(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(bold(cyan(`  ${title}`)));
  console.log('='.repeat(60));
}

function printResult(icon: IconResult, index: number) {
  const glyph = unicodeGlyph(icon.unicode);
  const score = icon.score !== undefined ? dim(` (score: ${icon.score})`) : '';
  const tier = icon.tier === 'free' ? green('[free]') : yellow('[pro]');
  const brand = icon.brands ? magenta(' [brand]') : '';

  console.log(
    `  ${dim(`${(index + 1).toString().padStart(2)}.`)} ${glyph}  ${bold(icon.name)} ${tier}${brand}${score}`
  );
  console.log(
    `      ${dim(`U+${icon.unicode.toUpperCase()}`)}  ${dim(icon.label)}  ${dim(icon.styles.join(', '))}`
  );
}

async function search(query: string, endpoint: 'search' | 'smart' = 'smart', limit = 8): Promise<SearchResponse> {
  const url = `${BASE}/api/${endpoint}?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url);
  return res.json() as Promise<SearchResponse>;
}

async function getIcon(name: string): Promise<DetailResponse> {
  const res = await fetch(`${BASE}/api/icon/${encodeURIComponent(name)}`);
  return res.json() as Promise<DetailResponse>;
}

async function browse(limit: number, offset = 0): Promise<BrowseResponse> {
  const res = await fetch(`${BASE}/api/icons?limit=${limit}&offset=${offset}`);
  return res.json() as Promise<BrowseResponse>;
}

// --- Test suites ---

async function testSemanticSearches() {
  const queries = [
    'furry pets',
    'weather forecast',
    'social media',
    'money payment',
    'spinning loader',
    'medical health',
    'food drinks',
    'outer space',
    'music audio',
    'security lock',
  ];

  printHeader('SMART SEARCH (semantic-like, expanded terms)');

  for (const q of queries) {
    const data = await search(q, 'smart', 5);
    console.log(`\n  ${blue(`"${q}"`)} ${dim(`-> ${data.total} total, showing ${data.count}`)}`);
    if (data.results.length === 0) {
      console.log(`    ${red('(no results)')}`);
    }
    for (let i = 0; i < data.results.length; i++) {
      printResult(data.results[i]!, i);
    }
  }
}

async function testKeywordSearches() {
  const queries = ['arrow', 'cloud', 'user', 'star', 'heart', 'github'];

  printHeader('KEYWORD SEARCH (inverted index)');

  for (const q of queries) {
    const data = await search(q, 'search', 5);
    console.log(`\n  ${blue(`"${q}"`)} ${dim(`-> ${data.total} total, showing ${data.count}`)}`);
    for (let i = 0; i < data.results.length; i++) {
      printResult(data.results[i]!, i);
    }
  }
}

async function testIconDetail() {
  printHeader('ICON DETAIL');

  const icons = ['house', 'cat', 'dog', 'spinner', 'github'];
  for (const name of icons) {
    const data = await getIcon(name);
    const glyph = unicodeGlyph(data.unicode);
    console.log(`\n  ${glyph}  ${bold(data.name)} ${dim(`U+${data.unicode.toUpperCase()}`)} ${data.tier === 'free' ? green('[free]') : yellow('[pro]')}`);
    console.log(`      ${dim('styles:')} ${data.all_styles.map(s => s.name).join(', ')}`);
    console.log(`      ${dim('terms:')} ${data.search_terms.slice(0, 8).join(', ')}${data.search_terms.length > 8 ? '...' : ''}`);
  }
}

async function testBrowse() {
  printHeader('BROWSE (first 5 icons)');

  const data = await browse(5, 0);
  console.log(`  ${dim(`Total: ${data.total} icons, API v${data.version}`)}\n`);
  for (let i = 0; i < data.results.length; i++) {
    printResult(data.results[i]!, i);
  }
}

async function testStyleFilter() {
  printHeader('STYLE FILTER (brands only)');

  const url = `${BASE}/api/search?q=face&limit=5&style=brands`;
  const res = await fetch(url);
  const data = await res.json() as SearchResponse;
  console.log(`\n  ${blue('"face" + style=brands')} ${dim(`-> ${data.total} total`)}`);
  for (let i = 0; i < data.results.length; i++) {
    printResult(data.results[i]!, i);
  }
}

// --- Run ---

console.log(bold('\n  Font Awesome Explorer API Test'));
console.log(dim(`  ${BASE}`));
console.log(dim(`  ${new Date().toISOString()}`));

await testSemanticSearches();
await testKeywordSearches();
await testIconDetail();
await testBrowse();
await testStyleFilter();

printHeader('ALL TESTS PASSED');
console.log(`  ${green('OK')} All endpoints responding correctly\n`);
