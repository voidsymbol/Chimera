
# 🧬 Chimera V2 & Substrate

### The Supercharged Reactivity Engine.
 **Chimera V2** is a zero-dependency, meta-programming framework designed for high-performance UI and data-intensive applications. It fuses the ergonomics of ES6 classes with **Substrate**, 
a low-level reactive engine that manages dependencies in a fixed-memory **Typed Array Arena**.


## ⚡ The Substrate Arena
Most reactivity libraries suffer from **Garbage Collector Thrashing** because every signal and effect is a heap-allocated object. **Substrate** solves this by moving the dependency graph into a Bipartite Arena.

* **Fixed Memory:** Allocates `Uint32Arrays` for edges and signals, bypassing the JS Heap.
* **Pointer-Based Triggers:** Traversing dependencies is a simple memory-offset jump, allowing for $O(1)$ trigger complexity.
* **Lazy Computeds:** Utilizes a `STALE` flag system to defer calculations until the exact moment of access.
* **Automatic Disposal:** Integrated with `FinalizationRegistry` and a `requestIdleCallback` poller to clean up stale objects / disconnected DOM nodes.

---

## 🏗️ Sigil Convention
Chimera uses sigils to distinguish between reactive and non-reactive intent, providing a clear visual language for the state.

| Sigil | Type | Behavior |
| :--- | :--- | :--- |
| `$foo` | **Shallow Signal** | Scalar values (strings, numbers). Triggers on `=` |
| `$$bar` | **Deep Signal** | Objects/Arrays. Triggers on mutation (`.push`, `[i]=`). |
| `$method()` | **Computed** | Lazy, memoized method. Re-runs only when arena deps change. |
| `get $baz()` | **Volatile** | Re-runs on every single read. Never memoized. |
| `static $val` | **Shared** | Static reactivity shared across all instances of a class. |

---

## 🚀 Usage

### 1. Functional Factory
Wrap existing objects or DOM elements to give them "Sovereign Reactivity."
```javascript
import { $ } from './Chimera-2.js';

const el = $(document.getElementById('counter'));
el.$count = 0; // Initialize reactive signal

el.$(() => {
    el.textContent = `Clicks: ${el.$count}`;
});
```

### 2. Reactive Classes
Extend `Chimera` to create components with internal reactive membranes.
```javascript
import { Chimera } from './Chimera-2.js';

class DataGrid extends Chimera {
    $title = "Dashboard";
    $$users = []; // Deep reactivity

    // Memoized computed method
    $activeUsers() {
        return this.$$users.filter(u => u.online);
    }
}
```

---

## 📐 Performance Math
Substrate is designed for a target logic budget of **16ms per frame**. For 60,000 particles:

$$\text{Budget per Particle} = \frac{16ms}{60,000} \approx 0.26\mu s$$

By using `Uint32Array` buffers for the edge graph, Substrate reduces the "Engine Tax" to a fraction of the budget, leaving the rest of the CPU cycles for your application logic.

---

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Substrate | Pixels</title>
    <style>
        body { margin: 0; background: #020617; color: #10b981; font-family: monospace; overflow: hidden; }
        canvas { display: block; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0; z-index: 1; }
        #stats { position: absolute; top: 1rem; left: 1rem; background: rgba(15, 23, 42, 0.9); padding: 1rem; border: 1px solid #047857; border-radius: 8px; z-index: 10; pointer-events: none; }
        .val { color: #f8fafc; font-weight: bold; }
    </style>
</head>
<body>

<div id="stats">
    <div>Effects: <span class="val" id="count">0</span> / 65535</div>
    <div>Logic Time: <span class="val" id="logic">0.00ms</span></div>
    <div>FPS: <span class="val" id="fps">0</span></div>
    <div style="margin-top:0.5rem; font-size:0.7rem; color:#6ee7b7;">16-Bit Engine + Closure Math Simulation</div>
</div>

<canvas id="view"></canvas>

<script>
// ─── 1. Substrate V4 CORE ────────────────────────────────
const ø=o=>({__proto__:null,...o});
const MAX_NODES=65535, MAX_SIGS=10, MAX_EDGES=65535;

const _pool=new Array(MAX_NODES); let _id=1,_fN=0;
const _sH=new Uint32Array(MAX_SIGS); let _sC=1;
const _eEff=new Uint16Array(MAX_EDGES), _eSig=new Uint32Array(MAX_EDGES);
const _eNS=new Uint32Array(MAX_EDGES), _ePS=new Uint32Array(MAX_EDGES), _eND=new Uint32Array(MAX_EDGES);

let _eC=1,_fE=0,_ptr=0,_aP=0;
const _stk=new Uint16Array(4096);

function _aE(){if(_fE!==0){let e=_fE;_fE=_eNS[e];return e}return _eC++}
function _aN(){return _id++}
function _track(s){if(!_aP)return;let n=_pool[_aP],e=n.hD;while(e!==0){if(_eSig[e]===s)return;e=_eND[e]}let ed=_aE();_eEff[ed]=_aP;_eSig[ed]=s;let h=_sH[s];_eNS[ed]=h;_ePS[ed]=0;if(h!==0)_ePS[h]=ed;_sH[s]=ed;_eND[ed]=n.hD;n.hD=ed}
function _clean(p){let n=_pool[p],e=n.hD;while(e!==0){let nD=_eND[e],s=_eSig[e],pr=_ePS[e],nx=_eNS[e];if(pr!==0)_eNS[pr]=nx;else _sH[s]=nx;if(nx!==0)_ePS[nx]=pr;_eNS[e]=_fE;_fE=e;e=nD}n.hD=0}
function _trigger(s){let e=_sH[s];while(e!==0){let nx=_eNS[e],p=_eEff[e]; _run(p); e=nx}}
function _run(p){let n=_pool[p];if(n.f&2)return;n.f|=2;_clean(p);_stk[_ptr++]=(_aP=p);try{n.fn()}finally{_aP=--_ptr?_stk[_ptr-1]:0;n.f&=~2}}

function makeHost(){
    return {
        signal: (val) => { let id=_sC++; return { get:()=>(_track(id),val), set:(v)=>{if(val!==v){val=v;_trigger(id)}} } },
        effect: (fn) => { let p=_aN(); _pool[p]={p,fn,f:0,hD:0}; _run(p); return p; }
    };
}

// ─── 2. RENDERING & INPUT SETUP ──────────────────────────────────────
const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d', { alpha: false });
const width = canvas.width = window.innerWidth;
const height = canvas.height = window.innerHeight;
const img = ctx.createImageData(width, height);
const data = new Uint32Array(img.data.buffer);

const offscreen = document.createElement('canvas');
offscreen.width = width; offscreen.height = height;
const offCtx = offscreen.getContext('2d');

const RAINBOW = new Uint32Array(360);
for (let i = 0; i < 360; i++) {
    const r = Math.sin(0.0174 * i + 0) * 127 + 128;
    const g = Math.sin(0.0174 * i + 2) * 127 + 128;
    const b = Math.sin(0.0174 * i + 4) * 127 + 128;
    RAINBOW[i] = (0xFF << 24) | (b << 16) | (g << 8) | r;
}

let mx = -1000, my = -1000, lastMx = 0, lastMy = 0;
window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });

// ─── 3. STATE & PARTICLES ────────────────────────────────────────────
const $ = makeHost();
const frameTrigger = $.signal(0);
const PARTICLE_COUNT = 60000;
const TRIGGER_THRESHOLD = 15000;
const TIME_TO_COLLAPSE = 180;
const RADIUS = 12000;
const blackHoles = [];
let densityTimer = 0;
let currentNearCount = 0;

for (let i = 0; i < PARTICLE_COUNT; i++) {
    let x = Math.random() * width, y = Math.random() * height;
    let vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2;
    let hue = Math.random() * 360;
    let isTrapped = false;

    $.effect(() => {
        frameTrigger.get();
        
        // 1. Black Hole Gravitational Pull
        for (let j = 0; j < blackHoles.length; j++) {
            const bh = blackHoles[j];
            let bdx = bh.x - x, bdy = bh.y - y;
            let bDistSq = bdx * bdx + bdy * bdy;
            if (bDistSq < 1500) isTrapped = true;
            if (isTrapped) {
                vx = bdy * 0.15; vy = -bdx * 0.15;
                x += (bh.x - x) * 0.05; y += (bh.y - y) * 0.05;
                hue += 10; // Rapid cycle for trapped particles
                break;
            } else {
                let bhForce = 1500 / (bDistSq + 200);
                vx += bdx * bhForce * 0.05; vy += bdy * bhForce * 0.05;
            }
        }

        if (!isTrapped) {
            // 2. Mouse Interaction
            let mdx = mx - x, mdy = my - y;
            let mDistSq = mdx * mdx + mdy * mdy;
            if (mDistSq < RADIUS) {
                currentNearCount++; 
                let force = (RADIUS - mDistSq) / RADIUS;
                vx += mdx * force * 0.007; vy += mdy * force * 0.007;
                vx *= 0.96; vy *= 0.96;
            }
            vx *= 0.998; vy *= 0.998;
            x += (vx || 1); y += (vy || 1);
            
            // 3. Normal Hue Rotation
            hue += 0.3; // This keeps them changing color even when free!

            if (x < 0) { x = 0; vx *= -0.5; } else if (x > width) { x = width; vx *= -0.5; }
            if (y < 0) { y = 0; vy *= -0.5; } else if (y > height) { y = height; vy *= -0.5; }
        } else {
            // High speed movement for singularity cores
            x += vx; y += vy;
        }

        // 4. Pixel Plotting
        let px = x | 0; let py = y | 0;
        if (px >= 0 && px < width && py >= 0 && py < height) {
            data[py * width + px] = isTrapped ? 0xFFFFFFFF : RAINBOW[hue % 360 | 0];
        }
    });
}

// ─── 4. MAIN LOOP ───────────────────────────────────────────────────
const logicDisplay = document.getElementById('logic');
const fpsDisplay = document.getElementById('fps');
let lastTime = performance.now();
let frames = 0;

function loop() {
    const start = performance.now();
    
    // Transparent clear for Ghosting/Motion Trails
    ctx.fillStyle = 'rgba(2, 6, 23, 0.15)'; 
    ctx.fillRect(0, 0, width, height);
    data.fill(0); 
    
    currentNearCount = 0;
    frameTrigger.set(start);

    // Singularity Logic
    const mDist = Math.abs(mx - lastMx) + Math.abs(my - lastMy);
    if (mDist > 5) densityTimer *= 0.9;
    lastMx = mx; lastMy = my;

    if (currentNearCount > TRIGGER_THRESHOLD) {
        densityTimer++;
        if (densityTimer > TIME_TO_COLLAPSE) {
            blackHoles.push({ x: mx, y: my });
            densityTimer = 0;
        }
    } else {
        densityTimer *= 0.95;
    }

    // Render Pipeline
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(offscreen, 0, 0);

    // Visuals: Charging Ring
    if (densityTimer > 10) {
        ctx.strokeStyle = `rgba(255, 255, 255, ${densityTimer / TIME_TO_COLLAPSE})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const r = 50 * (1 - densityTimer / TIME_TO_COLLAPSE);
        ctx.arc(mx, my, r + 5, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Visuals: Persistent Singularities
    blackHoles.forEach(bh => {
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(bh.x, bh.y, 2, 0, Math.PI * 2);
        ctx.fill();
    });

    const end = performance.now();
    
    // --- STATS LOGGING (Now working!) ---
    frames++;
    if (start > lastTime + 1000) {
        fpsDisplay.textContent = frames;
        logicDisplay.textContent = (end - start).toFixed(2) + 'ms';
        frames = 0;
        lastTime = start;
    }
    
    requestAnimationFrame(loop);
}

document.getElementById('count').textContent = _id - 1;
loop();
</script>
</body>
</html>
```
