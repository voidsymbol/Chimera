# Instance-UI

The [shadcn/ui](https://ui.shadcn.com) catalogue, and [MUI](https://mui.com)'s, written on
[Instance](https://github.com/voidsymbol/Instance): each component next to the original, with the count.

Two halves, and the split is the point.

- **What the platform already has** — a button, an input, a select, a dialog, a sheet, a switch, an accordion, a
  dropdown menu, a popover, a progress bar, a table — is a stylesheet on the native element and nothing else. No class,
  no script, no wrapper. The behaviour, the keyboard, the focus order and what a screen reader says are the browser's,
  because the element is the browser's. `ui/native.css` is the whole of that half; put `class="ui"` on a container and
  it is on.
- **What the platform lacks** — tabs, a combobox, a command palette, a toast, a data table, a calendar — is one class
  each, with a tag of its own, written on the platform's own primitives and the APG's ARIA. `ui/tabs.is` is the first.

One script, `Instance-UI-0.92.g.js`, loaded after the runtime, carries the classes and the fourteen semantic elements
that lived in the runtime until 0.92.g — `<router>`, `<route>`, `<outlet>`, `<portal>`, `<email>`, `<tel>`, `<website>`,
`<mailto>`, `<logout>`, `<reset>`, `<intl>`, `<async>`, `<sync>`, `<static>` (`src/platform.js`). No dependencies, one
file per component. The page is `index.html`; serve the folder and open it.

    <script src="lib/Instance-0.92.g.js" ⚡></script>
    <script src="Instance-UI-0.92.g.js"></script>

## In the repository

- `ui/` — the components: `tokens.css`, `native.css`, one `.is` per class. The source.
- `src/platform.js` — the semantic elements, as they left the runtime.
- `Instance-UI-<version>.js` — the one script, written by `tools/build.js` from the two above with the runtime's own
  compiler; the version is the runtime's, read from `lib/`.
- `tools/check.js` — the check, in Chrome: the page loads clean, the native half is styled, Tabs mint from markup with
  their ARIA and keyboard, the dialog and the menu open without a script, the router routes; dark and light.
- `compare/` — the count, below.
- `chimera/` — the Chimera repository this one was, with its history: the reactive engine's public build, its README
  and its syntax notes. Chimera is inside Instance now (the runtime is one file); this folder is its record.

## The count

`compare/count.js` reads the two libraries' repositories and this one, and writes `compare/counts.json`: for every
component, the lines of the implementation files you get — tests, type declarations and index files left out — and the
packages they import. shadcn's is the `.tsx` its CLI copies into your repository; the behaviour sits in the Radix
packages it imports, which are named. MUI's is the component's folder in `@mui/material` and the package's own
components it is built from. This kit's is the component's block of `native.css`, or its `.is` file.

| Component | shadcn/ui | MUI | Instance-UI |
|---|---:|---:|---:|
| Button | 59 | 2,135 | 25, CSS only |
| Input · Textarea · Select · Label | 338 | 3,302 | 17, CSS only |
| Checkbox · Radio · Switch · Slider · Toggle group | 233 | 4,836 | 18, CSS only |
| Dialog · Sheet | 275 | 2,304 | 13, CSS only |
| Accordion · Collapsible | 87 | 1,185 | 12, CSS only |
| Dropdown menu · Popover | 318 | 1,636 | 8, CSS only |
| Tabs | 83 | 1,676 | 47, one class |
| Progress · Badge · Alert · Skeleton · Avatar · Separator | 290 | 2,843 | 21, CSS only |
| Card · Table · Breadcrumb · Pagination | 404 | 2,806 | 19, CSS only |

Lines, at shadcn `055aa6b` and MUI `0fb8b83`. Run it yourself:

    git clone --depth 1 --filter=blob:none --sparse https://github.com/shadcn-ui/ui.git /tmp/shadcn
    git -C /tmp/shadcn sparse-checkout set apps/v4/registry/new-york-v4/ui
    git clone --depth 1 --filter=blob:none --sparse https://github.com/mui/material-ui.git /tmp/mui
    git -C /tmp/mui sparse-checkout set packages/mui-material/src
    node compare/count.js /tmp/shadcn /tmp/mui

## Build and check

    npm install --no-save jsdom playwright     # jsdom runs the compiler for the build; Playwright drives Chrome for the check
    node tools/build.js                        # → Instance-UI-<version>.js, and the page's script tags
    node tools/check.js                        # CHROME=/path/to/chrome names a browser; PLAYWRIGHT=… a module path

## What it needs

A browser of 2025 or later: CSS nesting, `light-dark()`, `:has()`, `<details name>`, the popover attribute, anchor
positioning, and `commandfor` on a button. Chrome 135, Safari 26, Firefox 147. There is no fallback, on purpose: the
kit is a statement about the platform as it is, not as it was.

## Licence

The Instance Source License, v1.4 — `LICENSE.md`.
