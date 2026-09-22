"use client";

import { useEffect, useState } from "react";
import styles from "./ActionCockpit.module.css";

type Announcement = { title: string; url: string; retrieved_at: string };

export function EvidenceReviewForm() {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [record, setRecord] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/evidence/queue", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Evidence queue is unavailable.");
      const payload = await response.json() as { announcements?: Announcement[] };
      const items = Array.isArray(payload.announcements) ? payload.announcements : [];
      setQueue(items);
      setSelectedUrl(items[0]?.url ?? "");
    }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Evidence queue is unavailable."));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    try {
      const raw = JSON.parse(record);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Reviewed evidence must be a JSON object.");
      const response = await fetch("/api/evidence/records", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...raw, ...(selectedUrl ? { sourceUrl: selectedUrl } : {}) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Evidence could not be saved.");
      setStatus("Evidence revision saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Evidence could not be saved."); }
  }

  return <form className={styles.evidenceForm} onSubmit={submit}>
    <label>Queued primary source<select aria-label="Queued primary source" value={selectedUrl} onChange={(event) => setSelectedUrl(event.target.value)}>
      <option value="">Enter an allowlisted issuer URL in the record</option>
      {queue.map((item) => <option key={item.url} value={item.url}>{item.title}</option>)}
    </select></label>
    <label>Reviewed evidence JSON<textarea aria-label="Reviewed evidence JSON" value={record} onChange={(event) => setRecord(event.target.value)} placeholder='{"symbol":"1150", "sectorKind":"bank", ...}' required /></label>
    <button className={styles.researchButton} type="submit">Save reviewed evidence</button>
    {status && <p className={styles.quiet} role="status">{status}</p>}
  </form>;
}
