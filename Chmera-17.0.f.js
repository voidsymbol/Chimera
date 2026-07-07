
const CHIMERA_API = (function(factory) {

	const GLOBAL = ((_ = 'undefined') => typeof globalThis !== _ ? globalThis 
	: typeof window !== _ ? window 
	: typeof self !== _ ? self 
	: typeof global !== _ ? global 
	: this ?? new Function('return this')()
	)();
	const VERSION = '17.0.f';
	
	// AMD
    if (typeof define === 'function' && define.amd) {
        define([], function () { return factory(GLOBAL, {}, VERSION); });
    }
    // CommonJS
    else if (typeof module === 'object' && typeof module.exports === 'object') {
       return (module.exports = factory(GLOBAL, {}, VERSION));
    }
    // Browser global
    else {
        var api = factory(GLOBAL, {}, VERSION);
        GLOBAL.Chimera = api;
        // Also store under Symbol.for('Chimera') if needed
        /* Symbol.for('Chimera') already installed (read-only) by the factory */
		return api;
    }
})(function(global, deps, version) {

	// Tony Stark built this in a CAVE!!! With a box of SCRAPS!!
	// — If you're reading this, you're worthy.

/*
Considered Fork (unknown if sigil count is overkill):

	this.$(() => {}); // atomic (0), return value (when any) not proxied (atomic reference only)
	this.$$(() => {}); // shallow (-1), return value (when any) shallow proxied (reference, + shallow mutation)
	this.$$$(() => {}); // deep (+1), return value (when any) deep proxied (reference + shallow mutation + deep mutation)

*/

/*
═══════════════════════════════════════════════════════════════════════════════
   REFACTOR WARNING — INVARIANTS THAT MUST NOT BE BROKEN (V17.0.6)
═══════════════════════════════════════════════════════════════════════════════

This kernel is hand‑tuned for performance and correctness. The following
invariants are load‑bearing; changing any of them *without* fully understanding
the knock‑on effects will almost certainly introduce silent memory corruption,
use‑after‑free, or scheduling bugs.

───────────────────────────────────────────────────────────────────────────────
1. TRIT WORD ENCODING
───────────────────────────────────────────────────────────────────────────────
   Ψ = 81R + 27E + 9A + 3C + 1T   (signed Int8, range –121..+121)
   • R (Lifecycle): +1 Fresh, 0 Void/Frozen, –1 Stale
   • E (Eval topology): +1 Push, 0 Detached, –1 Pull
   • A (Gating): +1 Union(OR), 0 Phantom, –1 Consensus(AND)
   • C (Capture depth): +1 Deep, 0 Atomic, –1 Shallow
   • T (Tracking): +1 Volatile, 0 Untracked, –1 Semantic

   The absolute word `0` means **disposed** (graveyard). Any function that
   reads `_trits[ptr]` must treat `=== 0` as “dead slot” before interpreting
   other axes.

───────────────────────────────────────────────────────────────────────────────
2. NODE LIFE‑CYCLE & ALLOCATION
───────────────────────────────────────────────────────────────────────────────
   • allocNode() returns an index `ptr`. The slot’s previous state MUST be
     completely cleaned (wiring, tree, counters) before re‑use.
   • `_nodeGen[ptr]` is a **BigUint64** generation tag. Every (re‑)allocation
     bumps `_globalUUID` (also BigInt). This is the ABA defense.
   • freeNode() writes `_trits[ptr] = 0` and pushes the slot onto the free‑list
     whose head is `_freeNodeHead` and whose link is parked in `_headDep[ptr]`.
   • DO NOT call freeNode() on a slot that was never allocated, or on a slot
     already disposed, unless the function guards against double‑free.
   • The engine root (`_rootPtr`) must never be freed by user code.

───────────────────────────────────────────────────────────────────────────────
3. EDGE ALLOCATION & SUBSCRIBE
───────────────────────────────────────────────────────────────────────────────
   • subscribe(consumer, source) allocates **two** edge records atomically:
     first both, then wire them. If the second allocation OOMs, the first
     edge MUST be freed (rollback) to avoid a dangling subscriber edge.
   • An edge record has 4 lanes; EDGE_PAIR links the two halves of a
     subscription. Never modify EDGE_PAIR after wiring—it is the only way
     to unlink the counterpart.
   • `_edgeEpoch` (per‑edge BigUint64) is used for glitch dedup. Bump
     `_traceEpoch` before any new propagation ride that should see fresh
     subscriptions.
   • unsubscribe() must unlink BOTH the dependency edge (singly‑linked)
     and the subscriber edge (doubly‑linked) before freeing the lanes.
     Never free an edge that is still referenced in any list.

───────────────────────────────────────────────────────────────────────────────
4. TRACKING & ACTIVE READER
───────────────────────────────────────────────────────────────────────────────
   • `_activePtr` is the node currently executing. Its reads subscribe to the
     signals they touch.
   • Inside a reactive computation, the only way to form a dependency edge
     is through `track()`. `rawget()` does NOT track.
   • The T axis (Threshold) gates tracking: if `T=0` (Untracked), `track()`
     is a no‑op, even if `_activePtr` is set.
   • `_activePtr` must be saved/restored when entering/exiting a user function
     (e.g., in `runNode`, `recompute`, `next`, `memo`).
   • Do not call `track()` from outside a running node (except via manual
     subscribe API, which must be done with `_activePtr` managed carefully).

───────────────────────────────────────────────────────────────────────────────
5. OWNERSHIP TREE (parent/child/sibling)
───────────────────────────────────────────────────────────────────────────────
   • `adopt(parent, child)` inserts `child` as the first child of `parent`.
   • `unlinkSibling(child)` detaches the child from its current parent’s list.
   • The tree is used for **lifecycle nesting**: disposing a parent
     disposes all children recursively. A child whose parent is disposed
     MUST also be disposed.
   • NEVER create a cycle in the ownership tree. The kernel does not check
     for cycles; they will cause infinite recursion in disposal and crash.

───────────────────────────────────────────────────────────────────────────────
6. QUEUES & SCHEDULING (pending, zombie, worklist)
───────────────────────────────────────────────────────────────────────────────
   • The pending queue is a plain JavaScript array, but access MUST use
     `_pendingHead` and `_pendingTail` indices. **Never use .push()** to add
     a runnable node—always write `_pendingQueue[_pendingTail++] = ptr`.
     `.push()` bypasses the tail cursor and will cause nodes to be lost.
   • `flushQueue()` drains `_pendingHead` → `_pendingTail` and then RESETS
     both cursors to 0 **and** truncates the array (`.length = 0`) to release
     references.
   • The zombie queue (`_zombieQueue`) uses `.push()` / `.pop()` because it
     is only drained by `sweep()` and never read randomly. It is idempotent
     (nodes are already marked `_trits=0`), so ordering doesn’t matter.
   • `sweep()` must be called only after at least one node has been added to
     the zombie queue, and it must empty the queue completely each time.

───────────────────────────────────────────────────────────────────────────────
7. REAPER (sweep) & DEFERRAL
───────────────────────────────────────────────────────────────────────────────
   • `sweep()` performs two‑phase disposal:
     Phase 1: physically remove all edges and tree links for each dying node,
              decrement barrier counters of surviving consumers, and collect
              **Pull consumers** into a `frontier` array (deferred dirtying).
     Phase 2: dirty all deferred Pull consumers (Stale‑them).
   • The deferral prevents a diamond‑shaped graph from being dirtied while
     its last dep is being removed (which would trigger a recompute with a
     missing dep).
   • Do NOT reorder or combine the two phases, or you risk “use after free”
     (node that was just freed being re‑read by a still‑live consumer).
   • `cleanupDeps(ptr, reap)` with `reap=1` will also attempt to cascade‑reap
     owned leaf signals that no longer have external readers. This is safe
     but relies on `hasExternalReader()` being correct.

───────────────────────────────────────────────────────────────────────────────
8. CELL I/O: `_values` vs `_ctx`
───────────────────────────────────────────────────────────────────────────────
   • For **State** nodes: `_values[ptr]` holds the current value; `_ctx[ptr]`
     is unused (null).
   • For **Computed** nodes: `_values[ptr]` holds the computation FUNCTION;
     `_ctx[ptr]` holds the most recently cached result. `recompute()` checks
     `typeof _values[ptr] === 'function'` to decide whether to re‑execute.
   • For **Effect** nodes: similar to Computed, but scheduled eagerly.
   • **Never store a function inside `_ctx`** unless it’s the `.next()`
     iterator wrapper with `_chimeraFn`.
   • `get(ptr)` returns `typeof _values[ptr] === 'function' ? _ctx[ptr] : _values[ptr]`.
     This rule must hold everywhere.

───────────────────────────────────────────────────────────────────────────────
9. STORE LAYER: EXISTENCE vs VALUE EVENTS
───────────────────────────────────────────────────────────────────────────────
   • The store distinguishes between “the field existed and was set to
     undefined” and “the field was deleted”.
   • **Delete** → `invalidateConsumers` (withdraw quorum, retract dirty
     reports, do NOT fire).
   • **Set to undefined (manual write)** → `fireAndWithdraw` (fire a final
     value change to consumers, THEN withdraw quorum).
   • `settle` (structural reconciliation, e.g., an object replacement)
     follows the delete‑like path for vanished fields, and trigger for value
     changes.
   • ALL store helpers (`invalidateConsumers`, `revalidateConsumers`,
     `fireAndWithdraw`) **must** skip consumers that are disposed
     (`_trits[c] === 0`), or they will corrupt free‑list links.
   • The store dictionary (`store.dict`) maps dotted keys to **BigInt refs**
     (`gen * MULTIPLIER + ptr`). Deref with `Signal.deref(ref)`.

───────────────────────────────────────────────────────────────────────────────
10. MEMOIZATION TRIE & EVICTION
───────────────────────────────────────────────────────────────────────────────
    • `memo` builds a parameter trie inside `_ctx[host]`. Each leaf is an
      autonomous reactive node.
    • Eviction is FIFO, triggered when `leafQueue.length > maxSize`
      (default 10 000). The oldest leaf is disposed and removed from the trie.
    • Do NOT change the eviction logic without keeping the `trieNode.node`
      reference in sync — after eviction, that trie slot must point to null
      so the next call re‑creates the node.
    • `maxSize` can be overridden per memoized function via options.

───────────────────────────────────────────────────────────────────────────────
11. GENERATION TAGS & REFS (BigInt)
───────────────────────────────────────────────────────────────────────────────
    • `_nodeGen` is a BigUint64Array. `_globalUUID` is a BigInt that increases
      monotonically. A signal’s ref is `gen * ID_MULTIPLIER_BIG + ptr`.
    • `Signal.deref(ref)` must check `_nodeGen[ptr] === gen` AND `_trits[ptr] !== 0`.
    • `isZombie(handle)` duplicates this check. Both must always agree.
    • Never cast a BigInt ref to a Number and back — use `Number(ref % MULTIPLIER)`
      and `ref / MULTIPLIER` with BigInt arithmetic.

───────────────────────────────────────────────────────────────────────────────
12. MISCELLANEOUS BUT CRITICAL
───────────────────────────────────────────────────────────────────────────────
    • `_freeMemoryAxis` is a signed byte (Int8) indicating source/sink role for
      the reaper. Only values +1 (source), 0 (invalidate), –1 (sink) are valid.
    • `_runCount` is a Uint16 per node, used to prevent infinite loops.
      It is reset to 0 after each `flushQueue()`.
    • The LUT arrays (`LUT_R`, `LUT_E`, etc.) are 256‑entry Int8Arrays indexed
      by `trit + 128`. They extract a single axis from a packed word. Changing
      the axis weights (81,27,9,3,1) requires regenerating the LUTs.
    • `_traceEpoch` is a BigInt that increases monotonically; it won't wrap
      in practice. The kernel uses it for per‑ride edge deduplication.

═══════════════════════════════════════════════════════════════════════════════
   END OF INVARIANTS
═══════════════════════════════════════════════════════════════════════════════

   V17.0.7 — EDGE STRIDE REDUCTION (5→4) & PACKED DIRTY FLAG
═══════════════════════════════════════════════════════════════════════════════

MOTIVATION
  • Stride‑5 edge records (20 bytes) cross cache lines, causing ~30%
    unnecessary L1 misses during subscriber‑list traversal.
  • Epoch over‑allocation (5 lanes per edge) wastes 4/5 of the epoch array.
  • Division by 5 when accessing per‑edge structures (e.g. epoch) costs
    15% in hot paths.

SOLUTION
  • Reduce edge record from 5 to 4 Int32 lanes (16 bytes, power‑of‑two stride).
  • Pack the DIRTY flag into the most‑significant bit of EDGE_TARGET (lane 0).
    Node indices are always ≤ 2^20, so bit 31 is unused and collision‑free.
  • Epoch array is now one element per edge, accessed via `idx >> 2`
    (bit‑shift, zero‑cost).

NEW EDGE LAYOUT (stride = 4)
  Lane 0  – TARGET (bits 30:0 = consumer / source; bit 31 = DIRTY flag)
  Lane 1  – NEXT   (next edge in singly‑linked list, or free‑list link)
  Lane 2  – PREV_SUB (previous edge in doubly‑linked subscriber list)
  Lane 3  – PAIR   (other half of the logical edge pair)

DIRTY BIT CONTRACT (bit 31 of lane 0)
  SET    : `_edges[base] |= 0x80000000`      (OR with sign mask)
  TEST   : `if (_edges[base] < 0)`           (sign check → DIRTY)
  CLEAR  : `_edges[base] &= 0x7FFFFFFF`      (clear bit 31 only)
  REAL TARGET : `_edges[base] & 0x7FFFFFFF`  (remove flag when needed)

  The mask 0x7FFFFFFF is applied ONLY when the actual node index is read.
  In the subscriber walk (trigger), we never need the target, only its
  DIRTY state and the target node’s _trits word. Therefore the sign‑bit
  test is done directly on the loaded value, saving a second load.

INVARIANT: All locations that read EDGE_TARGET for its node index MUST
  clear bit 31 first. Use the helper `_edgeTarget(e)` or manual masking.

MEMORY IMPACT (L2 arena, 131k nodes, 524k edges)
  Before (stride‑5 + per‑lane Uint32 epoch) : 20 MB
  After  (stride‑4 + per‑edge BigUint64 epoch) : 12 MB  (−40%)

PERFORMANCE
  • Bit‑shift `>>2` is cheaper than division, enabling per‑edge epoch
    lookup in cleanup/sweep without penalty.
  • Cache line alignment is restored; 4 edges exactly fit a 64‑byte line.
  • All epoch accesses use BigInt zero/non‑zero comparison – tolerant to
    2^64 wraps, making the kernel safe for indefinite uptime.
  * PATCH: reverted to UINT32 due to speed diffs; indefinite uptime reverted to 50 days.

REFACTOR IMPACT
  • Constants EDGE_TARGET…EDGE_DIRTY replaced by EDGE_TARGET (0), EDGE_NEXT (1),
    EDGE_PREV_SUB (2), EDGE_PAIR (3). The old EDGE_DIRTY constant is removed.
  • All existing loops that walk edges are left structurally identical;
    only the extraction of DIRTY and TARGET changes.
  • The free‑list is unaffected (NEXT is still lane 1).
  • This patch must be applied atomically—mixed stride‑5 and stride‑4 edges
    will cause immediate memory corruption.

═══════════════════════════════════════════════════════════════════════════════
*/

'use strict';

const ψ = (Ctor, ...x) => x.map(size => new Ctor(size));

const CHIMERA  = Symbol.for('Chimera');

const REACTIVE_STORE = Symbol('Chimera/store');
const CHIMERA_LAYER  = Symbol('Chimera/layer');

const PENDING  = Symbol.for('Instance.??');
const POISONED = Symbol.for('Instance.!!');

const RK_RE 	= /^[$Δ]/;
const BARE_RE	= /^[$Δ]{1,3}$/;
const PREFIX_RE = /^([$Δ]{1,3})(.*)$/;
const SUFFIX_RE = /^(.*?)([$Δ]{1,3})$/;

const VERSION = version;
const TEXT_SYNC = `%c[Chimera V${VERSION}] Native V8 Arena Active (Sync).`;
const TEXT_WASM = `%c[Chimera V${VERSION}] WebAssembly Arena Active (Async).`;

const ROOT_MOUNT = 121;

const [R, E, A, C, T] = [81, 27, 9, 3, 1];
const [L1, L2, L3, L4, L5] = [1 << 16, 1 << 17, 1 << 18, 1 << 19, 1 << 20];

const Z = 128;

const [X127, X126, X125, X124, X123, X122] = [127, 126, 125, 124, 123, 122];
const [U128, U127, U126, U125, U124, U123, U122] = [-128, -127, -126, -125, -124, -123, -122];

// ── New edge stride constants for V17.0.7 ──
const EDGE_STRIDE        = 4;
const EDGE_STRIDE_SHIFT  = 2;                 // idx >> 2 → edge index
const [EDGE_TARGET, EDGE_NEXT, EDGE_PREV_SUB, EDGE_PAIR] = [0, 1, 2, 3];
// DIRTY flag is now bit 31 of lane 0; no separate lane.

const [TREE_PARENT, TREE_CHILD, TREE_SIB] = [0, 1, 2];

const [LUT_R, LUT_E, LUT_A, LUT_C, LUT_T] = ((_R, _E, _A, _C, _T) => {
	for (let i = ROOT_MOUNT; i >= -ROOT_MOUNT; i--) {
		const r = Math.round(i / R);
		const e = Math.round((i - R*r) / E);
		const a = Math.round((i - R*r - E*e) / A);
		const c = Math.round((i - R*r - E*e - A*a) / C);
		const t = i - R*r - E*e - A*a - C*c;
		_R[i + Z] = r; _E[i + Z] = e; _A[i + Z] = a; _C[i + Z] = c; _T[i + Z] = t;
	}
	return [_R, _E, _A, _C, _T];
})(...ψ(Int8Array, 256, 256, 256, 256, 256));

const STATE = [5, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const ID_MULTIPLIER = 0x200000;
const ID_MULTIPLIER_BIG = BigInt(ID_MULTIPLIER);

const VOID_NODE  = +0;
const ZERO_POINT = 128;
const QUARANTINE = -122;
const CORRUPTION = -128;

const FRESH_MIN  = +41, STALE_MAX = -41;
const EAGER_HI   = -41, EAGER_LO = -67;
const ZOMBIE_HI  = -68, ZOMBIE_LO = -94;

const TRIT_DEFAULT  = encodeTrit(+1,  0,  0,  0, -1);
const TRIT_STATE    = encodeTrit(+1,  0,  0,  0, -1);
const TRIT_COMPUTED = encodeTrit(-1, -1,  1,  0, -1);
const TRIT_EFFECT   = encodeTrit(-1,  1, -1,  0, -1);

const LOCK_DELTA   = R;
const SETTLE_DELTA = E * 2;
const DIRTY_DELTA  = R * 2;

const GATE_EAGER     = { CONSENSUS_MAX: -59,  UNION_MIN: -49  };
const GATE_LAZY      = { CONSENSUS_MAX: -113, UNION_MIN: -103 };
const GATE_TRAVERSAL = { CONSENSUS_MAX: 49,   UNION_MIN: 59   };

const DISPATCH_CONSENSUS_MAX = GATE_EAGER.CONSENSUS_MAX;
const DISPATCH_UNION_MIN     = GATE_EAGER.UNION_MIN;

const SIZES = { L1, L2, L3, L4, L5 };

const POLE = {
	R: { FRESH: 1, VOID: 0, FROZEN: 0, STALE: -1 },
	E: { PUSH: 1, DETACHED: 0, PULL: -1 },
	A: { UNION: 1, PHANTOM: 0, CONSENSUS: -1 },
	C: { DEEP: 1, ATOMIC: 0, SHALLOW: -1 },
	T: { VOLATILE: 1, UNTRACKED: 0, SEMANTIC: -1 },
};

let MAX_NODES, MAX_EDGES, EDGE_MAX_STRIDE;

let [_isFlushing, _isPaused, _isBooted] = [false, false, false];

let
	_trits, _freeMemoryAxis, _runCount, _depsCount,
	_readyCount, _edgeEpoch, _nodeTree, _nodeGen,
	_sigHead, _headDep, _pendingQueue, _zombieQueue,
	_worklist, _edges, _values, _ctx;

let [
	_edgePtr, _nodePtr, _globalUUID, _traceEpoch,
	_activePtr, _pendingHead, _pendingTail, _batchDepth,
	_zombieTail, _rootPtr, _liveNodes,
	_freeNodeHead, _freeEdgeHead,
] = STATE;

function encodeTrit(r, e, a, c, t) { return (R*r + E*e + A*a + C*c + t) }

const axis = (v, whenTrue, whenFalse) => (v ? whenTrue : whenFalse);

const _setR = (v, r) => encodeTrit(r, LUT_E[v + Z], LUT_A[v + Z], LUT_C[v + Z], LUT_T[v + Z]);
const _setE = (v, e) => encodeTrit(LUT_R[v + Z], e, LUT_A[v + Z], LUT_C[v + Z], LUT_T[v + Z]);
const _setA = (v, a) => encodeTrit(LUT_R[v + Z], LUT_E[v + Z], a, LUT_C[v + Z], LUT_T[v + Z]);
const _setC = (v, c) => encodeTrit(LUT_R[v + Z], LUT_E[v + Z], LUT_A[v + Z], c, LUT_T[v + Z]);
const _setT = (v, t) => encodeTrit(LUT_R[v + Z], LUT_E[v + Z], LUT_A[v + Z], LUT_C[v + Z], t);

const { is, is: $is, create: $create } = Object;

let allocNode = function() {
	if (_isBooted === false) init(L2);       // default L2
	_isBooted = true;
	allocNode = jsAllocNode;
	return jsAllocNode();
};

function init(size = L2) {
	const N = (MAX_NODES = size), E = (MAX_EDGES = size * 4);
	EDGE_MAX_STRIDE = E * EDGE_STRIDE;
	[ _trits, _freeMemoryAxis ] = ψ(Int8Array, N, N);
	[ _runCount, _depsCount, _readyCount ] = ψ(Uint16Array, N, N, N);
	[ _nodeTree, _edgeEpoch ] = ψ(Uint32Array, N * 3, E); // _edgeEpoch: one element per edge, BigUint64 for indefinite runtime as opposed to 50 days
	_nodeGen = new BigUint64Array(N);

	[ _sigHead, _headDep, _edges ] = ψ(Int32Array, N, N, E * EDGE_STRIDE); // _edges: EDGE_STRIDE lanes per edge
	[ _values, _ctx ] = ψ(Array, N, N);
	
	_pendingQueue = [];
	_zombieQueue  = [];
	_worklist     = [];

	[ _edgePtr, _nodePtr, _globalUUID, _traceEpoch,
	  _activePtr, _pendingHead, _pendingTail, _batchDepth,
	  _zombieTail, _rootPtr, _liveNodes,
	  _freeNodeHead, _freeEdgeHead
	] = STATE;

	_globalUUID = 0n;
	_traceEpoch = 0;                  
	_pendingHead = 0;
	_pendingTail = 0;

	_values.fill(void 0); _ctx.fill(null);
	_isFlushing = false; _isPaused = false;
}


// (js)allocNode() — identical except for BigInt gen bump
function jsAllocNode() {
	for (var ptr;;) {
		if (_freeNodeHead !== 0) { ptr = _freeNodeHead; _freeNodeHead = _headDep[ptr]; break; }
		if (_nodePtr < MAX_NODES) { ptr = _nodePtr++; break; }
		if (_zombieQueue.length > 0) { sweep(); continue; }
		throw new Error('[Chimera] arena OOM: MAX_NODES exhausted');
	}
	_nodeGen[ptr] = ++_globalUUID;
	_headDep[ptr] = 0; _sigHead[ptr] = 0;
	_nodeTree[ptr*3 + TREE_PARENT] = 0;
	_nodeTree[ptr*3 + TREE_CHILD] = 0;
	_nodeTree[ptr*3 + TREE_SIB] = 0;
	_values[ptr] = undefined; _ctx[ptr] = null;
	_runCount[ptr] = 0; _freeMemoryAxis[ptr] = 0;
	_depsCount[ptr] = 0; _readyCount[ptr] = 0;
	_liveNodes++;
	return ptr;
}

// freeNode(ptr) — unchanged
function freeNode(ptr) {
	_trits[ptr] = VOID_NODE;
	_values[ptr] = undefined; _ctx[ptr] = null;
	if (_accessorSet.size) _accessorSet.delete(ptr);
	_headDep[ptr] = _freeNodeHead;
	_freeNodeHead = ptr;
	_liveNodes--;
}


// allocEdge() — stride-4, epoch with shift
function allocEdge() {
	for (var idx;;) {
		if (_freeEdgeHead !== 0) {
			idx = _freeEdgeHead;
			_freeEdgeHead = _edges[idx + EDGE_NEXT];
			break;
		}
		if ((_edgePtr + EDGE_STRIDE) < EDGE_MAX_STRIDE) {
			idx = _edgePtr;
			_edgePtr += EDGE_STRIDE;
			break;
		}
		if (_zombieQueue.length > 0) { sweep(); continue; }
		throw new Error('[Chimera] arena OOM: MAX_EDGES exhausted');
	}
	_edges[idx + EDGE_TARGET]   = 0;
	_edges[idx + EDGE_NEXT]     = 0;
	_edges[idx + EDGE_PREV_SUB] = 0;
	_edges[idx + EDGE_PAIR]     = 0;
	_edgeEpoch[idx >> EDGE_STRIDE_SHIFT] = 0;
	return idx;
}

// freeEdge(idx) — unchanged (NEXT is still lane 1)
function freeEdge(idx) {
	_edges[idx + EDGE_NEXT] = _freeEdgeHead;
	_freeEdgeHead = idx;
}

function layer(depth, value) { return { [CHIMERA_LAYER]: depth, value }; }

// ── subscribe (V17.0.7) ──
function subscribe(consumer, source) {
	for (let dep = _headDep[consumer]; dep !== 0; dep = _edges[dep + EDGE_NEXT]) {
		if (_edges[dep + EDGE_TARGET] === source) {
			_edgeEpoch[dep >> EDGE_STRIDE_SHIFT] = _traceEpoch;
			return false;                         // edge already present — idempotent
		}
	}
	const subIdx = allocEdge();
	let depIdx;
	try { depIdx = allocEdge(); }
	catch (e) { freeEdge(subIdx); throw e; }

	try {
		_edges[subIdx + EDGE_TARGET] = consumer;
		_edges[depIdx + EDGE_TARGET] = source;
		_edges[subIdx + EDGE_PAIR] = depIdx;
		_edges[depIdx + EDGE_PAIR] = subIdx;
		_edgeEpoch[subIdx >> EDGE_STRIDE_SHIFT] = _traceEpoch;
		_edgeEpoch[depIdx >> EDGE_STRIDE_SHIFT] = _traceEpoch;

		const sHead = _sigHead[source];
		_edges[subIdx + EDGE_NEXT] = sHead;
		_edges[subIdx + EDGE_PREV_SUB] = 0;
		if (sHead !== 0) _edges[sHead + EDGE_PREV_SUB] = subIdx;
		_sigHead[source] = subIdx;

		_edges[depIdx + EDGE_NEXT] = _headDep[consumer];
		_headDep[consumer] = depIdx;
		if (_trits[source] !== 0) _depsCount[consumer]++;
	} catch (e) {
		freeEdge(subIdx); freeEdge(depIdx);
		throw e;
	}
	return true;                                  // a new edge was created
}

// ── V17.0.b §2 dedup helpers (fidelity-corrected against actual code) ──
// walkSubscribers: the guarded forward walk shared by invalidate/revalidate/fireAndWithdraw.
// Early-next capture makes it safe for bodies that withdraw the current edge.
// (First rejected against a stale baseline; a same-conditions control showed the
// delta was session drift, not closure cost — accepted on contemporaneous A/B.)
function walkSubscribers(p, fn) {
	const tp = _nodeTree[p * 3 + TREE_PARENT];
	for (let sub = _sigHead[p]; sub !== 0; ) {
		const raw      = _edges[sub + EDGE_TARGET];
		const consumer = raw & 0x7FFFFFFF;
		const next     = _edges[sub + EDGE_NEXT];
		if (consumer !== 0 && consumer !== tp && _trits[consumer] !== 0) fn(consumer, raw, sub);
		sub = next;
	}
}

// dirtyConsumer: apply DIRTY_DELTA and queue if the E-axis says Push.
// Exactly 2 true sites (trigger consensus, fireAndWithdraw ready-branch);
// the union/runNode and mark-only variants deliberately stay inline.
function dirtyConsumer(consumer, cv) {
	const nv = cv - DIRTY_DELTA;
	_trits[consumer] = nv;
	if (LUT_E[nv + Z] === 1) { _pendingQueue[_pendingTail++] = consumer; return true; }
	return false;
}

// unlinkSub: pure doubly-linked removal from a signal's subscriber list.
// Split at the free/epoch seam so retargetDep's relink variant composes.
function unlinkSub(subIdx, source) {
	const p = _edges[subIdx + EDGE_PREV_SUB], n = _edges[subIdx + EDGE_NEXT];
	if (p === 0) _sigHead[source] = n; else _edges[p + EDGE_NEXT] = n;
	if (n !== 0) _edges[n + EDGE_PREV_SUB] = p;
}

// unsubscribe(consumer, source) — unchanged except masks not needed
function unsubscribe(consumer, source) {
	let prev = 0;
	for (let dep = _headDep[consumer]; dep !== 0; prev = dep, dep = _edges[dep + EDGE_NEXT]) {
		if (_edges[dep + EDGE_TARGET] !== source) continue;
		if (prev === 0) _headDep[consumer] = _edges[dep + EDGE_NEXT];
		else _edges[prev + EDGE_NEXT] = _edges[dep + EDGE_NEXT];
		const sub = _edges[dep + EDGE_PAIR];
		unlinkSub(sub, source);
		freeEdge(sub); freeEdge(dep);
		if (_depsCount[consumer] > 0 && _trits[source] !== 0) _depsCount[consumer]--;
		return true;                              // an edge was removed
	}
	return false;                                 // no such edge
}

// retargetDep(consumer, from, to) — V17.0.b §1.2 resolution: the storeDescend
// prune (unsubscribe parent + track child) preserved watcher isolation but paid
// freeEdge×2 + allocEdge×2 per level per effect-run. Since the from-edge was
// created instants earlier in the SAME synchronous read (fresh, unflagged, at
// the head of _headDep), we retarget it in place: flip the dep target, relink
// the sub side from `from`'s list into `to`'s, refresh epochs, adjust depsCount.
// Precondition: call only immediately after track(from) within one read chain.
function retargetDep(consumer, from, to) {
	if (from === to) return;
	if (to === consumer) { unsubscribe(consumer, from); return; }
	const head = _headDep[consumer];
	if (head !== 0 && _edges[head + EDGE_TARGET] === from) {
		// dedupe: if an edge to `to` already exists, drop the from-edge instead
		for (let d = _edges[head + EDGE_NEXT]; d !== 0; d = _edges[d + EDGE_NEXT])
			if (_edges[d + EDGE_TARGET] === to) {
				_edgeEpoch[d >> EDGE_STRIDE_SHIFT] = _traceEpoch;
				unsubscribe(consumer, from);
				return;
			}
		_edges[head + EDGE_TARGET] = to;
		const sub = _edges[head + EDGE_PAIR];
		unlinkSub(sub, from);
		const sh = _sigHead[to];
		_edges[sub + EDGE_NEXT] = sh;
		_edges[sub + EDGE_PREV_SUB] = 0;
		if (sh !== 0) _edges[sh + EDGE_PREV_SUB] = sub;
		_sigHead[to] = sub;
		_edgeEpoch[head >> EDGE_STRIDE_SHIFT] = _traceEpoch;
		_edgeEpoch[sub  >> EDGE_STRIDE_SHIFT] = _traceEpoch;
		if (_trits[from] !== 0 && _trits[to] === 0) { if (_depsCount[consumer] > 0) _depsCount[consumer]--; }
		else if (_trits[from] === 0 && _trits[to] !== 0) _depsCount[consumer]++;
		return;
	}
	// from-edge not at head (deduped earlier this run) — original two-step semantics
	unsubscribe(consumer, from);
	subscribe(consumer, to);
}

// track(sigPtr) — unchanged
function track(sigPtr) {
	const a = _activePtr;
	if (a === 0 || a === sigPtr) return;
	if (LUT_T[_trits[a] + Z] === 0) return;
	subscribe(a, sigPtr);
}

// adopt, unlinkSibling — unchanged
function adopt(parent, child) {
	if (parent === 0 || child === 0 || parent === child) return;
	unlinkSibling(child);
	_nodeTree[child * 3 + TREE_PARENT] = parent;
	_nodeTree[child * 3 + TREE_SIB] = _nodeTree[parent * 3 + TREE_CHILD];
	_nodeTree[parent * 3 + TREE_CHILD] = child;
}

function unlinkSibling(child) {
	const parent = _nodeTree[child * 3 + TREE_PARENT];
	if (parent === 0) return;
	let cur = _nodeTree[parent * 3 + TREE_CHILD], prev = 0;
	while (cur !== 0 && cur !== child) { prev = cur; cur = _nodeTree[cur * 3 + TREE_SIB]; }
	if (cur === child) {
		if (prev === 0) _nodeTree[parent * 3 + TREE_CHILD] = _nodeTree[child * 3 + TREE_SIB];
		else _nodeTree[prev * 3 + TREE_SIB] = _nodeTree[child * 3 + TREE_SIB];
	}
	_nodeTree[child * 3 + TREE_PARENT] = 0;
	_nodeTree[child * 3 + TREE_SIB] = 0;
}


// trigger(sigPtr) — V17.0.7 with packed DIRTY
function trigger(sigPtr) {
	let queued = false;
	const work = [sigPtr]; let wi = 0;
	while (wi < work.length) {
		const source = work[wi++];
		for (let e = _sigHead[source]; e !== 0; ) {
			const nx      = _edges[e + EDGE_NEXT];
			const raw     = _edges[e + EDGE_TARGET];      // bit 31 = DIRTY
			const target  = raw & 0x7FFFFFFF;             // real node index
			const isDirty = raw < 0;

			const v = _trits[target];
			if (v > 40) {
				if (LUT_A[v + Z] === -1) {               // CONSENSUS
					if (!isDirty) {
						_edges[e + EDGE_TARGET] = raw | 0x80000000;
						_readyCount[target]++;
						if (_readyCount[target] >= _depsCount[target]) {
							queued = dirtyConsumer(target, v) || queued;
							if (_sigHead[target] !== 0) work.push(target);
						}
					}
				} else {                                 // UNION / PHANTOM
					const nv = v - DIRTY_DELTA;
					_trits[target] = nv;
					if (LUT_E[nv + Z] === 1) runNode(target);
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
	_isFlushing = true;
	try {
		while (_pendingHead < _pendingTail) {
			const ptr = _pendingQueue[_pendingHead++];
			if (_trits[ptr] === 0) continue;
			if (_freeMemoryAxis[ptr] > 0) next(ptr);
			else runNode(ptr);
		}
	} finally {
		_isFlushing = false;
		_pendingHead = 0;
		_pendingTail = 0;
		_pendingQueue.length = 0;
		_runCount.fill(0);
	}
}

function runNode(ptr) {
	let v = _trits[ptr];
	if (v === 0) return;
	if (v < EAGER_LO || v > EAGER_HI) return;
	if (++_runCount[ptr] > 100) { _trits[ptr] = QUARANTINE; throw new Error('[Chimera V17] Topology Panic: at ' + ptr); }
	_trits[ptr] = v + LOCK_DELTA;
	const prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	if (_nodeTree[ptr * 3 + TREE_CHILD] !== 0) disposeChildren(ptr);
	try {
		const fn = _ctx[ptr]?._chimeraFn || _values[ptr];
		const res = typeof fn === 'function' ? fn() : void 0;
		if (typeof res?.next === 'function') { res._chimeraFn = fn; _ctx[ptr] = res; _freeMemoryAxis[ptr] = 1; }
		if (_trits[ptr] !== QUARANTINE) _trits[ptr] += LOCK_DELTA;
	} catch (e) {
		console.error('[Chimera V17] runNode error:', e); _trits[ptr] = QUARANTINE;
	} finally { _activePtr = prevActive; }
	if (_ctx[ptr] !== null && typeof _ctx[ptr]?.next === 'function') next(ptr);
}

function detach(ptr) {
	const v = _trits[ptr];
	if (v > 40 && LUT_E[v + Z] === 1) _trits[ptr] = v - E;
}
function reattach(ptr) {
	const v = _trits[ptr];
	if (LUT_E[v + Z] !== 0) return;          // only resurrect a parked (Detached) node
	_trits[ptr] = _setR(v + E, -1);          // Detached→Push and force Stale: the run IS the re-subscription
	runNode(ptr);
}

// recompute(ptr) — V17.0.7 with DIRTY clear via bit-31
function recompute(ptr) {
	let v = _trits[ptr];
	if (v >= -40) return;
	_trits[ptr] = v + LOCK_DELTA;
	const fn = _values[ptr];
	if (typeof fn !== 'function') {
		_readyCount[ptr] = 0;
		let d = _headDep[ptr];
		while (d !== 0) {
			const sub = _edges[d + EDGE_PAIR];
			if (sub !== 0) _edges[sub + EDGE_TARGET] &= 0x7FFFFFFF;   // clear DIRTY
			recompute(_edges[d + EDGE_TARGET]);
			d = _edges[d + EDGE_NEXT];
		}
		if (_trits[ptr] !== QUARANTINE) _trits[ptr] += LOCK_DELTA;
		return;
	}
	const prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	if (_nodeTree[ptr * 3 + TREE_CHILD] !== 0) disposeChildren(ptr);
	try {
		_ctx[ptr] = fn();
		if (_trits[ptr] !== QUARANTINE) _trits[ptr] += LOCK_DELTA;
	} catch (e) {
		console.error('[Chimera V17] recompute error:', e); _trits[ptr] = QUARANTINE;
	} finally { _activePtr = prevActive; }
}

// disposeChildren(ptr): owned children die with the owner — tag each for disposal (iterative via the queue).
function disposeChildren(ptr) {
	let child = _nodeTree[ptr * 3 + TREE_CHILD];
	while (child !== 0) {
		const nx = _nodeTree[child * 3 + TREE_SIB];
		_nodeTree[child * 3 + TREE_PARENT] = 0; _nodeTree[child * 3 + TREE_SIB] = 0;
		tagForDisposal(child);
		child = nx;
	}
	_nodeTree[ptr * 3 + TREE_CHILD] = 0;
}

// hasExternalReader(p): true if any subscriber of p is NOT its structural tree‑parent (something external reads it).
function hasExternalReader(p) {
	const tp = _nodeTree[p * 3 + TREE_PARENT];
	for (let sub = _sigHead[p]; sub !== 0; sub = _edges[sub + EDGE_NEXT])
		if ((_edges[sub + EDGE_TARGET] & 0x7FFFFFFF) !== tp) return true;
	return false;
}

// next(ptr): generator / async‑iterator resumption (fma=+1 sources). Advance one step, store the yielded
// value, mark Fresh, and notify subscribers; a thenable yield awaits and resumes on resolution.
function next(ptr) {
	if (_trits[ptr] === 0) return;                        // disposed
	let iter = _ctx[ptr];
	if (!iter || typeof iter.next !== 'function' || iter._isAwaiting) {
		const fn = iter?._chimeraFn || _values[ptr];
		if (typeof fn !== 'function') return;
		iter = fn();
		if (!iter || typeof iter.next !== 'function') return;
		iter._chimeraFn = fn; _ctx[ptr] = iter;
	}
	const savedGen = _nodeGen[ptr], prevActive = _activePtr;
	cleanupDeps(ptr);
	_activePtr = ptr;
	_traceEpoch++;
	try {
		const result = iter.next(_values[ptr]);
		_activePtr = prevActive;
		if (result.done) {
			_values[ptr] = result.value;
			_ctx[ptr] = { _chimeraFn: iter._chimeraFn };
			if (_trits[ptr] !== 0) _trits[ptr] = _setR(_trits[ptr], POLE.R.FRESH);
			return;
		}
		const yielded = result.value;
		if (typeof yielded?.then === 'function') {
			iter._isAwaiting = true;
			yielded.then(val => {
				if (_nodeGen[ptr] !== savedGen || _ctx[ptr] !== iter) return;
				iter._isAwaiting = false;
				_values[ptr] = val;
				if (_trits[ptr] !== 0) _trits[ptr] = _setR(_trits[ptr], POLE.R.FRESH);
				trigger(ptr);
			});
		} else {
			_values[ptr] = yielded;
			if (_trits[ptr] !== 0) _trits[ptr] = _setR(_trits[ptr], POLE.R.FRESH);
			trigger(ptr);
		}
	} catch (e) {
		console.error('[Chimera V17] next error:', e); _trits[ptr] = QUARANTINE;
	} finally {
		if (_activePtr === ptr) _activePtr = prevActive;
	}
}

// freeze(ptr): R -> 0. A live node (Fresh or Stale) becomes a static snapshot — readable, inert, and
// distinct from the all‑zero graveyard. trigger skips it for free (it is no longer Fresh).
function freeze(ptr) {
	const v = _trits[ptr];
	if (v >= -40 && v <= 40) return;                      // already inert/frozen/disposed
	_trits[ptr] = _setR(v, POLE.R.VOID);
}

// unfreeze(ptr): R 0 -> -1 (Stale) then recompute — the re‑sync handshake. A frozen node has lost its old
// Fresh/Stale standing, so it re‑ticks against current inputs rather than trusting a relic value.
function unfreeze(ptr) {
	const v = _trits[ptr];
	if (v > 40 || v < -40 || v === 0) return;             // only a frozen (R=0, non‑disposed) node
	_trits[ptr] = _setR(v, POLE.R.STALE);
	recompute(ptr);
}

function tagForDisposal(ptr) {
	if (_trits[ptr] === 0) return;
	_trits[ptr] = 0;
	_zombieQueue.push(ptr);
	if (_zombieQueue.length >= 1024) sweep();
}

// cleanupDeps(ptr, reap) — V17.0.7, stride-4, DIRTY packed
function cleanupDeps(ptr, reap) {
	_depsCount[ptr] = 0; _readyCount[ptr] = 0;
	let depIdx = _headDep[ptr];
	while (depIdx !== 0) {
		const subIdx = _edges[depIdx + EDGE_PAIR];
		const signal = _edges[depIdx + EDGE_TARGET];
		const nx     = _edges[depIdx + EDGE_NEXT];

		if (subIdx !== 0) {
			unlinkSub(subIdx, signal);
			freeEdge(subIdx);
			_edgeEpoch[subIdx >> EDGE_STRIDE_SHIFT] = 0;
		}

		_edges[depIdx + EDGE_TARGET] &= 0x7FFFFFFF;   // clear DIRTY on dep edge (safety)
		freeEdge(depIdx);
		_edgeEpoch[depIdx >> EDGE_STRIDE_SHIFT] = 0;

		if (reap && signal !== 0 && signal !== ptr &&
			_nodeTree[signal * 3 + TREE_PARENT] !== 0 &&
			_nodeTree[signal * 3 + TREE_CHILD] === 0 &&
			!hasExternalReader(signal))
			tagForDisposal(signal);

		depIdx = nx;
	}
	_headDep[ptr] = 0;
}

// sweep() — V17.0.7 with packed DIRTY
function sweep() {
	const frontier = [];
	while (_zombieQueue.length > 0) {
		const ptr = _zombieQueue.pop();
		if (_nodeTree[ptr * 3 + TREE_CHILD] !== 0) disposeChildren(ptr);
		unlinkSibling(ptr);
		cleanupDeps(ptr, 1);

		let subIdx = _sigHead[ptr];
		while (subIdx !== 0) {
			const depIdx   = _edges[subIdx + EDGE_PAIR];
			const rawSub   = _edges[subIdx + EDGE_TARGET];
			const consumer = rawSub & 0x7FFFFFFF;
			const wasDirty = rawSub < 0;
			const nextSub  = _edges[subIdx + EDGE_NEXT];

			const cv = consumer !== 0 ? _trits[consumer] : 0;
			if (cv !== 0) {
				if (wasDirty && _readyCount[consumer] > 0) _readyCount[consumer]--;
				if (_depsCount[consumer] > 0) _depsCount[consumer]--;

				if (cv > 40) {
					const eAxis = LUT_E[cv + Z];
					if (eAxis === 1) {
						if (_depsCount[consumer] === 0) _trits[consumer] = cv - E;
					} else if (eAxis === -1 && _freeMemoryAxis[ptr] <= 0) {
						frontier.push(consumer);
					}
				}
			}

			if (depIdx !== 0) {
				let prev = 0;
				let cur = _headDep[consumer];
				while (cur !== 0 && cur !== depIdx) { prev = cur; cur = _edges[cur + EDGE_NEXT]; }
				if (cur === depIdx) {
					if (prev === 0) _headDep[consumer] = _edges[depIdx + EDGE_NEXT];
					else _edges[prev + EDGE_NEXT] = _edges[depIdx + EDGE_NEXT];
				}
				_edges[depIdx + EDGE_TARGET] &= 0x7FFFFFFF;   // clear DIRTY
				freeEdge(depIdx);
				_edgeEpoch[depIdx >> EDGE_STRIDE_SHIFT] = 0;
			}

			freeEdge(subIdx);
			_edgeEpoch[subIdx >> EDGE_STRIDE_SHIFT] = 0;
			subIdx = nextSub;
		}

		_sigHead[ptr] = 0;
		_nodeTree[ptr * 3 + TREE_PARENT] = 0;
		_nodeTree[ptr * 3 + TREE_CHILD]  = 0;
		_nodeTree[ptr * 3 + TREE_SIB]    = 0;
		_values[ptr] = undefined;
		_ctx[ptr]    = null;	
		_headDep[ptr] = _freeNodeHead;
		_freeNodeHead = ptr;
		_liveNodes--;
	}

	for (let i = 0; i < frontier.length; i++) {
		const consumer = frontier[i];
		const ev0 = _trits[consumer];
		if (ev0 > 40 && LUT_E[ev0 + Z] === -1) _trits[consumer] = (ev0 - DIRTY_DELTA);
	}
}

// ── Store helpers (updated with disposed‑consumer guard) ──
function invalidateConsumers(p) {
	walkSubscribers(p, (consumer, raw, sub) => {
		if (raw < 0) {
			_edges[sub + EDGE_TARGET] &= 0x7FFFFFFF;
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
	let queued = false;
	walkSubscribers(p, (consumer, raw, sub) => {
		const cv = _trits[consumer];
		if (cv <= -40) return;
		if (cv > 40 && LUT_E[cv + Z] === -1 && typeof _values[consumer] === 'function') {
			if (_depsCount[consumer] > 0) _depsCount[consumer]--;
			_trits[consumer] = cv - DIRTY_DELTA;      // mark-only: computed goes stale, never queued
			return;
		}
		if ((raw & 0x80000000) === 0) { _edges[sub + EDGE_TARGET] |= 0x80000000; _readyCount[consumer]++; }
		if (_depsCount[consumer] > 0) _depsCount[consumer]--;
		if (cv > 40 && (LUT_A[cv + Z] === 1 || _readyCount[consumer] >= _depsCount[consumer]))
			queued = dirtyConsumer(consumer, cv) || queued;
	});
	if (queued && _batchDepth === 0 && !_isFlushing) flushQueue();
}

// Cell I/O (unchanged)
function get(ptr) {
	const v = _trits[ptr];
	if (v === 0) return undefined;
	if (v < -40) recompute(ptr);
	track(ptr);
	const locus = _values[ptr];
	// V17.0.b §1.1: cell I/O stays lean — object-proxy wrapping lives in
	// storeRead/storeDescend (store fields) and memo/createDeepProxy (computed results).
	return typeof locus === 'function' ? _ctx[ptr] : locus;
}

function rawget(ptr) {
	const v = _trits[ptr];
	if (v === 0) return undefined;
	if (v < -40) recompute(ptr);
	const locus = _values[ptr];
	return typeof locus === 'function' ? _ctx[ptr] : locus;
}

function set(ptr, val) {
	const v = _trits[ptr];
	if (v === 0) return;
	if (v >= -40 && v <= 40) { _values[ptr] = val; return; }
	const changed = !is(_values[ptr], val);
	_values[ptr] = val;
	if (LUT_T[v + Z] === 1 || changed) trigger(ptr);
}


function silentSet(ptr, val) { // guard 
	const v = _trits[ptr];
	if (v === 0) return;
	_values[ptr] = val;
}


function rawset(ptr, val) {
	if (_trits[ptr] === 0) return;
	_values[ptr] = val;
	trigger(ptr);
}

// Layer 5 helpers (unchanged)
const isRK = p => typeof p === 'string' && RK_RE.test(p) && !BARE_RE.test(p);
const isUnion = s => s.includes('Δ');
const sigilDepth = s => { const m = /^[$Δ]+/.exec(s); const n = m ? m[0].length : 0; return n >= 2 ? Infinity : n === 1 ? 1 : 0; };
const isClass = x => typeof x === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(x));
const isScope = x => x === null || isClass(x) || (typeof x === 'object' && x !== null && x[REACTIVE_STORE]);

function _getGlobal() {
	if (_rootPtr === 0) { _rootPtr = allocNode(); _trits[_rootPtr] = ROOT_MOUNT; }
	return Signal(_rootPtr);
}

function graft(to, from, skip) {
	for (const key of Reflect.ownKeys(from))
		if (!skip.includes(key)) Object.defineProperty(to, key, Object.getOwnPropertyDescriptor(from, key));
	return to;
}

function isZombie(handle) {
	if (!handle || typeof handle.ptr !== 'number') return true;
	const p = handle.ptr;
	return p <= 0 || p >= MAX_NODES || _trits[p] === 0 || handle.gen !== _nodeGen[p];
}

class $Signal extends null {

	static #ref = null;
	static State = class State extends Signal {};
	static Computed = class Computed extends Signal {};
	static Effect = class Effect extends Signal {};

	static Store = class Store {

		#memoized = null;   // factory (memo) mode — set when constructed with a function
		#deep = false;      // manual-mode reads wrap objects in a tracking proxy
		#union = false;

		/* Unified door (0.87.7): one constructor, four cases —
		 *   new Store()                    → empty manual store (default engine)
		 *   new Store(engineHandle)        → manual store on that engine (existing API)
		 *   new Store({ seed })            → manual store, entries written verbatim
		 *   new Store(factoryFn, options)  → memo mode: get(...args) computes via the
		 *                                    factory through memo()'s trie cache
		 *                                    (options: union, deep, maxSize, effect)
		 * The manual surface (write/read/has/_silentWrite/$-triads) is unchanged. */
		constructor(data, options = {}) {
			let engine = null, factory = null, seed = null;
			if (typeof data === 'function') factory = data;
			else if (data !== null && typeof data === 'object') {
				const isHandle = typeof data.ptr === 'number' && typeof data.get === 'function';
				if (isHandle) engine = data;
				else if (!Array.isArray(data)) seed = data;
			}
			if (!factory && typeof options.factory === 'function') factory = options.factory;
			this.engine = engine ?? _getGlobal();
			this.dict = new Map();
			this._proxies = new Map();
			this._quorum = new Map();   // dotted parent name -> Set<changed child key> (consensus barrier state)
			this.#deep = !!options.deep;
			this.#union = !!options.union;
			this._cascade = options.cascade;     // V17.0.b §1.3 amended: undefined → consensus cascades, union skips; boolean overrides
			if (factory) this.#memoized = memo(factory, options);
			if (seed) for (const k of Object.keys(seed)) this.write(k, seed[k]);
		}

		get isMemo() { return this.#memoized !== null; }

		get(...args) {
			if (this.#memoized) return this.#memoized(...args);
			if (!args.length) return undefined;
			const key = args[0];
			// Map-like get: missing key → undefined, no node materialization.
			// (Kernel storeRead creates cells on miss for subscribe-before-set —
			// that behavior stays available through the read() alias.)
			if (!this.dict.has(key)) return undefined;
			const v = this.read(key);
			if (!this.#deep || v === null || typeof v !== 'object') return v;
			let p = this._proxies.get(key);          // storeWrite invalidates this on change
			if (!p) {
				const ref = this.dict.get(key);
				const node = ref != null ? Signal.deref(ref) : null;
				if (!node) return v;
				p = createDeepProxy(v, Infinity, node.ptr, this.#union);
				this._proxies.set(key, p);
			}
			return p;
		}

		set(key, val) {
			if (this.#memoized) throw new Error('[Chimera] Store(factory): set() unavailable — values are computed; use get(...args)');
			this.write(key, val);
			return this;
		}

		/* per-key management — one contract, both modes (0.87.8) */
		delete(...args) {
			if (this.#memoized) return this.#memoized.delete(...args);
			const key = args[0];
			const ref = this.dict.get(key);
			if (ref == null) return false;
			const node = Signal.deref(ref);
			if (node) { tagForDisposal(node.ptr); sweep(); }
			this.dict.delete(key);
			this._proxies.delete(key);
			return true;
		}

		clear() {
			if (this.#memoized) { this.#memoized.clear(); return this; }
			let any = false;
			for (const ref of this.dict.values()) {
				const node = Signal.deref(ref);
				if (node) { tagForDisposal(node.ptr); any = true; }
			}
			if (any) sweep();
			this.dict.clear(); this._proxies.clear(); this._quorum.clear();
			return this;
		}

		get size() {
			if (this.#memoized) return this.#memoized.size;
			let n = 0;
			for (const ref of this.dict.values()) {
				const node = Signal.deref(ref);
				if (node && _trits[node.ptr] > 40) n++;
			}
			return n;
		}

		write(key, val) { storeWrite(this, key, val); return true; }
		read(key) { return storeRead(this, key); }

		has(...args)  { 
			if (this.#memoized) return this.#memoized.has(...args);
			const r = this.dict.get(args[0]); 
			return r != null && !!Signal.deref(r);
		}

		_silentWrite(key, val) {
			const ref = this.dict.get(key);
			if (ref != null) {
				const node = Signal.deref(ref);
				if (node) silentSet(node.ptr, val);
			}
		}

		get $()   { return triad(this, '$',   false); }
		get $$()  { return triad(this, '$$',  false); }
		get $$$() { return triad(this, '$$$', false); }
		get ['@'](){ return triad(this, '@',  false); }   // atomic active effect — this['@'](() => {})
		get ø()   { return triad(this, 'ø',   false); }   // atomic — the ø-spelled tier
		get ψ()   { return psiChain(this, this); }        // chainable seeding functor — store face
		ψFor(owner) { return psiChain(this, owner); }     // element face: unwrap returns the element
		get Δ()   { return triad(this, 'Δ',   true);  }
		get ΔΔ()  { return triad(this, 'ΔΔ',  true);  }
		get ΔΔΔ() { return triad(this, 'ΔΔΔ', true);  }
	};

	get ref()  { return this.gen * ID_MULTIPLIER_BIG + BigInt(this.ptr); }

	static deref(ref) {
		if (typeof ref !== 'bigint') return;
		const ptr = Number(ref % ID_MULTIPLIER_BIG);
		const gen = ref / ID_MULTIPLIER_BIG;
		if (ptr <= 0 || ptr >= MAX_NODES || _nodeGen[ptr] !== gen || _trits[ptr] === 0) return;
		return Signal(ptr);
	}

	static init(size = 'L2') {
		void init(SIZES[size] ?? SIZES.L2);
		const rootPtr = allocNode();
		_trits[rootPtr] = ROOT_MOUNT;
		return ($Signal.#ref = Signal(rootPtr));
	}

	static get() { return $Signal.#ref || new Substrate('L2'); }

	static teardown() { // Pass Q4: release the arena — drop the root and re-init to the smallest slab (L1). The old typed arrays and value lanes are unreferenced (GC'd); EVERY existing handle, store, and effect is invalidated. Next Signal.get() re-bootstraps fresh.
		$Signal.#ref = null;
		init(L1);
		return true;
	}

	// ── handle API ──
	attach() { return this.reattach(); }
	get()  { return isZombie(this) ? undefined : get(this.ptr); }
	peek() { return isZombie(this) ? undefined : rawget(this.ptr); }
	[Symbol.toPrimitive](hint) {
		// 'default' → peek(): console/equality coercion must NOT subscribe.
		// explicit 'number'/'string' logic → get(): tracked, like $count.
		const v = (hint === 'default') ? this.peek() : this.get();
		if (hint === 'number') return typeof v === 'number' ? v : (Number(v) || 0);
		if (hint === 'string') return v != null ? String(v) : '';
		return v;
	}
	set(v) { if (isZombie(this)) return this; const s = _accessorSet.get(this.ptr); if (s) s.call(this, v); else set(this.ptr, v); return this; }
	poke(v){ if (isZombie(this)) return this; rawset(this.ptr, v); return this; }
	dispose() { if (!isZombie(this)) { tagForDisposal(this.ptr); sweep(); } }
	detach() { if (isZombie(this)) return this; detach(this.ptr); return this; }
	reattach() { if (isZombie(this)) return this; reattach(this.ptr); return this; }
	freeze() { if (isZombie(this)) return this; freeze(this.ptr); return this; }
	unfreeze() { if (isZombie(this)) return this; unfreeze(this.ptr); return this; }
	keep() { if (isZombie(this)) return this; adopt(_getGlobal().ptr, this.ptr); return this; }

	map(fn) { return _wire(TRIT_COMPUTED, () => fn(this.get()), 0); }
	filter(pred) {
		let last = this.peek();
		return _wire(TRIT_COMPUTED, () => { const v = this.get(); if (pred(v)) last = v; return last; }, 0);
	}
	combine(o, fn) { return _wire(TRIT_COMPUTED, () => fn(this.get(), o && typeof o.get === 'function' ? o.get() : o), 0); }
	effect(fn) { if (isZombie(this)) return undefined; const c = _wire(TRIT_EFFECT, fn, -1); adopt(this.ptr, c.ptr); return c; }
	untrack(fn) { const prev = _activePtr; _activePtr = 0; try { return fn(); } finally { _activePtr = prev } }

	static batch(fn) { _batchDepth++; try { return fn(); } finally { if (--_batchDepth === 0) flushQueue(); } }
	static untrack(fn) { const prev = _activePtr; _activePtr = 0; try { return fn(); } finally { _activePtr = prev; } }
	static wipe() { sweep(); }

	static subscribe(consumer, source) {
		return subscribe(
			typeof consumer === 'number' ? consumer : consumer && consumer.ptr,
			typeof source === 'number' ? source : source && source.ptr
		);
	}
	static unsubscribe(consumer, source) {
		return unsubscribe(
			typeof consumer === 'number' ? consumer : consumer && consumer.ptr,
			typeof source === 'number' ? source : source && source.ptr
		);
	}

	static find(scope, key, query = 'value') {
		if (scope == null || typeof key !== 'string') return undefined;
		const store = scope[REACTIVE_STORE];
		if (!store) return undefined;
		const cleanKey = key.endsWith('()') ? key.slice(0, -2) : key;
		const ref = store.dict.get(cleanKey);
		if (query === 'id') return ref != null ? Number(ref / ID_MULTIPLIER_BIG) : undefined;
		if (query === 'node' || key.endsWith('()')) return ref != null ? Signal.deref(ref) : undefined;
		return store.read(cleanKey);
	}

	static subtle = {
		Watcher: class Watcher {
			constructor(notifyFn) {
				if (typeof notifyFn !== 'function') throw new TypeError('Watcher expects a callback');
				this._notify = notifyFn;
				this._node = _wire(encodeTrit(-1, -1, -1, 0, -1), () => this._notify(), 0);
			}
			watch(...signals) {
				const prev = _activePtr; _activePtr = this._node.ptr;
				for (const sig of signals) if (sig instanceof Signal) track(sig.ptr);
				_activePtr = prev;
				const v = _trits[this._node.ptr];
				if (LUT_E[v + Z] === -1) _trits[this._node.ptr] = v + SETTLE_DELTA;
			}
			unwatch() { cleanupDeps(this._node.ptr); }
		}
	};

	static {
		Object.setPrototypeOf(Signal.prototype, null);
		graft(Signal.prototype, $Signal.prototype, ['constructor']);
		graft(Signal, $Signal, ['length', 'name', 'prototype']);
	}
}


function _wire(trit, val, free) {
	const ptr = allocNode();
	_trits[ptr] = trit;
	_values[ptr] = val;
	if (free) _freeMemoryAxis[ptr] = free;
	if (_activePtr !== 0) adopt(_activePtr, ptr);
	if (trit >= EAGER_LO && trit <= EAGER_HI) runNode(ptr);
	return Signal(ptr);
}

function reactive(target) {
	const store = new Signal.Store(_getGlobal());
	const members = new Set();
	const effects = [];
	scanClass(target, store, effects, members);
	const proxy = new Proxy(target, {
		get(t, prop, r) {
			if (prop === REACTIVE_STORE) return store;
			if (isRK(prop)) return members.has(prop) ? Reflect.get(t, prop, r) : storeRead(store, prop);
			return Reflect.get(t, prop, r);
		},
		set(t, prop, v, r) {
			if (isRK(prop)) { storeWrite(store, prop, v); return true; }
			return Reflect.set(t, prop, v, r);
		},
		has(t, prop) { return store.dict.has(prop) || Reflect.has(t, prop); },
		ownKeys(t) { return [...new Set([...Reflect.ownKeys(t), ...store.dict.keys()])]; },
		getOwnPropertyDescriptor(t, prop) {
			return (!members.has(prop) && store.dict.has(prop))
				? { enumerable: true, configurable: true, writable: true }
				: Reflect.getOwnPropertyDescriptor(t, prop);
		},
		deleteProperty(t, prop) {
			if (!members.has(prop) && store.dict.has(prop)) {
				const n = Signal.deref(store.dict.get(prop));
				if (n) (LUT_E[_trits[n.ptr] + Z] >= 0 ? n.detach() : n.dispose());
				return true;
			}
			return Reflect.deleteProperty(t, prop);
		}
	});
	registerActiveEffects(proxy, store, effects);
	return proxy;
}

// Descriptor form (single-arg object): maps 1:1 onto the five balanced-ternary
// axes by canonical pole name. Unspecified axes fall back to value-type defaults;
// `options.trit` is a raw escape hatch for the power user.
const AXIS = {
	return:    { fresh: 1, void: 0, frozen: 0, stale: -1 },   // R — Lifecycle
	effect:    { push: 1, detached: 0, pull: -1 },            // E — Eval
	affect:    { union: 1, phantom: 0, consensus: -1 },       // A — Gating
	capture:   { deep: 1, atomic: 0, shallow: -1 },           // C — Capture
	threshold: { volatile: 1, untracked: 0, semantic: -1 },   // T — Tracking
};
const _DESC_KEYS = new Set(['scope', 'key', 'value', 'get', 'set', 'options']);
const _accessorSet = new Map();   // ptr -> custom setter fn (writable-accessor descriptors); cleared on freeNode
const isDescriptor = a => {
	if (a === null || typeof a !== 'object' || Array.isArray(a)) return false;
	const ks = Object.keys(a);
	return ks.length > 0 && ks.every(k => _DESC_KEYS.has(k));
};

function Signal(a, b, c, d) {
	switch (new.target) {
		case void 0: {
			const node = $create(Signal.prototype);
			node.ptr = a;
			node.gen = _nodeGen[a];
			return node;
		}
		case Signal: case Signal.State: case Signal.Computed: case Signal.Effect: {
			let scope = null, key = null, value = undefined, opts = {};
			switch (arguments.length) {
				case 0: throw new TypeError('Signal requires an argument');
				case 1:
					if (isDescriptor(a)) {
						const o = a.options || {};
						const hasGet = 'get' in a, hasSet = 'set' in a, hasVal = 'value' in a;
						if (hasVal && (hasGet || hasSet))
							throw new TypeError('Invalid Signal descriptor: a value cannot coexist with an accessor (get/set)');
						const dv = hasGet ? a.get : a.value;               // `get` is the accessor (computed) form
						const fn = typeof dv === 'function';
						const eAx = AXIS.effect[o.effect]       ?? (fn ? (hasGet ? -1 : 1) : 0);              // accessor → Pull, value-fn → Push
						const rAx = AXIS.return[o.return]       ?? (fn ? -1 : 1);                             // fn starts Stale, value Fresh
						const aAx = AXIS.affect[o.affect]       ?? (fn ? (eAx === 1 ? -1 : eAx === -1 ? 1 : 0) : 0); // Push→Consensus, Pull→Union
						const cAx = AXIS.capture[o.capture]     ?? 0;
						const tAx = AXIS.threshold[o.threshold] ?? (hasGet ? 1 : -1);     // a (reactive) getter is Volatile by contract; values/effects default Semantic
						scope = a.scope ?? null;
						key   = (typeof a.key === 'string') ? a.key : null;
						value = dv;
						opts  = { _trit: o.trit ?? encodeTrit(rAx, eAx, aAx, cAx, tAx), free: o.free ?? (eAx === 1 ? -1 : 0), _setter: hasSet ? a.set : undefined };
					} else value = a;
					break;
				case 2: if (isScope(a)) { scope = a; value = b; } else { value = a; opts = b || {}; } break;
				case 3: if (isScope(a)) { scope = a; value = b; if (typeof c === 'string') key = c; else opts = c || {}; }
						else { value = a; key = typeof b === 'string' ? b : null; opts = c || {}; } break;
				default: scope = a; value = b; key = c; opts = d || {}; break;
			}

			let isFn = typeof value === 'function';
			let isGen = isFn && /GeneratorFunction/.test(value.constructor?.name || '');
			let isEffect = isFn && !opts.computed && !opts.defer;
			if (new.target === Signal.State) { isFn = isGen = isEffect = false; }
			else if (new.target === Signal.Computed) { if (typeof value !== 'function') throw new TypeError('Computed expects a function'); isFn = true; isGen = isEffect = false; }
			else if (new.target === Signal.Effect) { if (typeof value !== 'function') throw new TypeError('Effect expects a function'); isFn = isEffect = true; isGen = false; }

			const xR = isFn ? -1 : 1;
			const xE = isEffect ? 1 : isFn ? -1 : 0;
			const xA = opts.union ? 1 : opts.interrupt ? 1 : isFn ? (isEffect ? -1 : 1) : 0;
			const xC = opts.deep ? 1 : opts.shallow ? -1 : 0;
			const xT = opts.volatile ? 1 : opts.untracked ? 0 : -1;
			const trit = opts._trit ?? encodeTrit(xR, xE, xA, xC, xT);
			const free = opts.free ?? (isGen ? 1 : isEffect ? -1 : 0);
			const node = _wire(trit, value, free);
			if (opts._setter) _accessorSet.set(node.ptr, opts._setter);
			if (scope && scope[REACTIVE_STORE] && typeof key === 'string')
				scope[REACTIVE_STORE].dict.set(key, node.ref);
			return node;
		}
		default: return reactive($create(new.target.prototype));
	}
}

let arena = _getGlobal();
function getEngine() { return _getGlobal(); }

class Substrate extends Signal {
	static wipe() { sweep(); }
	constructor(config = {}) {
        if (typeof config === 'string') config = { size: config };
        const size = config.size ?? 'L2';

        // -- BRANCH B: WASM Upgrade (Async, Opt-in) --
        if (config.wasm) {
            return (async () => {
                try {
                    const N = SIZES[size] ?? SIZES.L2;
                    const EDGES = N * 4;
                    
                    // Assuming _loadKernel resolves the WebAssembly instance
                    const ex = (await _loadKernel(config.wasm)).exports;
                    const buf = ex.memory.buffer;

                    // V17 Numeric Arena - Mapped to WASM Linear Memory
                    _trits          = new Int8Array      (buf, ex.TRITS_PTR.value, N);
                    _freeMemoryAxis = new Int8Array      (buf, ex.FREE_MEMORY_AXIS_PTR.value, N);
                    _runCount       = new Uint16Array    (buf, ex.RUN_COUNT_PTR.value, N);
                    _depsCount      = new Uint16Array    (buf, ex.DEPS_COUNT_PTR.value, N);
                    _readyCount     = new Uint16Array    (buf, ex.READY_COUNT_PTR.value, N);
                    _nodeTree       = new Uint32Array    (buf, ex.NODE_TREE_PTR.value,  N * 3);
                    _edgeEpoch      = new Uint32Array    (buf, ex.EDGE_EPOCH_PTR.value, EDGES); // Uint32 (Speed constraint)
                    _sigHead        = new Int32Array     (buf, ex.SIG_HEAD_PTR.value, N);
                    _headDep        = new Int32Array     (buf, ex.HEAD_DEP_PTR.value, N);
                    _edges          = new Int32Array     (buf, ex.EDGES_PTR.value, EDGES * 4); // V17 Stride-4
                    _nodeGen        = new BigUint64Array (buf, ex.NODE_GEN_PTR.value, N); // V17 ABA Defense
                    
                    // Note: If pending/zombie queues remain in JS, leave them as JS arrays.
                    // If WASM manages the sweep/flush, map them here:
                    // _pendingQueue   = new Int32Array(buf, ex.PENDING_PTR.value, N);
                    // _zombieQueue    = new Int32Array(buf, ex.ZOMBIE_PTR.value, N);

                    // JS-only arrays hold live object refs -- they cannot live in linear memory
                    [_values, _ctx] = ψ(Array, N, N);

                    // Sync Global Bounds
                    MAX_NODES = N;
                    MAX_EDGES = EDGES;
                    EDGE_MAX_STRIDE = EDGES * EDGE_STRIDE;

                    // Sync Cursors & Epochs
                    _nodePtr = 1; 
                    _edgePtr = EDGE_STRIDE; // Start at index 4 (lane 0 of second edge)
                    _freeNodeHead = 0;
                    _freeEdgeHead = 0;
                    _globalUUID = 0n;
                    _traceEpoch = 0;

                    // Hot-swap the kernel core to the WASM exports
                    allocNode = ex.allocNode;
                    flushQueue = ex.flushQueue;
                    // trigger = ex.trigger; 
                    // sweep = ex.sweep;

                    const rootPtr = allocNode();
                    _trits[rootPtr] = ROOT_MOUNT;
                    const root = Signal(rootPtr);
                    graft(root, Substrate.prototype, ['constructor']);
                    
                    console.log(TEXT_WASM, 'color: #10b981;');
                    return (arena = root);

                } catch (e) {
                    console.warn('[Chimera V17] WASM upgrade failed; falling back to native JS.', e?.message || e);
                    return new Substrate({ size, wasm: false });
                }
            })();
        }

        // -- BRANCH A: Native JS Arena (Sync, Fallback) --
        const root = Signal.init(size);
        graft(root, Substrate.prototype, ['constructor']);
        console.log(TEXT_SYNC, 'color: #f59e0b;');
        return (arena = root);
    }

	get activeNodes() { return _liveNodes; }
	get density() { return _nodePtr / (MAX_NODES || 1); }

	pause() { _isPaused = true; }
	resume() { _isPaused = false; flushQueue(); }
	signal(key, value, opts = {}) {
		let depth = 0, raw = value;
		if (raw !== null && typeof raw === 'object' && raw[CHIMERA_LAYER] !== void 0) { depth = raw[CHIMERA_LAYER]; raw = raw.value; }
		else if (typeof opts.layer === 'number') depth = opts.layer;
		else if (opts.deep) depth = Infinity;
		let trit = opts._trit ?? encodeTrit(1, 1, 1, -1, -1);
		if (depth > 0) trit = _setA(trit, depth === 1 ? -1 : 1);
		return _wire(trit, raw, opts.free | 0);
	}
}

// Store reconciliation helpers (unchanged except dirty bit handling)
function settle(p, prev, next) { if (next === undefined) invalidateConsumers(p); else trigger(p); }
function settleManual(p, prev, next) { if (next === undefined) { if (prev !== undefined) fireAndWithdraw(p); } else trigger(p); }

function reconcileSubtree(store, name, oldVal, newVal) {
	const oldObj = oldVal !== null && typeof oldVal === 'object';
	const newObj = newVal !== null && typeof newVal === 'object';
	if (!oldObj && !newObj) return;
	const dict = store.dict;
	const keys = new Set();
	if (oldObj) { for (const kk in oldVal) keys.add(kk); if (Array.isArray(oldVal)) keys.add('length'); }
	if (newObj) { for (const kk in newVal) keys.add(kk); if (Array.isArray(newVal)) keys.add('length'); }
	for (const kk of keys) {
		const childName = name + '.' + kk;
		const r = dict.get(childName);
		if (r == null) continue;
		const cn = Signal.deref(r);
		if (!cn) continue;
		const p = cn.ptr;
		const nv = newObj ? newVal[kk] : undefined;
		const prevVal = _values[p];
		if (is(prevVal, nv)) continue;
		_values[p] = nv;
		store._proxies.delete(childName);
		reconcileSubtree(store, childName, oldObj ? oldVal[kk] : undefined, nv);
		if (nv === undefined && _nodeTree[p * 3 + TREE_CHILD] === 0 && !hasExternalReader(p)) {
			dict.delete(childName); tagForDisposal(p);
		} else settle(p, prevVal, nv);
	}
}

function mintField(val) {
	const prev = _activePtr; _activePtr = 0;
	try { return _wire(TRIT_STATE, val, 0); } finally { _activePtr = prev; }
}

function storeMode(key) {
	const m = /^[$Δ]+/.exec(key);
	const n = m ? m[0].length : 0;
	return n >= 2 ? 'deep' : n === 1 ? 'shallow' : 'atomic';
}

// cascadeUp — hierarchical consensus/union barrier for deep fields.
// A leaf (or a sub-tree that just fired) propagates upward; at each ancestor we
// gate on that parent node's A axis read straight from the trit: Union (+1) fires
// on any single child; Consensus (-1) fires only once every child has fired since
// the parent last fired. The barrier state lives in store._quorum (a changed-key
// Set per dotted parent name) and clears on fire, so a new transaction re-arms.
function cascadeUp(store, childName) {
	let name = childName;
	for (;;) {
		const cut = name.lastIndexOf('.');
		if (cut < 1) return;                              // reached the field root — done
		const parentName = name.slice(0, cut);
		const childKey   = name.slice(cut + 1);
		const pRef  = store.dict.get(parentName);
		const pNode = pRef != null ? Signal.deref(pRef) : null;
		if (!pNode) return;
		const pObj = _values[pNode.ptr];
		if (pObj === null || typeof pObj !== 'object') return;
		let fired;
		if (LUT_A[_trits[pNode.ptr] + Z] === 1) {         // UNION — gate on the trit
			fired = true;
		} else {                                          // CONSENSUS — quorum barrier
			let q = store._quorum.get(parentName);
			if (!q) { q = new Set(); store._quorum.set(parentName, q); }
			q.add(childKey);
			if (q.size >= Object.keys(pObj).filter(kk => kk[0] !== '@').length) { q.clear(); fired = true; }
			else fired = false;
		}
		if (!fired) return;
		trigger(pNode.ptr);                               // fire this parent's subscribers
		name = parentName;                                // and propagate upward
	}
}

function storeWrite(store, key, val) {
	let depthOverride = null;
	if (val !== null && typeof val === 'object' && val[CHIMERA_LAYER] !== undefined) { depthOverride = val[CHIMERA_LAYER]; val = val.value; }
	const ref = store.dict.get(key);
	const node = ref != null ? Signal.deref(ref) : null;
	if (node && _accessorSet.size && _accessorSet.has(node.ptr)) { _accessorSet.get(node.ptr).call(node, val); return node; } // writable-accessor field: dispatch to its setter
	if (node) {
		if (depthOverride !== null) { const cBand = depthOverride >= 3 || depthOverride === Infinity ? 1 : depthOverride === 1 ? -1 : 0; _trits[node.ptr] = _setC(_trits[node.ptr], cBand); }
		const oldV = _values[node.ptr];
		if (is(oldV, val)) { store._proxies.delete(key); return node; }
		_values[node.ptr] = val;
		settleManual(node.ptr, oldV, val);
		reconcileSubtree(store, key, oldV, val);
		store._proxies.delete(key);
		return node;
	}
	const fresh = mintField(val);
	if (depthOverride !== null) { const cBand = depthOverride >= 3 || depthOverride === Infinity ? 1 : depthOverride === 1 ? -1 : 0; _trits[fresh.ptr] = _setC(_trits[fresh.ptr], cBand); }
	if (storeMode(key) === 'deep') _trits[fresh.ptr] = _setA(_trits[fresh.ptr], isUnion(key) ? 1 : -1);
	adopt(_getGlobal().ptr, fresh.ptr);
	store.dict.set(key, fresh.ref);
	store._proxies.delete(key);
	return fresh;
}

function storeRead(store, key) {
	const ref = store.dict.get(key);
	let node = ref != null ? Signal.deref(ref) : null;
	if (!node) node = storeWrite(store, key, undefined);
	const obj = _values[node.ptr];
	if (obj === null || typeof obj !== 'object') return get(node.ptr);
	const mode = storeMode(key);
	if (mode === 'atomic') { track(node.ptr); return obj; }   // ATOMIC: opaque — subscribe to the root, hand back the raw object
	let px = store._proxies.get(key);
	if (!px) { px = storeDescend(store, key, node.ptr, mode, isUnion(key)); store._proxies.set(key, px); }
	if (mode === 'deep') track(node.ptr);
	return px;
}

function storeDescend(store, name, ownerPtr, mode, union) {
	const dict = store.dict;
	const obj = _values[ownerPtr];
	if (obj === null || typeof obj !== 'object') return obj;
	const field = (childName, val, t) => {
		const r = dict.get(childName);
		const n = r != null ? Signal.deref(r) : null;
		if (n) return n;
		let back = val !== null && typeof val === 'object' && val === t ? ownerPtr : null;
		if (back === null && val !== null && typeof val === 'object') {
			let anc = name;
			while (anc) {
				const anRef = dict.get(anc);
				const an = anRef != null ? Signal.deref(anRef) : null;
				if (an && _values[an.ptr] === val) { back = an.ptr; break; }
				const cut = anc.lastIndexOf('.');
				anc = cut > 0 ? anc.slice(0, cut) : '';
			}
		}
		if (back !== null) {
			dict.set(childName, _nodeGen[back] * ID_MULTIPLIER_BIG + BigInt(back));
			return Signal(back);
		}
		const fresh = mintField(val);
		if (mode === 'deep') _trits[fresh.ptr] = _setA(_trits[fresh.ptr], union ? 1 : -1);
		dict.set(childName, fresh.ref);
		adopt(ownerPtr, fresh.ptr);
		return fresh;
	};
	return new Proxy(obj, {
		get(t, k, r) {
			if (typeof k === 'symbol') return Reflect.get(t, k, r);
			const cur = t[k];
			if (typeof cur === 'function') return Reflect.get(t, k, r);
			const childName = name + '.' + k;
			const n = field(childName, cur, t);
			if (mode === 'deep') {
				// subscribe to the deepest node actually reached: descending past this
				// parent moves its edge to the child (retarget — zero alloc/free churn),
				// preserving the prune's watcher-isolation semantics at O(1).
				if (_activePtr !== 0 && LUT_T[_trits[_activePtr] + Z] !== 0) retargetDep(_activePtr, ownerPtr, n.ptr);
				else if (_activePtr !== 0) unsubscribe(_activePtr, ownerPtr);
				else track(n.ptr);
				if (k[0] !== '@' && cur !== null && typeof cur === 'object') {
					if (n.ptr === ownerPtr) return r;   // self-cycle: fold the self-edge onto this proxy
					return storeDescend(store, childName, n.ptr, mode, union);
				}
				return cur;
			}
			track(n.ptr);
			return cur;
		},
		set(t, k, v, r) {
			if (typeof k === 'symbol') { t[k] = v; return true; }
			const prev = t[k];
			if (is(prev, v) && !(k === 'length' && Array.isArray(t))) { t[k] = v; return true; }
			t[k] = v;
			const childName = name + '.' + k;
			const ref = dict.get(childName);
			const n = ref != null ? Signal.deref(ref) : null;
			if (!n) { field(childName, v, t); return true; }
			const oldV = _values[n.ptr];
			_values[n.ptr] = v;
			store._proxies.delete(childName);
			settleManual(n.ptr, oldV, v);
			if (k[0] !== '@') { reconcileSubtree(store, childName, oldV, v); if (mode === 'deep' && (store._cascade ?? !union)) cascadeUp(store, childName); } // @-shadow: own reference only
			return true;
		},
		deleteProperty(t, k) {
			if (typeof k === 'symbol') return delete t[k];
			const had = k in t;
			const oldV = t[k];
			const ok = delete t[k];
			if (had) {
				const childName = name + '.' + k;
				const r = dict.get(childName);
				const n = r != null ? Signal.deref(r) : null;
				if (n) { _values[n.ptr] = undefined; settleManual(n.ptr, oldV, undefined); if (mode === 'deep' && (store._cascade ?? !union)) cascadeUp(store, childName); }
			}
			return ok;
		},
		defineProperty(t, k, desc) {
			const ok = Reflect.defineProperty(t, k, desc);
			if (ok && typeof k !== 'symbol' && 'value' in desc) {
				const childName = name + '.' + k;
				const ref = dict.get(childName);
				const n = ref != null ? Signal.deref(ref) : null;
				if (n) { const oldV = _values[n.ptr]; _values[n.ptr] = desc.value; settleManual(n.ptr, oldV, desc.value); }
				else field(childName, desc.value, t);
				if (mode === 'deep' && (store._cascade ?? !union)) cascadeUp(store, childName);
			}
			return ok;
		},
		has(t, k)  { return k in t; },
		ownKeys(t) { return Reflect.ownKeys(t); },
		getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); }
	});
}

/* kernel weak registry — single mint for the kernel's module tables (core has WEAK).
 * The dynamic per-node weak buckets in the memo cache tree stay structural. */
const KWEAK = { mint(name, kind) { return (KWEAK[name] = kind === 'set' ? new WeakSet() : new WeakMap()); } };
const TRIADS = KWEAK.mint('TRIADS', 'map');   // store → Map(prefix → functor) — identity-stable accessors
function triad(store, prefix, isUnion) {
	let _m = TRIADS.get(store);
	if (!_m) TRIADS.set(store, _m = new Map());
	const _hit = _m.get(prefix);
	if (_hit) return _hit;
	/* The triad contract (0.87.9):
	 *   this.$count      — tracked read/write accessor        (element proxy, unchanged)
	 *   this.$('count')  — UNTRACKED read (peek); two-arg form writes (notifying)
	 *   this.$.count     — the Signal handle itself (get/set/peek/poke + Symbol.toPrimitive)
	 * Function-arg form mints an effect at this triad's grain; object form bulk-writes. */
	const write = (key, val) => storeWrite(store, prefix + key, val);
	const node  = (key) => {                       // handle: minted on miss, NEVER tracks
		const full = prefix + key;
		const ref = store.dict.get(full);
		const n = ref != null ? Signal.deref(ref) : null;
		return n || storeWrite(store, full, undefined);
	};
	const peek  = (key) => {                       // untracked read — the function syntax
		const ref = store.dict.get(prefix + key);
		const n = ref != null ? Signal.deref(ref) : null;
		return n ? rawget(n.ptr) : undefined;
	};
	const depth   = sigilDepth(prefix);                                              // 0 | 1 | Infinity
	const capture = depth === Infinity ? 'deep' : depth === 1 ? 'shallow' : 'atomic';
	const affect  = isUnion ? 'union' : 'consensus';
	const functor = (arg1, arg2) => {
		if (typeof arg1 === 'string') return arg2 === undefined ? peek(arg1) : (write(arg1, arg2), arg2);
		if (typeof arg1 === 'function')
			return new Signal({ value: arg1, options: { capture, affect, effect: arg2 ? 'pull' : 'push' } });
		if (arg1 !== null && typeof arg1 === 'object') {
			const keys = Object.keys(arg1);
			const put = () => { for (const key of keys) write(key.replace(/^[$Δ]+/, ''), arg1[key]); };
			if (isUnion) put(); else Signal.batch(put);
			return store;
		}
		return undefined;
	};
	// ghost function: no own keys (length/name deleted; arrows have no prototype),
	// no inheritance — every string key uniformly resolves to a cell handle, so
	// user keys named toString/name/call/then are reachable and nothing collides.
	Reflect.deleteProperty(functor, 'length');
	Reflect.deleteProperty(functor, 'name');
	Object.setPrototypeOf(functor, null);
	const px = new Proxy(functor, {
		get(f, k) { return k === 'then' ? undefined : typeof k === 'string' ? node(k) : Reflect.get(f, k); }, // then stays reserved: handles are callable, a minted then-handle would satisfy the thenable protocol
		set(_, k, v) { write(k, v); return true; },
	});
	_m.set(prefix, px);
	return px;
}

// ψ — the chainable seeding functor (0.87.a):
//   owner.ψ('$count', 0)('$abc', 1)(() => {})()
//   (key, val)          → write (bare keys default to the $ tier), returns the chain
//   (fn, key?, options?) → effect — shallow by default; options = Signal options API
//                          (explicit null key when only options are given); named
//                          effects park their ref at `${key}$$effect` in the dict
//   ({ bulk })          → batched writes, returns the chain
//   ()                  → unwraps back to the underlying owner (element or store)
const PSI = KWEAK.mint('PSI', 'map');
function psiChain(store, owner) {
	let chain = PSI.get(owner);
	if (chain) return chain;
	const sig = k => /^[$Δ@ø]/.test(k) ? k : '$' + k;
	chain = function ψ(a, b, c) {
		if (arguments.length === 0) return owner;
		if (typeof a === 'function') {
			const opts = (c !== null && typeof c === 'object') ? c : {};
			const capture = opts.capture ?? (opts.deep ? 'deep' : 'shallow');
			const affect  = opts.affect  ?? (opts.union ? 'union' : 'consensus');
			const node = new Signal({ value: a, options: { ...opts, capture, affect } });
			if (typeof b === 'string' && b) store.dict.set(b + '$$effect', node.ref);
			return chain;
		}
		if (typeof a === 'string') { storeWrite(store, sig(a), b); return chain; }
		if (a !== null && typeof a === 'object') {
			Signal.batch(() => { for (const k of Object.keys(a)) storeWrite(store, sig(k), a[k]); });
			return chain;
		}
		return chain;
	};
	PSI.set(owner, chain);
	return chain;
}

// Memoization (APM) — with maxSize and FIFO eviction
const _deepCache = KWEAK.mint('deepCache', 'map');
const _proxySet  = KWEAK.mint('proxySet', 'set');
const _memoGC = (typeof FinalizationRegistry === 'function')
	? new FinalizationRegistry(ref => { const h = Signal.deref(ref); if (h) h.dispose(); })
	: null;

function createDeepProxy(obj, depth, ownerPtr, union) {
	if (obj === null || typeof obj !== 'object' || _proxySet.has(obj) || depth <= 0) return obj;
	const hit = _deepCache.get(obj); if (hit) return hit;
	const changed = union ? null : new Set();
	const proxy = new Proxy(obj, {
		get(t, k, r) {
			if (typeof k === 'symbol') return Reflect.get(t, k, r);
			const cur = t[k];
			if (typeof cur === 'function') return Reflect.get(t, k, r);
			if (ownerPtr) track(ownerPtr);
			return cur !== null && typeof cur === 'object' && depth > 1
				? createDeepProxy(cur, depth === Infinity ? Infinity : depth - 1, ownerPtr, union)
				: cur;
		},
		set(t, k, v) {
			if (typeof k === 'symbol') { t[k] = v; return true; }
			t[k] = v;
			if (ownerPtr) {
				if (union) trigger(ownerPtr);
				else { changed.add(k); if (changed.size >= Object.keys(t).length) { changed.clear(); trigger(ownerPtr); } }
			}
			return true;
		},
	});
	_deepCache.set(obj, proxy); _proxySet.add(proxy);
	return proxy;
}

function trieNode(parent = null, key = null, bucket = null) { 
    return { children: null, weak: null, node: null, val: undefined, parent, key, bucket, refs: 0 }; 
}

function trieDescend(root, args) {
    let cur = root;
    for (let i = 0; i < args.length; i++) {
        cur.refs++;                         // this path is now used by one more leaf
        const arg = args[i];
        const isSig = arg instanceof Signal;
        const weak  = !isSig && arg !== null && (typeof arg === 'object' || typeof arg === 'function');
        const key   = isSig ? arg.ref : arg;
        const bucket = weak ? (cur.weak || (cur.weak = new WeakMap())) : (cur.children || (cur.children = new Map()));
        
        if (!bucket.has(key)) {
            bucket.set(key, trieNode(cur, key, bucket));
        }
        cur = bucket.get(key);
    }
    cur.refs++;                             // the leaf itself counts as one reference
    return cur;
}

// Non-mutating descent: walk existing buckets only — no creation, no ref counting.
function triePeek(root, args) {
    let cur = root;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const isSig = arg instanceof Signal;
        const weak  = !isSig && arg !== null && (typeof arg === 'object' || typeof arg === 'function');
        const key   = isSig ? arg.ref : arg;
        const bucket = weak ? cur.weak : cur.children;
        if (!bucket || !bucket.has(key)) return null;
        cur = bucket.get(key);
    }
    return cur;
}

// Detach a leaf from the trie: clear payload, walk up decrementing refs, prune dead branches.
// (Extracted from the eviction path so delete()/stale-rebuild share the exact invariant.)
function triePrune(leaf) {
    leaf.node = null; leaf.val = undefined;
    let curr = leaf;
    while (curr && curr.parent) {
        curr.refs--;
        if (curr.refs === 0) {
            curr.bucket.delete(curr.key);
            if (curr.bucket instanceof Map && curr.bucket.size === 0) curr.parent.children = null;
        }
        curr = curr.parent;
    }
    if (curr) curr.refs--;
}

/**
 * Wraps a function in an Autonomous Parameterized Memoization (APM) trie.
 * Each unique argument signature generates its own distinct, reactive arena node (leaf).
 * * @param {Function} fn - The computation or effect to memoize.
 * @param {Object} [opts={}] - Configuration options (union, deep, effect, maxSize).
 * @returns {Function} A memoized proxy function that tracks arguments and caches results.
 * * @internal
 * MEMORY PRUNING INVARIANT (V17):
 * We maintain a strict FIFO eviction policy capped at `maxSize` (default 10,000) 
 * to prevent arena OOM. Because arguments are mapped into a nested Trie of `Map` 
 * and `WeakMap` buckets, evicting the leaf's signal is not enough—the parent Maps 
 * would accumulate primitive keys forever, causing a severe structural memory leak.
 * * To fix this, `trieNode` implements bottom-up reference counting (`refs`). 
 * When a leaf is evicted, we walk up the `parent` chain, decrementing `refs`. 
 * If a branch hits 0, we surgically `delete` its key from the parent's bucket, 
 * collapsing dead branches and completely eliminating the leak.
 */
function memo(fn, opts = {}) {
    const union = !!opts.union, deep = opts.deep ? Infinity : 0, isEffect = !!opts.effect;
    const maxSize = opts.maxSize ?? 10000;
    // key strategy: 'args' (default) = trie over the argument tuple; a function derives
    // a custom signature — cache keyed by opts.key(...args), factory still gets real args.
    const sigOf = typeof opts.key === 'function' ? (args) => [opts.key.apply(null, args)] : (args) => args;
    let live = 0;                                   // live leaf count — the management-API size
    const host = allocNode();
    _trits[host] = TRIT_STATE;
    _ctx[host] = trieNode();
    adopt(_getGlobal().ptr, host);
    const dropFromQueue = (ptr) => {
        const q = _ctx[host].leafQueue;
        if (!q) return;
        const i = q.findIndex(e => e.ptr === ptr);
        if (i >= 0) q.splice(i, 1);
    };

    const leafTrit = isEffect
        ? encodeTrit(-1,  1, union ? 1 : -1, deep ? 1 : 0, -1)
        : encodeTrit( 1, -1, union ? 1 : -1, deep ? 1 : 0, -1);

    const memoized = function memoized(...args) {
        const leaf = trieDescend(_ctx[host], sigOf(args));
        const cached = leaf.node;
        
        // Cache Hit: Re-track or eagerly dispose if generator gen-tags mismatch
        if (cached && _nodeGen[cached.ptr] === cached.gen) {
            if (isEffect) return undefined;
            if (_trits[cached.ptr] > 40) { track(cached.ptr); return leaf.val; }
            dropFromQueue(cached.ptr); live--;      // stale — this leaf is being rebuilt
            tagForDisposal(cached.ptr); sweep();
        }

        // Cache Miss: Allocate a new reactive node for this argument signature
        const leafPtr = allocNode();
        _trits[leafPtr] = leafTrit;
        adopt(host, leafPtr);
        const leafRef = _nodeGen[leafPtr] * ID_MULTIPLIER_BIG + BigInt(leafPtr);
        
        // Register objects with the GC to auto-dispose reactive nodes when args die
        if (_memoGC) {
            for (const a of args) {
                if (a !== null && (typeof a === 'object' || typeof a === 'function') && !(a instanceof Signal))
                    _memoGC.register(a, leafRef);
            }
        }

        // Register the new leaf in the eviction queue
        const leafQueue = _ctx[host].leafQueue || (_ctx[host].leafQueue = []);
        leafQueue.push({ ptr: leafPtr, trieNode: leaf });
        live++;

        // FIFO EVICTION & TRIE PRUNING
        if (leafQueue.length > maxSize) {
            const old = leafQueue.shift();
            if (old && old.trieNode && old.trieNode.node && old.trieNode.node.ptr === old.ptr) {
                triePrune(old.trieNode);            // detach from the trie (extracted invariant)
            }
            
            // Dispose the arena node to free the actual memory
            if (old && _trits[old.ptr] !== 0) { tagForDisposal(old.ptr); sweep(); live--; }
        }

        // Execute and bind result to the leaf node
        if (isEffect) {
            _values[leafPtr] = () => fn.apply(this, args);
            _ctx[leafPtr] = { _chimeraFn: _values[leafPtr] };
            leaf.node = Signal(leafPtr);
            leaf.val = undefined;
            runNode(leafPtr);
            return undefined;
        } else {
            const prev = _activePtr; _activePtr = leafPtr; _traceEpoch++;
            let result;
            try { result = fn.apply(this, args); }
            catch (e) { 
                console.error('[Chimera V17] memo error:', e); 
                _trits[leafPtr] = QUARANTINE; 
                _activePtr = prev; 
                return undefined; 
            }
            _activePtr = prev;
            
            const out = deep ? createDeepProxy(result, deep, leafPtr, union) : result;
            leaf.node = Signal(leafPtr);
            leaf.val = out;
            track(leafPtr);
            return out;
        }
    };

    // ── per-signature management API (0.87.8) — the unified-Store contract ──
    const liveLeaf = (leaf) => !!(leaf && leaf.node
        && _nodeGen[leaf.node.ptr] === leaf.node.gen && _trits[leaf.node.ptr] > 40);

    memoized.has = (...args) => liveLeaf(triePeek(_ctx[host], sigOf(args)));

    memoized.delete = (...args) => {
        const leaf = triePeek(_ctx[host], sigOf(args));
        if (!leaf || !leaf.node) return false;
        const ptr = leaf.node.ptr, gen = leaf.node.gen;
        dropFromQueue(ptr);
        triePrune(leaf);
        if (_nodeGen[ptr] === gen && _trits[ptr] !== 0) { tagForDisposal(ptr); sweep(); }
        live--;
        return true;
    };

    memoized.clear = () => {
        const q = _ctx[host].leafQueue || [];
        for (const e of q) if (_trits[e.ptr] !== 0) { tagForDisposal(e.ptr); }
        if (q.length) sweep();
        _ctx[host] = trieNode();
        live = 0;
    };

    Object.defineProperty(memoized, 'size', { get: () => live });

    return memoized;
}


Signal.memo = memo;

// Reactive class scanner (unchanged except uses get() for computed members)
function memberTrit(R, E, union, deep) { return encodeTrit(R, E, union ? 1 : -1, deep ? 1 : -1, -1); }

function scanClass(instance, store, activeEffects, members) {
	const enginePtr = store.engine.ptr;
	const seen = new Set(['constructor']);
	let proto = Object.getPrototypeOf(instance);
	while (proto && proto !== Signal.prototype && proto !== Object.prototype && proto !== Function.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (seen.has(key)) continue;
			seen.add(key);
			const sfx = SUFFIX_RE.exec(key);
			if (sfx && sfx[1] !== '') {
				const desc = Object.getOwnPropertyDescriptor(proto, key);
				if (desc && (typeof desc.value === 'function' || typeof desc.get === 'function')) {
					const sig = sfx[2];
					activeEffects.push({ key, name: sfx[1], method: desc.value || desc.get, deep: sig.length >= 3, union: isUnion(sig) });
				}
				continue;
			}
			const pfx = PREFIX_RE.exec(key);
			if (!pfx) continue;
			const sig = pfx[1], depth = sigilDepth(key), deep = depth === Infinity, union = isUnion(sig);
			const desc = Object.getOwnPropertyDescriptor(proto, key);
			if (!desc) continue;
			const isGetter = typeof desc.get === 'function', isMethod = typeof desc.value === 'function';
			if (!isGetter && !isMethod) continue;
			const trit = memberTrit(1, -1, union, deep);
			const ptr = allocNode();
			_trits[ptr] = trit;

			if (isGetter) {
				_values[ptr] = desc.get;                     // function
				_ctx[ptr] = undefined;                       // cached result goes here
				adopt(enginePtr, ptr);
				Object.defineProperty(instance, key, {
					configurable: true, enumerable: true,
					get: function () {
						const val = get(ptr);
						return depth > 0 ? createDeepProxy(val, depth, ptr, union) : val;
					}
				});
			} else {
				adopt(enginePtr, ptr);
				Object.defineProperty(instance, key, {
					configurable: true, enumerable: true, writable: true,
					value: memo(desc.value, { union, deep })
				});
			}
			members.add(key);
			store.dict.set(key, _nodeGen[ptr] * ID_MULTIPLIER_BIG + BigInt(ptr));
		}
		proto = Object.getPrototypeOf(proto);
	}
}

function registerActiveEffects(proxy, store, effects) {
	for (const { key, method, deep, union } of effects) {
		const c = new Signal.Effect(method.bind(proxy), { _trit: memberTrit(-1, 1, union, deep) });
		adopt(store.engine.ptr, c.ptr);
		store.dict.set(key, c.ref);
	}
}

Signal.reactive = reactive;
Signal.layer    = layer;

// ── Boot ──
init(SIZES.L2);

const API = { Signal, Substrate, reactive, layer, getEngine, REACTIVE_STORE, CHIMERA_LAYER };
try {
	return Object.defineProperty(globalThis, CHIMERA, {
		value: () => API,
		writable: false, enumerable: false, configurable: false
	})[CHIMERA]();
} catch (e) {
	return API;
}

});
