import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

// ─── Config ──────────────────────────────────────────────────────────────────
const LANE_W = 2.2;
const TRACK_W = LANE_W * 3;
const TILE_LEN = 8;
const TILE_COUNT = 20;
const BASE_SPEED = 0.18;
const GRAVITY = -0.028;
const JUMP_V = 0.38;
const HOLD_ADD = 0.018;
const HOLD_MAX = 12;
const PLAYER_Y_BASE = 0.5;
const COIN_COLORS = [0x00ff88, 0x00cfff, 0xa855f7, 0xf97316, 0xfbbf24];
const MERGE_PTS = [10, 30, 80, 200, 500];
const MERGE_LABELS = ["1", "2", "3", "4", "5"];

type GameState = "IDLE" | "PLAYING" | "DEAD";

interface Coin3D { mesh: THREE.Mesh; level: number; z: number; collected: boolean }
interface Obstacle3D { mesh: THREE.Group; z: number; type: "spike" | "wall" }
interface BonusItem3D { mesh: THREE.Mesh; z: number; type: "magnet" | "shield" | "boost"; collected: boolean }
interface Particle3D { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }

function neonMat(color: number, emissive = 0.9) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, roughness: 0.2, metalness: 0.6 });
}

export default function Index() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const [gameState, setGameState] = useState<GameState>("IDLE");
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem("jm3dHS") || 0));
  const [inv, setInv] = useState<number[]>([]);
  const [bonusBars, setBonusBars] = useState({ magnet: 0, shield: 0, boost: 0 });
  const [deathScore, setDeathScore] = useState(0);

  const gs = useRef<GameState>("IDLE");
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const playerMesh = useRef<THREE.Mesh | null>(null);
  const shieldRing = useRef<THREE.Mesh | null>(null);
  const playerVY = useRef(0);
  const playerY = useRef(PLAYER_Y_BASE);
  const onGround = useRef(true);
  const jumpHeld = useRef(false);
  const holdFrames = useRef(HOLD_MAX);
  const scrollZ = useRef(0);
  const speed = useRef(BASE_SPEED);
  const ticks = useRef(0);
  const scoreRef = useRef(0);
  const coins = useRef<Coin3D[]>([]);
  const obstacles = useRef<Obstacle3D[]>([]);
  const bonusItems = useRef<BonusItem3D[]>([]);
  const particles = useRef<Particle3D[]>([]);
  const inventory = useRef<number[]>([]);
  const magnetT = useRef(0);
  const shieldT = useRef(0);
  const boostT = useRef(0);
  const tiles = useRef<THREE.Object3D[]>([]);
  const lastSpawnZ = useRef(-12);

  // ── Init Three.js ──
  const initThree = useCallback(() => {
    const mount = mountRef.current!;
    const w = mount.clientWidth, h = mount.clientHeight;

    const sc = new THREE.Scene();
    sc.fog = new THREE.FogExp2(0x030712, 0.036);
    sceneRef.current = sc;

    const cam = new THREE.PerspectiveCamera(62, w / h, 0.1, 200);
    cam.position.set(0, 4.5, 8);
    cam.lookAt(0, 0.5, -10);
    cameraRef.current = cam;

    const ren = new THREE.WebGLRenderer({ antialias: true });
    ren.setSize(w, h);
    ren.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    ren.shadowMap.enabled = true;
    ren.shadowMap.type = THREE.PCFSoftShadowMap;
    ren.toneMapping = THREE.ACESFilmicToneMapping;
    ren.toneMappingExposure = 1.3;
    mount.appendChild(ren.domElement);
    rendererRef.current = ren;

    // Lights
    sc.add(new THREE.AmbientLight(0x080818, 3));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(4, 10, 4);
    dir.castShadow = true;
    sc.add(dir);
    const nl = new THREE.PointLight(0x00ff88, 4, 22);
    nl.position.set(0, 4, -5);
    sc.add(nl);

    // Track
    const trackGroup = new THREE.Group();
    sc.add(trackGroup);
    for (let i = 0; i < TILE_COUNT; i++) {
      const geo = new THREE.BoxGeometry(TRACK_W, 0.18, TILE_LEN);
      const mat = new THREE.MeshStandardMaterial({ color: 0x0a0f1e, roughness: 0.85, metalness: 0.2 });
      const tile = new THREE.Mesh(geo, mat);
      tile.receiveShadow = true;
      tile.position.z = -i * TILE_LEN;
      trackGroup.add(tile);
      tiles.current.push(tile);

      // Edge glow strips
      for (const side of [-1, 1]) {
        const sg = new THREE.BoxGeometry(0.07, 0.14, TILE_LEN);
        const sm2 = new THREE.MeshStandardMaterial({ color: 0x00cfff, emissive: 0x00cfff, emissiveIntensity: 1.4 });
        const strip = new THREE.Mesh(sg, sm2);
        strip.position.set(side * (TRACK_W / 2 + 0.035), 0.07, -i * TILE_LEN);
        trackGroup.add(strip);
      }

      // Lane lines
      for (let l = -1; l <= 1; l++) {
        const lg = new THREE.BoxGeometry(0.035, 0.015, TILE_LEN);
        const lm = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.7 });
        const ln = new THREE.Mesh(lg, lm);
        ln.position.set(l * LANE_W, 0.025, -i * TILE_LEN);
        trackGroup.add(ln);
      }
    }

    // Player
    const pGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const pMat = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.7 });
    const pm = new THREE.Mesh(pGeo, pMat);
    pm.position.set(0, PLAYER_Y_BASE, 0);
    pm.castShadow = true;
    sc.add(pm);
    playerMesh.current = pm;

    // Shield ring
    const sGeo = new THREE.TorusGeometry(0.72, 0.045, 12, 48);
    const sMat = new THREE.MeshStandardMaterial({ color: 0x00cfff, emissive: 0x00cfff, emissiveIntensity: 1.6, transparent: true, opacity: 0 });
    const sm = new THREE.Mesh(sGeo, sMat);
    pm.add(sm);
    shieldRing.current = sm;

    // Player light
    const pl = new THREE.PointLight(0x00ff88, 2.5, 6);
    pm.add(pl);

    // Resize handler
    const onResize = () => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      cam.aspect = w2 / h2;
      cam.updateProjectionMatrix();
      ren.setSize(w2, h2);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      mount.removeChild(ren.domElement);
      ren.dispose();
    };
  }, []);

  // ── Spawn ──
  const spawnWave = useCallback(() => {
    const sc = sceneRef.current!;
    const r = Math.random();

    if (r < 0.5) {
      // Coins cluster
      const level = Math.min(4, Math.floor(Math.random() * (1 + scoreRef.current / 300)));
      const lane = (Math.floor(Math.random() * 3) - 1) * LANE_W;
      const count = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < count; i++) {
        const geo = new THREE.SphereGeometry(0.28 + level * 0.06, 20, 20);
        const mat = neonMat(COIN_COLORS[level], 1.3);
        const m = new THREE.Mesh(geo, mat);
        const floating = Math.random() > 0.35;
        m.position.set(lane, floating ? 1.4 + Math.random() * 0.9 : 0.55, lastSpawnZ.current - 4 - i * 2.4);
        sc.add(m);
        coins.current.push({ mesh: m, level, z: m.position.z, collected: false });
      }
      lastSpawnZ.current -= 4 + count * 2.4 + 2;
    } else if (r < 0.85) {
      // Obstacle
      const type = Math.random() > 0.45 ? "spike" : "wall";
      const lane = (Math.floor(Math.random() * 3) - 1) * LANE_W;
      const group = new THREE.Group();
      if (type === "spike") {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 6), neonMat(0xef4444, 1.5));
        m.position.y = 0.75;
        group.add(m);
        const base = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 8, 24), neonMat(0xef4444, 2));
        group.add(base);
      } else {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.9, 0.55), neonMat(0x7c3aed, 1.3));
        m.position.y = 0.95;
        group.add(m);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.09, 0.65), neonMat(0xa855f7, 2.2));
        top.position.y = 1.9;
        group.add(top);
      }
      group.position.set(lane, 0, lastSpawnZ.current - 8 - Math.random() * 4);
      sc.add(group);
      obstacles.current.push({ mesh: group, z: group.position.z, type });
      lastSpawnZ.current = group.position.z - 2;
    } else {
      // Bonus
      const types = ["magnet", "shield", "boost"] as const;
      const type = types[Math.floor(Math.random() * 3)];
      const colors = { magnet: 0xec4899, shield: 0x00cfff, boost: 0xfbbf24 };
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), neonMat(colors[type], 2));
      m.position.set((Math.floor(Math.random() * 3) - 1) * LANE_W, 1.3, lastSpawnZ.current - 6);
      sc.add(m);
      bonusItems.current.push({ mesh: m, z: m.position.z, type, collected: false });
      lastSpawnZ.current -= 8;
    }
  }, []);

  const spawnParticles = useCallback((pos: THREE.Vector3, color: number, count = 12) => {
    const sc = sceneRef.current!;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 + Math.random() * 0.07, 6, 6),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, transparent: true, opacity: 1 })
      );
      m.position.copy(pos);
      sc.add(m);
      const a = Math.random() * Math.PI * 2;
      const spd = 0.06 + Math.random() * 0.1;
      particles.current.push({ mesh: m, vx: Math.cos(a) * spd, vy: 0.07 + Math.random() * 0.1, vz: Math.sin(a) * spd * 0.5, life: 35 + Math.random() * 20 });
    }
  }, []);

  const tryMerge = useCallback((level: number) => {
    if (inventory.current.filter(l => l === level).length >= 3) {
      let removed = 0;
      inventory.current = inventory.current.filter(l => { if (l === level && removed < 3) { removed++; return false; } return true; });
      const merged = Math.min(level + 1, 4);
      inventory.current.push(merged);
      scoreRef.current += MERGE_PTS[merged];
      setScore(scoreRef.current);
      setInv([...inventory.current]);
    }
  }, []);

  // ── Game Loop ──
  const loop = useCallback(() => {
    const sc = sceneRef.current;
    const cam = cameraRef.current;
    const ren = rendererRef.current;
    const pm = playerMesh.current;
    if (!sc || !cam || !ren || !pm) { rafRef.current = requestAnimationFrame(loop); return; }

    if (gs.current === "PLAYING") {
      ticks.current++;
      const spd = boostT.current > 0 ? speed.current * 1.65 : speed.current;
      speed.current = BASE_SPEED + ticks.current * 0.000022;

      // Spawn
      if (pm.position.z - 2 < lastSpawnZ.current + 40) spawnWave();

      // Jump
      if (jumpHeld.current && !onGround.current && holdFrames.current < HOLD_MAX) {
        playerVY.current += HOLD_ADD;
        holdFrames.current++;
      }
      playerVY.current += GRAVITY;
      playerY.current += playerVY.current;
      if (playerY.current <= PLAYER_Y_BASE) {
        playerY.current = PLAYER_Y_BASE;
        playerVY.current = 0;
        onGround.current = true;
        holdFrames.current = HOLD_MAX;
      }
      pm.position.y = playerY.current;
      pm.rotation.x += spd * 0.45;

      // Advance world
      pm.position.z -= spd;

      // Bonus timers
      if (magnetT.current > 0) { magnetT.current--; setBonusBars(b => ({ ...b, magnet: magnetT.current })); }
      if (shieldT.current > 0) { shieldT.current--; setBonusBars(b => ({ ...b, shield: shieldT.current })); }
      if (boostT.current > 0) { boostT.current--; setBonusBars(b => ({ ...b, boost: boostT.current })); }

      // Shield ring
      (shieldRing.current!.material as THREE.MeshStandardMaterial).opacity = shieldT.current > 0 ? 0.75 : 0;
      shieldRing.current!.rotation.y += 0.06;

      // Player color
      const pMat2 = pm.material as THREE.MeshStandardMaterial;
      const pc = boostT.current > 0 ? 0xfbbf24 : magnetT.current > 0 ? 0xec4899 : 0x00ff88;
      pMat2.color.setHex(pc); pMat2.emissive.setHex(pc);
      (pm.children[1] as THREE.PointLight).color.setHex(pc);

      const px = pm.position.x, py = pm.position.y, pz = pm.position.z;

      // Magnet pull
      if (magnetT.current > 0) {
        coins.current.filter(c => !c.collected).forEach(c => {
          const dx = px - c.mesh.position.x, dy = py - c.mesh.position.y, dz = pz - c.mesh.position.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 5) { c.mesh.position.x += dx * 0.07; c.mesh.position.y += dy * 0.07; c.mesh.position.z += dz * 0.07; }
        });
      }

      // Coin collect
      coins.current.filter(c => !c.collected).forEach(c => {
        c.mesh.rotation.y += 0.04;
        const dx = px - c.mesh.position.x, dy = py - c.mesh.position.y, dz = pz - c.mesh.position.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.85) {
          c.collected = true;
          spawnParticles(c.mesh.position.clone(), COIN_COLORS[c.level], 10);
          sc.remove(c.mesh);
          scoreRef.current += MERGE_PTS[c.level];
          setScore(scoreRef.current);
          inventory.current.push(c.level);
          if (inventory.current.length > 9) inventory.current.shift();
          tryMerge(c.level);
          setInv([...inventory.current]);
        }
      });

      // Bonus collect
      bonusItems.current.filter(b => !b.collected).forEach(b => {
        b.mesh.rotation.y += 0.05; b.mesh.rotation.x += 0.03;
        const dx = px - b.mesh.position.x, dy = py - b.mesh.position.y, dz = pz - b.mesh.position.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.9) {
          b.collected = true;
          const bc = { magnet: 0xec4899, shield: 0x00cfff, boost: 0xfbbf24 };
          spawnParticles(b.mesh.position.clone(), bc[b.type], 16);
          sc.remove(b.mesh);
          if (b.type === "magnet") magnetT.current = 300;
          if (b.type === "shield") shieldT.current = 180;
          if (b.type === "boost") boostT.current = 180;
        }
      });

      // Obstacle collision
      let dead = false;
      obstacles.current.forEach(ob => {
        const dx = Math.abs(px - ob.mesh.position.x);
        const dz = Math.abs(pz - ob.mesh.position.z);
        const hitH = ob.type === "spike" ? 1.5 : 1.9;
        if (dx < 0.88 && dz < 0.88 && py < hitH) {
          if (shieldT.current > 0) { shieldT.current = 0; spawnParticles(pm.position.clone(), 0x00cfff, 14); }
          else dead = true;
        }
      });

      if (dead) {
        spawnParticles(pm.position.clone(), 0xef4444, 22);
        gs.current = "DEAD";
        setGameState("DEAD");
        setDeathScore(scoreRef.current);
        const hs = Math.max(scoreRef.current, Number(localStorage.getItem("jm3dHS") || 0));
        localStorage.setItem("jm3dHS", String(hs));
        setHighScore(hs);
      }

      // Cleanup
      coins.current = coins.current.filter(c => { if (c.mesh.position.z > pm.position.z + 18) { sc.remove(c.mesh); return false; } return true; });
      obstacles.current = obstacles.current.filter(o => { if (o.mesh.position.z > pm.position.z + 18) { sc.remove(o.mesh); return false; } return true; });
      bonusItems.current = bonusItems.current.filter(b => { if (b.mesh.position.z > pm.position.z + 18) { sc.remove(b.mesh); return false; } return true; });

      // Particles
      particles.current.forEach(p => {
        p.mesh.position.x += p.vx; p.mesh.position.y += p.vy; p.mesh.position.z += p.vz;
        p.vy -= 0.004; p.life--;
        (p.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, p.life / 55);
      });
      particles.current = particles.current.filter(p => { if (p.life <= 0) { sc.remove(p.mesh); return false; } return true; });

      // Camera follow
      const bob = onGround.current ? Math.sin(ticks.current * 0.13) * 0.04 : 0;
      cam.position.set(px * 0.25, 4.5 + bob, pz + 8);
      cam.lookAt(px * 0.15, py + 0.5, pz - 10);

      // Move track with player
      tiles.current.forEach(tile => {
        if (tile.parent) {
          tile.parent.position.z = pm.position.z;
        }
      });
    }

    ren.render(sc, cam);
    rafRef.current = requestAnimationFrame(loop);
  }, [spawnWave, spawnParticles, tryMerge]);

  // ── Start ──
  const startGame = useCallback(() => {
    const sc = sceneRef.current!;
    [...coins.current, ...obstacles.current, ...bonusItems.current].forEach(o => sc.remove(o.mesh));
    particles.current.forEach(p => sc.remove(p.mesh));
    coins.current = []; obstacles.current = []; bonusItems.current = []; particles.current = [];
    inventory.current = [];
    scoreRef.current = 0;
    speed.current = BASE_SPEED;
    ticks.current = 0;
    magnetT.current = 0; shieldT.current = 0; boostT.current = 0;
    playerY.current = PLAYER_Y_BASE;
    playerVY.current = 0;
    onGround.current = true;
    jumpHeld.current = false;
    holdFrames.current = HOLD_MAX;
    const pm = playerMesh.current!;
    pm.position.set(0, PLAYER_Y_BASE, 0);
    lastSpawnZ.current = pm.position.z - 12;
    gs.current = "PLAYING";
    setGameState("PLAYING");
    setScore(0);
    setInv([]);
    setBonusBars({ magnet: 0, shield: 0, boost: 0 });
  }, []);

  const pressJump = useCallback(() => {
    jumpHeld.current = true;
    if (gs.current === "PLAYING" && onGround.current) {
      playerVY.current = JUMP_V;
      onGround.current = false;
      holdFrames.current = 0;
    }
  }, []);
  const releaseJump = useCallback(() => { jumpHeld.current = false; }, []);

  useEffect(() => {
    const cleanup = initThree();
    rafRef.current = requestAnimationFrame(loop);
    const onDown = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); pressJump(); } };
    const onUp = (e: KeyboardEvent) => { if (e.code === "Space") releaseJump(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      cancelAnimationFrame(rafRef.current);
      cleanup?.();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [initThree, loop, pressJump, releaseJump]);

  const accentColor = boostT.current > 0 ? "#fbbf24" : magnetT.current > 0 ? "#ec4899" : "#00ff88";

  return (
    <div style={{ width: "100dvw", height: "100dvh", background: "#030712", position: "relative", overflow: "hidden", fontFamily: "'Orbitron', monospace", userSelect: "none" }}>
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} onPointerDown={pressJump} onPointerUp={releaseJump} />

      {/* Score HUD */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 20, display: "flex", justifyContent: "space-between", padding: "14px 18px", pointerEvents: "none" }}>
        <div>
          <div style={{ fontSize: 9, color: "#ffffff33", letterSpacing: "0.25em" }}>СЧЁТ</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: accentColor, textShadow: `0 0 14px ${accentColor}`, lineHeight: 1, transition: "color 0.5s" }}>{score}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#ffffff33", letterSpacing: "0.25em" }}>РЕКОРД</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#ffffff55" }}>{highScore}</div>
        </div>
      </div>

      {/* Bonus bars */}
      <div style={{ position: "absolute", top: 76, left: 18, zIndex: 20, display: "flex", gap: 8, pointerEvents: "none" }}>
        {bonusBars.magnet > 0 && <BonusBar icon="🧲" color="#ec4899" val={bonusBars.magnet} max={300} />}
        {bonusBars.shield > 0 && <BonusBar icon="🛡️" color="#00cfff" val={bonusBars.shield} max={180} />}
        {bonusBars.boost > 0 && <BonusBar icon="⚡" color="#fbbf24" val={bonusBars.boost} max={180} />}
      </div>

      {/* Inventory */}
      <div style={{ position: "absolute", bottom: 20, left: 0, right: 0, zIndex: 20, display: "flex", justifyContent: "center", gap: 6, pointerEvents: "none" }}>
        {Array.from({ length: 9 }, (_, i) => {
          const lvl = inv[i];
          const color = lvl !== undefined ? `#${COIN_COLORS[lvl].toString(16).padStart(6, "0")}` : null;
          return (
            <div key={i} style={{
              width: 30, height: 30, borderRadius: "50%",
              border: color ? `2px solid ${color}` : "1px solid #ffffff11",
              background: color ? `${color}22` : "#ffffff05",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: color ? `0 0 8px ${color}55` : "none",
              fontSize: 9, fontWeight: 700, color: color || "transparent",
            }}>
              {lvl !== undefined ? MERGE_LABELS[lvl] : ""}
            </div>
          );
        })}
      </div>

      {/* Overlay */}
      {(gameState === "IDLE" || gameState === "DEAD") && (
        <div style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(3,7,18,0.78)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          {gameState === "DEAD" && (
            <>
              <div style={{ fontSize: 20, color: "#ef4444", fontWeight: 700, letterSpacing: "0.15em", textShadow: "0 0 20px #ef4444" }}>GAME OVER</div>
              <div style={{ fontSize: 56, fontWeight: 900, color: "#ffffff", lineHeight: 1 }}>{deathScore}</div>
              {deathScore > 0 && deathScore >= highScore && (
                <div style={{ fontSize: 11, color: "#fbbf24", letterSpacing: "0.25em", textShadow: "0 0 10px #fbbf24" }}>✦ НОВЫЙ РЕКОРД ✦</div>
              )}
            </>
          )}
          {gameState === "IDLE" && (
            <div style={{ textAlign: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 30, fontWeight: 900, color: "#00ff88", textShadow: "0 0 22px #00ff88", letterSpacing: "0.12em" }}>JUMP &amp; MERGE</div>
              <div style={{ fontSize: 11, color: "#ffffff33", letterSpacing: "0.3em", marginTop: 6, fontFamily: "'Rajdhani', sans-serif" }}>COLOR DASH · 3D</div>
              <div style={{ marginTop: 22, fontSize: 11, color: "#ffffff44", letterSpacing: "0.08em", fontFamily: "'Rajdhani', sans-serif", lineHeight: 2 }}>
                Собирай 3 шара одного цвета — они сольются!<br />
                Перепрыгивай шипы и стены.<br />
                Лови бонусы: 🧲 магнит · 🛡️ щит · ⚡ буст
              </div>
            </div>
          )}
          <button onClick={startGame} style={{
            padding: "13px 44px", background: "transparent",
            border: "2px solid #00ff88", borderRadius: 4, color: "#00ff88",
            fontFamily: "'Orbitron', monospace", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.2em", cursor: "pointer",
            textShadow: "0 0 10px #00ff88", boxShadow: "0 0 22px #00ff8833",
          }}>
            {gameState === "DEAD" ? "ЗАНОВО" : "ИГРАТЬ"}
          </button>
          <div style={{ fontSize: 9, color: "#ffffff1a", letterSpacing: "0.15em", fontFamily: "'Rajdhani', sans-serif" }}>
            ПРОБЕЛ · ТАП — ПРЫЖОК · УДЕРЖАНИЕ — ВЫСОКИЙ ПРЫЖОК
          </div>
        </div>
      )}
    </div>
  );
}

function BonusBar({ icon, color, val, max }: { icon: string; color: string; val: number; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, background: `${color}15`, border: `1px solid ${color}44`, borderRadius: 20, padding: "4px 10px" }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div style={{ width: 40, height: 4, background: "#ffffff11", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${(val / max) * 100}%`, height: "100%", background: color, boxShadow: `0 0 6px ${color}`, transition: "width 0.1s linear" }} />
      </div>
    </div>
  );
}