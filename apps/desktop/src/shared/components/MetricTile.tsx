type MetricTileProps = {
  label: string;
  value: string;
  tone?: "focus" | "drift" | "recovery";
};

export function MetricTile({ label, value, tone = "focus" }: MetricTileProps) {
  return (
    <div className={`metric-tile metric-tile-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
