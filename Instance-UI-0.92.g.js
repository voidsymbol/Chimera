/* Instance-UI 0.92.g · the semantic elements and the components, on Instance 0.92.g · built by tools/build.js */

/* ── src/platform.js — <router> <route> <outlet> <portal> <email> <tel> <website> <mailto> <logout> <reset> <intl> <async> <sync> <static> ── */

/**!
* @license ISL-1.4 — the Instance Source License, v1.4 (LICENSE.md)
* @description Instance-UI — the semantic elements: <router> <route> <outlet> and the eleven tags the platform never shipped (from Instance's platform module, 0.92.g)
*/
/* ═══════════════════════════════════════════════════════════════════════════
 * Instance PLATFORM v1 — the platform-gap element vocabulary.
 *
 * <router> <route> <outlet> and the eleven tags the platform never shipped:
 * <static> <email> <tel> <website> <mailto> <logout> <reset> <portal> <intl>
 * <async> <sync>. Fourteen classes, all of them CORE_TAGS.
 *
 * IT DEFINES ELEMENTS, which is the thing that made this look unmovable. Core
 * keeps the fourteen NAMES — CORE_TAGS is what the boot ring scans — and this
 * module supplies what they BECOME. The ring resolves through CUSTOM_TAGS at
 * DOMContentLoaded, so the classes only have to exist by then, not by the time
 * core's own script ends.
 *
 * NOT SELF-CONTAINED: it extends Instance and registers Instance elements, so a
 * missing broker throws rather than publishing to a symbol nobody reads.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';
/* Core's internals, once, through the §10a kit. Read here rather than in the
 * monolith, where every one of these is already in lexical scope — which is why
 * this preamble lives in the BUILD and not in the source. */
const __K = globalThis[Symbol.for('Instance')]('latest', 'platformkit');
if (__K == null) throw new Error(
	'Instance PLATFORM: core did not publish the "platformkit" domain \u2014 load order is core \u2192 chimera \u2192 dsl \u2192 platform.');
const { CORE_TAGS, MINTED, Signal, _RT, _httpGET, _looksLikeURL, _nsFire,
        createElement, Instance } = __K;
let _I18N = __K._I18N;

/* ═══ §10 PLATFORM — router + the platform-gap vocabulary (extracted to modules/i_platform-1.0.js) ═══ */
/* ═══ §10 ROUTER (Pass H engine, UNIFIED in Pass P) — ONE class, two faces.
 *
 *   Router.navigate('/x') · Router.back() · Router.before(fn) · Router.current …
 *     — the engine, ALL static: parse/compile/match tables, history wiring
 *       (push | hash | memory), guards as middleware (fn(from, to, next):
 *       next() proceeds, next('/path') redirects, silence blocks), commits
 *       into registered outlets. State is the top-level _RT record; the old
 *       frozen singleton's prototype face lives here verbatim — with one
 *       class there is nothing left to instantiate for the API.
 *
 *   <router base=… history=…><route path=… src=…/></router>
 *     — the element: an Instance whose ['@mount'] configures the engine from
 *       attributes, compiles <route> children into the table (extra named
 *       route-attributes target named outlets), watches childList for table
 *       edits, and delegates its anchor clicks. Detach-honest: ['@removal']
 *       unregisters (a detached router must not commit into a gone tree),
 *       ['@insertion'] re-registers, ['@unmount'] is final.
 *
 * Machinery statics (parse/compile/match/push/_navigate/commit/wire) stay
 * PUBLIC — Events' el.route() and the element face drive them from outside.
 * router.path is a kernel Signal MINTED EAGERLY in _register: a lazy first
 * mint inside a running effect would be adopted by that effect and disposed
 * on its re-run (the zombie-handle trap, see the Pass-H checkpoint). */
class Router extends Instance {

	/* — element face — */
	#childObs = null;
	#mounted = false;   // doc:C-ROUTER — re-entry registers again only after the first mount (it read a core-private name and threw on every insertion)
	['@mount']() {
		this.#mounted = true;
		Router.configure({ base: this.getAttribute('base') || '', history: this.getAttribute('history') || 'push' });
		this.#registerAll();
		this.#childObs = new MutationObserver(() => this.#registerAll());
		this.#childObs.observe(this, { childList: true });
		/* doc:C-ROUTER — ONE CLICK HANDLER. The element had a delegate of its own beside the
		 * document's (wire): a click on an anchor inside <router> navigated twice — two
		 * history entries, two commits (measured). The document's handler reads anchors
		 * inside a <router> as the element's; the element only makes sure it is wired. */
		Router.wire();
	}
	['@removal']() { this.#unregister(); } // detach-honest: never commit into a gone tree
	['@insertion']() { if (this.#mounted) this.#registerAll(); } // re-entry restores the table (@mount owns the first)
	['@unmount']() {
		if (this.#childObs) { this.#childObs.disconnect(); this.#childObs = null; }
		this.#unregister();
	}
	#buildRouteMap() {
		const routes = [...this.querySelectorAll('route')];
		const routeMap = {}, namedMaps = {};
		routes.forEach(route => {
			const path = route.getAttribute('path');
			if (!path) return;
			const src = route.getAttribute('src');
			const namedAttrs = [...route.attributes].filter(a => a.name !== 'path' && a.name !== 'src');
			namedAttrs.forEach(a => { if (!namedMaps[a.name]) namedMaps[a.name] = {}; namedMaps[a.name][path] = a.value; });
			if (src) routeMap[path] = src;
		});
		return { routeMap, namedMaps };
	}
	#registerAll() {
		const { routeMap, namedMaps } = this.#buildRouteMap();
		const defaultOutlet = document.querySelector('outlet:not([name])') || document.querySelector('outlet') || document.querySelector('[data-outlet]');
		if (defaultOutlet && Object.keys(routeMap).length) Router._register(defaultOutlet, routeMap, {});
		Object.entries(namedMaps).forEach(([name, map]) => {
			const outlet = document.querySelector('outlet[name="' + name + '"]');
			if (outlet && Object.keys(map).length) Router._register(outlet, map, {});
		});
	}
	#unregister() {
		const d = document.querySelector('outlet:not([name])') || document.querySelector('outlet');
		if (d) Router._unregister(d);
	}

	/* — public engine face (verbatim from the old singleton's prototype) — */
	static configure(opts) { Object.assign(_RT.config, opts || {}); return Router; }
	static navigate(path, opts) { Router.push(path, !!(opts && opts.replace)); return Router; }
	static back()    { history.back();    return Router; }
	static forward() { history.forward(); return Router; }
	static before(fn) { if (typeof fn === 'function') _RT.guards.push(fn); return Router; }
	static on(ev, fn)  { if (_RT.listeners[ev]) _RT.listeners[ev].add(fn); return Router; }
	static off(ev, fn) { if (_RT.listeners[ev]) _RT.listeners[ev].delete(fn); return Router; }
	static get current() { return Object.assign({}, _RT.current); }
	static get path() { if (!_RT.path) _RT.path = new Signal.State(_RT.current.path); return _RT.path; }
	static _unregister(outlet) { _RT.tables.delete(outlet); return Router; }
	static _register(outlet, routeMap, options) {
		const table = [];
		for (const pattern of Object.keys(routeMap))
			table.push({ pattern, compiled: Router.compile(pattern), source: routeMap[pattern], options: options || {} });
		_RT.tables.set(outlet, table);
		// mint the path signal HERE — outside any consumer. A lazy first mint inside
		// a running effect would be ADOPTED by that effect and disposed on its re-run
		// (effect-owned children are cleaned per run) — the zombie-handle trap.
		if (!_RT.path) _RT.path = new Signal.State(_RT.current.path);
		Router.wire();
		return Router;
	}

	/* — machinery (navigate → _navigate: that name now belongs to the public face) — */
	static parse(full) {
		const u = new URL(full, (typeof location !== 'undefined' && location.origin && location.origin !== 'null' && location.origin) || 'http://x'); // about:blank / sandboxed frames report the STRING 'null' — truthy, invalid as a base
		const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
		return { path: u.pathname || '/', query, hash: u.hash ? u.hash.slice(1) : '' };
	}
	static compile(pattern) {
		const names = [];
		const rx = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '(?<wild>.*)')
			.replace(/:(\w+)/g, (_, n) => { names.push(n); return '(?<' + n + '>[^/]+)'; });
		return { rx: new RegExp('^' + rx + '/?$'), names };
	}
	static match(compiled, path) {
		const m = compiled.rx.exec(path);
		if (!m) return null;
		const out = {};
		if (m.groups) for (const k of Object.keys(m.groups)) if (m.groups[k] !== undefined) out[k] = decodeURIComponent(m.groups[k]);
		return out;
	}
	static push(path, replace) {
		const c = _RT.config;
		if (c.history === 'hash') { if (replace) location.replace('#' + path); else location.hash = path; }
		else if (c.history === 'memory') { Router._navigate(path); }
		else {
			const full = c.base + path;
			if (replace) history.replaceState({}, '', full); else history.pushState({}, '', full);
			Router._navigate(path);
		}
	}
	static _navigate(pathOrFull, fromPopstate) {
		const parsed = _RT.config.history === 'hash'
			? Router.parse((location.hash && location.hash.slice(1)) || '/')
			: Router.parse(pathOrFull);
		const from = Object.assign({}, _RT.current);
		const to = { path: parsed.path, query: parsed.query, hash: parsed.hash, params: {} };
		const guards = _RT.guards.slice(); let i = 0;
		(function next(redirect) {
			if (redirect && typeof redirect === 'string') { Router.push(redirect, false); return; }
			if (i < guards.length) { guards[i++](from, to, next); return; }
			Router.commit(from, to, parsed, !!fromPopstate);
		})();
	}
	static commit(from, to, parsed, fromPopstate) {
		let matched = null, matchParams = {}, matchOutlet = null, matchSource = null;
		for (const [outlet, table] of _RT.tables) {
			for (const entry of table) {
				const params = Router.match(entry.compiled, parsed.path);
				if (params !== null) {
					matched = entry; matchParams = params; matchOutlet = outlet;
					matchSource = typeof entry.source === 'function' ? entry.source.call(outlet, params, parsed) : entry.source;
					break;
				}
			}
			if (matched) break;
		}
		if (!matched) { _RT.listeners.error.forEach(fn => { try { fn(new Error('No route matched: ' + parsed.path)); } catch (e) {} }); return; }
		to.params = matchParams;
		_RT.current = Object.assign({}, to);
		if (_RT.path) _RT.path.set(parsed.path);
		if (_RT.config.scroll && !fromPopstate && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
		const ctx = { from, to, params: matchParams, query: parsed.query, hash: parsed.hash };
		if (matchOutlet && typeof matchOutlet['@routeleave'] === 'function') matchOutlet['@routeleave'](ctx);
		const _after = () => {
			if (typeof matchOutlet['@routeenter'] === 'function') matchOutlet['@routeenter'](Object.assign({ el: matchOutlet }, ctx));
			if (typeof matchOutlet['@navigate'] === 'function') matchOutlet['@navigate'](ctx);
			_RT.listeners.navigate.forEach(fn => { try { fn(from, to); } catch (e) {} });
		};
		if (matchSource instanceof Node) { matchOutlet.innerHTML = ''; matchOutlet.appendChild(matchSource); _after(); }
		else if (typeof matchSource === 'string' && _looksLikeURL(matchSource))
			Promise.resolve(typeof matchOutlet.get === 'function' ? matchOutlet.get(matchSource) : _httpGET(matchSource))
				.then(html => { matchOutlet.innerHTML = String(html); _after(); }, () => _after());
		else _after();
	}
	static wire() {
		if (_RT.wired || typeof document === 'undefined') return;
		_RT.wired = true;
		document.addEventListener('click', (e) => {
			const anchor = e.target && e.target.closest && e.target.closest('a[href]');
			if (!anchor) return;
			const inRouter = anchor.closest('router, [data-router]');   // doc:C-ROUTER — the element, or the old marker
			const href = anchor.getAttribute('href');
			if (!href || /^(https?:|\/\/|mailto:|tel:)/.test(href)) return;
			if (!inRouter) {
				let known = false;
				for (const [, table] of _RT.tables) for (const entry of table) if (Router.match(entry.compiled, Router.parse(href).path)) { known = true; break; }
				if (!known) return;
			}
			e.preventDefault();
			Router.push(href, false);
		}, false);
		if (typeof window !== 'undefined') {
			/* doc:C-ROUTER — ONE EVENT PER MODE. A hash change fires popstate AND hashchange, so
			 * hash mode committed every navigation twice (measured: two renders, two @navigate).
			 * popstate is push mode's; hashchange is hash mode's. */
			window.addEventListener('popstate', () => { if (_RT.config.history !== 'hash') Router._navigate(location.pathname + location.search + location.hash, true); });
			window.addEventListener('hashchange', () => { if (_RT.config.history === 'hash') Router._navigate((location.hash && location.hash.slice(1)) || '/', true); });
		}
	}
}
void Instance.define(Router); // <router> joins the vocabulary index
/* ── registration. PLATFORM is NOT self-contained (owner ruling): it extends
 * Instance and defines Instance elements, so a missing broker is an error, not a
 * deployment. Same shape as the DSL and transitions. The Router class IS the API —
 * every _router().x call site resolves to a static on it. */
;(function () {
	const __IVC = globalThis[Symbol.for('Instance')];
	if (typeof __IVC !== 'function' || typeof __IVC.provide !== 'function') throw new Error(
		'Instance PLATFORM: no IVC broker \u2014 the platform vocabulary extends Instance and cannot run standalone. Load core first.');
	__IVC.provide({ module: 'platform', value: { Router, applyIntl: _applyIntl },
		from: '0.89.c', to: '0.92.z' });
})();
// NOT frozen (the old singleton was): the first mint rebases Router onto its
// Meta via setPrototypeOf — a frozen class would make <router> unconstructible.


/* ── TRANSITIONS (Pass L) — 0.73 port: Web Animations with a deterministic CSS
 * fallback (no el.animate → apply final frame; also the jsdom path). Resolution:
 * object config · '::name' → class static shadow.transitions · name → class static
 * transitions → BUILT_INS. Dedupe per el×fullKey via ACTIVE_TR. Meta start/end
 * fire the '@transition' lifecycle fan (':name' is reserved by the Pass-D
 * reflection sugar — collision found in battery; 0.73's handler-map face replaced). */


/* ═══ §13 THE BUILT-IN ELEMENT VOCABULARY (Pass P) — every semantic tag is an
 * Instance class. This region REPLACES the initXElement function family and its
 * SEMANTIC_HANDLERS dispatch table: construction is registration (void
 * Instance.define(Klass) indexes the tag), the boot ring below upgrades what the
 * parser already produced, and lifecycle rides the real hooks — ['@mount'] runs
 * the old init body exactly once (LC_MOUNTED), ['@unmount'] is the teardown that
 * the old code leaked outside one hardcoded observer branch, and live elements
 * honor detach semantics (['@removal'] pauses, ['@insertion'] resumes) instead
 * of dying on raw removal. `new Async()` etc. work programmatically like any
 * other Instance class; declarative upgrading of USER classes is ⚡⚡ super mode,
 * while THIS vocabulary (CORE_TAGS) boots unconditionally — pages that use
 * <router> or <intl> today keep working with no flag. */

/* — helpers shared by the vocabulary (hoisted machinery) — */
function _applyIntl(el) {
	const key = el.getAttribute && el.getAttribute('key');
	if (!key || !_I18N) return;
	const val = _I18N[key];
	if (val != null) el.textContent = val;
}
/* swap an element's text for a generated <a> — the email/tel/website decorator core */
function _inlineLink(el, hrefFn, rel) {
	const text = (el.textContent || '').trim();
	if (!text) return;
	const a = document.createElement('a');
	a.href = hrefFn(text);
	if (rel) a.rel = rel;
	a.textContent = text;
	el.textContent = ''; el.appendChild(a);
}
/* button semantics for non-button tags: role, focusability, Enter/Space → click */
function _activatable(el, onFire) {
	el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
	el.addEventListener('click', onFire);
	el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
}

/* — decorators: one-shot @mount work, no teardown state — */
class Static extends Instance {
	['@mount']() { this.setAttribute('data-static', ''); }
}
class Email extends Instance {
	['@mount']() { _inlineLink(this, t => 'mailto:' + t, null); }
}
class Tel extends Instance {
	['@mount']() { _inlineLink(this, t => 'tel:' + t.replace(/\s/g, ''), null); }
}
class Website extends Instance {
	['@mount']() { _inlineLink(this, t => t.startsWith('http') ? t : 'https://' + t, 'external noopener noreferrer'); }
}
class Mailto extends Instance {
	['@mount']() {
		const to = this.getAttribute('to') || '', subject = this.getAttribute('subject') || '', body = this.getAttribute('body') || '';
		const params = new URLSearchParams();
		if (subject) params.set('subject', subject);
		if (body) params.set('body', body);
		const query = params.toString();
		const a = document.createElement('a');
		a.href = 'mailto:' + to + (query ? '?' + query : '');
		a.innerHTML = this.innerHTML || to;
		this.innerHTML = ''; this.appendChild(a);
	}
}
class Logout extends Instance {
	['@mount']() {
		this.style.cursor = 'pointer';
		_activatable(this, () => {
			const endpoint = this.getAttribute('href') || this.getAttribute('action') || '/api/logout';
			const redirect = this.getAttribute('redirect') || '/';
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			Promise.resolve(F ? F(endpoint, { method: 'POST' }) : null).then(() => { try { Router.navigate(redirect); } catch (e) { location.href = redirect; } });
		});
	}
}
class Reset extends Instance {
	['@mount']() { _activatable(this, () => { const form = this.closest('form'); if (form) form.reset(); }); }
}
class Portal extends Instance {
	['@mount']() {
		const target = document.querySelector(this.getAttribute('target') || 'body');
		if (!target) return;
		const frag = document.createDocumentFragment();
		[...this.childNodes].forEach(n => frag.appendChild(n));
		target.appendChild(frag);
		this._portalTarget = target;
	}
}
/* <intl key=…> — class named IntlElement (bare `Intl` would shadow ECMA-402
 * inside this scope); static id claims the tag. Instance.i18n() re-applies
 * translations across every <intl>, upgrading any the boot ring hasn't met. */
class IntlElement extends Instance {
	static id = 'intl';
	['@mount']() { _applyIntl(this); }
}

/* — live elements: real teardown via ['@unmount'], detach-honest pause/resume — */

/* <async src=…> — one-shot remote include. inert until settled; JSON payloads
 * fan '@async' on the parent and leave the element; HTML/text replaces it.
 * src is live (attribute observer refetches); .reload() forces. Teardown is
 * ['@unmount'] — under the old init this observer leaked unless the removal
 * happened to cross the semantic-boot observer's hardcoded branch. */
class Async extends Instance {
	#obs = null;
	['@mount']() {
		this.setAttribute('inert', '');
		const src = this.getAttribute('src');
		if (src) this.#fetch(src);
		this.#obs = new MutationObserver(ms => { ms.forEach(m => { if (m.attributeName === 'src') { const ns = this.getAttribute('src'); if (ns) this.#fetch(ns); } }); });
		this.#obs.observe(this, { attributes: true, attributeFilter: ['src'] });
	}
	['@unmount']() { if (this.#obs) { this.#obs.disconnect(); this.#obs = null; } }
	reload() { const u = this.getAttribute('src'); if (u) this.#fetch(u); return this; }
	async #fetch(url) {
		try {
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			const response = await F(url);
			const contentType = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
			let nodes = [];
			if (contentType.includes('application/json')) {
				const data = await response.json();
				const parent = this.parentElement;
				if (parent) _nsFire(parent, '@async', { src: url, data, el: this, type: 'json' });
				this.setAttribute('data-loaded', ''); this.removeAttribute('inert');
				return;
			}
			if (contentType.startsWith('text/')) {
				const html = await response.text();
				const template = document.createElement('template');
				template.innerHTML = html;
				nodes = [...template.content.childNodes];
			}
			this.setAttribute('data-loaded', ''); this.removeAttribute('inert');
			const parent = this.parentElement;
			if (nodes.length) this.replaceWith(...nodes); else this.replaceWith();
			if (parent) _nsFire(parent, '@async', { src: url, nodes, el: this, type: 'html' });
		} catch (err) {
			this.setAttribute('data-error', ''); this.removeAttribute('inert');
			const errChild = this.querySelector(':scope > error');
			if (errChild) errChild.style.display = '';
			else console.warn('[Instance] <async> fetch failed: ' + err.message + ' (' + url + ')');
			const parent = this.parentElement;
			if (parent) _nsFire(parent, '@async', { src: url, error: err, el: this, type: 'error' });
		}
	}
}

/* <sync src=… interval=…> — polling remote include. DETACH-HONEST: raw removal
 * used to KILL it via the hardcoded observer branch; now ['@removal'] merely
 * pauses the timer and ['@insertion'] resumes it (remove ≠ destroy), while
 * ['@unmount'] — dispose(), the only real teardown — stops it for good. This
 * closes the old leak the other way around too: a <sync> torn down through
 * dispose() previously kept polling forever. */
class Sync extends Instance {
	#timer = null; #last = '';
	['@mount']() { this.#start(); }
	['@insertion']() { if (LC_MOUNTED.has(this)) this.#start(); } // resume on re-entry (mount handles the first)
	['@removal']() { this.#stop(); } // pause — raw removal is detach, not death
	['@unmount']() { this.#stop(); }
	stop()  { this.#stop(); return this; }
	start() { this.#start(); return this; }
	#stop() { if (this.#timer) { clearInterval(this.#timer); this.#timer = null; } }
	#start() {
		if (this.#timer) return;
		const interval = parseInt(this.getAttribute('interval') || '5000', 10);
		this.#poll();
		this.#timer = setInterval(() => this.#poll(), interval);
	}
	async #poll() {
		const src = this.getAttribute('src');
		if (!src) return;
		this.setAttribute('data-syncing', '');
		try {
			const F = typeof fetch === 'function' ? fetch : globalThis.fetch;
			const r = await F(src, { cache: 'no-store' });
			const text = await r.text();
			if (text !== this.#last) {
				this.#last = text;
				this.innerHTML = text;
				this.removeAttribute('data-error');
				const parent = this.parentElement;
				if (parent) _nsFire(parent, '@async', { src, el: this, type: 'sync' });
			}
		} catch (e) { this.setAttribute('data-error', ''); }
		this.removeAttribute('data-syncing');
	}
}

/* <route path=… src=…> — declarative table row; data carried by attributes,
 * read by the parent <router>. */
class Route extends Instance {}
/* <outlet name?> — a commit target; the data-outlet mirror keeps the pre-Pass-P
 * selector contract for anything querying [data-outlet]. */
class Outlet extends Instance {
	['@mount']() { this.setAttribute('data-outlet', this.getAttribute('name') || ''); }
}

void Instance.define(Static); void Instance.define(Email); void Instance.define(Tel);
void Instance.define(Website); void Instance.define(Mailto); void Instance.define(Logout);
void Instance.define(Reset); void Instance.define(Portal); void Instance.define(IntlElement);
void Instance.define(Async); void Instance.define(Sync); void Instance.define(Route); void Instance.define(Outlet);



})();

/* ── ui/tabs.is ── */

/* Instance-UI · Tabs
 * The platform has no tabs, so this is a class: one element, its own tag, ARIA as the APG writes it (tablist, tab,
 * tabpanel, a roving tabindex, arrows and Home/End), one field of state. Write it as markup —
 *
 *   <tabs>
 *     <nav><button>Account</button><button>Password</button></nav>
 *     <section>…account…</section>
 *     <section>…password…</section>
 *   </tabs>
 *
 * — or as a call: tabs(nav(button('Account'), button('Password')), section(…), section(…)). The first child is the
 * list of tabs, every later child a panel, in order. `active` is the selected index; set it and the tabs follow. */
class Tabs extends Instance {
    static get css() { return [super.css, `
		display: block;
		> nav { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--ui-radius); background: var(--ui-muted);
			> button { height: 30px; padding: 0 12px; border: 0; border-radius: calc(var(--ui-radius) - 2px); background: transparent;
				color: var(--ui-muted-foreground); font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
				&[aria-selected=true] { background: var(--ui-background); color: var(--ui-foreground); box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
				&:focus-visible { outline: 2px solid var(--ui-ring); outline-offset: 1px; } } }
		> section { padding: 16px 0; font-size: 14px; &[hidden] { display: none; } }
	`]; }
    ['@mount']() {
		this.querySelector(':scope > nav')?.setAttribute('role', 'tablist');
		this.tabs.forEach((tab, i) => { tab.setAttribute('role', 'tab'); tab.type = 'button'; tab.id ||= `${this.id || 'tabs'}-tab-${i}`; });
		this.panels.forEach((panel, i) => { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', this.tabs[i]?.id ?? ''); });
	}
    get tabs() { return [...this.querySelectorAll(':scope > nav > button')]; }
    get panels() { return [...this.children].slice(1); }
    show() {
		const n = this.active;
		this.tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === n)); tab.tabIndex = i === n ? 0 : -1; });
		this.panels.forEach((panel, i) => { panel.hidden = i !== n; });
	}
    ['@click > nav > button'](e, tab) { this.active = this.tabs.indexOf(tab); }
    ['@keydown > nav > button'](e, tab) {
		const tabs = this.tabs, i = tabs.indexOf(tab), last = tabs.length - 1;
		const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
		if (next === undefined) return;
		e.preventDefault();
		this.active = next;
		tabs[next].focus();
	}

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øTabs() {
            this.active = 0;
        });
    }
    static { ø.level(this); }

    static {
        this[Symbol.new](function* øTabs_Static() {
            ø.roles(this.prototype, {show:'effect'});
        });
    }
}
Instance.define(Tabs);                                            // the tag, for markup that is already on the page…
for (const el of document.querySelectorAll('tabs')) Instance.upgrade(el);   // …which was parsed before this file ran

/* the page may already be parsed when this runs (the compiler's capture runs a page's scripts once it is): what the
 * runtime's boot ring passed over before the classes existed is upgraded here, once, router and outlet first */
(function () {
	const sweep = () => { for (const tag of ["router","outlet","route","portal","email","tel","website","mailto","logout","reset","intl","async","sync","static","tabs"]) document.querySelectorAll(tag).forEach(el => Instance.upgrade(el)); };
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep, { once: true }); else sweep();
})();
