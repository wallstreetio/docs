// Wallstreet.io docs hero - adapted from cursor/aizawa-attractor-v6.html
// Cinematic strange-attractor background. buildHero(root) returns a
// teardown fn so the loader can dispose it across instant navigation.
import * as THREE          from '../vendor/three/three.module.js';
import { EffectComposer }  from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from '../vendor/three/addons/postprocessing/OutputPass.js';
import { Line2 }           from '../vendor/three/addons/lines/Line2.js';
import { LineMaterial }    from '../vendor/three/addons/lines/LineMaterial.js';
import { LineGeometry }    from '../vendor/three/addons/lines/LineGeometry.js';

export function buildHero(root) {
  let _running = true, _raf = 0, _visible = true;
  const _cleanups = [];
  // Fat-line addons: Line2 renders each line segment as a screen-space quad
  // with antialiasing, giving us TRUE multi-pixel line widths regardless of
  // camera distance. The stock THREE.Line is hardware-rasterized at 1 device
  // pixel which makes the trails look wispy. Line2 → ribbon weight.

  // =====================================================================
  // CHAOTIC SYSTEMS — four families, each with distinct topology.
  //   Each `step` reads buf[0..2] as the current state, advances it via
  //   explicit Euler, then ring-shifts the buffer right by one vec3 and
  //   writes the new head at slot 0.
  //   `bound` re-seeds the trajectory if it ever escapes the basin of
  //   attraction (numerically unstable params, etc.) so the comet never
  //   wanders off-screen.
  // =====================================================================
  const TRAIL_LEN = 1500;    // v4: Long enough that each spline winds many
                             // times through the slow manifold of its regime,
                             // piling vertices on top of each other in the
                             // focal core. With additive blending + bloom,
                             // those overlapping vertices saturate into the
                             // bright "molten core" line that Zensical has.
  const SPLINES   = 220;     // Slight reduction from v3 (was 240) since each
                             // spline is now ~2x heavier (longer trail buffer
                             // + Line2 instanced rendering).

  function bound(buf, lim, seedScale) {
    let x = buf[0], y = buf[1], z = buf[2];
    if (!isFinite(x) || !isFinite(y) || !isFinite(z) ||
        Math.abs(x) > lim || Math.abs(y) > lim || Math.abs(z) > lim) {
      buf[0] = (Math.random() - 0.5) * seedScale;
      buf[1] = (Math.random() - 0.5) * seedScale;
      buf[2] = (Math.random() - 0.5) * seedScale;
      return true;
    }
    return false;
  }

  function shift(buf) {
    buf.copyWithin(3, 0, buf.length - 3);
  }

  // 1) AIZAWA — bowl with central spike
  function aizawaStep(buf, p, dt) {
    if (bound(buf, 5, 0.8)) return;
    const x = buf[0], y = buf[1], z = buf[2];
    const dx = dt * ((z - p.beta) * x - p.delta * y);
    const dy = dt * (p.delta * x + (z - p.beta) * y);
    const dz = dt * (p.gamma + p.alpha * z
                   - z*z*z / 3
                   - (x*x + y*y) * (1 + p.epsilon * z)
                   + p.zeta * z * x*x*x);
    shift(buf);
    buf[0] = x + dx;  buf[1] = y + dy;  buf[2] = z + dz;
  }

  // 2) LORENZ — the canonical butterfly (two-lobed)
  function lorenzStep(buf, p, dt) {
    if (bound(buf, 80, 0.4)) return;
    const x = buf[0], y = buf[1], z = buf[2];
    const dx = dt * (p.sigma * (y - x));
    const dy = dt * (x * (p.rho - z) - y);
    const dz = dt * (x * y - p.beta * z);
    shift(buf);
    buf[0] = x + dx;  buf[1] = y + dy;  buf[2] = z + dz;
  }

  // 3) HALVORSEN — three-fold rotational symmetry
  function halvorsenStep(buf, p, dt) {
    if (bound(buf, 30, 0.4)) return;
    const x = buf[0], y = buf[1], z = buf[2];
    const dx = dt * (-p.a*x - 4*y - 4*z - y*y);
    const dy = dt * (-p.a*y - 4*z - 4*x - z*z);
    const dz = dt * (-p.a*z - 4*x - 4*y - x*x);
    shift(buf);
    buf[0] = x + dx;  buf[1] = y + dy;  buf[2] = z + dz;
  }

  // 4) THOMAS — cyclically-symmetric, slow & stately
  function thomasStep(buf, p, dt) {
    if (bound(buf, 12, 1.0)) return;
    const x = buf[0], y = buf[1], z = buf[2];
    const dx = dt * (Math.sin(y) - p.b * x);
    const dy = dt * (Math.sin(z) - p.b * y);
    const dz = dt * (Math.sin(x) - p.b * z);
    shift(buf);
    buf[0] = x + dx;  buf[1] = y + dy;  buf[2] = z + dz;
  }

  // =====================================================================
  // REGIMES — each one is an "act" of the movie. The animation cycles
  // through them indefinitely, with a visible cold-start at the head of
  // each act and a smooth retract+fade-out at the tail.
  //
  // `renderScale` and `renderOffset` shrink/translate the integrator's
  // native coordinates into the camera's ±2 view box.
  // =====================================================================
  const REGIMES = [
    // v4.4: order swapped — Lorenz now leads. The butterfly silhouette is
    // the most universally-recognized chaotic attractor and reads
    // immediately even before the camera moves, so it's the strongest
    // opener for first-time viewers.
    {
      code: 'LORENZ',
      title: 'Mean reversion',
      blurb: 'Two basins, endless switching — the famous butterfly that flips between regimes without ever repeating itself.',
      step: lorenzStep,
      params: { sigma: 10, rho: 28, beta: 8/3 },
      dt: 0.0033,   // v4: vertices accumulate at each wing's focal point
      renderScale: 0.058,
      renderOffset: [0, 0, -25 * 0.058],   // centre Lorenz's z-band on origin
      seedCenter: [0.5, 0.5, 12.0],        // safely inside one wing's basin
      seedSpread: 1.6,                     // wider native-space spread → splines
                                           // enter the wing at clearly different
                                           // radii, drawing layered rings.
      speedThresh: 0.10,
      // v4.5: Lorenz bands stack tightly into the two wing-foci (sinks) and
      // accumulate brightness fast — especially during retract. Drop the
      // global line opacity and bloom mul for this regime so the silhouette
      // stays readable instead of fusing into a white teardrop.
      lineOpacityMul: 0.65,
      bloomMul: 0.65,
      greeks: [
        { glyph:'σ', role:'sigma',     val:'10.00' },
        { glyph:'ρ', role:'rayleigh',  val:'28.00' },
        { glyph:'β', role:'damping',   val:'2.667' },
        { glyph:'·', role:'basins',    val:'2' },
        { glyph:'·', role:'attractor', val:'strange' },
        { glyph:'·', role:'dim',       val:'2.06' },
      ],
      // Lorenz wings sit in the world XY-plane (after our renderScale +
      // offset). Standard y-up looks gorgeous here — the butterfly silhouette
      // reads cleanly without any axis tipping.
      cameraUp: new THREE.Vector3(0, 1, 0),
      shots: [
        { label: 'SHOT 01 — BUTTERFLY',
          pos: new THREE.Vector3(0.2, 0.3, 5.0),
          look: new THREE.Vector3(0, 0, 0),
          fov: 48, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.30 },
        { label: 'SHOT 02 — SIDE',
          pos: new THREE.Vector3(4.8, 0.6, 0.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 46, dur: 14.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.40 },
        { label: 'SHOT 03 — TOP DOWN',
          pos: new THREE.Vector3(0.4, 4.6, 0.2),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 13.0, pivot: 0, wobble: 0, chrome: 0.6, bloomScale: 0.45 },
        { label: 'SHOT 04 — SADDLE',
          // v4.2: pulled to mid distance ~3.6 from the saddle so both wings
          // are visible. Chrome 0.4 partial HUD.
          pos: new THREE.Vector3(2.4, 1.0, 3.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 45, dur: 12.0, pivot: 0, wobble: 0, chrome: 0.4, bloomScale: 0.55 },
        { label: 'SHOT 05 — TRACK',
          pos: new THREE.Vector3(1.9, 0.8, 2.6),
          look: new THREE.Vector3(0, 0, 0),
          fov: 44, dur: 9.0, pivot: 0.6, wobble: 0.5, chrome: 0.2, bloomScale: 0.70 },
        { label: 'SHOT 06 — PULL BACK',
          pos: new THREE.Vector3(2.6, 1.4, 5.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.20 },
      ],
    },
    {
      code: 'AIZAWA',
      title: 'Momentum',
      blurb: 'A bounded swarm with a single spike — the canonical signature of momentum-driven order flow.',
      step: aizawaStep,
      params: { alpha:0.95, beta:0.70, gamma:0.60, delta:3.50, epsilon:0.25, zeta:0.10 },
      dt: 0.0055,    // v4: smaller dt → more vertices land in the slow saddle
                     // region near the central spike, densifying the focal
                     // core into a bright vertical beam.
      renderScale: 1.0,
      // v4.4: RADIAL PINCH (replaces v4.3 anisotropic axis stretch).
      // Honest answer to "how do we make the center tight while the bowl
      // stays large": you can't do it from a parameter tweak — the Aizawa
      // equations have a fixed bowl/spike radius ratio. ANY uniform or
      // per-axis scaling stretches BOTH together. The only way to break
      // that ratio is a non-linear radial warp at render time.
      //
      // We integrate the dynamics truthfully (preserves topology), then
      // warp the rendered radius in the plane perpendicular to the spike
      // (z) axis using a piecewise power law:
      //   r' = pivot * (r / pivot)^innerExp  when r < pivot   (contracts toward axis)
      //   r' = pivot * (r / pivot)^outerExp  when r ≥ pivot   (expands outward)
      //
      // Worked example with these settings:
      //   r=0.05 (spike)  →  0.55 * (0.091)^2.4   ≈ 0.0014   (~35× tighter)
      //   r=0.55 (pivot)  →  unchanged
      //   r=1.00 (bowl)   →  0.55 * (1.82)^1.55   ≈ 1.36     (~1.4× larger)
      radialPinch: {
        axis: 2,           // spike axis (z) — pinch is in the (x,y) plane
        pivot: 0.55,       // anchor radius: contracts below, expands above
        innerExp: 2.8,     // v4.5: 2.4 → 2.8. Tighter spike: r=0.05 now warps
                           // to ~0.0007 (was 0.0014), so the central column
                           // reads as a hair-thin coiled string.
        outerExp: 1.55,    // >1 = outer expansion (puffs the bowl outward)
      },
      renderOffset: [0, 0, 0],
      seedCenter: [0.10, 0.00, 0.00],   // tiny offset; aizawa is fine near origin
      seedSpread: 0.55,                 // fan splines across the bowl interior
                                        // so trajectories trace visibly distinct
                                        // satin bands rather than one fat ribbon
      speedThresh: 0.022,    // for tick-particle emission
      greeks: [
        { glyph:'α', role:'drift',       val:'0.95' },
        { glyph:'β', role:'sensitivity', val:'0.70' },
        { glyph:'γ', role:'convexity',   val:'0.60' },
        { glyph:'δ', role:'rate',        val:'3.50' },
        { glyph:'ε', role:'shock',       val:'0.25' },
        { glyph:'ζ', role:'vol of vol',  val:'0.10' },
      ],
      // Aizawa's iconic axis is z (the central spike runs along it). We tip
      // the camera so screen-up = world-z, putting the spike vertical and
      // the bowl rim across the top of the frame — Zensical's "vortex above
      // / spike descending" composition.
      cameraUp: new THREE.Vector3(0, 0, 1),
      shots: [
        // v4.3: cameras pulled back to fit the now 1.4×-wider bowl in frame.
        // Bloom remains at v4.2 levels (drastically reduced from v4.1).
        { label: 'SHOT 01 — VORTEX SIDE',
          pos: new THREE.Vector3(5.6, 0.3, 0.0),
          look: new THREE.Vector3(0, 0, 0.2),
          fov: 50, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.30 },
        { label: 'SHOT 02 — ORBIT BACK',
          pos: new THREE.Vector3(-5.0, 0.8, 1.2),
          look: new THREE.Vector3(0, 0, 0.2),
          fov: 46, dur: 14.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.40 },
        { label: 'SHOT 03 — CRANE',
          pos: new THREE.Vector3(3.0, 3.4, 2.0),
          look: new THREE.Vector3(0, 0, 0.0),
          fov: 50, dur: 13.0, pivot: 0, wobble: 0, chrome: 0.6, bloomScale: 0.50 },
        { label: 'SHOT 04 — VORTEX',
          // v4.3: pulled further back to accommodate the wider bowl.
          pos: new THREE.Vector3(4.2, 2.0, 2.4),
          look: new THREE.Vector3(0, 0, 0.4),
          fov: 44, dur: 12.0, pivot: 0, wobble: 0, chrome: 0.4, bloomScale: 0.55 },
        { label: 'SHOT 05 — TRACK',
          pos: new THREE.Vector3(3.0, 1.0, 2.2),
          look: new THREE.Vector3(0, 0, 0.0),
          fov: 44, dur: 9.0, pivot: 0.6, wobble: 0.5, chrome: 0.2, bloomScale: 0.70 },
        { label: 'SHOT 06 — PULL BACK',
          // PULL BACK was already far enough at distance 7.2 — the wider
          // bowl now occupies 67% of frame width (was 50%) which is
          // exactly the "more impressive scale" you asked for.
          pos: new THREE.Vector3(4.4, 1.0, 5.6),
          look: new THREE.Vector3(0, 0, 0.2),
          fov: 50, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.18 },
      ],
    },
    {
      code: 'HALVORSEN',
      title: 'Volatility expansion',
      blurb: 'Three-fold rotational symmetry. A market discovering its own resonance modes, one cycle at a time.',
      step: halvorsenStep,
      params: { a: 1.4 },
      dt: 0.0023,   // v4: tighter coil at each of the three lobe foci
      renderScale: 0.16,
      renderOffset: [0, 0, 0],
      seedCenter: [-3.0, 0.5, 0.5],        // near the canonical Halvorsen seed
      seedSpread: 1.5,                     // splines fan into each of the three
                                           // symmetry lobes from different angles.
      speedThresh: 0.10,
      greeks: [
        { glyph:'a', role:'damping',   val:'1.40' },
        { glyph:'·', role:'symmetry',  val:'C₃' },
        { glyph:'·', role:'lyapunov',  val:'+0.78' },
        { glyph:'·', role:'modes',     val:'3' },
        { glyph:'·', role:'attractor', val:'strange' },
        { glyph:'·', role:'dim',       val:'2.30' },
      ],
      cameraUp: new THREE.Vector3(0, 1, 0),
      shots: [
        // Halvorsen's three-fold symmetry reads best from above; we lead
        // with the top-down star pose to make the C₃ symmetry obvious.
        { label: 'SHOT 01 — STAR',
          pos: new THREE.Vector3(0.4, 4.4, 0.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 48, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.32 },
        { label: 'SHOT 02 — SIDE',
          pos: new THREE.Vector3(-4.2, 0.8, 0.6),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 14.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.42 },
        { label: 'SHOT 03 — 3/4 ABOVE',
          pos: new THREE.Vector3(2.6, 2.6, 2.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 13.0, pivot: 0, wobble: 0, chrome: 0.6, bloomScale: 0.50 },
        { label: 'SHOT 04 — LOBE',
          // v4.2: mid-distance feature shot of one lobe.
          pos: new THREE.Vector3(3.2, 1.6, 2.6),
          look: new THREE.Vector3(0.4, 0, 0),
          fov: 44, dur: 12.0, pivot: 0, wobble: 0, chrome: 0.4, bloomScale: 0.55 },
        { label: 'SHOT 05 — TRACK',
          pos: new THREE.Vector3(2.2, 1.2, 2.2),
          look: new THREE.Vector3(0, 0, 0),
          fov: 44, dur: 9.0, pivot: 0.6, wobble: 0.5, chrome: 0.2, bloomScale: 0.70 },
        { label: 'SHOT 06 — PULL BACK',
          pos: new THREE.Vector3(3.4, 1.8, 5.2),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.22 },
      ],
    },
    {
      code: 'THOMAS',
      title: 'Equilibrium',
      blurb: 'Slow, cyclically-symmetric flow — the long-memory regime where price seems to drift without ever settling.',
      step: thomasStep,
      params: { b: 0.208 },
      dt: 0.018,                            // v4: Thomas was the outlier — its
                                            // natural time scale is slow so it
                                            // already needed a beefy dt. Now
                                            // we cut it ~2.7x to densify the
                                            // lattice intersections.
      renderScale: 0.62,                    // larger overall — Thomas's structure
                                            // is delicate, so we let it occupy
                                            // more of the frame on PULL-BACK.
      renderOffset: [0, 0, 0],
      seedCenter: [1.5, -0.8, 0.4],         // off the x=y=z symmetry diagonal
      seedSpread: 1.6,                      // big spread → multiple distinct
                                            // orbital cells, each tracing its own
                                            // loop through the lattice.
      speedThresh: 0.025,
      greeks: [
        { glyph:'b', role:'dissipation', val:'0.208' },
        { glyph:'·', role:'symmetry',    val:'cyclic' },
        { glyph:'·', role:'memory',      val:'long' },
        { glyph:'·', role:'phase',       val:'3D' },
        { glyph:'·', role:'attractor',   val:'strange' },
        { glyph:'·', role:'dim',         val:'≈ 1.7' },
      ],
      cameraUp: new THREE.Vector3(0, 1, 0),
      shots: [
        // Thomas reads as a delicate 3D lattice. We open with a 3/4 hero
        // shot so the depth of the cells is immediately legible.
        { label: 'SHOT 01 — LATTICE',
          pos: new THREE.Vector3(3.0, 2.2, 3.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.32 },
        { label: 'SHOT 02 — SIDE',
          pos: new THREE.Vector3(-4.4, 0.6, 1.2),
          look: new THREE.Vector3(0, 0, 0),
          fov: 48, dur: 14.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.42 },
        { label: 'SHOT 03 — TOP DOWN',
          pos: new THREE.Vector3(0.4, 5.0, 0.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 52, dur: 13.0, pivot: 0, wobble: 0, chrome: 0.6, bloomScale: 0.45 },
        { label: 'SHOT 04 — CELL',
          // v4.2: mid-distance feature shot.
          pos: new THREE.Vector3(2.8, 1.4, 3.0),
          look: new THREE.Vector3(0, 0, 0),
          fov: 46, dur: 12.0, pivot: 0, wobble: 0, chrome: 0.4, bloomScale: 0.55 },
        { label: 'SHOT 05 — TRACK',
          pos: new THREE.Vector3(2.0, 1.0, 2.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 44, dur: 9.0, pivot: 0.6, wobble: 0.5, chrome: 0.2, bloomScale: 0.70 },
        { label: 'SHOT 06 — PULL BACK',
          pos: new THREE.Vector3(4.0, 1.8, 5.4),
          look: new THREE.Vector3(0, 0, 0),
          fov: 50, dur: 16.0, pivot: 0, wobble: 0, chrome: 1.0, bloomScale: 0.22 },
      ],
    },
  ];
  let regimeIdx = 0;
  let activeRegime = REGIMES[regimeIdx];

  // Regime lifecycle, in seconds:
  //   COLD_START → trails grow from a tight seed cluster (drawCount 0 → full)
  //   STABLE     → full draw, full opacity
  //   RETRACT    → trails shrink back into the comet (drawCount → 0)
  //   REGIME_DURATION matches the total camera-shot cycle (sum of dur fields
  //   in SHOTS) so that every regime starts on SHOT 01 — WIDE.
  const REGIME_COLD_START = 7.0;
  const REGIME_RETRACT    = 6.0;
  const REGIME_DURATION   = 80.0;   // total length of one regime act
  let regimeT = 0;

  // 0..1 multiplier applied to every spline material's opacity each frame
  let opacityMul = 0;
  // 0..TRAIL_LEN — how much of each spline to actually render this frame
  // drawCount is now per-spline (`s.startDelay` controls when each one starts
  // growing). See the integration loop in `tick()` for the staggered-emergence
  // implementation.

  // =====================================================================
  // SCENE  (root is passed in by the loader)
  // =====================================================================
  const scene     = new THREE.Scene();
  scene.fog       = new THREE.FogExp2(0x0a0c0e, 0.085);

  const camera    = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 200);
  camera.position.set(3.5, 2.0, 6.0);

  const renderer  = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // v4.4: ACES filmic tone mapping — the cinematic fix for the "white blob"
  // problem. With 220 splines additively blending, any pixel where many
  // trails overlap accumulates RGB >> 1.0. Without tone mapping that just
  // channel-clips to white. ACES compresses HDR luminance back into [0,1]
  // *while preserving hue*, so dense green stacks stay green at high
  // brightness instead of blowing out. OutputPass (in the composer below)
  // honors this setting automatically.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  root.appendChild(renderer.domElement);

  // =====================================================================
  // POST-PROCESSING — UnrealBloomPass gives the spiral cores their
  // photographic "hot bleeding into the dark" glow. Bright pixels (above
  // `threshold`) get blurred and added back to the frame, so wherever many
  // trails overlap (the natural attractor sinks) we get a luminous halo
  // that no amount of additive line-blending alone can produce.
  //   strength controls overall bloom intensity, radius widens the bleed
  //   footprint, threshold gates which pixels are considered "bright".
  // =====================================================================
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(devicePixelRatio, 2));
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    0.14,   // strength — v4.4: dialed down further. Tone mapping (above) now
            //             handles HDR roll-off, so bloom only needs to add
            //             a *gentle* halo to the brightest peaks, not carry
            //             the cinematic weight on its own.
    0.16,   // radius   — keep TIGHT so bands don't merge.
    1.05,   // threshold — v4.4: bumped above 1.0. With ACES, only true HDR
            //             peaks (R/G/B > 1.0) bloom — individual ribbons no
            //             longer trigger it, only dense overlap stacks do.
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // =====================================================================
  // LAYER 2 — perspective FLOOR GRID, fading into the fog (Bloomberg vibe).
  //   Three stacked grids, each at slightly different scale & opacity, give
  //   the floor a pronounced "near = bright, far = vapor" horizon line that
  //   you can actually read from the cinematic camera distances. We also use
  //   additive blending so the lines glow against the black background.
  // =====================================================================
  function makeFloorGrid(size, divisions, colorCenter, colorMinor, opacity) {
    const g = new THREE.GridHelper(size, divisions, colorCenter, colorMinor);
    g.material.transparent = true;
    g.material.opacity = opacity;
    g.material.blending = THREE.AdditiveBlending;
    g.material.depthWrite = false;
    g.material.fog = true;
    g.material.userData.baseOpacity = opacity;     // for chrome-fade lerps
    return g;
  }
  // Major lines every ~5 world-units — gives the strong horizon read.
  const gridMajor = makeFloorGrid(
    120, 24,
    new THREE.Color(0x8fffc6),
    new THREE.Color(0x05bc84),
    0.55,
  );
  gridMajor.position.y = -2.6;
  scene.add(gridMajor);

  // Minor lines every 1 world-unit — fills in the texture between majors.
  const gridMinor = makeFloorGrid(
    120, 120,
    new THREE.Color(0x42ff9f),
    new THREE.Color(0x04ad71),
    0.22,
  );
  gridMinor.position.y = -2.59;   // a hair above the major to avoid z-fighting
  scene.add(gridMinor);

  // Ceiling grid (mirrored) — gives a sense of an enclosing space and
  // makes the cinematic CRANE-UP shot feel like it's actually in a "room".
  const gridCeil = makeFloorGrid(
    120, 24,
    new THREE.Color(0x05bc84),
    new THREE.Color(0x019754),
    0.18,
  );
  gridCeil.position.y = 4.6;
  scene.add(gridCeil);

  // =====================================================================
  // LAYER 3 — atmospheric DATA MOTES drifting through the air.
  // =====================================================================
  const moteCount = 280;
  const moteGeom = new THREE.BufferGeometry();
  const motePos = new Float32Array(moteCount * 3);
  const moteVel = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i*3+0] = (Math.random() - 0.5) * 14;
    motePos[i*3+1] = (Math.random() - 0.5) * 7;
    motePos[i*3+2] = -1 - Math.random() * 6;
    moteVel[i*3+0] = (Math.random() - 0.5) * 0.0009;
    moteVel[i*3+1] = (Math.random()) * 0.0006;     // slight upward drift
    moteVel[i*3+2] = (Math.random() - 0.5) * 0.0007;
  }
  moteGeom.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0x5cffac,
    size: 0.018,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  const motes = new THREE.Points(moteGeom, moteMat);
  scene.add(motes);

  // =====================================================================
  // LAYER 4 — HERO ATTRACTOR (the comet & its luminous wake)
  //   All splines + comet head live inside `heroGroup` so we can rescale &
  //   reposition the whole specimen in a single op when the regime swaps.
  // =====================================================================
  // Trail-age color gradient — vertex 0 is the comet head (newest position),
  // vertex TRAIL_LEN-1 is the tail (oldest). Mapping age to colour along the
  // line gives every spline a clean white-hot core with a fading WSIO-green
  // wake — the "comet streak" look that reads as a single trajectory rather
  // than a stack of independently-coloured ribbons. Stops are picked so that
  // the brightness packs into the last ~15% of the trail (right behind the
  // head) and the rest fades smoothly through accent green into deep dark.
  //   Because each spline's geometry uses additive blending, dense regions
  // of phase space (where many splines coexist) accumulate brightness
  // naturally — that's how the spiral cores light up.
  // TWO gradients so we can give each spline its own personality:
  //   WHITE — head bleaches all the way to pure white. Bloom will catch it
  //           hard and it becomes a "hero" filament.
  //   GREEN — head peaks at saturated WSIO green. Bloom barely touches it
  //           (below the brightness threshold) so it stays green + crisp.
  // Per-spline `whiteness` then lerps between the two gradients vertex-by-
  // vertex, giving Zensical's "molten core surrounded by amber filaments"
  // look (translated to white-core + green filaments for WSIO).
  // Three palettes, mixed per-spline:
  //   GREEN  — the dominant WSIO mark; saturated head, no bleach.
  //   WHITE  — hero filaments. Head bleaches to pure white so bloom catches
  //            it hard and the spline becomes a "molten core" line.
  //   AMBER  — depth filaments. Warm gold/amber heads fading to bronze. The
  //            warm/cool play against the WSIO green reads as luxe (think
  //            campfire sparks against forest canopy). This is also closer
  //            to what Zensical do — their ramp is amber-on-rust, not
  //            cyan-on-cool.
  const TRAIL_GRADIENT_WHITE = [
    { t: 0.000, c: [1.00, 1.00, 1.00] },   // pure white core (head)
    { t: 0.020, c: [0.90, 1.00, 0.94] },   // soft mint flash
    { t: 0.060, c: [0.40, 1.00, 0.72] },   // bright WSIO green
    { t: 0.350, c: [0.22, 0.95, 0.62] },   // saturated mid green — held LONG
    { t: 0.780, c: [0.12, 0.65, 0.42] },   // body — still clearly visible
    { t: 1.000, c: [0.008, 0.05, 0.03] },  // tail — finally fades to black
  ];
  const TRAIL_GRADIENT_GREEN = [
    { t: 0.000, c: [0.45, 1.00, 0.78] },   // bright green head (NO white)
    { t: 0.020, c: [0.42, 1.00, 0.76] },   // saturated green flash
    { t: 0.060, c: [0.36, 0.98, 0.70] },   // matches body shoulder
    { t: 0.350, c: [0.22, 0.95, 0.62] },   // identical mid green
    { t: 0.780, c: [0.12, 0.65, 0.42] },   // identical body
    { t: 1.000, c: [0.008, 0.05, 0.03] },  // identical tail
  ];
  const TRAIL_GRADIENT_AMBER = [
    { t: 0.000, c: [1.00, 0.96, 0.82] },   // pale cream-gold head
    { t: 0.020, c: [1.00, 0.86, 0.48] },   // honey flash
    { t: 0.060, c: [1.00, 0.72, 0.20] },   // bright amber
    { t: 0.350, c: [0.95, 0.54, 0.10] },   // saturated amber-orange body
    { t: 0.780, c: [0.50, 0.24, 0.05] },   // deep bronze
    { t: 1.000, c: [0.04, 0.018, 0.004] }, // tail — fades to dark brown
  ];
  function _sample(grad, t, out) {
    for (let i = 0; i < grad.length - 1; i++) {
      const a = grad[i], b = grad[i + 1];
      if (t <= b.t) {
        const u = (t - a.t) / (b.t - a.t);
        out[0] = a.c[0] + (b.c[0] - a.c[0]) * u;
        out[1] = a.c[1] + (b.c[1] - a.c[1]) * u;
        out[2] = a.c[2] + (b.c[2] - a.c[2]) * u;
        return;
      }
    }
    const last = grad[grad.length - 1].c;
    out[0] = last[0]; out[1] = last[1]; out[2] = last[2];
  }

  // Each spline picks ONE primary palette at construction time. Most splines
  // stay green so the WSIO identity reads strongly; the remaining splits
  // between hero white-hot and warm amber. Note: when GREEN + AMBER additively
  // blend in the focal core, the result is a creamy gold — that's intentional;
  // the warm-on-warm stack reads as "the comet's heat trail" rather than the
  // muddy brown you'd get if these were less saturated.
  //   65% → GREEN   (background body)
  //    5% → WHITE   (hero filaments — bloom catches these)
  //   22% → AMBER   (warm depth filaments — gold/bronze spots in the swarm)
  //    8% → MIX     (a green spline tinted slightly toward amber)
  function pickGradient() {
    const r = Math.random();
    if (r < 0.65) return TRAIL_GRADIENT_GREEN;
    if (r < 0.70) return TRAIL_GRADIENT_WHITE;
    if (r < 0.92) return TRAIL_GRADIENT_AMBER;
    return null;
  }
  const _aRGB = [0, 0, 0], _bRGB = [0, 0, 0];
  function trailColorAt(t, out, palette) {
    if (palette === null) {
      // 50/50 GREEN + AMBER blend → a chartreuse / olive transitional
      // spline. Sits visually between the green body and the warm amber
      // accents so the colour transition isn't a hard boundary.
      _sample(TRAIL_GRADIENT_GREEN, t, _aRGB);
      _sample(TRAIL_GRADIENT_AMBER, t, _bRGB);
      out[0] = (_aRGB[0] + _bRGB[0]) * 0.5;
      out[1] = (_aRGB[1] + _bRGB[1]) * 0.5;
      out[2] = (_aRGB[2] + _bRGB[2]) * 0.5;
    } else {
      _sample(palette, t, out);
    }
  }

  const heroGroup = new THREE.Group();
  scene.add(heroGroup);

  const splines = [];
  const _tmpRGB  = [0, 0, 0];
  const _tmpRGB2 = [0, 0, 0];
  const _viewport = new THREE.Vector2(innerWidth, innerHeight);

  // =====================================================================
  // Spline construction (v4 — Line2)
  //
  // Each spline is now a `Line2` with `LineGeometry`, which under the hood
  // is an InstancedBufferGeometry where every line segment is one instance
  // rendered as a screen-space quad. This lets us pick a true line width
  // in pixels (`linewidth: 2.6`), unlike `THREE.Line` which is locked to
  // 1 device pixel.
  //
  // To avoid GC pressure, after the first `setPositions(...)` call we grab
  // a reference to the underlying interleaved buffer (`instanceBuffer`)
  // and update it IN PLACE every frame: `copyWithin` to ring-shift, then
  // write the new head segment at slot 0. No allocations in the hot path.
  // =====================================================================
  const SEG_COUNT  = TRAIL_LEN - 1;       // segments per spline
  const SEG_FLOATS = SEG_COUNT * 6;       // each segment = 6 floats (start xyz + end xyz)

  for (let s = 0; s < SPLINES; s++) {
    const buf = new Float32Array(TRAIL_LEN * 3);

    // Per-spline personality. `palette` picks one of the three trail-colour
    // ramps (GREEN / WHITE / TEAL / null=mix). `lum` is an overall brightness
    // scale so dim/mid/bright filaments coexist in the swarm.
    // v4.2: lum ceiling dropped 1.10 → 0.92 so even the brightest splines
    // don't oversaturate. Combined with 220 splines additively blending,
    // the old 1.10 was pushing wide-shot focal cores into white blobs.
    const palette   = pickGradient();
    const lum       = 0.45 + Math.random() * 0.47;   // [0.45 .. 0.92]

    // Cold-start seed: tiny cluster near origin (regime transform places it).
    const initPos = new Float32Array(TRAIL_LEN * 3);
    for (let i = 0; i < TRAIL_LEN; i++) {
      const px = (Math.random() - 0.5) * 0.05;
      const py = (Math.random() - 0.5) * 0.05;
      const pz = (Math.random() - 0.5) * 0.05;
      buf[i*3+0]    = px; buf[i*3+1]    = py; buf[i*3+2]    = pz;
      initPos[i*3+0] = px; initPos[i*3+1] = py; initPos[i*3+2] = pz;
    }

    // Per-vertex colour ramp. LineGeometry expects N point colours and
    // packs them internally into (N-1) start/end pairs. Static — we never
    // touch the colour buffer after this.
    const initCol = new Float32Array(TRAIL_LEN * 3);
    for (let i = 0; i < TRAIL_LEN; i++) {
      trailColorAt(i / (TRAIL_LEN - 1), _tmpRGB, palette);
      initCol[i*3+0] = Math.min(1.0, _tmpRGB[0] * lum);
      initCol[i*3+1] = Math.min(1.0, _tmpRGB[1] * lum);
      initCol[i*3+2] = Math.min(1.0, _tmpRGB[2] * lum);
    }

    const geom = new LineGeometry();
    geom.setPositions(initPos);
    geom.setColors(initCol);

    // Grab the interleaved buffer for in-place updates. Both instanceStart
    // and instanceEnd share this buffer (different stride offsets), so we
    // only need one needsUpdate flag.
    const instanceBuffer = geom.attributes.instanceStart.data;
    const lineSegArr     = instanceBuffer.array;       // (N-1) * 6 floats

    const baseOpacity = 0.55 + (Math.random() - 0.5) * 0.08;
    const mat = new LineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 1.8,             // pixels — Zensical-weight ribbons
      worldUnits: false,           // pixel widths (not world units)
      alphaToCoverage: false,
    });
    mat.resolution.copy(_viewport);
    mat.userData.baseOpacity = baseOpacity;

    const lineMesh = new Line2(geom, mat);
    lineMesh.frustumCulled = false;
    lineMesh.computeLineDistances();
    // Start with zero instances rendered — let it emerge during cold-start.
    geom.instanceCount = 0;
    heroGroup.add(lineMesh);

    splines.push({ buf, geom, mat, lineSegArr, instanceBuffer });
  }

  // =====================================================================
  // RADIAL PINCH — render-time only spatial warp.
  // The integrator writes truthful Aizawa coordinates into s.buf. Before
  // we hand the new vertex to Line2's GPU buffer, we warp the radius in
  // the plane perpendicular to the regime's spike axis. The integrator
  // state is never touched, so dynamics (stability, attractor topology,
  // param sensitivities) are 100% preserved — only the *visualization*
  // is stylized.
  //
  // Output is written into the destination float array starting at
  // `dstIdx` so we can call this on the lineSegArr's start/end slots
  // directly without a temporary allocation.
  // =====================================================================
  function applyRadialPinch(p, x, y, z, dst, dstIdx) {
    if (!p) {
      dst[dstIdx]     = x;
      dst[dstIdx + 1] = y;
      dst[dstIdx + 2] = z;
      return;
    }
    // Identify the (a, b) pair that defines the perpendicular plane and
    // the (c) value that runs along the spike axis. We warp (a, b) and
    // pass c straight through.
    let a, b, c, ax = p.axis;
    if      (ax === 0) { a = y; b = z; c = x; }
    else if (ax === 1) { a = x; b = z; c = y; }
    else               { a = x; b = y; c = z; }

    const r = Math.sqrt(a * a + b * b);
    if (r < 1e-6) {
      dst[dstIdx]     = x;
      dst[dstIdx + 1] = y;
      dst[dstIdx + 2] = z;
      return;
    }
    const piv = p.pivot;
    const exp = (r < piv) ? p.innerExp : p.outerExp;
    // r' = pivot * (r/pivot)^exp,  k = r'/r  (multiplicative scale on a,b)
    const k = piv * Math.pow(r / piv, exp) / r;
    a *= k; b *= k;

    if (ax === 0)      { dst[dstIdx] = c; dst[dstIdx + 1] = a; dst[dstIdx + 2] = b; }
    else if (ax === 1) { dst[dstIdx] = a; dst[dstIdx + 1] = c; dst[dstIdx + 2] = b; }
    else               { dst[dstIdx] = a; dst[dstIdx + 1] = b; dst[dstIdx + 2] = c; }
  }

  // Apply a regime's render transform to the whole hero group, and rebuild
  // every spline's seed cluster so the next cold-start emerges from origin.
  function applyRegimeTransform(reg) {
    heroGroup.scale.set(reg.renderScale, reg.renderScale, reg.renderScale);
    heroGroup.position.set(reg.renderOffset[0], reg.renderOffset[1], reg.renderOffset[2]);
  }
  // Max stagger window (in seconds) — late starters begin tracing this many
  // seconds after the cold-start clock starts, so the swarm grows in waves
  // rather than as a single synchronized march.
  const STAGGER_MAX = 4.2;     // [0 .. 4.2s] of the 7s cold-start

  function reseedSplines(reg) {
    const [cx, cy, cz] = reg.seedCenter;
    const r = reg.seedSpread;
    const pinch = reg.radialPinch || null;
    // Pre-warp the seed point once for use in the lineSegArr (we need the
    // visual seed to land in the warped space so delayed splines don't
    // visibly jump on first integration step).
    const warpedSeed = new Float32Array(3);
    for (let i = 0; i < splines.length; i++) {
      const s = splines[i];
      // Each spline gets its own slightly-perturbed seed near the regime's
      // canonical starting point.
      const x0 = cx + (Math.random() - 0.5) * r;
      const y0 = cy + (Math.random() - 0.5) * r;
      const z0 = cz + (Math.random() - 0.5) * r;
      // Integrator state stays in unwarped/native coordinates.
      for (let j = 0; j < TRAIL_LEN; j++) {
        s.buf[j*3+0] = x0; s.buf[j*3+1] = y0; s.buf[j*3+2] = z0;
      }
      // Compute the warped seed for the visual buffer.
      applyRadialPinch(pinch, x0, y0, z0, warpedSeed, 0);
      const wx = warpedSeed[0], wy = warpedSeed[1], wz = warpedSeed[2];
      // Reset the interleaved segment buffer to all-collapsed-at-seed so the
      // moment a delayed spline unfreezes, every slot in its segment buffer
      // already points at the seed (no stale geometry leaks through).
      for (let j = 0; j < SEG_COUNT; j++) {
        s.lineSegArr[j*6+0] = wx; s.lineSegArr[j*6+1] = wy; s.lineSegArr[j*6+2] = wz;
        s.lineSegArr[j*6+3] = wx; s.lineSegArr[j*6+4] = wy; s.lineSegArr[j*6+5] = wz;
      }
      s.instanceBuffer.needsUpdate = true;
      // Hero spline (#0) starts immediately — camera, comet head, and tick
      // emission all key off splines[0]. Others get randomized delays.
      s.startDelay = (i === 0) ? 0 : Math.random() * STAGGER_MAX;
      s.geom.instanceCount = 0;        // nothing visible until first integration
    }
  }
  applyRegimeTransform(activeRegime);
  // Apply the first regime's preferred camera up-vector so even the very
  // first frame already has the spike vertical for Aizawa.
  if (activeRegime.cameraUp) camera.up.copy(activeRegime.cameraUp);
  // Seed the very first regime so REGIME 01 cold-starts from its canonical
  // entry point — splines are constructed with a placeholder cluster.
  reseedSplines(activeRegime);

  // Hero comet head (radial-gradient sprite, generated at runtime)
  function sparkTexture() {
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(143,255,198,0.95)');
    g.addColorStop(0.45, 'rgba(66,255,159,0.40)');
    g.addColorStop(0.78, 'rgba(5,188,132,0.10)');
    g.addColorStop(1.00, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const sparkTex = sparkTexture();
  const sparkMat = new THREE.SpriteMaterial({
    map: sparkTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
  });
  sparkMat.userData.baseOpacity = 1.0;
  const spark = new THREE.Sprite(sparkMat);
  spark.scale.set(0.55, 0.55, 1);
  heroGroup.add(spark);

  const coreMat = new THREE.SpriteMaterial({
    map: sparkTex, color: 0xeaffe9,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
  });
  coreMat.userData.baseOpacity = 1.0;
  const core = new THREE.Sprite(coreMat);
  core.scale.set(0.18, 0.18, 1);
  heroGroup.add(core);

  // =====================================================================
  // LAYER 5 — TICK PARTICLES (price-action sparks emitted from the comet)
  //   Tiny short-lived sprites that drift up & fade. Visualizes the comet
  //   "reacting" as it accelerates through the spike of the attractor.
  // =====================================================================
  const TICK_POOL = 80;
  const tickPool = [];
  for (let i = 0; i < TICK_POOL; i++) {
    const m = new THREE.SpriteMaterial({
      map: sparkTex,
      color: 0x8fffc6,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(0.08, 0.08, 1);
    s.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
    scene.add(s);
    tickPool.push(s);
  }
  function emitTick(x, y, z, energy) {
    const t = tickPool.find(p => p.userData.life <= 0);
    if (!t) return;
    t.position.set(x, y, z);
    t.userData.life = 1.0;
    t.userData.vx = (Math.random() - 0.5) * 0.012;
    t.userData.vy = 0.005 + Math.random() * 0.012;
    t.userData.vz = (Math.random() - 0.5) * 0.012;
    t.material.opacity = Math.min(1.0, 0.4 + energy);
    t.scale.setScalar(0.06 + Math.random() * 0.06);
  }

  // =====================================================================
  // CAMERA DIRECTION SYSTEM — scripted shots, eased crossfades, looping.
  //   No user controls. The page can scroll freely.
  // =====================================================================
  // Each shot is structured as:
  //   [ HOLD at cur position ............... | smooth move to next ]
  //   |---- dur * HOLD_FRACTION (~75%) ----- |--- 1-HOLD_FRACTION ---|
  // HOLD_FRACTION is bumped to 0.75 so 3/4 of every shot is rock-still.
  // Each shot also carries `pivot` (0=locked-to-world, 1=follow-comet) and
  // `wobble` (handheld breathing amplitude). The cycle is choreographed
  // so MOST poses are far back & locked — long, contemplative gazes that
  // let the comet wander through frame on its own — punctuated by ONE
  // proper follow shot. The user reads the attractor's shape; the comet
  // performs.
  const HOLD_FRACTION = 0.75;
  // Brand text shared across regimes — each shot index has the same headline
  // and blurb regardless of which attractor is on stage. The camera params
  // (pos/look/fov/up/etc.) live PER-REGIME inside `REGIMES[i].shots[idx]`.
  // Helper so the rest of the code can read a "current shot" with all camera
  // fields. Always reads from the active regime. (v6: brand/copy stripped —
  // the hero copy is now static HTML, not driven per-shot.)
  function shotAt(idx) {
    const cam = activeRegime.shots[idx];
    return {
      pos:    cam.pos,
      look:   cam.look,
      fov:    cam.fov,
      dur:    cam.dur,
      pivot:  cam.pivot,
      wobble: cam.wobble,
      chrome: cam.chrome ?? 1.0,
      bloomScale: cam.bloomScale ?? 1.0,
    };
  }
  let shotIdx = 0;
  let shotT = 0;     // elapsed seconds in current shot
  const tmpVec = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();

  function easeInOut(t) {        // smooth cosine (gentle)
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }
  function smoothEase(t) {       // Perlin's smootherstep: zero 1st & 2nd derivative
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // =====================================================================
  // CAMERA PIVOT & WOBBLE — each shot declares two weights:
  //   pivot  0..1   how much the camera follows the comet
  //                   0 = LOCKED. `pos`/`look` are absolute world coords.
  //                       The camera is rock-still; the comet wanders
  //                       through the frame as it explores phase space.
  //                       This is the "stand back and watch the dance"
  //                       behaviour — gives the viewer time to read the
  //                       structure of the attractor instead of being
  //                       glued to a moving subject.
  //                   1 = FOLLOW. `pos`/`look` are offsets relative to a
  //                       smoothed comet target — the camera glides in
  //                       lockstep with the dot.
  //   wobble 0..1   handheld breathing-amplitude multiplier; 0 = totally
  //                 still, 1 = subtle stabilizer feel. Locked shots want 0.
  // Most shots are LOCKED so the rhythm is dance-like: long, still gazes
  // from outside the structure, broken up by the occasional follow move.
  // =====================================================================
  const cometTarget = new THREE.Vector3();
  const cometVec    = new THREE.Vector3();

  // =====================================================================
  // CHROME FADE — each shot declares a `chrome` opacity (0..1) which lerps
  // the HUD overlays, the floor/ceiling grids, and any other "scaffolding"
  // in or out. Close-in / TRACK shots set chrome=0 so the cinematic frames
  // are uncluttered. Wide / establishing shots use chrome=1 (full HUD).
  // =====================================================================
  const hudEls = Array.from(document.querySelectorAll('.hud'));
  let _chromePrev = 1.0;
  function applyChrome(value) {
    if (Math.abs(value - _chromePrev) < 0.002) return;
    _chromePrev = value;
    for (const el of hudEls) el.style.opacity = value.toFixed(3);
    gridMajor.material.opacity = gridMajor.material.userData.baseOpacity * value;
    gridMinor.material.opacity = gridMinor.material.userData.baseOpacity * value;
    gridCeil .material.opacity = gridCeil .material.userData.baseOpacity * value;
  }

  // =====================================================================
  // PER-SHOT BLOOM — wide / pull-back shots (camera 5+ units away) get a
  // MUCH dimmer bloom because at distance every ribbon is < 1 device pixel
  // wide and adjacent ribbons stack into the same pixel. The default 0.18
  // strength then catches that aggregate brightness and turns the whole
  // attractor into a fuzzy halo.  Each shot declares `bloomScale` (0..1.5)
  // which multiplies the base strength.  Lerped between shots like chrome.
  // =====================================================================
  const BLOOM_BASE_STRENGTH = bloomPass.strength;   // captured snapshot
  let _bloomPrev = 1.0;
  function applyBloomScale(scale) {
    // v4.5: per-regime bloom multiplier composed on top of the per-shot
    // bloomScale. Lorenz uses 0.65 because its sink-driven trails stack
    // far more aggressively than Aizawa/Halvorsen/Thomas.
    const rMul = (activeRegime && activeRegime.bloomMul) ?? 1.0;
    const finalScale = scale * rMul;
    if (Math.abs(finalScale - _bloomPrev) < 0.005) return;
    _bloomPrev = finalScale;
    bloomPass.strength = BLOOM_BASE_STRENGTH * finalScale;
  }

  function applyShotCrossfade(a, b, alpha, headX, headY, headZ) {
    // Smoothly chase the comet head. 0.025 ≈ 0.6s half-life at 60fps.
    cometVec.set(headX, headY, headZ);
    cometTarget.lerp(cometVec, 0.025);

    const pivot  = (a.pivot  ?? 0) * (1 - alpha) + (b.pivot  ?? 0) * alpha;
    const wobble = (a.wobble ?? 0) * (1 - alpha) + (b.wobble ?? 0) * alpha;

    // Position: shot's anchor point (world or relative, per `pivot`) plus
    // an optional handheld wobble whose amplitude vanishes when locked.
    tmpVec.lerpVectors(a.pos, b.pos, alpha);
    tmpVec.y += Math.sin(alpha * Math.PI) * 0.14 * wobble;
    const t = performance.now() * 0.00028;
    tmpVec.x += Math.sin(t * 1.7) * 0.008 * wobble;
    tmpVec.y += Math.cos(t * 1.3) * 0.006 * wobble;
    tmpVec.addScaledVector(cometTarget, pivot);
    camera.position.copy(tmpVec);

    // LookAt: shot's compositional anchor + (optional) comet pivot.
    tmpLook.lerpVectors(a.look, b.look, alpha);
    tmpLook.addScaledVector(cometTarget, pivot);
    camera.lookAt(tmpLook);

    camera.fov = a.fov + (b.fov - a.fov) * alpha;
    camera.updateProjectionMatrix();

    // Chrome lerp — fades the HUD and grids in/out together. Smoothease so
    // the overlays glide rather than abrupt-cut at shot boundaries.
    const chromeAlpha = smoothEase(alpha);
    const chromeNow = (a.chrome ?? 1.0) * (1 - chromeAlpha) + (b.chrome ?? 1.0) * chromeAlpha;
    applyChrome(chromeNow);

    // Bloom lerp — uses the same eased alpha so wide → mid transitions pull
    // bloom up gradually rather than snapping at the boundary.
    const bloomNow = (a.bloomScale ?? 1.0) * (1 - chromeAlpha) + (b.bloomScale ?? 1.0) * chromeAlpha;
    applyBloomScale(bloomNow);
  }

  // =====================================================================
  // REGIME LIFECYCLE — cold-start, retract, swap
  // =====================================================================

  // v4.5: extracted regime-set logic so both auto-cycle (`swapRegime`) and
  // manual hotkey jumps (`jumpToRegime`) share the same cold-start.
  function setRegime(newIdx) {
    regimeIdx = ((newIdx % REGIMES.length) + REGIMES.length) % REGIMES.length;
    activeRegime = REGIMES[regimeIdx];
    applyRegimeTransform(activeRegime);
    reseedSplines(activeRegime);
    regimeT = 0;
    opacityMul = 0;
    // Re-sync camera to top of the shot cycle so every cold-start opens with
    // the regime-specific establishing shot — feels like a real "scene one" cut.
    shotIdx = 0;
    shotT = 0;
    // Apply the regime's preferred camera up-vector. Aizawa wants screen-up
    // = world-z so its central spike reads vertical; the others use
    // standard y-up. We snap (no interpolation) because mixing up vectors
    // mid-shot causes camera roll that's visually disorienting.
    if (activeRegime.cameraUp) camera.up.copy(activeRegime.cameraUp);
    // Snap the smoothed comet target to the new attractor's world-space
    // seed centre, so the camera is already framed on the dot the moment
    // the cold-start fade-in begins (no visible "search" pan).
    const [cx, cy, cz] = activeRegime.seedCenter;
    const ssx = activeRegime.renderScale;
    const [sox, soy, soz] = activeRegime.renderOffset;
    cometTarget.set(
      cx * ssx + sox,
      cy * ssx + soy,
      cz * ssx + soz,
    );
  }

  // Auto-cycle: invoked when a regime's lifecycle clock hits its end.
  function swapRegime() {
    setRegime(regimeIdx + 1);
  }

  // Manual hotkey skip: jump straight to a specific regime index.
  function jumpToRegime(idx) {
    setRegime(idx);
  }

  // =====================================================================
  // HOTKEYS — preview/skip without waiting for the auto-cycle.
  //   1 / 2 / 3 / 4   jump straight to that regime (uses display order)
  //   →  / N           skip to next regime
  //   ←  / P           skip to previous regime
  // =====================================================================
  const _onKeydown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case '1': jumpToRegime(0); break;
      case '2': jumpToRegime(1); break;
      case '3': jumpToRegime(2); break;
      case '4': jumpToRegime(3); break;
      case 'ArrowRight':
      case 'n':
      case 'N':
        jumpToRegime(regimeIdx + 1);
        break;
      case 'ArrowLeft':
      case 'p':
      case 'P':
        jumpToRegime(regimeIdx - 1);
        break;
      default: return;
    }
    e.preventDefault();
  };
  window.addEventListener('keydown', _onKeydown);
  _cleanups.push(() => window.removeEventListener('keydown', _onKeydown));

  // Pause rendering when the hero scrolls out of view to save the GPU.
  const _io = new IntersectionObserver(
    (entries) => { _visible = entries[0].isIntersecting; },
    { threshold: 0.01 },
  );
  _io.observe(root);
  _cleanups.push(() => _io.disconnect());

  // =====================================================================
  // MAIN LOOP
  // =====================================================================
  const clock = new THREE.Clock();
  let prevHeadX = 0, prevHeadY = 0, prevHeadZ = 0;
  let tickCooldown = 0;

  function tick() {
    if (!_running) return;
    // Drain the clock even when paused so we don't get a dt jump on resume.
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!_visible) { _raf = requestAnimationFrame(tick); return; }

    // --- Regime lifecycle: cold-start → stable → retract → swap ----------
    regimeT += dt;
    if (regimeT >= REGIME_DURATION) {
      swapRegime();
    }
    // opacityMul: smooth fade in over first 1.2s, fade out over last 1.5s
    const fadeIn  = Math.min(1, regimeT / 1.2);
    const fadeOut = Math.min(1, (REGIME_DURATION - regimeT) / 1.5);
    opacityMul = Math.max(0, Math.min(fadeIn, fadeOut));

    // --- Integrate the attractor (active regime's step + params + dt) ----
    // Each spline integrates and grows on its OWN clock (regimeT - startDelay).
    // During the regime's stable middle, all splines run; in the cold-start &
    // retract phases we compute per-spline progress so trails appear in waves
    // and dissolve in waves, never marching in lockstep.
    const step    = activeRegime.step;
    const rp      = activeRegime.params;
    const rdt     = activeRegime.dt;
    const pinch   = activeRegime.radialPinch || null;
    // v4.5: per-regime brightness multiplier — Lorenz uses 0.65 to keep the
    // wing focal points from burning out into a white teardrop during retract.
    const opMul   = activeRegime.lineOpacityMul ?? 1.0;
    const inCold  = regimeT < REGIME_COLD_START;
    const inRet   = regimeT > REGIME_DURATION - REGIME_RETRACT;
    for (const s of splines) {
      // Per-spline elapsed time (clamped at zero before this spline's start).
      const sT = regimeT - s.startDelay;

      let sDraw;
      if (sT <= 0) {
        // Frozen at seed — no integration, no rendering yet.
        sDraw = 0;
      } else {
        // Integrator updates s.buf in-place: shifts everything right by 3
        // and writes the new head at buf[0..2]. After this call, buf[3..5]
        // holds the OLD head (the new segment 0's endpoint).
        step(s.buf, rp, rdt);

        // Sync to Line2's interleaved instance buffer:
        //   lineSegArr layout = [seg0.start.xyz, seg0.end.xyz, seg1.start.xyz, ...]
        // Ring-shift right by one segment (6 floats) and write the new
        // head segment at slot 0. This is O(N) but a single copyWithin
        // is cache-friendly and never allocates.
        //
        // v4.4: when the regime declares a `radialPinch`, we warp the head
        // segment into the lineSegArr but keep s.buf in unwarped/native
        // coordinates so the integrator's stability is unaffected. Each
        // segment was warped at the moment it was the head, and ring-shift
        // preserves those warped values throughout the trail.
        const lsa = s.lineSegArr;
        lsa.copyWithin(6, 0, lsa.length - 6);
        if (pinch) {
          applyRadialPinch(pinch, s.buf[0], s.buf[1], s.buf[2], lsa, 0);   // new head
          applyRadialPinch(pinch, s.buf[3], s.buf[4], s.buf[5], lsa, 3);   // old head
        } else {
          lsa[0] = s.buf[0]; lsa[1] = s.buf[1]; lsa[2] = s.buf[2];
          lsa[3] = s.buf[3]; lsa[4] = s.buf[4]; lsa[5] = s.buf[5];
        }
        s.instanceBuffer.needsUpdate = true;

        if (inCold) {
          const span = REGIME_COLD_START - s.startDelay;
          sDraw = Math.max(0, Math.min(TRAIL_LEN,
            Math.floor(TRAIL_LEN * (sT / span))));
        } else if (inRet) {
          const tInRet = regimeT - (REGIME_DURATION - REGIME_RETRACT)
                       - s.startDelay * 0.5;
          const k = 1 - Math.max(0, tInRet) / REGIME_RETRACT;
          sDraw = Math.max(0, Math.floor(TRAIL_LEN * k));
        } else {
          sDraw = TRAIL_LEN;
        }
      }
      // Line2 renders one instance per segment — clamp count to (sDraw - 1)
      // so we draw the newest sDraw vertices' worth of segments.
      s.geom.instanceCount = Math.max(0, sDraw - 1);
      s.mat.opacity = s.mat.userData.baseOpacity * opacityMul * opMul;
    }
    spark.material.opacity = sparkMat.userData.baseOpacity * opacityMul;
    core.material.opacity  = coreMat.userData.baseOpacity  * opacityMul;

    // --- Animate atmospheric motes ---
    const mPos = moteGeom.attributes.position.array;
    for (let i = 0; i < moteCount; i++) {
      mPos[i*3+0] += moteVel[i*3+0];
      mPos[i*3+1] += moteVel[i*3+1];
      mPos[i*3+2] += moteVel[i*3+2];
      if (mPos[i*3+1] > 4) {
        mPos[i*3+0] = (Math.random() - 0.5) * 14;
        mPos[i*3+1] = -4;
        mPos[i*3+2] = -1 - Math.random() * 6;
      }
    }
    moteGeom.attributes.position.needsUpdate = true;

    // --- Comet head & emission ---
    const head = splines[0].buf;
    const hx = head[0], hy = head[1], hz = head[2];
    spark.position.set(hx, hy, hz);
    core.position.copy(spark.position);

    // Breathing scale on the spark
    const t = performance.now() * 0.001;
    const breathe = 0.55 + Math.sin(t * 2.1) * 0.06;
    spark.scale.set(breathe, breathe, 1);

    // Speed of the head — when it accelerates through fast regions, emit ticks.
    // Suppress emissions during cold-start & retract so the trail can build/
    // shrink cleanly without leftover sparks floating around.
    const speed = Math.hypot(hx - prevHeadX, hy - prevHeadY, hz - prevHeadZ);
    tickCooldown -= dt;
    const canEmit = opacityMul > 0.7 && regimeT > 1.0 && regimeT < REGIME_DURATION - 2.5;
    if (canEmit && speed > activeRegime.speedThresh && tickCooldown <= 0) {
      // tick particles live in world space, so transform local → world
      const sx = activeRegime.renderScale;
      const ox = activeRegime.renderOffset[0], oy = activeRegime.renderOffset[1], oz = activeRegime.renderOffset[2];
      emitTick(hx * sx + ox, hy * sx + oy, hz * sx + oz, speed * 0.4 / activeRegime.speedThresh);
      tickCooldown = 0.05 + Math.random() * 0.08;
    }
    prevHeadX = hx; prevHeadY = hy; prevHeadZ = hz;

    // Update tick particles
    for (const p of tickPool) {
      if (p.userData.life > 0) {
        p.userData.life -= dt * 0.6;
        p.position.x += p.userData.vx;
        p.position.y += p.userData.vy;
        p.position.z += p.userData.vz;
        p.material.opacity = Math.max(0, p.userData.life * 0.7);
      }
    }

    // --- Camera direction ---
    // Advance the timeline FIRST, then read cur/nxt — otherwise on the frame
    // where we cross a shot boundary, cur/nxt still point at the old shots
    // while alpha resets to 0, which teleports the camera back to the start of
    // the segment we just finished (a 1-frame "flash").
    shotT += dt;
    const SHOT_LIST = activeRegime.shots;
    while (shotT >= SHOT_LIST[shotIdx].dur) {
      shotT -= SHOT_LIST[shotIdx].dur;     // preserve any time overshoot so dt is honored
      shotIdx = (shotIdx + 1) % SHOT_LIST.length;
    }
    const cur   = shotAt(shotIdx);
    const nxt   = shotAt((shotIdx + 1) % SHOT_LIST.length);
    // Two-phase shot timing: dwell on `cur` for the first HOLD_FRACTION of
    // its duration, then transition to `nxt` over the remaining slice. This
    // gives every pose room to breathe before the camera glides on, and the
    // smootherstep keeps the start & end of each glide nearly tangent to
    // zero velocity (no perceptible jolt when motion begins or ends).
    const holdEnd  = cur.dur * HOLD_FRACTION;
    const moveSpan = cur.dur - holdEnd;
    const alpha = shotT < holdEnd
      ? 0
      : smoothEase((shotT - holdEnd) / moveSpan);
    // Convert the integrator's native head coords to WORLD space so the
    // camera (which lives in world space) actually frames the visible
    // comet, not its untransformed Lorenz/Halvorsen/Thomas raw values.
    // Includes optional anisotropic axis scale (Aizawa uses this to widen
    // the bowl).
    const sx  = activeRegime.renderScale;
    const sa  = activeRegime.renderScaleAxis || [1, 1, 1];
    const ox  = activeRegime.renderOffset[0];
    const oy  = activeRegime.renderOffset[1];
    const oz  = activeRegime.renderOffset[2];
    applyShotCrossfade(cur, nxt, alpha,
      hx * sx * sa[0] + ox,
      hy * sx * sa[1] + oy,
      hz * sx * sa[2] + oz,
    );

    composer.render();
    _raf = requestAnimationFrame(tick);
  }
  _raf = requestAnimationFrame(tick);

  const _onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloomPass.resolution.set(innerWidth, innerHeight);
    // Line2's LineMaterial uses screen-space pixel widths, so it needs to
    // know the canvas resolution to compute the correct quad expansion.
    _viewport.set(innerWidth, innerHeight);
    for (const s of splines) s.mat.resolution.copy(_viewport);
  };
  addEventListener('resize', _onResize);
  _cleanups.push(() => removeEventListener('resize', _onResize));

  return function teardown() {
    _running = false;
    if (_raf) cancelAnimationFrame(_raf);
    for (const fn of _cleanups) { try { fn(); } catch (e) {} }
    try { renderer.dispose(); } catch (e) {}
    try { composer.dispose && composer.dispose(); } catch (e) {}
    if (renderer.domElement && renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
}
