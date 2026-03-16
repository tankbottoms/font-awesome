# Style Guide: Neo-Brutalist Design System

A design system built on monospace typography, hard-offset shadows, rectangular edges, and pastel accents. No rounded corners. No gradients. No blur. Every element looks like it was stamped onto the page.

This system is designed to be forked. The CSS variables, color tokens, and layout patterns are self-contained and adaptable to any content type.

---

## Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Monospace everything** | All text uses a monospace font stack |
| **Hard edges** | `border-radius: 0` on every element |
| **Hard shadows** | `box-shadow: 2px 2px 0px` (no blur, no spread) |
| **Thick borders** | `2px solid` for containers, `1px solid` for badges |
| **Pastel accents** | Category/type colors are soft pastels with dark text |
| **High contrast** | Dark backgrounds with bright text, or white with black |
| **No decoration** | No gradients, no glow, no blur filters |

---

## CSS Variables

### Base Tokens

```css
:root {
  /* Typography */
  --font-mono: ui-monospace, 'Cascadia Code', 'JetBrains Mono',
               'Fira Code', Menlo, Monaco, Consolas, monospace;

  /* Spacing scale */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Border */
  --border-width: 2px;
  --border-color: #000;
  --shadow-offset: 2px;

  /* Card dimensions */
  --card-min: 120px;
  --card-gap: 8px;
}
```

### Light Theme

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-card: #ffffff;
  --text-primary: #1a1a2e;
  --text-secondary: #555;
  --text-muted: #888;
  --border-color: #000;
  --shadow-color: #000;
  --accent: #7dcfff;
}
```

### Dark Theme (Tokyo Night)

```css
[data-theme="dark"] {
  --bg-primary: #1a1b26;
  --bg-secondary: #24283b;
  --bg-card: #24283b;
  --text-primary: #c0caf5;
  --text-secondary: #a9b1d6;
  --text-muted: #565f89;
  --border-color: #414868;
  --shadow-color: #13141f;
  --accent: #7dcfff;
}
```

### Category/Type Accent Colors

Each content category gets a distinct pastel. These are used for tab backgrounds, badges, and card accents.

```css
:root {
  /* 8 category pastels */
  --cat-1: #ffd6e0;  /* pink */
  --cat-2: #ffe4c9;  /* orange */
  --cat-3: #d4f5d4;  /* green */
  --cat-4: #d4e9f7;  /* blue */
  --cat-5: #e8d5f5;  /* purple */
  --cat-6: #fff3c4;  /* yellow */
  --cat-7: #d4f1f1;  /* teal */
  --cat-8: #f5d5d5;  /* red */
}
```

---

## Typography

Everything is monospace. No exceptions.

```css
* {
  font-family: var(--font-mono);
}

body {
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--bg-primary);
}

h1 { font-size: 1.8em; font-weight: 800; letter-spacing: -0.5px; }
h2 { font-size: 1.3em; font-weight: 700; }
h3 { font-size: 1.1em; font-weight: 600; text-transform: uppercase; }

/* Monospace small caps for labels */
.label {
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}
```

---

## Components

### Cards

The fundamental content unit. Hard border, hard shadow, no radius.

```css
.card {
  background: var(--bg-card);
  border: var(--border-width) solid var(--border-color);
  box-shadow: var(--shadow-offset) var(--shadow-offset) 0 var(--shadow-color);
  padding: var(--space-md);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: calc(var(--shadow-offset) + 1px)
              calc(var(--shadow-offset) + 1px) 0
              var(--shadow-color);
}

.card:active {
  transform: translateY(0);
  box-shadow: 1px 1px 0 var(--shadow-color);
}
```

### Badges / Tags

Rectangular, pastel background, uppercase monospace text.

```css
.badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 0.7em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: 1px solid var(--border-color);
  background: var(--cat-1);  /* varies by category */
  color: var(--text-primary);
  white-space: nowrap;
}
```

### Buttons

Filled or outlined, always rectangular.

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-mono);
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  border: var(--border-width) solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  box-shadow: var(--shadow-offset) var(--shadow-offset) 0 var(--shadow-color);
  transition: transform 0.1s, box-shadow 0.1s;
}

.btn:hover {
  transform: translate(-1px, -1px);
  box-shadow: calc(var(--shadow-offset) + 1px)
              calc(var(--shadow-offset) + 1px) 0
              var(--shadow-color);
}

.btn:active {
  transform: translate(1px, 1px);
  box-shadow: 0 0 0 var(--shadow-color);
}

.btn-primary {
  background: var(--accent);
  color: #000;
}
```

### Search Input

Large, prominent, monospace.

```css
.search-input {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-mono);
  font-size: 1.1em;
  border: var(--border-width) solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-primary);
  outline: none;
  box-shadow: inset 1px 1px 0 var(--shadow-color);
}

.search-input:focus {
  box-shadow: inset 2px 2px 0 var(--accent);
  border-color: var(--accent);
}

/* Prevent iOS zoom on focus */
@media (max-width: 768px) {
  .search-input { font-size: 16px; }
}
```

### Tabs

Horizontal scroll strip with category-colored backgrounds.

```css
.tabs {
  display: flex;
  overflow-x: auto;
  gap: var(--space-xs);
  padding: var(--space-sm) 0;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}

.tabs::-webkit-scrollbar { display: none; }

.tab {
  flex-shrink: 0;
  padding: var(--space-xs) var(--space-md);
  font-family: var(--font-mono);
  font-size: 0.8em;
  font-weight: 600;
  text-transform: uppercase;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  cursor: pointer;
  scroll-snap-align: start;
  white-space: nowrap;
  transition: background 0.15s;
}

.tab.active {
  background: var(--cat-1);  /* category-specific color */
  border-width: 2px;
  font-weight: 700;
}
```

### Grid Layout

CSS Grid with auto-fill for responsive columns. No media query breakpoints needed.

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min), 1fr));
  gap: var(--card-gap);
  padding: var(--space-md);
}
```

### Modal / Detail Overlay

Full-screen overlay with a centered content card.

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.overlay.open {
  opacity: 1;
  pointer-events: auto;
}

.overlay-content {
  background: var(--bg-card);
  border: var(--border-width) solid var(--border-color);
  box-shadow: 4px 4px 0 var(--shadow-color);
  padding: var(--space-lg);
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}
```

---

## Theme Toggle

Switch between light and dark by toggling a `data-theme` attribute on `<html>`:

```javascript
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

// Restore on page load
const saved = localStorage.getItem("theme");
if (saved) document.documentElement.setAttribute("data-theme", saved);
```

---

## Mobile-First Responsive

### Layout Reordering

Use flexbox `order` to rearrange sections on mobile without changing HTML:

```css
@media (max-width: 768px) {
  .fixed-top {
    display: flex;
    flex-direction: column;
  }

  .header    { order: 1; }
  .tabs      { order: 2; }
  .search    { order: 3; }
  .narrative { order: 4; display: none; }  /* shown as popup instead */
}
```

### Touch-Friendly Sizing

```css
@media (max-width: 768px) {
  /* Larger tap targets on mobile */
  .tab     { padding: 8px 16px; min-height: 44px; }
  .btn     { min-height: 44px; }
  .card    { padding: 12px; }

  /* Grid: fewer, larger cards */
  .grid    { --card-min: 100px; --card-gap: 6px; }
}
```

---

## Adapting the Style System

### For Your Content

1. **Fork the CSS variables.** Change the accent color, category pastels, and font stack to match your brand.
2. **Keep the structural rules.** `border-radius: 0`, hard shadows, thick borders -- these define the brutalist aesthetic.
3. **Replace category colors.** Map your content categories to the `--cat-N` variables.
4. **Adjust the grid.** Change `--card-min` based on your content card size needs.

### What Makes It "Neo-Brutalist"

Remove any of these and the aesthetic breaks:

| Must Have | If You Remove It |
|-----------|-----------------|
| Monospace font | Looks like a regular website |
| `border-radius: 0` | Loses the stamped/printed feel |
| Hard shadows (`blur: 0`) | Becomes soft/modern |
| Thick borders (`2px`) | Elements float instead of being anchored |
| Uppercase labels | Loses the industrial/technical tone |
| High contrast | Becomes muted and forgettable |

### Color Customization

To generate a cohesive pastel palette for your categories:

```javascript
// Generate N evenly-spaced pastels
function generatePastels(count, saturation = 70, lightness = 88) {
  return Array.from({ length: count }, (_, i) => {
    const hue = (i * 360 / count) % 360;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  });
}

// Example: 6 category colors
const colors = generatePastels(6);
// ["hsl(0, 70%, 88%)", "hsl(60, 70%, 88%)", "hsl(120, 70%, 88%)", ...]
```
