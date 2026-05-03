/**!
 * Chimera V6.5.2-nightly — The Unified Kernel (Flag Overhaul)
 *
 * CHANGELOG V6.5.2:
 * ─────────────────────────────────────────────────────────────────────────────
 * • 8-bit flag vocabulary overhauled. All 8 bits now carry non-overlapping,
 *   single-axis semantics. No bit does double duty.
 *
 *   OLD:  [ ZOMBIE, RUNNING, STALE, QUEUED, DEEP, YIELD, FROZEN, DIRTY ]
 *   NEW:  [ ZOMBIE, RUNNING, STALE, DIRTY,  DEEP, YIELD, FROZEN, DYNAMIC ]
 *
 *   QUEUED → DIRTY:
 *     The old QUEUED bit described a scheduler location ("I am in the array").
 *     Under the new coalesced model a node that is DIRTY|FROZEN is not in the
 *     array, so calling it QUEUED was a semantic lie. DIRTY describes node
 *     state ("my dependencies changed, I need re-evaluation") regardless of
 *     whether the physical push has happened yet. STALE remains the pull-side
 *     equivalent for computeds; DIRTY is the push-side equivalent for effects.
 *     The two never coexist on the same node — computeds are never pushed,
 *     effects are never lazily pulled.
 *
 *   DIRTY (old bit 128) → DYNAMIC (new bit 128):
 *     The old DIRTY flag was a secondary "needs-run-while-frozen" marker that
 *     duplicated information already expressible as DIRTY|FROZEN. Freed by the
 *     QUEUED→DIRTY rename, bit 128 is now DYNAMIC: opt-in per-node flag that
 *     forces cleanupEdges() on every run regardless of DEEP. Correct for
 *     shallow effects with conditional dependency sets.
 *
 * • trigger() rewritten: sets DIRTY, pushes to queue only if !FROZEN.
 *   One code path. No branch to an old DIRTY setter.
 *
 * • flushQueue() rewritten: DIRTY is the execution gate. FROZEN mid-flush
 *   leaves DIRTY intact and continues — node stays dirty, will be pushed by
 *   setFrozen(false). Benign-duplicate entries (freeze→resume inside a batch)
 *   are drained silently by the DIRTY guard at O(1) cost.
 *
 * • setFrozen() rewritten: resume checks DIRTY only. If set, the node was
 *   triggered while frozen and was never pushed — push it now. No QUEUED
 *   check, no dual-state ambiguity.
 *
 * • runNode() edge-cleanup gate updated: DEEP | DYNAMIC both trigger
 *   cleanupEdges(), decoupling "deep proxy wrapping" from "dynamic dep set".
 *
 * • next() (coroutine self-scheduling) updated: DIRTY replaces old QUEUED
 *   reference for batch re-enqueue.
 *
 * CHANGELOG V6.5.0:
 * ─────────────────────────────────────────────────────────────────────────────
 * • Single IIFE. No Arena factory argument. No export object. No destructuring.
 *   All kernel state lives as lexical variables — V8 resolves them to raw memory
 *   offsets at compile time. Zero property-lookup overhead on the hot path.
 *
 * • GraphNode extends null — monomorphic pool node.
 *   Constructor replaces initNode/createNode entirely.
 *   Object.create(GraphNode.prototype) always — never new.target.prototype.
 *
 * • Substrate self-binds its prototype to preserve the GraphNode return signature
 *   while maintaining engine capabilities.
 *
 * • GraphNode.subtle and Substrate.subtle mirror TC-39 standards for telemetry.
 *
 * Drop-in IIFE. No bundler. No imports. Paste and go.
 * @license AGPL-3.0-or-later
 */
const Chimera = (function (global, GUARD_SYM, REACTIVE_STORE) {
	'use strict';

	// ═══════════════════════════════════════════════════════════════════
	// §1  KERNEL STATE — lexical, module-scoped
	// ═══════════════════════════════════════════════════════════════════
	let _pool         = null;
	let _flags        = null;
	let _sigHead      = null;
	let _headDep      = null;
	let _edgeNextSub  = null;
	let _edgePrevSub  = null;
	let _edgeNextDep  = null;
	let _edgeSignal   = null;
	let _edgeEffect   = null;
	let _pendingQueue = null;
	let _zombieQueue  = null;
	let _execStack    = null;
	let _parent       = null;
	let _firstChild   = null;
	let _nextSibling  = null;
	let _isFlushing   = false;

	const FLAGS = [ 1, 2, 4, 8, 16, 32, 64, 128 ];
	const STATE = [ 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ];

	const SIZES = {
		small:     [65536,   Uint16Array, Uint32Array],
		standard:  [131072,  Uint32Array, Uint32Array],
		large:     [262144,  Uint32Array, Uint32Array],
		massive:   [1048576, Uint32Array, Uint32Array]
	};
	
	let [
		_nextId, _edgeCount,   // The ones
		_maxNodes, _maxEdges, _freeHead, _freeEdgeHead,  // The zeros
		_pendingHead, _pendingTail, _zombieTail, _activePtr, 
		_stackDepth, _batchDepth, _nodeIdCounter, _activeCount
	] = STATE;


	// Bit layout (Uint8Array — one byte per node, all 8 bits assigned):
	//   Lifespan  : ZOMBIE
	//   Execution : RUNNING, YIELD
	//   Reactivity: STALE (pull/computed), DIRTY (push/effect), FROZEN
	//   Graph     : DEEP, DYNAMIC
	//
	// Invariant: STALE and DIRTY never coexist on the same node.
	//   Computeds are pull-based → STALE, never DIRTY.
	//   Effects   are push-based → DIRTY, never STALE.
	//
	// Invariant: DIRTY|FROZEN means "triggered while frozen, not yet in queue."
	//   trigger()    sets DIRTY; skips push if FROZEN.
	//   setFrozen()  pushes on resume if DIRTY is set.
	//   flushQueue() leaves DIRTY intact when node is FROZEN mid-flush.
	//
	// Benign-duplicate queue entries (freeze→resume inside a batch) are
	// harmless: the DIRTY guard in flushQueue() drains ghost pointers at O(1).
	const [ ZOMBIE, RUNNING, STALE, DIRTY, DEEP, YIELD, FROZEN, DYNAMIC ] = FLAGS;

	// ═══════════════════════════════════════════════════════════════════
	// §2  POLYFILL
	// ═══════════════════════════════════════════════════════════════════
	void function ($0, $1, $2) {
		const ensure = (proto, name) => {
			if (Object.hasOwn(proto, name)) return;
			Object.defineProperty(proto, name, {
				writable: true, configurable: true,
				value: {
					[$1](key, def)  { return this.has(key) ? this.get(key) : (this.set(key, def), def); },
					[$2](key, fn)   {
						if (this.has(key)) return this.get(key);
						if (typeof fn !== $0) throw new TypeError(`${$2} requires a ${$0}`);
						const v = fn(key, this); this.set(key, v); return v;
					}
				}[name]
			});
		};
		for (const p of [Map.prototype, WeakMap.prototype]) { ensure(p, $1); ensure(p, $2); }
	}('function', 'getOrInsert', 'getOrInsertComputed');

	// ═══════════════════════════════════════════════════════════════════
	// §3  UTILITIES & SYMBOLS
	// ═══════════════════════════════════════════════════════════════════
	const { get: RG, set: RS, defineProperty: RD, deleteProperty: RDEL } = Reflect;
	const { is, entries, getPrototypeOf: _of, prototype: _$, freeze: lock } = Object;

	const _isPlainObj = v => v != null && typeof v === 'object' && (_of(v) === _$ || _of(v) === null);
	const _isClass    = v => typeof v === 'function' && v.prototype !== undefined
						  && Object.getOwnPropertyDescriptor(v, 'prototype')?.writable === false;
	const _isGen      = v => typeof v === 'function'
						  && (v.constructor?.name === 'GeneratorFunction'
						   || v[Symbol.toStringTag]  === 'GeneratorFunction');

	const BUILT_IN_SYMBOLS = new Set(Reflect.ownKeys(Symbol).flatMap(k =>
		typeof Symbol[k] === 'symbol' ? [Symbol[k]] : []));
	const GHOST_FUNCTION = Symbol('ƒ');
	const UNMOUNT        = Symbol('Chimera:unmount');
	const CHIMERA_SIG    = Symbol.for('Chimera:TC39Signal');
	const elementEngines = new WeakMap();
	const STATIC_SCANNED = new WeakSet();
	const SCANNED_CLASSES= new WeakSet();
	const _proxyOf       = new WeakMap();

	const ƒ = () => {
		const fn = function* $() {};
		RDEL(fn, 'name'); RDEL(fn, 'length');
		RD(fn, GHOST_FUNCTION, { value: true });
		return Object.setPrototypeOf(fn, _$);
	};


	const _REGISTRY = typeof FinalizationRegistry === 'function'
		? new FinalizationRegistry(ptrs => { for (let i = 0; i < ptrs.length; tagForDisposal(ptrs[i++])); })
		: null;

	// ═══════════════════════════════════════════════════════════════════
	// §5  GRAPHNODE — monomorphic reactive cell
	// ═══════════════════════════════════════════════════════════════════
	class GraphNode extends null {

		static _initKernel(
			maxNodes = 262144,
			maxEdges = maxNodes * 2,
			NodeArr  = Uint32Array,
			EdgeArr  = Uint32Array
		) {
			if (_pool) return;
			_maxNodes     = maxNodes;
			_maxEdges     = maxEdges;
			_pool         = new Array(maxNodes).fill(null);
			_flags        = new Uint8Array(maxNodes);
			_sigHead      = new EdgeArr(maxNodes);
			_headDep      = new EdgeArr(maxNodes);
			_edgeNextSub  = new EdgeArr(maxEdges);
			_edgePrevSub  = new EdgeArr(maxEdges);
			_edgeNextDep  = new EdgeArr(maxEdges);
			_edgeSignal   = new NodeArr(maxEdges);
			_edgeEffect   = new NodeArr(maxEdges);
			_pendingQueue = new NodeArr(maxNodes);
			_zombieQueue  = new NodeArr(maxNodes);
			_execStack    = new NodeArr(4096);
			_parent       = new NodeArr(maxNodes);
			_firstChild   = new NodeArr(maxNodes);
			_nextSibling  = new NodeArr(maxNodes);
		}

		static get activePtr()   { return _activePtr; }
		static set activePtr(v)  { _activePtr = v; }
		static get batchDepth()  { return _batchDepth; }
		static set batchDepth(v) { _batchDepth = v; }
		
		constructor(ptr, fn, flags, owner = 0, value) {
			_flags[ptr] = flags | 0;
			_headDep[ptr] = 0;

			let node = _pool[ptr];
			if (!node) {
				node = Object.create(new.target.prototype);
				_pool[ptr] = node;
			}

			node.id             = ++_nodeIdCounter;
			node.ptr            = ptr;
			node.value          = value;
			node.fn             = fn ?? null;
			node.ctx            = null;
			node._eng           = null;
			node._pure          = null;
			node._children      = null;
			node._D             = null;
			node._userFn        = null;
			node._triggering    = false;
			node._notifyTarget  = null;
			node._notifyProp    = null;
			node._sigilProxy    = null;

			if (owner !== 0) adopt(owner, ptr);
			return node;
		}

		get() {
			track(this.ptr);
			if (_flags[this.ptr] & STALE) {
				const val = recompute(this.ptr, this._userFn);
				this.value = ((_flags[this.ptr] & DEEP) && val !== null && typeof val === 'object')
					? deepProxy(val, this.ptr) : val;
			}
			if (!(_flags[this.ptr] & DEEP) &&
				this.value !== null && this.value !== undefined &&
				typeof this.value.get === 'function' &&
				typeof this.value.ptr === 'number') {
				return this.value.get();
			}
			return this.value;
		}

		set(v) {
			if (is(this.value, v)) return;
			this.value = ((_flags[this.ptr] & DEEP) && typeof v === 'object' && v !== null)
				? deepProxy(v, this.ptr) : v;
			trigger(this.ptr);
			if (this._notifyTarget) this._notifyTarget._notify(this._notifyProp);
		}

		peek() {
			if (_flags[this.ptr] & STALE) {
				const val = recompute(this.ptr, this._userFn);
				this.value = ((_flags[this.ptr] & DEEP) && val !== null && typeof val === 'object')
					? deepProxy(val, this.ptr) : val;
			}
			if (!(_flags[this.ptr] & DEEP) &&
				this.value !== null && this.value !== undefined &&
				typeof this.value.peek === 'function' &&
				typeof this.value.ptr  === 'number') {
				return this.value.peek();
			}
			return this.value;
		}

		[Symbol.toPrimitive](hint) {
			track(this.ptr);
			const v = this.value;
			if (hint === 'number') return typeof v === 'number' ? v : (Number(v) || 0);
			if (hint === 'string') return v != null ? String(v) : '';
			return v;
		}

		_notify(key) {
			if (this._triggering || !this._D) return;
			this._D.add(key);
			if (this._D.size === this._children.size) { this._D.clear(); trigger(this.ptr); }
		}

		map(fn)          { return this._eng.computed(() => fn(this.get())); }
		filter(pred)     {
			let last = this.peek();
			return this._eng.computed(() => { const v = this.get(); if (pred(v)) last = v; return last; });
		}
		combine(sig, fn) {
			return this._eng.computed(() => fn(this.get(), typeof sig.get === 'function' ? sig.get() : sig));
		}
	}

		// ═══════════════════════════════════════════════════════════════════
	// §13  SUBSTRATE — translation layer, extends GraphNode
	// ═══════════════════════════════════════════════════════════════════
	class Substrate extends GraphNode {


		constructor(
			sizeOrNodes = 'standard',
			maxEdges    = null,
			NodeArr     = Uint32Array,
			EdgeArr     = Uint32Array
		) {
			let maxNodes;
			if (typeof sizeOrNodes === 'string') {
				const entry = SIZES[sizeOrNodes] || SIZES.standard;
				maxNodes    = entry[0];
				maxEdges    = maxEdges ?? maxNodes * 2;
				NodeArr     = entry[1] ?? Uint32Array;
				EdgeArr     = entry[2] ?? Uint32Array;
			} else {
				maxNodes    = sizeOrNodes;
				maxEdges    = maxEdges ?? maxNodes * 2;
			}

			GraphNode._initKernel(maxNodes, maxEdges, NodeArr, EdgeArr);
			const ptr = allocNode();
			const node = super(ptr, null, 0, 0, undefined); 

			/*
			* ── THE RECYCLED PROTOTYPE BUG (V8 MONOMORPHISM FIX) ──────────────────────
			* Why are we mixing methods manually instead of using prototype inheritance?
			* 
			* 1. The Arena Pool: When an engine is disposed, its memory slot is recycled, 
			*    but the physical JavaScript object remains sitting in `_pool[ptr]`.
			* 2. The Prototype Bypass: On the next `new Substrate()`, the GraphNode 
			*    constructor grabs this recycled object. Because it already exists in the pool, 
			*    `Object.create(...)` is skipped. The object returned by super() is 
			*    permanently branded with `GraphNode.prototype`.
			* 3. The Performance Trap: If we dynamically fixed this using 
			*    `Object.setPrototypeOf(node, Substrate.prototype)`, V8 would instantly 
			*    deoptimize the object's Hidden Class, permanently destroying our 87+ FPS.
			* 
			* THE FIX: We manually define Substrate's descriptors directly on the instance. 
			* The pool remains strictly monomorphic, V8 stays optimized, and the engine 
			* gets its methods (and getters!) regardless of whether the pointer was fresh.
			* ──────────────────────────────────────────────────────────────────────────
			*/
			const proto = Substrate.prototype;
			for (const key of Object.getOwnPropertyNames(proto)) {
				if (key !== 'constructor') {
					// Correctly copy the getter/setter/method descriptor without triggering it
					Object.defineProperty(node, key, Object.getOwnPropertyDescriptor(proto, key));
				}
			}
			// Attach engine‑specific fields directly to the node
			node.store         = new Map();
			node.effectPtrs    = [];
			node.namedEffects  = new Map();
			node._anonStops    = new Set();
			node._target       = null;
			node._sigAccessor  = null;
			node._deepAccessor = null;
			node._rawEscape    = null;
			node._graphFunctor = null;
			node._vivProxy     = null;
			node._shallowNS    = null;
			node._deepNS       = null;

			return node;                                        // must explicitly return
		}

		static get subtle() {
			return {
				get stats() {
					// Ensure _nextId exists to avoid ReferenceErrors
					if (typeof _nextId === 'undefined') return { slotsActive: 0 }; 
					
					return {
						// Use the tracking variables we discussed
						slotsActive: _activeCount, 
						zombies: _zombieTail, // Direct reuse
						arenaMax: _maxNodes 
					};
				},
				forceGC() { sweep(); }
			};
		}

		// Logic: Density is how much of the arena is NOT in the free list
		get density() { 
			return (_activeCount + _zombieTail) / _maxNodes; 
		}

		_getEntry(name) {
			return this.store.getOrInsertComputed(name, () => ({ $: null, $$: null }));
		}

		signal(initial, isDeep = false, pureKey = null, parentTarget = null, childProp = null, seed = undefined) {
			const ptr   = allocNode();
			const owner = pureKey ? 0 : _activePtr;

			if (_isClass(initial)) {
				const instance = new initial();
				new GraphNode(ptr, null, isDeep ? DEEP : 0, owner, instance);
				const node = _pool[ptr];
				node._eng = this; node._pure = pureKey;
				if (isDeep && instance !== null) node.value = deepProxy(instance, ptr);
				if (pureKey) this._getEntry(pureKey)[isDeep ? '$$' : '$'] = node;
				_walkReactiveShape(this, instance, isDeep, pureKey);
				return isDeep ? _installSigilAccessor(node, this, pureKey) : node;
			}

			if (typeof initial === 'function') {
				const gen   = _isGen(initial);
				const flags = (isDeep ? DEEP : 0) | (gen ? YIELD : 0);

				new GraphNode(ptr, gen ? initial : null, flags, owner, seed);
				const node = _pool[ptr];
				node._eng = this; node._pure = pureKey; node._userFn = initial;

				if (seed !== undefined && isDeep && _isPlainObj(seed)) {
					node._children = new Map(); node._D = new Set();
					for (const [k, v] of entries(seed)) {
						const ck = pureKey ? `${pureKey}.${k}` : k;
						const child = this.signal(v, true, ck, node, k);
						node._children.set(k, child);
						this.store.set(ck, child);
					}
				}

				if (!gen) {
					const userFn = initial, eng = this;
					node.fn = () => {
						const ref    = eng._target ?? node;
						const result = userFn.call(ref, ref);
						if (result !== null && result !== undefined &&
							typeof result.get === 'function' && typeof result.ptr === 'number') {
							if (isDeep) node.value = result;
							else { track(result.ptr); node.value = result.peek(); }
						} else if (_isClass(result?.constructor) && isDeep) {
							node.value = deepProxy(result, ptr);
							_walkReactiveShape(eng, result, isDeep, pureKey);
						} else {
							node.value = (isDeep && result !== null && typeof result === 'object')
								? deepProxy(result, ptr) : result;
						}
						trigger(ptr);
					};
				}

				if (pureKey) this._getEntry(pureKey)[isDeep ? '$$' : '$'] = node;
				this.effectPtrs.push(ptr);
				if (gen) next(ptr); else runNode(ptr);
				return node;
			}

			new GraphNode(ptr, null, isDeep ? DEEP : 0, owner, initial);
			const node = _pool[ptr];
			node._eng = this; node._pure = pureKey;
			if (isDeep && initial !== null && typeof initial === 'object')
				node.value = deepProxy(initial, ptr);
			if (parentTarget) { node._notifyTarget = parentTarget; node._notifyProp = childProp; }

			const composite = _isPlainObj(initial);
			if (composite) {
				node._children = new Map(); node._D = new Set();
				for (const [k, v] of entries(initial)) {
					const ck = pureKey ? `${pureKey}.${k}` : k;
					const child = this.signal(v, isDeep, ck, node, k);
					node._children.set(k, child);
					this.store.set(ck, child);
				}
			}
			if (pureKey) this._getEntry(pureKey)[isDeep ? '$$' : '$'] = node;

			if (composite && isDeep) return new Proxy(_installSigilAccessor(node, this, pureKey), SmartSignalHandler);
			return composite ? new Proxy(node, SmartSignalHandler) : node;
		}

		computed(fn, isDeep = false) {
			const ptr = allocNode();
			const node = new GraphNode(ptr, null, STALE, _activePtr, undefined);
			node._userFn = fn; node._eng = this;
			node.fn = () => { _flags[ptr] |= STALE; trigger(ptr); };
			this.effectPtrs.push(ptr);
			return node;
		}

		coroutine(fn, isDeep = false) {
			const ptr = allocNode();
			const node = new GraphNode(ptr, fn, YIELD | (isDeep ? DEEP : 0), _activePtr, undefined);
			node._eng = this;
			this.effectPtrs.push(ptr);
			next(ptr);
			return node;
		}

		effect(fn, isDynamic = true) {
			const ptr  = allocNode();
			// ✅ Maps to the new DYNAMIC flag to safely retrace edges
			const node = new GraphNode(ptr, () => fn(), isDynamic ? DYNAMIC : 0, 0, undefined);
			runNode(ptr);
			this.effectPtrs.push(ptr);
			return () => {
				tagForDisposal(ptr);
				const idx = this.effectPtrs.indexOf(ptr);
				if (idx !== -1) {
					const last = this.effectPtrs.pop();
					if (idx < this.effectPtrs.length) this.effectPtrs[idx] = last;
				}
			};
		}

		untrack(fn) {
			const prev = _activePtr; _activePtr = 0;
			try { return fn(); } finally { _activePtr = prev; }
		}

		batch(input) {
			++_batchDepth;
			try {
				if (_isPlainObj(input)) {
					for (const [k, v] of entries(input)) {
						const s = parseSigil(k);
						const pure = s ? s.pure : k, deep = s ? s.isDeep : false;
						const e = this._getEntry(pure), sig = deep ? e.$$ : e.$;
						if (sig) sig.set(v);
						else { if (deep) e.$$ = this.signal(v, true, pure); else e.$ = this.signal(v, false, pure); }
					}
				} else if (typeof input === 'function') { input(); }
			} catch (e) { console.error('[Chimera] batch error:', e); throw e; }
			finally { if (--_batchDepth === 0) flushQueue(); }
		}

		watch(src, fn) {
			const getter = typeof src === 'function' ? src : () => src.get();
			let oldVal = this.untrack(getter);
			const ptr  = allocNode();
			new GraphNode(ptr, () => {
				const nv = getter();
				if (!is(nv, oldVal)) { const pv = oldVal; oldVal = nv; this.untrack(() => fn(nv, pv)); }
			}, 0, 0, undefined);
			runNode(ptr); 
			this.effectPtrs.push(ptr);
			return () => tagForDisposal(ptr);
		}

		dispose(key) {
			if (key !== undefined) {
				const pure = String(key).replace(/^[\$\*]+/, '');
				const e = this.store.get(pure);
				if (e) { if (e.$) disposeSlot(e.$.ptr); if (e.$$) disposeSlot(e.$$.ptr); this.store.delete(pure); }
				return;
			}
			for (let i = 0, l = this.effectPtrs.length; i < l; disposeSlot(this.effectPtrs[i++]));
			for (const e of this.store.values()) { if (e.$) disposeSlot(e.$.ptr); if (e.$$) disposeSlot(e.$$.ptr); }
			this._anonStops.forEach(s => s()); this._anonStops.clear();
			this.namedEffects.clear(); this.effectPtrs.length = 0; this.store.clear();
		}

		pause(key,  deep = false) { const s = this._getSig(key, deep); if (s) setFrozen(s.ptr, true);  }
		resume(key, deep = false) { const s = this._getSig(key, deep); if (s) setFrozen(s.ptr, false); }
		peek(key,   deep = false) { const s = this._getSig(key, deep); return s ? s.peek() : undefined; }
		_getSig(key, deep) {
			const pure = String(key).replace(/^[\$\*]+/, '');
			const e = this.store.get(pure);
			return e ? (deep ? e.$$ : e.$) : null;
		}

	}

	// ═══════════════════════════════════════════════════════════════════
	// §6  SIGIL PARSER (memoized)
	// ═══════════════════════════════════════════════════════════════════
	const _sigilCache = new Map();

	function parseSigil(prop) {
		if (typeof prop !== 'string') return null;
		const cached = _sigilCache.get(prop);
		if (cached !== undefined) return cached;
		let result = null;
		const len = prop.length;
		if (len >= 2 && prop.charCodeAt(len - 1) === 33) {
			const deep = prop.charCodeAt(len - 2) === 33;
			const pure = prop.slice(0, deep ? -2 : -1);
			if (pure) result = { kind: 'trigger', isDeep: deep, pure };
		} else {
			const c0 = prop.charCodeAt(0);
			if (c0 === 36) {
				const deep = prop.charCodeAt(1) === 36;
				const pure = prop.slice(deep ? 2 : 1);
				if (pure) result = { kind: 'signal', isDeep: deep, pure };
			} else if (c0 === 42) {
				const deep = prop.charCodeAt(1) === 42;
				const pure = prop.slice(deep ? 2 : 1);
				if (pure) result = { kind: 'coroutine', isDeep: deep, pure };
			}
		}
		_sigilCache.set(prop, result);
		return result;
	}

	// ═══════════════════════════════════════════════════════════════════
	// §7  CONSENSUS TRIGGER
	// ═══════════════════════════════════════════════════════════════════
	function triggerConsensus(sig, partialObj, isDeep = false) {
		if (partialObj && sig._children) {
			sig._triggering = true;
			for (const key in partialObj) {
				if (Object.hasOwn(partialObj, key)) {
					const child = sig._children.get(key);
					if (child) child.set(partialObj[key]);
				}
			}
			sig._triggering = false;
		}
		if (sig._D) sig._D.clear();
		trigger(sig.ptr);
		if (isDeep && sig._children) {
			for (const child of sig._children.values()) {
				if (child._D) triggerConsensus(child, undefined, true);
				else          trigger(child.ptr);
			}
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	// §8  WALK REACTIVE SHAPE (class-as-signal)
	// ═══════════════════════════════════════════════════════════════════
	function _walkReactiveShape(eng, instance, isDeep, pureKey) {
		for (const key of Object.getOwnPropertyNames(instance)) {
			const s = parseSigil(key);
			if (!s) continue;
			const { kind, isDeep: pd, pure } = s;
			const ck  = pureKey ? `${pureKey}.${pure}` : pure;
			const val = instance[key];
			if (kind === 'coroutine' || _isGen(val)) {
				const sig = eng.coroutine(val.bind(instance), pd);
				const e = eng._getEntry(ck); if (pd) e.$$ = sig; else e.$ = sig;
			} else if (kind === 'signal' && typeof val === 'function') {
				const sig = eng.computed(() => val.call(instance), pd);
				const e = eng._getEntry(ck); if (pd) e.$$ = sig; else e.$ = sig;
			} else if (kind === 'signal') {
				if (_isClass(val)) {
					const nested = new val();
					eng.signal(nested, pd, ck);
					_walkReactiveShape(eng, nested, pd, ck);
				} else { eng.signal(val, pd, ck); }
			}
		}
		let proto = _of(instance);
		while (proto && proto !== Object.prototype) {
			for (const key of Object.getOwnPropertyNames(proto)) {
				const s = parseSigil(key);
				if (!s) continue;
				const desc = Object.getOwnPropertyDescriptor(proto, key);
				if (!desc || desc.get || typeof desc.value !== 'function') continue;
				const { kind, isDeep: pd, pure } = s;
				const ck = pureKey ? `${pureKey}.${pure}` : pure;
				const fn = desc.value;
				if (kind === 'coroutine' || _isGen(fn)) {
					const sig = eng.coroutine(fn.bind(instance), pd);
					const e = eng._getEntry(ck); if (pd) e.$$ = sig; else e.$ = sig;
				} else if (kind === 'signal') {
					const sig = eng.computed(() => fn.call(instance), pd);
					const e = eng._getEntry(ck); if (pd) e.$$ = sig; else e.$ = sig;
				}
			}
			proto = _of(proto);
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	// §9  SIGIL ACCESSOR PROXY  (pos.$$bounds.$min chain)
	// ═══════════════════════════════════════════════════════════════════
	function _installSigilAccessor(parentNode, eng, prefix) {
		if (parentNode._sigilProxy) return parentNode._sigilProxy;
		parentNode._sigilProxy = new Proxy(parentNode, {
			get(t, prop, r) {
				if (prop in t) return Reflect.get(t, prop, r);
				const s = parseSigil(String(prop));
				if (s?.kind === 'signal') {
					const fk = prefix ? `${prefix}.${s.pure}` : s.pure;
					const e  = eng._getEntry(fk);
					const sig = s.isDeep ? e.$$ : e.$;
					if (sig) return sig.get();
					const ns = eng.signal(undefined, s.isDeep, fk);
					e[s.isDeep ? '$$' : '$'] = ns; return ns.get();
				}
				if (typeof prop === 'string' && !prop.startsWith('_')) {
					const fk = prefix ? `${prefix}.${prop}` : prop;
					const e  = eng.store.get(fk);
					const sig = e?.$ ?? e?.$$;
					if (sig) return sig.get();
				}
				return Reflect.get(t, prop, r);
			},
			set(t, prop, value) {
				const s = parseSigil(String(prop));
				if (s?.kind === 'signal') {
					const fk = prefix ? `${prefix}.${s.pure}` : s.pure;
					const e  = eng._getEntry(fk);
					const sig = s.isDeep ? e.$$ : e.$;
					if (sig) { sig.set(value); return true; }
					eng.signal(value, s.isDeep, fk); return true;
				}
				if (typeof prop === 'string' && !prop.startsWith('_')) {
					const fk = prefix ? `${prefix}.${prop}` : prop;
					const e  = eng.store.get(fk);
					const sig = e?.$ ?? e?.$$;
					if (sig) { sig.set(value); return true; }
				}
				return Reflect.set(t, prop, value);
			}
		});
		return parentNode._sigilProxy;
	}

	// ═══════════════════════════════════════════════════════════════════
	// §10  EFFECT CLASSIFIER
	// ═══════════════════════════════════════════════════════════════════
	function _classifyAndRegister(eng, name, fn, ref) {
		if (_isGen(fn)) {
			const sig = eng.coroutine(fn.bind(ref));
			eng.store.set(name, sig);
			eng.namedEffects.set(name, () => { tagForDisposal(sig.ptr); eng.store.delete(name); });
			return sig;
		}
		let rv;
		const ptr  = allocNode();
		new GraphNode(ptr, () => { rv = fn.call(ref, ref); }, 0, 0, undefined);
		runNode(ptr);
		if (rv === undefined) {
			eng.effectPtrs.push(ptr);
			const s = eng.signal(fn, false, name);
			eng.store.set(name, s);
			eng.namedEffects.set(name, () => { tagForDisposal(ptr); eng.store.delete(name); });
			return s;
		}
		disposeSlot(ptr);
		const s = eng.computed(() => fn.call(ref, ref));
		eng.store.set(name, s); return s;
	}

	// ═══════════════════════════════════════════════════════════════════
	// §11  SCOPED VIVIFICATION PROXY
	// ═══════════════════════════════════════════════════════════════════
	function _makeScopedProxy(eng) {
		return new Proxy({ __proto__: null }, {
			get(_, p) {
				if (typeof p === 'symbol') return undefined;
				return eng.store.getOrInsertComputed(p, () => eng.signal(undefined, false, p));
			},
			set(_, p, v) {
				if (typeof p === 'symbol') return true;
				eng.store.getOrInsertComputed(p, () => eng.signal(undefined, false, p)).set(v);
				return true;
			},
			has(_, p) { return typeof p === 'string' && eng.store.has(p); }
		});
	}

	// ═══════════════════════════════════════════════════════════════════
	// §12  SMART SIGNAL HANDLER (composite proxy)
	// ═══════════════════════════════════════════════════════════════════
	const SmartSignalHandler = {
		__proto__: null,
		get(t, p, r) {
			if (p === 'φ') return t;
			if (p in t) return RG(t, p, r);
			if (p === 'map' || p === 'filter' || p === 'combine') {
				const m = GraphNode.prototype[p];
				return typeof m === 'function' ? m.bind(t) : undefined;
			}
			const eng = t._eng;
			if (typeof p === 'string' && t._children) {
				const child = t._children.get(p);
				if (child !== undefined) return child;
			}
			if (eng?._target && Reflect.has(eng._target, p)) {
				const v = RG(eng._target, p);
				return typeof v === 'function' ? v.bind(eng._target) : v;
			}
			return undefined;
		}
	};


	// ═══════════════════════════════════════════════════════════════════
	// §14  CHIMERA — framework layer (Manual Prototype Wiring)
	// ═══════════════════════════════════════════════════════════════════
	function Chimera(thing, upgrader) {
		if (upgrader === true && typeof thing === 'function') return Chimera.upgrade(thing);
		if (!new.target) throw new TypeError('[Chimera] Must be called with `new`, or use upgrader mode.');

		const Ctor = new.target;
		_installStaticReactivity(Ctor);
		_scanProtoMethods(Ctor, $);

		const instance = Reflect.construct(Substrate, [], Ctor);
		instance[REACTIVE_STORE] = instance; 
		instance._target = instance;         

		const proxy = new Proxy(instance, Metaproxy);
		_proxyOf.set(instance, proxy);
		return proxy;
	}

	Object.setPrototypeOf(Chimera, Substrate);

	Object.defineProperty(Chimera, 'upgrade', {
		value: function upgrade(Ctor) {
			if (typeof Ctor !== 'function') throw new TypeError('[Chimera] upgrade expects a function.');
			const pd = Object.getOwnPropertyDescriptor(Ctor, 'prototype');
			if (!pd || !pd.writable) throw new TypeError('[Chimera] upgrade only supports constructor functions with writable prototype.');
			_installStaticReactivity(Ctor);
			_scanProtoMethods(Ctor, null);
			Object.defineProperty(Ctor, 'prototype', {
				value: new Proxy(Ctor.prototype, Metaproxy),
				writable: false, enumerable: false, configurable: false
			});
			return Ctor;
		},
		enumerable: false,
		writable: false,
		configurable: false
	});

	// ═══════════════════════════════════════════════════════════════════
	// §15  METAPROXY
	// ═══════════════════════════════════════════════════════════════════
	const Metaproxy = ({
		__proto__: null,

		apply(target, thisArg, args) {
			if (target[GHOST_FUNCTION]) {
				const payload = args[0];
				const isDOM   = payload?.nodeType === 1;
				const eng     = new Substrate();
				eng._target   = payload;
				const proxy   = new Proxy(payload, Metaproxy);
				payload[REACTIVE_STORE] = eng;
				_bootstrapFactory(payload, eng, proxy);
				if (isDOM) {
					payload[UNMOUNT] = () => { eng.namedEffects.forEach(f => f()); eng.dispose(); payload[UNMOUNT] = null; };
					elementEngines.set(payload, eng);
					HOSTS.push(payload);
					_schedulePoll();
					_REGISTRY?.register(payload, eng.effectPtrs.slice());
				}
				return proxy;
			}

			const eng  = target[REACTIVE_STORE];
			if (!eng) return target;
			const recv = eng._target ?? thisArg;
			if (args.length === 0) return target;
			const [first, second, third] = args;

			if (typeof first === 'function') {
				if (!eng._vivProxy) eng._vivProxy = _makeScopedProxy(eng);
				if (_isGen(first)) {
					const sig = eng.coroutine(() => first.call(recv, eng._vivProxy));
					eng._anonStops.add(() => tagForDisposal(sig.ptr));
				} else {
					eng._anonStops.add(eng.effect(() => first.call(recv, eng._vivProxy)));
				}
				return recv;
			}

			if (_isPlainObj(first)) {
				eng.batch(() => {
					for (const [key, val] of entries(first)) {
						const s = parseSigil(key); if (!s) continue;
						const e = eng._getEntry(s.pure);
						if (s.kind === 'coroutine' && typeof val === 'function') {
							e[s.isDeep ? '$$' : '$'] = eng.coroutine(val.bind(recv), s.isDeep);
						} else if (s.kind === 'signal') {
							const sk = s.isDeep ? '$$' : '$';
							if (e[sk]) e[sk].set(val); else e[sk] = eng.signal(val, s.isDeep, s.pure);
						}
					}
				});
				return target;
			}

			if (typeof first === 'string') {
				const s    = parseSigil(first) || { kind: 'signal', pure: first, isDeep: false };
				const pure = s.pure; if (!pure) return target;
				const e    = eng._getEntry(pure);
				const sk   = s.isDeep ? '$$' : '$';

				if (s.kind === 'trigger') {
					const sig = e[sk];
					if (sig) { if (sig._D) triggerConsensus(sig, second, s.isDeep); else { if (second !== undefined) sig.set(second); trigger(sig.ptr); } }
					return target;
				}
				if (typeof third === 'function' || _isClass(third)) {
					eng.signal(third, s.isDeep, pure, null, null, second); return recv;
				}
				if (typeof second === 'function' || _isClass(second)) {
					eng.signal(second, s.isDeep, pure); return recv;
				}
				if (second !== null && typeof second === 'object' && typeof second.get === 'function') {
					e[sk] = second; return recv;
				}
				if (second !== undefined) { if (e[sk]) e[sk].set(second); else e[sk] = eng.signal(second, s.isDeep, pure); }
				else { if (!e[sk]) e[sk] = eng.signal(undefined, s.isDeep, pure); return e[sk]; }
				return recv;
			}
			return target;
		},

		get(target, prop, receiver) {
			if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
			let eng = target[REACTIVE_STORE] ?? elementEngines.get(receiver ?? target);
			const isChainer = target !== receiver && typeof target === 'function' && '_receiver' in target;

			if (!eng && typeof prop === 'string' && prop.charCodeAt(0) === 36) {
				eng = new Substrate();
				eng._target = target;
				target[REACTIVE_STORE] = eng;
				_bootstrapFactory(target, eng, receiver);
				if (target.nodeType === 1) {
					receiver[UNMOUNT] = () => { eng.namedEffects.forEach(f => f()); eng.dispose(); receiver[UNMOUNT] = null; };
					HOSTS.push(receiver); _schedulePoll();
					_REGISTRY?.register(receiver, eng.effectPtrs.slice());
				}
			}

			if (prop === '$' || prop === '$$') return buildInstanceNS(eng, prop === '$$');

			if (prop === 'ψ') {
				if (eng._graphFunctor) return eng._graphFunctor;
				const chainer = function(a, b, c) {
					if (!arguments.length) return target;
					if (typeof a === 'function') {
						if (!eng._vivProxy) eng._vivProxy = _makeScopedProxy(eng);
						if (_isGen(a)) eng._anonStops.add(() => tagForDisposal(eng.coroutine(() => a.call(target, eng._vivProxy)).ptr));
						else eng._anonStops.add(eng.effect(() => a.call(target, eng._vivProxy)));
						return chainer;
					}
					if (_isPlainObj(a)) {
						eng.batch(() => {
							for (const [key, val] of entries(a)) {
								const s = parseSigil(key); if (!s) continue;
								const e = eng._getEntry(s.pure); const sk = s.isDeep ? '$$' : '$';
								if (s.kind === 'coroutine' && typeof val === 'function') e[sk] = eng.coroutine(val.bind(target), s.isDeep);
								else if (s.kind === 'signal') { if (e[sk]) e[sk].set(val); else e[sk] = eng.signal(val, s.isDeep, s.pure); }
							}
						});
						return chainer;
					}
					if (typeof a === 'string') {
						const s = parseSigil(a) || { kind: 'signal', pure: a, isDeep: false };
						const e = eng._getEntry(s.pure); const sk = s.isDeep ? '$$' : '$';
						if (s.kind === 'trigger') {
							const sig = e[sk];
							if (sig) { if (sig._D) triggerConsensus(sig, b, s.isDeep); else { if (b !== undefined) sig.set(b); trigger(sig.ptr); } }
							return chainer;
						}
						if (typeof c === 'function' || _isClass(c)) { eng.signal(c, s.isDeep, s.pure, null, null, b); return chainer; }
						if (typeof b === 'function' || _isClass(b)) { _classifyAndRegister(eng, s.pure, b, target); return chainer; }
						if (b !== null && typeof b === 'object' && typeof b.get === 'function') { e[sk] = b; return chainer; }
						if (b !== undefined) { if (e[sk]) e[sk].set(b); else e[sk] = eng.signal(b, s.isDeep, s.pure); }
						else if (!e[sk]) e[sk] = eng.signal(undefined, s.isDeep, s.pure);
						return chainer;
					}
					return chainer;
				};
				Object.defineProperty(chainer, 'φ', { get: () => target, configurable: true });
				eng._graphFunctor = chainer; return chainer;
			}

			if (prop === 'φ') {
				if (eng._rawEscape) return eng._rawEscape;
				eng._rawEscape = function(a, b) {
					if (a !== undefined) {
						const s = parseSigil(a) || { kind: 'signal', pure: a, isDeep: false };
						const e = eng._getEntry(s.pure); const sk = s.isDeep ? '$$' : '$';
						if (e[sk]) e[sk].set(b); else e[sk] = eng.signal(b, s.isDeep, s.pure);
					}
					return target;
				};
				Object.defineProperty(eng._rawEscape, 'φ', { get: () => target, configurable: true });
				return eng._rawEscape;
			}

			if (eng && isChainer) {
				switch (prop) {
					case 'dispose': return key => {
						if (!key) { eng.namedEffects.forEach(s => s()); eng.dispose(); return; }
						const pure = String(key).replace(/^[\$\*]+/, '');
						if (eng.namedEffects.has(pure)) { eng.namedEffects.get(pure)(); eng.namedEffects.delete(pure); }
						if (eng.store.has(pure)) eng.dispose(pure);
					};
					case 'pause':  return key => eng.pause(key);
					case 'resume': return key => eng.resume(key);
					case 'peek':   return key => eng.peek(key);
					case 'is':     return (state, key) => {
						const pure = String(key).replace(/^[\$\*]+/, '');
						const sig = eng.store.get(pure)?.$;
						if (!sig) return false;
						const sl = state.toLowerCase();
						const flag = sl === 'zombie' || sl === 'dead' ? ZOMBIE : sl === 'yield' || sl === 'coroutine' ? YIELD : 0;
						return !!(_flags[sig.ptr] & flag);
					};
				}
				if (typeof prop === 'string' && !BUILT_IN_SYMBOLS.has(prop))
					return eng.store.getOrInsertComputed(prop, () => eng.signal(undefined, target._isDeep, prop));
			}

			if (typeof prop === 'string' && prop.charCodeAt(0) === 36) {
				let proto = _of(target);
				while (proto && proto !== Object.prototype) {
					const d = Object.getOwnPropertyDescriptor(proto, prop);
					if (d) { if (d.get) return d.get.call(receiver); break; }
					proto = _of(proto);
				}
				if (eng && !isChainer) {
					const s = parseSigil(prop);
					if (s?.kind === 'signal') {
						const e = eng.store.get(s.pure);
						const sig = e && (s.isDeep ? e.$$ : e.$);
						if (sig) return sig.get();
						const ns = eng.signal(undefined, s.isDeep, s.pure);
						eng._getEntry(s.pure)[s.isDeep ? '$$' : '$'] = ns;
						return ns.get();
					}
				}
			}

			const isPureJS = REACTIVE_STORE in target;
			const val = RG(target, prop, receiver);
			return (typeof val === 'function' && !target._receiver) ? val.bind(isPureJS ? target : receiver) : val;
		},

		set(target, prop, value, receiver) {
			let eng = target[REACTIVE_STORE] ?? elementEngines.get(receiver ?? target);
			const isChainer = target !== receiver && typeof target === 'function' && '_receiver' in target;
			if (isChainer && typeof prop === 'string' && eng) {
				const e = eng.store.get(prop);
				if (e) { if (e.$) e.$.set(value); else if (e.$$) e.$$.set(value); }
				else eng.signal(value, false, prop);
				return true;
			}
			const sigil = parseSigil(prop);
			if (sigil?.pure && sigil.kind === 'signal') {
				if (!eng && !(REACTIVE_STORE in target)) { void receiver.$; eng = target[REACTIVE_STORE]; }
				if (eng) {
					const { isDeep, pure } = sigil; const e = eng._getEntry(pure);
					if (isDeep) { if (e.$$) e.$$.set(value); else e.$$ = eng.signal(value, true, pure); }
					else        { if (e.$)  e.$.set(value);  else e.$  = eng.signal(value, false, pure); }
					return true;
				}
			}
			return RS(target, prop, value, (REACTIVE_STORE in target) ? target : receiver);
		},

		defineProperty(target, prop, desc) {
			const sigil = parseSigil(prop);
			if (sigil?.pure && sigil.kind === 'signal' && 'value' in desc) {
				const eng = target[REACTIVE_STORE];
				if (eng) {
					const { isDeep, pure } = sigil; const e = eng._getEntry(pure);
					if (isDeep) { if (e.$$) e.$$.set(desc.value); else e.$$ = eng.signal(desc.value, true, pure); }
					else        { if (e.$)  e.$.set(desc.value);  else e.$  = eng.signal(desc.value, false, pure); }
					Object.defineProperty(target, prop, {
						get() { const x = eng.store.get(pure); const s = x && (isDeep ? x.$$ : x.$); return s ? s.get() : undefined; },
						set(v){ const x = eng.store.get(pure); const s = x && (isDeep ? x.$$ : x.$); if (s) s.set(v); },
						configurable: true, enumerable: true
					});
					return true;
				}
			}
			return RD(target, prop, desc);
		},

		construct(target, args) { return Metaproxy.apply(target, null, args); },

		has(target, prop) {
			const s = parseSigil(prop);
			if (s?.pure) {
				const eng = target[REACTIVE_STORE] ?? elementEngines.get(target);
				if (eng?.store.has(s.pure)) { const e = eng.store.get(s.pure); return !!(s.isDeep ? e.$$ : e.$); }
			}
			return Reflect.has(target, prop);
		},

		ownKeys(target) {
			const keys = Reflect.ownKeys(target);
			const eng  = target[REACTIVE_STORE];
			if (eng) for (const [k, e] of eng.store) { if (e.$) keys.push(`$${k}`); if (e.$$) keys.push(`$$${k}`); }
			return Array.from(new Set(keys));
		},

		getOwnPropertyDescriptor(target, prop) {
			const s = parseSigil(prop);
			if (s?.pure) {
				const eng = target[REACTIVE_STORE];
				if (eng?.store.has(s.pure)) { const e = eng.store.get(s.pure); if (s.isDeep ? e.$$ : e.$) return { enumerable: true, configurable: true }; }
			}
			return Reflect.getOwnPropertyDescriptor(target, prop);
		},

		deleteProperty(target, prop) {
			const s = parseSigil(prop);
			if (s?.pure) { const eng = target[REACTIVE_STORE]; if (eng?.store.has(s.pure)) { eng.dispose(s.pure); return true; } }
			return Reflect.deleteProperty(target, prop);
		},

		getPrototypeOf(target) { return Reflect.getPrototypeOf(target); }
	});

	// ═══════════════════════════════════════════════════════════════════
	// §16  CLASS SETUP  (_installStaticReactivity / _scanProtoMethods)
	// ═══════════════════════════════════════════════════════════════════
	function _installStaticReactivity(Ctor) {
		if (STATIC_SCANNED.has(Ctor)) return;
		STATIC_SCANNED.add(Ctor);
		const eng = new Substrate();
		eng._target = Ctor;
		Ctor[REACTIVE_STORE] = eng;
		for (const name of Object.getOwnPropertyNames(Ctor)) {
			const s = parseSigil(name); if (!s) continue;
			const desc = Object.getOwnPropertyDescriptor(Ctor, name);
			if (!desc || desc.get) continue;
			const { kind, isDeep, pure } = s; const val = desc.value;
			if (kind === 'coroutine' && typeof val === 'function') {
				const sig = eng.coroutine(val.bind(Ctor), isDeep);
				const e = eng._getEntry(pure); if (isDeep) e.$$ = sig; else e.$ = sig;
				Object.defineProperty(Ctor, name, { get() { return sig.get(); }, configurable: true, enumerable: false });
			} else if (kind === 'signal' && typeof val === 'function') {
				const sig = eng.computed(() => val.call(Ctor), isDeep);
				const e = eng._getEntry(pure); if (isDeep) e.$$ = sig; else e.$ = sig;
				Object.defineProperty(Ctor, name, { get() { return sig.get(); }, configurable: true, enumerable: false });
			} else if (kind === 'signal') {
				const sig = eng.signal(val, isDeep, pure);
				Object.defineProperty(Ctor, name, { get() { return sig.get(); }, set(v) { sig.set(v); }, configurable: true, enumerable: true });
			}
		}
	}

	function _scanProtoMethods(Ctor, stopAt) {
		if (SCANNED_CLASSES.has(Ctor)) return;
		SCANNED_CLASSES.add(Ctor);
		let cur = Ctor.prototype;
		while (cur && cur !== stopAt && cur !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(cur)) {
				const s = parseSigil(name); if (!s) continue;
				const desc = Object.getOwnPropertyDescriptor(cur, name);
				if (!desc || desc.get || typeof desc.value !== 'function') continue;
				const { kind, isDeep, pure } = s; const origFn = desc.value; const gen = _isGen(origFn);
				if (kind === 'coroutine' || gen) {
					Object.defineProperty(cur, name, { get() {
						const px = _proxyOf.get(this) ?? this; const eng = this[REACTIVE_STORE];
						if (!eng) return origFn.bind(px);
						const e = eng._getEntry(pure); let sig = isDeep ? e.$$ : e.$;
						if (!sig) { sig = eng.coroutine(origFn.bind(px), isDeep); e[isDeep ? '$$' : '$'] = sig; eng.namedEffects.set(pure, () => { tagForDisposal(sig.ptr); e[isDeep ? '$$' : '$'] = null; }); }
						return sig;
					}, configurable: true });
				} else if (kind === 'signal') {
					Object.defineProperty(cur, name, { get() {
						const px = _proxyOf.get(this) ?? this; const eng = this[REACTIVE_STORE];
						if (!eng) return origFn.call(px);
						const e = eng._getEntry(pure); let sig = isDeep ? e.$$ : e.$;
						if (!sig) { sig = eng.computed(() => origFn.call(px), isDeep); e[isDeep ? '$$' : '$'] = sig; }
						return sig.get();
					}, configurable: true });
				}
			}
			cur = _of(cur);
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	// §17  BOOTSTRAP FACTORY
	// ═══════════════════════════════════════════════════════════════════
	function _bootstrapFactory(payload, eng, proxy) {
		for (const key of Object.keys(payload)) {
			const s = parseSigil(key); if (!s) continue;
			const { kind, isDeep, pure } = s; const val = payload[key];
			if (kind === 'coroutine') {
				if (typeof val === 'function') { const sig = eng.coroutine(val.bind(proxy), isDeep); const e = eng._getEntry(pure); if (isDeep) e.$$ = sig; else e.$ = sig; }
				continue;
			}
			if (_isClass(val)) { eng.signal(val, isDeep, pure); continue; }
			if (typeof val === 'function') {
				const sig = eng.computed(() => {
					const r = val.call(proxy, proxy);
					if (isDeep && typeof r === 'object' && r !== null) { const sid = allocNode(); _flags[sid] |= DEEP; return deepProxy(r, sid); }
					return r;
				}, isDeep);
				const e = eng._getEntry(pure); if (isDeep) e.$$ = sig; else e.$ = sig;
			} else { eng.signal(val, isDeep, pure); }
		}
	}

	// ═══════════════════════════════════════════════════════════════════
	// §18  BUILD INSTANCE NAMESPACE  (this.$ / this.$$)
	// ═══════════════════════════════════════════════════════════════════
	function buildInstanceNS(eng, isDeep) {
		if (isDeep  && eng._deepNS)    return eng._deepNS;
		if (!isDeep && eng._shallowNS) return eng._shallowNS;
		const sk = isDeep ? '$$' : '$';

		const accessor = function(key, seedOrFn, fn) {
			if (key === undefined) return;
			const pure = String(key).replace(/^[\$\*\!]+/, '');
			const e    = eng._getEntry(pure);

			if (typeof key === 'string' && key.charCodeAt(key.length - 1) === 33) {
				const sig = e[sk]; if (!sig) return accessor;
				const deep = key.charCodeAt(key.length - 2) === 33;
				if (sig._D) triggerConsensus(sig, seedOrFn, deep);
				else { if (seedOrFn !== undefined) sig.set(seedOrFn); trigger(sig.ptr); }
				return accessor;
			}

			if (typeof fn === 'function' || _isClass(fn)) {
				eng.signal(fn, isDeep, pure, null, null, seedOrFn); return accessor;
			}
			if (typeof seedOrFn === 'function' || _isClass(seedOrFn)) {
				_classifyAndRegister(eng, pure, seedOrFn, eng._target); return accessor;
			}
			if (seedOrFn === undefined) {
				if (!e[sk]) e[sk] = eng.signal(undefined, isDeep, pure);
				return e[sk];
			}
			if (seedOrFn !== null && typeof seedOrFn === 'object' && typeof seedOrFn.get === 'function') {
				e[sk] = seedOrFn; return accessor;
			}
			if (e[sk]) e[sk].set(seedOrFn); else e[sk] = eng.signal(seedOrFn, isDeep, pure);
			return accessor;
		};

		accessor.trigger = (key, partial) => {
			const pure = String(key).replace(/[!]+$/, '');
			const sig  = eng.store.get(pure)?.[sk];
			if (!sig) return;
			if (sig._D) triggerConsensus(sig, partial, false);
			else { if (partial !== undefined) sig.set(partial); trigger(sig.ptr); }
		};

		const ns = new Proxy(accessor, {
			get(_, p) {
				if (p === 'trigger') return accessor.trigger;
				if (p === Symbol.iterator) return function*() { for (const [k, e] of eng.store) { const s = e[sk]; if (s) yield [k, s]; } };
				if (typeof p === 'symbol') return undefined;
				return eng.store.get(String(p))?.[sk] ?? undefined;
			},
			set(_, p, v) {
				if (typeof p === 'symbol') return true;
				const e = eng._getEntry(String(p));
				if (e[sk]) e[sk].set(v); else e[sk] = eng.signal(v, isDeep, String(p));
				return true;
			},
			ownKeys(_)     { const ks = []; for (const [k, e] of eng.store) { if (e[sk]) ks.push(k); } return ks; },
			getOwnPropertyDescriptor(_, p) {
				if (typeof p === 'symbol') return undefined;
				return eng.store.get(String(p))?.[sk] ? { enumerable: true, configurable: true } : undefined;
			},
			deleteProperty(_, p) {
				if (typeof p === 'symbol') return false;
				const e = eng.store.get(String(p)); const sig = e?.[sk];
				if (sig) { disposeSlot(sig.ptr); e[sk] = null; return true; }
				return false;
			}
		});

		if (isDeep) eng._deepNS = ns; else eng._shallowNS = ns;
		return ns;
	}

	// ═══════════════════════════════════════════════════════════════════
	// §19  DOM POLL SCHEDULER
	// ═══════════════════════════════════════════════════════════════════
	const HOSTS        = [];
	let _pollScheduled = false;
	let _pollIndex     = 0;

	function _schedulePoll() {
		if (_pollScheduled || typeof requestIdleCallback === 'undefined') return;
		_pollScheduled = true;
		requestIdleCallback(function _poll(deadline) {
			let n = 0;
			while (n++ < 100 && deadline.timeRemaining() > 1 && HOSTS.length > 0) {
				if (_pollIndex >= HOSTS.length) _pollIndex = 0;
				const h = HOSTS[_pollIndex];
				if (h.isConnected === false) {
					if (h[UNMOUNT]) { h[UNMOUNT](); h[UNMOUNT] = null; }
					const last = HOSTS.pop();
					if (h !== last && _pollIndex < HOSTS.length) HOSTS[_pollIndex] = last;
				} else { _pollIndex++; }
			}
			if (HOSTS.length > 0) requestIdleCallback(_poll);
			else _pollScheduled = false;
		});
	}

	// ═══════════════════════════════════════════════════════════════════
	// §20  SIGNAL — TC39 polyfill + God-Mode constructor
	// ═══════════════════════════════════════════════════════════════════
	let _globalEng = null;
	const _globalEngine = () => _globalEng ?? (_globalEng = new Substrate());

	class TC39State {
		constructor(initialValue, options) {
			this._ptr    = allocNode();
			new GraphNode(this._ptr, null, 0, _activePtr, initialValue);
			this._equals = options?.equals ?? is;
		}
		get() { track(this._ptr); return _pool[this._ptr].value; }
		set(v) { const n = _pool[this._ptr]; if (this._equals(n.value, v)) return; n.value = v; trigger(this._ptr); }
	}

	class TC39Computed {
		constructor(fn, options) {
			if (typeof fn !== 'function') throw new TypeError('Signal.Computed requires a function');
			this._ptr = allocNode(); this._userFn = fn; this._equals = options?.equals ?? is;
			new GraphNode(this._ptr, null, STALE, _activePtr, undefined);
			const ptr = this._ptr;
			_pool[ptr].fn = () => { _flags[ptr] |= STALE; trigger(ptr); };
		}
		get() {
			track(this._ptr); const ptr = this._ptr;
			if (_flags[ptr] & STALE) {
				const nv = recompute(ptr, this._userFn);
				const n  = _pool[ptr];
				if (!this._equals(n.value, nv)) { n.value = nv; trigger(ptr); }
			}
			return _pool[ptr].value;
		}
	}

	class TC39Watcher {
		constructor(notify) {
			if (typeof notify !== 'function') throw new TypeError('Watcher requires a notify function');
			this._notify = notify; this._watched = new Set(); this._pending = new Set(); this._notified = false;
			this._ptr = allocNode(); const self = this, ptr = this._ptr;
			new GraphNode(ptr, () => {
				for (const s of self._watched) { track(s._ptr); if (_flags[s._ptr] & STALE) self._pending.add(s); }
				if (self._pending.size > 0 && !self._notified) { self._notified = true; self._notify(); }
			}, 0, 0, undefined);
			runNode(ptr);
		}
		watch(...signals) {
			for (const s of signals) {
				if (!(s instanceof TC39State) && !(s instanceof TC39Computed))
					throw new TypeError('watch() accepts Signal.State or Signal.Computed');
				this._watched.add(s);
			}
			runNode(this._ptr);
		}
		unwatch(...signals) { for (const s of signals) { this._watched.delete(s); this._pending.delete(s); } }
		getPending() { const r = [...this._pending]; this._pending.clear(); this._notified = false; return r; }
	}

	class Signal {
		constructor(seedOrInitial, fnOrIsDeep, isDeepOrKey, pureKey) {
			const eng = _globalEngine();
			let initial, seed, isDeep, key;
			if (typeof fnOrIsDeep === 'function' || _isClass(fnOrIsDeep) || _isGen(fnOrIsDeep)) {
				seed = seedOrInitial; initial = fnOrIsDeep;
				isDeep = typeof isDeepOrKey === 'boolean' ? isDeepOrKey : false;
				key    = typeof isDeepOrKey === 'string'  ? isDeepOrKey : (pureKey ?? null);
			} else if (typeof fnOrIsDeep === 'boolean') {
				initial = seedOrInitial; seed = undefined; isDeep = fnOrIsDeep;
				key = typeof isDeepOrKey === 'string' ? isDeepOrKey : null;
			} else {
				initial = seedOrInitial; seed = undefined; isDeep = false; key = null;
			}
			return eng.signal(initial, isDeep, key, null, null, seed);
		}

		static [Symbol.hasInstance](i) {
			return i != null && typeof i === 'object' &&
				   (typeof i.ptr === 'number' || typeof i._ptr === 'number');
		}

		static State    = TC39State;
		static Computed = TC39Computed;
		static subtle   = Object.freeze({
			Watcher: TC39Watcher,
			untrack(fn) { const p = _activePtr; _activePtr = 0; try { return fn(); } finally { _activePtr = p; } },
			isWatched(sig) { return sig?._ptr != null && _pool[sig._ptr]?.fn != null; },
			introspectSources(_) { return []; },
			introspectSinks(_)   { return []; }
		});
		static [CHIMERA_SIG] = true;
	}

	// ═══════════════════════════════════════════════════════════════════
	// §21  $ FACTORY & GLOBAL INSTALLATION
	// ═══════════════════════════════════════════════════════════════════
	const $ = Chimera.prototype = new Proxy(ƒ(), Metaproxy);
	Object.setPrototypeOf($, Substrate.prototype);

	for (const [target, isStatic] of [[Chimera, true], [Chimera.prototype, false]]) {
		Object.defineProperty(target, '$', {
			get() {
				const eng = isStatic
					? (STATIC_SCANNED.has(this) || _installStaticReactivity(this), this[REACTIVE_STORE])
					: this[REACTIVE_STORE];
				if (!eng) throw new Error('[Chimera] $ accessed before super().');
				return eng._shallowNS || (eng._shallowNS = buildInstanceNS(eng, false));
			}, configurable: true
		});
		Object.defineProperty(target, '$$', {
			get() {
				const eng = isStatic
					? (STATIC_SCANNED.has(this) || _installStaticReactivity(this), this[REACTIVE_STORE])
					: this[REACTIVE_STORE];
				if (!eng) throw new Error('[Chimera] $$ accessed before super().');
				return eng._deepNS || (eng._deepNS = buildInstanceNS(eng, true));
			}, configurable: true
		});
	}

	Chimera.Signal = Signal;
	if (typeof globalThis !== 'undefined') {
		const existing = globalThis.Signal;
		if (existing && !existing[CHIMERA_SIG]) {
			try { Object.defineProperty(globalThis, '__NativeSignal__',
				{ value: existing, writable: false, configurable: true, enumerable: false }); } catch (_) {}
		}
		try { Object.defineProperty(globalThis, 'Signal',
			{ value: Signal, writable: true, configurable: true, enumerable: false }); }
		catch (_) { globalThis.Signal = Signal; }
	}

	const _stamp = lock({ Chimera, $, Substrate, GraphNode, Signal, REACTIVE_STORE });
	try { Object.defineProperty(global, GUARD_SYM, { value: _stamp, configurable: false }); } catch (_) {}
	Object.defineProperty(global, '$',              { value: $,              writable: false, configurable: true });
	Object.defineProperty(global, 'Substrate',      { value: Substrate,      writable: false, configurable: true });
	Object.defineProperty(global, 'GraphNode',      { value: GraphNode,      writable: false, configurable: true });
	Object.defineProperty(global, 'REACTIVE_STORE', { value: REACTIVE_STORE, writable: false, configurable: true });


	// ═══════════════════════════════════════════════════════════════════
    // §C. THE ARENA DUNGEON (Hoisted kernel functions, pointer math, memory mgmt)
    // ═══════════════════════════════════════════════════════════════════

	function allocNode() {
		for (;;) {
			if (_freeHead !== 0) {
				const ptr = _freeHead; 
				_freeHead = _headDep[ptr]; 
				_headDep[ptr] = 0; 
				_activeCount++;
				return ptr;
			}
			if (_nextId < _maxNodes) {
				_activeCount++;
				return _nextId++;
			} 
			if (_zombieTail > 0) { sweep(); continue; }
			throw new Error('[Chimera] Node OOM');
		}
	}

	function allocEdge() {
		for (;;) {
			if (_freeEdgeHead !== 0) {
				const e = _freeEdgeHead; 
				_freeEdgeHead = _edgeNextSub[e]; 
				_edgeNextSub[e] = 0; 
				return e;
			}
			if (_edgeCount < _maxEdges) return _edgeCount++;
			if (_zombieTail > 0) { sweep(); continue; }
			throw new Error('[Chimera] Edge OOM');
		}
	}

	function runNode(ptr) {
		const node = _pool[ptr];

		// Guard 1: The "Existence" check. 
    	// Usually only fails on the first pass or if the arena is under-initialized.
		if (node === null) return;

		// Guard 2: The "State" check. 
		// This is the HOT check. Splitting this allows the engine to 
		// profile the specific bitwise failure rate separately.
		if (_flags[ptr] & (ZOMBIE | RUNNING | STALE | FROZEN)) return;

		_flags[ptr] = (_flags[ptr] | RUNNING) & ~DIRTY;

		if (node.ctx !== null) {
			const prev = _activePtr; _activePtr = 0;
			try { node.ctx(); } catch (_) {} finally { _activePtr = prev; node.ctx = null; }
		}

		// cleanupEdges when dependency set may change between runs:
		//   DEEP    → paths through deepProxy are conditional by nature
		//   DYNAMIC → explicit opt-in for shallow effects with conditional deps
		if (_flags[ptr] & (DEEP | DYNAMIC)) cleanupEdges(ptr);
		if (_firstChild[ptr] !== 0) disposeChildren(ptr);

		_execStack[_stackDepth++] = (_activePtr = ptr);
		try {
			const result = node.fn();
			if (typeof result === 'function') node.ctx = result;
		} catch (e) { 
			console.error('[Chimera] Effect error:', e);
		} finally {
			_activePtr = --_stackDepth ? _execStack[_stackDepth - 1] : 0;
			_flags[ptr] &= ~RUNNING;
		}
	}

	
	function next(ptr) {

		const node = _pool[ptr];

		if (node === null) return; // conditional 1
		if (_flags[ptr] & (ZOMBIE | RUNNING | FROZEN)) return; // c2

		if (node.ctx === null) {
			node.ctx = node.fn(); // try guard?
			if (!node.ctx || typeof node.ctx.next !== 'function') {
				console.warn(`[Chimera] Coroutine @${ptr} yielded no iterator. Disposing.`);
				tagForDisposal(ptr); 
				return;
			}
		}

		_flags[ptr] = (_flags[ptr] | RUNNING) & ~DIRTY;

		cleanupEdges(ptr);

		try {
			_execStack[_stackDepth++] = (_activePtr = ptr);
			const result = node.ctx.next(node.value);
			_activePtr = --_stackDepth ? _execStack[_stackDepth - 1] : 0;
			if (result.done) {
				const v = result.value;
				node.value = (_flags[ptr] & DEEP) && v !== null && typeof v === 'object'
					? deepProxy(v, ptr) : v;
				node.ctx = null; trigger(ptr);
			} else {
				const yielded = result.value;
				const id      = node.id;
				if (yielded?.ptr !== undefined) {
					track(yielded.ptr);
					node.value = yielded.peek !== undefined ? yielded.peek() : undefined;
				} else if (typeof yielded?.then === 'function') {
					yielded.then(val => {
						if (_pool[ptr]?.id !== id) return;
						node.value = val; trigger(ptr);
						if (!(_flags[ptr] & (ZOMBIE | FROZEN))) next(ptr);
					});
				} else {
					const v = yielded;
					node.value = (_flags[ptr] & DEEP) && v !== null && typeof v === 'object'
						? deepProxy(v, ptr) : v;
					trigger(ptr);
					if (_batchDepth > 0) {
						if (!(_flags[ptr] & DIRTY)) {
							_flags[ptr] |= DIRTY;
							_pendingQueue[(_pendingTail++) & (_maxNodes - 1)] = ptr;
						}
					} else {
						Promise.resolve().then(() => {
							if (_pool[ptr]?.id !== id) return;
							if (!(_flags[ptr] & (ZOMBIE | FROZEN))) next(ptr);
						});
					}
				}
			}
		} catch (e) {
			_activePtr = --_stackDepth ? _execStack[_stackDepth - 1] : 0;
			console.error('[Chimera] Coroutine error:', e);
		} finally { _flags[ptr] &= ~RUNNING; }
	}

	function sweep() {
		while (_zombieTail > 0) disposeSlot(_zombieQueue[--_zombieTail]);
		_zombieTail = 0;
	}

	
	// function reset() {}

	function tagForDisposal(ptr) {
		if (_flags[ptr] & ZOMBIE) return;
		_flags[ptr] |= ZOMBIE;
		_activeCount--;
		if (_zombieTail >= _maxNodes) sweep();
		_zombieQueue[_zombieTail++] = ptr;
	};

	function unlinkSibling(ptr) {
		const p = _parent[ptr];
		if (p === 0) return;
		let curr = _firstChild[p], prev = 0;
		while (curr !== 0) {
			if (curr === ptr) {
				if (prev === 0) _firstChild[p] = _nextSibling[curr];
				else            _nextSibling[prev] = _nextSibling[curr];
				break;
			}
			prev = curr; 
			curr = _nextSibling[curr];
		}
		_parent[ptr] = 0; _nextSibling[ptr] = 0;
	}

	function adopt(parent, child) {
		if (parent === 0 || child === 0 || parent === child) return;
		if (_parent[child] !== 0) unlinkSibling(child);
		_parent[child] = parent;
		const head = _firstChild[parent];
		_nextSibling[child] = head;
		_firstChild[parent] = child;
	}

	function disposeChildren(ptr) {
		let child = _firstChild[ptr];
		while (child !== 0) {
			const next = _nextSibling[child];
			_parent[child] = 0; disposeSlot(child); child = next;
		}
		_firstChild[ptr] = 0;
	}

	function disposeSlot(ptr) {

		if (ptr === 0 || (_flags[ptr] & ZOMBIE)) return; // 1. Bail immediately if invalid or already a zombie

		_flags[ptr] |= ZOMBIE; 	// 2. Mark the node as dead (Entity State)

		_activeCount--; // 3. Update the global ledger (Global State)

		let child = _firstChild[ptr];
		while (child !== 0) {
			const next = _nextSibling[child];
			_parent[child] = 0; 
			disposeSlot(child); 
			child = next;
		}

		_firstChild[ptr] = 0;
		unlinkSibling(ptr);

		const node = _pool[ptr];
		if (node !== null) {
			if (typeof node.ctx === 'function') {
				const prev = _activePtr; 
				_activePtr = 0;
				try { node.ctx(); } catch (_) {} finally { _activePtr = prev; }
			}
			node.ctx = null; node.fn = null; node.value = undefined;
		}

		cleanupEdges(ptr);

		// Clean subscribers
		let sub = _sigHead[ptr];
		while (sub !== 0) {
			const next    = _edgeNextSub[sub];
			const nodePtr = _edgeEffect[sub];
			let curr = _headDep[nodePtr], prevDep = 0;
			while (curr !== 0) {
				if (curr === sub) {
					if (prevDep === 0) _headDep[nodePtr] = _edgeNextDep[curr];
					else               _edgeNextDep[prevDep] = _edgeNextDep[curr];
					break;
				}
				prevDep = curr; 
				curr = _edgeNextDep[curr];
			}
			_edgeNextSub[sub] = _freeEdgeHead; _freeEdgeHead = sub;
			sub = next;
		}
		_sigHead[ptr] = 0; 
		_flags[ptr] = ZOMBIE; // intentional memory wipe
		_headDep[ptr] = _freeHead; 
		_freeHead = ptr;
	}

	function cleanupEdges(ptr) {
		let dep = _headDep[ptr];
		while (dep !== 0) {
			const nextDep = _edgeNextDep[dep];
			const sigPtr  = _edgeSignal[dep];
			const prev    = _edgePrevSub[dep];
			const next    = _edgeNextSub[dep];
			if (prev !== 0) _edgeNextSub[prev] = next;
			else            _sigHead[sigPtr]   = next;
			if (next !== 0) _edgePrevSub[next] = prev;
			_edgeNextSub[dep] = _freeEdgeHead; _freeEdgeHead = dep;
			dep = nextDep;
		}
		_headDep[ptr] = 0;
	}

	function track(sigPtr) {
		if (!_activePtr) return;
		let dep = _headDep[_activePtr];
		while (dep !== 0) {
			if (_edgeSignal[dep] === sigPtr) return;
			dep = _edgeNextDep[dep];
		}
		const e = allocEdge();
		_edgeEffect[e] = _activePtr; _edgeSignal[e] = sigPtr;
		const head = _sigHead[sigPtr];
		_edgeNextSub[e] = head; _edgePrevSub[e] = 0;
		if (head !== 0) _edgePrevSub[head] = e;
		_sigHead[sigPtr] = e;
		_edgeNextDep[e] = _headDep[_activePtr];
		_headDep[_activePtr] = e;
	}

	function trigger(sigPtr) {
		let edge = _sigHead[sigPtr], queuedAny = false;
		while (edge !== 0) {
			const nodePtr = _edgeEffect[edge];
			if (!(_flags[nodePtr] & (ZOMBIE | DIRTY))) {
				_flags[nodePtr] |= DIRTY;
				// Only push to the physical queue if the node is live and unfrozen.
				// DIRTY|FROZEN means "triggered while frozen" — setFrozen(false)
				// is solely responsible for the deferred push on resume.
				if (!(_flags[nodePtr] & FROZEN)) {
					_pendingQueue[(_pendingTail++) & (_maxNodes - 1)] = nodePtr;
					queuedAny = true;
				}
			}
			edge = _edgeNextSub[edge];
		}
		if (queuedAny && _batchDepth === 0 && !_isFlushing) flushQueue();
	}

	function flushQueue() {
		if (_isFlushing) return;
		_isFlushing = true;
		try {
			while (_pendingHead < _pendingTail) {
				const ptr = _pendingQueue[(_pendingHead++) & (_maxNodes - 1)];
				if (!(_flags[ptr] & DIRTY)) continue;   // benign duplicate — already ran, skip
				if (_flags[ptr] & FROZEN)   continue;   // re-frozen mid-flush — leave DIRTY intact
				_flags[ptr] &= ~DIRTY;
				if (!(_flags[ptr] & ZOMBIE)) {
					if (_flags[ptr] & YIELD) next(ptr);
					else runNode(ptr);
				}
			}
		} finally { _isFlushing = false; _pendingHead = 0; _pendingTail = 0; }
	}

	function recompute(ptr, fn) {
		cleanupEdges(ptr);
		if (_firstChild[ptr] !== 0) disposeChildren(ptr);
		_execStack[_stackDepth++] = (_activePtr = ptr);
		_flags[ptr] = (_flags[ptr] | RUNNING) & ~STALE;
		let res;
		try { res = fn(); } catch (e) { console.error('[Chimera] Computed error:', e); }
		finally {
			_activePtr = --_stackDepth ? _execStack[_stackDepth - 1] : 0;
			_flags[ptr] &= ~RUNNING;
		}
		return res;
	}

	function setFrozen(ptr, on) {
		if (on) { _flags[ptr] |= FROZEN; return; }
		_flags[ptr] &= ~FROZEN;
		// If DIRTY, the node was triggered while frozen and was never pushed
		// to the physical queue (trigger() guarantees this). Push it now.
		// setFrozen() is the sole deferred-push site — no double-entry risk
		// from trigger(), only from a freeze→resume inside a batch (benign,
		// handled by the DIRTY guard in flushQueue at O(1)).
		if (!(_flags[ptr] & DIRTY)) return;
		if (_flags[ptr] & YIELD) {
			next(ptr);
		} else {
			_pendingQueue[(_pendingTail++) & (_maxNodes - 1)] = ptr;
			if (_batchDepth === 0 && !_isFlushing) flushQueue();
		}
	}

	function deepProxy(target, sigPtr) {
		return new Proxy(target, {
			get(obj, key) {
				if (typeof key === 'symbol') return obj[key];
				track(sigPtr);
				const res = obj[key];
				return (typeof res === 'object' && res !== null) ? deepProxy(res, sigPtr) : res;
			},
			set(obj, key, value) { obj[key] = value; trigger(sigPtr); return true; },
			deleteProperty(obj, key) { delete obj[key]; trigger(sigPtr); return true; }
		});
	}

	return Chimera;

})(globalThis, Symbol.for('Chimera'), Symbol.for('Chimera:engine'));
