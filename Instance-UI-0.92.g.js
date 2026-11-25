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

/* ── ui/calendar.is ── */

/* Instance-UI · Calendar
 * A month to pick a day from: the APG grid — a table with the weekdays as headers, every day a button, one in the tab
 * order, arrows to move by day and week, PageUp and PageDown by month, Home and End to the week's ends. Dates are ISO
 * strings, so `value` is yours to read and set: `cal.value = '2026-11-25'`; a 'change' event fires on a pick. `min` and
 * `max` on the tag bound it; `locale` names the language of the labels (the page's by default).
 *
 *   <calendar value="2026-11-25" min="2026-01-01"></calendar>
 *
 * For a date field, the platform has one: <input type="date">, styled by native.css. This is the grid on the page. */
class Calendar extends Instance {
    static get css() { return [super.css, `
		display: inline-block; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-card);
		> header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
			> h3 { margin: 0; font-size: 14px; font-weight: 500; } > button { width: 28px; height: 28px; padding: 0; } }
		> table { border-collapse: collapse; > thead th { width: 36px; height: 28px; font-size: 12px; font-weight: 400; color: var(--ui-muted-foreground); padding: 0; }
			> tbody td { padding: 1px; border: 0;
				> button { width: 34px; height: 34px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 14px; cursor: pointer;
					&:hover { background: var(--ui-accent); } &[aria-selected=true] { background: var(--ui-primary); color: var(--ui-primary-foreground); }
					&[data-today] { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
					&[data-outside] { color: var(--ui-muted-foreground); opacity: .5; } &:disabled { opacity: .3; cursor: default; }
					&:focus-visible { outline: 2px solid var(--ui-ring); outline-offset: -2px; } } } }
	`]; }
    ['@mount']() {
		if (this.querySelector(':scope > table')) return;
		if (this.hasAttribute('value')) this.value = this.getAttribute('value');
		this.month = (this.value || Calendar.iso(new Date())).slice(0, 7);
		this.setAttribute('role', 'group'); this.setAttribute('aria-label', 'Calendar');
		this.add(header(button('.outline.prev', '‹').set('aria-label', 'Previous month'), h3().set('aria-live', 'polite'), button('.outline.next', '›').set('aria-label', 'Next month')),
			table(thead(tr()), tbody()).set('role', 'grid'));
		this.show();
	}
    static iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    static date(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d || 1); }
    get locale() { return this.getAttribute('locale') || document.documentElement.lang || undefined; }
    inRange(iso) { const min = this.getAttribute('min'), max = this.getAttribute('max'); return (!min || iso >= min) && (!max || iso <= max); }
    show() {
		const month = this.month, value = this.value;   // read first: the effect follows what it read, even when it returns early
		const table = this.querySelector(':scope > table'); if (!table || !month) return;
		const first = Calendar.date(this.month + '-01'), locale = this.locale, today = Calendar.iso(new Date());
		this.querySelector(':scope > header > h3').textContent = first.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
		const head = table.tHead.rows[0]; head.replaceChildren();
		const monday = new Date(2024, 0, 1);                                   // a Monday, for the weekday names
		for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); head.append(th().setText(d.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2)).set('scope', 'col').set('aria-label', d.toLocaleDateString(locale, { weekday: 'long' }))); }
		const body = table.tBodies[0]; body.replaceChildren();
		const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));   // back to Monday
		const focusIso = this.value && this.value.slice(0, 7) === this.month ? this.value : (today.slice(0, 7) === this.month ? today : this.month + '-01');
		for (let w = 0; w < 6; w++) {
			const row = tr();
			for (let i = 0; i < 7; i++) {
				const d = new Date(start); d.setDate(start.getDate() + w * 7 + i); const iso = Calendar.iso(d);
				const cell = button().setText(String(d.getDate())).set('data-iso', iso).set('aria-label', d.toLocaleDateString(locale, { dateStyle: 'long' }));
				if (iso.slice(0, 7) !== this.month) cell.set('data-outside', ''); if (iso === today) cell.set('data-today', '');
				cell.setAttribute('aria-selected', String(iso === this.value)); cell.tabIndex = iso === focusIso ? 0 : -1;
				if (!this.inRange(iso)) cell.disabled = true;
				row.add(td(cell).set('role', 'gridcell'));
			}
			body.append(row);
			if (new Date(start.getFullYear(), start.getMonth(), start.getDate() + (w + 1) * 7) > new Date(first.getFullYear(), first.getMonth() + 1, 0)) break;
		}
	}
    shift(months) { const d = Calendar.date(this.month + '-01'); d.setMonth(d.getMonth() + months); this.month = Calendar.iso(d).slice(0, 7); }
    ['@click > header > .prev']() { this.shift(-1); }
    ['@click > header > .next']() { this.shift(1); }
    ['@click > table button'](e, cell) { if (cell.disabled) return; this.value = cell.dataset.iso; this.month = this.value.slice(0, 7); this.dispatchEvent(new Event('change', { bubbles: true })); }
    ['@keydown > table button'](e, cell) {
		const d = Calendar.date(cell.dataset.iso), by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
		if (by !== undefined) d.setDate(d.getDate() + by);
		else if (e.key === 'PageUp') d.setMonth(d.getMonth() - 1); else if (e.key === 'PageDown') d.setMonth(d.getMonth() + 1);
		else if (e.key === 'Home') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); else if (e.key === 'End') d.setDate(d.getDate() + (6 - (d.getDay() + 6) % 7));
		else return;
		e.preventDefault();
		const iso = Calendar.iso(d); if (iso.slice(0, 7) !== this.month) this.month = iso.slice(0, 7);
		const target = this.querySelector(`button[data-iso="${iso}"]`); if (target) { this.querySelectorAll(':scope > table button').forEach(b => b.tabIndex = -1); target.tabIndex = 0; target.focus(); }
	}

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øCalendar() {
            this.value = '';
            this.month = '';
        });
    }
    static { ø.level(this); }

    static {
        this[Symbol.new](function* øCalendar_Static() {
            ø.roles(this.prototype, {show:'effect'});
        });
    }
}
Instance.define(Calendar);

/* ── ui/carousel.is ── */

/* Instance-UI · Carousel
 * Slides that snap, with a previous and a next. The scrolling is the browser's (scroll-snap); the class adds the two
 * buttons, the index, the keyboard. Write the slides as children:
 *
 *   <carousel><article>1</article><article>2</article><article>3</article></carousel>
 *
 * `index` is the slide in view; set it and the track scrolls. `loop` on the tag wraps the ends. */
class Carousel extends Instance {
    static get css() { return [super.css, `
		display: block; position: relative;
		> .track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth; scrollbar-width: none; gap: 16px;
			> * { flex: 0 0 100%; scroll-snap-align: start; } }
		> button { position: absolute; top: 50%; translate: 0 -50%; width: 32px; height: 32px; padding: 0; border-radius: 50%; font-size: 16px;
			&.prev { left: -44px; } &.next { right: -44px; } }
		> .dots { display: flex; justify-content: center; gap: 6px; margin-top: 10px;
			> button { width: 8px; height: 8px; padding: 0; border: 0; border-radius: 50%; background: var(--ui-border); &[aria-current] { background: var(--ui-foreground); } } }
	`]; }
    ['@mount']() {
		if (this.querySelector(':scope > .track')) return;
		const track = div('.track'); track.append(...this.children); track.setAttribute('aria-live', 'polite');
		this.setAttribute('role', 'region'); this.setAttribute('aria-roledescription', 'carousel'); this.tabIndex = 0;
		this.add(track, button('.prev.outline', '‹').set('aria-label', 'Previous slide'), button('.next.outline', '›').set('aria-label', 'Next slide'),
			div('.dots', [...track.children].map((_, i) => button().set('aria-label', `Slide ${i + 1}`))));
		this.show();                                       // the effect ran at new, before the track existed
	}
    get track() { return this.querySelector(':scope > .track'); }
    get count() { return this.track ? this.track.children.length : 0; }
    show() {
		const n = this.index, track = this.track; if (!track) return;
		const slide = track.children[n]; if (slide && Math.abs(track.scrollLeft - slide.offsetLeft) > 1) track.scrollTo({ left: slide.offsetLeft });
		[...track.children].forEach((s, i) => { s.setAttribute('aria-roledescription', 'slide'); s.setAttribute('aria-label', `${i + 1} of ${this.count}`); });
		this.querySelectorAll(':scope > .dots > button').forEach((d, i) => { if (i === n) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
		const loop = this.hasAttribute('loop');
		this.querySelector(':scope > .prev').disabled = !loop && n === 0;
		this.querySelector(':scope > .next').disabled = !loop && n === this.count - 1;
	}
    step(d) { const c = this.count; if (!c) return; let i = this.index + d; if (this.hasAttribute('loop')) i = (i + c) % c; this.index = Math.max(0, Math.min(c - 1, i)); }
    ['@click > .prev']() { this.step(-1); }
    ['@click > .next']() { this.step(1); }
    ['@click > .dots > button'](e, dot) { this.index = [...dot.parentNode.children].indexOf(dot); }
    ['@keydown'](e) { if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); } }
    ['@scrollend > .track'](e, track) { const w = track.children[0]?.offsetWidth || 1; const i = Math.round(track.scrollLeft / (w + 16)); if (i !== this.index) this.index = i; }

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øCarousel() {
            this.index = 0;
        });
    }
    static { ø.level(this); }

    static {
        this[Symbol.new](function* øCarousel_Static() {
            ø.roles(this.prototype, {show:'effect'});
        });
    }
}
Instance.define(Carousel);

/* ── ui/combobox.is ── */

/* Instance-UI · Combobox
 * An input with a list that filters as you type: the APG combobox — role=combobox on the input, a listbox of options,
 * aria-activedescendant for the one under the arrow keys, Enter to take it, Escape to close. The list is a popover,
 * anchored to the input. Write the options as children:
 *
 *   <combobox placeholder="Select framework…">
 *     <option value="next">Next.js</option><option>SvelteKit</option><option>Nuxt</option>
 *   </combobox>
 *
 * `value` is the chosen option's value (its text when it has none); set it and the input follows. A 'change' event fires
 * when a choice is made. `query` is what has been typed; `open` whether the list shows. */
class Combobox extends Instance {
    #ǁoptionsǁ = Symbol();
    get #options() { const v = ø.cell(this, this.#ǁoptionsǁ).get(); return v === Symbol.for('??') ? undefined : v; }
    set #options(v) { ø.cell(this, this.#ǁoptionsǁ).set(v); }
    static get css() { return [super.css, `
		display: block; position: relative;
		> input { anchor-name: --ui-combobox; padding-right: 32px; }
		> .caret { position: absolute; right: 10px; top: 50%; translate: 0 -50%; pointer-events: none; color: var(--ui-muted-foreground); font-size: 12px; }
		> [role=listbox] { position-anchor: --ui-combobox; top: anchor(bottom); left: anchor(left); width: anchor-size(width); margin-top: 4px;
			max-height: 16rem; overflow-y: auto; padding: 4px; list-style: none;
			> li { padding: 6px 8px; border-radius: 4px; font-size: 14px; cursor: pointer; display: flex; justify-content: space-between;
				&[aria-selected=true] { background: var(--ui-accent); } &[data-chosen]::after { content: '✓'; color: var(--ui-muted-foreground); } }
			> .empty { padding: 8px; font-size: 14px; color: var(--ui-muted-foreground); } }
	`]; }
    ['@mount']() {
		if (this.querySelector(':scope > input')) return;
		this.#options = [...this.querySelectorAll(':scope > option')].map(o => ({ value: o.hasAttribute('value') ? o.getAttribute('value') : o.textContent.trim(), label: o.textContent.trim() }));
		this.replaceChildren();
		const id = this.id || `combobox-${Math.random().toString(36).slice(2, 8)}`;
		const field = input().set('role', 'combobox').set('aria-autocomplete', 'list').set('aria-expanded', 'false').set('aria-controls', id + '-list').set('autocomplete', 'off');
		if (this.hasAttribute('placeholder')) field.placeholder = this.getAttribute('placeholder');
		const list = ul().set('role', 'listbox').set('id', id + '-list').set('popover', 'manual');
		this.add(field, span('.caret', '▾'), list);
		if (this.hasAttribute('value')) this.value = this.getAttribute('value');
		this.show();
	}
    get field() { return this.querySelector(':scope > input'); }
    get list() { return this.querySelector(':scope > [role=listbox]'); }
    get matches() { const q = this.query.trim().toLowerCase(); return q ? this.#options.filter(o => o.label.toLowerCase().includes(q)) : this.#options; }
    show() {
		const open = this.open, value = this.value, cursor0 = this.cursor, query = this.query;   // read first: the effect follows what it read, even when it returns early
		const field = this.field, list = this.list; if (!field || !list) return;
		const chosen = this.#options.find(o => o.value === value);
		if (!open && document.activeElement !== field) field.value = chosen ? chosen.label : '';
		field.setAttribute('aria-expanded', String(open));
		const m = this.matches, cur = Math.min(cursor0, m.length - 1);
		list.replaceChildren(...(m.length ? m.map((o, i) => { const el = li().setText(o.label).set('role', 'option').set('id', `${list.id}-${i}`).set('aria-selected', String(i === cur)); if (o.value === this.value) el.set('data-chosen', ''); return el; }) : [li('.empty', 'No results.')]));
		if (cur >= 0) field.setAttribute('aria-activedescendant', `${list.id}-${cur}`); else field.removeAttribute('aria-activedescendant');
		try { if (open) { if (!list.matches(':popover-open')) list.showPopover(); list.children[cur]?.scrollIntoView({ block: 'nearest' }); } else if (list.matches(':popover-open')) list.hidePopover(); } catch (e) {}
	}
    choose(o) { this.value = o.value; this.query = ''; this.open = false; this.cursor = -1; this.field.value = o.label; this.dispatchEvent(new Event('change', { bubbles: true })); }
    ['@input > input'](e, field) { this.query = field.value; this.open = true; this.cursor = 0; }
    ['@focus > input']() { this.open = true; }
    ['@click > input']() { this.open = true; }
    ['@focusout'](e) { if (!this.contains(e.relatedTarget)) { this.open = false; this.query = ''; } }
    ['@pointerdown > [role=listbox] > li'](e, item) { e.preventDefault(); const o = this.matches[[...item.parentNode.children].indexOf(item)]; if (o) this.choose(o); }
    ['@keydown > input'](e) {
		const m = this.matches;
		switch (e.key) {
			case 'ArrowDown': e.preventDefault(); this.open = true; this.cursor = m.length ? (this.cursor + 1) % m.length : -1; break;
			case 'ArrowUp': e.preventDefault(); this.open = true; this.cursor = m.length ? (this.cursor - 1 + m.length) % m.length : -1; break;
			case 'Enter': if (this.open && m[this.cursor]) { e.preventDefault(); this.choose(m[this.cursor]); } break;
			case 'Escape': if (this.open) { e.preventDefault(); this.open = false; this.query = ''; } break;
		}
	}

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øCombobox() {
            this.value = '';
            this.query = '';
            this.open = false;
            this.cursor = -1;
            this.#options = [];
        });
    }
    static { ø.level(this); }

    static {
        this[Symbol.new](function* øCombobox_Static() {
            ø.roles(this.prototype, {show:'effect'});
        });
    }
}
Instance.define(Combobox);

/* ── ui/command.is ── */

/* Instance-UI · Command
 * The command palette: a dialog with a search field over groups of commands, filtered as you type, arrows and Enter to
 * run one, Escape to close, ⌘K (or Ctrl+K) to open from anywhere when the tag says `hotkey`. Write the commands as
 * markup — a group is a <section> with a heading, a command is a <button> inside it:
 *
 *   <command hotkey placeholder="Type a command or search…">
 *     <section><h4>Suggestions</h4><button>Calendar</button><button>Search emoji</button></section>
 *     <section><h4>Settings</h4><button>Profile <kbd>⌘P</kbd></button></section>
 *   </command>
 *
 * A command's click is yours to hear (`el.on('click', …)` on the button, or a delegated ['@click button'] on a parent);
 * running one closes the palette. `Command.open()` and `.close()` from code; `query` is what has been typed. */
class Command extends Instance {
    static get css() { return [super.css, `
		display: contents;
		> dialog { padding: 0; width: min(36rem, calc(100% - 32px)); overflow: hidden;
			> input { border: 0; border-bottom: 1px solid var(--ui-border); border-radius: 0; height: 44px; padding: 0 16px; &:focus-visible { outline: 0; } }
			> .list { max-height: 20rem; overflow-y: auto; padding: 6px;
				> section { > h4 { margin: 6px 8px; font-size: 12px; font-weight: 500; color: var(--ui-muted-foreground); }
					> button { display: flex; width: 100%; justify-content: space-between; height: 36px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 14px; text-align: left; cursor: pointer;
						&[aria-selected=true] { background: var(--ui-accent); } &[hidden] { display: none; } & kbd { margin-left: auto; } }
					&:has(> button:not([hidden])) + section:has(> button:not([hidden])) { border-top: 1px solid var(--ui-border); margin-top: 4px; padding-top: 4px; }
					&:not(:has(> button:not([hidden]))) { display: none; } }
				> .empty { padding: 24px; text-align: center; font-size: 14px; color: var(--ui-muted-foreground); } } }
	`]; }
    ['@mount']() {
		if (this.querySelector(':scope > dialog')) return;
		const list = div('.list'); list.append(...this.children); list.setAttribute('role', 'listbox');
		const field = input().set('role', 'combobox').set('aria-expanded', 'true').set('aria-autocomplete', 'list').set('autocomplete', 'off');
		field.placeholder = this.getAttribute('placeholder') || 'Type a command or search…';
		list.add(p('.empty', 'No results found.'));
		this.add(dialog(field, list).set('aria-label', 'Command palette'));
		if (this.hasAttribute('hotkey')) document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.open(); } });
		this.show();
	}
    get dialog() { return this.querySelector(':scope > dialog'); }
    get commands() { return [...this.querySelectorAll(':scope > dialog > .list > section > button')]; }
    get shown() { return this.commands.filter(b => !b.hidden); }
    open() { const d = this.dialog; if (d && !d.open) { this.query = ''; this.cursor = 0; d.querySelector('input').value = ''; d.showModal(); } }
    close() { const d = this.dialog; if (d && d.open) d.close(); }
    show() {
		const q = this.query.trim().toLowerCase(), cursor = this.cursor;   // read first: the effect follows what it read, even when it returns early
		const d = this.dialog; if (!d) return;
		for (const b of this.commands) b.hidden = q !== '' && !b.textContent.toLowerCase().includes(q);
		const shown = this.shown, cur = Math.min(cursor, shown.length - 1);
		shown.forEach((b, i) => { b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === cur)); });
		d.querySelector('.empty').hidden = shown.length > 0;
		shown[cur]?.scrollIntoView({ block: 'nearest' });
	}
    ['@input > dialog > input'](e, field) { this.query = field.value; this.cursor = 0; }
    ['@click > dialog > .list button']() { this.close(); }
    ['@click > dialog'](e, d) { if (e.target === d) this.close(); }
    ['@keydown > dialog'](e) {
		const shown = this.shown;
		if (e.key === 'ArrowDown') { e.preventDefault(); this.cursor = shown.length ? (this.cursor + 1) % shown.length : 0; }
		else if (e.key === 'ArrowUp') { e.preventDefault(); this.cursor = shown.length ? (this.cursor - 1 + shown.length) % shown.length : 0; }
		else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); shown[Math.min(this.cursor, shown.length - 1)]?.click(); }
	}

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øCommand() {
            this.query = '';
            this.cursor = 0;
        });
    }
    static { ø.level(this); }

    static {
        this[Symbol.new](function* øCommand_Static() {
            ø.roles(this.prototype, {show:'effect'});
        });
    }
}
Instance.define(Command);

/* ── ui/datatable.is ── */

/* Instance-UI · DataTable
 * A table over rows you hand it: sort by a column (click its header; aria-sort says which), filter on one key, select
 * rows, page through them. The table is the platform's <table>, styled by native.css; the class is the state around
 * it. Write the columns as the header, hand the rows from code:
 *
 *   <datatable filter="email" page-size="5" selectable>
 *     <table><thead><tr><th data-key="status">Status</th><th data-key="email">Email</th><th data-key="amount" data-type="number">Amount</th></tr></thead></table>
 *   </datatable>
 *   dt.rows = [{ status: 'success', email: 'ken99@example.com', amount: 316 }, …];
 *
 * `rows`, `sort` ({ key, dir }), `query`, `page`, `selected` (the selected rows) are fields: set any, the table follows.
 * A column's data-type: 'number' sorts numerically and aligns right; a `data-format` names a method of yours on the
 * element that renders the cell (`format(value, row)`), text otherwise, never markup. */
class DataTable extends Instance {
    static get css() { return [super.css, `
		display: block;
		> .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; > input { max-width: 20rem; } }
		> .frame { border: 1px solid var(--ui-border); border-radius: var(--ui-radius); overflow: hidden; }
		th[data-key] { cursor: pointer; user-select: none; &:hover { color: var(--ui-foreground); } &[aria-sort]::after { content: ' ↑'; } &[aria-sort=descending]::after { content: ' ↓'; } }
		td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
		tr[aria-selected=true] { background: var(--ui-muted); }
		td.empty { text-align: center; color: var(--ui-muted-foreground); padding: 24px; }
		> footer { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; font-size: 13px; color: var(--ui-muted-foreground); > span > button { margin-left: 8px; } }
	`]; }
    ['@mount']() {
		if (this.querySelector(':scope > .frame')) return;
		const table = this.querySelector(':scope > table'); if (!table) return;
		const head = table.tHead?.rows[0]; if (!head) return;
		if (this.hasAttribute('selectable')) head.prepend(th(input().set('type', 'checkbox').set('aria-label', 'Select all')).set('class', 'sel'));
		for (const h of head.querySelectorAll('th[data-key]')) { h.tabIndex = 0; h.setAttribute('scope', 'col'); if (h.dataset.type === 'number') h.classList.add('num'); }
		if (!table.tBodies.length) table.append(tbody());
		const frame = div('.frame'); frame.append(table);
		if (this.hasAttribute('filter')) this.add(div('.bar', input().set('placeholder', `Filter ${this.getAttribute('filter')}…`).set('aria-label', `Filter by ${this.getAttribute('filter')}`)));
		this.add(frame, footer(span('.count'), span('.pages', button('.outline.sm.prev', 'Previous'), button('.outline.sm.next', 'Next'))));
		this.show();
	}
    get columns() { return [...this.querySelectorAll(':scope > .frame th[data-key]')].map(h => ({ key: h.dataset.key, type: h.dataset.type, format: h.dataset.format, th: h })); }
    get view() {
		let rows = this.rows.slice();
		const f = this.getAttribute('filter'), q = this.query.trim().toLowerCase();
		if (f && q) rows = rows.filter(r => String(r[f] ?? '').toLowerCase().includes(q));
		const s = this.sort;
		if (s) { const num = this.columns.find(c => c.key === s.key)?.type === 'number'; rows.sort((a, b) => { const x = a[s.key], y = b[s.key]; const c = num ? (Number(x) - Number(y)) : String(x ?? '').localeCompare(String(y ?? '')); return s.dir === 'desc' ? -c : c; }); }
		return rows;
	}
    get pageSize() { return Number(this.getAttribute('page-size')) || Infinity; }
    show() {
		const rows = this.rows, sort = this.sort, query = this.query, page0 = this.page, selected = this.selected;   // read first: the effect follows what it read, even when it returns early
		const table = this.querySelector(':scope > .frame > table'); if (!table) return;
		const cols = this.columns, view = this.view, size = this.pageSize, pages = Math.max(1, Math.ceil(view.length / size)), page = Math.min(page0, pages - 1);
		const shown = view.slice(page * size, page * size + size), selectable = this.hasAttribute('selectable');
		for (const c of cols) { if (this.sort && this.sort.key === c.key) c.th.setAttribute('aria-sort', this.sort.dir === 'desc' ? 'descending' : 'ascending'); else c.th.removeAttribute('aria-sort'); }
		const body = table.tBodies[0]; body.replaceChildren();
		if (!shown.length) body.append(tr(td('.empty', 'No results.').set('colspan', String(cols.length + (selectable ? 1 : 0)))));
		for (const row of shown) {
			const r = tr(); const on = this.selected.includes(row);
			if (selectable) { r.setAttribute('aria-selected', String(on)); r.add(td(input().set('type', 'checkbox').set('aria-label', 'Select row')).set('class', 'sel')); r.querySelector('input').checked = on; }
			for (const c of cols) { const cell = td(); const v = row[c.key]; const text = c.format && typeof this[c.format] === 'function' ? this[c.format](v, row) : (v == null ? '' : String(v)); cell.setText(text); if (c.type === 'number') cell.classList.add('num'); r.add(cell); }
			body.append(r);
		}
		const all = this.querySelector(':scope > .frame th.sel > input'); if (all) { all.checked = shown.length > 0 && shown.every(r => this.selected.includes(r)); all.indeterminate = !all.checked && shown.some(r => this.selected.includes(r)); }
		const count = this.querySelector(':scope > footer > .count'); if (count) count.textContent = selectable ? `${this.selected.length} of ${view.length} row(s) selected.` : `${view.length} row(s).`;
		const pg = this.querySelector(':scope > footer > .pages'); if (pg) { pg.querySelector('.prev').disabled = page === 0; pg.querySelector('.next').disabled = page >= pages - 1; pg.style.display = size === Infinity ? 'none' : ''; }
	}
    ['@click > .frame th[data-key]'](e, h) { const key = h.dataset.key; this.sort = this.sort && this.sort.key === key ? (this.sort.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }; }
    ['@keydown > .frame th[data-key]'](e, h) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.click(); } }
    ['@input > .bar > input'](e, field) { this.query = field.value; this.page = 0; }
    ['@change > .frame th.sel > input'](e, box) { const shown = this.view.slice(this.page * this.pageSize, this.page * this.pageSize + this.pageSize); this.selected = box.checked ? [...new Set([...this.selected, ...shown])] : this.selected.filter(r => !shown.includes(r)); }
    ['@change > .frame td.sel > input'](e, box) { const i = [...box.closest('tbody').children].indexOf(box.closest('tr')); const row = this.view.slice(this.page * this.pageSize, this.page * this.pageSize + this.pageSize)[i]; this.selected = box.checked ? [...this.selected, row] : this.selected.filter(r => r !== row); }
    ['@click > footer .prev']() { this.page = Math.max(0, this.page - 1); }
    ['@click > footer .next']() { this.page = this.page + 1; }

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øDataTable() {
            this.rows = [];
            this.sort = null;
            this.query = '';
            this.page = 0;
            this.selected = [];
        });
    }
    static { ø.level(this); }

    static {
        this[Symbol.new](function* øDataTable_Static() {
            ø.roles(this.prototype, {show:'effect'});
        });
    }
}
Instance.define(DataTable);

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

/* ── ui/toast.is ── */

/* Instance-UI · Toast
 * A message that comes and goes. One class, its own tag; the stack is an <output> in the top layer (popover=manual), so
 * it sits over dialogs too, and a screen reader hears it (an <output> is a live region). Say it from anywhere:
 *
 *   Toast.show('Saved.');
 *   Toast.show('Event created', { description: 'Sunday, 10:00', action: ['Undo', () => …], kind: 'success', duration: 6000 });
 *
 * kind: 'success' | 'error' | 'warning' | 'info' | none. duration in ms, 0 to keep it until closed. Hover pauses the
 * clock; Escape on a focused toast closes it; the × always does. `Toast.dismiss()` clears the stack. */
class Toast extends Instance {
    #ǁtimerǁ = Symbol();
    get #timer() { const v = ø.cell(this, this.#ǁtimerǁ).get(); return v === Symbol.for('??') ? undefined : v; }
    set #timer(v) { ø.cell(this, this.#ǁtimerǁ).set(v); }
    #ǁleftǁ = Symbol();
    get #left() { const v = ø.cell(this, this.#ǁleftǁ).get(); return v === Symbol.for('??') ? undefined : v; }
    set #left(v) { ø.cell(this, this.#ǁleftǁ).set(v); }
    #ǁsinceǁ = Symbol();
    get #since() { const v = ø.cell(this, this.#ǁsinceǁ).get(); return v === Symbol.for('??') ? undefined : v; }
    set #since(v) { ø.cell(this, this.#ǁsinceǁ).set(v); }
    static get css() { return [super.css, `
		display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; align-items: center; width: min(22rem, calc(100vw - 32px));
		padding: 12px 14px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-card); color: var(--ui-foreground);
		box-shadow: var(--ui-shadow); font-size: 14px; animation: ui-toast-in .2s ease-out;
		> b { font-weight: 600; } > p { grid-column: 1; margin: 0; color: var(--ui-muted-foreground); font-size: 13px; }
		> button.action { grid-row: 1 / span 2; grid-column: 2; height: 30px; padding: 0 10px; font-size: 13px; }
		> button.close { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--ui-muted-foreground); font-size: 16px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity .12s;
			&:hover { color: var(--ui-foreground); } }
		&:hover > button.close, &:focus-within > button.close { opacity: 1; }
		position: relative;
		&[data-kind=success] { border-color: color-mix(in srgb, #22c55e 50%, transparent); } &[data-kind=success] > b::before { content: '✓ '; color: #22c55e; }
		&[data-kind=error] { border-color: color-mix(in srgb, var(--ui-destructive) 50%, transparent); } &[data-kind=error] > b::before { content: '✕ '; color: var(--ui-destructive); }
		&[data-kind=warning] > b::before { content: '△ '; color: #f59e0b; }
		&[data-kind=info] > b::before { content: 'ⓘ '; color: var(--ui-ring); }
	`]; }
    static get stack() {
		let s = document.getElementById('ui-toasts');
		if (!s) {
			s = document.createElement('output');
			s.id = 'ui-toasts'; s.setAttribute('popover', 'manual'); s.setAttribute('aria-label', 'Notifications');
			s.style.cssText = 'position: fixed; inset: auto 16px 16px auto; margin: 0; padding: 0; border: 0; background: transparent; display: grid; gap: 8px; overflow: visible; max-width: calc(100vw - 32px);';
			document.body.append(s);
		}
		if (!s.matches(':popover-open')) try { s.showPopover(); } catch (e) {}
		return s;
	}
    static show(message, opts = {}) {
		const t = new Toast();
		if (opts.kind) t.dataset.kind = opts.kind;
		t.setAttribute('role', opts.kind === 'error' ? 'alert' : 'status'); t.tabIndex = 0;
		t.add(b().setText(String(message)));
		if (opts.description) t.add(p().setText(String(opts.description)));
		if (opts.action) { const [label, fn] = opts.action; t.add(button('.action.outline.sm').setText(String(label)).add('@click', () => { fn?.(); t.close(); })); }
		t.add(button('.close', '×').set('aria-label', 'Close').add('@click', () => t.close()));
		Toast.stack.append(t);
		t.#left = opts.duration === undefined ? 5000 : opts.duration;
		t.#tick();
		return t;
	}
    static dismiss() { for (const t of document.querySelectorAll('#ui-toasts > toast')) t.close(); }
    close() {
		clearTimeout(this.#timer);
		this.style.animation = 'ui-toast-out .15s ease-in forwards';
		setTimeout(() => { const s = this.parentElement; this.remove(); if (s && !s.children.length) try { s.hidePopover(); } catch (e) {} }, 150);
	}
    #tick() { if (this.#left > 0) { this.#since = Date.now(); this.#timer = setTimeout(() => this.close(), this.#left); } }
    ['@mouseenter']() { if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; this.#left -= Date.now() - this.#since; } }
    ['@mouseleave']() { if (!this.#timer) this.#tick(); }
    ['@keydown'](e) { if (e.key === 'Escape') this.close(); }

    constructor(...args) {
        super(...args);
        this[Symbol.new](function* øToast() {
            this.#timer = null;
            this.#left = 0;
            this.#since = 0;
        });
    }
    static { ø.level(this); }
}
Instance.define(Toast);

/* the page may already be parsed when this runs (the compiler's capture runs a page's scripts once it is): what the
 * runtime's boot ring passed over before the classes existed is upgraded here, once, router and outlet first */
(function () {
	const sweep = () => { for (const tag of ["router","outlet","route","portal","email","tel","website","mailto","logout","reset","intl","async","sync","static","calendar","carousel","combobox","command","datatable","tabs","toast"]) document.querySelectorAll(tag).forEach(el => Instance.upgrade(el)); };
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep, { once: true }); else sweep();
})();
