import { useRef, useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toPng } from "html-to-image";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { AttentionEvent } from "@flint/domain";
import { buildAttentionAnalytics } from "@flint/domain";
import { formatDuration } from "@/shared/lib/formatDuration";
import { flowState, type FlowState } from "@/shared/lib/flowState";
import { saveCardImage } from "@/shared/api/attentionApi";

// Counts from current value to target (ease-out cubic). Resumes from last value on updates.
function useCountUp(target: number, duration = 0.85): number {
  const [display, setDisplay] = useState(0);
  const rafRef  = useRef<number>(0);
  const fromRef = useRef(0); // value at start of current animation

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const from  = fromRef.current;
    const start = performance.now();

    const tick = (now: number) => {
      const t      = Math.min((now - start) / (duration * 1000), 1);
      const eased  = 1 - Math.pow(1 - t, 3);
      const val    = Math.round(from + (target - from) * eased);
      fromRef.current = val;
      setDisplay(val);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

type BlockId = "morning" | "afternoon" | "evening" | "night";

const TIME_BLOCKS: { id: BlockId; label: string; startHour: number; endHour: number }[] = [
  { id: "morning",   label: "Morning",   startHour: 5,  endHour: 12 },
  { id: "afternoon", label: "Afternoon", startHour: 12, endHour: 17 },
  { id: "evening",   label: "Evening",   startHour: 17, endHour: 21 },
  { id: "night",     label: "Night",     startHour: 21, endHour: 29 },
];

interface BlockData {
  id: BlockId;
  label: string;
  timeRange: string;
  events: AttentionEvent[];
  score: number;
  minDataMet: boolean;
  focusSeconds: number;
  activeSeconds: number;
  dominantState: FlowState;
  topApps: { name: string; seconds: number }[];
}

interface LeafDef {
  id: number;
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotate: number;
}

interface GroundLeafItem {
  id: string;
  poolIdx: number;
  phase: "in" | "flying";
  color: string;
  delay: number; // stagger offset so each leaf lifts/lands at a slightly different time
}

const LEAVES: LeafDef[] = [
  { id: 0,  x: 88,  y: 118, rx: 9,  ry: 6,  rotate: -35 },
  { id: 1,  x: 72,  y: 105, rx: 8,  ry: 5,  rotate: -55 },
  { id: 2,  x: 95,  y: 100, rx: 10, ry: 6,  rotate: -20 },
  { id: 3,  x: 78,  y: 92,  rx: 7,  ry: 5,  rotate: -45 },
  { id: 4,  x: 65,  y: 118, rx: 8,  ry: 5,  rotate: -60 },
  { id: 5,  x: 102, y: 112, rx: 7,  ry: 4,  rotate: -15 },
  { id: 6,  x: 162, y: 118, rx: 9,  ry: 6,  rotate: 35  },
  { id: 7,  x: 178, y: 105, rx: 8,  ry: 5,  rotate: 55  },
  { id: 8,  x: 155, y: 100, rx: 10, ry: 6,  rotate: 20  },
  { id: 9,  x: 172, y: 92,  rx: 7,  ry: 5,  rotate: 45  },
  { id: 10, x: 185, y: 118, rx: 8,  ry: 5,  rotate: 60  },
  { id: 11, x: 148, y: 112, rx: 7,  ry: 4,  rotate: 15  },
  { id: 12, x: 118, y: 78,  rx: 10, ry: 7,  rotate: -10 },
  { id: 13, x: 132, y: 72,  rx: 9,  ry: 6,  rotate: 10  },
  { id: 14, x: 108, y: 65,  rx: 8,  ry: 5,  rotate: -25 },
  { id: 15, x: 142, y: 65,  rx: 8,  ry: 5,  rotate: 25  },
  { id: 16, x: 125, y: 58,  rx: 10, ry: 6,  rotate: 0   },
  { id: 17, x: 112, y: 50,  rx: 8,  ry: 5,  rotate: -15 },
  { id: 18, x: 138, y: 50,  rx: 8,  ry: 5,  rotate: 15  },
  { id: 19, x: 100, y: 130, rx: 7,  ry: 4,  rotate: -40 },
  { id: 20, x: 150, y: 130, rx: 7,  ry: 4,  rotate: 40  },
  { id: 21, x: 122, y: 88,  rx: 6,  ry: 4,  rotate: -5  },
  { id: 22, x: 105, y: 82,  rx: 6,  ry: 4,  rotate: -30 },
  { id: 23, x: 145, y: 82,  rx: 6,  ry: 4,  rotate: 30  },
];

// 16 ground positions spread wide (x: 22–242), clear of trunk zone (110–140)
const GROUND_LEAF_POOL = [
  { x: 22,  y: 193, rx: 6,   ry: 3,   rotate: -30 },
  { x: 38,  y: 196, rx: 5,   ry: 2.8, rotate: 20  },
  { x: 52,  y: 191, rx: 7,   ry: 3.2, rotate: 50  },
  { x: 66,  y: 194, rx: 6,   ry: 3,   rotate: -15 },
  { x: 78,  y: 197, rx: 5,   ry: 2.6, rotate: 35  },
  { x: 92,  y: 193, rx: 6,   ry: 3,   rotate: -40 },
  { x: 44,  y: 198, rx: 4.5, ry: 2.4, rotate: -55 },
  { x: 30,  y: 190, rx: 5,   ry: 3,   rotate: 45  },
  { x: 158, y: 193, rx: 6,   ry: 3,   rotate: -25 },
  { x: 172, y: 196, rx: 5,   ry: 2.8, rotate: 40  },
  { x: 186, y: 191, rx: 7,   ry: 3.2, rotate: -50 },
  { x: 200, y: 194, rx: 6,   ry: 3,   rotate: 15  },
  { x: 214, y: 197, rx: 5,   ry: 2.6, rotate: -35 },
  { x: 228, y: 193, rx: 6,   ry: 3,   rotate: 35  },
  { x: 216, y: 198, rx: 4.5, ry: 2.4, rotate: 55  },
  { x: 242, y: 190, rx: 5,   ry: 3,   rotate: -20 },
] as const;

const FLOW_STATE_LABEL: Record<FlowState, string> = {
  focused:    "focused",
  neutral:    "neutral",
  distracted: "distracted",
  break:      "Away",
};

function hourOf(iso: string): number {
  return new Date(iso).getHours();
}

function fmtTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function groupIntoBlocks(events: AttentionEvent[]): BlockData[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const result: BlockData[] = [];

  for (const block of TIME_BLOCKS) {
    const slice = sorted.filter((e) => {
      const h = hourOf(e.startedAt);
      if (block.id === "night") return h >= 21 || h < 5;
      return h >= block.startHour && h < block.endHour;
    });

    if (slice.length === 0) continue;

    const analytics = buildAttentionAnalytics(slice);
    const stateCounts: Record<FlowState, number> = { focused: 0, neutral: 0, distracted: 0, break: 0 };
    slice.forEach((e) => { stateCounts[flowState(e)] += e.durationSeconds; });
    const dominantState = (Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral") as FlowState;

    const appTotals = new Map<string, number>();
    slice.forEach((e) => {
      if (!e.isIdle) {
        const name = e.appName.includes(": ") ? e.appName.split(": ")[1] : e.appName;
        appTotals.set(name, (appTotals.get(name) ?? 0) + e.durationSeconds);
      }
    });
    const topApps = [...appTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, seconds]) => ({ name, seconds }));

    const timeRange = `${fmtTime(slice[0].startedAt)} – ${fmtTime(slice[slice.length - 1].endedAt)}`;

    result.push({
      id: block.id,
      label: block.label,
      timeRange,
      events: slice,
      score: analytics.focusScore,
      minDataMet: analytics.focusScoreBreakdown.minDataMet,
      focusSeconds: analytics.focusSeconds,
      activeSeconds: analytics.activeSeconds,
      dominantState,
      topApps,
    });
  }

  return result;
}

function leafColor(score: number, i: number): string {
  const alive = i < Math.round((score / 100) * LEAVES.length);
  if (!alive) return "transparent";
  if (score >= 75) return "#82B09A";
  if (score >= 55) return i % 3 === 0 ? "#CB9B26" : "#82B09A";
  if (score >= 35) {
    if (i % 3 === 0) return "#CB9B26";
    if (i % 3 === 1) return "#C06878";
    return "#C07030";
  }
  return i % 2 === 0 ? "#C06878" : "#CB9B26";
}

function treeDescription(score: number) {
  if (score >= 80) return "Thriving — deep roots, full canopy";
  if (score >= 60) return "Healthy — steady growth today";
  if (score >= 40) return "Weathered — focus came in waves";
  if (score >= 20) return "Strained — drift pulled at the roots";
  return "Dormant — rest and recover";
}

function WeatherIcon({ block, size = 36, animated = false }: { block: BlockId; size?: number; animated?: boolean }) {
  if (block === "morning") {
    return (
      <svg className="weather-icon" width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true" style={animated ? { animation: "sun-spin 12s linear infinite", transformOrigin: "center" } : {}}>
        <circle cx="18" cy="18" r="7" fill="#CB9B26" opacity="0.9" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 18 + 10 * Math.cos(rad);
          const y1 = 18 + 10 * Math.sin(rad);
          const x2 = 18 + 14 * Math.cos(rad);
          const y2 = 18 + 14 * Math.sin(rad);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#CB9B26" strokeWidth="2" strokeLinecap="round" />;
        })}
      </svg>
    );
  }

  if (block === "afternoon") {
    return (
      <svg className="weather-icon" width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <circle cx="18" cy="16" r="8" fill="#CB9B26" />
        {[0, 40, 80, 120, 160, 200, 240, 280, 320].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 18 + 11 * Math.cos(rad);
          const y1 = 16 + 11 * Math.sin(rad);
          const x2 = 18 + 15.5 * Math.cos(rad);
          const y2 = 16 + 15.5 * Math.sin(rad);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#CB9B26" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />;
        })}
        <ellipse cx="25" cy="26" rx="5" ry="3.2" fill="rgba(199,215,219,0.18)" />
        <ellipse cx="21.5" cy="27" rx="4" ry="2.6" fill="rgba(199,215,219,0.18)" />
        <ellipse cx="28" cy="27.5" rx="3.5" ry="2.2" fill="rgba(199,215,219,0.18)" />
      </svg>
    );
  }

  if (block === "evening") {
    return (
      <svg className="weather-icon" width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M 20 8 A 10 10 0 1 0 20 28 A 7 7 0 1 1 20 8 Z" fill="#7A97B0" opacity="0.9" />
        {animated && <>
          <circle className="star-twinkle" cx="29" cy="10" r="1.2" fill="#C7D7DB" />
          <circle className="star-twinkle" cx="27" cy="5"  r="0.9" fill="#C7D7DB" style={{ animationDelay: "0.4s" }} />
          <circle className="star-twinkle" cx="33" cy="16" r="0.8" fill="#C7D7DB" style={{ animationDelay: "0.8s" }} />
        </>}
      </svg>
    );
  }

  return (
    <svg className="weather-icon" width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M 18 6 A 11 11 0 1 0 18 30 A 8 8 0 1 1 18 6 Z" fill="#474A79" opacity="0.95" />
      {animated && <>
        <circle className="star-twinkle" cx="30" cy="8"  r="1.4" fill="#C7D7DB" />
        <circle className="star-twinkle" cx="6"  cy="12" r="1.0" fill="#C7D7DB" style={{ animationDelay: "0.5s" }} />
        <circle className="star-twinkle" cx="28" cy="22" r="0.9" fill="#C7D7DB" style={{ animationDelay: "1.0s" }} />
        <circle className="star-twinkle" cx="10" cy="27" r="1.1" fill="#C7D7DB" style={{ animationDelay: "0.3s" }} />
        <circle className="star-twinkle" cx="32" cy="30" r="0.8" fill="#C7D7DB" style={{ animationDelay: "1.4s" }} />
      </>}
    </svg>
  );
}

function FocusTree({
  score,
  activeBlock,
  resting,
}: {
  score: number;
  activeBlock: BlockId | null;
  resting: boolean;
}) {
  const aliveCount  = Math.round((score / 100) * LEAVES.length);
  const deadCount   = LEAVES.length - aliveCount;
  const targetCount = Math.min(
    Math.round((deadCount / LEAVES.length) * GROUND_LEAF_POOL.length),
    GROUND_LEAF_POOL.length,
  );

  const leafIdRef = useRef(0);
  const [groundLeaves, setGroundLeaves] = useState<GroundLeafItem[]>([]);

  // (Re)initialise ground leaves whenever the target count changes
  useEffect(() => {
    const usedSlots = new Set<number>();
    const initial: GroundLeafItem[] = [];
    for (let i = 0; i < targetCount; i++) {
      const free = Array.from({ length: GROUND_LEAF_POOL.length }, (_, j) => j).filter(j => !usedSlots.has(j));
      if (free.length === 0) break;
      const poolIdx = free[Math.floor(Math.random() * free.length)];
      usedSlots.add(poolIdx);
      initial.push({ id: `gl-${leafIdRef.current++}`, poolIdx, phase: "in", color: i % 2 === 0 ? "#CB9B26" : "#C06878", delay: i * 0.07 });
    }
    setGroundLeaves(initial);
  }, [targetCount]);

  // Every 10 s blow some leaves left, then drift new ones in from the right
  useEffect(() => {
    if (targetCount === 0) return;

    const tick = () => {
      // Lift all ground leaves with a short stagger so each feels wind-picked
      setGroundLeaves(prev => {
        if (prev.every(l => l.phase === "flying")) return prev;
        return prev.map((l, i) => ({ ...l, phase: "flying" as const, delay: i * 0.06 }));
      });

      // After all leaves have cleared, drift a fresh set in from the right
      setTimeout(() => {
        setGroundLeaves(() => {
          const usedSlots = new Set<number>();
          const additions: GroundLeafItem[] = [];
          for (let i = 0; i < targetCount; i++) {
            const free = Array.from({ length: GROUND_LEAF_POOL.length }, (_, j) => j)
              .filter(j => !usedSlots.has(j));
            if (free.length === 0) break;
            const poolIdx = free[Math.floor(Math.random() * free.length)];
            usedSlots.add(poolIdx);
            additions.push({ id: `gl-${leafIdRef.current++}`, poolIdx, phase: "in", color: i % 2 === 0 ? "#CB9B26" : "#C06878", delay: i * 0.07 });
          }
          return additions;
        });
      }, 2500);
    };

    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [targetCount]);

  return (
    <div className="focus-tree-container">
      <AnimatePresence mode="wait">
        {activeBlock && (
          <motion.div
            key={activeBlock}
            className="tree-weather-badge"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.3 }}
          >
            <WeatherIcon block={activeBlock} size={32} animated />
          </motion.div>
        )}
      </AnimatePresence>

      <svg aria-hidden="true" className="focus-tree-svg" viewBox="0 0 250 200">
        {/* Ground shadow */}
        <ellipse cx="125" cy="194" rx="52" ry="5" fill="rgba(0,0,0,0.2)" />

        {/* Ground leaves — blow left every 10 s, replacements drift in from the right */}
        {groundLeaves.map((gl) => {
          const pos    = GROUND_LEAF_POOL[gl.poolIdx];
          const flying = gl.phase === "flying";
          return (
            <motion.ellipse
              key={gl.id}
              cx={pos.x} cy={pos.y} rx={pos.rx} ry={pos.ry}
              fill={gl.color}
              style={{ transformOrigin: `${pos.x}px ${pos.y}px` }}
              // Exit: swept left by wind off-screen (visual x ≈ -30)
              // Enter: fall from canopy (SVG y ≈ 80) with slight drift from trunk centre (x ≈ 125)
              initial={{
                opacity: 0,
                y: -(pos.y - 80),
                x: (125 - pos.x) * 0.3,
                rotate: pos.rotate - (15 + (gl.poolIdx % 4) * 8),
              }}
              animate={flying
                ? {
                    opacity: 0,
                    x: -(pos.x + 30),
                    y: -(5 + (gl.poolIdx % 5) * 4),
                    rotate: pos.rotate - (14 + (gl.poolIdx % 5) * 8),
                  }
                : { opacity: 0.72, x: 0, y: 0, rotate: pos.rotate }
              }
              transition={flying
                ? {
                    duration: 0.75 + (gl.poolIdx % 4) * 0.08,
                    ease: [0.4, 0, 1, 1],
                    delay: gl.delay,
                  }
                : {
                    duration: 0.9 + (gl.poolIdx % 4) * 0.12,
                    ease: [0.34, 1.2, 0.64, 1],
                    delay: gl.delay,
                  }
              }
            />
          );
        })}

        {/* Trunk */}
        <path d="M 118 192 C 116 175, 114 160, 116 148 C 117 138, 119 128, 122 118 C 124 110, 125 100, 125 90"
          fill="none" stroke="#6B4C32" strokeWidth="7" strokeLinecap="round" />
        <path d="M 120 145 C 108 138, 98 128, 88 120"
          fill="none" stroke="#6B4C32" strokeWidth="4" strokeLinecap="round" />
        <path d="M 122 145 C 134 138, 144 128, 162 120"
          fill="none" stroke="#6B4C32" strokeWidth="4" strokeLinecap="round" />
        <path d="M 123 118 C 114 108, 106 96, 100 82"
          fill="none" stroke="#7A5A3A" strokeWidth="3" strokeLinecap="round" />
        <path d="M 124 115 C 133 105, 140 94, 148 82"
          fill="none" stroke="#7A5A3A" strokeWidth="3" strokeLinecap="round" />
        <path d="M 125 90 C 124 78, 124 65, 125 52"
          fill="none" stroke="#7A5A3A" strokeWidth="3" strokeLinecap="round" />

        {/* Tree leaves — only alive leaves are rendered; no mount/unmount animation */}
        {LEAVES.map((leaf, i) => {
          if (i >= aliveCount) return null;
          const color = leafColor(score, i);
          return (
            <motion.ellipse
              key={leaf.id}
              cx={leaf.x} cy={leaf.y} rx={leaf.rx} ry={leaf.ry}
              fill={color}
              initial={{ opacity: 1, y: 0, rotate: leaf.rotate }}
              animate={resting
                ? { y: [-2, 2, -2], opacity: 1, rotate: leaf.rotate }
                : { y: 0, opacity: 1, rotate: leaf.rotate }
              }
              transition={resting
                ? {
                    duration: 2.3 + (i % 3) * 0.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: (i % 5) * 0.18,
                    rotate: { duration: 0 },
                  }
                : {
                    duration: 0,
                    rotate: { duration: 0 },
                  }
              }
              style={{ transformOrigin: `${leaf.x}px ${leaf.y}px` }}
            />
          );
        })}
      </svg>
    </div>
  );
}

function BlockCardSmall({
  block,
  active,
  onClick,
}: {
  block: BlockData;
  active: boolean;
  onClick: () => void;
}) {
  const animatedScore = useCountUp(block.score, 0.65);
  const [hovered, setHovered] = useState(false);

  return (
    <button
      className={`block-card-small block-card-${block.id} ${active ? "block-card-active" : ""} ${hovered ? "block-card-small-hovered" : ""}`}
      onClick={onClick}
      type="button"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <span className="block-card-label">{block.label}</span>
      <span className="block-card-score">{block.minDataMet ? animatedScore : "—"}</span>
    </button>
  );
}

function BlockCardExpanded({
  block,
  onBack,
}: {
  block: BlockData;
  onBack: () => void;
}) {
  const animatedScore = useCountUp(block.score, 0.9);

  return (
    <motion.div
      className={`block-card-expanded block-card-expanded-${block.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Header: back → [weather + label + time range] … [state pill] */}
      <div className="expanded-card-header">
        <button className="expanded-back-btn" onClick={onBack} type="button" aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M 10 3 L 5 8 L 10 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="expanded-title-row">
          <div className="expanded-card-title">
            <WeatherIcon block={block.id} size={24} />
            <div>
              <strong>{block.label}</strong>
              <span>{block.timeRange}</span>
            </div>
          </div>
          <div className={`expanded-state-pill expanded-state-${block.dominantState}`}>
            {FLOW_STATE_LABEL[block.dominantState]}
          </div>
        </div>
      </div>

      <div className="expanded-card-score-row">
        <div className="expanded-score-val">
          {block.minDataMet ? (
            <>
              <strong>{animatedScore}</strong>
              <span>/100</span>
            </>
          ) : (
            <strong className="expanded-score-low-data">—</strong>
          )}
        </div>
        <div className="expanded-score-meta">
          <span>Focus {formatDuration(block.focusSeconds)}</span>
          <span>Active {formatDuration(block.activeSeconds)}</span>
        </div>
      </div>

      {block.topApps.length > 0 && (
        <div className="expanded-apps">
          <p className="expanded-apps-label">Top activity</p>
          {block.topApps.map((app, i) => (
            <div className="expanded-app-row" key={app.name}>
              <span className="expanded-app-rank">{i + 1}</span>
              <span className="expanded-app-name">{app.name}</span>
              <span className="expanded-app-dur">{formatDuration(app.seconds)}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

interface DayReplayModalProps {
  events: AttentionEvent[];
  onClose: () => void;
}

export function DayReplayModal({ events, onClose }: DayReplayModalProps) {
  const cardRef  = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const blocks        = useMemo(() => groupIntoBlocks(events), [events]);
  const finalAnalytics = useMemo(() => buildAttentionAnalytics(events), [events]);

  // Derive the card date from the events so it always shows the correct local date
  // for the data being displayed, regardless of when the component renders.
  const cardDate = useMemo(
    () => events.length > 0 ? new Date(events[0].startedAt) : new Date(),
    [events],
  );

  const [autoIndex,    setAutoIndex]    = useState(-1);
  const [expandedId,   setExpandedId]   = useState<BlockId | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [savedFlash,   setSavedFlash]   = useState(false);

  const isIntro = autoIndex === -1;
  const isDone  = autoIndex >= blocks.length;
  const activeBlock  = !isDone && !isIntro ? blocks[autoIndex] ?? null : null;
  const activeBlockId = expandedId ?? activeBlock?.id ?? (isDone && blocks.length > 0 ? blocks[blocks.length - 1].id : null);

  const { displayScore, displayMinDataMet } = useMemo(() => {
    if (isDone) return { displayScore: finalAnalytics.focusScore, displayMinDataMet: finalAnalytics.focusScoreBreakdown.minDataMet };
    if (isIntro) return { displayScore: 0, displayMinDataMet: false };
    const upTo = blocks.slice(0, autoIndex + 1).flatMap((b) => b.events);
    const a = buildAttentionAnalytics(upTo);
    return { displayScore: a.focusScore, displayMinDataMet: a.focusScoreBreakdown.minDataMet };
  }, [autoIndex, blocks, isDone, isIntro, finalAnalytics]);

  const countedScore = useCountUp(displayScore, 0.85);

  // Auto-advance through blocks
  useEffect(() => {
    if (expandedId !== null) return;
    if (isDone) return;
    const delay = isIntro ? 800 : 2600;
    const id = setTimeout(() => setAutoIndex((i) => i + 1), delay);
    return () => clearTimeout(id);
  }, [autoIndex, isDone, isIntro, expandedId]);

  // Temporarily freeze leaf sway during card expand/collapse so the animation
  // budget is fully available for the transition (24 infinite SVG animations
  // compete for the same compositor budget on WebKit).
  const beginTransition = (fn: () => void) => {
    clearTimeout(timerRef.current);
    setTransitioning(true);
    fn();
    timerRef.current = setTimeout(() => setTransitioning(false), 320);
  };

  const handleExpand  = (id: BlockId) => beginTransition(() => setExpandedId(id));
  const handleCollapse = ()            => beginTransition(() => setExpandedId(null));

  const handleSave = async () => {
    if (!cardRef.current || isSaving) return;
    setIsSaving(true);
    try {
      const defaultName = `flint-focus-${new Date().toISOString().slice(0, 10)}.png`;
      const path = await saveDialog({
        title: "Save focus card",
        defaultPath: defaultName,
        filters: [{ name: "PNG image", extensions: ["png"] }],
      });
      if (!path) return; // user cancelled
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2 });
      await saveCardImage(path, dataUrl);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch { /* silent */ } finally {
      setIsSaving(false);
    }
  };

  const expandedBlock = blocks.find((b) => b.id === expandedId) ?? null;
  // Sway only when done, not expanded, and not mid-transition
  const leafResting = isDone && expandedId === null && !transitioning;

  return (
    <motion.div
      className="day-replay-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="day-replay-shell"
        layout
        initial={{ scale: 0.88, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 16 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
      >
        {/* Exportable card */}
        <motion.div
          className="day-replay-card"
          ref={cardRef}
          layout
          transition={{ layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
        >

          <div className="replay-card-header">
            <div className="replay-card-header-left">
              <div className="replay-card-brand">Flint</div>
              <motion.span
                className="replay-tree-desc"
                animate={{ opacity: isDone && !expandedId && finalAnalytics.focusScoreBreakdown.minDataMet ? 0.75 : 0 }}
                transition={{ duration: 0.3 }}
              >
                {treeDescription(finalAnalytics.focusScore)}
              </motion.span>
            </div>
            <div className="replay-card-date">
              {new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(cardDate)}
            </div>
          </div>

          <div className="replay-card-main">
            <FocusTree score={finalAnalytics.focusScore} activeBlock={activeBlockId} resting={leafResting} />

            <motion.div className="replay-card-score" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              {displayMinDataMet ? (
                <>
                  <strong>{countedScore}</strong>
                  <span>/100</span>
                </>
              ) : (
                <strong>—</strong>
              )}
            </motion.div>
          </div>

          <motion.div className="block-cards-area" layout transition={{ layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}>
            <AnimatePresence mode="wait">
              {expandedBlock ? (
                <BlockCardExpanded
                  key="expanded"
                  block={expandedBlock}
                  onBack={handleCollapse}
                />
              ) : (
                <motion.div
                  key="grid"
                  className="block-cards-row"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                >
                  {blocks.map((block, i) => (
                    <motion.div
                      key={block.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.22 }}
                    >
                      <BlockCardSmall
                        block={block}
                        active={autoIndex === i || (isDone && expandedId === null)}
                        onClick={() => handleExpand(block.id)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

        </motion.div>

        {/* Controls */}
        <div className="replay-modal-controls">
          <button
            className={`replay-save-btn ${savedFlash ? "replay-save-flash" : ""}`}
            disabled={!isDone || isSaving}
            onClick={handleSave}
            type="button"
          >
            {savedFlash ? "Saved!" : isSaving ? "Saving…" : "Save card"}
          </button>
          <button className="replay-close-btn" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
