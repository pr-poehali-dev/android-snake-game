import { useEffect, useRef, useState, useCallback } from "react";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const GRID_SIZE = 20;
const INITIAL_SPEED = 200;

type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
type Point = { x: number; y: number };
type GameState = "IDLE" | "PLAYING" | "DEAD";

const LEVEL_CONFIG = [
  { level: 1, speed: 200, pointsToNext: 50,  color: "#00ff88" },
  { level: 2, speed: 170, pointsToNext: 120, color: "#00ffff" },
  { level: 3, speed: 145, pointsToNext: 220, color: "#a855f7" },
  { level: 4, speed: 120, pointsToNext: 350, color: "#f97316" },
  { level: 5, speed: 95,  pointsToNext: 520, color: "#ec4899" },
  { level: 6, speed: 75,  pointsToNext: 740, color: "#ef4444" },
  { level: 7, speed: 55,  pointsToNext: 999999, color: "#ffffff" },
];

function getLevelConfig(score: number) {
  for (let i = LEVEL_CONFIG.length - 1; i >= 0; i--) {
    if (i === 0 || score >= LEVEL_CONFIG[i - 1].pointsToNext) {
      return LEVEL_CONFIG[i];
    }
  }
  return LEVEL_CONFIG[0];
}

function randomFood(snake: Point[]): Point {
  let pos: Point;
  do {
    pos = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
  } while (snake.some((s) => s.x === pos.x && s.y === pos.y));
  return pos;
}

function DPadBtn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        width: 54, height: 54,
        background: `${color}11`,
        border: `1px solid ${color}44`,
        borderRadius: 8,
        color,
        fontSize: 20,
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        touchAction: "none",
        transition: "background 0.1s ease",
        WebkitTapHighlightColor: "transparent",
        outline: "none",
      }}
    >
      {children}
    </button>
  );
}

export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState>("IDLE");
  const snakeRef = useRef<Point[]>([{ x: 10, y: 10 }]);
  const dirRef = useRef<Direction>("RIGHT");
  const nextDirRef = useRef<Direction>("RIGHT");
  const foodRef = useRef<Point>({ x: 5, y: 5 });
  const scoreRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number>(0);
  const glowT = useRef(0);
  const cellSize = useRef(20);
  const levelCfgRef = useRef(LEVEL_CONFIG[0]);

  const [displayScore, setDisplayScore] = useState(0);
  const [gameState, setGameState] = useState<GameState>("IDLE");
  const [levelConfig, setLevelConfig] = useState(LEVEL_CONFIG[0]);
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem("neonSnakeHS") || 0));

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cont = canvas.parentElement!;
    const size = Math.min(cont.clientWidth, cont.clientHeight, 440);
    canvas.width = size;
    canvas.height = size;
    cellSize.current = size / GRID_SIZE;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const cs = cellSize.current;
    const sz = canvas.width;
    glowT.current += 0.06;

    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, sz, sz);

    // Grid
    ctx.strokeStyle = "rgba(0,255,136,0.05)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= GRID_SIZE; i++) {
      ctx.beginPath(); ctx.moveTo(i * cs, 0); ctx.lineTo(i * cs, sz); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cs); ctx.lineTo(sz, i * cs); ctx.stroke();
    }

    const cfg = levelCfgRef.current;
    const nc = cfg.color;

    // Food
    const food = foodRef.current;
    const pulse = 0.65 + 0.35 * Math.sin(glowT.current * 2.5);
    const fx = food.x * cs + cs / 2;
    const fy = food.y * cs + cs / 2;
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, cs * 0.8);
    fg.addColorStop(0, "#ffffff");
    fg.addColorStop(0.25, "#ff00ff");
    fg.addColorStop(1, "rgba(255,0,255,0)");
    ctx.shadowColor = "#ff00ff";
    ctx.shadowBlur = 22 * pulse;
    ctx.beginPath();
    ctx.arc(fx, fy, cs * 0.36 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Snake
    const snake = snakeRef.current;
    const pad = 1.5;
    snake.forEach((seg, i) => {
      const sx = seg.x * cs;
      const sy = seg.y * cs;
      const alpha = 1 - (i / snake.length) * 0.45;
      if (i === 0) {
        ctx.shadowColor = nc;
        ctx.shadowBlur = 20;
        const g = ctx.createLinearGradient(sx, sy, sx + cs, sy + cs);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, nc);
        ctx.fillStyle = g;
        roundRect(ctx, sx + pad, sy + pad, cs - pad * 2, cs - pad * 2, 4);
        ctx.fill();
        ctx.shadowBlur = 0;
        // eyes
        ctx.fillStyle = "#030712";
        const es = cs * 0.11;
        const d = dirRef.current;
        if (d === "RIGHT" || d === "LEFT") {
          const ex = d === "RIGHT" ? sx + cs * 0.72 : sx + cs * 0.22;
          ctx.beginPath(); ctx.arc(ex, sy + cs * 0.28, es, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex, sy + cs * 0.72, es, 0, Math.PI * 2); ctx.fill();
        } else {
          const ey = d === "DOWN" ? sy + cs * 0.72 : sy + cs * 0.22;
          ctx.beginPath(); ctx.arc(sx + cs * 0.28, ey, es, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(sx + cs * 0.72, ey, es, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        ctx.shadowColor = nc;
        ctx.shadowBlur = 9;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = nc;
        roundRect(ctx, sx + pad, sy + pad, cs - pad * 2, cs - pad * 2, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
    });

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const stopAll = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    cancelAnimationFrame(rafRef.current);
  }, []);

  const startLoop = useCallback((speed: number) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (gameStateRef.current !== "PLAYING") return;
      const snake = snakeRef.current;
      dirRef.current = nextDirRef.current;
      const head = snake[0];
      const d = dirRef.current;
      const nh: Point = {
        x: head.x + (d === "RIGHT" ? 1 : d === "LEFT" ? -1 : 0),
        y: head.y + (d === "DOWN" ? 1 : d === "UP" ? -1 : 0),
      };
      if (nh.x < 0 || nh.x >= GRID_SIZE || nh.y < 0 || nh.y >= GRID_SIZE || snake.some(s => s.x === nh.x && s.y === nh.y)) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        gameStateRef.current = "DEAD";
        setGameState("DEAD");
        const hs = Math.max(scoreRef.current, Number(localStorage.getItem("neonSnakeHS") || 0));
        localStorage.setItem("neonSnakeHS", String(hs));
        setHighScore(hs);
        return;
      }
      const ate = foodRef.current.x === nh.x && foodRef.current.y === nh.y;
      const ns = [nh, ...snake];
      if (!ate) ns.pop();
      snakeRef.current = ns;
      if (ate) {
        const newScore = scoreRef.current + 10;
        scoreRef.current = newScore;
        foodRef.current = randomFood(ns);
        const newCfg = getLevelConfig(newScore);
        levelCfgRef.current = newCfg;
        setDisplayScore(newScore);
        setLevelConfig(newCfg);
        startLoop(newCfg.speed);
      }
    }, speed);
  }, []);

  const startGame = useCallback(() => {
    const init = [{ x: 10, y: 10 }];
    snakeRef.current = init;
    dirRef.current = "RIGHT";
    nextDirRef.current = "RIGHT";
    foodRef.current = randomFood(init);
    scoreRef.current = 0;
    levelCfgRef.current = LEVEL_CONFIG[0];
    setDisplayScore(0);
    setLevelConfig(LEVEL_CONFIG[0]);
    gameStateRef.current = "PLAYING";
    setGameState("PLAYING");
    startLoop(INITIAL_SPEED);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, startLoop]);

  const move = useCallback((d: Direction) => {
    const cur = dirRef.current;
    if (
      (d === "UP" && cur !== "DOWN") || (d === "DOWN" && cur !== "UP") ||
      (d === "LEFT" && cur !== "RIGHT") || (d === "RIGHT" && cur !== "LEFT")
    ) nextDirRef.current = d;
  }, []);

  useEffect(() => {
    resizeCanvas();
    rafRef.current = requestAnimationFrame(draw);
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT", w: "UP", s: "DOWN", a: "LEFT", d: "RIGHT" };
      const dir = map[e.key];
      if (dir) { e.preventDefault(); move(dir); }
      if (e.key === " ") { e.preventDefault(); if (gameStateRef.current !== "PLAYING") startGame(); }
    };
    const onResize = () => resizeCanvas();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => { stopAll(); window.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize); };
  }, [draw, move, resizeCanvas, startGame, stopAll]);

  const cfg = levelConfig;

  return (
    <div style={{
      minHeight: "100dvh", background: "#030712",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Orbitron', monospace", userSelect: "none", overflow: "hidden", position: "relative",
      padding: "12px 8px",
    }}>
      {/* ambient glow */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", transition: "background 1.2s ease",
        background: `radial-gradient(ellipse at 50% 40%, ${cfg.color}0d 0%, transparent 65%)` }} />

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 10, zIndex: 10 }}>
        <div style={{ fontSize: "clamp(20px, 6vw, 34px)", fontWeight: 900, letterSpacing: "0.22em",
          color: cfg.color, textShadow: `0 0 18px ${cfg.color}, 0 0 40px ${cfg.color}66`,
          transition: "color 1.2s ease, text-shadow 1.2s ease", lineHeight: 1 }}>
          NEON SNAKE
        </div>
        <div style={{ fontSize: "clamp(9px, 2vw, 11px)", color: "#ffffff33", letterSpacing: "0.3em",
          marginTop: 5, fontFamily: "'Rajdhani', sans-serif", fontWeight: 300 }}>
          УРОВЕНЬ {cfg.level} · {cfg.speed}ms/ход
        </div>
      </div>

      {/* Score bar */}
      <div style={{ display: "flex", gap: 20, marginBottom: 10, zIndex: 10,
        padding: "7px 20px", border: `1px solid ${cfg.color}2a`, borderRadius: 6,
        background: `${cfg.color}07`, transition: "border-color 1.2s ease" }}>
        {[["СЧЁТ", String(displayScore), cfg.color], ["РЕКОРД", String(highScore), "#ffffff66"]].map(([label, val, color]) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "#ffffff33", letterSpacing: "0.2em", fontFamily: "'Rajdhani', sans-serif" }}>{label}</div>
            <div style={{ fontSize: "clamp(20px, 5vw, 26px)", fontWeight: 700, color, textShadow: label === "СЧЁТ" ? `0 0 10px ${cfg.color}` : "none", transition: "color 1.2s ease" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div style={{ position: "relative", zIndex: 10, border: `2px solid ${cfg.color}44`, borderRadius: 4,
        boxShadow: `0 0 28px ${cfg.color}2a, inset 0 0 24px #00000055`, transition: "border-color 1.2s ease, box-shadow 1.2s ease", lineHeight: 0 }}
        onTouchStart={(e) => { touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          if (!touchStartRef.current) return;
          const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
          const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
          touchStartRef.current = null;
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { if (gameStateRef.current !== "PLAYING") startGame(); return; }
          if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "RIGHT" : "LEFT");
          else move(dy > 0 ? "DOWN" : "UP");
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block", borderRadius: 2 }} />

        {/* Overlay */}
        {(gameState === "IDLE" || gameState === "DEAD") && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(3,7,18,0.88)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 14, borderRadius: 2 }}>
            {gameState === "DEAD" && (
              <>
                <div style={{ fontSize: "clamp(14px, 4vw, 20px)", color: "#ef4444", fontWeight: 700,
                  letterSpacing: "0.15em", textShadow: "0 0 18px #ef4444" }}>
                  ИГРА ОКОНЧЕНА
                </div>
                <div style={{ fontSize: "clamp(32px, 9vw, 52px)", color: "#ffffff", fontWeight: 900, lineHeight: 1 }}>
                  {displayScore}
                </div>
                {displayScore > 0 && displayScore >= highScore && (
                  <div style={{ fontSize: 10, color: "#fbbf24", letterSpacing: "0.25em",
                    fontFamily: "'Rajdhani', sans-serif", textShadow: "0 0 10px #fbbf24" }}>
                    ✦ НОВЫЙ РЕКОРД ✦
                  </div>
                )}
              </>
            )}
            <button onClick={startGame} style={{
              marginTop: gameState === "IDLE" ? 0 : 4,
              padding: "11px 30px", background: "transparent",
              border: `2px solid ${cfg.color}`, borderRadius: 4, color: cfg.color,
              fontFamily: "'Orbitron', monospace", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.22em", cursor: "pointer",
              textShadow: `0 0 10px ${cfg.color}`, boxShadow: `0 0 18px ${cfg.color}33`,
            }}>
              {gameState === "DEAD" ? "ЗАНОВО" : "СТАРТ"}
            </button>
            <div style={{ fontSize: 9, color: "#ffffff1a", letterSpacing: "0.15em",
              fontFamily: "'Rajdhani', sans-serif", textAlign: "center" }}>
              WASD · СТРЕЛКИ · СВАЙП
            </div>
          </div>
        )}
      </div>

      {/* Level progress */}
      <div style={{ marginTop: 10, zIndex: 10, width: "min(440px, calc(100vw - 16px))" }}>
        {cfg.level < 7 ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#ffffff2a", letterSpacing: "0.2em", fontFamily: "'Rajdhani', sans-serif" }}>УР. {cfg.level}</span>
              <span style={{ fontSize: 9, color: "#ffffff2a", letterSpacing: "0.15em", fontFamily: "'Rajdhani', sans-serif" }}>{displayScore} / {cfg.pointsToNext}</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: "#ffffff0a", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 2, transition: "width 0.4s ease, background 1.2s ease",
                width: `${Math.min(100, (displayScore / cfg.pointsToNext) * 100)}%`,
                background: cfg.color, boxShadow: `0 0 8px ${cfg.color}` }} />
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", fontSize: 10, color: cfg.color, letterSpacing: "0.3em",
            textShadow: `0 0 10px ${cfg.color}`, fontFamily: "'Rajdhani', sans-serif" }}>
            ∞ МАКСИМАЛЬНЫЙ УРОВЕНЬ ∞
          </div>
        )}
      </div>

      {/* D-Pad */}
      <div style={{ marginTop: 16, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
          <DPadBtn color={cfg.color} onClick={() => move("UP")}>▲</DPadBtn>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <DPadBtn color={cfg.color} onClick={() => move("LEFT")}>◀</DPadBtn>
          <DPadBtn color={cfg.color} onClick={() => move("DOWN")}>▼</DPadBtn>
          <DPadBtn color={cfg.color} onClick={() => move("RIGHT")}>▶</DPadBtn>
        </div>
      </div>
    </div>
  );
}