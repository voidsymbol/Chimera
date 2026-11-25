/* Instance Chimera 18.5.1
 * Copyright © 2026 Instance
 * Licensed under the Instance Source License v1.4 (the "License"). You may not use this file except in compliance
 * with the License. You may obtain a copy of the License at https://codeberg.org/voidsymbol/The-Instance-Source-License/
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific
 * language governing permissions and limitations under the License. */
(function () {
'use strict';
const CHIMERA_API = (function init(factory) {

	const u = typeof void function($0, $1, $2) {
		var upsert = (proto, name) => {
			if (!Object.prototype.hasOwnProperty.call(proto, name)) {
				Object.defineProperty(proto, name, {
					value: {
						[$1](key, dv) { return this.has(key) ? this.get(key) : (this.set(key, dv), dv); },
						[$2](key, fn) {
							if (this.has(key)) return this.get(key);
							if (typeof fn !== $0) throw new TypeError(`${$2} requires a ${$0}`);
							const computed = fn(key, this);
							return this.set(key, computed), computed;
						}
					}[name], writable: true, configurable: true, enumerable: false
				});
			}
		};
		for (const proto of [WeakMap.prototype, Map.prototype]) { upsert(proto, $1); upsert(proto, $2); }
	}('function', 'getOrInsert', 'getOrInsertComputed');

	const VERSION = '18.5.1';
	const THIS =
	  typeof globalThis !== u ? globalThis :
		typeof window !== u ? window :
		  typeof self !== u ? self :
			typeof global !== u ? global :
			  this ?? Function('return this')();

	const INIT = factory(THIS, VERSION);

    if (typeof define === 'function' && define.amd) define( [], () => INIT );
    if (typeof module === 'object' && typeof module?.exports === 'object') module.exports = INIT;

	return INIT;

})(function(global, version) {

'use strict';

const CURSOR_NODE_BUMP      = 0;
const CURSOR_EDGE_BUMP      = 1;
const CURSOR_LIVE_NODES     = 2;
const CURSOR_FREE_NODE_HEAD = 3;
const CURSOR_FREE_EDGE_HEAD = 4;
const CURSOR_GLOBAL_UUID    = 5;

const ψ = (Ctor, ...sizes) => sizes.map(size => new Ctor(size));
const encode = (r, e, a, c, t) => (81*r + 27*e + 9*a + 3*c + t);

const EDGE_STRIDE_SHIFT = 2, SAB_HEADER_SIZE = 65536;
const THREAD_CTX_OFFSET_BYTES = 256, THREAD_CTX_STRIDE = 16, MAX_THREADS = 16;
const THREAD_ACTIVE_PTR = 0, THREAD_TRACE_EPOCH = 1, THREAD_OBSERVED_EPOCH = 2;
const MTC_NODE_BUMP = 0, MTC_EDGE_BUMP = 1, MTC_FREE_NODE_HEAD = 2, MTC_FREE_EDGE_HEAD = 3;
const MTC_TRACE_EPOCH64 = 8;
const MTC_GLOBAL_UUID = 4, MTC_HLC = 5, MTC_GLOBAL_EPOCH = 6, MTC_WORK_AVAILABLE = 7;
const MTC_WORK_HEAD = 8, MTC_WORK_HEAD_MAIN_ONLY = 10;
const MTC_ARENA_NODES = 12, MTC_ARENA_EDGES = 13, MTC_ARENA_WORKERS = 14;
const MARK_BIT = 0x80000000_00000000n, MASK_INDEX = 0xFFFFFFFFn;
const { load: LOAD, store: STORE, compareExchange: CAS, add: ADD, sub: SUB, or: OR, and: AND, exchange: EXCHANGE, notify: NOTIFY, wait: WAIT } = Atomics;
const packPtr = (idx, tag) => (BigInt(tag) << 32n) | (BigInt(idx) & MASK_INDEX);
const unpackIndex = (p) => Number(p & MASK_INDEX);
const unpackTag = (p) => Number((p >> 32n) & 0x7FFFFFFFn);
const isMarked = (p) => (p & MARK_BIT) !== 0n;
const getMarked = (p) => p | MARK_BIT;
const getUnmarked = (p) => p & ~MARK_BIT;

const CHIMERA  = Symbol.for('Chimera');

const REACTIVE_STORE = Symbol('/Store');
const LAYER  		 = Symbol('/Layer');
const DEEP_PROXIES	 = Symbol('/Deep Proxies');
const QUORUM  		 = Symbol('/Quorum');
const CASCADE  	 	 = Symbol('/Cascade');
const DICTIONARY	 = Symbol('/Dictionary');
function computeMemo(self, bag, args) {
	const sig    = bag.sigOf(args);
	const leaf   = trieDescend(bag.trieRoot, sig);
	const cached = leaf.node;

	if (cached && _nodeGen[cached[PTR]] === cached[GEN]) {
		if (_trits[cached[PTR]] !== 0) return get(cached[PTR]);
		dropFromQueue(bag.leafQueue, cached[PTR], cached[GEN]);
	}

	if (sig.length === 0) {
		if (GraphNode.dead(self)) return undefined;
		const ptr = armHead(self, bag, leaf, bag.leafTrit), gen = _nodeGen[ptr];
		runNode(ptr);
		return isLive(ptr, gen) ? get(ptr) : undefined;
	}

	const leafPtr = allocNode();
	_trits[leafPtr] = bag.leafTrit;
	if (bag.quorum) _gateA[leafPtr] = 1;
	adopt(stateOf(self).engine[PTR], leafPtr);
	const leafRef = refOf(leafPtr);

	let held = null;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (isKeyable(a) && !(a instanceof Signal)) {
			(held ??= args.slice())[i] = new HeldArg(a);
			if (_reaper !== null) _reaper.register(a, { variant: leafRef, arena: _arenaSerial });
		}
	}

	bag.leafQueue.push(ø({ [PTR]: leafPtr, [GEN]: _nodeGen[leafPtr], trieNode: leaf }));
	bag.liveCount++;

	if (bag.leafQueue.length > bag.maxSize) {

		let scan = bag.leafQueue.length;
		while (bag.leafQueue.length > bag.maxSize && scan-- > 0) {
			const old = bag.leafQueue.shift();
			if (!old) break;
			const _p = old[PTR];

			const live = isLive(_p, old[GEN]) && old.trieNode?.node?.[PTR] === _p;
			if (live && (_sigHead[_p] !== 0 || e_axis(_trits[_p]) === 1)) { bag.leafQueue.push(old); continue; }
			if (live) { triePrune(old.trieNode); tagForDisposal(_p); bag.liveCount--; }
			else if (old.trieNode?.node?.[PTR] === _p && GraphNode.isZombie(old.trieNode.node)) triePrune(old.trieNode);
		}
	}

	_values[leafPtr] = held === null
		? () => bag.factory.call(self, self, ...args)
		: held.length === 1
			? () => { const o = held[0].ref.deref(); return o === undefined ? undefined : bag.factory.call(self, self, o); }
			: () => {
				const a = new Array(held.length);
				for (let i = 0; i < held.length; i++) {
					const v = held[i];
					if (v instanceof HeldArg) { const o = v.ref.deref(); if (o === undefined) return undefined; a[i] = o; }
					else a[i] = v;
				}
				return bag.factory.call(self, self, ...a);
			};
	leaf.node = Signal(leafPtr);
	const leafGen = _nodeGen[leafPtr];
	runNode(leafPtr);
	return isLive(leafPtr, leafGen) ? get(leafPtr) : undefined;
}

function armHead(self, bag, leaf, trit) {
	const ptr = GraphNode.ptrOf(self);
	_trits[ptr] = trit;
	if (bag.quorum) _gateA[ptr] = 1;
	_values[ptr] = () => bag.factory.call(self, self);
	_ctx[ptr] = undefined;
	leaf.node = self;
	bag.liveCount++;
	return ptr;
}

function retypeInert(ptr) {
	const prev = _ctx[ptr];
	cleanupDeps(ptr);
	if (_nodeTree[(ptr*3 + TREE_CHILD)] !== 0) disposeChildren(ptr);
	_gateA[ptr] = 0;
	_predicates[ptr] = undefined;
	_ctx[ptr] = undefined;
	_values[ptr] = undefined;
	_parkedTrit[ptr] = 0;
	_trits[ptr] = TRIT_STATE;
	if (prev !== undefined) trigger(ptr);
}

const noStore   = n => { throw new TypeError(`Signal.Store does not support ${n}()`); };
const storeOnly = n => { throw new TypeError(`${n}() is a Signal.Store method`); };

const MARK      = Symbol('/markZombie');
const ENGINE    = Symbol('/store.engine');
const PROXY_REF = Symbol('/traps.proxy');
const CALL           = Symbol('/Callable');
const GEN_CTX 		 = Symbol('/Chimera FN');
const AWAITING		 = Symbol('/Awaiting');

const SIGIL_REF = {
    'Δ':  { A: 'union',     C: 'shallow' },
    'ΔΔ': { A: 'union',     C: 'deep'    },
    'Σ':  { A: 'consensus', C: 'shallow' },
    'ΣΣ': { A: 'consensus', C: 'deep'    },
    'Φ':  { A: 'union',     C: 'atomic'  },
    'ΦΦ': { A: 'consensus', C: 'atomic'  },
    '$': 'Φ', '$$': 'ΦΦ', 'ø': 'Φ',
};

const RUN_META = {}, CANON_SPELLING = {};

for (const run of Object.keys(SIGIL_REF)) {
    const def = SIGIL_REF[run];
    const d = typeof def === 'string' ? SIGIL_REF[def] : def;
    const depth = d.C === 'deep' ? Infinity : d.C === 'shallow' ? 1 : 0;
    const type  = d.A;
    RUN_META[run] = Object.freeze({ type, depth });
    if (typeof def !== 'string' && CANON_SPELLING[type + ':' + depth] === undefined)
        CANON_SPELLING[type + ':' + depth] = run;
}
const SIGIL_CHARS = new Set(Object.keys(SIGIL_REF).map(k => k[0]));
const SIGIL_STRIP_RE = new RegExp('^[' + [...SIGIL_CHARS].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + ']+');
const TRIADS = new WeakMap();

const PREFIX_RE = buildRegex('prefix', SIGIL_CHARS);
const SUFFIX_RE = buildRegex('suffix', SIGIL_CHARS);

function buildRegex(type, chars, maxLen = 3) {

	const escaped = [...chars].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
	const classPattern = `[${escaped}]{1,${maxLen}}`;
	const p = type === 'prefix' ? `^(${classPattern})(.*)$` : `^(.*?)(${classPattern})$`;
	return new RegExp(p);
}

function ø(o) { return { __proto__: null, ...o } }

function isFrozen(ptr) { return (r_axis(_trits[ptr]) === 0) && (_trits[ptr] !== 0); }

function stateOf(h) { return GraphNode.stateOf(h); }

function startsWith(r, s) { const m = r.exec(s); return m ? { sigil: m[1], name: m[2] } : null; }
function endsWith(r, s) { const m = r.exec(s); return m ? { sigil: m[2], name: m[1] } : null; }
function isKeyable(v) { return v !== null && (typeof v === 'object' || typeof v === 'function'); }

const EXOTIC_TAGS = new Set(['[object Map]', '[object Set]', '[object WeakMap]', '[object WeakSet]',
	'[object Date]', '[object RegExp]', '[object Promise]', '[object DataView]',
	'[object ArrayBuffer]', '[object SharedArrayBuffer]', '[object Error]']);
const _ots = Object.prototype.toString;
function isExoticOpaque(o) {
	const p = Object.getPrototypeOf(o);
	if (p === Object.prototype || p === Array.prototype || p === null) return false;
	if (typeof o.nodeType === 'number' && typeof o.nodeName === 'string') return true;
	if (ArrayBuffer.isView(o)) return true;
	return EXOTIC_TAGS.has(_ots.call(o));
}

function isOpaqueValue(o) {
	if (isExoticOpaque(o)) return true;
	const pr = Object.getPrototypeOf(o);
	return pr !== Object.prototype && pr !== null && !Array.isArray(o);
}

const newMap = () => new Map();
function doorTarget(instance) {
    return instance instanceof Signal ? instance : function door() {};
}
function triad(instance, prefix, isUnion, owner) {
    prefix = canonSigil(prefix);

    const cache = TRIADS.getOrInsertComputed(instance, newMap);
    const key = `${prefix}|${isUnion}|${owner == null ? '' : owner}`;

    return cache.getOrInsertComputed(key, () => {
        GraphNode.ensureState(instance);
        return reactive(doorTarget(instance), {
            isRoot: true,
            store: instance,
            prefix,
            meta: sigilMeta(prefix),
            owner,
            isUnion
        });
    });
}

function parse(key) {
    if (typeof key !== 'string') return null;
    const prefix = startsWith(PREFIX_RE, key);
    const suffix = endsWith(SUFFIX_RE, key);
    if (prefix && !prefix.name) return null;
    if (suffix && !suffix.name) return null;
    if (prefix && suffix) throw new TypeError(`Double-sided sigils are banned: key "${key}" carries both a prefix and a suffix run.`);
    if (!prefix && !suffix) return null;
    const { sigil, name } = prefix || suffix;
    const mode = prefix ? 'prefix' : 'suffix';
    if (new Set(sigil).size > 1)
        throw new TypeError(`Key "${key}" has mixed sigils. All consecutive sigils must be identical.`);
    const meta = sigilMeta(sigil);
    if (!meta) return null;
    const sig = canonOf(meta);
    const pole = poleOf(meta);
    return { key, mode, name, sigil, depth: meta.depth, type: meta.type,
             affect: pole.affect, capture: pole.capture,
             canonKey: mode === 'prefix' ? sig + name : name + sig };
}

function canonKey(key) { const m = parse(key); return m ? m.canonKey : key; }

function canonSigil(p) { const m = sigilMeta(p); return m ? canonOf(m) : p; }

function poleOf(meta) {
    return { affect:  meta.type === 'union' ? 'union' : 'consensus',
             capture: meta.depth > 1 ? 'deep' : meta.depth === 1 ? 'shallow' : 'atomic' };
}
function sigilOf(run) {
    let meta;
    try { meta = sigilMeta(run); } catch (e) { return null; }
    if (!meta) return null;
    const pole = poleOf(meta);
    return { sigil: canonOf(meta), affect: pole.affect, capture: pole.capture, type: meta.type, depth: meta.depth };
}
const SIGILS = Object.freeze(Object.fromEntries(Object.entries(SIGIL_REF).map(([k, v]) =>
    [k, typeof v === 'string' ? v : Object.freeze({ ...v })])));

function assertDisciplines(obj) {
    const seen = new Map();
    for (const k of Object.keys(obj)) {
        const m = parse(k);
        const bare = m ? m.name : k;
        const mode = m ? m.mode : 'prefix';
        const disc = m ? `${m.type}:${m.depth}` : 'inherit';
        const g = bare + '\u0000' + mode;
        const prev = seen.get(g);
        if (prev && prev.disc !== disc)
            throw new TypeError(`Conflicting disciplines for "${bare}": "${prev.k}" vs "${k}" at the same level.`);
        seen.set(g, { k, disc });
    }
}

function sigilMeta(sigil) {
    if (typeof sigil !== 'string' || sigil.length === 0) return null;
    if (new Set(sigil).size > 1) throw new TypeError(`Mixed sigils: "${sigil}"`);

    return RUN_META[sigil] ?? RUN_META[sigil.slice(0, 2)] ?? RUN_META[sigil[0]] ?? null;
}
const canonOf = ({ type, depth }) =>
    CANON_SPELLING[type + ':' + depth]
    ?? (depth === 0 ? (type === 'consensus' ? '$$' : '$')
        : type === 'union' ? (depth === Infinity ? 'ΔΔ' : 'Δ')
                           : (depth === Infinity ? 'ΣΣ' : 'Σ'));

const TEXT_SYNC = `%c[Chimera V${version}] Trit Arena Active (Sync).`;

const EXPORT_SYMBOLS = true;
const PTR = Symbol('ptr'), GEN = Symbol('gen');

const SYMBOLS = { DICTIONARY, REACTIVE_STORE, LAYER, DEEP_PROXIES, QUORUM, CASCADE, CALL, PTR, GEN };

const ROOT_MOUNT = 121;
const Z = 128, U = 'undefined';

const [R, E, A, C, T] = [3 ** 4, 3 ** 3, 3 ** 2, 3 ** 1, 3 ** 0];
const [L1, L2, L3, L4, L5] = [1 << 16, 1 << 17, 1 << 18, 1 << 19, 1 << 20];

const [X127, X126, X125, X124, X123, X122] = [+127, +126, +125, +124, +123, +122];
const [M128, M127, M126, M125, M124, M123, M122] = [-128, -127, -126, -125, -124, -123, -122];

const [EDGE_STRIDE, EDGE_SHIFT] = [4, 2];
const [EDGE_TARGET, EDGE_NEXT, EDGE_PREV_SUB, EDGE_PAIR] = [0, 1, 2, 3];

const [TREE_PARENT, TREE_CHILD, TREE_SIB] = [0, 1, 2];
const [LUT_R, LUT_E, LUT_A, LUT_C, LUT_T] = ψ(Int8Array, 256, 256, 256, 256, 256);

void ((rnd) => {
	for (let i = ROOT_MOUNT; i >= -ROOT_MOUNT; i--) {
		const r = rnd(i / R);
		const e = rnd((i - R*r) / E);
		const a = rnd((i - R*r - E*e) / A);
		const c = rnd((i - R*r - E*e - A*a) / C);
		const t = i - R*r - E*e - A*a - C*c;
		LUT_R[i + Z] = r; LUT_E[i + Z] = e; LUT_A[i + Z] = a; LUT_C[i + Z] = c; LUT_T[i + Z] = t;
	}
})(Math.round);

const ZEROES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const EDGE_DIRTY_FLAG  = 0x80000000;
const EDGE_TARGET_MASK = 0x7FFFFFFF;
const ID_MULTIPLIER_BIGINT = BigInt(0x200000);

function refOf(ptr) { return _nodeGen[ptr] * ID_MULTIPLIER_BIGINT + BigInt(ptr); }

function isLive(ptr, gen) { return _nodeGen[ptr] === gen && _trits[ptr] !== 0; }

function deadCall(h, args) {
	if (args.length === 0 || (typeof args[0] === 'function' && !(args[0] instanceof Signal))) return undefined;
	const b = GraphNode.stateOf(h);
	return b !== undefined && b !== null && b.factory !== null && b.factory !== undefined ? undefined : h;
}

function isRunnable(ptr) { return typeof _values[ptr] === 'function' && (e_axis(_trits[ptr]) !== 0 || _parkedTrit[ptr] !== 0); }

const ZERO_POINT = 128;
class CachedThrow { constructor(e) { this.e = e; } }
const CORRUPTION = -128;

const FRESH_MIN  = +41, STALE_MAX = -41;
const EAGER_HI   = -41, EAGER_LO = -67;
const ZOMBIE_HI  = -68, ZOMBIE_LO = -94;

const TRIT_STORE 	= encode(+1,  0,  0,  0,  0);
const TRIT_STATE    = encode(+1,  0,  0,  0, -1);
const TRIT_COMPUTED = encode(-1, -1, +1, -0, -1);
const TRIT_EFFECT   = encode(-1,  1, -1, -0, -1);

const LOCK_DELTA   = R;
const DIRTY_DELTA  = R*2;
const SETTLE_DELTA = E*2;

const SIZES = { L1, L2, L3, L4, L5 };

const resolveSize = (x) => (typeof x === 'number' && x > 0 ? (x | 0) : (SIZES[x] ?? SIZES.L2));

const POLE = {
	R: { FRESH: 1, STASIS: 0, FROZEN: 0, STALE: -1 },
	E: { PUSH: 1, DETACHED: 0, PULL: -1 },
	A: { UNION: 1, PHANTOM: 0, CONSENSUS: -1, ANY: 1, AS: 0, ALL: -1 },
	C: { DEEP: 1, ATOMIC: 0, SHALLOW: -1 },
	T: { VOLATILE: 1, UNTRACKED: 0, SEMANTIC: -1 },
};

const _DESC_KEYS = new Set(['scope', 'key', 'value', 'get', 'set', 'options']);

const DOOR_KEYS = new Set(['Σ', 'ΣΣ', 'Φ', 'ΦΦ', '$', '$$', 'ø', 'Δ', 'ΔΔ', 'ψ']);
const RESERVED = new Set(['Σ', 'ΣΣ', '$', '$$', 'Φ', 'ø', 'Δ', 'ΔΔ',
                          'ψ', 'get', 'set', 'delete', 'clear']);

const _accessorSet = new Map();

const KWEAK = { mint(name, kind) { return (KWEAK[name] = kind === 'set' ? new WeakSet() : new WeakMap()); } };

const _deepCache = KWEAK.mint('deepCache', 'map');
const _proxySet  = KWEAK.mint('proxySet', 'set');

const _storeNested = KWEAK.mint('storeNested', 'map');
const _nodeHome = new Map();

const _hostNodes = new WeakMap();
const _parkedBy = new Map();
const _parkedHandles = new Map();
const PARKED_SLOT = Object.freeze({ parked: true });
const PARKED_STACK = Object.freeze([]);
let _parkedHosts = 0, _unparkHook = null;
let _arenaSerial = 0;

const _heldOf = new WeakMap();
let _collectedHook = null;

const _reaper = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry(held => {
	if (held.arena !== _arenaSerial) return;
	if (held.variant !== undefined) {
		const ref = held.variant, ptr = Number(ref % ID_MULTIPLIER_BIGINT), gen = ref / ID_MULTIPLIER_BIGINT;
		if (ptr > 0 && ptr < MAX_NODES && _nodeGen[ptr] === gen && _trits[ptr] !== 0) tagForDisposal(ptr);
		return;
	}
	const refs = held.refs;
	if (_parkedHosts > 0) _parkedHosts--;
	for (const ref of refs) {
		const ptr = Number(ref % ID_MULTIPLIER_BIGINT), gen = ref / ID_MULTIPLIER_BIGINT;
		if (!(ptr > 0 && ptr < MAX_NODES) || _nodeGen[ptr] !== gen || _trits[ptr] === 0) continue;
		tagForDisposal(ptr);
	}

	if (_collectedHook !== null && held.farewell !== undefined) { try { _collectedHook(held.farewell, held.leftAt, held.id); } catch (e) {} }
}) : null;
function ownBy(host, ptr, gen) {
	if (host === null || (typeof host !== 'object' && typeof host !== 'function')) return;
	const s = _hostNodes.get(host);

	if (s !== undefined) { if (gen === undefined) s.add(refOf(ptr)); else if (isLive(ptr, gen)) s.add(gen * ID_MULTIPLIER_BIGINT + BigInt(ptr)); }
}

function wakeSlot(ptr) {
	const r = _parkedBy.get(ptr), h = r !== undefined ? r.deref() : undefined;
	if (h !== undefined) GraphNode.unpark(h);
	return _parkedSlot[ptr] === 0;
}

function deathOfParked(ptr) {
	_parkedSlot[ptr] = 0;
	const by = _parkedBy.get(ptr);
	_parkedBy.delete(ptr);
	_values[ptr] = undefined; _predicates[ptr] = undefined;
	const wr = _parkedHandles.get(ptr);
	if (wr !== undefined) { _parkedHandles.delete(ptr); const hh = wr.deref(); if (hh !== undefined) _handles[ptr] = hh; }
	else if (by !== undefined) {
		const host = by.deref();
		if (host !== undefined && GraphNode.ptrOf(host) === ptr) _handles[ptr] = host;
	}
}

function parkedStub(ptr) {
	const gen = _nodeGen[ptr];
	const stub = function () {
		if (!isLive(ptr, gen)) return undefined;
		if (_parkedSlot[ptr] !== 0 && !wakeSlot(ptr)) return undefined;
		const f = _values[ptr];
		return (typeof f === 'function' && f !== stub) ? f.apply(this, arguments) : undefined;
	};
	return stub;
}

let _ownElements = false;
const _componentState = new WeakMap();

let MAX_NODES, MAX_EDGES, EDGE_MAX_STRIDE;
let _growAt = 0;

const RUN_SLOTS_CAP = 4096;
const _runSlots = new Int32Array(RUN_SLOTS_CAP);
let _runSlotsN = 0, _runSlotsFull = false;
let _runDepth = 0;

function resetFuse() {
	if (_runSlotsFull) _runCount.fill(0);
	else for (let i = 0; i < _runSlotsN; i++) _runCount[_runSlots[i]] = 0;
	_runSlotsN = 0; _runSlotsFull = false;
}

let _cursors, _edgePtr, _nodePtr, _globalUUID;

let _activeGen = 0n;
const _pausedGens = [];
function restoreActive(p, g) { _activePtr = (p === 0 || (_nodeGen[p] === g && _trits[p] !== 0)) ? p : 0; _activeGen = g; }
let _isFlushing, _isPaused, _isBooted;
let
	_trits, _freeMemoryAxis, _runCount, _depsCount, _layer, _durable,
	_readyCount, _edgeEpoch, _nodeTree, _nodeGen, _gateA, _owner, _predicates,
	_sigHead, _headDep, _pendingQueue, _pendingGens = [],
	_worklist, _edges, _values, _ctx, _detachDirty, _handles, _parkedTrit, _parkedSlot,

	_traceEpoch, _activePtr,
	_pendingHead, _pendingTail, _batchDepth,
	_rootPtr, _liveNodes, _freeNodeHead, _freeEdgeHead;

let _sharedBuffer = null;
let _arenaOffset  = 0;
let _isShared     = false;

function isDescriptor(a) {
	if (a === null || typeof a !== 'object' || Array.isArray(a)) return false;
	const ks = Object.keys(a);
	return ks.length > 0 && ks.every(k => _DESC_KEYS.has(k));
};

function r_axis(v, R) { return typeof R === U ? LUT_R[v+Z] : encode(R, LUT_E[v+Z], LUT_A[v+Z], LUT_C[v+Z], LUT_T[v+Z]) }
function e_axis(v, E) { return typeof E === U ? LUT_E[v+Z] : encode(LUT_R[v+Z], E, LUT_A[v+Z], LUT_C[v+Z], LUT_T[v+Z]) }
function a_axis(v, A) { return typeof A === U ? LUT_A[v+Z] : encode(LUT_R[v+Z], LUT_E[v+Z], A, LUT_C[v+Z], LUT_T[v+Z]) }
function c_axis(v, C) { return typeof C === U ? LUT_C[v+Z] : encode(LUT_R[v+Z], LUT_E[v+Z], LUT_A[v+Z], C, LUT_T[v+Z]) }
function t_axis(v, T) { return typeof T === U ? LUT_T[v+Z] : encode(LUT_R[v+Z], LUT_E[v+Z], LUT_A[v+Z], LUT_C[v+Z], T) }

const isClass = (x) => typeof x === 'function' && /^class[\s+{]/.test(Function.prototype.toString.call(x));
const isScope = (x) => x === null || isClass(x) || (typeof x === 'object' && x !== null && x[REACTIVE_STORE]);

const { is, is: $is, create: $create } = Object;

let allocNode = function() {
	if (!_isBooted) init(L2);
	return (allocNode = jsAllocNode)();
};

function init(size = L2) {

	if (!(size > 0) || size > Number(ID_MULTIPLIER_BIGINT)) throw new RangeError(`[Chimera ${version}] arena size ${size} exceeds the ref layout (max ${Number(ID_MULTIPLIER_BIGINT)} slots per shard)`);

	const N = (MAX_NODES = size);
	const E = (MAX_EDGES = size * 4);

	EDGE_MAX_STRIDE = E * EDGE_STRIDE;

	[ _trits, _freeMemoryAxis ] = ψ(Int8Array, N, N);
	[ _runCount, _depsCount, _readyCount ] = ψ(Uint16Array, N, N, N);
	_runSlotsN = 0; _runSlotsFull = false;
	[ _nodeTree ] = ψ(Uint32Array, N * 3);

	if (_handles !== undefined) {
		for (const h of _handles) if (h !== undefined) GraphNode.mark(h);
		for (const wr of _parkedHandles.values()) { const h = wr.deref(); if (h !== undefined) GraphNode.mark(h); }
		for (const wr of _parkedBy.values()) { const h = wr.deref(); if (h !== undefined) GraphNode.mark(h); }
	}
	_nodeHome.clear(); _recipes.clear(); _accessorSet.clear();
	_activePtr = 0; _activeGen = 0n; _pausedGens.length = 0; _pendingGens.length = 0;
	[ _sigHead, _headDep, _edges ] = ψ(Int32Array, N, N, EDGE_MAX_STRIDE);
	[ _nodeGen, _edgeEpoch ] = ψ(BigUint64Array, N, E + 1);
	[ _values, _ctx, _pendingQueue, _worklist ] = ψ(Array, N, N, 0, 0);

	_layer = new Uint8Array(MAX_NODES);
	_durable = new Uint8Array(MAX_NODES);
	_detachDirty = new Uint8Array(MAX_NODES);
	_gateA = new Uint8Array(MAX_NODES);
	_owner = new Array(MAX_NODES);
	_predicates = new Array(MAX_NODES);
	_handles = new Array(MAX_NODES);
	_parkedSlot = new Uint8Array(MAX_NODES);
	_parkedHosts = 0; _parkedBy.clear(); _parkedHandles.clear(); _arenaSerial++;
	_parkedTrit = new Int8Array(MAX_NODES);
	_growAt = growAtOf(N);
	_edgePtr = EDGE_STRIDE;
	_nodePtr = 1;

	if (_globalUUID === undefined) _globalUUID = 0n;
	_traceEpoch = 0n;

	[
	  _activePtr, _pendingHead, _pendingTail, _batchDepth,
	  _rootPtr, _liveNodes, _freeNodeHead, _freeEdgeHead, _isFlushing, _isPaused
	] = ZEROES;

	_values.fill(void 0);
	_ctx.fill(null);

    _isBooted = true;
}

const growAtOf = (n) => Math.floor(n * 0.9);
function grow() {
	if (_isShared || !_isBooted) return false;
	const size = MAX_NODES * 2;
	if (size > Number(ID_MULTIPLIER_BIGINT)) return false;
	const N0 = MAX_NODES, N = (MAX_NODES = size), E = (MAX_EDGES = size * 4);
	EDGE_MAX_STRIDE = E * EDGE_STRIDE;
	const up = (old, Ctor, n) => { const a = new Ctor(n); a.set(old); return a; };
	_trits = up(_trits, Int8Array, N); _freeMemoryAxis = up(_freeMemoryAxis, Int8Array, N); _parkedTrit = up(_parkedTrit, Int8Array, N);
	_runCount = up(_runCount, Uint16Array, N); _depsCount = up(_depsCount, Uint16Array, N); _readyCount = up(_readyCount, Uint16Array, N);
	_nodeTree = up(_nodeTree, Uint32Array, N * 3);
	_sigHead = up(_sigHead, Int32Array, N); _headDep = up(_headDep, Int32Array, N);
	_edges = up(_edges, Int32Array, EDGE_MAX_STRIDE);
	_nodeGen = up(_nodeGen, BigUint64Array, N); _edgeEpoch = up(_edgeEpoch, BigUint64Array, E + 1);
	_layer = up(_layer, Uint8Array, N); _durable = up(_durable, Uint8Array, N); _detachDirty = up(_detachDirty, Uint8Array, N);
	_gateA = up(_gateA, Uint8Array, N); _parkedSlot = up(_parkedSlot, Uint8Array, N);
	_values.length = N; _ctx.length = N; _owner.length = N; _predicates.length = N; _handles.length = N;
	for (let i = N0; i < N; i++) _ctx[i] = null;
	_growAt = growAtOf(N);
	return true;
}

class Abstract extends null {
	constructor(host) {
		if (new.target === Abstract) throw new TypeError('[Chimera] Abstract is abstract — construct through Signal');
		if (host !== undefined) return host;
		const handle = function ƒ(...args) {
			return handle[CALL](...args);
		};
		Object.setPrototypeOf(handle, new.target.prototype);
		return handle;
	}
}

class GraphNode extends Abstract {

	#ptr; #gen; #dead = false;

	get #zombie() { return this.#dead === true || _trits[this.#ptr] === 0; }

	set #zombie(v) { if (v === true) { this.#dead = true; this.#gen = -1n; } }
	[MARK]() { this.#zombie = true; }
	#store = null;

	constructor(ptr, gen, host) {
		super(host);
		this.#ptr = ptr;
		this.#gen = gen;
	}

	static ptrOf(h) { return h.#ptr; }
	static genOf(h) { return h.#gen; }

	static dead(h) { return h.#dead === true || _trits[h.#ptr] === 0; }

	static stateOf(h) { const b = h.#store; return b !== null ? b : _componentState.get(h); }

	static ensureState(h) {
		const b = h.#store;
		if (b !== null) return b;
		const side = _componentState.get(h);
		if (side !== undefined) return side;
		if (Object.isExtensible(h) && !(REACTIVE_STORE in h))
			Object.defineProperty(h, REACTIVE_STORE, { value: h, configurable: !(h instanceof Signal) });
		return (h.#store = { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade: undefined, engine: root(),
		                     effectiveDepth: 0, union: false, isEffect: false, factory: null,
		                     trieRoot: null, leafQueue: null, maxSize: 0, sigOf: null, liveCount: 0, leafTrit: 0, parked: null, asleep: null });
	}
	static mark(h) { h.#zombie = true; }
	static rebind(h, ptr, gen) { h.#ptr = ptr; h.#gen = gen; h.#dead = false; if (!isLive(ptr, gen)) h.#zombie = true; }
	get [PTR]() { return this.#ptr; }
	get [GEN]() { return this.#gen; }

	static isZombie(h) { return !((typeof h === 'function' || (typeof h === 'object' && h !== null)) && #gen in h) || h.#dead || _trits[h.#ptr] === 0 || _nodeGen[h.#ptr] !== h.#gen; }
	static isSignal(o) { return (typeof o === 'function' || (typeof o === 'object' && o !== null)) && #gen in o; }

	static {

		Signal.prototype = GraphNode.prototype;
		Object.defineProperty(GraphNode.prototype, 'constructor',
			{ value: Signal, writable: true, configurable: true });
	}

	static #ref = null;

	static State = class State extends Signal {};

	static Store = class Store extends Signal {

		constructor(data, options = {}, host) {
			super(host);

			Object.defineProperty(this, REACTIVE_STORE, { value: this, configurable: host !== undefined });

			const obj      = data !== null && typeof data === 'object';
			const isEngine = obj && typeof data[PTR] === 'number' && typeof data.get === 'function';
			const factory  = typeof data === 'function' ? data
			               : typeof options.factory === 'function' ? options.factory : null;
			const seed     = obj && !isEngine && !Array.isArray(data) ? data : null;

			const effectiveDepth = options.depth ?? (options.deep ? Infinity : 0);
			const union    = !!options.union;
			const quorum   = options.union === false;
			const isEffect = !!options.effect;
			const cAxis    = effectiveDepth > 1 ? 1 : effectiveDepth === 1 ? -1 : 0;

			const tAxis    = options.volatile ? 1 : options.untracked ? 0 : -1;

			const engine = isEngine ? data : root(), cascade = options.cascade;
			_storeFamily.set(this, union ? 1 : -1);
			_storeDepth.set(this, effectiveDepth);
			this.#store   = factory
				? { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade, engine,
				    effectiveDepth, union, isEffect, factory,
				    trieRoot : trieNode(),
				    leafQueue: [],
				    maxSize  : options.maxSize ?? 10000,
				    sigOf    : typeof options.key === 'function'
				                 ? args => [options.key.apply(null, args)]
				                 : args => args,
				    liveCount: 0,
				    quorum,
				    leafTrit : encode(-1, 1, union ? 1 : -1, cAxis, tAxis), parked: null, asleep: null }
				: { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade, engine,
				    effectiveDepth, union, isEffect: false, factory: null,
				    trieRoot: null, leafQueue: null, maxSize: 0, sigOf: null, liveCount: 0, leafTrit: 0, parked: null, asleep: null };

			if (seed) { assertDisciplines(seed); for (const k of Object.keys(seed)) storeWrite(this, k, seed[k]); }
		}
	}

	static Computed = class Computed extends GraphNode.Store {
		constructor(fn, opts) {
			if (typeof fn !== 'function') throw new TypeError('Computed expects a function');
			super(fn, opts);

			const bag = this.#store;
			armHead(this, bag, trieDescend(bag.trieRoot, NO_OPERANDS), e_axis(bag.leafTrit, -1));
		}
	};
	static Effect = class Effect extends GraphNode.Store {
		constructor(fn, opts) {
			if (typeof fn !== 'function') throw new TypeError('Effect expects a function');
			super(fn, { ...(opts || {}), effect: true });
			this();
		}
	};

	static deref(ref) {
		if (typeof ref !== 'bigint') return;
		const ptr = Number(ref % ID_MULTIPLIER_BIGINT);
		const gen = ref / ID_MULTIPLIER_BIGINT;
		if (ptr <= 0 || ptr >= MAX_NODES || _nodeGen[ptr] !== gen || _trits[ptr] === 0) return;
		return Signal(ptr);
	}

	static init(size = 'L2') {
		void init(resolveSize(size));
		const rootPtr = allocNode();
		_trits[rootPtr] = ROOT_MOUNT;
		return (GraphNode.#ref = Signal(rootPtr));
	}

	static root() { return root(); }

	static get() { return GraphNode.#ref ?? new Substrate('L2'); }

	static teardown() {
		init(L1);
		GraphNode.#ref = null;
		return true;
	}

	static wipe() {}

	static batch(fn) { _batchDepth++; try { return fn(); } finally { if (--_batchDepth === 0) flushQueue(); } }
	static untrack(fn) { const prev = _activePtr, prevGen = _activeGen; _activePtr = 0; try { return fn(); } finally { restoreActive(prev, prevGen); } }

	static subscribe(c, s) {
		if ((typeof c !== 'number' && (!c || GraphNode.dead(c))) || (typeof s !== 'number' && (!s || GraphNode.dead(s)))) return false;
		return subscribe(typeof c === 'number' ? c : GraphNode.ptrOf(c), typeof s === 'number' ? s : GraphNode.ptrOf(s));
	}
	static unsubscribe(c, s) {
		if ((typeof c !== 'number' && (!c || GraphNode.dead(c))) || (typeof s !== 'number' && (!s || GraphNode.dead(s)))) return false;
		return unsubscribe(typeof c === 'number' ? c : GraphNode.ptrOf(c), typeof s === 'number' ? s : GraphNode.ptrOf(s));
	}

	static find(scope, key, query = 'value') {
		if (scope == null || typeof key !== 'string') return;
		const store = scope[REACTIVE_STORE];
		if (!store) return;
		const cleanKey = key.endsWith('()') ? key.slice(0, -2) : key;
		const ref = stateOf(store).dict.get(cleanKey);
		if (query === 'id') return ref != null ? Number(ref / ID_MULTIPLIER_BIGINT) : undefined;
		if (query === 'node' || key.endsWith('()')) return ref != null ? Signal.deref(ref) : undefined;
		return storeRead(store, cleanKey);
	}

	static adopt(host, data, options) {
		if (host === null || (typeof host !== 'object' && typeof host !== 'function')) throw new TypeError('[Chimera] adopt: the host must be an object');
		if (#gen in host) throw new TypeError('[Chimera] adopt: the host already carries a node');

		if (!Object.isExtensible(host)) throw new TypeError('[Chimera] adopt: the host is not extensible');
		const h = new Signal.Store(data, options, host);
		if (h !== host) throw new TypeError('[Chimera] adopt: construction did not return the host');

		const own = host.#gen * ID_MULTIPLIER_BIGINT + BigInt(host.#ptr);
		const refs = new Set([own]);
		_hostNodes.set(host, refs);
		const held = { refs, id: own, leftAt: 0n, farewell: undefined, arena: _arenaSerial };
		_heldOf.set(host, held);
		if (_reaper !== null) _reaper.register(host, held, host);
		return host;
	}

	static release(h) {
		GraphNode.unpark(h);
		const refs = _hostNodes.get(h);
		if (refs !== undefined) {
			if (_reaper !== null) _reaper.unregister(h);
			_hostNodes.delete(h); _heldOf.delete(h);

			const own = h.#ptr, ownGen = h.#gen;
			for (const ref of refs) { const p = Number(ref % ID_MULTIPLIER_BIGINT), g = ref / ID_MULTIPLIER_BIGINT; if (!(p === own && g === ownGen) && p > 0 && p < MAX_NODES && _nodeGen[p] === g && _trits[p] !== 0) tagForDisposal(p); }
		}
		GraphNode.prototype.dispose.call(h);
		if (!(h instanceof Signal)) { try { delete h[REACTIVE_STORE]; } catch (e) {} }
	}

	static park(h, sleep = true) {
		const refs = _hostNodes.get(h), b = h.#store;
		if (refs === undefined || b === null || b.parked !== null || h.#dead === true) return false;

		for (const ref of b.dict.values()) if (typeof ref === 'bigint') refs.add(ref);
		const own = new Set(), ptrs = [];
		const take = p => { if (p > 0 && p !== _rootPtr && !own.has(p) && _trits[p] !== 0 && _parkedSlot[p] === 0) { own.add(p); ptrs.push(p); } };
		for (const ref of refs) {
			const p = Number(ref % ID_MULTIPLIER_BIGINT);
			if (_nodeGen[p] === ref / ID_MULTIPLIER_BIGINT && _trits[p] !== 0) take(p); else refs.delete(ref);
		}
		for (let i = 0; i < ptrs.length; i++)
			for (let c = _nodeTree[ptrs[i] * 3 + TREE_CHILD]; c !== 0; c = _nodeTree[c * 3 + TREE_SIB]) take(c);
		for (const p of ptrs) for (let e = _sigHead[p]; e !== 0; e = _edges[e + EDGE_NEXT]) {
			const c = _edges[e + EDGE_TARGET] & EDGE_TARGET_MASK;
			if (c !== 0 && _trits[c] !== 0 && !own.has(c)) return false;
		}
		for (const p of ptrs) refs.add(refOf(p));
		let asleep = b.asleep;

		if (sleep !== false) for (const p of ptrs) if (e_axis(_trits[p]) === 1 && _parkedTrit[p] === 0) {
			detach(p);
			if (_parkedTrit[p] !== 0) (asleep ??= []).push(refOf(p));
		}
		b.asleep = asleep;
		const n = ptrs.length, rec = { ptrs, gens: new Array(n), handles: new Array(n), owner: new Array(n), values: new Array(n),
			ctx: new Array(n), predicates: new Array(n), home: new Array(n), setter: new Array(n), recipe: new Array(n) };
		const wr = new WeakRef(h);
		for (let i = 0; i < n; i++) {
			const p = ptrs[i];
			rec.gens[i] = _nodeGen[p];

			const hd = _handles[p];
			rec.handles[i] = hd;
			if (hd !== undefined) { _handles[p] = undefined; if (hd !== h) _parkedHandles.set(p, new WeakRef(hd)); }
			rec.owner[i] = _owner[p]; _owner[p] = undefined;
			const v = _values[p];
			rec.values[i] = v; _values[p] = typeof v === 'function' ? parkedStub(p) : PARKED_SLOT;
			rec.ctx[i] = _ctx[p]; _ctx[p] = null;
			const pr = _predicates[p];
			rec.predicates[i] = pr; if (pr !== undefined) _predicates[p] = PARKED_STACK;
			const home = _nodeHome.get(p); if (home !== undefined) { rec.home[i] = home; _nodeHome.delete(p); }
			const setter = _accessorSet.get(p); if (setter !== undefined) { rec.setter[i] = setter; _accessorSet.delete(p); }
			const recipe = _recipes.get(p); if (recipe !== undefined) { rec.recipe[i] = recipe; _recipes.delete(p); }
			_parkedSlot[p] = 1;
			_parkedBy.set(p, wr);
		}
		b.parked = rec;
		_parkedHosts++;
		{ const held = _heldOf.get(h); if (held !== undefined) held.leftAt = _traceEpoch; }
		return true;
	}
	static unpark(h) {
		if (h === null || (typeof h !== 'object' && typeof h !== 'function') || !(#gen in h)) return false;
		const b = h.#store, rec = b !== null ? b.parked : null;
		if (rec === null) return false;
		b.parked = null;
		if (_parkedHosts > 0) _parkedHosts--;
		const { ptrs } = rec;
		for (let i = 0; i < ptrs.length; i++) {
			const p = ptrs[i];

			if (_parkedSlot[p] === 0 || _nodeGen[p] !== rec.gens[i] || _trits[p] === 0) continue;
			_parkedBy.delete(p);
			_parkedSlot[p] = 0;
			if (rec.handles[i] !== undefined) _handles[p] = rec.handles[i];
			_parkedHandles.delete(p);
			_owner[p] = rec.owner[i]; _values[p] = rec.values[i]; _ctx[p] = rec.ctx[i]; _predicates[p] = rec.predicates[i];
			if (rec.home[i] !== undefined) _nodeHome.set(p, rec.home[i]);
			if (rec.setter[i] !== undefined) _accessorSet.set(p, rec.setter[i]);
			if (rec.recipe[i] !== undefined) _recipes.set(p, rec.recipe[i]);
		}
		if (_unparkHook !== null) { try { _unparkHook(h); } catch (e) {} }
		return true;
	}
	static wake(h) {
		if (h === null || (typeof h !== 'object' && typeof h !== 'function') || !(#gen in h)) return false;
		const b = h.#store;
		if (b === null) return false;
		const asleep = b.asleep;
		b.asleep = null;
		GraphNode.unpark(h);
		if (asleep === null) return false;
		for (const ref of asleep) {
			const p = Number(ref % ID_MULTIPLIER_BIGINT);
			if (_nodeGen[p] === ref / ID_MULTIPLIER_BIGINT && _trits[p] !== 0 && _parkedTrit[p] !== 0) attach(p);
		}
		return true;
	}

	static own(h, node) {

		if (GraphNode.isSignal(node) && node.#dead !== true && _trits[node.#ptr] !== 0) {
			const s = _hostNodes.get(h);
			if (s !== undefined && h.#dead !== true) {
				s.add(node.#gen * ID_MULTIPLIER_BIGINT + BigInt(node.#ptr));

				const b = node.#store;
				if (b !== null && b.factory !== null && b.engine[PTR] === _rootPtr) {
					const ep = allocNode();
					_trits[ep] = ROOT_MOUNT; _durable[ep] = 1;
					b.engine = createCallableHandle(Signal, ep, _nodeGen[ep]); _handles[ep] = b.engine;
					s.add(refOf(ep));
				}
			}
		}
		return node;
	}
	static parked(h) { return h !== null && (typeof h === 'object' || typeof h === 'function') && #gen in h && h.#store !== null && h.#store.parked !== null; }

	static farewell(h, value) { const held = _heldOf.get(h); if (held === undefined || value === h) return false; held.farewell = value; return true; }
	static set onCollected(fn) { _collectedHook = typeof fn === 'function' ? fn : null; }
	static get onCollected() { return _collectedHook; }
	static get epoch() { return _traceEpoch; }

	static get capacity() { return MAX_NODES; }
	static get live() { return _liveNodes; }
	static grow() { return grow(); }
	static idOf(h) { const held = _heldOf.get(h); return held !== undefined ? held.id : undefined; }

	static refOf(h) { return h !== null && (typeof h === 'object' || typeof h === 'function') && #gen in h ? h.#gen * ID_MULTIPLIER_BIGINT + BigInt(h.#ptr) : undefined; }
	static set onUnpark(fn) { _unparkHook = typeof fn === 'function' ? fn : null; }
	static get onUnpark() { return _unparkHook; }
	static get ownElements() { return _ownElements; }
	static set ownElements(v) { _ownElements = v === true; }
	static dictOf(h) { const b = h.#store; return b !== null ? b.dict : _componentState.get(h).dict; }
	static rawOf(h) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return undefined;
		if (_parkedHosts !== 0) GraphNode.unpark(h);
		return _values[h.#ptr];
	}

	static head(h, ...v) {
		if (h.#dead === true || h.#zombie || _trits[h.#ptr] === 0) return undefined;
		if (_parkedSlot[h.#ptr] !== 0) wakeSlot(h.#ptr);
		if (v.length === 0) return get(h.#ptr);
		set(h.#ptr, v[0]);
		return h;
	}

	static read(h, key) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return undefined;
		if (_parkedHosts !== 0) GraphNode.unpark(h);
		if (h.#store === null) GraphNode.ensureState(h);
		return storeRead(h, key);
	}
	static write(h, key, val) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return h;
		if (_parkedHosts !== 0) GraphNode.unpark(h);
		if (h.#store === null) GraphNode.ensureState(h);
		storeWrite(h, key, val);
		return h;
	}
	static has(h, key) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return false;
		const b = h.#store, st = b !== null ? b : _componentState.get(h);
		if (st === undefined) return false;
		const r = st.dict.get(canonKey(key));
		return r != null && !!Signal.deref(r);
	}
	static remove(h, key) {
		if (h.#dead === true || _trits[h.#ptr] === 0) return false;
		if (_parkedHosts !== 0) GraphNode.unpark(h);
		if (h.#store === null && _componentState.get(h) === undefined) return false;
		return storeDelete(h, key);
	}

	static door(h, name, owner) {
		if (name === 'ψ') return triad(h, 'Δ', true, owner === undefined ? h : owner);
		if (typeof name !== 'string' || !DOOR_KEYS.has(name)) return undefined;
		return triad(h, name, sigilMeta(name).type === 'union', null);
	}

	static subtle = {
		Watcher: class Watcher {
			constructor(notifyFn) {
				if (typeof notifyFn !== 'function') throw new TypeError('Watcher expects a callback');
				this._notify = notifyFn;
				this._node = _wire(encode(-1, -1, -1, 0, -1), () => this._notify(), 0);
			}
			watch(...signals) {
				if (GraphNode.dead(this._node)) return;
				const prev = _activePtr, prevGen = _activeGen; _activePtr = this._node[PTR]; _activeGen = GraphNode.genOf(this._node);
				for (const sig of signals) if (GraphNode.isSignal(sig) && !GraphNode.dead(sig)) track(GraphNode.ptrOf(sig));
				restoreActive(prev, prevGen);
				const v = _trits[this._node[PTR]];
				if (e_axis(v) === -1) _trits[this._node[PTR]] = v + SETTLE_DELTA;
			}
			unwatch() { if (!GraphNode.dead(this._node)) cleanupDeps(this._node[PTR]); }
		}
	};

	get ref()  { return this.#gen * ID_MULTIPLIER_BIGINT + BigInt(this.#ptr); }

	get $()    { return GraphNode.door(this, '$');  }
	get $$()   { return GraphNode.door(this, '$$'); }
	get Δ()    { return GraphNode.door(this, 'Δ');  }
	get ΔΔ()   { return GraphNode.door(this, 'ΔΔ'); }
	get ø()    { return GraphNode.door(this, 'ø');  }
	get Σ()    { return GraphNode.door(this, 'Σ');  }
	get ΣΣ()   { return GraphNode.door(this, 'ΣΣ'); }
	get Φ()    { return GraphNode.door(this, 'Φ');  }
	get ΦΦ()   { return GraphNode.door(this, 'ΦΦ'); }
	get ψ()    { return GraphNode.door(this, 'ψ', this); }
	ψFor(owner){ return GraphNode.door(this, 'ψ', owner); }

	[CALL](...args) {

		if (this.#dead === true) return deadCall(this, args);
		if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr);
		if (this.#store !== null && this.#store.factory !== null) return this.#computeMemo(args);
		if (args.length === 0) {

			const home = _nodeHome.get(this.#ptr);
			if (home !== void 0) return GraphNode.read(home.store, home.key);
			return get(this.#ptr);
		}
		if (typeof args[0] === 'function' && !(args[0] instanceof Signal))
			{ installRecipe(this.#ptr, args[0], args[1]); return this; }

		const acc = _accessorSet.size !== 0 ? _accessorSet.get(this.#ptr) : undefined;
		if (acc !== undefined) { acc.call(this, args[0]); if (!this.#zombie && t_axis(_trits[this.#ptr]) !== 0) trigger(this.#ptr); return this; }
		if (isRunnable(this.#ptr)) {
			if (bindOperands(this.#ptr, args)) return this;
			{ installConstant(this.#ptr, args[0]); return this; }
		}
		set(this.#ptr, args[0]);
		return this;
	}

	[Symbol.toPrimitive](hint) {
		const v = (hint === 'default') ? this.peek() : this.get();
		if (hint === 'number') return typeof v === 'number' ? v : (Number(v) || 0);
		if (hint === 'string') return v != null ? String(v) : '';
		return v ?? null;
	}

	get(...args) {
		if (this.#zombie) return void 0;
		if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr);
		const st = this.#store;
		if (st !== null && st.factory !== null) return this.#computeMemo(args);
		if (args.length === 0) return get(this.#ptr);
		if (st === null) GraphNode.ensureState(this);
		return storeRead(this, args[0]);
	}
	peek() { return this.#zombie ? void(0) : get(this.#ptr, false); }
	set(...args) {
		if (this.#zombie) return this;
		if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr);
		const st = this.#store;
		if (st !== null && st.factory !== null) throw new Error(
			'[Chimera] Store(factory): set() unavailable — values are computed; use get(...args)');
		if (args.length === 0) return this;
		if (args.length === 1) {
			const p = this.#ptr;
			const s = _accessorSet.size !== 0 ? _accessorSet.get(p) : undefined;
			if (s !== undefined) {
				s.call(this, args[0]);
				if (!this.#zombie && t_axis(_trits[p]) !== 0) trigger(p);
			} else if (isRunnable(p) && !isFrozen(p)) installConstant(p, args[0]);
			else set(p, args[0]);
			return this;
		}
		if (st === null) GraphNode.ensureState(this);
		if (args[2] === true) {
			const ref = GraphNode.stateOf(this).dict.get(canonKey(args[0]));
			if (ref != null) {
				const node = Signal.deref(ref);
				if (node && !isFrozen(node[PTR])) silentSet(node[PTR], args[1]);
			}
			return this;
		}
		storeWrite(this, args[0], args[1]);
		return this;
	}
	delete(...args) {
		if (this.#zombie) return false;
		if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr);
		const bag = this.#store;
		if (bag !== null && bag.factory !== null) {
			const sig = bag.sigOf(args);
			if (this.#zombie) return false;
			const leaf = triePeek(bag.trieRoot, sig);
			if (!leaf?.node) return false;
			const { [PTR]: ptr, [GEN]: gen } = leaf.node;
			triePrune(leaf);
			bag.liveCount--;
			if (ptr === this.#ptr) { retypeInert(ptr); return true; }
			dropFromQueue(bag.leafQueue, ptr, gen);
			if (isLive(ptr, gen)) tagForDisposal(ptr);
			return true;
		}

		if (args.length === 0) { this.dispose(); return true; }
		const st = bag !== null ? bag : _componentState.get(this);
		return st === undefined ? false : storeDelete(this, args[0]);
	}

	clear() {
		if (this.#zombie) return this;
		if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr);
		const st = this.#store;
		if (st !== null) {
			if (st.factory !== null) { clearLeaves(st); if (isRunnable(this.#ptr)) retypeInert(this.#ptr); return this; }
			clearKeys(st);
		}

		const p = this.#ptr;
		if (isRunnable(p) && !isFrozen(p)) installConstant(p, undefined); else set(p, undefined);
		return this;
	}

	has(...args) {
		if (this.#zombie) return args.length === 0 ? 0 : false;
		const b = this.#store, st = b !== null ? b : _componentState.get(this);
		if (st === undefined) return args.length === 0 ? 0 : false;
		if (args.length === 0) {
			if (st.factory !== null) {
				let n = isRunnable(this.#ptr) ? 1 : 0;
				for (const e of st.leafQueue) if (isLive(e[PTR], e[GEN])) n++;
				return n;
			}
			let n = 0;
			for (const ref of st.dict.values()) {
				const node = Signal.deref(ref);
				if (node && _trits[node[PTR]] > 40) n++;
			}
			return n;
		}
		if (st.factory !== null) return liveLeaf(triePeek(st.trieRoot, st.sigOf(args)));
		const r = st.dict.get(canonKey(args[0]));
		return r != null && !!Signal.deref(r);
	}

	update(key, fn) {
		if (this.#zombie) throw new TypeError('Store has been disposed');
		if (typeof key === 'function' && fn === undefined) {
			GraphNode.prototype.set.call(this, key(get(this.#ptr, false)));
			return true;
		}
		if (this.#store === null) GraphNode.ensureState(this);
		if (typeof fn !== 'function') { GraphNode.write(this, key, fn); return true; }
		GraphNode.write(this, key, fn(storeRead(this, key)));
		return true;
	}

	#computeMemo(args) { return computeMemo(this, this.#store, args); }

	poke(v)    { const st = this.#store; if (st !== null && st.factory !== null) noStore('poke'); if (!this.#zombie) rawset(this.#ptr, v); return this; }

	detach() {
		if (this.#zombie) throw new TypeError('Disposed');
		if (isFrozen(this.#ptr)) throw new TypeError('Frozen signal cannot detach');
		detach(this.#ptr);
		return this;
	}

	attach(sign) {
		if (this.#zombie) throw new TypeError('Disposed');
		const s = sign === undefined ? undefined : (sign === -1 || sign === false) ? -1 : 1;
		attach(this.#ptr, s);
		return this;
	}
	freeze() {
		if (this.#zombie) return this;
		const st = this.#store;
		if (st !== null) {

			for (const ref of st.dict.values()) {
				const node = Signal.deref(ref);
				if (node && !isFrozen(node[PTR])) freeze(node[PTR], true);
			}

			if (st.factory !== null) return this;
		}

		freeze(this.#ptr);
		return this;
	}
	thaw() {
		if (this.#zombie) return this;

		thaw(this.#ptr);

		const st = this.#store;
		if (st !== null) {
			for (const ref of st.dict.values()) {
				const node = Signal.deref(ref);
				if (node && isFrozen(node[PTR])) thaw(node[PTR]);
			}
		}
		return this;
	}
	keep()     { if (!this.#zombie) adopt(root()[PTR], this.#ptr); return this; }
	dispose()  {
		if (this.#zombie) return;

		const st = this.#store !== null ? this.#store : _componentState.get(this);
		if (st !== undefined) {
			if (st.factory != null) {
				clearLeaves(st);
				const e = st.engine;
				if (e !== undefined && e[PTR] !== _rootPtr && !GraphNode.dead(e)) tagForDisposal(e[PTR]);
			}
			else clearKeys(st);
		}
		tagForDisposal(this.#ptr);
	}
	reattach() { return this.attach(); }

	subscribe(source) {
		if (!GraphNode.isSignal(source))
			throw new TypeError('Expected a Signal');
		if (this.#zombie || isZombie(source))
			throw new TypeError('Cannot subscribe to/from a disposed signal');

		const consumerPtr = this.#ptr;
		const sourcePtr   = GraphNode.ptrOf(source);

		if (t_axis(_trits[consumerPtr]) === 0)
			throw new TypeError('An untracked signal cannot subscribe');
		if (t_axis(_trits[sourcePtr]) === 0)
			throw new TypeError('Cannot subscribe to an untracked signal');

		return subscribe(consumerPtr, sourcePtr);
	}

	unsubscribe(source) {
		if (!GraphNode.isSignal(source))
			throw new TypeError('Expected a Signal');
		if (this.#zombie || isZombie(source))
			return false;

		return unsubscribe(this.#ptr, GraphNode.ptrOf(source));
	}

	clone() {
		if (this.#zombie) throw new TypeError('Cannot clone a disposed Signal');

		return Signal.untrack(() => {

			if (this.#store !== null) {
				const newStore = new Signal.Store();
				for (const key of this.#store.dict.keys()) {
					const ref = this.#store.dict.get(key);
					const node = Signal.deref(ref);
					if (node) {

						const rawValue = get(node[PTR], false);

						storeWrite(newStore, key, rawValue);
					}
				}
				return newStore;
			}

			const currentValue = get(this.#ptr, false);
			return new Signal.State(currentValue);
		});
	}

	raw() { if (this.#zombie) return undefined; if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr); return _values[this.#ptr]; }
	compose(...args) {
		if (this.#zombie) return undefined;
		if (_parkedSlot[this.#ptr] !== 0) wakeSlot(this.#ptr);
		const ptr = this.#ptr, gen = this.#gen;
		const isState = !isRunnable(ptr);
		if (args.length === 0) {
			const s = _predicates[ptr];
			return s === undefined ? [] : s.map(e => e.name !== undefined ? [e.name, e.args] : ['(anonymous)']);
		}
		if (args[0] === null) {
			if (_predicates[ptr] === undefined) return this;
			_predicates[ptr] = undefined;
			if (isState) {
				const prev = _ctx[ptr]; _ctx[ptr] = undefined; cleanupDeps(ptr);
				if (!is(prev, _values[ptr]) && t_axis(_trits[ptr]) !== 0) trigger(ptr);
			} else { _trits[ptr] = r_axis(_trits[ptr], -1); trigger(ptr); }
			return this;
		}
		let entry;
		if (typeof args[0] === 'function') entry = ø({ fn: args[0] });
		else {
			const name = String(args[0]);
			const reg = _composers.get(name);
			if (!reg) throw new TypeError('[Chimera] compose: no composer named "' + name + '" — Signal.compose(name, factory) first');
			const gArgs = args.slice(1);
			entry = ø({ name, args: gArgs, fn: reg(...gArgs) });
			if (!isLive(ptr, gen)) return undefined;
		}
		if (typeof entry.fn !== 'function') throw new TypeError('[Chimera] compose: the factory must return a gate function');
		const stack = _predicates[ptr] ?? (_predicates[ptr] = []);
		stack.push(entry);
		if (isState) {

			if (e_axis(_trits[ptr]) === 0 && _parkedTrit[ptr] === 0) _trits[ptr] = e_axis(_trits[ptr], -1);
			cleanupDeps(ptr);
			const prev = _ctx[ptr];
			const out = runMembrane(ptr, _values[ptr]);
			if (out !== VETO && isLive(ptr, gen)) { _ctx[ptr] = out; if (!is(prev, out) && t_axis(_trits[ptr]) !== 0) trigger(ptr); }
		} else { _trits[ptr] = r_axis(_trits[ptr], -1); trigger(ptr); }
		let dead = false;
		const self = this;
		return function off() {
			if (dead) return; dead = true;

			if (!isLive(ptr, gen)) return;
			if (_parkedSlot[ptr] !== 0) wakeSlot(ptr);
			const s = _predicates[ptr]; if (!s) return;
			const i = s.indexOf(entry); if (i >= 0) s.splice(i, 1);
			if (s.length === 0) _predicates[ptr] = undefined;
			if (!isRunnable(ptr)) {
				cleanupDeps(ptr);
				const prev = _ctx[ptr];
				const out = runMembrane(ptr, _values[ptr]);
				if (!isLive(ptr, gen)) return;
				const pub = out === VETO ? prev : out;
				_ctx[ptr] = _predicates[ptr] === undefined ? undefined : pub;
				if (!is(prev, pub) && t_axis(_trits[ptr]) !== 0) trigger(ptr);
			} else { _trits[ptr] = r_axis(_trits[ptr], -1); trigger(ptr); }
		};
	}
	untrack(fn) {
		const prev = _activePtr, prevGen = _activeGen;
		_activePtr = 0;
		try { return fn() } finally { restoreActive(prev, prevGen) }
	}

	map(fn) { return _wire(TRIT_COMPUTED, (() => this.#zombie ? null : fn(this.get())), 0); }

	filter(pred) {
		let last = this.peek();
		return _wire(
			TRIT_COMPUTED, (() => {
				if (this.#zombie) return (last = undefined);
				const v = this.get(); if (pred(v)) last = v; return last; }), 0
		);
	}
	combine(o, fn) {
		return _wire(
			TRIT_COMPUTED, (() => {
				const oSig = o && typeof o.get === 'function';
				if (this.#zombie || (oSig && GraphNode.isZombie(o))) return undefined;
				return fn(this.get(), oSig ? o.get() : o); }), 0
		);
	}
	effect(fn) {
		if (this.#zombie) return;
		const c = _wire(TRIT_EFFECT, fn, -1);
		if (GraphNode.dead(c)) return c;
		if (this.#zombie) { c.dispose(); return c; }
		adopt(this.#ptr, c[PTR]);
		return c;
	}

	static {

		Object.setPrototypeOf(Signal, GraphNode);
		Object.setPrototypeOf(GraphNode.prototype, null);
	}
}

class Substrate extends Signal {

	constructor(config = {}) {
        if (typeof config === 'string') config = { size: config };
        const size = config.size ?? 'L2';

        if (config.multithreaded || config.wasm || config.__wasmMemory)
            throw new Error('Chimera 18.3.q: multithreaded/wasm arenas are STRIPPED in this kernel-work build — use shipped Chimera-18_3_p.js');

        const root = Signal.init(size);
        splice(root, Substrate.prototype, ['constructor']);
        console.log(TEXT_SYNC, 'color: #f59e0b;');
        return root;
    }

    static wipe() {}

	get activeNodes() { return _liveNodes; }
	get loadFactor() { return _liveNodes / (MAX_NODES || 1); }
	get density() { return _nodePtr / (MAX_NODES || 1); }

	get paused() { return _isPaused === 1; }

	pause() { _isPaused = 1; }
	resume() { _isPaused = 0; flushQueue(); }
	signal(key, value, opts = {}) {
		let depth = 0, raw = value;
		if (raw !== null && typeof raw === 'object' && raw[LAYER] !== void 0) { depth = raw[LAYER]; raw = raw.value; }
		else if (typeof opts.layer === 'number') depth = opts.layer;
		else if (opts.deep) depth = Infinity;
		let trit = opts._trit ?? encode(1, 1, 1, -1, -1);
		if (depth > 0) trit = a_axis(trit, depth === 1 ? -1 : 1);
		return _wire(trit, raw, opts.free | 0);
	}
}

function jsAllocNode() {
    for (var ptr;;) {
        if (_freeNodeHead !== 0) { ptr = _freeNodeHead; _freeNodeHead = _headDep[ptr]; break; }
        if (_nodePtr < MAX_NODES) { ptr = _nodePtr++; break; }
        if (grow()) continue;
        throw new Error(`[Chimera ${version}] arena OOM: ${MAX_NODES} slots, the ceiling of the ref layout, and ${_liveNodes} live — dispose() what the page no longer needs (an element nothing holds frees itself at the end of the task); a page may start larger with arena="L4" on an Instance <script> tag`);
    }

    _nodeGen[ptr] = ++_globalUUID;
    _headDep[ptr] = _sigHead[ptr] = 0;
    _nodeTree[(ptr*3) + TREE_PARENT] = 0;
	_nodeTree[(ptr*3) + TREE_CHILD] = 0;
	_nodeTree[(ptr*3) + TREE_SIB] = 0;
	_layer[ptr] = 0;
    _values[ptr] = undefined;
    _ctx[ptr] = null;
    _runCount[ptr] = _depsCount[ptr] = _readyCount[ptr] = 0;
    _freeMemoryAxis[ptr] = 0;
    if (++_liveNodes >= _growAt) grow();
    return ptr;
}

function allocEdge() {
    for (var idx;;) {
        if (_freeEdgeHead !== 0) {
            idx = _freeEdgeHead;
            _freeEdgeHead = _edges[(idx + EDGE_NEXT)];
            break;
        }
        if ((_edgePtr + EDGE_STRIDE) < EDGE_MAX_STRIDE) {
            idx = _edgePtr;
            _edgePtr += EDGE_STRIDE;
            break;
        }
        if (grow()) continue;
        throw new Error(`[Chimera ${version}] arena OOM: ${MAX_EDGES} edges, the ceiling of the ref layout — dispose() what the page no longer needs; a page may start larger with arena="L4" on an Instance <script> tag`);
    }

    _edges[(idx + EDGE_TARGET)]   = 0;
    _edges[(idx + EDGE_NEXT)]     = 0;
    _edges[(idx + EDGE_PREV_SUB)] = 0;
    _edges[(idx + EDGE_PAIR)]     = 0;
    _edgeEpoch[(idx >> EDGE_SHIFT)] = 0n;
    return idx;
}

function freeNode(ptr) {
	_trits[ptr] = 0;
	_nodeGen[ptr] = 0n;
	{ const h = _handles[ptr]; if (h !== undefined) GraphNode.mark(h); }
	_handles[ptr] = undefined;
	_parkedTrit[ptr] = 0;
	_layer[ptr] = 0;
	_durable[ptr] = 0;
	_gateA[ptr] = 0;
	_owner[ptr] = undefined;
	_predicates[ptr] = undefined;
	_values[ptr] = undefined;
	_ctx[ptr] = null;
	if (_accessorSet.size !== 0) _accessorSet.delete(ptr);

	if (_nodeHome.size !== 0) _nodeHome.delete(ptr);
	if (_recipes.size !== 0) _recipes.delete(ptr);
	_parkedSlot[ptr] = 0;
	if (_parkedBy.size !== 0) _parkedBy.delete(ptr);
	if (_parkedHandles.size !== 0) _parkedHandles.delete(ptr);
	_headDep[ptr] = _freeNodeHead;
	_freeNodeHead = ptr;
	_liveNodes--;
}

function freeEdge(idx) {
	_edges[idx + EDGE_NEXT] = _freeEdgeHead;
	_freeEdgeHead = idx;
}

function layer(depth, value) { return { [LAYER]: depth, value }; }

function subscribe(consumer, source) {
	for (
		let dep = _headDep[consumer]; dep !== 0; dep = _edges[(dep + EDGE_NEXT)]
	) {
		if (_edges[(dep + EDGE_TARGET)] === source) {
			_edgeEpoch[(dep >> EDGE_SHIFT)] = _traceEpoch;
			return false;
		}
	}
	const subIdx = allocEdge();
	try { var depIdx = allocEdge(); } catch (e) { freeEdge(subIdx); throw e; }
	try {
		_edges[(subIdx + EDGE_TARGET)] = consumer;
		_edges[(depIdx + EDGE_TARGET)] = source;
		_edges[(subIdx + EDGE_PAIR)] = depIdx;
		_edges[(depIdx + EDGE_PAIR)] = subIdx;
		_edgeEpoch[(subIdx >> EDGE_SHIFT)] = _traceEpoch;
		_edgeEpoch[(depIdx >> EDGE_SHIFT)] = _traceEpoch;

		const sHead = _sigHead[source];
		_edges[(subIdx + EDGE_NEXT)] = sHead;
		_edges[(subIdx + EDGE_PREV_SUB)] = 0;
		if (sHead !== 0) _edges[(sHead + EDGE_PREV_SUB)] = subIdx;
		_sigHead[source] = subIdx;
		_edges[(depIdx + EDGE_NEXT)] = _headDep[consumer];
		_headDep[consumer] = depIdx;
		if (_trits[source] !== 0) _depsCount[consumer]++;
	} catch (e) {
		freeEdge(subIdx);
		freeEdge(depIdx);
		throw e;
	}
	return true;
}

function walkSubscribers(p, fn) {
    const tp = _nodeTree[(p * 3) + TREE_PARENT];
    for (let sub = _sigHead[p]; sub !== 0;) {
        const raw      = _edges[sub + EDGE_TARGET];
        const consumer = raw & EDGE_TARGET_MASK;
        const next     = _edges[sub + EDGE_NEXT];
        if (consumer !== 0 && consumer !== tp && _trits[consumer] !== 0 && !isFrozen(consumer))
            fn(consumer, raw, sub);
        sub = next;
    }
}

function dirtyConsumer(consumer, cv) {
	const nv = cv - DIRTY_DELTA;
	_trits[consumer] = nv;
	if (e_axis(nv) === 1) {
		_pendingGens[_pendingTail] = _nodeGen[consumer];
		_pendingQueue[_pendingTail++] = consumer;
		return true;
	}
	return false;
}

function unlinkSub(subIdx, source) {
	const p = _edges[(subIdx + EDGE_PREV_SUB)];
	const n = _edges[(subIdx + EDGE_NEXT)];
	if (p === 0) _sigHead[source] = n; else _edges[(p + EDGE_NEXT)] = n;
	if (n !== 0) _edges[(n + EDGE_PREV_SUB)] = p;
}

function unsubscribe(consumer, source) {
	let prev = 0;
	for (
		let dep = _headDep[consumer]; dep !== 0; prev = dep, dep = _edges[(dep + EDGE_NEXT)]
	) {
		if (_edges[(dep + EDGE_TARGET)] !== source) continue;
		if (prev === 0) _headDep[consumer] = _edges[(dep + EDGE_NEXT)];
		else _edges[(prev + EDGE_NEXT)] = _edges[(dep + EDGE_NEXT)];
		const sub = _edges[(dep + EDGE_PAIR)];
		unlinkSub(sub, source);
		freeEdge(sub);
		freeEdge(dep);
		if (_depsCount[consumer] > 0 && _trits[source] !== 0) _depsCount[consumer]--;
		return true;
	}
	return false;
}

function adopt(parent, child) {
	if (parent === 0 || child === 0 || parent === child) return;
	unlinkSibling(child);
	_nodeTree[(child*3) + TREE_PARENT] = parent;
	_nodeTree[(child*3) + TREE_SIB]    = _nodeTree[(parent*3) + TREE_CHILD];
	_nodeTree[(parent*3) + TREE_CHILD] = child;
}

function unlinkSibling(child) {
	const parent = _nodeTree[(child*3) + TREE_PARENT];
	if (parent === 0) return;
	let prev = 0;
	let cur = _nodeTree[(parent*3) + TREE_CHILD];
	while (cur !== 0 && cur !== child) {
		prev = cur;
		cur = _nodeTree[(cur*3) + TREE_SIB];
	}
	if (cur === child) {
		if (prev === 0) _nodeTree[(parent*3) + TREE_CHILD] = _nodeTree[(child*3) + TREE_SIB];
		else _nodeTree[(prev*3) + TREE_SIB] = _nodeTree[(child*3) + TREE_SIB];
	}
	_nodeTree[(child*3) + TREE_PARENT] = 0;
	_nodeTree[(child*3) + TREE_SIB] = 0;
}

function trigger(sigPtr) {
	const _sv = _trits[sigPtr];
	if (_sv < -121 || _sv > 121) return;

	const sig = _trits[sigPtr];
	if (sig >= -40 && sig <= 40) return;

	let queued = false;
	let wi = 0;
	const work = [sigPtr];

	while (wi < work.length) {
		const source = work[wi++];
		for (let e = _sigHead[source]; e !== 0;) {

			const nx     = _edges[e + EDGE_NEXT];
			const packed = _edges[e + EDGE_TARGET];
			const target = packed & EDGE_TARGET_MASK;
			const v 	 = _trits[target];

			if (v !== 0 && e_axis(v) === 0 && r_axis(v) !== 0) {
				_detachDirty[target] = 1;
				e = nx;
				continue;
			}
			if (v > 40) {
				if (a_axis(v) === -1 && ((typeof _values[target] !== 'function' && _predicates[target] === undefined) || _gateA[target] === 1)) {
					if (packed >= 0) {
						_edges[e + EDGE_TARGET] = packed | EDGE_DIRTY_FLAG;

						if (++_readyCount[target] >= _depsCount[target]) {
							queued = dirtyConsumer(target, v) || queued;
							if (_sigHead[target] !== 0) work.push(target);
						}
					}
				} else {
					if (v > 40) {
						if (e_axis(v) === 1) queued = dirtyConsumer(target, v) || queued;
						else _trits[target] = v - DIRTY_DELTA;
					}
					if (_sigHead[target] !== 0) work.push(target);
				}
			}
			e = nx;
		}
	}
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

function flushQueue() {
	if (_isFlushing || _isPaused) return;
	_isFlushing = 1;
	try {
		while (_pendingHead < _pendingTail) {
			const g = _pendingGens[_pendingHead], ptr = _pendingQueue[_pendingHead++];

			if (_nodeGen[ptr] !== g || _trits[ptr] === 0) continue;
			if (_freeMemoryAxis[ptr] > 0) next(ptr);
			else runNode(ptr);
		}
	} finally {
		_isFlushing = 0;
		_pendingHead = _pendingTail = 0;

		if (_pendingGens.length > 1024) { _pendingGens.length = 0; _pendingQueue.length = 0; }
		resetFuse();
	}
}

function runNode(ptr) {
	_runDepth++;
	try { runNodeOnce(ptr); }
	finally { if (--_runDepth === 0 && !_isFlushing) resetFuse(); }
}

function runNodeOnce(ptr) {
	if (_parkedSlot[ptr] !== 0 && !wakeSlot(ptr)) return;

	const v = _trits[ptr];
	if (v === 0) return;
	if (v < EAGER_LO || v > EAGER_HI) return;
	if (_runCount[ptr] === 0) {
		if (_runSlotsN < RUN_SLOTS_CAP) _runSlots[_runSlotsN++] = ptr;
		else _runSlotsFull = true;
	}
	if (++_runCount[ptr] > 100) {
		const _panic = new Error(`[Chimera ${version}] Topology Panic: at ${ptr}`);
		_ctx[ptr] = new CachedThrow(_panic);
		throw _panic;
	}

	const gen = _nodeGen[ptr];
	_trits[ptr] = (v + LOCK_DELTA);
	const prevActive = _activePtr, prevGen = _activeGen;
	cleanupDeps(ptr);
	_activePtr = ptr; _activeGen = gen;
	_traceEpoch++;

	if (_nodeTree[(ptr*3) + TREE_CHILD] !== 0) {
		disposeChildren(ptr);

		if (!isLive(ptr, gen)) { restoreActive(prevActive, prevGen); return; }
	}
	try {
		const fn = _ctx[ptr]?.[GEN_CTX] || _values[ptr];
		const res = typeof fn === 'function' ? fn() : void 0;

		if (!isLive(ptr, gen)) return;
		if (typeof res?.next === 'function') {
			res[GEN_CTX] = fn;
			_ctx[ptr] = res;
			_freeMemoryAxis[ptr] = 1;
		} else if (res !== undefined && e_axis(v) === 1) {
			const prev = _ctx[ptr];
			const cAx = c_axis(_trits[ptr]);
			const out = cAx !== 0 ? resultProxy(res, cAx === 1 ? Infinity : 1, ptr) : res;
			_ctx[ptr] = out;
			_trits[ptr] = e_axis(_trits[ptr], -1);
			settle(ptr, prev, out);
		}
		_trits[ptr] += LOCK_DELTA;
	} catch (e) {
		console.error(`[Chimera ${version}] runNode error:`, e);
		if (!isLive(ptr, gen)) return;
		const _pv = _ctx[ptr];
		_ctx[ptr] = new CachedThrow(e);
		_trits[ptr] += LOCK_DELTA;
		settle(ptr, _pv, _ctx[ptr]);
	} finally {
		restoreActive(prevActive, prevGen);
	}
	if (typeof _ctx[ptr]?.next === 'function' && isLive(ptr, gen)) next(ptr);
}

function detach(ptr) {
	const v = _trits[ptr];
	const e = e_axis(v);
	if (v === 0 || e === 0) return;
	if (v >= -40 && v <= 40) return;
	_parkedTrit[ptr] = v;
	_detachDirty[ptr] = 0;
	_trits[ptr] = r_axis(v - e * E, 1);
	invalidateConsumers(ptr);
}

function attach(ptr, sign) {
	const v = _trits[ptr];
	if (e_axis(v) !== 0) return;
	const ticket = _parkedTrit[ptr];
	if (ticket === 0) return;
	const s = (sign === 1 || sign === -1) ? sign : e_axis(ticket);
	if (s === 0) return;
	_parkedTrit[ptr] = 0;
	const dirty = _detachDirty[ptr] === 1;
	_detachDirty[ptr] = 0;
	revalidateConsumers(ptr);
	const t = t_axis(v);
	const run = t === 1 || (t === -1 && dirty);
	if (run) {
		_trits[ptr] = r_axis(v + s * E, -1);
		s === 1 ? runNode(ptr) : recompute(ptr);
	} else {
		_trits[ptr] = r_axis(v + s * E, 1);
	}
}

function recompute(ptr) {
	if (_parkedSlot[ptr] !== 0 && !wakeSlot(ptr)) return;

	const v = _trits[ptr];
	if (v >= -40) return;
	const gen = _nodeGen[ptr];
	_trits[ptr] = (v + LOCK_DELTA);
	const fn = _values[ptr];

	if (typeof fn !== 'function') {
		if (_predicates[ptr] !== undefined) {
			cleanupDeps(ptr);
			const prev = _ctx[ptr];
			const out = runMembrane(ptr, fn);
			if (!isLive(ptr, gen)) return false;
			if (out !== VETO) _ctx[ptr] = out;
			_trits[ptr] += LOCK_DELTA;
			if (out !== VETO && !is(prev, out)) settle(ptr, prev, out);
			return true;
		}
		_readyCount[ptr] = 0;

		const deps = [];
		for (let d = _headDep[ptr]; d !== 0; d = _edges[(d + EDGE_NEXT)]) {
			const sub = _edges[(d + EDGE_PAIR)];
			if (sub !== 0) {
				_edges[(sub + EDGE_TARGET)] &= EDGE_TARGET_MASK;
			}
			const t = _edges[(d + EDGE_TARGET)];
			deps.push(t, _nodeGen[t]);
		}
		for (let i = 0; i < deps.length; i += 2) {
			if (isLive(deps[i], deps[i + 1])) recompute(deps[i]);
			if (!isLive(ptr, gen)) return false;
		}
		_trits[ptr] += LOCK_DELTA;
		return true;
	}

	const prevActive = _activePtr, prevGen = _activeGen;
	cleanupDeps(ptr);
	_activePtr = ptr; _activeGen = gen;
	_traceEpoch++;
	if (_nodeTree[(ptr*3 + TREE_CHILD)] !== 0) {
		disposeChildren(ptr);
		if (!isLive(ptr, gen)) { restoreActive(prevActive, prevGen); return false; }
	}
	try {
		let res = fn();
		if (!isLive(ptr, gen)) { restoreActive(prevActive, prevGen); return false; }
		let landed = true;
		if (_predicates[ptr] !== undefined) {
			const gated = runMembrane(ptr, res);
			if (!isLive(ptr, gen)) { restoreActive(prevActive, prevGen); return false; }
			if (gated === VETO) landed = false; else res = gated;
		}
		if (landed) {
			const cAx = c_axis(_trits[ptr] - LOCK_DELTA);
			_ctx[ptr] = cAx !== 0 ? resultProxy(res, cAx === 1 ? Infinity : 1, ptr) : res;
		}
	}
	catch (e) { if (!isLive(ptr, gen)) { restoreActive(prevActive, prevGen); return false; } _ctx[ptr] = new CachedThrow(e); }
	_trits[ptr] += LOCK_DELTA;
	restoreActive(prevActive, prevGen);
	return true;
}

function disposeChildren(ptr) {

	for (let child; (child = _nodeTree[(ptr*3 + TREE_CHILD)]) !== 0;) {
		_nodeTree[(ptr*3 + TREE_CHILD)] = _nodeTree[(child*3 + TREE_SIB)];
		_nodeTree[(child*3 + TREE_PARENT)] = 0;
		_nodeTree[(child*3 + TREE_SIB)] = 0;
		tagForDisposal(child);
	}
}

function hasExternalReader(p) {
	const tp = _nodeTree[(p*3 + TREE_PARENT)];
	for (
		let sub = _sigHead[p]; sub !== 0; sub = _edges[(sub + EDGE_NEXT)]
	) {
		if ((_edges[(sub + EDGE_TARGET)] & EDGE_TARGET_MASK) !== tp) return true;
	}
	return false;
}

function next(ptr) {
    if (_parkedSlot[ptr] !== 0 && !wakeSlot(ptr)) return;
    if (_trits[ptr] === 0) return;
    const savedGen = _nodeGen[ptr];
    let iter = _ctx[ptr];
    if (!iter || typeof iter.next !== 'function' || iter[AWAITING]) {
        const fn = iter?.[GEN_CTX] || _values[ptr];
        if (typeof fn !== 'function') return;
        iter = fn();
        if (!isLive(ptr, savedGen)) return;
        if (!iter || typeof iter.next !== 'function') return;
        iter[GEN_CTX] = fn;
        _ctx[ptr] = iter;
    }

    const prevActive = _activePtr, prevGen = _activeGen;

    cleanupDeps(ptr);
    _activePtr = ptr; _activeGen = savedGen;
    _traceEpoch++;

    const step = (result) => {
        if (!isLive(ptr, savedGen)) return;
        if (result.done) {
            _values[ptr] = result.value;
            _ctx[ptr] = { [GEN_CTX]: iter[GEN_CTX] };
            if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
            trigger(ptr);
            return;
        }
        const y = result.value;
        if (typeof y?.then === 'function') {
            iter[AWAITING] = true;
            y.then(onValue, onError);
        } else {
            _values[ptr] = y;
            if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
            trigger(ptr);
        }
    };
    const onValue = (v) => {

        if (!isLive(ptr, savedGen)) return;
        if (_parkedSlot[ptr] !== 0) wakeSlot(ptr);
        if (_ctx[ptr] !== iter) return;
        iter[AWAITING] = false;
        _values[ptr] = v;
        if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
        trigger(ptr);
        if (!isLive(ptr, savedGen)) return;
        _pendingGens[_pendingTail] = savedGen;
        _pendingQueue[_pendingTail++] = ptr;
        flushQueue();
    };
    const onError = (e) => {
        if (!isLive(ptr, savedGen)) return;
        if (_parkedSlot[ptr] !== 0) wakeSlot(ptr);
        if (_ctx[ptr] !== iter) return;
        iter[AWAITING] = false;
        let rr;
        try { rr = iter.throw(e); }
        catch (fatal) {
            if (!isLive(ptr, savedGen)) return;
            _values[ptr] = new CachedThrow(fatal);
            if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
            trigger(ptr);
            return;
        }
        step(rr);
    };
    let restored = false;
    try {
        const result = iter.next(_values[ptr]);
        restoreActive(prevActive, prevGen); restored = true;
        step(result);
    } catch (e) {
        console.error(`[Chimera ${version}] next error:`, e);
        if (!isLive(ptr, savedGen)) return;
        _values[ptr] = new CachedThrow(e);
        if (_trits[ptr] !== 0) _trits[ptr] = r_axis(_trits[ptr], 1);
        trigger(ptr);
    } finally {
        if (!restored) restoreActive(prevActive, prevGen);
    }
}

function logicalSweep(ptr) {

    const frontier = [];

    if (_nodeTree[(ptr*3 + TREE_CHILD)] !== 0) disposeChildren(ptr);
    unlinkSibling(ptr);

    cleanupDeps(ptr, 1);

    let subIdx = _sigHead[ptr];
    while (subIdx !== 0) {
        const depIdx   = _edges[(subIdx + EDGE_PAIR)];
        const rawSub   = _edges[(subIdx + EDGE_TARGET)];
        const nextSub  = _edges[(subIdx + EDGE_NEXT)];
        const consumer = (rawSub & EDGE_TARGET_MASK);
        const cv       = consumer !== 0 ? _trits[consumer] : 0;

        if (cv !== 0) {
            if (rawSub < 0 && _readyCount[consumer] > 0) _readyCount[consumer]--;
            if (_depsCount[consumer] > 0) _depsCount[consumer]--;
            if (cv > 40) {
                const eAxis = e_axis(cv);
                if (eAxis === 1) {
                    if (_depsCount[consumer] === 0) detach(consumer);
                }
				else if (eAxis === -1 && _freeMemoryAxis[ptr] <= 0) {
                    frontier.push(consumer);
                }
            }
        }

        if (depIdx !== 0) {
            let prev = 0;
			let cur = _headDep[consumer];
            while (cur !== 0 && cur !== depIdx) {
				prev = cur;
				cur = _edges[(cur + EDGE_NEXT)];
			}
            if (cur === depIdx) {
                if (prev === 0) _headDep[consumer] = _edges[(depIdx + EDGE_NEXT)];
                else	_edges[(prev + EDGE_NEXT)] = _edges[(depIdx + EDGE_NEXT)];
            }
            _edges[(depIdx + EDGE_TARGET)] &= EDGE_TARGET_MASK;
            freeEdge(depIdx); _edgeEpoch[(depIdx >> EDGE_SHIFT)] = 0n;
        }

        freeEdge(subIdx); _edgeEpoch[(subIdx >> EDGE_SHIFT)] = 0n;
        subIdx = nextSub;
    }

    _sigHead[ptr] = 0;
    _nodeTree[((ptr*3) + TREE_PARENT)] = 0;
    _nodeTree[((ptr*3) + TREE_CHILD)]  = 0;
    _nodeTree[((ptr*3) + TREE_SIB)]    = 0;

    for (let i = 0; i < frontier.length;) {
        const consumer = frontier[i++];
        const ev0 = _trits[consumer];
        if (ev0 > 40 && e_axis(ev0) === -1) {
            _trits[consumer] = (ev0 - DIRTY_DELTA);
        }
    }
}

function cleanupDeps(ptr, reap) {

	_depsCount[ptr] = _readyCount[ptr] = 0;
	let depIdx = _headDep[ptr];

	while (depIdx !== 0) {
		const subIdx = _edges[(depIdx + EDGE_PAIR)];
		const signal = _edges[(depIdx + EDGE_TARGET)];
		const nx     = _edges[(depIdx + EDGE_NEXT)];

		if (subIdx !== 0) {
			unlinkSub(subIdx, signal);
			freeEdge(subIdx);
			_edgeEpoch[(subIdx >> EDGE_SHIFT)] = 0n;
		}

		_edges[(depIdx + EDGE_TARGET)] &= EDGE_TARGET_MASK;
		freeEdge(depIdx);
		_edgeEpoch[(depIdx >> EDGE_SHIFT)] = 0n;

		if (reap &&
			signal !== 0 &&
			signal !== ptr &&
			_durable[signal] === 0 &&
			_nodeTree[(signal*3 + TREE_PARENT)] !== 0 &&
			_nodeTree[(signal*3 + TREE_CHILD)]  === 0 &&
			_parkedTrit[signal] === 0 &&
			!hasExternalReader(signal)
		) {
			tagForDisposal(signal);
		}

		depIdx = nx;
	}
	_headDep[ptr] = 0;
}

function invalidateConsumers(p) {
	walkSubscribers(p, (consumer, raw, sub) => {
		if (raw < 0) {
			_edges[(sub + EDGE_TARGET)] &= EDGE_TARGET_MASK;
			if (_readyCount[consumer] > 0) _readyCount[consumer]--;
		}
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
	});
}

function revalidateConsumers(p) {
	walkSubscribers(p, (consumer) => {
		if (_trits[consumer] > -40) _depsCount[consumer]++;
	});
}

function fireAndWithdraw(p) {

	if (_trits[p] >= -40 && _trits[p] <= 40 && _trits[p] !== 0) return;
	let queued = false;
	walkSubscribers(p, (consumer, raw, sub) => {
		const cv = _trits[consumer];
		if (cv <= -40) return;
		if (
			cv > 40 &&
			e_axis(cv) === -1 &&
			typeof _values[consumer] === 'function'
		) {
			if (_depsCount[consumer] > 0) _depsCount[consumer]--;
			_trits[consumer] = cv - DIRTY_DELTA;
			return;
		}
		if ((raw & EDGE_DIRTY_FLAG) === 0) {
			_edges[(sub + EDGE_TARGET)] |= EDGE_DIRTY_FLAG;
			_readyCount[consumer]++;
		}
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
		if (cv > 40 && (a_axis(cv) === 1 || _readyCount[consumer] >= _depsCount[consumer])) {
			queued = dirtyConsumer(consumer, cv) || queued;
		}
	});
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

function get(ptr, mark = true) {
    if (_parkedSlot[ptr] !== 0 && !wakeSlot(ptr)) return;
    const v = _trits[ptr];
    if (v === 0) return;
    if (v < -40 || (t_axis(v) === 1 && e_axis(v) === -1 && v > 40 && typeof _values[ptr] === 'function')) {
        if (v >= -40) _trits[ptr] = r_axis(v, -1);

        if (recompute(ptr) === false) return;
    }
    const locus = _values[ptr];
    const value = (typeof locus === 'function' && (e_axis(v) !== 0 || _parkedTrit[ptr] !== 0)) ? _ctx[ptr]
                : (_predicates[ptr] !== undefined && typeof locus !== 'function') ? _ctx[ptr]
                : locus;
    if (value instanceof CachedThrow) {
        if (mark !== false && !(v >= -40 && v <= 40)) track(ptr);
        throw value.e;
    }
    if (v >= -40 && v <= 40) return value;
    if (mark !== false) track(ptr);
    return value;
}

function track(ptr) {
    const a = _activePtr;
    if (a === 0 || a === ptr) return;
    if (t_axis(_trits[a]) === 0) return;
    if (t_axis(_trits[ptr]) === 0) return;
    subscribe(a, ptr);
}

function set(ptr, val, cascade = true) {
    if (_parkedSlot[ptr] !== 0 && !wakeSlot(ptr)) return;
    const v = _trits[ptr];
    if (v === 0) return;
    if (v >= -40 && v <= 40) throw new TypeError('❄️ Cannot write to frozen Signal');
    if (e_axis(v) === 0 && _parkedTrit[ptr] !== 0) {
    	if (typeof _values[ptr] === 'function') _ctx[ptr] = val;
    	else _values[ptr] = val;
        return;
    }
    if (_predicates[ptr] !== undefined && typeof _values[ptr] !== 'function') return predicatedWrite(ptr, val);
    const changed = !is(_values[ptr], val);
    _values[ptr] = val;
    const t = t_axis(v);
    if (t === 1 || (t === -1 && changed)) trigger(ptr);
}

function freeze(ptr, deep = true) {
    const v = _trits[ptr];
    if (v >= -40 && v <= 40) return;
    _trits[ptr] = r_axis(v, 0);
    if (deep) {
        let child = _nodeTree[(ptr * 3) + TREE_CHILD];
        while (child !== 0) {
            freeze(child, true);
            child = _nodeTree[(child * 3) + TREE_SIB];
        }
    }
}

function thaw(ptr) {
	const v = _trits[ptr];
	if (v > 40 || v < -40 || v === 0) return;
	_trits[ptr] = r_axis(v, -1);
	recompute(ptr);
}

function tagForDisposal(ptr) {
    if (_trits[ptr] === 0) return;
    if (_parkedSlot[ptr] !== 0) deathOfParked(ptr);
    if (ptr === _activePtr) _activePtr = 0;
    _trits[ptr] = 0;
    { const h = _handles[ptr]; if (h !== undefined) GraphNode.mark(h); }
    logicalSweep(ptr);
    freeNode(ptr);
}

function rawset(ptr, val) {
    const v = _trits[ptr];
    if (v === 0) return;
    if (v >= -40 && v <= 40) throw new TypeError('❄️ Cannot write to frozen Signal');
    _values[ptr] = val;
    if (t_axis(v) !== 0) trigger(ptr);
}

function silentSet(ptr, val) {
	if (_trits[ptr] === 0) return;
	_values[ptr] = val;
}

const _composers = new Map();
const VETO = Symbol('veto');
function runMembrane(ptr, incoming) {
	const stack = _predicates[ptr];
	if (stack === undefined) return incoming;
	const owner = _owner[ptr];
	const lens  = owner ? GraphNode.door(owner, '\u03A6') : undefined;
	const self  = _ctx[ptr];
	const prevA = _activePtr, prevGen = _activeGen, gen = _nodeGen[ptr];
	_activePtr = ptr; _activeGen = gen; _traceEpoch++;
	try {
		let cur = incoming;
		for (let i = 0; i < stack.length; i++) {
			cur = stack[i].fn.call(lens, lens, self, cur);
			if (cur === undefined) return VETO;
			if (!isLive(ptr, gen)) return VETO;
		}
		return cur;
	} finally { restoreActive(prevA, prevGen); }
}
function predicatedWrite(ptr, val) {
	const gen = _nodeGen[ptr];
	cleanupDeps(ptr);
	const out = runMembrane(ptr, val);
	if (out === VETO || !isLive(ptr, gen)) return;
	const prevPub = _ctx[ptr];
	_values[ptr] = val;
	_ctx[ptr] = out;
	const t = t_axis(_trits[ptr]);
	if (t === 1 || (t === -1 && !is(prevPub, out))) trigger(ptr);
}
function activeOwner() { return _activePtr !== 0 ? _owner[_activePtr] : undefined; }
Signal.activeOwner = activeOwner;
Signal.pauseTracking  = function ()  { const p = _activePtr; _pausedGens.push(_activeGen); _activePtr = 0; return p; };

Signal.resumeTracking = function (p) { const g = _pausedGens.pop(); _activePtr = (typeof p === 'number' && p > 0 && _nodeGen[p] === g && _trits[p] !== 0) ? p : 0; _activeGen = g; };
Signal.compose = function (name, factory) {
	if (typeof factory !== 'function') throw new TypeError('[Chimera] Signal.compose(name, factory)');
	_composers.set(String(name), new Signal.Store(factory, { depth: 0 }));
	return Signal;
};

const _recipes = new Map();
const NO_OPERANDS = Object.freeze([]);
function wrapRecipe(ptr, rec) {
	const { fn, lens, ops } = rec;

	const self = lens ?? _handles[ptr];
	return ops.length === 0 ? () => fn.call(self, lens)
	                        : () => fn.call(self, lens, ...ops);
}
function sameOperands(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!is(a[i], b[i])) return false;
	return true;
}

function bindOperands(ptr, args) {
	const rec = _recipes.get(ptr);
	if (rec === undefined) return false;
	if (isFrozen(ptr)) throw new TypeError('[Chimera] a frozen cell cannot take an operand \u2744');
	if (sameOperands(rec.ops, args)) return true;
	rec.ops = args.length === 0 ? NO_OPERANDS : args.slice();
	_values[ptr] = wrapRecipe(ptr, rec);
	_trits[ptr] = r_axis(_trits[ptr], -1);
	if (e_axis(_trits[ptr]) === 1) runNode(ptr); else trigger(ptr);
	return true;
}
function installRecipe(ptr, fn, opts) {
	const cur = _trits[ptr];
	if (cur === 0) return undefined;
	if (isFrozen(ptr)) throw new TypeError('[Chimera] a frozen cell cannot take a formula \u2744');
	cleanupDeps(ptr);
	const owner = _owner[ptr];
	const lens  = owner ? GraphNode.door(owner, '\u03A6') : undefined;
	const oA = opts && opts.affect  != null ? POLE.A[String(opts.affect).toUpperCase()]  : undefined;
	const oC = opts && opts.capture != null ? POLE.C[String(opts.capture).toUpperCase()] : undefined;
	let A = oA !== undefined ? oA : a_axis(cur);
	if (A === 0) A = 1;
	const C = oC !== undefined ? oC : c_axis(cur);
	const E = opts && opts.effect === 'push' ? 1 : -1;
	_gateA[ptr] = A === -1 ? 1 : 0;
	const prev = _recipes.get(ptr);
	const rec = { fn, lens, ops: prev !== undefined ? prev.ops : NO_OPERANDS };
	_recipes.set(ptr, rec);
	_values[ptr] = wrapRecipe(ptr, rec);
	_ctx[ptr] = undefined;
	_trits[ptr] = encode(-1, E, A, C, -1);
	if (E === 1) runNode(ptr);
	else trigger(ptr);
	return _handles[ptr];
}

function retypeConstant(ptr) {
	const cur = _trits[ptr];
	if (_recipes.size !== 0) _recipes.delete(ptr);
	cleanupDeps(ptr);
	_gateA[ptr] = 0;
	_predicates[ptr] = undefined;
	_ctx[ptr] = undefined;
	_trits[ptr] = encode(1, 0, a_axis(cur), c_axis(cur), t_axis(cur) || -1);
}
function installConstant(ptr, v) {
	if (_trits[ptr] === 0) return undefined;
	if (isFrozen(ptr)) throw new TypeError('[Chimera] frozen \u2744');
	const prev = _ctx[ptr];
	retypeConstant(ptr);
	_values[ptr] = v;
	if (!Object.is(prev, v)) trigger(ptr);
	return _handles[ptr];
}

function root() {
	if (_rootPtr === 0) { _rootPtr = allocNode(); _trits[_rootPtr] = ROOT_MOUNT; }
	return Signal(_rootPtr);
}

function splice(to, from, skip) {
	for (const key of Reflect.ownKeys(from)) {
		if (!skip.includes(key)) {
			Object.defineProperty(to, key, Object.getOwnPropertyDescriptor(from, key));
		}
	} return to;
}

function isZombie(handle) { return GraphNode.isZombie(handle); }

function _wire(trit, val, free, ctor) {
	const ptr = allocNode();
	_durable[ptr] = 1;
	_trits[ptr] = trit;
	_values[ptr] = val;
	if (free) _freeMemoryAxis[ptr] = free;
	if (_activePtr !== 0) adopt(_activePtr, ptr);

	const h = createCallableHandle(ctor === undefined ? Signal : ctor, ptr, _nodeGen[ptr]);
	_handles[ptr] = h;
	if (trit >= EAGER_LO && trit <= EAGER_HI) runNode(ptr);
	return h;
}

function settle(ptr, prev, next, manual) {
	if (next === undefined) {
		if (!manual) invalidateConsumers(ptr);
		else if (prev !== undefined) fireAndWithdraw(ptr);
	} else trigger(ptr);
}

function reconcileSubtree(store, name, prevValue, nextValue) {

    const previousIsObject = isKeyable(prevValue);
    const nextIsObject     = isKeyable(nextValue);

    if (!previousIsObject && !nextIsObject) return;

    const storeDict = stateOf(store).dict;
    const propertyKeys = new Set();

    if (previousIsObject) {
        for (const key in prevValue) propertyKeys.add(key);
        if (Array.isArray(prevValue)) propertyKeys.add('length');
    }
    if (nextIsObject) {
        for (const key in nextValue) propertyKeys.add(key);
        if (Array.isArray(nextValue)) propertyKeys.add('length');
    }

    for (const key of propertyKeys) {
        const dottedChildKey = name + '.' + canonKey(key);
        const childRef = storeDict.get(dottedChildKey);

        if (childRef == null) continue;

        const childNode = Signal.deref(childRef);
        if (!childNode) continue;

        const childPtr       = childNode[PTR];
        const nextChildValue = nextIsObject ? nextValue[key] : void(0);
        if (GraphNode.dead(childNode)) continue;
        const previousChildValue = _values[childPtr];

        if (is(previousChildValue, nextChildValue)) continue;

        _values[childPtr] = nextChildValue;
        stateOf(store).proxies.delete(dottedChildKey);

        reconcileSubtree(
            store,
            dottedChildKey,
            previousIsObject ? prevValue[key] : void(0),
            nextChildValue
        );

        if (GraphNode.dead(childNode)) continue;

        if (
            nextChildValue === undefined &&
            _nodeTree[(childPtr*3 + TREE_CHILD)] === 0 &&
            !hasExternalReader(childPtr)
        ) {
            purgeQuorumChild(store, dottedChildKey);
            storeDict.delete(dottedChildKey);
            tagForDisposal(childPtr);
        } else {
            settle(childPtr, previousChildValue, nextChildValue);
        }
    }
}

function mintField(val) {
	const prev = _activePtr, prevGen = _activeGen;
	_activePtr = 0;
	try {
		const h = _wire(TRIT_STATE, val, 0);
		_durable[GraphNode.ptrOf(h)] = 0;
		return h;
	} finally { restoreActive(prev, prevGen); }
}

class ProxyTraps {

    #isRoot; #store; #handle; #key; #meta; #prefix; #owner; #ownerPtr; #ownerGen; #declared; #isUnion; #layer; #layerDepth;
    constructor(ctx) {
        this.#isRoot     = ctx.isRoot ?? false;
        this.#store      = ctx.store;
        this.#handle     = ctx.store instanceof Signal;
        this.#key        = ctx.key;
        this.#meta       = ctx.meta;
        this.#prefix     = ctx.prefix;
        this.#owner      = ctx.owner;
        this.#ownerPtr   = ctx.ownerPtr;
        this.#ownerGen   = ctx.ownerGen !== undefined ? ctx.ownerGen : typeof ctx.ownerPtr === 'number' && ctx.ownerPtr > 0 ? _nodeGen[ctx.ownerPtr] : undefined;
        this.#declared   = ctx.declared;
        this.#isUnion    = ctx.isUnion ?? false;
        this.#layer      = ctx._layer;
        this.#layerDepth = ctx._layerDepth ?? 0;
    }

    #wake() { const s = this.#store; if (s != null && (typeof s === 'object' || typeof s === 'function')) GraphNode.unpark(s); }

    get #gone() { const p = this.#ownerPtr; return p > 0 && !isLive(p, this.#ownerGen); }
    isGone() { return this.#gone; }

    get #storeGone() { const s = this.#store; return this.#isRoot && s != null && (typeof s === 'object' || typeof s === 'function') && GraphNode.dead(s); }
    #refuse(what) {
        const s = this.#store;
        const n = typeof s === 'function' ? (s.name || 'class') : (s && s.constructor && s.constructor.name) || 'store';
        throw new ReferenceError(`Cannot ${what} through a door of a disposed ${n}: dispose() ran on it, and its state is gone. Make a new one.`);
    }

    get #frozen() {
        const ptr = this.#ownerPtr;
        if (ptr > 0 && !isLive(ptr, this.#ownerGen)) return false;
        return _trits[ptr] >= -40 && _trits[ptr] <= 40 && _trits[ptr] !== 0;
    }

    #storedKey(k) {
        k = String(k).replace(SIGIL_STRIP_RE, '');
        const p = this.#prefix || '';

        const sp = (this.#meta && this.#meta.depth === 0) ? '' : p;
        const cand = sp + k;
        const dict = stateOf(this.#store).dict;
        if (dict.has(cand)) return cand;
        if (k.indexOf('.') > 0) {

            const cut = k.indexOf('.');
            const rootCand = sp + k.slice(0, cut);
            if (dict.has(rootCand)) {
                const branch = rootCand + k.slice(cut);
                if (dict.has(branch)) return branch;
            }
            if (dict.has(k)) return k;
        }
        return cand;
    }

    #getChildNode(name, val, meta, t, ownerPtr) {
        const dict = stateOf(this.#store).dict;
        const storedRef = dict.get(name);
        let node = storedRef != null ? Signal.deref(storedRef) : null;
        if (node) return node;

        let back = null;
        if (isKeyable(val) && val === t) back = ownerPtr;
        else if (isKeyable(val)) {
            let anc = this.#key || name.slice(0, name.lastIndexOf('.'));
            while (anc) {
                const anRef = dict.get(anc);
                const an = anRef != null ? Signal.deref(anRef) : null;
                if (an && _values[an[PTR]] === val) { back = an[PTR]; break; }
                anc = anc.slice(0, anc.lastIndexOf('.'));
            }
        }
        if (back !== null) {
            dict.set(name, refOf(back));
            return Signal(back);
        }

        const fresh = mintField(val);
        const childMeta = parse(name);
        if (childMeta && childMeta.depth === Infinity) {
            _trits[fresh[PTR]] = a_axis(_trits[fresh[PTR]], childMeta.type === 'union' ? 1 : -1);
        }
        dict.set(name, refOf(fresh[PTR]));
        adopt(ownerPtr, fresh[PTR]);
        return fresh;
    }

    #applyDepthOverride(nodePtr) {
        if (this.#layer && this.#layerDepth != null) {
            this.#layer[nodePtr] = this.#layerDepth !== Infinity ? this.#layerDepth : 0;
        }
    }

    #handleReactivity(t, k, name, meta) {

        const raw = t[k];
        if (this.#gone) return raw;
        const n = this.#getChildNode(name, raw, meta, t, this.#ownerPtr);
        const val = get(n[PTR], true);

        if (meta.depth > 1 && isKeyable(val) && !isOpaqueValue(val)) {
            return reactive(val, {
                isRoot: false,
                nested: true,
                store: this.#store,
                key: name,
                meta: { ...meta, depth: meta.depth === Infinity ? Infinity : meta.depth - 1 },
                ownerPtr: n[PTR],
                ownerGen: n[GEN],
                _layer: this.#layer,
            });
        }
        return val;
    }

    #mutateField(t, k, name, v, meta, mirror = true) {

        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot assign to frozen property "${name}".`);
        }

        const dict = stateOf(this.#store).dict;
        let node = Signal.deref(dict.get(name));

        let layerDepth = null;
        if (isKeyable(v) && typeof v[LAYER] === 'number') {
            layerDepth = v[LAYER];
            v = v.value;
        }

        const cBand = layerDepth != null
            ? (layerDepth >= 3 || layerDepth === Infinity ? 1 : layerDepth === 1 ? -1 : 0)
            : null;

        if (node) {
            const setter = _accessorSet.get(node[PTR]);
            if (setter) return setter.call(node, v), node;

            if (cBand != null) {
                _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
                this.#applyDepthOverride(node[PTR]);
            }

            if (isRunnable(node[PTR])) retypeConstant(node[PTR]);
            const oldV = _values[node[PTR]];
            if (is(oldV, v)) { stateOf(this.#store).proxies.delete(name); return; }

            _values[node[PTR]] = v;
            if (mirror) Reflect.set(t, k, v);
            if (GraphNode.dead(node)) return;
            settle(node[PTR], oldV, v, true);
            reconcileSubtree(this.#store, name, oldV, v);
            stateOf(this.#store).proxies.delete(name);

            if (stateOf(this.#store).cascade !== false) cascadeUp(this.#store, name);
            return;
        }

        node = mintField(v);
        const freshMeta = parse(name);
        if (freshMeta) {
            if (cBand != null) {
                _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
                this.#applyDepthOverride(node[PTR]);
            }
            if (freshMeta.depth === Infinity) {
                _trits[node[PTR]] = a_axis(_trits[node[PTR]], freshMeta.type === 'union' ? 1 : -1);
            }
        }
        dict.set(name, refOf(node[PTR]));
        if (!this.#gone) adopt(this.#ownerPtr, node[PTR]);
        if (mirror) Reflect.set(t, k, v);

        if (stateOf(this.#store).cascade !== false) cascadeUp(this.#store, name);
    }

    #bound;

    #api(t, k, r) {
        const s = this.#store;
        if (this.#isRoot && s != null && (s === t || !this.#handle) && k !== 'constructor' && k in GraphNode.prototype) {
            const v = this.#handle ? Reflect.get(s, k, s) : (typeof k === 'string' && DOOR_KEYS.has(k) ? GraphNode.door(s, k) : Reflect.get(GraphNode.prototype, k, s));
            if (typeof v !== 'function') return v;
            if (typeof k === 'string' && DOOR_KEYS.has(k)) return v;
            const b = (this.#bound ??= new Map());
            let f = b.get(v);
            if (!f) { f = v.bind(s); b.set(v, f); }
            return f;
        }
        return Reflect.get(t, k, r);
    }

    #call(args) {
        const s = this.#store;
        return this.#handle ? s[CALL](...args) : GraphNode.prototype[CALL].call(s, ...args);
    }

    get(t, k, r) {
        if (_parkedHosts !== 0) this.#wake();
        if (k === 'then') return Reflect.get(t, k, r);
        if (typeof k === 'symbol') return this.#api(t, k, r);
        if (this.#storeGone && typeof k === 'string' && !(k in GraphNode.prototype)) return undefined;

        if (this.#frozen || this.#gone) return this.#api(t, k, r);

        if (this.#isRoot) {

            if (this.#declared?.has(k)) return Reflect.get(t, k, r);

            if (this.#prefix) {
                if (RESERVED.has(k)) return this.#api(t, k, r);

                const sk = this.#storedKey(k);
                const ref = stateOf(this.#store).dict.get(sk);
                let node = ref != null ? Signal.deref(ref) : null;
                if (!node && k.indexOf('.') > 0) {
                    const cut = k.indexOf('.');
                    const rootSk = this.#storedKey(k.slice(0, cut));
                    if (stateOf(this.#store).dict.has(rootSk)) {
                        const branchSk = rootSk + k.slice(cut);
                        if (!stateOf(this.#store).dict.has(branchSk)) {

                            let view = GraphNode.read(this.#store, rootSk);
                            for (const seg of k.slice(cut + 1).split('.')) {
                                if (view == null) break;
                                view = view[seg];
                            }
                        }
                        const r2 = stateOf(this.#store).dict.get(branchSk);
                        node = r2 != null ? Signal.deref(r2) : null;
                    }
                }
                if (!node) node = storeWrite(this.#store, sk, undefined);
                if (node) { try { track(node[PTR]); } catch (e) {} }
                return node;
            }

            const meta = parse(k);
            if (!meta) return this.#api(t, k, r);
            return this.#handleReactivity(t, k, k, meta);
        }

        const meta = this.#meta;
        return this.#handleReactivity(t, k, `${this.#key}.${canonKey(k)}`, meta);
    }

    set(t, k, v, r) {
        if (_parkedHosts !== 0) this.#wake();
        if (typeof k === 'symbol') return Reflect.set(t, k, v, r);
        if (this.#gone) return Reflect.set(t, k, v);
        if (this.#storeGone) this.#refuse(`write '${String(k)}'`);

        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot assign to frozen property "${k}".`);
        }

        if (this.#isRoot && this.#prefix != null && typeof k === 'string' && !RESERVED.has(k) && !parse(k)) {
            const sk = this.#storedKey(k);
            Signal.batch(() => this.#mutateField(t, k, sk, v, this.#meta, false));
            return true;
        }

        if (this.#isRoot) {
            const meta = parse(k);
            if (meta) {

                Signal.batch(() => this.#mutateField(t, k, k, v, meta));
                return true;
            }
            return Reflect.set(t, k, v, r);
        }
        Signal.batch(() => this.#mutateField(t, k, `${this.#key}.${canonKey(k)}`, v, this.#meta));
        return true;
    }

    has(t, k) {
        if (_parkedHosts !== 0) this.#wake();

        return (this.#isRoot && stateOf(this.#store).dict.has(k)) || Reflect.has(t, k) || (this.#isRoot && this.#store !== t && k in GraphNode.prototype);
    }

    ownKeys(t) {
        if (_parkedHosts !== 0) this.#wake();

        return this.#isRoot
            ? [...new Set([...Reflect.ownKeys(t), ...stateOf(this.#store).dict.keys()])]
            : Reflect.ownKeys(t);
    }

    getOwnPropertyDescriptor(t, k) {
        if (_parkedHosts !== 0) this.#wake();

        if (this.#isRoot && !this.#declared?.has(k) && stateOf(this.#store).dict.has(k)) {
            return { enumerable: true, configurable: true, writable: true };
        }
        return Reflect.getOwnPropertyDescriptor(t, k);
    }

    deleteProperty(t, k) {
        if (_parkedHosts !== 0) this.#wake();
        if (typeof k === 'symbol' || this.#gone) return Reflect.deleteProperty(t, k);
        if (this.#storeGone) return true;

        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot delete frozen property "${k}".`);
        }

        if (this.#isRoot && this.#prefix != null && this.#store && typeof k === 'string') {
            const sk = this.#storedKey(k);
            if (stateOf(this.#store).dict.has(sk)) return GraphNode.remove(this.#store, sk);
            return true;
        }

        const meta = this.#isRoot ? parse(k) : this.#meta;
        const name = this.#isRoot ? k : `${this.#key}.${canonKey(k)}`;

        const oldV = t[k];
        const ok = Reflect.deleteProperty(t, k);
        if (ok && meta && this.#store && !(k in t)) {
            const ref = stateOf(this.#store).dict.get(name);
            const n = ref != null ? Signal.deref(ref) : null;
            if (n) {
                if (this.#isRoot && !this.#declared?.has(k)) {
                    const axis = e_axis(_trits[n[PTR]]);
                    axis >= 0 ? n.detach() : n.dispose();
                } else {
                    _values[n[PTR]] = undefined;
                    settle(n[PTR], oldV, undefined, true);
                    purgeQuorumChild(this.#store, name);
                    if (meta.depth > 1 && (stateOf(this.#store).cascade ?? meta.type !== 'union')) {
                        cascadeUp(this.#store, name);
                    }
                }
            }
        }
        return ok;
    }

    defineProperty(t, k, desc) {
        if (_parkedHosts !== 0) this.#wake();
        if (this.#gone) return Reflect.defineProperty(t, k, desc);
        if (this.#storeGone) this.#refuse(`define '${String(k)}'`);
        if (this.#frozen) {
            throw new TypeError(`❄️ Cannot define property "${k}" on a frozen signal.`);
        }

        const ok = Reflect.defineProperty(t, k, desc);
        if (ok && typeof k !== 'symbol' && 'value' in desc) {
            this.set(t, k, desc.value, t);
        }
        return ok;
    }

    construct(t, args, nt) {
        if (_parkedHosts !== 0) this.#wake();
        if (this.#isRoot && this.#prefix != null && this.#store) {
            const p = this.#prefix, sp = (this.#meta && this.#meta.depth === 0) ? '' : p;
            const dict = stateOf(this.#store).dict;
            const out = {};
            for (const key of dict.keys()) {
                if (key.indexOf('.') !== -1) continue;
                const m = parse(key);
                if (sp === '') { if (m !== null) continue; }
                else { if (!m || m.mode !== 'prefix' || canonOf(m) !== sp) continue; }
                const ref = dict.get(key);
                const n = ref != null ? Signal.deref(ref) : null;
                if (!n) continue;
                out[sp === '' ? key : m.name] = get(n[PTR], false);
            }
            return out;
        }
        return Reflect.construct(t, args, nt);
    }

    apply(t, thisArg, args) {
        if (_parkedHosts !== 0) this.#wake();
        const [arg1, arg2, arg3] = args;

        if (args.length === 0) return this.#isRoot ? (this.#owner ?? this.#store ?? t) : Reflect.apply(t, thisArg, args);
        if (this.#storeGone) {
            if (typeof arg1 === 'string' && arg2 === undefined) return undefined;
            this.#refuse(typeof arg1 === 'function' ? 'start an effect' : typeof arg1 === 'string' ? `write '${arg1}'` : 'write');
        }

        if (this.#isRoot && this.#store) {
            const prefix = this.#prefix || '';
            const meta = this.#meta || parse(prefix || '$') || sigilMeta(prefix || '$');

            if (typeof arg1 === 'string') {
                const sk = this.#storedKey(arg1);
                if (arg2 === undefined) {
                    const ref = stateOf(this.#store).dict.get(sk);
                    return ref != null ? Signal.deref(ref) : undefined;
                }
                if (arg3 !== false) {
                    let ref = stateOf(this.#store).dict.get(sk);
                    if (ref == null) { this.#mutateField(t, sk, sk, arg2, meta); return this[PROXY_REF]; }
                    const node = Signal.deref(ref);
                    if (node && !isFrozen(node[PTR])) { silentSet(node[PTR], arg2); return this[PROXY_REF]; }
                }

                this.#mutateField(t, sk, sk, arg2, meta);
                return this[PROXY_REF];
            }

            if (typeof arg1 === 'function') {

                const { affect, capture } = poleOf(meta);
                const door = this[PROXY_REF];
                const owner = this.#owner ?? undefined;
                const home = this.#store;

                const body = function () { if (_activePtr !== 0 && _values[_activePtr] === body) _owner[_activePtr] = home; return arg1.call(owner ?? this, door); };
                const mint = () => new Signal({ value: body, options: { capture, affect, effect: arg2 ? 'pull' : 'push' } });
                const ambient = activeOwner();
                const minted = (ambient !== undefined && ambient !== home) ? Signal.untrack(mint) : mint();
                if (!GraphNode.dead(minted)) ownBy(home, minted[PTR]);
                return minted;
            }

            if (isKeyable(arg1) && !Array.isArray(arg1)) {
                const put = () => {
                    for (const k of Object.keys(arg1)) {
                        const cleanKey = this.#storedKey(k.replace(SIGIL_STRIP_RE, ''));
                        this.#mutateField(t, cleanKey, cleanKey, arg1[k], meta);
                    }
                };
                this.#isUnion ? put() : Signal.batch(put);
                return this[PROXY_REF];
            }
        }

        if (this.#isRoot && this.#store) return this.#call(args);
        return t[CALL] ? t[CALL](...args) : Reflect.apply(t, thisArg, args);
    }
}

function createCallableHandle(ctor, ptrVal = 0, genVal = 0n, host) {
	return Reflect.construct(GraphNode, [ptrVal, genVal, host], ctor);
}

const _RESULT_PROXIES = new WeakMap();

function resultProxy(value, depth, ownerPtr, ownerGen = _nodeGen[ownerPtr]) {
	if (!isKeyable(value) || depth <= 0 || isOpaqueValue(value)) return value;
	let band = _RESULT_PROXIES.get(value);
	if (band && band.ptr === ownerPtr && band.gen === ownerGen && band.depth === depth) return band.proxy;
	const proxy = new Proxy(value, {
		get(t, k, r) {
			const v = Reflect.get(t, k, r);
			return (depth > 1 && typeof k === 'string' && isKeyable(v) && !isOpaqueValue(v))
				? resultProxy(v, depth - 1, ownerPtr, ownerGen) : v;
		},
		set(t, k, v) {
			const ok = Reflect.set(t, k, v);
			if (ok && typeof k === 'string' && isLive(ownerPtr, ownerGen)) trigger(ownerPtr);
			return ok;
		},
		deleteProperty(t, k) {
			const ok = Reflect.deleteProperty(t, k);
			if (ok && typeof k === 'string' && isLive(ownerPtr, ownerGen)) trigger(ownerPtr);
			return ok;
		}
	});
	_RESULT_PROXIES.set(value, { ptr: ownerPtr, gen: ownerGen, depth, proxy });
	return proxy;
}

function reactive(target, ctx) {
    if (isKeyable(target) && (isExoticOpaque(target)
        || (!ctx.isRoot && ctx.store && isOpaqueValue(target)))) return target;
    if (!ctx.isRoot) {
        if (_proxySet.has(target)) return target;
        if (!ctx.store) {
            if (_deepCache.has(target)) return _deepCache.get(target);
        } else if (ctx.nested) {
            const m = _storeNested.get(ctx.store);
            const hit = m && m.get(target);
            if (hit && !hit.isGone()) return hit[PROXY_REF];
        }
    }

    const traps = new ProxyTraps(ctx);
    const proxy = new Proxy(target, traps);
    traps[PROXY_REF] = proxy;

    if (!ctx.isRoot) {
        if (!ctx.store) {
            _deepCache.set(target, proxy);
            _proxySet.add(proxy);
        } else if (ctx.nested) {
            let m = _storeNested.get(ctx.store);
            if (!m) _storeNested.set(ctx.store, m = new WeakMap());
            m.set(target, traps);
            _proxySet.add(proxy);
        }
    }
    return proxy;
}

function storeWrite(store, key, val) {
	return storeWriteSync(store, key, val);
}
function storeWriteSync(store, key, val) {
    const st = stateOf(store);
    key = canonKey(key);
    let depthOverride = null;
    if (isKeyable(val) && typeof val[LAYER] === 'number') {
        depthOverride = val[LAYER];
        val = val.value;
    }

    let node = Signal.deref(st.dict.get(key));

    const cBand = depthOverride !== null
		? (depthOverride > 1 ? 1 : depthOverride === 1 ? -1 : 0) : null;

    if (node) {
		const nv = _trits[node[PTR]];
        if (nv >= -40 && nv <= 40) {
            throw new TypeError(`❄️ Frozen key cannot be set: "${key}".`);
        }

        const setter = _accessorSet.get(node[PTR]);
        if (setter) return setter.call(node, val), node;

        if (cBand !== null) {
            _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
            _layer[node[PTR]] = (depthOverride !== Infinity) ? depthOverride : 0;
        }

        if (isRunnable(node[PTR])) retypeConstant(node[PTR]);

        if (_predicates[node[PTR]] !== undefined && typeof _values[node[PTR]] !== 'function') {
            predicatedWrite(node[PTR], val);
            return node;
        }
        const oldV = _values[node[PTR]];
        if (is(oldV, val)) { st.proxies.delete(key); return node; }

        _values[node[PTR]] = val;
        settle(node[PTR], oldV, val, true);
        reconcileSubtree(store, key, oldV, val);
        st.proxies.delete(key);
        if (typeof key === 'string' && key.indexOf('.') > 0) writeThrough(store, key, val);
        if (st.cascade !== false && !_inCascade && typeof key === 'string' && key.indexOf('.') > 0) cascadeUp(store, key);
        return node;
    }

    if (val === undefined && typeof key === 'string' && key.indexOf('.') > 0) val = resolveSlice(store, key);
    node = mintField(val);
	const meta = parse(key);
    if (meta) {
        if (cBand !== null) {
            _trits[node[PTR]] = c_axis(_trits[node[PTR]], cBand);
            _layer[node[PTR]] = (depthOverride !== Infinity) ? depthOverride : 0;
        }
        if (cBand === null && meta.depth > 0) {
            _trits[node[PTR]] = c_axis(_trits[node[PTR]], meta.depth === Infinity ? 1 : -1);
        }
        if (meta.depth >= 1 && meta.type !== 'atomic') {
            _trits[node[PTR]] = a_axis(_trits[node[PTR]], meta.type === 'union' ? 1 : -1);
        }
    }
    _owner[node[PTR]] = store;
    ownBy(store, node[PTR]);
    adopt(root()[PTR], node[PTR]);
    if (val !== undefined) _durable[node[PTR]] = 1;
    st.dict.set(key, node.ref);
    _nodeHome.set(node[PTR], { store, key });
    st.proxies.delete(key);
    if (st.cascade !== false && !_inCascade && val !== undefined && typeof key === 'string' && key.indexOf('.') > 0) { writeThrough(store, key, val); cascadeUp(store, key); }
    return node;
}

function storeRead(store, key) {
	return storeReadSync(store, key);
}

function storeDelete(store, key) {
	key = canonKey(key);
	const ref = stateOf(store).dict.get(key);
	if (ref == null) return false;
	const node = Signal.deref(ref);
	purgeQuorumChild(store, key);
	stateOf(store).dict.delete(key);
	stateOf(store).proxies.delete(key);
	if (node) {
		const ptr = node[PTR], prev = _values[ptr];
		_values[ptr] = undefined;
		if (prev !== undefined) fireAndWithdraw(ptr);

		if (!GraphNode.dead(node)) tagForDisposal(ptr);
	}
	return true;
}

function clearKeys(st) {
	for (const ref of st.dict.values()) {
		const node = Signal.deref(ref);
		if (node) tagForDisposal(node[PTR]);
	}
	st.dict.clear();
	st.proxies.clear();
	st.quorums.clear();
}
function clearLeaves(st) {
	for (const e of st.leafQueue) if (isLive(e[PTR], e[GEN])) tagForDisposal(e[PTR]);
	st.trieRoot  = trieNode();
	st.leafQueue = [];
	st.liveCount = 0;
}
function storeReadSync(store, key) {
    const st = stateOf(store);
    key = canonKey(key);
    const node = Signal.deref(st.dict.get(key)) ?? storeWrite(store, key, undefined);

    if (isFrozen(node[PTR])) return get(node[PTR], false);

    const obj  = _values[node[PTR]];

    if (obj === null || typeof obj !== 'object') return get(node[PTR]);

    const meta0 = parse(key);
    const stamped = _layer[node[PTR]] || 0;
    const optDepth = _storeDepth.get(store) || 0;
    if ((!meta0 || meta0.depth === 0) && stamped <= 0 && optDepth <= 0)
        return track(node[PTR]), obj;
    const meta = meta0 || { prefix: '', depth: 0,
        type: _storeFamily.get(store) === 1 ? 'union' : 'consensus' };
	meta.depth = stamped || meta.depth || optDepth;

    const proxyMeta = {
        meta, store, ownerPtr: node[PTR], ownerGen: node[GEN], key
    };

    const px = st.proxies.getOrInsertComputed(key, () => reactive(obj, {
        isRoot: false,
        ...proxyMeta,
        _layer
    }));

    if (meta.depth > 1) track(node[PTR]);
    return px;
}

function Signal(a, b, c, d) {
    if (new.target === Signal && arguments.length === 0) return new Signal.Store();
    const _initNode = (value, opts, ctor) => {
        let trit, free;
        if (opts._trit !== undefined) {
            trit = opts._trit;
            free = opts.free ?? 0;
        } else {
            const isFn     = typeof value === 'function';
            const isGen    = isFn && /GeneratorFunction/.test(value.constructor?.name || '');
            const isEffect = isFn && !opts.computed && !opts.defer;

            const xR = isFn ? -1 : 1;
            const xE = isEffect ? 1 : isFn ? -1 : 0;
            const xA = opts.union ? 1 : opts.interrupt ? 1 : isFn ? (isEffect ? -1 : 1) : 0;
            const xC = opts.deep ? 1 : opts.shallow ? -1 : 0;
            const xT = opts.volatile ? 1 : opts.untracked ? 0 : -1;
            trit = encode(xR, xE, xA, xC, xT);
            free = opts.free ?? (isGen ? 1 : isEffect ? -1 : 0);
        }

		const node = _wire(trit, value, free, ctor);
        if (opts._setter && !GraphNode.dead(node)) _accessorSet.set(node[PTR], opts._setter);
        return node;
    };

    const newt = new.target;

    if (newt === void 0) {

        if (!(a > 0 && a < MAX_NODES) || _trits[a] === 0) { const dead = createCallableHandle(Signal, a, -1n); GraphNode.mark(dead); return dead; }
        if (_parkedSlot[a] !== 0) wakeSlot(a);
        const hit = _handles[a];
        if (hit !== void 0 && GraphNode.genOf(hit) === _nodeGen[a]) return hit;
        const fresh = createCallableHandle(Signal, a, _nodeGen[a]);
        _handles[a] = fresh;
        return fresh;
    }

    if (newt === Signal.Store || (newt && newt !== Signal && newt.prototype instanceof Signal.Store)) {

        const host = (a !== null && (typeof a === 'object' || typeof a === 'function')) ? a : undefined;
        const ptr = allocNode();

        _trits[ptr] = TRIT_STATE;

        if (_ownElements && host !== undefined && _activePtr !== 0) adopt(_activePtr, ptr);
        const storeHandle = createCallableHandle(newt, ptr, _nodeGen[ptr], host);
        _handles[ptr] = storeHandle;
        return storeHandle;
    }

    if (newt === Signal || newt === Signal.State) {
        let scope = null, key = null, value = void 0, opts = {};

        switch (arguments.length) {
            case 0: throw new TypeError('Signal requires an argument');
            case 1: {
                if (isDescriptor(a)) {
                    const o = a.options || {};
                    const hasGet = 'get' in a;
                    const hasSet = 'set' in a;
                    if ('value' in a && (hasGet || hasSet)) {
                        throw new TypeError('Invalid Signal descriptor: value and accessor cannot coexist');
                    }
                    const dv = hasGet ? a.get : a.value;
                    const fn = typeof dv === 'function';

                    scope = a.scope ?? null;
                    key   = typeof a.key === 'string' ? a.key : null;
                    value = dv;
                    opts  = {
                        _trit:  o.trit ?? encode(
                            POLE.R[o.return?.toUpperCase()] ?? (fn ? -1 : 1),
                            POLE.E[o.effect?.toUpperCase()] ?? (fn ? (hasGet ? -1 : 1) : 0),
                            POLE.A[o.affect?.toUpperCase()] ?? (fn ? (POLE.E[o.effect?.toUpperCase()] === 1 ? -1 : POLE.E[o.effect?.toUpperCase()] === -1 ? 1 : 0) : 0),
                            POLE.C[o.capture?.toUpperCase()] ?? 0,
                            POLE.T[o.threshold?.toUpperCase()] ?? (hasGet ? 1 : -1)
                        ),
                        free:   o.free ?? ((POLE.E[o.effect?.toUpperCase()] ?? (fn ? (hasGet ? -1 : 1) : 0)) === 1 ? -1 : 0),
                        _setter: hasSet ? a.set : void(0),
                        _gate:  POLE.A[o.affect?.toUpperCase()] === -1 && (POLE.E[o.effect?.toUpperCase()] ?? (fn ? (hasGet ? -1 : 1) : 0)) === 1,
                    };
                } else { value = a; }
                break;
            }
            case 2: {
                if (isScope(a)) { scope = a; value = b; }
                else            { value = a; opts  = b || {}; }
                break;
            }
            case 3: {
                if (isScope(a)) { scope = a; value = b; key = (typeof c === 'string') ? c : null; if (typeof c !== 'string') opts = c || {}; }
                else            { value = a; key = (typeof b === 'string') ? b : null; opts = c || {}; }
                break;
            }
            default: {
                scope = a; value = b; key = c; opts = d || {};
                break;
            }
        }

        switch (newt) {
            case Signal.State:    opts._trit ??= TRIT_STATE;    opts.free ??= 0; break;
        }

        const handle = _initNode(value, opts, newt);
        if (GraphNode.dead(handle)) return handle;
        const ptr = GraphNode.ptrOf(handle);
        if (opts._gate === true) _gateA[ptr] = 1;
        if (scope && scope[REACTIVE_STORE] && typeof key === 'string') {
            stateOf(scope[REACTIVE_STORE]).dict.set(key, handle.ref);
            _nodeHome.set(ptr, { store: scope[REACTIVE_STORE], key });
            ownBy(scope[REACTIVE_STORE], ptr);
        }
        return handle;
    }
    {
        const ptr = allocNode(), ownGen = _nodeGen[ptr];
        _trits[ptr] = TRIT_STORE;
        const handle = createCallableHandle((newt || Signal), ptr, _nodeGen[ptr]);
        _handles[ptr] = handle;

        _componentState.set(handle, { dict: new Map(), proxies: new Map(), quorums: new Map(), cascade: undefined, engine: root() });
        handle[REACTIVE_STORE] = handle;

        const declaredMembers = new Set();
        const pendingEffects  = [];
        const self = { proxy: null };
        scanClass(handle, handle, pendingEffects, declaredMembers, self);
		const proxy = reactive(handle, {
		    isRoot: true,
			store: handle,
			ownerPtr: ptr,
			ownerGen: ownGen,
			declared: declaredMembers,
			 _layer: _layer,
		});
		self.proxy = proxy;
        registerActiveEffects(proxy, handle, pendingEffects);
		return proxy;
    }
}

function memberTrit(R, E, union, deep) { return encode(R, E, union ? 1 : -1, deep ? 1 : -1, -1); }

function scanClass(instance, store, activeEffects, members, self) {
    const enginePtr = stateOf(store).engine[PTR];
    const seen = new Set(['constructor']);
    const effects = [];
    let proto = Object.getPrototypeOf(instance), level = 0;

    while (proto && proto !== Signal.prototype && proto !== Object.prototype && proto !== Function.prototype) {
        const names = Object.getOwnPropertyNames(proto);
        for (let at = 0; at < names.length; at++) {
            const key = names[at];
            if (key === 'constructor') continue;
            const meta = parse(key);

            if (meta && meta.mode === 'suffix') {
                const d = Object.getOwnPropertyDescriptor(proto, key);
                const fn = d && (typeof d.value === 'function' ? d.value : typeof d.get === 'function' ? d.get : null);
                if (fn) effects.push({ key, name: meta.name, method: fn, deep: meta.depth > 1, union: meta.type === 'union', level, at });
                continue;
            }
            if (seen.has(key)) continue;
            seen.add(key);
            if (!meta) continue;

            const desc = Object.getOwnPropertyDescriptor(proto, key);
            if (!desc) continue;
            const isGetter = typeof desc.get === 'function';
            const isMethod = typeof desc.value === 'function';
            if (!isGetter && !isMethod) continue;

            {

                const trit = memberTrit(isGetter ? -1 : 1, -1, meta.type === 'union', meta.depth > 1);
                const ptr = allocNode();
                const gen = _nodeGen[ptr];
                _trits[ptr] = trit;
                _durable[ptr] = 1;

                if (isGetter) {
                    const g = desc.get;
                    _values[ptr] = self !== undefined ? function () { return g.call(self.proxy); } : g;
                    _ctx[ptr] = undefined;
                    adopt(enginePtr, ptr);
                    Object.defineProperty(instance, key, {
                        configurable: true, enumerable: true,
                        get: () => {
							if (!isLive(ptr, gen)) return undefined;
							const val = get(ptr);
							return meta.depth > 0 && isLive(ptr, gen)
								? reactive(val, {
									isRoot: false,
									store: store,
									key: meta.key,
									meta: meta,
									ownerPtr: ptr,
									ownerGen: gen,
									_layer: _layer,
								})
								: val;
						}
                    });
                } else {
                    adopt(enginePtr, ptr);
                    Object.defineProperty(instance, key, {
                        configurable: true, enumerable: true, writable: true,
                        value: new Signal.Store(desc.value, { union: meta.type === 'union', deep: meta.depth === Infinity })
                    });
                }
                members.add(key);
                stateOf(store).dict.set(key, refOf(ptr));
                _nodeHome.set(ptr, { store, key });
                ownBy(store, ptr);
            }
        }
        proto = Object.getPrototypeOf(proto);
        level++;
    }

    if (effects.length !== 0) {
        if (effects.length > 1) effects.sort((a, b) => b.level - a.level || a.at - b.at);
        const count = new Map();
        for (const e of effects) {
            const k = count.get(e.key) || 0;
            count.set(e.key, k + 1);
            e.slot = k === 0 ? e.key : e.key + ':' + k;
            activeEffects.push(e);
        }
    }
}

Signal.prototype['$#£@'] = null;

let _inCascade = false;
const _storeDepth = new WeakMap();

const _storeFamily = new WeakMap();

function resolveSlice(store, key) {
	if (typeof key !== 'string') return undefined;
	let cut = key.lastIndexOf('.');
	while (cut > 0) {
		const anc = key.slice(0, cut);
		const aNode = Signal.deref(stateOf(store).dict.get(anc));
		const aObj = aNode ? _values[aNode[PTR]] : null;
		if (aObj !== null && typeof aObj === 'object') {
			let v = aObj;
			for (const seg of key.slice(cut + 1).split('.')) {
				if (v === null || typeof v !== 'object') return undefined;
				v = v[seg];
			}
			return v;
		}
		cut = anc.lastIndexOf('.');
	}
	return undefined;
}

function writeThrough(store, key, val) {
	if (typeof key !== 'string') return;
	const cut = key.lastIndexOf('.');
	if (cut < 1) return;
	const pNode = Signal.deref(stateOf(store).dict.get(key.slice(0, cut)));
	let pObj = pNode ? _values[pNode[PTR]] : null;
	if (pObj === null || typeof pObj !== 'object') {
		pObj = resolveSlice(store, key.slice(0, cut));
		if (pObj === null || typeof pObj !== 'object') return;
	}
	pObj[key.slice(cut + 1)] = val;
}

function cascadeUp(store, childName) {
	let name = childName;
	_batchDepth++;
	try {
	for (;;) {
		const cut = name.lastIndexOf('.');
		if (cut < 1) return;
		const parentName = name.slice(0, cut);
		const childKey   = name.slice(cut + 1);
		const pRef  = stateOf(store).dict.get(parentName);
		let pNode = pRef != null ? Signal.deref(pRef) : null;
		if (!pNode) {
			const slice = resolveSlice(store, parentName);
			if (slice === null || typeof slice !== 'object') return;
			_inCascade = true;
			try { pNode = storeWrite(store, parentName, slice); } finally { _inCascade = false; }
		}
		let pObj = _values[pNode[PTR]];
		if (pObj === null || typeof pObj !== 'object') {
			pObj = resolveSlice(store, parentName);
			if (pObj === null || typeof pObj !== 'object' || GraphNode.dead(pNode)) return;
			_values[pNode[PTR]] = pObj;
		}
		let fired;
		const pA = a_axis(_trits[pNode[PTR]]);
		const fam = pA !== 0 ? pA : (_storeFamily.get(store) ?? -1);
		if (fam === 1) {
			fired = true;
		} else {
			let q = stateOf(store).quorums.get(parentName);
			if (!q) { q = new Set(); stateOf(store).quorums.set(parentName, q); }
			q.add(childKey);
			if (q.size >= Object.keys(pObj).filter(kk => kk[0] !== '@').length) { q.clear(); fired = true; }
			else fired = false;
		}
		if (!fired || GraphNode.dead(pNode)) return;
		trigger(pNode[PTR]);
		name = parentName;
	}
	} finally { if (--_batchDepth === 0) flushQueue(); }
}

function registerActiveEffects(proxy, store, effects) {
	for (const { key: name, slot, method, deep, union } of effects) {
		const key = slot !== undefined ? slot : name;
		const c = new Signal(method.bind(proxy), { _trit: memberTrit(-1, 1, union, deep) });
		if (GraphNode.dead(c)) continue;
		adopt(stateOf(store).engine[PTR], c[PTR]);
		stateOf(store).dict.set(key, c.ref);
		_nodeHome.set(c[PTR], { store, key });
		ownBy(store, c[PTR]);
	}
}

class HeldArg { constructor(o) { this.ref = new WeakRef(o); } }

function trieNode(parent = null, key = null, bucket = null) {
    return ø({
		children: null, weak: null, node: null, val: undefined,
		parent, key, bucket,
		refs: 0
	});
}

function trieDescend(root, args) { return trieWalk(root, args, true); }
function triePeek(root, args) { return trieWalk(root, args, false); }

function trieWalk(root, args, mutating = false) {
    let i = 0, cur = root;
    do {
        if (mutating) cur.refs++;
        if (i === args.length) break;
        const arg = args[i++];
        const isSig = arg instanceof Signal;
        const weak  = !isSig && isKeyable(arg);
        const key   = isSig ? arg.ref : arg;
        const bucket = weak
            ? (mutating ? (cur.weak ??= new WeakMap()) : cur.weak)
            : (mutating ? (cur.children ??= new Map()) : cur.children);

        if (!mutating && !bucket?.has(key)) return null;

        cur = mutating
            ? bucket.getOrInsertComputed(key, () => trieNode(cur, weak ? new HeldArg(key) : key, bucket))
            : bucket.get(key);
    } while (true);
    return cur;
}

function triePrune(leaf) {
    leaf.node = null;
    leaf.val = undefined;
    let curr = leaf;
    do {
        curr.refs--;
        if (curr.refs === 0 && curr.parent) {
            if (curr.key instanceof HeldArg) { const k = curr.key.ref.deref(); if (k !== undefined) curr.bucket.delete(k); }
            else curr.bucket.delete(curr.key);
            if (curr.bucket instanceof Map && curr.bucket.size === 0) curr.parent.children = null;
        }
        curr = curr.parent;
    } while (curr);
}

function purgeQuorumChild(store, dottedKey) {

    if (typeof dottedKey !== 'string') return;
    const dot = dottedKey.lastIndexOf('.');
    if (dot <= 0) return;
    const parentName = dottedKey.slice(0, dot);
    const childKey = dottedKey.slice(dot + 1);
    const q = stateOf(store).quorums.get(parentName);
    if (q) q.delete(childKey);
}

function liveLeaf(leaf) {
    return !!(
        leaf?.node &&
        _nodeGen[leaf.node[PTR]] === leaf.node[GEN] &&
        _trits[leaf.node[PTR]] > 40
    );
}

function dropFromQueue(queue, ptr, gen) {
	const i = queue.findIndex(e => e[PTR] === ptr && e[GEN] === gen);
	if (i >= 0) queue.splice(i, 1);
}

Signal.MT = {
	active: false,
	_mintA: () => LUT_A[TRIT_EFFECT + Z],
	_mintC: () => LUT_A[TRIT_COMPUTED + Z],
	_peekTrit: p => _trits[p],
	_pokeTrit: (p, v) => { _trits[p] = v; },
};
Signal.silentSet = (h, v) => { if (!GraphNode.dead(h)) silentSet(GraphNode.ptrOf(h), v); };
Signal.track = (h) => { if (h != null && !GraphNode.dead(h)) track(GraphNode.ptrOf(h)); return h; };

Signal.untracked = (h) => { if (h != null && !GraphNode.dead(h)) { const p = GraphNode.ptrOf(h); _trits[p] = t_axis(_trits[p], 0); } return h; };

Signal.parse    = parse;
Signal.sigil    = sigilOf;
Signal.canonKey = canonKey;
Signal.SIGILS   = SIGILS;
void {
};
const API = {
	Signal, Substrate, SYMBOLS: EXPORT_SYMBOLS ? SYMBOLS : {}
};

try {
	return Object.defineProperty(globalThis, CHIMERA, {
		value: () => API,
		writable: false, enumerable: false, configurable: true
	})[CHIMERA]();
} catch (e) {
	return API;
}

});

{
	const { Signal: __S, SYMBOLS: __SY } = CHIMERA_API;
	const { DICTIONARY: __DICT, PTR: __PTR, GEN: __GEN } = __SY;
	const __SP = __S.Store.prototype;

	if (!Object.getOwnPropertyDescriptor(__SP, 'dict'))
		Object.defineProperty(__SP, 'dict', { get() { return __S.dictOf(this); }, configurable: true });

	const __canon = k => typeof k === 'string'
		? k.replace(/^\$\$/, 'ΣΣ').replace(/^\$/, 'Σ').replace(/^[øΦ]/, '')
		: k;

	if (!__SP.write) __SP.write = function (k, v) { this.set(k, v); return true; };
	if (!__SP.read) __SP.read = function (k) {
		const ref = __S.dictOf(this).get(__canon(k)) ?? __S.dictOf(this).get(k);
		const h = ref != null ? __S.deref(ref) : null;
		if (h) {
			if (h instanceof Error || h instanceof __S) {  }
			try { __S.track(h); } catch (e) {}
			if (h && typeof h.get === 'function' && (__S.dictOf(this).get(__canon(k)) === ref)) {
				const v = this.get(k);
				if (v !== undefined) return v;
				try { return h.get(); } catch (e) { throw e; }
			}
		}
		return this.get(k);
	};

	{
		const __probe = new __S.Store(); __probe.set('x', 1);
		const __h = __S.deref(__S.dictOf(__probe).get('x'));
		const __proto = __h ? Object.getPrototypeOf(__h) : null;
		if (__proto && !Object.getOwnPropertyDescriptor(__proto, 'ptr')) {
			Object.defineProperty(__proto, 'ptr', { get() { return this[__PTR]; }, configurable: true });
		}
		__probe.dispose();
	}

	(typeof globalThis !== 'undefined' ? globalThis : global).Chimera = CHIMERA_API;

	CHIMERA_API.REACTIVE_STORE = __SY.REACTIVE_STORE;
	CHIMERA_API.CHIMERA_LAYER = __SY.LAYER;
	CHIMERA_API.layer = (depth, value) => ({ [__SY.LAYER]: depth, value });

	const __IVC = globalThis[Symbol.for('Instance')];
	if (typeof __IVC === 'function' && typeof __IVC.provide === 'function')
		__IVC.provide({ module: 'chimera', value: CHIMERA_API, from: '0.89.c', to: '0.90.z' });
	else
		globalThis[Symbol.for('Instance.Chimera')] = CHIMERA_API;

	if (typeof module === 'object' && typeof module.exports === 'object') module.exports = CHIMERA_API;
}

})();
