export default function LiveBadge({ camera }) {
  if (!camera) return null;
  const age = camera.updated_at ? Math.max(0, Math.round((Date.now() - Date.parse(camera.updated_at)) / 1000)) : null;
  const live = age !== null && age < 15;
  return (
    <div className="live-badge" title={camera.label}>
      <i className={live ? "pulse" : "pulse off"} />
      {live ? "Camera live" : "Camera idle"}
      {age !== null && <span> · {age}s ago</span>}
      {camera.timing?.total_ms && <span> · {Math.round(camera.timing.total_ms)} ms/frame</span>}
    </div>
  );
}
