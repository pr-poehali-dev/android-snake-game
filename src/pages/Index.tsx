import { useEffect, useRef, useState, useCallback } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────
const W = 390;
const H = 700;
const GROUND_Y = H - 100;
const PLAYER_R = 22;
const GRAVITY = 0.55;
const JUMP_FORCE = -13.5;
const JUMP_HOLD = -0.6;
const HOLD_FRAMES = 14;
const BASE_SPEED = 4.2;
const COIN_R = 14;

// Merge level configs
const MERGE_LEVELS = [
  { color: "#00ff88", glow: "#00ff88", label: "1", pts: 10 },
  { color: "#00cfff", glow: "#00cfff", label: "2", pts: 30 },
  { color: "#a855f7", glow: "#a855f7", label: "3", pts: 80 },
  { color: "#f97316", glow: "#f97316", label: "4", pts: 200 },
  { color: "#fbbf24", glow: "#fbbf24", label: "5", pts: 500 },
];

const BONUS_TYPES = ["magnet", "shield", "boost"] as const;
type BonusType = (typeof BONUS_TYPES)[number];

const BONUS_COLORS: Record<BonusType, string> = {
  magnet: "#ec4899",
  shield: "#00cfff",
  boost: "#fbbf24",
};
const BONUS_ICONS: Record<BonusType, string> = {
  magnet: "🧲",
  shield: "🛡️",
  boost: "⚡",
};

type GameState = "IDLE" | "PLAYING" | "DEAD";

interface Coin {
  id: number;
  x: number;
  y: number;
  level: number;
  vy: number;
  collected: boolean;
  mergeAnim: number;
}

interface Obstacle {
  id: number;
  x: number;
  type: "spike" | "pit" | "wall";
  w: number;
  h: number;
}

interface BonusItem {
  id: number;
  x: number;
  y: number;
  type: BonusType;
  collected: boolean;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  life: number;
  maxLife: number;
  r: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _uid = 0;
const uid = () => ++_uid;

function scaleCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return { sw: rect.width, sh: rect.height };
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  // Game state refs (no re-render needed for game loop)
  const gs = useRef<GameState>("IDLE");
  const playerY = useRef(GROUND_Y - PLAYER_R);
  const playerVY = useRef(0);
  const onGround = useRef(true);
  const jumpPressed = useRef(false);
  const holdFrames = useRef(0);
  const scrollX = useRef(0);
  const speed = useRef(BASE_SPEED);
  const t = useRef(0);
  const score = useRef(0);
  const coins = useRef<Coin[]>([]);
  const obstacles = useRef<Obstacle[]>([]);
  const bonusItems = useRef<BonusItem[]>([]);
  const particles = useRef<Particle[]>([]);
  const inventory = useRef<number[]>([]); // coin levels collected, max 9
  const magnetActive = useRef(0); // frames left
  const shieldActive = useRef(0);
  const boostActive = useRef(0);
  const shakeFrames = useRef(0);
  const sw = useRef(W);
  const sh = useRef(H);
  const pitX = useRef<number | null>(null); // current pit x offset

  // React state for UI
  const [gameState, setGameState] = useState<GameState>("IDLE");
  const [displayScore, setDisplayScore] = useState(0);
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem("jmHS") || 0));
  const [inv, setInv] = useState<number[]>([]);
  const [bonuses, setBonuses] = useState({ magnet: 0, shield: 0, boost: 0 });
  const [deathScore, setDeathScore] = useState(0);

  // ── Spawn helpers ──
  const spawnCoins = useCallback(() => {
    const count = 2 + Math.floor(Math.random() * 3);
    const baseX = sw.current + 60 + Math.random() * 200;
    const level = Math.min(4, Math.floor(Math.random() * (1 + score.current / 500)));
    for (let i = 0; i < count; i++) {
      const floating = Math.random() > 0.4;
      coins.current.push({
        id: uid(), x: baseX + i * 38, level,
        y: floating ? GROUND_Y - PLAYER_R * 2 - 40 - Math.random() * 60 : GROUND_Y - COIN_R - 2,
        vy: 0, collected: false, mergeAnim: 0,
      });
    }
  }, []);

  const spawnBonus = useCallback(() => {
    const type = BONUS_TYPES[Math.floor(Math.random() * 3)];
    bonusItems.current.push({
      id: uid(), x: sw.current + 60 + Math.random() * 150,
      y: GROUND_Y - PLAYER_R * 2 - 50 - Math.random() * 40, type, collected: false,
    });
  }, []);

  const spawnObstacle = useCallback(() => {
    const r = Math.random();
    if (r < 0.5) {
      obstacles.current.push({ id: uid(), x: sw.current + 60, type: "spike", w: 28, h: 36 });
    } else if (r < 0.8) {
      obstacles.current.push({ id: uid(), x: sw.current + 60, type: "wall", w: 22, h: 50 });
    }
    // pit handled via pitX
  }, []);

  const addParticles = useCallback((x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const spd = 2 + Math.random() * 4;
      particles.current.push({
        x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd - 2,
        color, life: 30 + Math.random() * 20, maxLife: 50, r: 3 + Math.random() * 4,
      });
    }
  }, []);

  // ── Merge logic ──
  const tryMerge = useCallback((newLevel: number) => {
    const idx = inventory.current.lastIndexOf(newLevel);
    const idx2 = inventory.current.indexOf(newLevel);
    const count = inventory.current.filter(l => l === newLevel).length;
    if (count >= 3) {
      // Remove 3 of that level, add 1 of next
      let removed = 0;
      inventory.current = inventory.current.filter(l => {
        if (l === newLevel && removed < 3) { removed++; return false; }
        return true;
      });
      const merged = Math.min(newLevel + 1, 4);
      inventory.current.push(merged);
      const pts = MERGE_LEVELS[merged].pts;
      score.current += pts;
      setDisplayScore(score.current);
      setInv([...inventory.current]);
      return merged;
    }
    void idx; void idx2;
    return -1;
  }, []);

  // ── Jump ──
  const doJump = useCallback(() => {
    if (gs.current !== "PLAYING") return;
    if (onGround.current) {
      playerVY.current = JUMP_FORCE;
      onGround.current = false;
      holdFrames.current = 0;
    }
  }, []);

  // ── Init / Reset ──
  const startGame = useCallback(() => {
    playerY.current = GROUND_Y - PLAYER_R;
    playerVY.current = 0;
    onGround.current = true;
    jumpPressed.current = false;
    holdFrames.current = 0;
    scrollX.current = 0;
    speed.current = BASE_SPEED;
    t.current = 0;
    score.current = 0;
    coins.current = [];
    obstacles.current = [];
    bonusItems.current = [];
    particles.current = [];
    inventory.current = [];
    magnetActive.current = 0;
    shieldActive.current = 0;
    boostActive.current = 0;
    shakeFrames.current = 0;
    pitX.current = null;
    gs.current = "PLAYING";
    setGameState("PLAYING");
    setDisplayScore(0);
    setInv([]);
    setBonuses({ magnet: 0, shield: 0, boost: 0 });
  }, []);

  // ── Draw ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W2 = sw.current;
    const H2 = sh.current;
    const gY = GROUND_Y * (H2 / H);
    const scaleY = H2 / H;
    const scaleX2 = W2 / W;

    ctx.save();
    if (shakeFrames.current > 0) {
      shakeFrames.current--;
      ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4);
    }

    // ── Background ──
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, W2, H2);

    // Stars
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137 + scrollX.current * 0.15) % W2 + W2) % W2;
      const sy = (i * 73) % (gY * 0.9);
      const sr = 0.5 + (i % 3) * 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grid lines (perspective)
    ctx.strokeStyle = "rgba(0,200,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const lx = ((i * (W2 / 9)) - (scrollX.current * 0.5) % (W2 / 9) + W2) % W2;
      ctx.beginPath(); ctx.moveTo(lx, gY * 0.3); ctx.lineTo(lx - W2 * 0.3, H2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx, gY * 0.3); ctx.lineTo(lx + W2 * 0.3, H2); ctx.stroke();
    }

    // ── Ground ──
    const glowGrad = ctx.createLinearGradient(0, gY, 0, H2);
    glowGrad.addColorStop(0, "#00ff8822");
    glowGrad.addColorStop(0.2, "#00ff8808");
    glowGrad.addColorStop(1, "transparent");
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, gY, W2, H2 - gY);

    ctx.strokeStyle = "#00ff88";
    ctx.shadowColor = "#00ff88";
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, gY); ctx.lineTo(W2, gY); ctx.stroke();
    ctx.shadowBlur = 0;

    // Ground dashes
    ctx.strokeStyle = "rgba(0,255,136,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([20, 15]);
    ctx.lineDashOffset = -(scrollX.current * 0.8) % 35;
    ctx.beginPath(); ctx.moveTo(0, gY + 8); ctx.lineTo(W2, gY + 8); ctx.stroke();
    ctx.setLineDash([]);

    // ── Pit ──
    if (pitX.current !== null) {
      const px = pitX.current - scrollX.current;
      const pw = 90 * scaleX2;
      if (px + pw > 0 && px < W2) {
        ctx.fillStyle = "#030712";
        ctx.fillRect(px, gY, pw, H2 - gY + 2);
        ctx.strokeStyle = "#ef444488";
        ctx.lineWidth = 2;
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(px, gY); ctx.lineTo(px, H2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px + pw, gY); ctx.lineTo(px + pw, H2); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // ── Obstacles ──
    obstacles.current.forEach(ob => {
      const ox = ob.x - scrollX.current;
      if (ob.type === "spike") {
        const sx = ox * scaleX2 + W2 * (1 - scaleX2) / 2;
        ctx.fillStyle = "#ef4444";
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(sx, gY);
        ctx.lineTo(sx + ob.w / 2, gY - ob.h * scaleY);
        ctx.lineTo(sx + ob.w, gY);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (ob.type === "wall") {
        const wx = ox * scaleX2 + W2 * (1 - scaleX2) / 2;
        ctx.fillStyle = "#7c3aed";
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 12;
        ctx.fillRect(wx, gY - ob.h * scaleY, ob.w * scaleX2, ob.h * scaleY);
        ctx.shadowBlur = 0;
      }
    });

    // ── Bonus items ──
    bonusItems.current.filter(b => !b.collected).forEach(b => {
      const bx = (b.x - scrollX.current) * scaleX2 + W2 * (1 - scaleX2) / 2;
      const by = b.y * scaleY;
      const pulse = 0.9 + 0.1 * Math.sin(t.current * 0.1);
      ctx.shadowColor = BONUS_COLORS[b.type];
      ctx.shadowBlur = 18 * pulse;
      ctx.beginPath();
      ctx.arc(bx, by, 18 * scaleX2, 0, Math.PI * 2);
      ctx.fillStyle = BONUS_COLORS[b.type] + "33";
      ctx.fill();
      ctx.strokeStyle = BONUS_COLORS[b.type];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = `${14 * scaleX2}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(BONUS_ICONS[b.type], bx, by);
    });

    // ── Coins ──
    coins.current.filter(c => !c.collected).forEach(c => {
      const cx2 = (c.x - scrollX.current) * scaleX2 + W2 * (1 - scaleX2) / 2;
      const cy2 = c.y * scaleY;
      const cfg = MERGE_LEVELS[c.level];
      const r2 = (COIN_R + c.level * 2) * scaleX2;
      const ma = c.mergeAnim > 0 ? 1 + c.mergeAnim * 0.03 : 1;
      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.scale(ma, ma);
      ctx.shadowColor = cfg.glow;
      ctx.shadowBlur = 16;
      const cg = ctx.createRadialGradient(0, -r2 * 0.3, 0, 0, 0, r2);
      cg.addColorStop(0, "#ffffff");
      cg.addColorStop(0.4, cfg.color);
      cg.addColorStop(1, cfg.color + "88");
      ctx.beginPath();
      ctx.arc(0, 0, r2, 0, Math.PI * 2);
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#000000bb";
      ctx.font = `bold ${9 * scaleX2}px 'Orbitron', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(cfg.label, 0, 0);
      ctx.restore();
    });

    // ── Player ──
    const px = W2 * 0.22;
    const py = playerY.current * scaleY;
    const shieldOn = shieldActive.current > 0;
    const magnetOn = magnetActive.current > 0;
    const boostOn = boostActive.current > 0;

    if (shieldOn) {
      ctx.shadowColor = "#00cfff";
      ctx.shadowBlur = 30;
      ctx.strokeStyle = "#00cfff88";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, (PLAYER_R + 10) * scaleX2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const pg = ctx.createRadialGradient(px - PLAYER_R * 0.3 * scaleX2, py - PLAYER_R * 0.3 * scaleY, 0, px, py, PLAYER_R * scaleX2);
    const pc1 = boostOn ? "#fbbf24" : magnetOn ? "#ec4899" : "#00ff88";
    const pc2 = boostOn ? "#f97316" : magnetOn ? "#a855f7" : "#00cfff";
    pg.addColorStop(0, "#ffffff");
    pg.addColorStop(0.35, pc1);
    pg.addColorStop(1, pc2);
    ctx.shadowColor = pc1;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_R * scaleX2, 0, Math.PI * 2);
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Trail
    for (let i = 1; i <= 5; i++) {
      ctx.globalAlpha = 0.12 * (6 - i);
      ctx.beginPath();
      ctx.arc(px - i * 8 * scaleX2, py, PLAYER_R * scaleX2 * (1 - i * 0.12), 0, Math.PI * 2);
      ctx.fillStyle = pc2;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Particles ──
    particles.current.forEach(p => {
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x * scaleX2 + W2 * (1 - scaleX2) / 2, p.y * scaleY, p.r * scaleX2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    ctx.restore();
  }, []);

  // ── Game Loop ──
  const loop = useCallback(() => {
    if (gs.current !== "PLAYING") { draw(); rafRef.current = requestAnimationFrame(loop); return; }

    t.current++;
    const spd = boostActive.current > 0 ? speed.current * 1.7 : speed.current;
    scrollX.current += spd;
    speed.current = BASE_SPEED + t.current * 0.0018;

    // Player physics
    if (jumpPressed.current && !onGround.current && holdFrames.current < HOLD_FRAMES) {
      playerVY.current += JUMP_HOLD;
      holdFrames.current++;
    }
    playerVY.current += GRAVITY;
    playerY.current += playerVY.current;

    const gY = GROUND_Y;
    // Ground check
    if (playerY.current >= gY - PLAYER_R) {
      playerY.current = gY - PLAYER_R;
      playerVY.current = 0;
      onGround.current = true;
      holdFrames.current = HOLD_FRAMES;
    }

    // Bonuses tick
    if (magnetActive.current > 0) { magnetActive.current--; setBonuses(b => ({ ...b, magnet: magnetActive.current })); }
    if (shieldActive.current > 0) { shieldActive.current--; setBonuses(b => ({ ...b, shield: shieldActive.current })); }
    if (boostActive.current > 0) { boostActive.current--; setBonuses(b => ({ ...b, boost: boostActive.current })); }

    // Spawn
    if (t.current % 90 === 0) spawnCoins();
    if (t.current % 180 === 0) spawnObstacle();
    if (t.current % 300 === 0 && Math.random() > 0.4) spawnBonus();

    const px = W / 0.22 * 0.22; // player world x = scrollX + W*0.22
    const pWorldX = scrollX.current + W * 0.22;
    const pY = playerY.current;

    // Magnet
    if (magnetActive.current > 0) {
      coins.current.filter(c => !c.collected).forEach(c => {
        const dx = (pWorldX) - c.x;
        const dy = (pY) - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 180) { c.x += dx * 0.07; c.y += dy * 0.07; }
      });
    }

    // Coin collection
    coins.current.filter(c => !c.collected).forEach(c => {
      const dx = pWorldX - c.x;
      const dy = pY - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER_R + COIN_R + c.level * 2) {
        c.collected = true;
        score.current += MERGE_LEVELS[c.level].pts;
        setDisplayScore(score.current);
        inventory.current.push(c.level);
        if (inventory.current.length > 9) inventory.current.shift();
        addParticles(c.x - scrollX.current + sw.current * 0.22, c.y * (sh.current / H), MERGE_LEVELS[c.level].color, 8);
        tryMerge(c.level);
        setInv([...inventory.current]);
      }
    });

    // Bonus collection
    bonusItems.current.filter(b => !b.collected).forEach(b => {
      const dx = pWorldX - b.x;
      const dy = pY - b.y;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_R + 18) {
        b.collected = true;
        if (b.type === "magnet") magnetActive.current = 300;
        if (b.type === "shield") shieldActive.current = 180;
        if (b.type === "boost") boostActive.current = 180;
        addParticles(b.x - scrollX.current + sw.current * 0.22, b.y * (sh.current / H), BONUS_COLORS[b.type], 14);
      }
    });

    // Obstacle collision
    let dead = false;
    obstacles.current.forEach(ob => {
      const obScreenX = ob.x - scrollX.current;
      const px2 = W * 0.22;
      if (obScreenX < px2 + PLAYER_R + ob.w / 2 && obScreenX + ob.w > px2 - PLAYER_R) {
        if (ob.type === "spike" || ob.type === "wall") {
          const topY = gY - ob.h;
          if (pY + PLAYER_R > topY && pY - PLAYER_R < gY) {
            if (shieldActive.current > 0) {
              shieldActive.current = 0;
              shakeFrames.current = 8;
              addParticles(px2, pY * (sh.current / H), "#00cfff", 12);
            } else {
              dead = true;
            }
          }
        }
      }
    });

    // Pit check
    if (pitX.current !== null) {
      const pitScreenX = pitX.current - scrollX.current;
      const pw = 90;
      const px2 = W * 0.22;
      if (pitScreenX < px2 + PLAYER_R && pitScreenX + pw > px2 - PLAYER_R) {
        if (pY + PLAYER_R >= gY) {
          if (shieldActive.current > 0) {
            shieldActive.current = 0;
            pitX.current = null;
            shakeFrames.current = 8;
          } else { dead = true; }
        }
      }
      if (pitScreenX + pw < -100) pitX.current = null;
    }
    if (Math.random() < 0.002 && pitX.current === null) {
      pitX.current = scrollX.current + sw.current + 80;
    }

    if (dead) {
      shakeFrames.current = 15;
      addParticles(W * 0.22, playerY.current * (sh.current / H), "#ef4444", 20);
      gs.current = "DEAD";
      setGameState("DEAD");
      setDeathScore(score.current);
      const hs = Math.max(score.current, Number(localStorage.getItem("jmHS") || 0));
      localStorage.setItem("jmHS", String(hs));
      setHighScore(hs);
    }

    // Update particles
    particles.current = particles.current.filter(p => p.life > 0);
    particles.current.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.life--; });

    // Cleanup
    coins.current = coins.current.filter(c => c.x - scrollX.current > -100);
    obstacles.current = obstacles.current.filter(ob => ob.x - scrollX.current > -200);
    bonusItems.current = bonusItems.current.filter(b => !b.collected && b.x - scrollX.current > -100);

    void px;
    draw();
    rafRef.current = requestAnimationFrame(loop);
  }, [draw, spawnCoins, spawnBonus, spawnObstacle, addParticles, tryMerge]);

  // ── Input ──
  const pressJump = useCallback(() => {
    jumpPressed.current = true;
    if (gs.current === "IDLE" || gs.current === "DEAD") return;
    doJump();
  }, [doJump]);
  const releaseJump = useCallback(() => { jumpPressed.current = false; }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const onResize = () => {
      const { sw: w, sh: h } = scaleCanvas(canvas);
      sw.current = w; sh.current = h;
    };
    onResize();
    window.addEventListener("resize", onResize);

    const onDown = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); pressJump(); } };
    const onUp = (e: KeyboardEvent) => { if (e.code === "Space") releaseJump(); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [loop, pressJump, releaseJump]);

  const accentColor = boostActive.current > 0 ? "#fbbf24" : magnetActive.current > 0 ? "#ec4899" : "#00ff88";

  return (
    <div style={{
      width: "100dvw", height: "100dvh", background: "#030712",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Orbitron', monospace", userSelect: "none", overflow: "hidden", position: "relative",
    }}>
      {/* HUD top */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        padding: "12px 16px", pointerEvents: "none",
      }}>
        <div>
          <div style={{ fontSize: 9, color: "#ffffff33", letterSpacing: "0.25em" }}>СЧЁТ</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: accentColor, textShadow: `0 0 14px ${accentColor}`, lineHeight: 1, transition: "color 0.5s" }}>{displayScore}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "#ffffff33", letterSpacing: "0.25em" }}>РЕКОРД</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#ffffff55" }}>{highScore}</div>
        </div>
      </div>

      {/* Bonus timers */}
      <div style={{
        position: "absolute", top: 72, left: 16, zIndex: 20,
        display: "flex", gap: 8, pointerEvents: "none",
      }}>
        {bonuses.magnet > 0 && <BonusBar icon="🧲" color="#ec4899" val={bonuses.magnet} max={300} />}
        {bonuses.shield > 0 && <BonusBar icon="🛡️" color="#00cfff" val={bonuses.shield} max={180} />}
        {bonuses.boost > 0 && <BonusBar icon="⚡" color="#fbbf24" val={bonuses.boost} max={180} />}
      </div>

      {/* Inventory */}
      <div style={{
        position: "absolute", bottom: 90, left: 0, right: 0, zIndex: 20,
        display: "flex", justifyContent: "center", gap: 6, pointerEvents: "none",
      }}>
        {Array.from({ length: 9 }, (_, i) => {
          const lvl = inv[i];
          const cfg = lvl !== undefined ? MERGE_LEVELS[lvl] : null;
          return (
            <div key={i} style={{
              width: 32, height: 32, borderRadius: "50%",
              border: cfg ? `2px solid ${cfg.color}` : "1px solid #ffffff11",
              background: cfg ? `${cfg.color}22` : "#ffffff05",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: cfg ? `0 0 10px ${cfg.color}44` : "none",
              fontSize: 10, fontWeight: 700, color: cfg?.color || "transparent",
              transition: "all 0.2s ease",
            }}>
              {cfg ? cfg.label : ""}
            </div>
          );
        })}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", position: "absolute", inset: 0, touchAction: "none" }}
        onPointerDown={pressJump}
        onPointerUp={releaseJump}
      />

      {/* Overlay */}
      {(gameState === "IDLE" || gameState === "DEAD") && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 30,
          background: "rgba(3,7,18,0.82)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          {gameState === "DEAD" && (
            <>
              <div style={{ fontSize: 20, color: "#ef4444", fontWeight: 700, letterSpacing: "0.15em", textShadow: "0 0 20px #ef4444" }}>
                GAME OVER
              </div>
              <div style={{ fontSize: 52, fontWeight: 900, color: "#ffffff", lineHeight: 1 }}>{deathScore}</div>
              {deathScore >= highScore && deathScore > 0 && (
                <div style={{ fontSize: 11, color: "#fbbf24", letterSpacing: "0.25em", textShadow: "0 0 10px #fbbf24" }}>✦ НОВЫЙ РЕКОРД ✦</div>
              )}
            </>
          )}

          {gameState === "IDLE" && (
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#00ff88", textShadow: "0 0 20px #00ff88", letterSpacing: "0.15em" }}>
                JUMP &amp; MERGE
              </div>
              <div style={{ fontSize: 11, color: "#ffffff33", letterSpacing: "0.3em", marginTop: 6, fontFamily: "'Rajdhani', sans-serif" }}>
                COLOR DASH
              </div>
              <div style={{ marginTop: 24, fontSize: 11, color: "#ffffff44", letterSpacing: "0.1em", fontFamily: "'Rajdhani', sans-serif", lineHeight: 1.8 }}>
                Собирай 3 круга одного цвета — они сольются!<br />
                Перепрыгивай шипы и ямы.<br />
                Лови бонусы: 🧲 🛡️ ⚡
              </div>
            </div>
          )}

          <button
            onClick={startGame}
            style={{
              padding: "13px 40px", background: "transparent",
              border: "2px solid #00ff88", borderRadius: 4, color: "#00ff88",
              fontFamily: "'Orbitron', monospace", fontSize: 13, fontWeight: 700,
              letterSpacing: "0.2em", cursor: "pointer",
              textShadow: "0 0 10px #00ff88", boxShadow: "0 0 20px #00ff8833",
            }}
          >
            {gameState === "DEAD" ? "ЗАНОВО" : "ИГРАТЬ"}
          </button>
          <div style={{ fontSize: 9, color: "#ffffff1a", letterSpacing: "0.15em", fontFamily: "'Rajdhani', sans-serif" }}>
            ПРОБЕЛ · ТАП ПО ЭКРАНУ · УДЕРЖАНИЕ = ВЫСОКИЙ ПРЫЖОК
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
