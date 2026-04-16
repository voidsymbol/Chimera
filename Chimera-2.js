/**!
 * Chimera V2
 *
 * Chimera architecture + Substrate bipartite arena engine.
 *
 * The engine swap:  _makeEngine()  →  new Substrate()
 * Each reactive scope gets a real arena-backed engine with:
 *   — push-based dirty tracking through the bipartite edge graph
 *   — lazy computed memoization (STALE flag, deferred recompute)
 *   — deep proxy mutations (.push, [i]=) wired to _trigger
 *   — batch / effect / watch / untrack primitives
 *
 * Sigil convention (identical to V1, now with real reactivity):
 *   $foo          shallow signal   — scalar, triggers on =
 *   $$foo         deep signal      — array/object, triggers on any mutation
 *   $foo()        computed method  — memoized, re-runs when arena deps change
 *   get $foo()    volatile getter  — re-runs on every read, never memoized
 *   static $foo   static signal    — shared across all instances of the class
 *   static $foo() static computed  — class-level memoized derived value
 *   static get $foo() static volatile getter
 *
 * @license AGPL-3.0-or-later
 * @copyright voidsymbol
 */
// ─── 0. Map / WeakMap polyfill ────────────────────────────────────────────────

void function (M, WM, FN, GI, GIC) {
    const use = (name, proto) => {
        if (!Object.hasOwn(proto, name)) Object.defineProperty(proto, name, {
            value: {
                __proto__: null,
                [GI](key, dv) {
                    if (this.has(key)) return this.get(key);
                    this.set(key, dv); return dv;
                },
                [GIC](key, cb) {
                    if (this.has(key)) return this.get(key);
                    if (typeof cb !== FN) throw new TypeError(`${GIC} requires a ${FN}`);
                    const v = cb(key, this); this.set(key, v); return v;
                }
            }[name], writable: true, configurable: true
        });
    };
    for (const p of [M, WM]) { use(GI, p); use(GIC, p); }
}(Map.prototype, WeakMap.prototype, 'function', 'getOrInsert', 'getOrInsertComputed');

// ─── 1. Utilities ─────────────────────────────────────────────────────────────

const ø = (obj = {}) => ({ __proto__: null, ...obj });
const lock = Object.freeze;
const løck = obj => lock(ø(obj));

const { is, entries, getPrototypeOf: _of, prototype: _$ } = Object;
const { get: REFLECT_GET, set: REFLECT_SET, defineProperty: REFLECT_DEFINE, deleteProperty: REFLECT_DELETE } = Reflect;

const _isPlainObj = v => v != null && typeof v === 'object' && (_of(v) === _$ || _of(v) === null);

const BUILT_IN_SYMBOLS = new Set(
    Object.getOwnPropertyNames(Symbol).map(k => Symbol[k]).filter(s => typeof s === 'symbol')
);

function IS_ES6_CLASS(val) {
    return !!((t, d) => {
        try {
            return t && (d = Object.getOwnPropertyDescriptor(val, 'prototype')) &&
                !d.enumerable && !d.configurable && d.writable === false &&
                /^\s*class\s+/.test(val.toString());
        } catch (e) {}
    })(typeof val === 'function');
}

// ─── 2. Symbols ───────────────────────────────────────────────────────────────

const INSTANCE_STORE = Symbol('Chimera:store');   // per-instance data bag
const STATIC_STORE   = Symbol('Chimera:static');  // per-class data bag
const UNMOUNT        = Symbol('Chimera:unmount');
const CACHE          = Symbol('Chimera:cache');

// ─── 3. Node Flags ────────────────────────────────────────────────────────────

const DISPOSED = 1, RUNNING = 2, STALE = 4, QUEUED = 8, SIG_DEEP = 16, ZOMBIE = 32;

// ─── 4. Arena — module-global typed-array allocator ──────────────────────────
// One shared arena for the entire module. All engines write into the same pool.

let MAX_NODES   = 65536;
let MAX_SIGNALS = 65536;
let MAX_EDGES   = 131072;
let _arenaReady = false;

let _pendingQueue, _zombieQueue, _pool, _sigHead, _sigFlags;
let _stack, _edgeEffect, _edgeSignal, _edgeNextSub, _edgePrevSub, _edgeNextDep;

let _idGen = 1, _freeNodeHead = 0, _zombieTail = 0, _sigCount = 1;
let _ptr = 0, _activePtr = 0, _pendingHead = 0, _pendingTail = 0, _batchDepth = 0;
let _edgeCount = 1, _freeEdgeHead = 0;

function _detectEnv() {
    if (typeof performance === 'undefined') return 'node';
    const t0 = performance.now();
    let ticks = 0;
    while (performance.now() === t0 && ++ticks < 1000) {}
    if (ticks >= 1000) return 'browser';
    const res = performance.now() - t0;
    if (res > 2) return 'constrained';
    if (res < 0.01) return 'node';
    if (ticks < 5) return 'worker';
    return 'browser';
}

function _initArena(cfg = {}) {
    if (_arenaReady) return;
    if (cfg.maxNodes) {
        MAX_NODES   = cfg.maxNodes;
        MAX_SIGNALS = cfg.maxSignals || cfg.maxNodes;
        MAX_EDGES   = cfg.maxEdges   || cfg.maxNodes * 2;
    } else {
        switch (_detectEnv()) {
            case 'node':        MAX_NODES = 131072; MAX_EDGES = 262144; break;
            case 'worker':      MAX_NODES = 65536;  MAX_EDGES = 131072; break;
            case 'constrained': MAX_NODES = 16384;  MAX_EDGES = 32768;  break;
            default:            MAX_NODES = 65536;  MAX_EDGES = 131072; break;
        }
        MAX_SIGNALS = MAX_NODES;
    }
    _pendingQueue = new Uint16Array(MAX_NODES + 1);
    _zombieQueue  = new Uint16Array(MAX_NODES + 1);
    _pool         = new Array(MAX_NODES);
    _sigHead      = new Uint32Array(MAX_SIGNALS);
    _sigFlags     = new Uint8Array(MAX_SIGNALS);
    _stack        = new Uint16Array(4096);
    _edgeEffect   = new Uint16Array(MAX_EDGES);
    _edgeSignal   = new Uint32Array(MAX_EDGES);
    _edgeNextSub  = new Uint32Array(MAX_EDGES);
    _edgePrevSub  = new Uint32Array(MAX_EDGES);
    _edgeNextDep  = new Uint32Array(MAX_EDGES);
    _arenaReady   = true;
}

// ─── 5. GC — Idle Poller + FinalizationRegistry ───────────────────────────────

const _activeHosts = [];
let _pollIndex = 0, _pollScheduled = false;

function _schedulePoll() {
    if (_pollScheduled || typeof requestIdleCallback === 'undefined') return;
    _pollScheduled = true;
    requestIdleCallback(_idlePollTask);
}

function _idlePollTask(deadline) {
    let checks = 0;
    while (checks++ < 100 && deadline.timeRemaining() > 1 && _activeHosts.length > 0) {
        if (_pollIndex >= _activeHosts.length) _pollIndex = 0;
        const host = _activeHosts[_pollIndex];
        if (host.isConnected === false) {
            if (host[UNMOUNT]) host[UNMOUNT]();
            const last = _activeHosts.pop();
            if (host !== last && _pollIndex < _activeHosts.length) _activeHosts[_pollIndex] = last;
        } else _pollIndex++;
    }
    if (_activeHosts.length > 0) requestIdleCallback(_idlePollTask);
    else _pollScheduled = false;
}

const _registry = typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry(ptrs => { for (let i = 0; i < ptrs.length; i++) _tagForDisposal(ptrs[i]); })
    : null;

// ─── 6. Arena Allocation ──────────────────────────────────────────────────────

function _allocEdge() {
    if (_freeEdgeHead !== 0) { const e = _freeEdgeHead; _freeEdgeHead = _edgeNextSub[e]; return e; }
    if (_edgeCount >= MAX_EDGES) {
        if (_zombieTail > 0) { _forceSweepZombies(); if (_freeEdgeHead !== 0) return _allocEdge(); }
        throw new Error(`[Chimera] Edge Arena OOM — limit ${MAX_EDGES}`);
    }
    return _edgeCount++;
}

function _allocNodeId() {
    if (_freeNodeHead !== 0) { const p = _freeNodeHead; _freeNodeHead = _pool[p].headDep; return p; }
    if (_idGen < MAX_NODES) return _idGen++;
    if (_zombieTail > 0) { _forceSweepZombies(); if (_freeNodeHead !== 0) return _allocNodeId(); }
    throw new Error(`[Chimera] Node Arena OOM — limit ${MAX_NODES}`);
}

function _tagForDisposal(ptr) {
    const node = _pool[ptr];
    if (!node || (node.flags & (DISPOSED | ZOMBIE))) return;
    node.flags |= ZOMBIE;
    if (_zombieTail >= MAX_NODES) _forceSweepZombies();
    _zombieQueue[_zombieTail++] = ptr;
}

function _forceSweepZombies() {
    // Chimerae eat zombies. It's canon.
    while (_zombieTail > 0) _disposeNode(_zombieQueue[--_zombieTail]);
}

// ─── 7. Core Reactive Engine ──────────────────────────────────────────────────

function _track(sigId) {
    if (!_activePtr) return;
    const node = _pool[_activePtr];
    let e = node.headDep;
    while (e !== 0) { if (_edgeSignal[e] === sigId) return; e = _edgeNextDep[e]; }
    const edge = _allocEdge();
    _edgeEffect[edge]  = _activePtr; _edgeSignal[edge] = sigId;
    const head = _sigHead[sigId];
    _edgeNextSub[edge] = head; _edgePrevSub[edge] = 0;
    if (head !== 0) _edgePrevSub[head] = edge;
    _sigHead[sigId] = edge; _edgeNextDep[edge] = node.headDep; node.headDep = edge;
}

function _cleanupEdges(ptr) {
    const node = _pool[ptr]; let edge = node.headDep;
    while (edge !== 0) {
        const nextDep = _edgeNextDep[edge], sigId = _edgeSignal[edge];
        const prev = _edgePrevSub[edge], next = _edgeNextSub[edge];
        if (prev !== 0) _edgeNextSub[prev] = next; else _sigHead[sigId] = next;
        if (next !== 0) _edgePrevSub[next] = prev;
        _edgeNextSub[edge] = _freeEdgeHead; _freeEdgeHead = edge; edge = nextDep;
    }
    node.headDep = 0;
}

function _trigger(sigId) {
    let edge = _sigHead[sigId];
    while (edge !== 0) {
        const next = _edgeNextSub[edge], ptr = _edgeEffect[edge], node = _pool[ptr];
        if (!(node.flags & (DISPOSED | ZOMBIE))) {
            if (_batchDepth > 0) {
                if (!(node.flags & QUEUED)) { node.flags |= QUEUED; _pendingQueue[_pendingTail++] = ptr; }
            } else _runNode(ptr);
        }
        edge = next;
    }
}

function _flushQueue() {
    while (_pendingHead < _pendingTail) {
        const ptr = _pendingQueue[_pendingHead++], node = _pool[ptr];
        node.flags &= ~QUEUED;
        if (!(node.flags & (DISPOSED | ZOMBIE))) _runNode(ptr);
    }
    _pendingHead = _pendingTail = 0;
}

function _makeEffectNode(fn, flags = 0) {
    const ptr = _allocNodeId();
    if (_pool[ptr]) { const n = _pool[ptr]; n.fn = fn; n.flags = flags; n.headDep = 0; n.cleanup = null; }
    else _pool[ptr] = ø({ ptr, fn, flags, headDep: 0, cleanup: null });
    return ptr;
}

function _runNode(ptr) {
    const node = _pool[ptr];
    if (node.flags & (DISPOSED | RUNNING | ZOMBIE | STALE)) return;
    node.flags |= RUNNING;
    if (typeof node.cleanup === 'function') {
        const prev = _activePtr; _activePtr = 0;
        try { node.cleanup(); } catch (e) {} finally { _activePtr = prev; node.cleanup = null; }
    }
    _cleanupEdges(ptr); _stack[_ptr++] = (_activePtr = ptr);
    try { const r = node.fn(); if (typeof r === 'function') node.cleanup = r; }
    catch (e) { console.error('[Chimera] Effect error:', e); }
    finally { _activePtr = --_ptr ? _stack[_ptr - 1] : 0; node.flags &= ~RUNNING; }
}

function _disposeNode(ptr) {
    const node = _pool[ptr]; if (node.flags & DISPOSED) return;
    node.flags = DISPOSED; _cleanupEdges(ptr);
    if (typeof node.cleanup === 'function') {
        const prev = _activePtr; _activePtr = 0;
        try { node.cleanup(); } catch (e) {} finally { _activePtr = prev; node.cleanup = null; }
    }
    node.headDep = _freeNodeHead; _freeNodeHead = ptr;
}

// ─── 8. Deep Proxy ────────────────────────────────────────────────────────────
// Wraps arrays/objects so that .push(), [i]= and delete all fire _trigger.

function _deepProxy(target, sigId) {
    return new Proxy(target, {
        get(obj, key) {
            if (typeof key === 'symbol' && BUILT_IN_SYMBOLS.has(key)) return obj[key];
            if (key === 'then') return undefined;
            _track(sigId);
            const res = obj[key];
            if (typeof res === 'function') return res.bind(new Proxy(obj, this));
            return (typeof res === 'object' && res !== null) ? _deepProxy(res, sigId) : res;
        },
        set(obj, key, value) {
            if (is(obj[key], value)) return true;
            obj[key] = value; _trigger(sigId); return true;
        },
        deleteProperty(obj, key) {
            if (!(key in obj)) return true;
            delete obj[key]; _trigger(sigId); return true;
        }
    });
}

// ─── 9. Substrate — the per-scope arena engine ────────────────────────────────
//
// This is the engine swap point.  Everywhere Chimera-1 had:
//   const engine = _makeEngine()
// we now have:
//   const engine = new Substrate()
//
// Substrate() called with new returns an object exposing:
//   signal(initial, isDeep)  — arena signal with _track / _trigger
//   computed(fn)             — lazy memoized node, STALE until read
//   effect(fn)               — eager reactive effect, cleanup support
//   watch(src, fn)           — value-change watcher
//   batch(fn|obj)            — deferred flush
//   untrack(fn)              — execute fn without registering deps
//   peek(key)                — read store value without tracking
//   dispose()                — tag all effect nodes for recycling

class Substrate {
    constructor(cfg = {}) {
        _initArena(_isPlainObj(cfg) ? cfg : {});

        const store      = new Map();  // this engine's signal store
        const effectPtrs = [];

        // ── signal ────────────────────────────────────────────────────────────
        const signal = (initial, isDeep = false) => {
            const sigId = _sigCount++;
            if (isDeep) _sigFlags[sigId] |= SIG_DEEP;
            let value = (isDeep && typeof initial === 'object' && initial !== null)
                ? _deepProxy(initial, sigId) : initial;
            return lock(ø({
                get()  { _track(sigId); return value; },
                set(v) {
                    if (is(v, value)) return;
                    value = ((_sigFlags[sigId] & SIG_DEEP) && typeof v === 'object' && v !== null)
                        ? _deepProxy(v, sigId) : v;
                    _trigger(sigId);
                },
                peek() { return value; }
            }));
        };

        // ── computed ──────────────────────────────────────────────────────────
        // Lazy: marks itself STALE when deps fire, recomputes on next .get()
        const computed = fn => {
            const sigId = _sigCount++;
            let cached;
            const ptr = _makeEffectNode(
                () => { _pool[ptr].flags |= STALE; _trigger(sigId); },
                STALE
            );
            const _recompute = () => {
                _cleanupEdges(ptr); _stack[_ptr++] = (_activePtr = ptr);
                _pool[ptr].flags = (_pool[ptr].flags | RUNNING) & ~STALE;
                try    { cached = fn(); }
                catch  (e) { console.error('[Chimera] Computed error:', e); }
                finally { _activePtr = --_ptr ? _stack[_ptr - 1] : 0; _pool[ptr].flags &= ~RUNNING; }
            };
            return lock(ø({
                get()  { _track(sigId); if (_pool[ptr].flags & STALE) _recompute(); return cached; },
                peek() { if (_pool[ptr].flags & STALE) _recompute(); return cached; }
            }));
        };

        // ── effect ────────────────────────────────────────────────────────────
        const effect = fn => {
            const ptr = _makeEffectNode(() => fn());
            _runNode(ptr); effectPtrs.push(ptr);
            return () => { _tagForDisposal(ptr); effectPtrs.splice(effectPtrs.indexOf(ptr) >>> 0, 1); };
        };

        // ── untrack ───────────────────────────────────────────────────────────
        const untrack = fn => {
            _stack[_ptr++] = (_activePtr = 0);
            try { return fn(); } finally { _activePtr = --_ptr ? _stack[_ptr - 1] : 0; }
        };

        // ── batch ─────────────────────────────────────────────────────────────
        const batch = input => {
            ++_batchDepth;
            try {
                if (_isPlainObj(input)) {
                    for (const [k, v] of entries(input)) {
                        if (store.has(k)) store.get(k).set(v); else store.set(k, signal(v));
                    }
                } else if (typeof input === 'function') input();
            } finally { if (--_batchDepth === 0) _flushQueue(); }
        };

        // ── watch ─────────────────────────────────────────────────────────────
        const watch = (src, fn) => {
            const getter = typeof src === 'function' ? src : () => src.get();
            let oldVal   = untrack(getter);
            const ptr    = _makeEffectNode(() => {
                const newVal = getter();
                if (!Object.is(newVal, oldVal)) { const p = oldVal; oldVal = newVal; untrack(() => fn(newVal, p)); }
            });
            _runNode(ptr); effectPtrs.push(ptr);
            return () => _tagForDisposal(ptr);
        };

        // ── peek ──────────────────────────────────────────────────────────────
        const peek = key => store.get(key)?.peek() ?? undefined;

        // ── dispose ───────────────────────────────────────────────────────────
        const dispose = () => {
            for (let i = 0; i < effectPtrs.length; i++) _tagForDisposal(effectPtrs[i]);
            effectPtrs.length = 0; store.clear();
        };

        return { signal, computed, effect, watch, batch, untrack, peek, dispose, store };
    }

    static getStats() {
        return ø({
            nodesActive:      _idGen - 1,
            zombiesPending:   _zombieTail,
            edgesAllocated:   _edgeCount - 1,
            signalsAllocated: _sigCount - 1,
            arenaMaxNodes:    MAX_NODES,
            arenaMaxEdges:    MAX_EDGES,
        });
    }

    static forceGC() { _forceSweepZombies(); }
}

// ─── 10. Static Store Installer ───────────────────────────────────────────────
// Scans the constructor for static $/$$ fields and static $methods, installs
// getter/setters that route through a shared static engine on the class itself.
//
// Three static sigil behaviours:
//   static $val = x         → static shallow signal (shared, live)
//   static $$val = []       → static deep signal (shared, mutation-reactive)
//   static $method() {}     → static computed (lazy, memoized per class)
//   static get $prop() {}   → static volatile getter (never memoized)

const STATIC_SCANNED = new WeakSet();

function _installStaticReactivity(Ctor) {
    if (STATIC_SCANNED.has(Ctor)) return;
    STATIC_SCANNED.add(Ctor);

    // One engine per class, stored on the constructor itself
    const eng = new Substrate();
    Ctor[STATIC_STORE] = eng;

    for (const name of Object.getOwnPropertyNames(Ctor)) {
        if (!name.startsWith('$')) continue;
        const desc    = Object.getOwnPropertyDescriptor(Ctor, name);
        const isDeep  = name.startsWith('$$');
        const pure    = isDeep ? name.slice(2) : name.slice(1);

        // static get $foo() — volatile, keep as-is (re-runs every read)
        if (desc.get) continue;

        if (typeof desc.value === 'function') {
            // static $method() — memoized computed on the class engine
            const fn  = desc.value;
            const sig = eng.computed(() => fn.call(Ctor));
            eng.store.set(pure, sig);
            Object.defineProperty(Ctor, name, {
                get()  { return eng.store.get(pure).get(); },
                configurable: true, enumerable: false
            });
        } else {
            // static $val / static $$val — shared signal
            const sig = eng.signal(desc.value, isDeep);
            eng.store.set(pure, sig);
            Object.defineProperty(Ctor, name, {
                get()  { return eng.store.get(pure).get(); },
                set(v) { eng.store.get(pure).set(v); },
                configurable: true, enumerable: true
            });
        }
    }
}

// ─── 11. Prototype Method Scanner ─────────────────────────────────────────────
// Walks the prototype chain once per class (cached in SCANNED_CLASSES).
// Rewrites $method() definitions as getter-based computed accessors.
// Leaves `get $prop()` (volatile getters) completely untouched — they
// re-run on every read by definition.

const SCANNED_CLASSES = new WeakSet();

function _scanProtoMethods(newt, reactiveProto) {
    if (SCANNED_CLASSES.has(newt)) return;
    SCANNED_CLASSES.add(newt);

    let current = newt.prototype;
    while (current && current !== reactiveProto && current !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(current)) {
            if (!name.startsWith('$')) continue;
            const desc   = Object.getOwnPropertyDescriptor(current, name);
            const isDeep = name.startsWith('$$');
            const pure   = isDeep ? name.slice(2) : name.slice(1);

            // `get $foo()` — volatile getter. Leave it alone.
            // It will re-run every time the proxy `get` trap falls through to it.
            if (desc.get) continue;

            if (desc && typeof desc.value === 'function') {
                // $method() — rewrite as a lazy computed accessor on the prototype.
                // `this` inside the getter is the receiver (the proxy), so
                // `this[INSTANCE_STORE]` reaches the instance's data bag.
                const originalFn = desc.value;
                Object.defineProperty(current, name, {
                    get() {
                        const data = this[INSTANCE_STORE];
                        if (!data) return originalFn.bind(this);
                        return data.engine.store.getOrInsertComputed(
                            pure,
                            () => data.engine.computed(() => originalFn.call(this))
                        ).get();
                    },
                    configurable: true
                });
            }
        }
        current = _of(current);
    }
}

// ─── 12. The Severed Callable Prototype (reactiveProto) ───────────────────────
// A Proxy around a plain callable object.
//   apply → factory: $(pojo) or $(domEl)
//   get   → prototype trapdoor: instance.$foo falls through here
//   set   → prototype write trap: instance.$foo = x arrives here

const _baseTarget = function $() {};
REFLECT_DELETE(_baseTarget, 'name');
REFLECT_DELETE(_baseTarget, 'length');
Object.setPrototypeOf(_baseTarget, Object.prototype);

const reactiveProto = new Proxy(_baseTarget, {

    // ── PATH A: FACTORY ──────────────────────────────────────────────────────
    // $(pojo), $(domEl) — wraps any object in a reactive proxy with its own engine
    apply(_target, _thisArg, [payload = {}]) {
        const isDOM = payload?.nodeType === 1;
        const eng   = new Substrate();
        const store = eng.store;

        // Eagerly seed any $/$$ keys already present on the payload
        for (const key of Object.keys(payload)) {
            if (!key.startsWith('$')) continue;
            const isDeep = key.startsWith('$$');
            const pure   = isDeep ? key.slice(2) : key.slice(1);
            store.set(pure, eng.signal(payload[key], isDeep));
        }
        
        if (isDOM) {
            const host = payload;
            const _teardown = () => eng.dispose();
            host[UNMOUNT] = _teardown;
            
            Object.defineProperty(host, '$', { get: () => eng, configurable: true });
            // Object.defineProperty(host, '$', {})

            _activeHosts.push(host); _schedulePoll();
        }

        return new Proxy(payload, {
            get(obj, prop, receiver) {
                if (typeof prop === 'symbol') {
                    if (BUILT_IN_SYMBOLS.has(prop)) return obj[prop];
                    if (prop === UNMOUNT) return () => eng.dispose();
                    return obj[prop];
                }
                if (prop === 'then') return undefined;
                if (typeof prop === 'string' && prop.startsWith('$')) {
                    const isDeep = prop.startsWith('$$');
                    const pure   = isDeep ? prop.slice(2) : prop.slice(1);
                    return store.getOrInsertComputed(pure, () => eng.signal(obj[pure] ?? null, isDeep)).get();
                }
                const val = REFLECT_GET(obj, prop, receiver);
                return typeof val === 'function' ? val.bind(obj) : val;
            },
            set(obj, prop, value) {
                if (typeof prop === 'string' && prop.startsWith('$')) {
                    const isDeep = prop.startsWith('$$');
                    const pure   = isDeep ? prop.slice(2) : prop.slice(1);
                    if (store.has(pure)) store.get(pure).set(value);
                    else store.set(pure, eng.signal(value, isDeep));
                    return true;
                }
                return REFLECT_SET(obj, prop, value);
            }
        });
    },

    // ── PATH B: PROTOTYPE TRAPDOOR ───────────────────────────────────────────
    // `instance.$foo` falls through the prototype chain and lands here.
    // `receiver` is the actual instance (the Membrane proxy from Chimera()).

    get(protoTarget, prop, receiver) {
        if (typeof prop === 'symbol') {
            if (prop === Symbol.toPrimitive) return () => '[object Chimera]';
            if (BUILT_IN_SYMBOLS.has(prop)) return protoTarget[prop];
            return protoTarget[prop];
        }
        if (prop === 'then') return undefined;

        if (typeof prop === 'string' && prop.startsWith('$')) {
            const isDeep = prop.startsWith('$$');
            const pure   = isDeep ? prop.slice(2) : prop.slice(1);
            const data   = receiver[INSTANCE_STORE];
            if (data && data.engine.store.has(pure)) {
                return data.engine.store.get(pure).get();
            }
        }

        const desc = Object.getOwnPropertyDescriptor(protoTarget, prop);
        if (desc && typeof desc.value === 'function') return desc.value.bind(receiver);
        return REFLECT_GET(protoTarget, prop, receiver);
    },

    set(protoTarget, prop, value, receiver) {
        if (typeof prop === 'string' && prop.startsWith('$')) {
            const isDeep = prop.startsWith('$$');
            const pure   = isDeep ? prop.slice(2) : prop.slice(1);
            const data   = receiver[INSTANCE_STORE];
            if (data) {
                if (data.engine.store.has(pure)) data.engine.store.get(pure).set(value);
                else data.engine.store.set(pure, data.engine.signal(value, isDeep));
                return true;
            }
        }
        return REFLECT_SET(protoTarget, prop, value, receiver);
    }
});

// ─── 13. Chimera Constructor ──────────────────────────────────────────────────
// Called via `new SubClass()` (always subclassed, never directly).
//
// Three phases:
//   1. Static scan — install static $/$$ signals on the constructor once
//   2. Proto scan  — rewrite $method() definitions as computed getters once
//   3. Membrane    — intercept class field initializers via defineProperty trap

function Chimera(cfg = {}, isUpgrade = false) {
    if (!new.target) throw new TypeError("Chimera must be called with 'new'");

    // if (isUpgrade )

    const newt = new.target;

    // Phase 1: Static reactivity (once per class)
    _installStaticReactivity(newt);

    // Phase 2: Proto method scan (once per class)
    _scanProtoMethods(newt, reactiveProto);

    // Phase 3: Per-instance engine
    // Each instance gets its own Substrate engine — own signal store,
    // own effect list, own arena node slots.
    const engine = new Substrate(_isPlainObj(cfg) ? cfg : {});

    this[INSTANCE_STORE] = { engine };

    // The Membrane — intercepts class field initializers.
    // `class Foo extends Chimera { $x = 1; }` compiles to:
    //   Object.defineProperty(this, '$x', { value: 1, writable: true, ... })
    // We intercept that defineProperty call here and seed the signal store.
    return new Proxy(this, {
        defineProperty(target, prop, desc) {
            if (typeof prop === 'string' && prop.startsWith('$') && 'value' in desc) {
                const isDeep = prop.startsWith('$$');
                const pure   = isDeep ? prop.slice(2) : prop.slice(1);
                // If this key was already seeded by a parent class field,
                // update the signal value rather than replacing the signal object.
                // This preserves computed subscriptions across the super() chain.
                if (engine.store.has(pure)) {
                    engine.store.get(pure).set(desc.value);
                } else {
                    engine.store.set(pure, engine.signal(desc.value, isDeep));
                }
                return true;
            }
            return REFLECT_DEFINE(target, prop, desc);
        },

        get(target, prop, receiver) {
            // Forward INSTANCE_STORE reads to the raw target
            if (prop === INSTANCE_STORE) return target[INSTANCE_STORE];
            return REFLECT_GET(target, prop, receiver);
        }
    });
}

// Wire the trapdoor
Chimera.prototype = reactiveProto;

// ─── 14. Exports ──────────────────────────────────────────────────────────────

export { Chimera, reactiveProto as $, Substrate };
export const forceGC  = () => _forceSweepZombies();
export const getStats = () => Substrate.getStats();