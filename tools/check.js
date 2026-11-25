// tools/check.js — the kit's check, in Chrome: serves the repository, opens index.html, and holds the components to what
// the page says: no error on load, the native half styled, Tabs minted from markup with its ARIA and its keyboard, the
// dialog opened by its button, the menu by its, the router routing (the case the runtime's suite kept until 0.92.g),
// in the dark scheme and the light one. Playwright drives it; the browser is Chrome where CHROME names one.
//
//   node tools/check.js            → a line per check; exit 1 on the first that fails
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
let failed = 0;
const ok = (cond, what) => { console.log((cond ? '  ok   ' : '  FAIL ') + what); if (!cond) failed++; };

(async () => {
	const srv = http.createServer((q, r) => {
		let f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0].split('#')[0])); if (f.endsWith('/')) f += 'index.html';
		if (f.endsWith('/app/one') || f.endsWith('/app/two')) f = path.join(ROOT, 'index.html');               // the router's routes serve the page
		if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { r.writeHead(404); return r.end(); }
		r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
	});
	await new Promise(res => srv.listen(0, '127.0.0.1', res));
	const base = 'http://127.0.0.1:' + srv.address().port;
	const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
	for (const colorScheme of ['dark', 'light']) {
		console.log(colorScheme + ':');
		const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 }, colorScheme })).newPage();
		const errors = [];
		page.on('pageerror', e => errors.push(e.message));
		page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
		page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(r.status() + ' ' + r.url()); });
		await page.goto(base + '/'); await page.waitForLoadState('load'); await page.waitForTimeout(500);
		ok(errors.length === 0, 'the page loads without an error' + (errors.length ? ': ' + errors.join(' | ') : ''));
		const styled = await page.evaluate(() => { const b = document.querySelector('.demo button'); return getComputedStyle(b).height === '36px' && getComputedStyle(b).borderRadius === '8px'; });
		ok(styled, 'the native half is styled (a button is 36px high, radius 8px)');
		const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.page')).backgroundColor);
		ok(colorScheme === 'dark' ? bg === 'rgb(14, 15, 18)' : bg === 'rgb(255, 255, 255)', 'the scheme is the page\'s: ' + bg);
		// Tabs
		const t0 = await page.evaluate(() => { const t = document.querySelector('tabs'); return { cls: t.constructor.name, role: t.querySelector('nav').getAttribute('role'), sel: [...t.querySelectorAll('nav > button')].map(b => b.getAttribute('aria-selected')).join(), hid: [...t.querySelectorAll('section')].map(s => s.hidden).join() }; });
		ok(t0.cls === 'Tabs' && t0.role === 'tablist' && t0.sel === 'true,false' && t0.hid === 'false,true', 'tabs minted from markup, ARIA on, first selected: ' + JSON.stringify(t0));
		await page.click('tabs nav button:nth-child(2)'); await page.waitForTimeout(80);
		const t1 = await page.evaluate(() => { const t = document.querySelector('tabs'); return t.active + ':' + [...t.querySelectorAll('section')].map(s => s.hidden).join(); });
		ok(t1 === '1:true,false', 'a click selects the second tab and shows its panel: ' + t1);
		await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80);
		const t2 = await page.evaluate(() => document.querySelector('tabs').active + ':' + document.activeElement.textContent);
		ok(t2 === '0:Account', 'ArrowRight wraps to the first tab and focuses it: ' + t2);
		// Dialog, by commandfor
		await page.click('button[commandfor="d1"]'); await page.waitForTimeout(120);
		ok(await page.evaluate(() => document.getElementById('d1').open), 'the dialog opens from its button, no script');
		await page.click('dialog#d1 button[command="close"]'); await page.waitForTimeout(80);
		ok(await page.evaluate(() => !document.getElementById('d1').open), 'and closes from its footer');
		// Menu, by popovertarget
		await page.click('button[popovertarget="m1"]'); await page.waitForTimeout(120);
		ok(await page.evaluate(() => document.getElementById('m1').matches(':popover-open')), 'the menu opens as a popover');
		await page.keyboard.press('Escape'); await page.waitForTimeout(80);
		ok(await page.evaluate(() => !document.getElementById('m1').matches(':popover-open')), 'and Escape closes it');
		// The router: the case the runtime's suite held until 0.92.g (route() commits without a history entry; a click
		// inside <router> navigates once; a <router> enters without an error)
		const r = await page.evaluate(async () => {
			const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
			const out = { ok: [], bad: [] }, assert = (c, w) => (c ? out.ok : out.bad).push(w);
			const Router = Instance.router;
			const router = document.createElement('router'), a = document.createElement('a'); a.href = '/app/one'; a.textContent = 'one'; router.appendChild(a);
			const outlet = document.createElement('outlet');
			document.body.appendChild(router); document.body.appendChild(outlet);
			const warned = []; const ow = console.warn; console.warn = (...x) => { warned.push(x.map(String).join(' ')); };
			try {
				await tick();
				assert(Object.prototype.toString.call(outlet) === '[object Outlet]' && Object.prototype.toString.call(router) === '[object Router]', 'both upgraded');
				assert(!warned.some(w => /@insertion\(\) error/.test(w)), 'the router entered without an error: ' + warned.join(' | '));
				const renders = { one: 0, two: 0 }, navs = [];
				const onNav = (from, to) => navs.push(to.path); Router.on('navigate', onNav);
				const start = location.pathname, h0 = history.length;
				outlet.route({ [start]: () => new Div('home'), '/app/one': () => { renders.one++; return new Div('one'); }, '/app/two': () => { renders.two++; return new Div('two'); } });
				assert(history.length === h0, 'route() left no history entry behind: ' + (history.length - h0));
				navs.length = 0;
				a.click(); await tick();
				assert(navs.join(',') === '/app/one' && renders.one === 1, 'a click inside <router> navigated once: ' + navs.join(',') + ' renders ' + renders.one);
				assert(history.length === h0 + 1, 'one history entry for the click: ' + (history.length - h0));
				Router.navigate('/app/two'); await tick();
				assert(renders.two === 1 && navs.length === 2, 'a programmatic navigate commits once');
				Router.off('navigate', onNav);
				Router._unregister(outlet);
				history.replaceState({}, '', start);
			} catch (e) { out.bad.push('threw: ' + e.message); } finally {
				console.warn = ow;
				document.body.removeChild(router); document.body.removeChild(outlet);
			}
			return out;
		});
		for (const w of r.ok) ok(true, 'router: ' + w);
		for (const w of r.bad) ok(false, 'router: ' + w);
		await page.context().close();
	}
	await browser.close(); srv.close();
	console.log(failed ? `${failed} failed` : 'all good');
	process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
