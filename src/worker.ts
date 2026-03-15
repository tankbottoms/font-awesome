import iconsData from './data/icons.json';
import searchTermsData from './data/search-terms.json';

const API_VERSION = '1.0.0';

interface Icon {
  n: string;   // name
  u: string;   // unicode
  L: string;   // label
  T: string;   // tier: p=pro, f=free
  S: string[]; // styles
  B: number;   // brands flag
}

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const STYLE_MAP: Record<string, string> = {
  s: 'solid', r: 'regular', l: 'light', t: 'thin',
  d: 'duotone', ss: 'sharp-solid', sr: 'sharp-regular',
  sl: 'sharp-light', st: 'sharp-thin', b: 'brands'
};

const STYLE_CLASS: Record<string, string> = {
  s: 'fa-solid', r: 'fa-regular', l: 'fa-light', t: 'fa-thin',
  d: 'fa-duotone', ss: 'fa-sharp fa-solid', sr: 'fa-sharp fa-regular',
  sl: 'fa-sharp fa-light', st: 'fa-sharp fa-thin', b: 'fa-brands'
};

const STYLE_REVERSE: Record<string, string> = {
  solid: 's', regular: 'r', light: 'l', thin: 't',
  duotone: 'd', 'sharp-solid': 'ss', 'sharp-regular': 'sr',
  'sharp-light': 'sl', 'sharp-thin': 'st', brands: 'b'
};

const icons: Icon[] = iconsData as Icon[];
const searchTerms: Record<string, string[]> = searchTermsData as Record<string, string[]>;

// Build inverted index once per isolate
const invertedIndex = new Map<string, Set<string>>();
const iconSearchDocs = new Map<string, string>();

for (const icon of icons) {
  const parts = [icon.n, icon.n.replace(/-/g, ' '), icon.L.toLowerCase()];
  if (searchTerms[icon.n]) {
    parts.push(...searchTerms[icon.n]!.map(t => t.toLowerCase()));
  }
  const doc = parts.join(' ');
  iconSearchDocs.set(icon.n, doc);

  const tokens = new Set(doc.split(/[\s,;:]+/).filter(t => t.length > 1));
  for (const token of tokens) {
    if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
    invertedIndex.get(token)!.add(icon.n);
  }
}

const iconMap = new Map<string, Icon>(icons.map(i => [i.n, i]));

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function formatIcon(icon: Icon, score?: number) {
  const preferredStyle = icon.B ? 'b' : (icon.S.includes('s') ? 's' : icon.S[0]!);
  const cssClass = `${STYLE_CLASS[preferredStyle] ?? 'fa-solid'} fa-${icon.n}`;
  return {
    name: icon.n,
    unicode: icon.u,
    label: icon.L,
    tier: icon.T === 'p' ? 'pro' : 'free',
    styles: icon.S.map(s => STYLE_MAP[s]).filter(Boolean),
    brands: icon.B === 1,
    ...(score !== undefined ? { score } : {}),
    html: `<i class="${cssClass}"></i>`,
  };
}

function ftsSearch(query: string): { icon: Icon; score: number }[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Unicode shortcut
  if (/^[0-9a-f]{4,5}$/i.test(q)) {
    return icons
      .filter(i => i.u.toLowerCase() === q || i.u.toLowerCase().startsWith(q))
      .map(i => ({ icon: i, score: 10 }));
  }

  const qTokens = q.split(/[\s,;:]+/).filter(t => t.length > 0);
  const scores = new Map<string, number>();

  for (const qt of qTokens) {
    // Exact token match
    if (invertedIndex.has(qt)) {
      for (const name of invertedIndex.get(qt)!) {
        scores.set(name, (scores.get(name) || 0) + 3);
      }
    }
    // Prefix match
    for (const [token, names] of invertedIndex) {
      if (token !== qt && token.startsWith(qt)) {
        for (const name of names) {
          scores.set(name, (scores.get(name) || 0) + 1);
        }
      }
    }
    // Substring match on icon name
    for (const icon of icons) {
      if (icon.n.includes(qt)) {
        scores.set(icon.n, (scores.get(icon.n) || 0) + 2);
      }
    }
  }

  // Boost for name-starts-with
  for (const [name, score] of scores) {
    if (name.startsWith(q) || name.startsWith(q.replace(/ /g, '-'))) {
      scores.set(name, score + 5);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, score]) => ({ icon: iconMap.get(name)!, score }))
    .filter(r => r.icon);

  return ranked;
}

function smartSearch(query: string): { icon: Icon; score: number }[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Start with keyword results
  const keywordResults = ftsSearch(query);
  const scores = new Map<string, number>();
  for (const r of keywordResults) {
    scores.set(r.icon.n, r.score);
  }

  const qTokens = q.split(/[\s,;:]+/).filter(t => t.length > 0);

  // Expanded search through search terms
  for (const [iconName, terms] of Object.entries(searchTerms)) {
    const termsLower = terms.map(t => t.toLowerCase());
    let bonus = 0;

    for (const qt of qTokens) {
      for (const term of termsLower) {
        // Exact term match
        if (term === qt) {
          bonus += 3;
        }
        // Term starts with query token
        else if (term.startsWith(qt)) {
          bonus += 2;
        }
        // Multi-word phrase contains query token
        else if (term.includes(' ') && term.includes(qt)) {
          bonus += 2;
        }
        // Query token is a substring of term
        else if (term.includes(qt) && qt.length >= 3) {
          bonus += 1;
        }
      }
    }

    // Category match: if query matches a category name, boost all icons in that category
    for (const term of termsLower) {
      if (term === q || (q.length >= 3 && term.startsWith(q))) {
        // Check if this term looks like a category (capitalized in original)
        const originalTerm = terms[termsLower.indexOf(term)];
        if (originalTerm && /^[A-Z]/.test(originalTerm) && originalTerm.includes(' ')) {
          bonus += 4;
        }
      }
    }

    if (bonus > 0) {
      scores.set(iconName, (scores.get(iconName) || 0) + bonus);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, score]) => ({ icon: iconMap.get(name)!, score }))
    .filter(r => r.icon);

  return ranked;
}

function handleSearch(url: URL): Response {
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200);
  const style = url.searchParams.get('style');

  if (!q) return jsonResponse({ error: 'Missing required parameter: q' }, 400);

  let results = ftsSearch(q);
  if (style) {
    const code = STYLE_REVERSE[style] || style;
    results = results.filter(r => r.icon.S.includes(code));
  }

  const limited = results.slice(0, limit);
  return jsonResponse({
    version: API_VERSION,
    query: q,
    method: 'keyword',
    count: limited.length,
    total: results.length,
    limit,
    results: limited.map(r => formatIcon(r.icon, r.score)),
  });
}

function handleSmart(url: URL): Response {
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200);
  const style = url.searchParams.get('style');

  if (!q) return jsonResponse({ error: 'Missing required parameter: q' }, 400);

  let results = smartSearch(q);
  if (style) {
    const code = STYLE_REVERSE[style] || style;
    results = results.filter(r => r.icon.S.includes(code));
  }

  const limited = results.slice(0, limit);
  return jsonResponse({
    version: API_VERSION,
    query: q,
    method: 'smart',
    count: limited.length,
    total: results.length,
    limit,
    results: limited.map(r => formatIcon(r.icon, r.score)),
  });
}

function handleIcons(url: URL): Response {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50') || 50, 200);
  const offset = parseInt(url.searchParams.get('offset') || '0') || 0;
  const style = url.searchParams.get('style');

  let filtered = icons;
  if (style) {
    const code = STYLE_REVERSE[style] || style;
    filtered = icons.filter(i => i.S.includes(code));
  }

  const slice = filtered.slice(offset, offset + limit);
  return jsonResponse({
    version: API_VERSION,
    total: filtered.length,
    offset,
    limit,
    count: slice.length,
    results: slice.map(i => formatIcon(i)),
  });
}

function handleIconDetail(name: string): Response {
  const icon = iconMap.get(name);
  if (!icon) return jsonResponse({ error: `Icon not found: ${name}` }, 404);

  const terms = searchTerms[name] || [];
  const detail = formatIcon(icon);
  return jsonResponse({
    version: API_VERSION,
    ...detail,
    search_terms: terms,
    all_styles: icon.S.map(s => ({
      code: s,
      name: STYLE_MAP[s],
      html: `<i class="${STYLE_CLASS[s]} fa-${icon.n}"></i>`,
    })),
  });
}

function handleDocs(): Response {
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Font Awesome Explorer API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-pro@6.5.1/css/all.min.css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
  :root {
    --color-bg: #ffffff;
    --color-bg-secondary: #ffffff;
    --color-bg-alt: #fafafa;
    --color-hover-bg: #e8e8e8;
    --color-text: #111111;
    --color-text-muted: #666666;
    --color-border: #e5e5e5;
    --color-border-dark: #000000;
    --color-link: #0066cc;
    --color-success: #28a745;
  }
  [data-theme='dark'] {
    --color-bg: #1a1b26;
    --color-bg-secondary: #24283b;
    --color-bg-alt: #1f2335;
    --color-text: #c0caf5;
    --color-text-muted: #565f89;
    --color-border: #3b4261;
    --color-border-dark: #7aa2f7;
    --color-hover-bg: #292e42;
    --color-link: #7aa2f7;
    --color-success: #9ece6a;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    background: var(--color-bg); color: var(--color-text);
    padding: 2rem; line-height: 1.6;
  }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.5rem; }
  h1 .version { font-size: 0.7rem; background: #d1fae5; border: 2px solid #a7f3d0; padding: 2px 8px; vertical-align: middle; }
  [data-theme='dark'] h1 .version { background: #1a3a2a; border-color: #2d5a3d; color: #9ece6a; }
  h2 { font-size: 1.2rem; margin-top: 2rem; margin-bottom: 0.75rem; border-bottom: 2px solid var(--color-border-dark); padding-bottom: 0.25rem; }
  h3 { font-size: 1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; }
  p { font-size: 0.85rem; margin-bottom: 0.5rem; }
  a { color: var(--color-link); }
  code { background: var(--color-bg-alt); border: 1px solid var(--color-border); padding: 1px 4px; font-size: 0.8rem; }
  pre { background: var(--color-bg-alt); border: 2px solid var(--color-border); color: var(--color-text); padding: 1rem; margin: 0.75rem 0; overflow-x: auto; font-size: 0.8rem; line-height: 1.5; }
  pre code { background: none; border: none; color: inherit; padding: 0; }

  .endpoint-card {
    background: var(--color-bg-secondary); border: 2px solid var(--color-border-dark); padding: 1.25rem; margin: 1rem 0;
    box-shadow: 3px 3px 0 var(--color-border);
  }
  .endpoint-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .method-badge {
    background: #dcfce7; border: 2px solid var(--color-border-dark); padding: 2px 10px;
    font-weight: 700; font-size: 0.75rem; letter-spacing: 0.05em; color: #166534;
  }
  [data-theme='dark'] .method-badge { background: #1a3a2a; border-color: #7aa2f7; color: #9ece6a; }
  .endpoint-path { font-weight: 600; font-size: 0.9rem; }
  .param-table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.8rem; }
  .param-table th, .param-table td { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; }
  .param-table th { background: var(--color-bg-alt); font-weight: 600; }
  .param-table .required { color: #dc2626; font-weight: 600; }
  [data-theme='dark'] .param-table .required { color: #f7768e; }

  .try-panel {
    background: var(--color-bg-alt); border: 2px solid var(--color-border); padding: 1rem; margin-top: 0.75rem;
  }
  .try-panel label { font-size: 0.8rem; font-weight: 600; display: block; margin-bottom: 0.25rem; }
  .try-panel input, .try-panel select {
    font-family: inherit; font-size: 0.8rem; padding: 4px 8px;
    border: 2px solid var(--color-border-dark); background: var(--color-bg); color: var(--color-text);
    margin-bottom: 0.5rem; width: 100%; max-width: 300px;
  }
  .try-btn {
    font-family: inherit; font-size: 0.8rem; font-weight: 700; padding: 6px 16px;
    background: #e0f2fe; color: #0369a1; border: 2px solid #bae6fd; cursor: pointer;
    box-shadow: 2px 2px 0 #bae6fd;
  }
  .try-btn:hover { background: #bae6fd; }
  [data-theme='dark'] .try-btn { background: #1a2a4a; color: #7aa2f7; border-color: #3b4261; box-shadow: 2px 2px 0 #3b4261; }
  [data-theme='dark'] .try-btn:hover { background: #292e42; }
  .try-result {
    background: var(--color-bg-alt); border: 2px solid var(--color-border); color: var(--color-text);
    padding: 0.75rem; margin-top: 0.75rem;
    max-height: 300px; overflow-y: auto; font-size: 0.75rem; white-space: pre-wrap;
    display: none;
  }

  .skill-section {
    background: #ede9fe; border: 2px solid var(--color-border-dark); padding: 1.25rem; margin: 1.5rem 0;
    box-shadow: 3px 3px 0 var(--color-border);
  }
  [data-theme='dark'] .skill-section { background: #2a2040; }
  .skill-section h3 { margin-top: 0; }
  .skill-features { list-style: none; padding: 0; margin: 0.5rem 0; }
  .skill-features li { font-size: 0.85rem; margin-bottom: 0.35rem; padding-left: 1.5rem; position: relative; }
  .skill-features li i { position: absolute; left: 0; top: 2px; font-size: 0.75rem; color: var(--color-text-muted); }
  .copy-block {
    position: relative; background: var(--color-bg-alt); border: 2px solid var(--color-border);
    color: var(--color-text); padding: 0.75rem; margin: 0.5rem 0; font-size: 0.8rem; cursor: pointer;
  }
  .copy-block:hover { background: var(--color-hover-bg); }
  .copy-block::after {
    content: 'click to copy'; position: absolute; right: 8px; top: 8px;
    font-size: 0.65rem; color: var(--color-text-muted);
  }
  .copy-block.copied::after { content: 'copied!'; color: var(--color-success); }
  .download-btn {
    display: inline-block; font-family: inherit; font-size: 0.85rem; font-weight: 700;
    padding: 8px 20px; background: #ede9fe; color: #5b21b6; border: 2px solid #ddd6fe;
    text-decoration: none; box-shadow: 2px 2px 0 #ddd6fe; margin-top: 0.5rem;
  }
  .download-btn:hover { background: #ddd6fe; }
  [data-theme='dark'] .download-btn { background: #2a2040; color: #bb9af7; border-color: #3b4261; box-shadow: 2px 2px 0 #3b4261; }
  [data-theme='dark'] .download-btn:hover { background: #3a2a50; }
  .download-btn i { margin-right: 4px; }

  .back-link { display: inline-block; margin-bottom: 1rem; font-size: 0.85rem; }
  .schema-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .schema-table th, .schema-table td { border: 1px solid var(--color-border); padding: 4px 8px; text-align: left; }
  .schema-table th { background: var(--color-bg-alt); }
  .info-bar { background: #e0f2fe; border: 2px solid var(--color-border-dark); padding: 0.75rem; margin: 1rem 0; font-size: 0.8rem; }
  [data-theme='dark'] .info-bar { background: #1a2a4a; }
</style>
</head>
<body>
<div class="container">

<a href="/" class="back-link"><i class="fa-thin fa-arrow-left"></i> Back to Explorer</a>

<h1><i class="fa-thin fa-plug"></i> Font Awesome Explorer API <span class="version">v${API_VERSION}</span></h1>
<p>Programmatic access to 3,860 Font Awesome icons with keyword and smart search.</p>

<!-- Claude Skill (top section) -->
<div class="skill-section">
  <h3><i class="fa-thin fa-wand-magic-sparkles"></i> Claude Code Skill</h3>
  <p>Install the Font Awesome skill to search icons directly from Claude Code conversations.</p>

  <h3>What it does</h3>
  <div class="skill-features">
    <div class="skill-features li" style="padding-left:1.5rem;position:relative;margin-bottom:0.35rem;font-size:0.85rem;"><i class="fa-thin fa-magnifying-glass" style="position:absolute;left:0;top:2px;font-size:0.75rem;color:var(--color-text-muted);"></i>  Search 3,860 Font Awesome icons by keyword or concept</div>
    <div class="skill-features li" style="padding-left:1.5rem;position:relative;margin-bottom:0.35rem;font-size:0.85rem;"><i class="fa-thin fa-code" style="position:absolute;left:0;top:2px;font-size:0.75rem;color:var(--color-text-muted);"></i>  Get HTML snippets, unicode codes, and style variants</div>
    <div class="skill-features li" style="padding-left:1.5rem;position:relative;margin-bottom:0.35rem;font-size:0.85rem;"><i class="fa-thin fa-filter" style="position:absolute;left:0;top:2px;font-size:0.75rem;color:var(--color-text-muted);"></i>  Filter by style (solid, regular, light, thin, duotone, brands)</div>
    <div class="skill-features li" style="padding-left:1.5rem;position:relative;margin-bottom:0.35rem;font-size:0.85rem;"><i class="fa-thin fa-terminal" style="position:absolute;left:0;top:2px;font-size:0.75rem;color:var(--color-text-muted);"></i>  Works with <code>curl</code> via the Bash tool in Claude Code</div>
  </div>

  <h3>One-line installer</h3>
  <div class="copy-block" onclick="copyInstaller(this)">curl -sL https://fontawesome-explorer.atsignhandle.workers.dev/api/skill -o ~/.claude/skills/fontawesome.md</div>

  <a href="/api/skill" class="download-btn"><i class="fa-thin fa-download"></i> Download Skill</a>
</div>

<div class="info-bar">
  <i class="fa-thin fa-circle-info"></i>
  Base URL: <code>https://fontawesome-explorer.atsignhandle.workers.dev</code> &mdash;
  All endpoints return JSON with CORS enabled.
</div>

<!-- /api/search -->
<div class="endpoint-card">
  <div class="endpoint-header">
    <span class="method-badge">GET</span>
    <span class="endpoint-path">/api/search</span>
  </div>
  <p>Keyword search using inverted index with prefix and substring matching. Same scoring algorithm as the client-side search.</p>
  <table class="param-table">
    <tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr>
    <tr><td class="required">q</td><td>string</td><td>&mdash;</td><td>Search query (required)</td></tr>
    <tr><td>limit</td><td>number</td><td>50</td><td>Max results (max 200)</td></tr>
    <tr><td>style</td><td>string</td><td>&mdash;</td><td>Filter: solid, regular, light, thin, duotone, brands, sharp-solid, sharp-regular, sharp-light, sharp-thin</td></tr>
  </table>
  <div class="try-panel">
    <label>Query</label>
    <input type="text" id="search-q" value="arrow" placeholder="e.g. arrow, cloud, user">
    <label>Limit</label>
    <input type="number" id="search-limit" value="5" min="1" max="200">
    <label>Style</label>
    <select id="search-style"><option value="">all</option><option>solid</option><option>regular</option><option>light</option><option>thin</option><option>duotone</option><option>brands</option><option>sharp-solid</option><option>sharp-regular</option><option>sharp-light</option><option>sharp-thin</option></select>
    <br><button class="try-btn" onclick="trySearch()"><i class="fa-thin fa-play"></i> Run</button>
    <div class="try-result" id="search-result"></div>
  </div>
</div>

<!-- /api/smart -->
<div class="endpoint-card">
  <div class="endpoint-header">
    <span class="method-badge">GET</span>
    <span class="endpoint-path">/api/smart</span>
  </div>
  <p>Enhanced search using expanded terms (categories, aliases, synonyms). Broader results than keyword for conceptual queries like "spinning loader" or "social media".</p>
  <table class="param-table">
    <tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr>
    <tr><td class="required">q</td><td>string</td><td>&mdash;</td><td>Search query (required)</td></tr>
    <tr><td>limit</td><td>number</td><td>50</td><td>Max results (max 200)</td></tr>
    <tr><td>style</td><td>string</td><td>&mdash;</td><td>Filter by style</td></tr>
  </table>
  <div class="try-panel">
    <label>Query</label>
    <input type="text" id="smart-q" value="spinning loader" placeholder="e.g. spinning loader, social media">
    <label>Limit</label>
    <input type="number" id="smart-limit" value="5" min="1" max="200">
    <label>Style</label>
    <select id="smart-style"><option value="">all</option><option>solid</option><option>regular</option><option>light</option><option>thin</option><option>duotone</option><option>brands</option></select>
    <br><button class="try-btn" onclick="trySmart()"><i class="fa-thin fa-play"></i> Run</button>
    <div class="try-result" id="smart-result"></div>
  </div>
</div>

<!-- /api/icons -->
<div class="endpoint-card">
  <div class="endpoint-header">
    <span class="method-badge">GET</span>
    <span class="endpoint-path">/api/icons</span>
  </div>
  <p>Browse and paginate all icons. Returns icons in alphabetical order.</p>
  <table class="param-table">
    <tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr>
    <tr><td>limit</td><td>number</td><td>50</td><td>Max results (max 200)</td></tr>
    <tr><td>offset</td><td>number</td><td>0</td><td>Pagination offset</td></tr>
    <tr><td>style</td><td>string</td><td>&mdash;</td><td>Filter by style</td></tr>
  </table>
  <div class="try-panel">
    <label>Limit</label>
    <input type="number" id="icons-limit" value="3" min="1" max="200">
    <label>Offset</label>
    <input type="number" id="icons-offset" value="0" min="0">
    <br><button class="try-btn" onclick="tryIcons()"><i class="fa-thin fa-play"></i> Run</button>
    <div class="try-result" id="icons-result"></div>
  </div>
</div>

<!-- /api/icon/:name -->
<div class="endpoint-card">
  <div class="endpoint-header">
    <span class="method-badge">GET</span>
    <span class="endpoint-path">/api/icon/:name</span>
  </div>
  <p>Get detailed info for a single icon by name, including all style variants, search terms, and HTML for each style.</p>
  <table class="param-table">
    <tr><th>Param</th><th>Type</th><th>Description</th></tr>
    <tr><td class="required">name</td><td>path</td><td>Icon name (e.g. <code>house</code>, <code>arrow-right</code>, <code>github</code>)</td></tr>
  </table>
  <div class="try-panel">
    <label>Icon Name</label>
    <input type="text" id="icon-name" value="house" placeholder="e.g. house, cloud, github">
    <br><button class="try-btn" onclick="tryIcon()"><i class="fa-thin fa-play"></i> Run</button>
    <div class="try-result" id="icon-result"></div>
  </div>
</div>

<!-- Response Schema -->
<h2>Response Schema</h2>
<table class="schema-table">
  <tr><th>Field</th><th>Type</th><th>Description</th></tr>
  <tr><td>version</td><td>string</td><td>API version</td></tr>
  <tr><td>name</td><td>string</td><td>Icon name (kebab-case)</td></tr>
  <tr><td>unicode</td><td>string</td><td>Unicode hex code</td></tr>
  <tr><td>label</td><td>string</td><td>Human-readable label</td></tr>
  <tr><td>tier</td><td>string</td><td>"free" or "pro"</td></tr>
  <tr><td>styles</td><td>string[]</td><td>Available styles (solid, regular, light, thin, duotone, brands, sharp-*)</td></tr>
  <tr><td>brands</td><td>boolean</td><td>Whether this is a brand icon</td></tr>
  <tr><td>score</td><td>number</td><td>Relevance score (search endpoints only)</td></tr>
  <tr><td>html</td><td>string</td><td>Ready-to-use HTML snippet</td></tr>
</table>

</div>

<script>
// Match theme from landing page
try {
  const t = localStorage.getItem('fa-explorer-theme');
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
} catch(e) {}

const BASE = '';
async function tryEndpoint(url, resultId) {
  const el = document.getElementById(resultId);
  el.style.display = 'block';
  el.textContent = 'Loading...';
  try {
    const res = await fetch(url);
    const data = await res.json();
    el.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el.textContent = 'Error: ' + e.message;
  }
}
function trySearch() {
  const q = encodeURIComponent(document.getElementById('search-q').value);
  const limit = document.getElementById('search-limit').value;
  const style = document.getElementById('search-style').value;
  let url = BASE + '/api/search?q=' + q + '&limit=' + limit;
  if (style) url += '&style=' + style;
  tryEndpoint(url, 'search-result');
}
function trySmart() {
  const q = encodeURIComponent(document.getElementById('smart-q').value);
  const limit = document.getElementById('smart-limit').value;
  const style = document.getElementById('smart-style').value;
  let url = BASE + '/api/smart?q=' + q + '&limit=' + limit;
  if (style) url += '&style=' + style;
  tryEndpoint(url, 'smart-result');
}
function tryIcons() {
  const limit = document.getElementById('icons-limit').value;
  const offset = document.getElementById('icons-offset').value;
  let url = BASE + '/api/icons?limit=' + limit + '&offset=' + offset;
  tryEndpoint(url, 'icons-result');
}
function tryIcon() {
  const name = encodeURIComponent(document.getElementById('icon-name').value);
  tryEndpoint(BASE + '/api/icon/' + name, 'icon-result');
}
function copyInstaller(el) {
  navigator.clipboard.writeText(el.textContent.trim());
  el.classList.add('copied');
  setTimeout(function() { el.classList.remove('copied'); }, 1500);
}
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
  });
}

function handleSkill(): Response {
  const skill = `---
name: fontawesome
description: Search Font Awesome icons via the FA Explorer API. Use when user needs icon names, HTML snippets, or unicode codes.
---

## Font Awesome Icon Explorer API

Base URL: https://fontawesome-explorer.atsignhandle.workers.dev

### Endpoints

**Keyword search**: GET /api/search?q={query}&limit={n}&style={style}
**Smart search**: GET /api/smart?q={query}&limit={n}&style={style}
**Icon detail**: GET /api/icon/{name}
**Browse icons**: GET /api/icons?limit={n}&offset={n}&style={style}

### Parameters

- q: search query (required for search/smart)
- limit: max results (default 50, max 200)
- offset: pagination offset (icons only)
- style: filter (solid, regular, light, thin, duotone, brands, sharp-solid, sharp-regular, sharp-light, sharp-thin)

### How to use

When the user asks for a Font Awesome icon, use curl via the Bash tool:

\`\`\`bash
curl -s 'https://fontawesome-explorer.atsignhandle.workers.dev/api/search?q=arrow&limit=5'
\`\`\`

Return the \`html\` field from results as the icon snippet.
For conceptual queries ("something that represents speed"), use /api/smart instead.

### Install

\`\`\`bash
curl -sL https://fontawesome-explorer.atsignhandle.workers.dev/api/skill -o ~/.claude/skills/fontawesome.md
\`\`\`
`;
  return new Response(skill, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="fontawesome.md"',
      ...corsHeaders(),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const path = url.pathname;

    if (path === '/api/search') return handleSearch(url);
    if (path === '/api/smart') return handleSmart(url);
    if (path === '/api/icons') return handleIcons(url);
    if (path === '/api/docs') return handleDocs();
    if (path === '/api/skill') return handleSkill();

    // /api/icon/:name
    const iconMatch = path.match(/^\/api\/icon\/(.+)$/);
    if (iconMatch) return handleIconDetail(decodeURIComponent(iconMatch[1]!));

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
