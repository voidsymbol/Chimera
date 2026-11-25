// compare/count.js <shadcn-clone> <mui-clone> — counts what each library ships for a component, and what this kit does.
//
// The method, the same for all three: the lines of the implementation files you get for the component — tests, type
// declarations and index files left out — and the packages they import. For shadcn that is the one .tsx the CLI copies
// into your repository; the behaviour sits in the Radix packages it imports, which are
// named, not counted (they are yours to ship too). For MUI it is the component's folder in @mui/material and the
// package's own components it is built from (a Button is a Button and a ButtonBase; Tabs are Tabs, a Tab and the scroll
// buttons), with the packages those import named. For Instance-UI it is the component's block of native.css, or its .is
// file: what is on disk is what runs.
//
//   node compare/count.js /tmp/cmp/shadcn /tmp/cmp/mui      → writes compare/counts.json, prints the table
const fs = require('fs'), path = require('path');
const [SHADCN, MUI] = process.argv.slice(2).map(p => path.resolve(p));
const HERE = __dirname, KIT = path.join(HERE, '..', 'ui');

const COMPONENTS = {
	button:    { shadcn: ['button'],                       mui: ['Button', 'ButtonBase'],                                   kit: { css: 'Button' } },
	input:     { shadcn: ['input', 'textarea', 'label', 'native-select', 'field'], mui: ['TextField', 'OutlinedInput', 'InputBase', 'FormControl', 'InputLabel', 'FormHelperText', 'NativeSelect'], kit: { css: 'Input · Textarea · Select' } },
	switch:    { shadcn: ['checkbox', 'radio-group', 'switch', 'slider', 'toggle-group'], mui: ['Checkbox', 'Radio', 'RadioGroup', 'Switch', 'Slider', 'ToggleButton', 'ToggleButtonGroup', 'internal:SwitchBase'], kit: { css: 'Checkbox · Radio · Switch · Slider · Toggle group' } },
	dialog:    { shadcn: ['dialog', 'sheet'],              mui: ['Dialog', 'DialogTitle', 'DialogContent', 'DialogContentText', 'DialogActions', 'Drawer', 'Modal'], kit: { css: 'Dialog · Sheet' } },
	accordion: { shadcn: ['accordion', 'collapsible'],     mui: ['Accordion', 'AccordionSummary', 'AccordionDetails', 'Collapse'], kit: { css: 'Accordion · Collapsible' } },
	dropdown:  { shadcn: ['dropdown-menu', 'popover'],     mui: ['Menu', 'MenuItem', 'MenuList', 'Popover'],                 kit: { css: 'Dropdown menu · Popover' } },
	tabs:      { shadcn: ['tabs'],                         mui: ['Tabs', 'Tab', 'TabScrollButton'],                          kit: { is: 'tabs.is' } },
	progress:  { shadcn: ['progress', 'badge', 'alert', 'skeleton', 'avatar', 'separator', 'kbd'], mui: ['LinearProgress', 'Chip', 'Alert', 'AlertTitle', 'Skeleton', 'Avatar', 'Divider'], kit: { css: 'Progress · Badge · Alert · Skeleton · Avatar · Separator' } },
	card:      { shadcn: ['card', 'table', 'breadcrumb', 'pagination'], mui: ['Card', 'CardHeader', 'CardContent', 'CardActions', 'Table', 'TableHead', 'TableBody', 'TableRow', 'TableCell', 'TableContainer', 'Breadcrumbs', 'Pagination', 'PaginationItem', 'usePagination'], kit: { css: 'Card · Table · Breadcrumb · Pagination' } },
};

const lines = text => text.split('\n').filter(l => l.trim() !== '').length;
const imports = text => [...text.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
const pkg = s => s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.includes(' ') ? s : s.split('/')[0];      // the package, not the path inside it
const external = list => [...new Set(list.filter(s => !s.startsWith('.') && !s.startsWith('@/') && !s.startsWith('@mui/material') && s !== 'react' && s !== 'prop-types').map(pkg))].sort();

function shadcn(names) {
	let n = 0, files = [], deps = [];
	for (const name of names) {
		const f = path.join(SHADCN, 'apps/v4/registry/new-york-v4/ui', name + '.tsx');
		const t = fs.readFileSync(f, 'utf8'); n += lines(t); files.push(name + '.tsx'); deps.push(...imports(t));
	}
	deps = deps.map(d => d === 'cn' ? 'cn (clsx + tailwind-merge)' : d);     // the registry's helper, a package of its own in the v4 app
	return { lines: n, files, deps: external(deps) };
}
function mui(names) {
	let n = 0, files = [], deps = [];
	for (const name of names) {
		const one = name.startsWith('internal:') ? name.slice(9) : null;            // one file of src/internal
		const dir = path.join(MUI, 'packages/mui-material/src', one ? 'internal' : name);
		for (const f of fs.readdirSync(dir)) {
			if (one && !f.startsWith(one + '.')) continue;
			if (!/\.(js|ts|tsx)$/.test(f) || /\.(test|spec|d)\.(js|ts|tsx)$/.test(f) || /^index\./.test(f)) continue;
			const t = fs.readFileSync(path.join(dir, f), 'utf8'); n += lines(t); files.push(name + '/' + f); deps.push(...imports(t));
		}
	}
	return { lines: n, files, deps: external(deps) };
}
function kit(spec) {
	let n = 0, files = [];
	if (spec.css) {
		const t = fs.readFileSync(path.join(KIT, 'native.css'), 'utf8');
		const blocks = t.split(/\n\t\/\* ── /).slice(1);          // each block opens with its name
		for (const b of blocks) { const name = b.slice(0, b.indexOf(' ─')); if (name === spec.css) { n += lines(b.split('\n').slice(1).join('\n')); files.push('native.css · ' + name); } }
		if (n === 0) throw new Error('no block named ' + spec.css);
	}
	if (spec.is) { n += lines(fs.readFileSync(path.join(KIT, spec.is), 'utf8')); files.push(spec.is); }
	return { lines: n, files, deps: [], note: spec.is ? 'one class' : 'CSS only, no script' };
}
const head = dir => { try { return require('child_process').execSync('git log -1 --format=%h,%cs', { cwd: dir }).toString().trim(); } catch (e) { return '?'; } };
const out = { _method: 'lines of the implementation files, tests/types/index left out; packages imported, named', _shadcn: head(SHADCN), _mui: head(MUI) };
for (const [key, c] of Object.entries(COMPONENTS)) {
	out[key] = { shadcn: shadcn(c.shadcn), mui: mui(c.mui), instance: kit(c.kit) };
	for (const side of ['shadcn', 'mui']) out[key][side].deps = out[key][side].deps.join(', ');
	const r = out[key];
	console.log(key.padEnd(10), 'shadcn', String(r.shadcn.lines).padStart(5), '| mui', String(r.mui.lines).padStart(6), '| instance', String(r.instance.lines).padStart(4), r.instance.note);
}
fs.writeFileSync(path.join(HERE, 'counts.json'), JSON.stringify(out, null, 1) + '\n');
console.log('shadcn ' + out._shadcn + ' · mui ' + out._mui + ' → compare/counts.json');
