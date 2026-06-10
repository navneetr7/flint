import { MdOutlineTipsAndUpdates } from "react-icons/md";
import {
  getHomeAttentionNarratives,
  type HomeAttentionSection,
} from "@/shared/api/attentionApi";
import { formatDuration } from "@/shared/lib/formatDuration";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import { useAppStore } from "@/shared/store/appStore";

export function HomeView() {
  const attentionRevision = useAppStore((state) => state.attentionRevision);

  const { data, error, isLoading } = useAsyncData(
    () => getHomeAttentionNarratives(),
    [attentionRevision],
  );

  return (
    <div className="view-stack">
      <header className="view-header">
        <h1>Yesterday <span className="view-header-date">{yesterdayLabel()}</span></h1>
        <p>A look at how your attention moved — and one thing worth adjusting today.</p>
      </header>

      {isLoading ? <p className="muted-status">Analysing attention trail…</p> : null}
      {error ? <p className="error-status">{error}</p> : null}

      {data ? <YesterdayCard section={data.previousDay} /> : null}
    </div>
  );
}

function YesterdayCard({ section }: { section: HomeAttentionSection }) {
  const hasActivity = section.focusSeconds + section.driftSeconds + section.learningSeconds > 0;

  if (!hasActivity) {
    return (
      <div className="yd-card yd-card-empty">
        <p>No attention data recorded for yesterday.</p>
      </div>
    );
  }

  const hasDrift = section.driftSeconds > 0;
  const hasWasOff = section.whatWasOff.length > 0;
  const hasWasters = section.timeWasters.length > 0;
  const hasDistractions = section.mainDistractions.length > 0;

  return (
    <div className="yd-card">
      {/* Summary */}
      <p className="yd-summary">{section.summary}</p>

      {/* Stats */}
      <div className="yd-stats">
        <StatPill label="Focus" value={formatDuration(section.focusSeconds + section.learningSeconds)} tone="focus" />
        <StatPill label="Distracted" value={hasDrift ? formatDuration(section.driftSeconds) : "None"} tone="drift" dimmed={!hasDrift} />
        <StatPill label="Away" value={section.idleSeconds > 0 ? formatDuration(section.idleSeconds) : "—"} tone="idle" />
        {section.longestFocusSeconds >= 600 && (
          <StatPill
            label={section.longestFocusSeconds >= 900 ? "Deep Focus" : "Longest Focus"}
            value={formatDuration(section.longestFocusSeconds)}
            tone="deep"
          />
        )}
      </div>

      {/* What pulled you */}
      {hasWasOff && (
        <div className="yd-section">
          <span className="yd-section-label">What pulled you away</span>
          <p className="yd-section-body">{section.whatWasOff}</p>
        </div>
      )}

      {/* Time drains */}
      {hasWasters && (
        <div className="yd-section">
          <span className="yd-section-label">Time drains</span>
          <div className="yd-chips">
            {section.timeWasters.map((app) => (
              <span key={app} className="yd-chip yd-chip-drain">{app}</span>
            ))}
          </div>
        </div>
      )}

      {/* Main distractions */}
      {hasDistractions && (
        <div className="yd-section">
          <span className="yd-section-label">Main distractions</span>
          <div className="yd-chips">
            {section.mainDistractions.map((app) => (
              <span key={app} className="yd-chip yd-chip-distraction">{app}</span>
            ))}
          </div>
        </div>
      )}

      {/* Tip */}
      {section.tip && (
        <div className="yd-tip">
          <MdOutlineTipsAndUpdates className="yd-tip-icon" />
          <p>{section.tip}</p>
        </div>
      )}

      {section.error && (
        <p className="yd-error">{section.error}</p>
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
  dimmed = false,
}: {
  label: string;
  value: string;
  tone: "focus" | "drift" | "idle" | "deep";
  dimmed?: boolean;
}) {
  return (
    <div className={`yd-stat yd-stat-${tone}${dimmed ? " yd-stat-dimmed" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function yesterdayLabel(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
