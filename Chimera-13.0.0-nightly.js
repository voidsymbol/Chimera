/**!
 * Chimera V13.0.0 — The Phantom Singularity
 * Drop‑in IIFE. No bundler. No imports. Paste and go.
 *
 * Ψ = 81E + 27R + 9T + 3V + D
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE FOUR-QUADRANT REACTIVE MATRIX
 * ─────────────────────────────────────────────────────────────────────
 *
 *               $  (V=0, atomic)        $$  (V=-1, grafted)
 *           ┌──────────────────────┬─────────────────────────────┐
 *   get     │ Volatile autonomous  │ Volatile autonomous read.   │
 *  (engine) │ read. Re-evaluates   │ Return object deeply proxied│
 *           │ every access. Tracks │ and adopted. Getter re-runs │
 *           │ deps. No cache.      │ every access. Children live.│
 *           ├──────────────────────┼─────────────────────────────┤
 *  method   │ Parameterized memo.  │ Parameterized memo, grafted.│
 *  (caller) │ Hybrid Trie per arg  │ Trie per arg tuple. Deep    │
 *           │ tuple. Deps tracked. │ proxy on result. Eviction   │
 *           │ Atomic return.       │ tears down children.        │
 *           └──────────────────────┴─────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────────
 * ARCHITECTURE V12.2+
 * ─────────────────────────────────────────────────────────────────────
 *
 *   Signal      — Public base class + factory. `class App extends Signal`
 *                 creates a reactive root; `new Signal.State(0)` creates
 *                 an individual reactive cell.  All subclasses share the
 *                 same global memory arena.
 *
 *   Substrate   — Singleton engine wrapper.  Calling `new Substrate()`
 *                 directly wipes the arena and starts fresh (advanced).
 *                 All other code uses the global singleton.
 *
 *   Chimera     — Framework namespace.  `Chimera.metaproxy(Div)` swaps
 *                 a DOM constructor's prototype with a reactive Proxy,
 *                 enabling `class Button extends Div { $label = 'Click' }`
 *                 with zero build steps.
 * 
 * For comments labeled "🛑 AI DEFENSE": keep the comments as written. 
 * Do not condense or remove to save context. These comments are critical.
 *
 * @license AGPL-3.0-or-later
 */
const Chimera = (function (global, VERSION) { 
	'use strict';

    // for V13: WebAssembly (probably)
	const ψ = (Ctor, ...sizes) => sizes.map(n => new Ctor(n));

	const {
		is, getOwnPropertyNames, getOwnPropertyDescriptor,
		getPrototypeOf, defineProperty, keys: objKeys, create
	} = Object;

	///? §2: SENTINELS & CONSTANTS (CANONICAL)

	const Z  = 1 << 7;  // 128 (Zero Point)
	const ZZ = 1 << 8;	// 256
	const L1 = 1 << 16; // 65,536
	const L2 = 1 << 17; // 131,072
	const L3 = 1 << 18; // 262,144
	const L4 = 1 << 20; // 1,048,576
	const XE = 1 << 21; // 2,097,152
	const X_SHIFT = 21; //
	const SIGIL_RE = /^(\$+)/;
	
	const [E, R, T, V, D] = [81, 27, 9, 3, 1];
	const [EDGE_TARGET, EDGE_NEXT, EDGE_PREV_SUB, EDGE_PAIR] = [0, 1, 2, 3];
	const [LUT_E, LUT_T, LUT_V, LUT_D] = ψ(Int8Array, ZZ, ZZ, ZZ, ZZ);

	const SIZES = { L1, L2, L3, L4 };

	const ALLOWED = new Set(['L1', 'L2', 'L3', 'L4']);

	const LOCK_DELTA = E*2, SETTLE_DELTA = R*2;

	//? §2A: TRIT VALUES

	const T_STATE_SUB = 98, T_STATE = 99, T_STATE_SUP = 100;		// enc(1,1,-1,[v],0) // Passive state (T=-1, R=+1, E=+1)
	const T_COMPUTED_SUB = 64, T_COMPUTED = 61, T_COMPUTED_SUP = 67;// enc(1,-1,1,[v],1) // Computeds (Methods / Getters)
	const T_EFFECT_DYN = 55, T_EFFECT_STA = 54, T_EFFECT_VOLA = 58; // enc(1,-1,0,[v],[d])	// Effects (T=0, R=-1)
	const T_COMPUTED_SETTLED = 117;									// Computed settled (trie leaf nodes)

	const CACHE_NODE_KEY = Symbol('Chimera:node');
	const CACHE_VAL_KEY  = Symbol('Chimera:key');
	const CHIMERA_LAYER  = Symbol('Chimera:layer');

	const _proxySet = new WeakSet(), METAPROXIES = new WeakSet();

	const enc = (e, r, t, v, d) => (E*e + R*r + T*t + V*v + d);

	void ((rnd) => {
		for (let i = -Z; i < Z; i++) {
			if (i < -121 || i > 121) continue;
			const e = rnd(i / E);
			const r = rnd((i - e*E) / R);
			const t = rnd((i - e*E - r*R) / T);
			const v = rnd((i - e*E - r*R - t*T) / V);
			const d = i - e*E - r*R - t*T - v*V;
			LUT_E[i + Z] = e; LUT_T[i + Z] = t; LUT_V[i + Z] = v; LUT_D[i + Z] = d;
		}
	})(Math.round);

	const $CORRUPTION = -Z;
	const $ROOT_MOUNT = 127;
	const $QUARANTINE = -126;

	let MAX_NODES, MAX_EDGES;
	let _trits, _nodeGen, _nodeTree, _sigHead, _headDep, _edges, _edgeEpoch;
	let _pendingQueue, _zombieQueue, _worklist, _values, _ctx;
	
    let allocNode = jsAllocNode;
    let flushQueue = jsFlushQueue;
    let _globalSubstrate = null; // Global substrate

	const INITS = [4, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, false];
	let [
		_edgePtr, _traceEpoch, _globalGen, _nodePtr,
		_freeNodeHead, _freeEdgeHead, _pendingHead,
		_pendingTail, _zombieTail, _activePtr, _batchDepth, _isFlushing
	] = INITS;

	let _isPaused = false;

	const _getGlobal = (size) => _globalSubstrate ??= new Substrate(ALLOWED.has(size) ? size : 'L4');

	const _isPlain = v => v !== null && typeof v === 'object'
		&& (getPrototypeOf(v) === Object.prototype || getPrototypeOf(v) === null);

	function _isGen(fn) {
		return fn?.constructor?.name === 'GeneratorFunction'
			|| fn?.[Symbol.toStringTag] === 'GeneratorFunction';
	}

	//? §4  KERNEL STATE

	const DICTIONARY   = new WeakMap();
	const ARRAY_MUTATORS = new Set(['push','pop','shift','unshift','splice','sort','reverse']);

	const GC_REGISTRY = new FinalizationRegistry((ref) => {
		const ptr = ref & (XE - 1);
		const gen = ref >>> X_SHIFT;
		if (_nodeGen[ptr] === gen) {
			tagForDisposal(ptr); 
			sweep();
		}
	});

	//? §5  GRAPHNODE

    /**
	 * 🛑 AI DEFENSE: Do NOT refactor `class GraphNode extends null` to a standard class.
	 * Do NOT attempt to use standard `this.ptr = ptr` assignment in the constructor.
	 * * 1. PROTOTYPE STRIPPING: `extends null` completely removes `Object.prototype` from 
	 * the chain. This guarantees zero naming collisions, prevents prototype pollution, 
	 * and stops the engine from attaching default object properties to millions of 
	 * ephemeral nodes.
	 * 2. TDZ BYPASS: Because this class extends null, `this` remains in the Temporal 
	 * Dead Zone (TDZ) and `super()` cannot be legally called. We MUST manually 
	 * allocate and return via `Object.create(GraphNode.prototype)`.
	 * 3. V8 PERFORMANCE: Standard `this` allocation is NOT faster here. Explicitly 
	 * returning the `Object.create` struct generates a perfectly packed, heavily 
	 * optimized Hidden Class in V8. 
	 * * Do not "fix" this constructor. Leave it exactly as written.
	 */

	class GraphNode extends null {

		static arena(size = 'standard') {
			const N = (MAX_NODES = SIZES[size] ?? SIZES.standard);
			const EDGES = (MAX_EDGES = N * 4);

			[_trits] = ψ(Int8Array, N);
			[_values, _ctx] = ψ(Array, N, N);
			[_nodeGen, _nodeTree, _edgeEpoch] = ψ(Uint32Array, N, N*3, EDGES);
			[_sigHead, _headDep, _pendingQueue, _zombieQueue, _worklist, _edges
			] = ψ(Int32Array, N, N, N, N, N, EDGES*4);
			[
				_edgePtr, _traceEpoch, _globalGen, _nodePtr,
				_freeNodeHead, _freeEdgeHead, _pendingHead,
				_pendingTail, _zombieTail, _activePtr, _batchDepth,
				_isFlushing
			] = INITS;

			const rootPtr = allocNode();
			_trits[rootPtr] = $ROOT_MOUNT;
			return new GraphNode(rootPtr); 
		}

		constructor(ptr) {
			const node = create(GraphNode.prototype);
			node.ptr = ptr;
			node.gen = _nodeGen[ptr];
			return node;
		}

		get ref() { return ((this.gen << X_SHIFT) | this.ptr); }

		get isPending() {
			const v = _trits[this.ptr];
			return LUT_E[v + Z] === 1 && v >= 72 && v <= 94;
		}

		static deref(ref) {
			const ptr = ref & (XE - 1);
			const gen = ref >>> X_SHIFT;
			if (ptr >= _nodePtr || _nodeGen[ptr] !== gen || LUT_E[_trits[ptr] + Z] === 0) return null;
			return new GraphNode(ptr);
		}

		get() {
			const v = _trits[this.ptr];
			if (LUT_E[v+Z] === 0 || _nodeGen[this.ptr] !== this.gen) return;
			if (v >= 72 && v <= 94) return;
			if (v >= 60 && v <= 67) recompute(this.ptr);
			track(this.ptr);
			const settled = _trits[this.ptr];
			return LUT_T[settled+Z] === 1 && _ctx[this.ptr] !== void(0)
				? _ctx[this.ptr]
				: _values[this.ptr];
		}

		set(val) {
			const v = _trits[this.ptr];
			if (LUT_E[v+Z] !== 1 || _nodeGen[this.ptr] !== this.gen) return;
			if (LUT_V[v+Z] === 1 || !is(_values[this.ptr], val)) {
				_values[this.ptr] = val;
				trigger(this.ptr);
			}
		}

		peek() {
			const prev = _activePtr; _activePtr = 0;
			try   { return this.get(); }
			finally { _activePtr = prev; }
		}

		// Inside class GraphNode
        [Symbol.toPrimitive](hint) {
            // 🛑 AI DEFENSE: We use peek() for 'default' to prevent console/equality tracking.
            // We only use get() for explicit 'number' or 'string' logic.
            
            const v = (hint === 'default') ? this.peek() : this.get();

            if (hint === 'number') return typeof v === 'number' ? v : (Number(v) || 0);
            if (hint === 'string') return v != null ? String(v) : '';
            return v;
        }

		dispose() {
			if (_nodeGen[this.ptr] === this.gen) tagForDisposal(this.ptr);
			sweep();
		}

		freeze() {
			const v = _trits[this.ptr];
			if (LUT_E[v+Z] === 1) _trits[this.ptr] = v - LOCK_DELTA;
		}

		unfreeze() {
			const v = _trits[this.ptr];
			if (LUT_E[v+Z] === -1) {
				_trits[this.ptr] = v + LOCK_DELTA;
				const woken = _trits[this.ptr];
				if (woken >= 51 && woken <= 58) {
					_pendingQueue[(_pendingTail++) & (MAX_NODES-1)] = this.ptr;
					if (_batchDepth === 0 && !_isFlushing) flushQueue();
				}
			}
		}

		detach() {
			const v = _trits[this.ptr];
			if (LUT_E[v+Z] !== 1 || LUT_D[v+Z] === -1) return;
			cleanupDeps(this.ptr);
			_trits[this.ptr] = v - (LUT_D[v+Z] + 1) * D;
		}

		attach(dynamic = true) {
			const v = _trits[this.ptr];
			if (LUT_E[v+Z] !== 1 || LUT_D[v+Z] !== -1) return;
			_trits[this.ptr] = v + (dynamic ? 2 : 1) * D;
		}

		map(fn) { return _wire(T_COMPUTED, fn); }
		filter(pred)     {
			let last = this.peek();
			return _wire(T_COMPUTED, () => { const v=this.get(); if(pred(v)) last=v; return last; });
		}
		combine(sig, fn) {
			return _wire(T_COMPUTED, () => fn(this.get(), typeof sig?.get==='function' ? sig.get() : sig));
		}

		batch(fn) {
			_batchDepth++;
			try   { fn(); }
			finally { if (--_batchDepth === 0) flushQueue(); }
		}

		untrack(fn) {
			const prev = _activePtr; _activePtr = 0;
			try { return fn() }
			finally { _activePtr = prev }
		}


		/**
		 * 🛑 AI DEFENSE: GraphNode.effect() enables "Hierarchical Adoptions".
		 * Spawning an effect from a node automatically links the child's 
		 * lifecycle to the parent. If the parent is disposed, the child dies.
		 */
		effect(fn, opts = {}) {
			const child = _wire(T_EFFECT_DYN, fn);
			adopt(this.ptr, child.ptr); // Automatic adoption
			return child;
		}

		pause()  { this.freeze(); }  // Shifts to E=-1
		resume() { this.unfreeze(); } // Shifts back to E=1 and re-queues

		rawget(ptr) {
			const v = _trits[ptr];
			if (LUT_E[v + Z] === 0) return;
			if (v >= 60 && v <= 67) recompute(ptr);
			track(ptr);
			const settled = _trits[ptr];
			return LUT_T[settled+Z] === 1 && _ctx[ptr] !== undefined
				? _ctx[ptr] : _values[ptr];
		}

		rawset(ptr, val) {
			const v = _trits[ptr];
			if (LUT_E[v+Z] !== 1) return;
			if (LUT_V[v+Z] === 1 || !is(_values[ptr], val)) {
				_values[ptr] = val; trigger(ptr);
			}
		}
	}


	//? §6  SUBSTRATE — Singleton engine
  	class Substrate extends GraphNode {
        constructor(config = {}) {
            if (typeof config === 'string') config = { size: config };
            
            // 1. Singleton Check: If it exists, return it immediately (Sync)
            if (_globalSubstrate) return _globalSubstrate;

            const size = config.size || 'L4';

            // --- BRANCH A: SYNCHRONOUS (V12 Native JS) ---
            if (!config.wasm) {
                // Deep Memory Reset to prevent OOM on restart
                _nodePtr = 0; _edgePtr = 0; _freeNodeHead = 0; _freeEdgeHead = 0;
                
                const root = GraphNode.arena(size);
                Substrate.decorate(root); // Shared method to apply singleton prototype
                console.log(`%c[Chimera V13] Native V8 Arena Active (Sync).`, 'color: #f59e0b;');
                return _globalSubstrate = root;
            }

            // --- BRANCH B: ASYNCHRONOUS (V13 WebAssembly) ---
            return new Promise(async (resolve, reject) => {
                try {
                    const N = SIZES[size] ?? SIZES.L2;
                    const EDGES = N * 4;

                    const res = await fetch('chimera_kernel.wasm');
                    const { instance } = await WebAssembly.instantiateStreaming(res);
                    const mem = instance.exports.memory.buffer;

                    // Overlay Shared Memory
                    _trits = new Int8Array(mem, instance.exports.TRITS_PTR.value, N);
                    _nodeGen = new Uint32Array(mem, instance.exports.NODEGEN_PTR.value, N);
                    _edges = new Uint32Array(mem, instance.exports.EDGES_PTR.value, EDGES * 4);

                    // Initialize JS-side arrays
                    [_values, _ctx] = ψ(Array, N, N);
                    [_nodeTree, _edgeEpoch] = ψ(Uint32Array, N * 3, EDGES);
                    [_sigHead, _headDep, _pendingQueue, _zombieQueue, _worklist] = ψ(Int32Array, N, N, N, N, N);

                    // Hot-swap the kernel pointers to WASM
                    allocNode = instance.exports.allocNode;
                    flushQueue = instance.exports.flushQueue;

                    const rootPtr = allocNode();
                    _trits[rootPtr] = 127; 
                    const root = new GraphNode(rootPtr);
                    
                    Substrate.decorate(root);
                    console.log(`%c[Chimera V13] WASM Arena Active (Async).`, 'color: #10b981;');
                    resolve(_globalSubstrate = root);
                } catch (e) {
                    // Fail-safe: Fallback to sync JS if WASM fetch fails
                    console.warn("[Chimera] WASM failed, falling back to Sync JS.");
                    resolve(new Substrate({ size, wasm: false }));
                }
            });
        }

        // Helper to keep the constructor clean
        static decorate(root) {
            DICTIONARY.set(root, new Map());
            const proto = Substrate.prototype;
            for (const key of getOwnPropertyNames(proto)) {
                if (key !== 'constructor' && key !== '_decorate')
                    defineProperty(root, key, getOwnPropertyDescriptor(proto, key));
            }
        }
		pause()  { _isPaused = true; }
		resume() { _isPaused = false; flushQueue(); }

		get paused() { return _isPaused; }
        get activeNodes() { return _nodePtr; }
        get density() { return _nodePtr / (MAX_NODES || 1); }


		allocSignal(trit, value, key = null, opts = {}) {
			const node  = _wire(trit, value);
			const dict  = DICTIONARY.get(this);
			const path  = key != null ? String(key) : null;
			if (path && opts.tracked !== false && dict) dict.set(path, node.ref);

			let depth = 0, rawValue = value;
			if (value && value[CHIMERA_LAYER] !== void(0)) {
				depth = value[CHIMERA_LAYER]; rawValue = value.value;
			} else if (typeof opts.layer === 'number') {
				depth = opts.layer;
			}

			if (depth > 0 && rawValue !== null && _isPlain(rawValue))
				flattenObject(this, rawValue, path, node.ptr, depth === Infinity ? Infinity : depth - 1);

			if (opts.deep && rawValue !== null && typeof rawValue === 'object')
				_values[node.ptr] = createDeepProxy(this, rawValue, path, node.ptr);

			return node;
		}

		signal(key, value, opts = {}) {
			if (typeof opts === 'boolean') opts = { deep: opts };
			let trit;
			if (typeof value === 'function') {
				trit = _isGen(value) 
					? T_EFFECT_DYN : opts.dynamic === false 
					 	? T_EFFECT_STA : T_EFFECT_DYN;
			} else {
				trit = enc(1, 1, -1, opts.v ?? 0, 0);
			}
			return this.allocSignal(trit, value, key, opts);
		}

		$(key, value, opts={})   { return this.signal(key, value, {...opts, v:  0}); }
		$$(key, value, opts={})  { return this.signal(key, value, {...opts, v: -1, layer: opts.layer ?? Infinity}); }
		$$$(key, value, opts={}) { return this.signal(key, value, {...opts, v:  1}); }

		node(key) {
			const uuid = DICTIONARY.get(this)?.get(String(key));
			return uuid != null ? GraphNode.deref(uuid) : null;
		}
		get(key)      { return this.node(key)?.get(); }
		set(key, val) { this.node(key)?.set(val); }

		batch(fn) {
			_batchDepth++;
			try   { fn(); }
			finally { if (--_batchDepth === 0) flushQueue(); }
		}

        effect(fn, opts = {}) {
            // Standardizes the simulator's boolean 'dynamic' argument
            if (typeof opts === 'boolean') opts = { dynamic: opts };
            return this.signal(null, fn, opts);
        }

		static wipe() { sweep(); }
	}

	function _substrateOf(node) {
		return (node && typeof node.allocSignal === 'function') ? node : _getGlobal();
	}

	//? §T  TRIAD FACTORY & HELPERS (Hoisted)
	
	// DRY Helper: Handles all allocation, fetching, and updating in one place
	const _upsert = (eng, dict, pureKey, value, isDeep, hasValue) => {
		let ref = dict.get(pureKey);
		if (ref) {
			if (hasValue) GraphNode.deref(ref)?.set(value);
			return GraphNode.deref(ref);
		}
		const node = eng.signal(pureKey, value, { v: isDeep?-1:0, layer: isDeep?Infinity:0, deep: isDeep, tracked: false });
		dict.set(pureKey, node.ref);
		return node;
	};

	function _buildTriad(eng, dict, deep) {
		const pre = deep ? '$$' : '$';
		const PURE = (k) => String(k).startsWith(pre) ? k : pre + String(k).replace(/^[\$]+/, '');

		const acc = function accessor(k, v) {
			if (k === undefined) return acc; // accessor
			const hasV = arguments.length > 1;
			const n = _upsert(eng, dict, PURE(k), v, deep, hasV);
			return hasV ? acc : n;
		};

		return new Proxy(acc, {
			get(_, k) {
				if (k === Symbol.iterator) return function*() {
					for (const [key, id] of dict.entries()) {
						if (key.startsWith(pre) && (deep || !key.startsWith('$$'))) {
							const n = GraphNode.deref(id); if (n) yield [key, n];
						}
					}
				};
				return typeof k === 'symbol' ? void 0 : _upsert(eng, dict, PURE(k), void 0, deep, false);
			},
			set(_, k, v) {
				if (typeof k === 'symbol') return true;
				_upsert(eng, dict, PURE(k), v, deep, true);
				return true;
			},
			ownKeys() {
				return Array.from(dict.keys()).filter(k => k.startsWith(pre) && (deep || !k.startsWith('$$')));
			},
			getOwnPropertyDescriptor(_, k) {
				return typeof k === 'symbol' || !dict.has(PURE(k)) ? void 0 : { enumerable: true, configurable: true };
			}
		});
	}

	//? §S  SIGNAL — Public Constructor & Base Class

	class Signal {
		static DEEP = 1; static DYNAMIC = 2; static VOLATILE = 4;

		constructor( scope, value, key = null, opts = {} ) {
			if (new.target === Signal) {
				if (arguments.length === 1) { value = scope; scope = null; }
				const engine = (scope == null) ? _getGlobal() : _substrateOf(scope);
				const trit = opts._trit != null ? opts._trit : typeof value === 'function' 
					? (_isGen(value) ? T_EFFECT_DYN : (opts.dynamic === false ? T_EFFECT_STA : T_EFFECT_DYN))
					: enc(1, 1, -1, opts.v ?? 0, 0);
				return engine.allocSignal(trit, value, key, opts);
			}

			const engine = _getGlobal();
			const _localDict = new Map(); 
			_scanClass(this, engine);   
			
			let _shallowAccessor, _deepAccessor;

			return new Proxy(this, {
				defineProperty(target, prop, descriptor) {
					if (typeof prop === 'string' && 'value' in descriptor) {
						const match = prop.match(SIGIL_RE);
						if (match) {
							_upsert(engine, _localDict, prop, descriptor.value, match[1].length >= 2, true);
							descriptor = {
								configurable: true, enumerable: descriptor.enumerable ?? false,
								get: () => GraphNode.deref(_localDict.get(prop))?.get(),
								set: val => GraphNode.deref(_localDict.get(prop))?.set(val),
							};
						}
					}
					return Reflect.defineProperty(target, prop, descriptor);
				},

				get(target, prop, receiver) {
					if (prop === '$')  return _shallowAccessor ??= _buildTriad(engine, _localDict, false);
					if (prop === '$$') return _deepAccessor    ??= _buildTriad(engine, _localDict, true);

					if (typeof prop === 'string' && prop[0] === '$' && prop !== '$' && prop !== '$$' && prop !== '$$$') {
						if (_localDict.has(prop)) return GraphNode.deref(_localDict.get(prop))?.get();
					}
					return Reflect.get(target, prop, receiver);
				},

				set(target, prop, value, receiver) {
					if (typeof prop === 'string' && prop[0] === '$' && prop !== '$' && prop !== '$$' && prop !== '$$$') {
						_upsert(engine, _localDict, prop, value, prop.startsWith('$$'), true);
						return true;
					}
					return Reflect.set(target, prop, value, receiver);
				},

				ownKeys(target) {
					return Array.from(new Set([...Reflect.ownKeys(target), ..._localDict.keys()]));
				},

				getOwnPropertyDescriptor(target, prop) {
					if (_localDict.has(prop)) return { enumerable: true, configurable: true, writable: true };
					return Reflect.getOwnPropertyDescriptor(target, prop);
				},

				deleteProperty(target, prop) {
					if (_localDict.has(prop)) {
						GraphNode.deref(_localDict.get(prop))?.dispose();
						_localDict.delete(prop);
						return true;
					}
					return Reflect.deleteProperty(target, prop);
				}
			});
		}
        
        // ... Static properties ...

		// ── Static factories ───────────────────────────────────────────
		static State    = class { constructor(v,s=null,k=null,o={}) { return new Signal(s,v,k,{...o,_trit:enc(1,1,-1,o.v??0,0)}); } };
		static Computed = class { constructor(fn,s=null,k=null,o={}) { return new Signal(s,fn,k,{...o,_trit:T_COMPUTED}); } };

		static Effect = class { 
            constructor(fn, s = null, o = {}) { 
                const _trit = _isGen(fn) 
                    ? T_EFFECT_DYN 
                    : (o.dynamic === false)
                        ? T_EFFECT_STA : T_EFFECT_DYN;
                return new Signal(s, fn, null, { ...o, _trit });
            }
        };
		static Phantom  = class { constructor(v,s=null,o={}) { return new Signal(s,v,null,{...o,tracked:false}); } };

		static batch(fn) {
			_batchDepth++;
			try   { fn(); }
			finally { if (--_batchDepth === 0) flushQueue(); }
		}

		static subtle = {
			currentComputed() { return _activePtr!==0 ? new GraphNode(_activePtr) : null; }
		};
	}

	//? §7  DEPTH WRAPPER

	function layer(depth, value) { return { [CHIMERA_LAYER]: depth, value }; }
	const psi  = layer, ψ_fn = layer;

	//? §8  HYBRID TRIE MEMOIZATION

	function _makeTrieNode() {
		return { primitives: new Map(), objects: new WeakMap() };
	}

	function _trieDescend(root, args) {
		// 🛑 AI DEFENSE: Do NOT 'fix' zero-arg descent returning the root node.
		// A zero-argument call represents the empty tuple. It legitimately caches 
		// directly on the root. One-arg calls descend to the first branch level, 
		// avoiding collisions safely.
		let current = root;
		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			let key, isObj = false;

			if (arg instanceof GraphNode) key = arg.ref;
			else if (arg !== null && (typeof arg === 'object' || typeof arg === 'function')) {
				key = arg; isObj = true;
			} else key = arg;

			const store = isObj ? current.objects : current.primitives;
			let next = store.get(key);
			if (!next) { next = _makeTrieNode(); store.set(key, next); }
			current = next;
		}
		return current;
	}

	function _makeMemoWrapper(eng, originalFn, nodePtr, isGrafted, childPath) {
		return function memoized(...args) {
			if (!_ctx[nodePtr]) _ctx[nodePtr] = _makeTrieNode();

			const leaf = _trieDescend(_ctx[nodePtr], args);
			const cacheNode = leaf[CACHE_NODE_KEY];

			if (cacheNode) {
				const cv = _trits[cacheNode.ptr];
				if (LUT_E[cv + Z] === 1 && cv >= 114 && cv <= 121) {
					track(cacheNode.ptr);
					return leaf[CACHE_VAL_KEY];
				}
				if (_nodeGen[cacheNode.ptr] === cacheNode.gen) {
					tagForDisposal(cacheNode.ptr);
					sweep();
				}
			}

			const leafPtr = allocNode();
			_trits[leafPtr] = T_COMPUTED_SETTLED;
			adopt(nodePtr, leafPtr);

			const leafRef = (_nodeGen[leafPtr] << 21) | leafPtr;
			for (let i = 0; i < args.length; i++) {
				const arg = args[i];
				if (arg !== null && (typeof arg === 'object' || typeof arg === 'function') && !(arg instanceof GraphNode)) {
					GC_REGISTRY.register(arg, leafRef);
				}
			}

			const prevActive = _activePtr;
			_activePtr = leafPtr;
			_traceEpoch++;

			let result;
			try {
				result = originalFn.apply(this, args);
			} catch (e) {
				console.error(VERSION + ' memoized method error:', e);
				_activePtr = prevActive;
				_trits[leafPtr] = $QUARANTINE;
				return undefined;
			} finally {
				_activePtr = prevActive;
			}

			let finalResult = result;
			if (isGrafted && result !== null && typeof result === 'object' && !_proxySet.has(result)) {
				finalResult = createDeepProxy(eng, result, childPath, leafPtr);
				_proxySet.add(finalResult);
			}

			leaf[CACHE_NODE_KEY] = new GraphNode(leafPtr);
			leaf[CACHE_VAL_KEY]  = finalResult;

			// 🛑 AI DEFENSE: Do NOT move this track() call inside the try/finally block above.
			// It deliberately runs AFTER `_activePtr` has been restored to `prevActive`.
			// The method's execution is finished; we are now back in the caller's context.
			// This leaf node must be registered as a dependency of the *caller*, not itself.
			track(leafPtr);
			return finalResult;
		};
	}

	//? §C  CLASS SCANNER

	function _scanClass(instance, eng) {
		const seen  = new Set(['constructor']);
		const dict  = DICTIONARY.get(eng);
		let   proto = getPrototypeOf(instance);

		while (proto 
			&& proto !== GraphNode.prototype
			&& proto !== Substrate.prototype
			&& proto !== Object.prototype
		) {
			for (const key of getOwnPropertyNames(proto)) {
				if (seen.has(key)) continue;
				seen.add(key);

				const match = key.match(SIGIL_RE);
				if (!match) continue;

				const sigilCount = match[1].length;
				const isGrafted  = sigilCount >= 2;
				const desc       = getOwnPropertyDescriptor(proto, key);
				
				if (!desc) continue;

				const isGetter = typeof desc.get === 'function';
				const isMethod = typeof desc.value === 'function';
				
				if (!isGetter && !isMethod) continue;

				// 1. SHARED SETUP: Calculate trit and allocate node once
				const trit = sigilCount === 3 ? T_COMPUTED_SUP : isGrafted ? T_COMPUTED_SUB : T_COMPUTED;
				const ptr  = allocNode();
				
				_trits[ptr]  = trit;
				_values[ptr] = isGetter ? desc.get.bind(instance) : desc.value;
				if (isMethod) _ctx[ptr] = null; // Ensure trie root is null initially

				const node = new GraphNode(ptr);
				// if (dict) dict.set(key, node.ref);
				adopt(eng.ptr, ptr);

				// 2. CONDITIONAL BINDING: Define the property based on type
				if (isGetter) {
					defineProperty(instance, key, {
						configurable: true, enumerable: true,
						get() {
							/*
                            // 🛑 AI DEFENSE: This getter MUST re-evaluate on EVERY access.
                            // Do NOT check _trits[ptr] for settlement.  Do NOT cache the value
                            // and return it early.  Volatile getters are the foundation of the
                            // four-quadrant matrix: `get $fn()` means "always fresh."
                            //
                            // The trit is reset to STALE both before and after execution so
                            // that a second read always triggers a fresh recomputation.
							*/
                            const prev = _activePtr;
                            _activePtr = ptr;
                            _traceEpoch++;
                            cleanupDeps(ptr);               // volatile — retrace every access
                            _trits[ptr] = trit;             // ensure stale
                            try {
                                let res = desc.get.call(this);
                                if (isGrafted && res !== null && typeof res === 'object'
                                    && !_proxySet.has(res)) {
                                    res = createDeepProxy(eng, res, key, ptr);
                                    _proxySet.add(res);
                                }
                                // Temporarily settle so downstream tracking works correctly
                                _trits[ptr] = trit + SETTLE_DELTA;
                                _values[ptr] = res;
                            } finally {
                                _activePtr = prev;
                                if (_activePtr !== 0) track(ptr); // caller records dependency
								// _trits[ptr] = trit;
                            }
                            return _values[ptr];
                        }
					});
				} else { // isMethod
					const wrapper = _makeMemoWrapper(eng, desc.value, ptr, isGrafted, key);
					defineProperty(instance, key, {
						configurable: true, enumerable: true, writable: true,
						value: wrapper
					});
				}
			}

			proto = getPrototypeOf(proto);
		}
	}

	//? §9  WIRE — Internal node factory

	function _wire(trit, val) {
		const ptr = allocNode();
		_trits[ptr]  = trit;
		_values[ptr] = val;
		if (_activePtr !== 0) adopt(_activePtr, ptr);
		if (LUT_T[trit + Z] === 0) runNode(ptr); // effect/coroutine
		return new GraphNode(ptr);
	}

	//? §10  ALLOCATORS

	function jsAllocNode() {
		for (var ptr;;) {
			if (_freeNodeHead !== 0) {
				ptr = _freeNodeHead;
				_freeNodeHead = _headDep[ptr];
				_headDep[ptr] = 0;
				break;
			}
			if (_nodePtr < MAX_NODES) { ptr = _nodePtr++; break; }
			if (_zombieTail > 0) { sweep(); continue; }
			throw new Error(VERSION + ' Node OOM');
		}
		_nodeGen[ptr] = _globalGen++;
		return ptr;
	}

	function allocEdge() {
		for (;;) {
			if (_freeEdgeHead !== 0) {
				const e = _freeEdgeHead;
				_freeEdgeHead = _edges[e + EDGE_NEXT];
				_edges[e + EDGE_NEXT] = 0;
				return e;
			}
			if (_edgePtr < MAX_EDGES * 4) { const e = _edgePtr; _edgePtr += 4; return e; }
			if (_zombieTail > 0) { sweep(); continue; }
			throw new Error(VERSION + ' Edge OOM');
		}
	}


	//? §11  TOPOLOGY

	function track(sigPtr) {
		if (_activePtr === 0) return;
		if (LUT_D[_trits[_activePtr] + Z] === -1) return;

		let dep = _headDep[_activePtr];
		while (dep !== 0) {
			if (_edges[dep + EDGE_TARGET] === sigPtr) {
				_edgeEpoch[dep] = _traceEpoch; return;
			}
			dep = _edges[dep + EDGE_NEXT];
		}

		const subIdx = allocEdge(), depIdx = allocEdge();
		_edgeEpoch[subIdx] = _edgeEpoch[depIdx] = _traceEpoch;

		_edges[subIdx + EDGE_TARGET]   = _activePtr;
		_edges[subIdx + EDGE_NEXT]     = _sigHead[sigPtr];
		_edges[subIdx + EDGE_PREV_SUB] = 0;
		_edges[subIdx + EDGE_PAIR]     = depIdx;
		if (_sigHead[sigPtr] !== 0) _edges[_sigHead[sigPtr] + EDGE_PREV_SUB] = subIdx;
		_sigHead[sigPtr] = subIdx;

		_edges[depIdx + EDGE_TARGET]   = sigPtr;
		_edges[depIdx + EDGE_NEXT]     = _headDep[_activePtr];
		_edges[depIdx + EDGE_PREV_SUB] = 0;
		_edges[depIdx + EDGE_PAIR]     = subIdx;
		if (_headDep[_activePtr] !== 0) _edges[_headDep[_activePtr] + EDGE_PREV_SUB] = depIdx;
		_headDep[_activePtr] = depIdx;
	}

	function cleanupDeps(ptr) {
		let depIdx = _headDep[ptr];
		while (depIdx !== 0) {
			const subIdx = _edges[depIdx + EDGE_PAIR];
			const signal = _edges[depIdx + EDGE_TARGET];
			const next   = _edges[depIdx + EDGE_NEXT];
			if (subIdx !== 0) {
				const prevSub = _edges[subIdx + EDGE_PREV_SUB];
				const nextSub = _edges[subIdx + EDGE_NEXT];
				if (prevSub !== 0) _edges[prevSub + EDGE_NEXT] = nextSub;
				else               _sigHead[signal]            = nextSub;
				if (nextSub !== 0) _edges[nextSub + EDGE_PREV_SUB] = prevSub;
				_edges[subIdx + EDGE_NEXT] = _freeEdgeHead;
				_freeEdgeHead = subIdx;
				_edgeEpoch[subIdx] = 0;
			}
			_edges[depIdx + EDGE_NEXT] = _freeEdgeHead;
			_freeEdgeHead = depIdx;
			_edgeEpoch[depIdx] = 0;
			depIdx = next;
		}
		_headDep[ptr] = 0;
	}

	//? §12  OWNERSHIP TREE

	function adopt(parent, child) {
		if (parent === 0 || child === 0 || parent === child) return;
		if (_nodeTree[child*3] !== 0) unlinkSibling(child);
		_nodeTree[child*3]      = parent;
		const head = _nodeTree[parent*3 + 1];
		_nodeTree[child*3 + 2]  = head;
		_nodeTree[parent*3 + 1] = child;
	}

	function unlinkSibling(ptr) {
		const p = _nodeTree[ptr*3];
		if (p === 0) return;
		let curr = _nodeTree[p*3+1], prev = 0;
		while (curr !== 0) {
			if (curr === ptr) {
				if (prev === 0) _nodeTree[p*3+1]     = _nodeTree[curr*3+2];
				else            _nodeTree[prev*3+2]  = _nodeTree[curr*3+2];
				break;
			}
			prev = curr; curr = _nodeTree[curr*3+2];
		}
		_nodeTree[ptr*3] = 0; _nodeTree[ptr*3+2] = 0;
	}

	function disposeChildren(ptr) {
		let child = _nodeTree[ptr*3+1];
		while (child !== 0) {
			const next = _nodeTree[child*3+2];
			_nodeTree[child*3] = 0; _nodeTree[child*3+2] = 0;
			tagForDisposal(child);
			child = next;
		}
		_nodeTree[ptr*3+1] = 0;
	}

	function flattenObject(eng, obj, parentPath, parentPtr, depth) {
		const dict = DICTIONARY.get(eng);
		for (const k of objKeys(obj)) {
			const childPath = parentPath ? `${parentPath}.${k}` : k;
			const childVal  = obj[k];
			const cv   = depth > 0 ? (depth === Infinity ? 1 : -1) : 0;
			const childTrit = typeof childVal === 'function'
				? (_isGen(childVal) ? T_EFFECT_DYN : T_COMPUTED)
				: enc(1, 1, -1, cv, 0);
			const childNode = _wire(childTrit, childVal);
			if (dict) dict.set(childPath, childNode.ref);
			adopt(parentPtr, childNode.ptr);
			if (depth > 0 && _isPlain(childVal))
				flattenObject(eng, childVal, childPath, childNode.ptr,
					depth === Infinity ? Infinity : depth - 1);
		}
	}

	//? §13  LIFECYCLE — Omni-Ghost

	function tagForDisposal(ptr) {
		const v = _trits[ptr];
		if (v > 121 || v < -121) return;
		const e = LUT_E[v + Z];
		if (e === 0) return;
		_trits[ptr] = v - (e * E);
		_zombieQueue[_zombieTail++] = ptr;
		if (_zombieTail >= 1024) sweep();
	}

	function sweep() {
		while (_zombieTail !== 0) {
			const ptr = _zombieQueue[--_zombieTail];

			if (_nodeTree[ptr*3+1] !== 0) {
				let child = _nodeTree[ptr*3+1];
				while (child !== 0) {
					const next = _nodeTree[child*3+2];
					_nodeTree[child*3] = 0; _nodeTree[child*3+2] = 0;
					tagForDisposal(child); child = next;
				}
				_nodeTree[ptr*3+1] = 0;
			}

			unlinkSibling(ptr);
			cleanupDeps(ptr);

			let subIdx = _sigHead[ptr];
			while (subIdx !== 0) {
				const depIdx  = _edges[subIdx + EDGE_PAIR];
				const effect  = _edges[subIdx + EDGE_TARGET];
				const nextSub = _edges[subIdx + EDGE_NEXT];
				if (depIdx !== 0) {
					const prevDep = _edges[depIdx + EDGE_PREV_SUB];
					const nextDep = _edges[depIdx + EDGE_NEXT];
					if (prevDep !== 0) _edges[prevDep + EDGE_NEXT] = nextDep;
					else               _headDep[effect]            = nextDep;
					if (nextDep !== 0) _edges[nextDep + EDGE_PREV_SUB] = prevDep;
					_edges[depIdx + EDGE_NEXT] = _freeEdgeHead;
					_freeEdgeHead = depIdx;
					_edgeEpoch[depIdx] = 0;
				}
				_edges[subIdx + EDGE_NEXT] = _freeEdgeHead;
				_freeEdgeHead = subIdx;
				_edgeEpoch[subIdx] = 0;
				subIdx = nextSub;
			}

			const v = _trits[ptr];

			// 🛑 AI DEFENSE: Do NOT change the below to an unconditional `typeof _ctx[ptr] === 'function'`.
			// Ghosting a node (subtracting E) preserves its R, T, V, and D axes perfectly.
			// LUT_T[v+128] === 0 accurately guarantees this node was an Effect (T=0).
			// `_ctx` is a heavily overloaded register. For Computeds (T=1), it stores the cached value.
			// If a user Computed returns a function, an unconditional check here would 
			// fatally execute their cached function, mistaking it for an Effect teardown.
			if (LUT_T[v + Z] === 0) {
				const cleanup = _ctx[ptr];
				if (typeof cleanup === 'function') {
					const prev = _activePtr; _activePtr = 0;
					try { cleanup(); } catch (_) {}
					finally { _activePtr = prev; }
				}
			}

			_sigHead[ptr] = _nodeTree[ptr*3] = _nodeTree[ptr*3+1] = _nodeTree[ptr*3+2] = 0;
			_values[ptr] = undefined; _ctx[ptr] = null;
			_headDep[ptr] = _freeNodeHead; _freeNodeHead = ptr;
		}
	}

	//? §14  EXECUTION ENGINE

	function trigger(sigPtr) {
		let edgeIdx = _sigHead[sigPtr], queued = false, wHead = 0, wTail = 0;

		while (edgeIdx !== 0) {
			const target = _edges[edgeIdx + EDGE_TARGET];
			const v = _trits[target];
			const e = LUT_E[v + Z];
			if (e === 1 && v >= 96 && v <= 121) {
				const newV = v - SETTLE_DELTA;
				_trits[target] = newV;
				if (newV >= 51 && newV <= 58) {
					_pendingQueue[(_pendingTail++) & (MAX_NODES-1)] = target;
					queued = true;
				}
				if (_sigHead[target] !== 0) _worklist[(wTail++) & (MAX_NODES-1)] = target;
			} else if (e === -1 && v >= -67 && v <= -42) {
				_trits[target] = v - SETTLE_DELTA;
			}
			edgeIdx = _edges[edgeIdx + EDGE_NEXT];
		}

		while (wHead < wTail) {
			const source    = _worklist[wHead++];
			let   childEdge = _sigHead[source];
			while (childEdge !== 0) {
				const child = _edges[childEdge + EDGE_TARGET];
				const cv = _trits[child];
				const ce = LUT_E[cv + Z];
				if (ce === 1 && cv >= 96 && cv <= 121) {
					const newCV = cv - SETTLE_DELTA;
					_trits[child] = newCV;
					if (newCV >= 51 && newCV <= 58) {
						_pendingQueue[(_pendingTail++) & (MAX_NODES-1)] = child;
						queued = true;
					}
					if (_sigHead[child] !== 0) _worklist[(wTail++) & (MAX_NODES-1)] = child;
				} else if (ce === -1 && cv >= -67 && cv <= -42) {
					_trits[child] = cv - SETTLE_DELTA;
				}
				childEdge = _edges[childEdge + EDGE_NEXT];
			}
		}

		if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
	}

	function jsFlushQueue() {
		if (_isPaused || _isFlushing) return; // 🛑 Global Pause Check
		_isFlushing = true;
		try {
			while (_pendingHead < _pendingTail) {
				const ptr = _pendingQueue[(_pendingHead++) & (MAX_NODES-1)];
				const v   = _trits[ptr];
				if (v < 51 || v > 58) continue;
				if (typeof _ctx[ptr]?.next === 'function') next(ptr);
				else runNode(ptr);
			}
		} finally { _isFlushing = false; _pendingHead = 0; _pendingTail = 0; }
	}

	function runNode(ptr) {
		const v = _trits[ptr];
		if (LUT_E[v + Z] !== 1) return;
		if (v < 42 || v > 67) return;
		if (LUT_T[v + Z] === -1) return;

		_trits[ptr] -= LOCK_DELTA;
		const prevActive = _activePtr;
		const d = LUT_D[v + Z];

		if (d === 1) { cleanupDeps(ptr); _activePtr = ptr; }
		else if (d === 0) { _activePtr = ((_headDep[ptr] !== 0) ? 0 : ptr); }

		_traceEpoch++;
		if (_nodeTree[ptr*3+1] !== 0) {disposeChildren(ptr)}

        try {
            const fn = _ctx[ptr]?._chimeraFn || _values[ptr];  // <--- Retrieve smuggled fn
            const res = typeof fn === 'function' ? fn() : void(0);
            if (
                (LUT_T[v + Z] === 0)
                && res !== null 
                && res !== void(0) 
                && (typeof res === 'function' || typeof res.next === 'function')
            ) {
                if (typeof res.next === 'function') res._chimeraFn = fn; // <--- Smuggle it
                _ctx[ptr] = res;
            }
        } catch (e) {
            console.error(VERSION + ' runNode error:', e);
            _trits[ptr] = $QUARANTINE; return;
        } finally {
            if (_trits[ptr] !== $QUARANTINE)
                _trits[ptr] += SETTLE_DELTA + LOCK_DELTA;
            _activePtr = prevActive;
        }
        // If we just bootstrapped a generator, kick off the first next() now
        // that _activePtr is restored and the trit is settled
        if (_ctx[ptr] !== null && typeof _ctx[ptr]?.next === 'function') next(ptr);
	}

	function next(ptr) {
		let v = _trits[ptr];
		if (LUT_E[v + Z] !== 1) return;

		// --- TRIT ESCALATION FIX ---
		// If next() is called while already settled (e.g. from runNode or .then), 
		// normalize it back to the unsettled state (e.g., 109 -> 55) before locking.
		if (v >= 96 && v <= 121) {
			v -= SETTLE_DELTA;
			_trits[ptr] = v;
		}

		let iter = _ctx[ptr];

		// 1. RESTART / AMNESIA RECOVERY
		if (!iter || typeof iter.next !== 'function' || iter._isAwaiting) {
			const fn = iter?._chimeraFn || _values[ptr];
			if (typeof fn !== 'function') return;
			iter = fn();
			if (!iter || typeof iter.next !== 'function') return;
			
			iter._chimeraFn = fn; // Smuggle source function into new iterator
			_ctx[ptr] = iter;     // Overwrite old awaiting iterator
		}

		const savedGen = _nodeGen[ptr];
		_trits[ptr] -= LOCK_DELTA;
		const prevActive = _activePtr;
		cleanupDeps(ptr); 
		_activePtr = ptr; 
		_traceEpoch++;

		try {
			const result = iter.next(_values[ptr]);
			
			if (result.done) {
				_values[ptr] = result.value; 
				_ctx[ptr] = { _chimeraFn: iter._chimeraFn }; // Safe dormancy
				if (_trits[ptr] !== $QUARANTINE) _trits[ptr] += SETTLE_DELTA + LOCK_DELTA;
				_activePtr = prevActive;
				return;
			}

			const yielded = result.value;
			if (_trits[ptr] !== $QUARANTINE) _trits[ptr] += SETTLE_DELTA + LOCK_DELTA;
			_activePtr = prevActive;

			// 2. ASYNC SUSPENSION
			if (typeof yielded?.then === 'function') {
				iter._isAwaiting = true; // Mark iter as suspended for IO
				yielded.then(val => {
					// If node was disposed, or restarted by a sync trigger, abandon this promise
					if (_nodeGen[ptr] !== savedGen || LUT_E[_trits[ptr] + Z] === 0 || _ctx[ptr] !== iter) return;
					
					iter._isAwaiting = false;
					_values[ptr] = val; 
					trigger(ptr); 
					next(ptr);
				});
			} else {
				_values[ptr] = yielded;
				trigger(ptr);
			}
			return;
		} catch (e) {
			console.error(VERSION + ' Coroutine error:', e);
			_trits[ptr] = $QUARANTINE;
		} finally {
			if (_activePtr === ptr) _activePtr = prevActive;
		}
	}

    function recompute(ptr) {
		const v = _trits[ptr];
		if (LUT_E[v + Z] !== 1) return;

		_trits[ptr] -= LOCK_DELTA;
		const prevActive = _activePtr;
		cleanupDeps(ptr);
		_activePtr = ptr;
		_traceEpoch++;
		if (_nodeTree[ptr*3+1] !== 0) disposeChildren(ptr);

		try {
			const fn = _values[ptr];
			if (typeof fn === 'function') _ctx[ptr] = fn();
		} catch (e) {
			console.error(VERSION + ' recompute error:', e);
			_trits[ptr] = $QUARANTINE; return;
		} finally {
			if (_trits[ptr] !== $QUARANTINE)
				_trits[ptr] += SETTLE_DELTA + LOCK_DELTA;
			_activePtr = prevActive;
		}
	}


	//? §15  DEEP PROXY
	function createDeepProxy(eng, target, parentPath, parentPtr) {
		const dict = DICTIONARY.get(eng);
		const proxy = new Proxy(target, {
			get(obj, prop) {
				if (typeof prop === 'symbol') return obj[prop];
				track(parentPtr);
				if (Array.isArray(obj) && ARRAY_MUTATORS.has(prop)) {
					return function(...args) {
						let res;
						eng.batch(() => { res = Array.prototype[prop].apply(obj, args); });
						return res;
					};
				}
				const val = obj[prop];
				if (val !== null && typeof val === 'object' && !_proxySet.has(val)) {
					const cp = parentPath ? `${parentPath}.${String(prop)}` : String(prop);
					const nested = createDeepProxy(eng, val, cp, parentPtr);
					_proxySet.add(nested);
					return nested;
				}
				return val;
			},
			set(obj, prop, value) {
				if (is(obj[prop], value)) return true;
				obj[prop] = value;
				const cp = parentPath ? `${parentPath}.${String(prop)}` : String(prop);
				const uuid = dict?.get(cp);
				if (uuid !== undefined) {
					const cn = GraphNode.deref(uuid);
					if (cn) { _values[cn.ptr] = value; trigger(cn.ptr); }
				} else {
					const cn = eng.signal(cp, value);
					adopt(parentPtr, cn.ptr);
				}
				trigger(parentPtr);
				return true;
			},
			deleteProperty(obj, prop) {
				if (!(prop in obj)) return true;
				delete obj[prop];
				const cp = parentPath ? `${parentPath}.${String(prop)}` : String(prop);
				const uuid = dict?.get(cp);
				if (uuid != null) { GraphNode.deref(uuid)?.dispose(); dict.delete(cp); }
				trigger(parentPtr);
				return true;
			}
		});
		_proxySet.add(proxy);
		return proxy;
	}

	//? §16  CHIMERA NAMESPACE — metaproxy for DOM
	function _metaproxy(Ctor) {
		if (typeof Ctor !== 'function') throw new TypeError('[Chimera] metaproxy expects a constructor.');
		// Defensive check: prevent proxy-of-a-proxy
		if (METAPROXIES.has(Ctor.prototype)) return Ctor;

		const engine = _getGlobal();
		const handler = {
			defineProperty(target, prop, descriptor) {
				if (typeof prop === 'string' && 'value' in descriptor) {
					const match = prop.match(/^(\$+)/);
					if (match) {
						const sigil = match[1];
						const v = sigil.length === 3 ? 1 : sigil.length === 2 ? -1 : 0;
						const graft = sigil.length >= 2;
						engine.signal(prop, descriptor.value, {
							v,
							layer: graft ? Infinity : 0,
							deep: graft,
						});
						descriptor = {
							configurable: true,
							enumerable: descriptor.enumerable !== false,
							get: () => engine.get(prop),
							set: val => engine.set(prop, val),
						};
					}
				}
				return Reflect.defineProperty(target, prop, descriptor);
			},
			get(target, prop, receiver) {
				if (typeof prop === 'string' && prop[0] === '$' && prop !== '$' && prop !== '$$' && prop !== '$$$') {
					const node = engine.node(prop);
					if (node) return node.get();
				}
				return Reflect.get(target, prop, receiver);
			},
			set(target, prop, value, receiver) {
				if (typeof prop === 'string' && prop[0] === '$' && prop !== '$' && prop !== '$$' && prop !== '$$$') {
					engine.set(prop, value);
					return true;
				}
				return Reflect.set(target, prop, value, receiver);
			}
		};
		Ctor.prototype = new Proxy(Ctor.prototype, handler);
		return Ctor;
	}

	// ── Public exports ──────────────────────────────────────────────────
	return {
		Signal, Substrate, GraphNode,
		Chimera: {
			metaproxy: _metaproxy, layer, psi, ψ: ψ_fn, version: VERSION,
		},
		_scanClass,
	};

})(typeof window !== 'undefined' ? window : globalThis, '[Chimera V12.2.0]');
