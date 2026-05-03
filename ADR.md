# Chimera Kernel — Architectural Decision Record
**Version:** 6.5.2-nightly  
**Scope:** Hot-path kernel only (§1–§4, §5 GraphNode, §13 Substrate)  
**Purpose:** Permanent record of every non-obvious micro-architectural decision, the reasoning behind it, and the cost of reversing it.

---

## ADR-001 · IIFE with Lexical Kernel State

**Decision:** All kernel state (`_pool`, `_flags`, `_sigHead`, `_headDep`, all edge arrays, all counters) is declared as `let` variables at the top of a single IIFE. Nothing is exported as object properties. Nothing lives on `this`.

**Rationale:** V8's optimising compiler (Turbofan) resolves lexically closed-over variables to raw memory offsets at compile time when a function is fully inlined or JIT-compiled hot. A property lookup — even `this._flags[ptr]` — requires the engine to walk the object's hidden class and emit a load-with-offset instruction *guarded by a map check*. A closed-over `let` variable compiles to an unguarded direct load from a known slot in the closure's context array. On the hot path (`trigger` → `flushQueue` → `runNode`), which runs at 60+ Hz and touches every array on every frame, the difference between a guarded property load and a direct context-slot load is measurable.

**Cost of reversal:** Moderate. Moving state to an object or class would require wrapping every hot-path function in a method and paying the hidden-class guard on every array access. Benchmarks have shown ~10–15% throughput regression in equivalent reactive kernels.

---

## ADR-002 · Struct-of-Arrays (SoA) Memory Layout

**Decision:** Node data is split across parallel TypedArrays (`_flags`, `_sigHead`, `_headDep`, `_parent`, `_firstChild`, `_nextSibling`) and a single JS object pool (`_pool`). Edge data is similarly split (`_edgeNextSub`, `_edgePrevSub`, `_edgeNextDep`, `_edgeSignal`, `_edgeEffect`). Node and edge indices are integers — not object references.

**Rationale:** The alternative — Array-of-Structs (AoS), i.e., one JS object per node with all fields on it — is the intuitive model but the wrong one for a reactive graph. AoS means every cache line pulled for a node also pulls its rarely-touched fields. SoA means the hot-path fields (flags, sigHead, headDep) for many adjacent nodes fit in a single 64-byte L1 cache line. During a flush of N dirty nodes, the engine accesses `_flags[ptr]` for each: with SoA all N flag bytes are contiguous and likely already in L1 after the first access. With AoS, each node's flags live at a different offset inside a different heap object, forcing N separate cache-line fetches.

**The important caveat:** The bottleneck in a reactive graph is *pointer-chasing*, not sequential bandwidth. The graph traversal in `trigger()` (following `_sigHead[sigPtr]` → `_edgeNextSub[edge]` → `_edgeEffect[edge]` → back to `_flags[nodePtr]`) causes L2/L3 cache misses regardless of layout, because the pointer chain is random. SoA wins on the scheduler side (sequential flush of `_pendingQueue`) and on the flag-check side (dense `Uint8Array`). It does not eliminate graph-traversal misses — nothing can.

**Cost of reversal:** High. The entire kernel assumes integer indices as node identity. Switching to object references would require removing all TypedArray arithmetic and would destroy the arena allocator.

---

## ADR-003 · `Uint8Array` for `_flags` — Full 8-Bit Allocation

**Decision:** Node flags are stored in a `Uint8Array`. All 8 bits are assigned:

```
Bit   Constant   Value   Axis
───   ────────   ─────   ──────────────────────────────────────────
  0   ZOMBIE       1     Lifespan   — terminal state, slot recyclable
  1   RUNNING      2     Execution  — guard against re-entrant runNode
  2   STALE        4     Reactivity — pull-side: computed needs recompute
  3   DIRTY        8     Reactivity — push-side: effect triggered, needs run
  4   DEEP        16     Graph      — value wrapped in deepProxy
  5   YIELD       32     Execution  — node is a coroutine (generator)
  6   FROZEN      64     Reactivity — scheduler paused, don't execute
  7   DYNAMIC    128     Graph      — force edge retrace regardless of DEEP
```

**Rationale — Uint8Array over Uint16Array or Uint32Array:** At 262,144 nodes, `Uint8Array` occupies 256 KB — precisely fitting in a typical 512 KB L2 cache. `Uint16Array` would double that to 512 KB, spilling into L3 on most CPUs. `Uint32Array` would reach 1 MB, a guaranteed L3 miss on every flag read. For the sequential flush path (`flushQueue` iterating `_pendingQueue` and reading `_flags[ptr]` for each), packing 64 nodes per 64-byte cache line versus 32 (Uint16) or 16 (Uint32) is a real win.

**Rationale — full bit allocation:** Keeping flags in one byte means a single load instruction retrieves all node state. Any multi-flag check (`ZOMBIE | RUNNING | STALE | FROZEN`) is a single `&` against a constant, resolved in one CPU cycle after the load. With state spread across two bytes or two fields, each check requires two loads.

**Invariant: STALE and DIRTY never coexist.** Computeds are pull-based: they become `STALE` when a dependency fires and recompute lazily on `get()`. Effects are push-based: they become `DIRTY` when a dependency fires and execute eagerly via the scheduler. A node is never both. This makes bit 2 and bit 3 semantically non-overlapping despite sharing the byte.

**Invariant: `DIRTY|FROZEN` is a valid composite state** meaning "triggered while frozen, not yet physically in `_pendingQueue`." The scheduler understands this composite: `trigger()` sets `DIRTY` but skips the queue push when `FROZEN` is set; `setFrozen(false)` is the sole site that performs the deferred push.

**Cost of reversal:** Very high. Every flag check in the hot path would need to be rewritten. The L2-fit property would be lost immediately on widening to Uint16Array.

---

## ADR-004 · `!== 0` Instead of Falsy Checks on Pointer Values

**Decision:** All pointer comparisons are written as explicit `!== 0` or `=== 0`, never as `!ptr` or `if (ptr)`.

```js
// Correct — used throughout
if (_freeHead !== 0) { ... }
while (child !== 0) { ... }
if (owner !== 0) adopt(owner, ptr);

// Never written
if (_freeHead) { ... }
while (child) { ... }
```

**Rationale:** Pointer `0` is the null sentinel throughout the kernel. `!ptr` would coerce the integer `0` to boolean `false` — which is correct — but V8's type feedback system tracks the *type* of values seen at each operation site. If a comparison site sees integers exclusively, Turbofan can emit a single integer comparison instruction. If it sees mixed types (because `!ptr` involves implicit boolean coercion), the JIT must either emit a generalised truthiness check or deoptimize the function when its type assumptions are violated. Explicit `!== 0` keeps the comparison strictly integer-typed at every call site, which is always monomorphic and always optimisable to a single `cmp`/`jne`.

Additionally, explicit zero-checks are semantically unambiguous to a human reader: "this is a pointer and zero means null," not "this value is falsy for some reason."

**Cost of reversal:** Low in correctness terms (the semantics are identical for integer pointers), but measurable in JIT quality on the hot path. Do not revert.

---

## ADR-005 · `GraphNode extends null` — Eliminating the Implicit `this` Binding

**Decision:** `GraphNode` explicitly extends `null`, making it a class with no prototype chain above its own prototype.

```js
class GraphNode extends null {
    constructor(ptr, fn, flags, owner = 0, value) {
        // no super() — there is no parent
        ...
        return node; // explicit return of pool object
    }
}
```

**Rationale:** When a class extends a normal base (including implicitly extending `Object`), V8 must emit code in the constructor to: (1) allocate a new object with `new.target.prototype`, (2) initialise it with the implicit `this` binding, and (3) wire up `__proto__`. For `GraphNode`, this work is wasted — the constructor immediately replaces `this` by returning the pool object explicitly. `extends null` signals to V8 that there is no base-class allocation to perform and no `super()` call to make. The constructor body begins without an implicit `this` object being created, which eliminates a hidden allocation on every node construction.

The explicit `return node` from the constructor overrides the default `this` return, giving callers the recycled pool object rather than a freshly allocated one. This is legal in JS constructors when the return value is an object.

**Cost of reversal:** Medium. Removing `extends null` would cause V8 to allocate a throwaway `this` object on every `new GraphNode(...)` call. At arena initialisation this is noise; during steady-state operation where nodes are recycled, it would add GC pressure.

---

## ADR-006 · Pool Monomorphism and the Recycled Prototype Problem

**Decision:** `_pool` is a pre-allocated JS `Array` of fixed size. Every pool slot holds either `null` or a single `GraphNode` instance. On recycle, the same physical object is reused by writing new field values onto it — the object is never replaced. `Substrate` instances in the pool receive their methods via descriptor copying, not `Object.setPrototypeOf`.

**Rationale — monomorphism:** V8 optimises property access via *hidden classes* (also called maps or shapes). When all objects at a given access site share the same hidden class, V8 emits an inline cache (IC) that resolves directly to the field offset — a single load. If objects at the same site have different hidden classes, V8 emits a polymorphic IC (slower) or eventually a megamorphic stub (much slower). `_pool[ptr].fn`, `_pool[ptr].value`, `_pool[ptr].ctx` are accessed thousands of times per second. If every pool slot holds an object with the same hidden class (identical prototype, identical property set, identical property order), every one of those accesses is monomorphic and will be compiled to a direct load.

**Rationale — the recycled prototype bug:** When a `Substrate` engine is disposed, its pool slot is recycled. The physical JS object remains in `_pool[ptr]` with `GraphNode.prototype` as its prototype (because `GraphNode` constructed it). On the next `new Substrate()`, the `GraphNode` constructor sees a non-null slot and reuses the existing object — which is correct for monomorphism. But now `Substrate`'s methods are missing: the object has `GraphNode.prototype`, not `Substrate.prototype`. The naive fix — `Object.setPrototypeOf(node, Substrate.prototype)` — would change the object's hidden class, triggering a V8 deoptimisation of every IC that has ever seen this object. The performance penalty is permanent for the lifetime of the process.

**The fix:** Copy `Substrate.prototype`'s own property descriptors directly onto the instance using `Object.defineProperty`. The object's hidden class does not change (prototype is still `GraphNode.prototype`), all existing ICs remain valid, and the instance gains the engine methods it needs.

```js
const proto = Substrate.prototype;
for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== 'constructor') {
        Object.defineProperty(node, key,
            Object.getOwnPropertyDescriptor(proto, key));
    }
}
```

**Cost of reversal:** Very high. `Object.setPrototypeOf` on any recycled pool object would permanently deoptimise the monomorphic ICs built up during warm-up. FPS regressions from hidden-class deoptimisation are permanent until the process restarts.

---

## ADR-007 · Arena Allocator with Free List and Zombie Queue

**Decision:** Node and edge allocation go through two-stage fallback allocators:

1. **Free list** (`_freeHead`, `_freeEdgeHead`): O(1) reclaim of previously disposed slots.
2. **Bump allocator** (`_nextId`, `_edgeCount`): O(1) allocation from unused arena space.
3. **Zombie sweep** (`_zombieQueue`, `_zombieTail`): deferred batch disposal triggered on OOM, clearing slots for reuse.

Disposal is two-phase: `tagForDisposal(ptr)` marks the node `ZOMBIE` and enqueues it cheaply; `sweep()` does the actual unlink work in batch.

**Rationale:** JS GC pressure is the enemy of frame-rate consistency. Every `new Object()` or `{}` created in a hot loop is a potential minor-GC trigger. The arena allocator means that after warm-up, zero new heap objects are created per frame — all nodes come from the recycled pool. The zombie queue defers the O(edges) unlink work of `disposeSlot` until either OOM is threatened or `forceGC()` is called explicitly, preventing disposal spikes from causing jank during a hot flush cycle.

The pending queue (`_pendingQueue`, a `Uint32Array` ring buffer) is similarly allocation-free: it is pre-allocated at kernel init and reused every frame with `_pendingHead`/`_pendingTail` as read/write cursors.

**Cost of reversal:** High. Removing the arena in favour of JS-managed objects would reintroduce GC pressure proportional to effect count × update frequency.

---

## ADR-008 · ABA Guard via Node ID (`node.id`)

**Decision:** Every node carries a monotonically increasing `id` field (`++_nodeIdCounter`), separate from its arena `ptr`. Async continuations (Promise callbacks, coroutine `.then` handlers) capture `id` at the time of suspension and check it on resume.

```js
const id = node.id;
yielded.then(val => {
    if (_pool[ptr]?.id !== id) return; // node was recycled, abort
    node.value = val;
    trigger(ptr);
});
```

**Rationale — the ABA problem:** When a node at `ptr` is disposed and the slot is recycled, a new node is placed at `_pool[ptr]` with the same `ptr` but a new `id`. An async callback that captured the old `ptr` alone cannot distinguish "I am resuming my node" from "I am resuming a completely different node that happens to occupy the same slot." Acting on a recycled slot would corrupt a live node's state. The `id` check makes this distinction O(1) and allocation-free — no WeakRef, no extra Set, just an integer comparison.

**Cost of reversal:** Low — removing the guard would reintroduce a latent async-corruption bug that only manifests when: a coroutine suspends on a Promise, the coroutine's node is disposed, the slot is recycled, and the Promise resolves. Rare in practice, catastrophic when it occurs.

---

## ADR-009 · `trigger()` / `flushQueue()` / `setFrozen()` State Machine

**Decision:** The scheduler uses `DIRTY` as the single source of truth for "this node needs re-evaluation." Physical queue presence is not tracked by a flag. The three functions form a closed invariant:

- `trigger()`: sets `DIRTY`; pushes to queue **only if** `!FROZEN`. Single code path.
- `flushQueue()`: gates execution on `DIRTY`. Skips `FROZEN` nodes mid-flush, leaving `DIRTY` intact. Drains benign-duplicate entries via the `DIRTY` guard at O(1).
- `setFrozen(false)`: the **sole** deferred-push site. If `DIRTY` is set on resume, the node was triggered while frozen and was never pushed — push it now.

**Rationale:** The previous model used `QUEUED` to mean both "I am dirty" and "I am physically in the array." A `FROZEN` node with `QUEUED` set was ambiguous: was it in the array waiting to be skipped, or not in the array at all? `setFrozen` had to check both `DIRTY` (old bit 128) and `QUEUED` (old bit 8). The current model eliminates the ambiguity: `DIRTY` is always a state description, never a location description. A node is in the queue if and only if `trigger()` set `DIRTY` and `FROZEN` was not set at that moment, or `setFrozen(false)` pushed it. No other code touches the queue.

**Benign duplicate:** A freeze→resume sequence inside a `batch()` can produce a ghost pointer in `_pendingQueue` (the node was pushed by `trigger()`, then `setFrozen(false)` pushes it again). The second dequeue finds `DIRTY` already cleared (first dequeue ran the node and cleared it) and skips in O(1). This is preferable to an O(N) queue-presence scan before every push.

**Cost of reversal:** Medium. The three functions are tightly coupled to this invariant. Any change to one requires re-auditing all three.

---

## ADR-010 · `DEEP | DYNAMIC` Gate on `cleanupEdges()`

**Decision:** `runNode()` calls `cleanupEdges(ptr)` — discarding all tracked dependency edges before re-running — when either `DEEP` or `DYNAMIC` is set.

```js
if (_flags[ptr] & (DEEP | DYNAMIC)) cleanupEdges(ptr);
```

**Rationale:** Edge cleanup is necessary when a node's dependency set can change between runs (conditional reads). Without cleanup, stale edges from branches no longer taken accumulate, causing phantom re-runs. With unnecessary cleanup, a node with a static dependency set pays O(edges) work every run for no benefit.

`DEEP` implies dynamic dependencies because `deepProxy`'s `get` trap calls `track()` on every property access. Which properties are accessed depends on runtime control flow — the dep set is structurally dynamic. `DYNAMIC` is an explicit opt-in for shallow effects whose dep set is also dynamic (conditional signal reads), decoupling "wrap in deepProxy" from "retrace edges every run." These are orthogonal concerns that previously shared the `DEEP` bit.

Computeds always call `cleanupEdges` via `recompute()` — their dep set is inherently unknown until execution. This is not gated by a flag.

**Cost of reversal:** Medium. Merging `DEEP` and `DYNAMIC` back to a single bit would lose the ability to have shallow dynamic effects without deep proxy overhead, and deep static effects without unnecessary retrace cost.

---

## ADR-011 · `'use strict'` Inside the IIFE

**Decision:** `'use strict'` is declared at the top of the IIFE body, not at the file level.

**Rationale:** Strict mode enables several V8 optimisations: it eliminates the `arguments` object aliasing (making argument variables independently optimisable), it disables `with` (which would force scope lookups to be dynamic), and it makes `this` in functions `undefined` rather than the global object (avoiding an implicit global-object lookup on unbound calls). Inside the kernel hot-path functions (`trigger`, `runNode`, `flushQueue`), none of these features are used — but their *absence* allows the JIT to make stronger assumptions about the shape of the call stack. Scoping to the IIFE rather than the file avoids imposing strict mode on any third-party code that might be concatenated with this file.

**Cost of reversal:** Negligible in correctness, small in JIT quality.

---

## ADR-012 · Polyfill as [[Construct]]-less Native-Equivalent Property

**Decision:** `Map.prototype.getOrInsert` and `Map.prototype.getOrInsertComputed` are installed via a `void function($0, $1, $2){...}(...)` IIFE. The installed values are plain function expressions, not arrow functions or class methods. Method names are passed as IIFE arguments, not written as string literals inside the body.

**Rationale — four simultaneous axes that together make the installed property indistinguishable from a native built-in:**

**1. `[[Construct]]`-less.** The polyfill body uses a computed-key object literal to produce the method:

```js
value: { [$1](key, def) { ... } }[$1]
```

A method defined with shorthand syntax (`{ foo() {} }`) produces a function whose `[[Construct]]` internal slot is absent — identical to native prototype methods like `Map.prototype.get`, which also cannot be called with `new`. An arrow function would also lack `[[Construct]]`, but arrow functions have no `prototype` property and no `arguments` binding, which can cause subtle divergence in engine introspection. A named `function` expression would have `[[Construct]]`. The computed-shorthand form is the only way to produce a named, non-arrow, non-constructable function in a single expression.

**2. `WeakMap.prototype` !== `Map.prototype` — separate installation.** The `ensure` helper is called independently for both `Map.prototype` and `WeakMap.prototype`. Native TC39 methods exist separately on each prototype; a single shared function installed on both with the same identity would expose the polyfill to detection via `Map.prototype.getOrInsert === WeakMap.prototype.getOrInsert`. Native methods fail this identity check (`Map.prototype.get !== WeakMap.prototype.get`). The loop installs a fresh descriptor per prototype, matching native behaviour.

**3. Statically lexically analyzable name.** The computed-key `[$1]` pattern means the installed function's `.name` property is set at runtime to the string value of `$1` (`'getOrInsert'` or `'getOrInsertComputed'`). V8 sets `.name` on shorthand methods from their computed key at definition time. The result is a function with a correct, stable `.name` that matches what a native implementation would report — important for stack traces, `Function.prototype.toString`, and engine devtools.

**4. Minifier-transparent string deduplication.** The method name strings (`'getOrInsert'`, `'getOrInsertComputed'`, `'function'`) appear exactly once each — as IIFE call-site arguments. Inside the function body they are single-character parameter names (`$0`, `$1`, `$2`). A minifier sees the parameters as locally scoped identifiers and renames them freely (`a`, `b`, `c`), while the string literals at the call site remain untouched (they must, since they cross the function boundary as values). This achieves the same effect as a `#define` in C: the canonical string lives once, is referenced by a cheap local name throughout, and the minifier collapses the locals to one character.

The `void` prefix on the outer IIFE discards its return value (the function returns `undefined` implicitly) and prevents parsers from treating `function` as a declaration rather than an expression in contexts where the distinction matters.

**Cost of reversal:** None in runtime terms for the `void`/argument pattern. Replacing the shorthand method form with a `function` expression would silently make the polyfill constructable, diverging from native behaviour.

---

## Summary Table

| ADR | Decision | Primary Benefit | Reversal Cost |
|-----|----------|-----------------|---------------|
| 001 | Lexical IIFE state | Unguarded context-slot loads vs property loads | Medium |
| 002 | Struct-of-Arrays layout | L1/L2 cache density on sequential flush | High |
| 003 | Uint8Array flags, all 8 bits used | L2 fit (256 KB), single-load multi-flag checks | Very high |
| 004 | `!== 0` not `!ptr` | Monomorphic integer compare, no boolean coercion | Low |
| 005 | `extends null` | No implicit `this` allocation in constructor | Medium |
| 006 | Pool monomorphism, descriptor copy | Stable hidden class, monomorphic ICs | Very high |
| 007 | Arena + free list + zombie queue | Zero GC pressure post-warmup | High |
| 008 | ABA guard via `node.id` | Async slot-reuse safety, O(1) cost | Low |
| 009 | DIRTY-as-state scheduler invariant | Unambiguous three-function state machine | Medium |
| 010 | `DEEP\|DYNAMIC` edge-cleanup gate | Orthogonal dep-tracing vs proxy-wrapping | Medium |
| 011 | `'use strict'` in IIFE | JIT argument / scope optimisations | Negligible |
| 012 | `[[Construct]]`-less native-equivalent polyfill | Indistinguishable from native: no `[[Construct]]`, separate per-prototype, correct `.name`, minifiable | None |
