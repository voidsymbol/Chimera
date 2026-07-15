```markdown
# Chimera API

## Import

```js
import { Signal, Substrate } from 'chimera';
// or
const { Signal, Substrate } = Chimera;
```

---

## `Substrate`

The arena. Boot it once at startup. Returns a root `Signal` handle.

### `new Substrate(config?)`

```js
const root = new Substrate();                   // default (L2 arena)
const root = new Substrate({ size: 'L3' });     // larger arena
```

**Sizes:** `'L1'` | `'L2'` | `'L3'` | `'L4'` | `'L5'`

### Substrate instance

```js
root.activeNodes   // number → live nodes in the arena
root.density       // number → 0–1 utilization

root.pause()       // freeze all propagation
root.resume()      // thaw + flush queue

root.signal(key, value, opts?)  // child Signal on root
```

### Static methods

```js
Substrate.wipe()   // force zombie sweep
```

---

## `Signal`

Everything is a Signal. The constructor is heavily overloaded.

### `new Signal(value)`

```js
const count = new Signal(0);
const name  = new Signal("Ada");
```

### `new Signal(fn)` — Computed

```js
const doubled = new Signal(() => count.get() * 2);
// Symbol.toPrimitive means this works naturally:
const doubled2 = new Signal(() => count * 2); // automatically tracked! toPrimitive coercion calls .get() 
```

### `new Signal.State(...)` — Explicit state

```js
const s = new Signal.State(0);
```

### `new Signal.Computed(fn, opts?)`

```js
const c = new Signal.Computed(() => a.get() + b.get());
```

### `new Signal.Effect(fn, opts?)`

```js
const e = new Signal.Effect(() => console.log(count.get()));
```

### Generator effects

```js
new Signal.Effect(async function* () {
  while (true) {
    const v = yield;
    await fetch(`/api/${v}`);
  }
});
```

---

## Signal handle API

All signals return a handle with:

### Read

```js
sig.get()   // tracked read (subscribes)
sig.peek()  // untracked read
```

### Write

```js
sig.set(v)  // write + notify
sig.poke(v) // write silently
```

### Coercion

```js
+sig      // → Number (tracked)
`${sig}`  // → String (tracked)
sig == x  // → peek() comparison (untracked)
```

### Lifecycle

```js
sig.keep()       // adopt into root (prevent GC)
sig.detach()     // park, stop propagating
sig.reattach()   // resume
sig.freeze()     // make static
sig.unfreeze()   // reanimate
sig.dispose()    // destroy
```

### Derivation

```js
sig.map(fn)             // computed: fn(value)
sig.filter(pred)        // computed: hold last value passing pred
sig.combine(other, fn)  // computed from two signals
sig.effect(fn)          // effect firing on change
sig.untrack(fn)         // run fn without tracking
```

### Static methods

```js
Signal.batch(fn)     // batch writes, flush at end
Signal.untrack(fn)   // run untracked
Signal.wipe()        // force zombie sweep
Signal.teardown()    // destroy arena, reinit L1
```

---

## Options reference

| Axis | Option | Values | Behavior |
|------|--------|--------|----------|
| **R** | `return` | `'fresh'` | Value current |
| | | `'stale'` | Needs recompute |
| | | `'frozen'` | Inert snapshot |
| **E** | `effect` | `'push'` | Eager: run when dirty |
| | | `'pull'` | Lazy: run on read |
| | | `'detached'` | Parked |
| **A** | `affect` | `'union'` | Fire on any dep change |
| | | `'consensus'` | Fire after ALL deps signaled |
| **C** | `capture` | `'deep'` | Track nested props |
| | | `'shallow'` | Top-level only |
| | | `'atomic'` | Opaque, no tracking |
| **T** | `threshold` | `'volatile'` | Always resubscribe |
| | | `'semantic'` | Standard tracking |
| | | `'untracked'` | No tracking |
```

---

Want me to continue with `Store`, `memo`, `reactive`, and the triads (`$`, `Δ`, `ψ`, `ø`, `@`)?
