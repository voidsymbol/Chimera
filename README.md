```markdown
# Chimera API

## Import

```js
import { Signal, Substrate } from 'chimera';
// or
const { Signal, Substrate } = Chimera; // use this for now
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

### `new Signal(fn)` — Effect (to begin with, later depends on return value)

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

### `new Signal.Store(data?, options?)`

The reactive key-value store. Two modes: manual and memo.

### Manual store

```js
const store = new Signal.Store();
const store = new Signal.Store({ engine: root });    // attach to a substrate
const store = new Signal.Store({ darkMode: false }); // seed with values

store.write('count', 0);      // write a value
store.read('count');           // tracked read
store.has('count');            // → boolean
store.delete('count');         // dispose the node
store.clear();                 // dispose all nodes
store.size;                    // live nodes count
```

### Memo store (factory mode)

```js
const store = new Signal.Store(
  (id, query) => fetch(`/api/${id}?q=${query}`).then(r => r.json()),
  { maxSize: 5000, deep: true, union: true }
);

store.get(42, 'recent');       // calls factory, caches result
store.has(42, 'recent');       // check cache
store.delete(42, 'recent');    // evict one entry
store.clear();                 // evict all
store.size;                    // cached entries count
store.isMemo;                  // → true
```

---

## Triads: `$` `$$` `Δ` `ΔΔ` `ø`.

Shortcut accessors on stores. Each creates a reactive namespace with a default
capture/gating grain.

| Triad | Capture | Gating |
|-------|---------|--------|
| `$`   | shallow | consensus |
| `$$`  | deep    | consensus |
| `Δ`   | shallow  | union |
| `ΔΔ`  | deep | union |
| `ø`   | atomic  | N/A |

.is files: | `@` | atomic  | N/A |

### `store.$.count`

The `Signal` handle itself. Use `.get()` / `.set()` / `.peek()`.

### `store.$count`

Tracked read/write accessor. Calls `store.read('$count')` / `store.write('$count', v)`.

### `store.$('count')`

Untracked read. `store.$('count', v)` writes.

### `store.$({ count: 1, name: "Ada" })`

Batch write. Bare keys get the `$` prefix added automatically.

### Effect form

```js
store.$(async function* () {
  while (true) {
    const v = yield;
    console.log('deep effect:', v);
  }
});
```

---

## `ψ` chain

Fluent seeding functor. Available on stores and element handles.

```js
store.ψ('$count', 0)('$name', 'Ada')();
//        ↑ write         ↑ write     ↑ unwrap (returns store)

store.ψ({ $count: 0, $name: 'Ada' });  // batch write

store.ψ(() => console.log(count.get()), '$effect');  // named effect
//                                     ↑ parks ref at '$effect$$effect' in dict

store.ψ(() => { ... }, null, { capture: 'deep', affect: 'union' });  // effect with options
//                       ↑ explicit null key when passing options

element.ψFor(owner)  // returns a ψ chain that unwraps to the element
```

---

## `Signal.reactive(target)`

Decorates a class instance with a reactive store and proxy.

```js
class User {
  $name = 'Ada';           // reactive field (shallow)
  $$profile = { bio: '' }; // deep tracked
  ΔΔsettings = {};        // deep union-tracked

  get $fullName() {        // reactive getter
    return `${this.$name} Lovelace`;
  }
}

const user = Signal.reactive(new User());
```

Prefix conventions on class members (computeds)

| Prefix | Capture | Gating |
|--------|---------|--------|
| `$`    | shallow | consensus |
| `$$`   | deep    | consensus |
| `Δ`    | shallow | union |
| `ΔΔ`   | shallow | union |

Suffix conventions on methods: (effects)
---


## `Signal.memo(fn, options?)`

Autonomous Parameterized Memoization. Caches results in a trie keyed by arguments.

```js
const getUser = Signal.memo(
  async (id) => fetch(`/api/user/${id}`).then(r => r.json()),
  { maxSize: 10000, deep: true, union: false }
);

const user = await getUser(42);   // fetch
const same = await getUser(42);   // cache hit — no fetch
```

```js
getUser.has(42);       // → boolean (cached?)
getUser.delete(42);    // evict one
getUser.clear();       // evict all
getUser.size;          // cached count
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `maxSize` | `10000` | FIFO eviction cap |
| `deep` | `false` | Track nested access |
| `union` | `false` | Immediate propagation |
| `effect` | `false` | Treat as effect, not computed |
| `key` | `(…args) => args` | Custom cache-key function |

---

## `Signal.layer(depth, value)`

Write-time depth annotation for store values.

```js
store.write('config', Signal.layer(1, { darkMode: true }));  // shallow
store.write('data',   Signal.layer(Infinity, hugeObject));   // deep
```

---

## Low-level utilities

### `Signal.deref(ref)`

Convert a BigInt ref back to a Signal handle. Returns `undefined` if dead.

```js
const handle = Signal.deref(someBigIntRef);
if (handle) handle.get();
```

### `Signal.subscribe(consumer, source)`

Manually add a dependency edge. Both args can be handles or raw ptrs.

### `Signal.unsubscribe(consumer, source)`

Manually remove a dependency edge.

### `Signal.find(scope, key, query?)`

Look up a signal in a reactive instance's store.

```js
Signal.find(user, '$name');          // → value
Signal.find(user, '$name', 'node');  // → Signal handle
Signal.find(user, '$name', 'id');    // → ptr number
Signal.find(user, '$name()');        // → Signal handle (parens → 'node')
```

### `Signal.subtle.Watcher`

Low-level external watcher that batches notifications.

```js
const watcher = new Signal.subtle.Watcher(() => {
  console.log('something changed');
});

watcher.watch(sig1, sig2);   // track these
watcher.unwatch();           // disconnect all
```
```
