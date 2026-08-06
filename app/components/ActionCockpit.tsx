import type { DashboardFixture } from "@/app/fixtures/dashboard";
import styles from "./ActionCockpit.module.css";

function formatPrice(price: number) {
  return `${price.toFixed(2)} SAR`;
}

export function ActionCockpit({ dashboard }: { dashboard: DashboardFixture }) {
  const qualified = dashboard.qualified.slice(0, 3);

  return (
    <main className={styles.cockpit}>
      <header className={styles.header}>
        <div>
          <p className={styles.brand}>TASI ACTION COCKPIT</p>
          <h1>Today’s decisions, without the noise.</h1>
          <p className={styles.subtitle}>Review a clear proposal, understand why it exists, then decide what to do.</p>
        </div>
        <div className={styles.statusPanel}>
          <span className={styles.preview}>Preview data — delayed/daily</span>
          <span className={styles.asOf}>As of {dashboard.asOf}</span>
        </div>
      </header>

      <section className={styles.safetyNote} aria-label="Trading safety notice">
        <span className={styles.safetyDot} aria-hidden="true" />
        <p>Verify the live price with your broker before acting. This preview never sends an order.</p>
      </section>

      <section className={styles.section} aria-labelledby="urgent-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>PRIORITY</p>
            <h2 id="urgent-heading">Act now</h2>
          </div>
          <span className={styles.count}>{dashboard.urgent.length} to review</span>
        </div>

        <div className={styles.actionList}>
          {dashboard.urgent.map((action) => (
            <article className={styles.actionCard} data-state="urgent" key={action.code}>
              <div className={styles.cardTopline}>
                <span className={styles.actionLabel}>{action.action}</span>
                <span className={styles.price}>{formatPrice(action.price)}</span>
              </div>
              <div className={styles.cardBody}>
                <div>
                  <p className={styles.symbol}>{action.code}</p>
                  <h3>{action.name}</h3>
                </div>
                <div className={styles.loss}>
                  <span>Unrealized P/L</span>
                  <strong>{action.pnlPct.toFixed(1)}%</strong>
                </div>
              </div>
              <p className={styles.reason}>{action.reason}</p>
              <div className={styles.cardFooter}>
                <div className={styles.previewButtons}>
                  <button aria-label={`Review a future sale proposal for ${action.name}`} disabled type="button">
                    Review sale
                  </button>
                  <button aria-label={`Explain why this action was proposed for ${action.name}`} disabled type="button">
                    Why this action?
                  </button>
                </div>
                <span className={styles.previewHint}>Enabled when the secure ledger is connected</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="changed-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>PORTFOLIO</p>
            <h2 id="changed-heading">What changed</h2>
          </div>
        </div>
        {dashboard.changed.length === 0 ? (
          <p className={styles.quiet}>No other holding crossed a decision level in this preview.</p>
        ) : (
          <div className={styles.changeList}>
            {dashboard.changed.map((change) => (
              <article className={styles.changeCard} data-state="changed" key={change.code}>
                <div>
                  <p className={styles.symbol}>{change.code}</p>
                  <h3>{change.name}</h3>
                </div>
                <div>
                  <p className={styles.changeStatus}>{change.status}</p>
                  <p className={styles.changeReason}>{change.reason}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="qualified-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.kicker}>SCANNER</p>
            <h2 id="qualified-heading">Qualified for research</h2>
          </div>
          <span className={styles.candidateNote}>Candidates, not trade instructions</span>
        </div>
        <div className={styles.qualifiedGrid}>
          {qualified.map((candidate) => (
            <article className={styles.qualifiedCard} data-state="qualified" key={candidate.code}>
              <div className={styles.qualifiedHeader}>
                <span className={styles.symbol}>{candidate.code}</span>
                {candidate.squeeze && <span className={styles.squeeze}>Squeeze</span>}
              </div>
              <h3>{candidate.name}</h3>
              <p>Relative strength <strong>+{candidate.relativeStrengthPct.toFixed(1)}%</strong></p>
              <span className={styles.researchPrompt}>Research before deciding →</span>
            </article>
          ))}
        </div>
        <p className={styles.researchLink}>Scanner research · {dashboard.researchCount} one-condition names withheld from Home</p>
      </section>

      <footer className={styles.footer}>Automates your rules. Not financial advice. You execute every trade.</footer>
    </main>
  );
}
