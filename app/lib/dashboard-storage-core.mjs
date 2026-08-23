export function dashboardSnapshotKey(schemaVersion) {
  if (schemaVersion === 1) return "latest";
  if (schemaVersion === 2) return "latest-v2";
  if (schemaVersion === 3) return "latest-v3";
  throw new Error("Unsupported dashboard snapshot version.");
}

export function dashboardSnapshotReadKeys() {
  return ["latest-v3", "latest-v2", "latest"];
}
