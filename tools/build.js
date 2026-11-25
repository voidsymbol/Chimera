// tools/build.js — writes Instance-UI-<version>.js: the fourteen semantic elements (src/platform.js, as they left the
// runtime in 0.92.g) and every component under ui/, each .is compiled by the runtime's own compiler, then one sweep over
// the tags for markup the page already had. The version is the engine's, read from lib/. No dependencies beyond the
// engine itself: the compiler runs in jsdom here, which `npm install --no-save jsdom` provides.
//
//   node tools/build.js            → Instance-UI-0.92.g.js (and the page's script tag, kept in step)
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const engine = fs.readdirSync(path.join(ROOT, 'lib')).find(f => /^Instance-\d+\.\d+\.[0-9a-v]+\.js$/.test(f));
if (!engine) throw new Error('lib/ holds no Instance-<version>.js');
const version = engine.slice('Instance-'.length, -3), out = `Instance-UI-${version}.js`;
const { JSDOM } = require(fs.existsSync(path.join(ROOT, 'node_modules/jsdom')) ? path.join(ROOT, 'node_modules/jsdom') : 'jsdom');

(async () => {
	// the engine, compiler included, loaded as a page loads it (the compiler wants its own <script>); nocapture: nothing to compile here
	const dom = new JSDOM(`<!doctype html><html><head><script src="lib/${engine}" nocapture></script></head><body></body></html>`,
		{ url: 'file://' + ROOT + '/build.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
	const w = dom.window;
	await new Promise((res, rej) => { w.addEventListener('load', res); setTimeout(() => rej(new Error('the engine did not load')), 20000); });
	if (typeof w.Superset !== 'function') throw new Error('no compiler in ' + engine);
	const compile = src => w.Superset.compile(src, { nocapture: true }).code;
	const parts = [];
	parts.push(`/* Instance-UI ${version} · the semantic elements and the components, on Instance ${version} · built by tools/build.js */`);
	parts.push(`/* ── src/platform.js — <router> <route> <outlet> <portal> <email> <tel> <website> <mailto> <logout> <reset> <intl> <async> <sync> <static> ── */`);
	parts.push(fs.readFileSync(path.join(ROOT, 'src/platform.js'), 'utf8').trim());
	const tags = ['router', 'outlet', 'route', 'portal', 'email', 'tel', 'website', 'mailto', 'logout', 'reset', 'intl', 'async', 'sync', 'static'];
	for (const f of fs.readdirSync(path.join(ROOT, 'ui')).filter(f => f.endsWith('.is')).sort()) {
		const src = fs.readFileSync(path.join(ROOT, 'ui', f), 'utf8');
		let code;
		try { code = compile(src); } catch (e) { throw new Error(`ui/${f}: ${e.message}`); }
		parts.push(`/* ── ui/${f} ── */`);
		parts.push(code.trim());
		for (const m of src.matchAll(/^class\s+([A-Z]\w*)\s+extends\s+Instance\b/gm)) tags.push(m[1].toLowerCase());
	}
	parts.push(`/* the page may already be parsed when this runs (the compiler's capture runs a page's scripts once it is): what the
 * runtime's boot ring passed over before the classes existed is upgraded here, once, router and outlet first */
(function () {
	const sweep = () => { for (const tag of ${JSON.stringify(tags)}) document.querySelectorAll(tag).forEach(el => Instance.upgrade(el)); };
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep, { once: true }); else sweep();
})();`);
	const text = parts.join('\n\n') + '\n';
	for (const old of fs.readdirSync(ROOT).filter(f => /^Instance-UI-.*\.js$/.test(f) && f !== out)) fs.unlinkSync(path.join(ROOT, old));
	fs.writeFileSync(path.join(ROOT, out), text);
	// the page loads the engine and this file by name
	const page = path.join(ROOT, 'index.html');
	let html = fs.readFileSync(page, 'utf8');
	html = html.replace(/<script src="lib\/Instance-[^"]+" ⚡><\/script>\s*\n(\s*<script src="[^"]+"><\/script>\s*\n)*/, `<script src="lib/${engine}" ⚡></script>\n<script src="${out}"></script>\n`);
	fs.writeFileSync(page, html);
	console.log(`${out}: ${text.split('\n').length} lines, ${Math.round(text.length / 1024)} KB — ${tags.length} tags`);
	w.close();
})().catch(e => { console.error(e.message); process.exit(1); });
