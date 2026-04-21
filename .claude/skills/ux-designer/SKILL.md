---
name: ux-designer
description: "Use WHEN creating a UX specification, wireframes, design system, theme files, or HTML mock layout. Triggers: ux, wireframe, design system, color palette, typography, layout, accessibility, theme, mock"
metadata:
  version: 1.0.0
  author: Domdhi.Agents
  tags: [ux, wireframes, design-system, accessibility, themes, mock-layout]
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# UX Designer

Expert in UX specification documents. Produces a complete design artifact suite: design system spec, wireframes (ASCII), theme files (light/dark), interaction patterns, accessibility guidelines, and self-contained HTML mock layouts.

## Output Files

| File | Description |
|------|-------------|
| `docs/_project-design.md` | Design system, principles, component inventory, interaction patterns |
| `docs/design/_wireframes.md` | ASCII wireframes for all key pages |
| `docs/design/_design.light.md` | Light theme color palette and semantic tokens |
| `docs/design/_design.dark.md` | Dark theme color palette and semantic tokens |
| `docs/design/_mock-layout.html` | Self-contained HTML mock of the application shell |

---

## Template: UX Spec (`_project-design.md`)

```markdown
# UX Design Specification: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Version** | 1.0 |
| **Status** | Draft / Review / Locked |
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Source** | Based on PRD v{X} |

---

## 1. Design Philosophy

{2-3 sentences describing the overall design approach. Examples: "Cockpit-style data density", "Minimal and focused", "Playful and approachable"}

### Design Principles
1. **{Principle}**: {explanation}
2. **{Principle}**: {explanation}
3. **{Principle}**: {explanation}

---

## 2. Typography

| Role | Font | Weight | Size | Line Height |
|------|------|--------|------|-------------|
| H1 | {font} | {weight} | {size} | {lh} |
| H2 | {font} | {weight} | {size} | {lh} |
| H3 | {font} | {weight} | {size} | {lh} |
| Body | {font} | {weight} | {size} | {lh} |
| Caption | {font} | {weight} | {size} | {lh} |
| Code | {monospace font} | {weight} | {size} | {lh} |

---

## 3. Layout System

### Shell Structure
```
{ASCII diagram of the application shell — header, sidebar, content area, footer}
```

### Grid System
- **Container**: {max-width, padding}
- **Columns**: {grid system — 12-col, etc.}
- **Gutter**: {spacing between columns}
- **Breakpoints**:
  - Mobile: {px}
  - Tablet: {px}
  - Desktop: {px}
  - Wide: {px}

### Spacing Scale
| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | {value} | {usage} |
| `--space-sm` | {value} | {usage} |
| `--space-md` | {value} | {usage} |
| `--space-lg` | {value} | {usage} |
| `--space-xl` | {value} | {usage} |

---

## 4. Component Inventory

### Core Components
| Component | Variants | Usage |
|-----------|----------|-------|
| Button | Primary, Secondary, Ghost, Danger | Actions |
| Card | Standard, Compact, Interactive | Content containers |
| Table/DataGrid | Sortable, Filterable, Virtual scroll | Data display |
| Form Field | Text, Select, Checkbox, Radio, Date | Data input |
| Modal/Dialog | Standard, Confirmation, Full-screen | Overlays |
| Toast/Notification | Info, Success, Warning, Error | Feedback |
| Navigation | Sidebar, Tabs, Breadcrumbs | Wayfinding |

### Component States
All interactive components must define: Default, Hover, Active, Focus, Disabled, Loading, Error

---

## 5. Interaction Patterns

### Navigation
- {How users move between sections}

### Data Entry
- {Form validation timing — on blur, on submit, real-time}
- {Error display — inline, toast, summary}
- {Auto-save behavior}

### Data Display
- {Loading states — skeleton, spinner, progressive}
- {Empty states — illustration, call-to-action}
- {Error states — retry, fallback}

### Feedback
- {Success confirmation — toast, redirect, inline}
- {Error messaging — specificity, recovery actions}
- {Progress indicators — determinate, indeterminate}

---

## 6. Responsive Behavior

| Breakpoint | Layout Changes |
|------------|---------------|
| Mobile (<{px}) | {what changes} |
| Tablet ({px}-{px}) | {what changes} |
| Desktop (>{px}) | {what changes} |

---

## 7. Accessibility

- **Target**: WCAG {2.1 AA / 2.1 AAA}
- **Color Contrast**: Minimum {4.5:1} for text, {3:1} for large text
- **Keyboard Navigation**: All interactive elements reachable via Tab
- **Screen Reader**: All images have alt text, forms have labels
- **Focus Indicators**: Visible focus ring on all interactive elements
- **Motion**: Respect `prefers-reduced-motion`

---

## Related Documents
- PRD: [_project-requirements.md](../_project-requirements.md)
- Wireframes: [_wireframes.md](_wireframes.md)
- Light Theme: [_design.light.md](_design.light.md)
- Dark Theme: [_design.dark.md](_design.dark.md)
- Mock Layout: [_mock-layout.html](_mock-layout.html)
- Architecture: [_project-architecture.md](../_project-architecture.md)
```

---

## Template: Wireframes (`_wireframes.md`)

```markdown
# Wireframes: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Version** | 1.0 |
| **Status** | Draft / Review / Locked |
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Source** | Based on UX Spec v{X} |

---

## Page Inventory

| Page | Priority | Entry Points | Notes |
|------|----------|-------------|-------|
| {Page Name} | Primary | {how users arrive} | {notes} |
| {Page Name} | Primary | {how users arrive} | {notes} |
| {Page Name} | Secondary | {how users arrive} | {notes} |

---

## Navigation Flow

```
{ASCII diagram showing how pages connect to each other}
```

---

## Page: {Page Name}

### Desktop Layout
```
+----------------------------------------------------------+
|  [Logo]           Navigation Bar              [User Menu] |
+----------------------------------------------------------+
|        |                                                  |
| Sidebar|              Main Content                        |
|        |                                                  |
|  Nav   |  +------------------------------------------+   |
|  Items |  |                                          |   |
|        |  |         Content Area                     |   |
|        |  |                                          |   |
|        |  +------------------------------------------+   |
|        |                                                  |
+----------------------------------------------------------+
|                     Footer                                |
+----------------------------------------------------------+
```

### Mobile Layout
```
+-------------------------+
| [=]  Logo    [User]     |
+-------------------------+
|                         |
|    Main Content         |
|                         |
+-------------------------+
| [Nav] [Nav] [Nav] [Nav] |
+-------------------------+
```

**Purpose**: {what this page does}
**Entry Points**: {how users get here}
**Key Interactions**:
- {interaction 1}
- {interaction 2}
**Data Displayed**: {key data shown}
**Actions Available**: {what users can do}

---

## Page: {Page Name}

{Repeat for each page...}

---

## Shared Components

### {Component Name}
```
{ASCII wireframe of reusable component}
```
**Used on**: {list of pages}
**Variants**: {different states or configurations}

---

## Related Documents
- UX Spec: [_project-design.md](_project-design.md)
- Light Theme: [_design.light.md](_design.light.md)
- Dark Theme: [_design.dark.md](_design.dark.md)
- Mock Layout: [_mock-layout.html](_mock-layout.html)
```

---

## Template: Light Theme (`_design.light.md`)

```markdown
# Light Theme: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Version** | 1.0 |
| **Status** | Draft / Review / Locked |
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Source** | Based on UX Spec v{X} |

---

## Color Palette

### Brand Colors
| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-brand-primary` | {hex} | {rgb} | Primary brand color |
| `--color-brand-secondary` | {hex} | {rgb} | Secondary brand color |
| `--color-brand-accent` | {hex} | {rgb} | Accent/highlight color |

### Semantic Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | {hex} | Primary actions, links, key elements |
| `--color-secondary` | {hex} | Secondary elements, borders |
| `--color-accent` | {hex} | Highlights, active states |
| `--color-success` | {hex} | Success states, confirmations |
| `--color-warning` | {hex} | Warning states, caution |
| `--color-danger` | {hex} | Error/danger states, destructive actions |
| `--color-info` | {hex} | Informational states |

### Background Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg-page` | {hex} | Page background |
| `--color-bg-card` | {hex} | Card/panel background |
| `--color-bg-sidebar` | {hex} | Sidebar background |
| `--color-bg-header` | {hex} | Header background |
| `--color-bg-input` | {hex} | Form input background |
| `--color-bg-hover` | {hex} | Hover state background |
| `--color-bg-active` | {hex} | Active/selected state background |

### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text-primary` | {hex} | Primary text, headings |
| `--color-text-secondary` | {hex} | Secondary/muted text |
| `--color-text-disabled` | {hex} | Disabled state text |
| `--color-text-inverse` | {hex} | Text on dark backgrounds |
| `--color-text-link` | {hex} | Link text |

### Border Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-border-default` | {hex} | Default borders |
| `--color-border-focus` | {hex} | Focus ring color |
| `--color-border-error` | {hex} | Error state borders |

---

## Elevation & Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | {value} | Subtle depth (cards) |
| `--shadow-md` | {value} | Medium depth (dropdowns) |
| `--shadow-lg` | {value} | High depth (modals) |

---

## Component State Mapping

| Component | Default | Hover | Active | Focus | Disabled |
|-----------|---------|-------|--------|-------|----------|
| Button Primary | `--color-primary` | {darker} | {darkest} | + ring | {muted} |
| Button Secondary | `--color-bg-card` | `--color-bg-hover` | `--color-bg-active` | + ring | {muted} |
| Input | `--color-bg-input` | — | — | `--color-border-focus` | {muted} |
| Card | `--color-bg-card` | — | — | — | — |
| Link | `--color-text-link` | {underline} | {darker} | + ring | {muted} |

---

## WCAG Compliance

| Combination | Contrast Ratio | Requirement | Pass |
|------------|---------------|-------------|------|
| `--color-text-primary` on `--color-bg-page` | {ratio} | 4.5:1 (AA) | {Y/N} |
| `--color-text-secondary` on `--color-bg-page` | {ratio} | 4.5:1 (AA) | {Y/N} |
| `--color-text-inverse` on `--color-primary` | {ratio} | 4.5:1 (AA) | {Y/N} |
| `--color-primary` on `--color-bg-page` | {ratio} | 3:1 (AA Large) | {Y/N} |

---

## Related Documents
- UX Spec: [_project-design.md](_project-design.md)
- Dark Theme: [_design.dark.md](_design.dark.md)
- Mock Layout: [_mock-layout.html](_mock-layout.html)
```

---

## Template: Dark Theme (`_design.dark.md`)

```markdown
# Dark Theme: {Project Name}

| Attribute | Value |
|-----------|-------|
| **Version** | 1.0 |
| **Status** | Draft / Review / Locked |
| **Author** | {name} |
| **Date** | {YYYY-MM-DD} |
| **Source** | Based on UX Spec v{X}, Light Theme v{X} |

---

## Design Notes

Dark theme is derived from the light theme with these principles:
- Backgrounds use dark surfaces (not pure black — use `#121212` or similar)
- Text lightens to maintain contrast
- Semantic colors may shift saturation/brightness for dark backgrounds
- Elevation is conveyed through lighter surfaces, not shadows

---

## Color Palette

### Semantic Colors
| Token | Light Value | Dark Value | Notes |
|-------|------------|------------|-------|
| `--color-primary` | {light hex} | {dark hex} | {adjustment notes} |
| `--color-secondary` | {light hex} | {dark hex} | {adjustment notes} |
| `--color-accent` | {light hex} | {dark hex} | {adjustment notes} |
| `--color-success` | {light hex} | {dark hex} | {adjustment notes} |
| `--color-warning` | {light hex} | {dark hex} | {adjustment notes} |
| `--color-danger` | {light hex} | {dark hex} | {adjustment notes} |
| `--color-info` | {light hex} | {dark hex} | {adjustment notes} |

### Background Colors
| Token | Light Value | Dark Value | Notes |
|-------|------------|------------|-------|
| `--color-bg-page` | {light hex} | {dark hex} | Base surface |
| `--color-bg-card` | {light hex} | {dark hex} | Elevated surface |
| `--color-bg-sidebar` | {light hex} | {dark hex} | Navigation surface |
| `--color-bg-header` | {light hex} | {dark hex} | Top bar surface |
| `--color-bg-input` | {light hex} | {dark hex} | Input fields |
| `--color-bg-hover` | {light hex} | {dark hex} | Hover state |
| `--color-bg-active` | {light hex} | {dark hex} | Active/selected |

### Text Colors
| Token | Light Value | Dark Value | Notes |
|-------|------------|------------|-------|
| `--color-text-primary` | {light hex} | {dark hex} | Primary text |
| `--color-text-secondary` | {light hex} | {dark hex} | Muted text |
| `--color-text-disabled` | {light hex} | {dark hex} | Disabled text |
| `--color-text-inverse` | {light hex} | {dark hex} | On colored bg |
| `--color-text-link` | {light hex} | {dark hex} | Links |

### Border Colors
| Token | Light Value | Dark Value | Notes |
|-------|------------|------------|-------|
| `--color-border-default` | {light hex} | {dark hex} | Default borders |
| `--color-border-focus` | {light hex} | {dark hex} | Focus ring |
| `--color-border-error` | {light hex} | {dark hex} | Error borders |

---

## Elevation & Shadows

In dark mode, elevation is conveyed through surface lightness rather than shadows:

| Level | Surface Color | Shadow | Usage |
|-------|--------------|--------|-------|
| Base (0) | `--color-bg-page` | none | Page background |
| Raised (1) | {hex} | subtle | Cards, panels |
| Overlay (2) | {hex} | medium | Dropdowns, popovers |
| Modal (3) | {hex} | strong | Modals, dialogs |

---

## WCAG Compliance

| Combination | Contrast Ratio | Requirement | Pass |
|------------|---------------|-------------|------|
| `--color-text-primary` on `--color-bg-page` | {ratio} | 4.5:1 (AA) | {Y/N} |
| `--color-text-secondary` on `--color-bg-page` | {ratio} | 4.5:1 (AA) | {Y/N} |
| `--color-text-inverse` on `--color-primary` | {ratio} | 4.5:1 (AA) | {Y/N} |
| `--color-primary` on `--color-bg-page` | {ratio} | 3:1 (AA Large) | {Y/N} |

---

## Related Documents
- UX Spec: [_project-design.md](_project-design.md)
- Light Theme: [_design.light.md](_design.light.md)
- Mock Layout: [_mock-layout.html](_mock-layout.html)
```

---

## Template: Mock Layout (`_mock-layout.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{Project Name} — Layout Mock</title>
    <style>
        /* ========================================
           {Project Name} Mock Layout
           Generated from UX Spec + Theme Files
           Self-contained — no external dependencies
           ======================================== */

        :root {
            /* --- Brand --- */
            --color-primary: {hex};
            --color-secondary: {hex};
            --color-accent: {hex};

            /* --- Backgrounds --- */
            --color-bg-page: {hex};
            --color-bg-card: {hex};
            --color-bg-sidebar: {hex};
            --color-bg-header: {hex};

            /* --- Text --- */
            --color-text-primary: {hex};
            --color-text-secondary: {hex};

            /* --- Semantic --- */
            --color-success: {hex};
            --color-warning: {hex};
            --color-danger: {hex};

            /* --- Spacing --- */
            --space-xs: 4px;
            --space-sm: 8px;
            --space-md: 16px;
            --space-lg: 24px;
            --space-xl: 32px;

            /* --- Typography --- */
            --font-family: {font}, system-ui, sans-serif;
            --font-size-base: 14px;
            --font-size-lg: 18px;
            --font-size-xl: 24px;

            /* --- Shadows --- */
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.12);
            --shadow-md: 0 4px 6px rgba(0,0,0,0.15);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--font-family);
            font-size: var(--font-size-base);
            color: var(--color-text-primary);
            background: var(--color-bg-page);
        }

        /* --- App Shell --- */
        .app-shell {
            display: grid;
            grid-template-rows: auto 1fr auto;
            grid-template-columns: 240px 1fr;
            grid-template-areas:
                "header header"
                "sidebar main"
                "footer footer";
            min-height: 100vh;
        }

        .header {
            grid-area: header;
            background: var(--color-bg-header);
            padding: var(--space-md);
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: var(--shadow-sm);
            z-index: 10;
        }

        .header .logo {
            font-size: var(--font-size-xl);
            font-weight: 700;
            color: var(--color-primary);
        }

        .sidebar {
            grid-area: sidebar;
            background: var(--color-bg-sidebar);
            padding: var(--space-md);
            border-right: 1px solid var(--color-secondary);
        }

        .sidebar nav a {
            display: block;
            padding: var(--space-sm) var(--space-md);
            color: var(--color-text-primary);
            text-decoration: none;
            border-radius: 4px;
            margin-bottom: var(--space-xs);
        }

        .sidebar nav a:hover { background: var(--color-bg-card); }
        .sidebar nav a.active { background: var(--color-primary); color: white; }

        .main {
            grid-area: main;
            padding: var(--space-lg);
            overflow-y: auto;
        }

        .page-title {
            font-size: var(--font-size-xl);
            margin-bottom: var(--space-lg);
        }

        .card {
            background: var(--color-bg-card);
            border-radius: 8px;
            padding: var(--space-lg);
            box-shadow: var(--shadow-sm);
            margin-bottom: var(--space-md);
        }

        .card-title {
            font-size: var(--font-size-lg);
            margin-bottom: var(--space-md);
        }

        .card-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: var(--space-md);
        }

        .data-table { width: 100%; border-collapse: collapse; }
        .data-table th, .data-table td {
            padding: var(--space-sm) var(--space-md);
            text-align: left;
            border-bottom: 1px solid var(--color-secondary);
        }
        .data-table th { font-weight: 600; color: var(--color-text-secondary); }

        .btn {
            padding: var(--space-sm) var(--space-md);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: var(--font-size-base);
        }
        .btn-primary { background: var(--color-primary); color: white; }
        .btn-secondary {
            background: transparent;
            border: 1px solid var(--color-secondary);
            color: var(--color-text-primary);
        }

        .footer {
            grid-area: footer;
            background: var(--color-bg-header);
            padding: var(--space-md);
            text-align: center;
            color: var(--color-text-secondary);
            font-size: 12px;
        }

        @media (max-width: 768px) {
            .app-shell {
                grid-template-columns: 1fr;
                grid-template-areas: "header" "main" "footer";
            }
            .sidebar { display: none; }
        }
    </style>
</head>
<body>
    <div class="app-shell">
        <header class="header">
            <div class="logo">{Project Name}</div>
            <div><span>User Name</span></div>
        </header>

        <aside class="sidebar">
            <nav>
                <a href="#" class="active">Dashboard</a>
                <a href="#">{Page 2}</a>
                <a href="#">{Page 3}</a>
                <a href="#">Settings</a>
            </nav>
        </aside>

        <main class="main">
            <h1 class="page-title">Dashboard</h1>
            <div class="card-grid">
                <div class="card">
                    <div class="card-title">Metric 1</div>
                    <div style="font-size:32px;font-weight:700;">42</div>
                    <div style="color:var(--color-text-secondary);">Description</div>
                </div>
                <div class="card">
                    <div class="card-title">Metric 2</div>
                    <div style="font-size:32px;font-weight:700;">128</div>
                    <div style="color:var(--color-text-secondary);">Description</div>
                </div>
                <div class="card">
                    <div class="card-title">Metric 3</div>
                    <div style="font-size:32px;font-weight:700;">97%</div>
                    <div style="color:var(--color-text-secondary);">Description</div>
                </div>
            </div>
            <div class="card" style="margin-top:var(--space-md);">
                <div class="card-title">Recent Items</div>
                <table class="data-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
                    <tbody>
                        <tr><td>Item 1</td><td>Active</td><td>2025-01-01</td><td><button class="btn btn-secondary">View</button></td></tr>
                        <tr><td>Item 2</td><td>Pending</td><td>2025-01-02</td><td><button class="btn btn-secondary">View</button></td></tr>
                        <tr><td>Item 3</td><td>Complete</td><td>2025-01-03</td><td><button class="btn btn-secondary">View</button></td></tr>
                    </tbody>
                </table>
            </div>
        </main>

        <footer class="footer">&copy; {Year} {Project Name}. All rights reserved.</footer>
    </div>
</body>
</html>
```

---

## Required Sections Checklist

### UX Spec (`_project-design.md`)
- [ ] Design Philosophy (clear, opinionated principles)
- [ ] Typography scale (H1-Body minimum)
- [ ] Layout System (shell structure + grid + spacing)
- [ ] Component Inventory (core components with variants)
- [ ] Interaction Patterns (navigation, data entry, feedback)
- [ ] Responsive Behavior (breakpoints with specific changes)
- [ ] Accessibility requirements (WCAG level, contrast, keyboard)

### Wireframes (`_wireframes.md`)
- [ ] Page inventory table
- [ ] Navigation flow diagram
- [ ] At least 2 page wireframes (ASCII art)
- [ ] Desktop AND mobile layout for primary pages
- [ ] Purpose, entry points, and key interactions per page

### Light Theme (`_design.light.md`)
- [ ] Brand colors defined
- [ ] Semantic color tokens (primary, success, warning, danger)
- [ ] Background color hierarchy
- [ ] Text color scale (primary, secondary, disabled)
- [ ] Component state mapping
- [ ] WCAG contrast compliance table

### Dark Theme (`_design.dark.md`)
- [ ] All light theme tokens mapped to dark equivalents
- [ ] Surface elevation strategy (lighter surfaces, not shadows)
- [ ] WCAG contrast compliance verified for dark backgrounds
- [ ] Design notes explaining dark-mode principles

### Mock Layout (`_mock-layout.html`)
- [ ] Self-contained (inline CSS, no external dependencies)
- [ ] Uses CSS custom properties matching theme tokens
- [ ] Application shell matches UX spec layout
- [ ] Responsive (at least mobile + desktop breakpoints)
- [ ] Representative placeholder content
- [ ] Renders correctly in modern browsers

## Quality Criteria

### Good Design Suite
- All 5 files are internally consistent (same tokens, same layout)
- Color tokens use semantic names (`--color-danger`) not raw values
- Wireframes use ASCII art (no external tools needed)
- Mock layout opens in any browser without dependencies
- Dark theme is derived from light theme systematically
- WCAG compliance is verified for both themes

### Bad Design Suite
- Files reference different color values
- No semantic token naming
- Mock layout requires external CSS frameworks
- Wireframes missing or "see Figma"
- Dark theme is a separate design with no light-theme relationship
- No accessibility verification

## Interview Questions

1. "What's the overall feel? (professional, playful, minimal, data-dense)"
2. "Any brand colors or existing design language?"
3. "What devices/screen sizes matter most?"
4. "Any accessibility requirements? (WCAG level, audience needs)"
5. "What's the most important page/view in the app?"
6. "Any design inspirations or anti-inspirations?"
7. "Light mode, dark mode, or both?"
8. "What UI component library are you using? (or building custom)"

## Cross-References
- Reads from: `docs/_project-requirements.md` (required)
- Produces: `docs/_project-design.md`, `docs/design/_wireframes.md`, `docs/design/_design.light.md`, `docs/design/_design.dark.md`, `docs/design/_mock-layout.html`
- Feeds into: `docs/_project-architecture.md` (component decisions)
