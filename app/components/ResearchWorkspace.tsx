"use client";

import { useEffect, useMemo, useState } from "react";
import type { Candidate } from "@/app/lib/dashboard-types";
import styles from "./ResearchWorkspace.module.css";

type Citation = { title: string; url: string };
type Section = { title: string; body: string; provenance: "deterministic" | "research"; citations: Citation[] };
type Report = { verdict: "RESEARCH" | "WAIT" | "SKIP"; generatedAt: string; dataStatus: string; sections: Section[] };
type Message = { id: string; role: "assistant" | "user"; text: string; citations?: Citation[] };

function initialSections(candidate: Candidate): Section[] {
  const setup = `Relative strength is +${candidate.relativeStrengthPct.toFixed(1)}%. ${candidate.squeeze ? "Squeeze confirmation is present." : "No squeeze confirmation is present."} Delayed/daily data — verify your broker quote.`;
  return [
    { title: "Company & News", body: "Gathering official disclosures and reputable news…", provenance: "research", citations: [] },
    { title: "Technical Setup", body: setup, provenance: "deterministic", citations: [] },
    { title: "Risks", body: "Checking cited risks and missing evidence…", provenance: "research", citations: [] },
    { title: "Entry Plan", body: "Use the existing scanner rules and verify the live broker price before acting. Delayed/daily data — verify your broker quote.", provenance: "deterministic", citations: [] },
  ];
}

export function ResearchWorkspace({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [language, setLanguage] = useState<"English" | "Arabic">("English");
  const [messages, setMessages] = useState<Message[]>([]);
  const [asking, setAsking] = useState(false);
  const sections = report?.sections ?? initialSections(candidate);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/research/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: candidate.code }),
          signal: controller.signal,
        });
        const payload = await response.json() as { report?: Report; error?: string };
        if (!response.ok || !payload.report) throw new Error(payload.error ?? "Research is unavailable.");
        setReport(payload.report);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Research is unavailable.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [candidate.code]);

  const verdict = report?.verdict ?? "WAIT";
  const budgetNote = useMemo(() => "AI budget: 50 SAR/month · new work stops at 45 SAR.", []);

  async function askQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking || !report) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", text };
    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setAsking(true);
    try {
      const response = await fetch("/api/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: candidate.code, text, language, manualPrice: manualPrice ? Number(manualPrice) : undefined }),
      });
      const payload = await response.json() as Message & { error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error ?? "The agent could not answer right now.");
      setMessages((current) => [...current, payload]);
    } catch (reason) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: reason instanceof Error ? reason.message : "The agent could not answer right now." }]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className={styles.workspace} aria-label={`Research workspace for ${candidate.name}`}>
      <header className={styles.header}>
        <div>
          <button className={styles.back} onClick={onClose} type="button">← Back to cockpit</button>
          <p className={styles.code}>{candidate.code}</p>
          <h2>{candidate.name}</h2>
          <p className={styles.warning}>Delayed/daily data. Verify every live price with your broker.</p>
        </div>
        <div className={styles.verdict} data-verdict={verdict}>
          <span>Agent view</span>
          <strong>{verdict}</strong>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.report}>
          <p className={styles.budget}>{budgetNote}</p>
          {loading && <p className={styles.loading}>Research is gathering cited sources. Technical setup and entry plan are already available below.</p>}
          {error && <p className={styles.error}>{error} The deterministic sections remain available; try again after the private agent is configured.</p>}
          <div className={styles.sections}>
            {sections.map((section) => (
              <article className={styles.section} key={section.title} data-provenance={section.provenance}>
                <div className={styles.sectionTopline}><h3>{section.title}</h3><span>{section.provenance === "deterministic" ? "Scanner rules" : "Cited research"}</span></div>
                <p>{section.body}</p>
                {section.citations.length > 0 && <ul className={styles.citations}>{section.citations.map((citation) => <li key={citation.url}><a href={citation.url} rel="noreferrer" target="_blank">{citation.title} ↗</a></li>)}</ul>}
              </article>
            ))}
          </div>
        </div>

        <aside className={styles.chat}>
          <div className={styles.chatHeading}><div><p>PER-STOCK CHAT</p><h3>Ask about {candidate.code}</h3></div><select aria-label="Reply language" onChange={(event) => setLanguage(event.target.value as "English" | "Arabic")} value={language}><option>English</option><option>Arabic</option></select></div>
          <label className={styles.priceLabel}>Optional live broker price<input inputMode="decimal" onChange={(event) => setManualPrice(event.target.value)} placeholder="User-supplied SAR" value={manualPrice} /></label>
          {manualPrice && <p className={styles.manual}>User-supplied only — not scanner data.</p>}
          <div className={styles.messages}>{messages.length === 0 ? <p className={styles.empty}>Ask why the agent says wait, what evidence is missing, or how the existing rules apply. It cannot place a trade.</p> : messages.map((message) => <div className={message.role === "user" ? styles.userMessage : styles.agentMessage} key={message.id}><p>{message.text}</p>{message.citations?.length ? <p className={styles.messageSources}>{message.citations.length} saved source{message.citations.length === 1 ? "" : "s"}</p> : null}</div>)}</div>
          <form className={styles.form} onSubmit={askQuestion}><textarea aria-label="Ask about this stock" disabled={!report || asking} onChange={(event) => setQuestion(event.target.value)} placeholder={report ? "Ask a follow-up…" : "Research must finish before chat…"} value={question} /><button disabled={!report || asking || !question.trim()} type="submit">{asking ? "Thinking…" : "Ask agent"}</button></form>
        </aside>
      </div>
    </section>
  );
}
