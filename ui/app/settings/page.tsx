import { AppShell } from "../../components/AppShell";
import MetricCard from "../../components/MetricCard";
import { getHealth } from "../../lib/health";
import { fmtNumber } from "../../lib/format";

export const dynamic = "force-dynamic";

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="ds-sec">
        <div>
          <h2 className="ds-sec__title">{title}</h2>
          {sub && <p className="ds-sec__sub">{sub}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const health = getHealth();
  const { claudeVersion, hooksLoaded, envKeysPresent, mcpServers } = health;

  return (
    <AppShell breadcrumb={[{ label: "Overview", href: "/" }, { label: "Settings" }]}>
      <div className="ds-page">
        <div className="ds-sec">
          <div>
            <h1 className="ds-page-title">Environment</h1>
            <p className="ds-sec__sub">
              Read-only and best-effort. Env keys are reported by name only — no value is ever read
              or displayed, and nothing here is a live connection check.
            </p>
          </div>
        </div>

        <div className="ds-metric-grid ds-stagger">
          <MetricCard
            index={0}
            label="Claude Code"
            value={claudeVersion.version ?? "unavailable"}
            note={claudeVersion.error ? claudeVersion.error.slice(0, 60) : "runs are spawned with this CLI"}
            hue={claudeVersion.version ? 1 : 3}
          />
          <MetricCard
            index={1}
            label="Hook commands"
            value={hooksLoaded.ok ? fmtNumber(hooksLoaded.totalHookCommands) : "—"}
            note={
              hooksLoaded.ok
                ? `${fmtNumber(hooksLoaded.totalMatchers)} matchers in hooks/hooks.json`
                : "hooks.json unreadable"
            }
            hue={hooksLoaded.ok ? 0 : 3}
          />
          <MetricCard
            index={2}
            label="Env keys present"
            value={fmtNumber(envKeysPresent.length)}
            note="allowlisted prefixes only"
            hue={4}
          />
          <MetricCard
            index={3}
            label="MCP servers on disk"
            value={fmtNumber(mcpServers.length)}
            note="discovered, not connected"
            hue={5}
          />
        </div>

        <Section
          title="Hooks"
          sub="What hooks/hooks.json wires up — the guardrails (naming-check, ai-disclosure, brand-compliance) run through these."
        >
          {!hooksLoaded.ok ? (
            <div className="ds-inline-error" role="alert">
              {hooksLoaded.error}
            </div>
          ) : hooksLoaded.totalMatchers === 0 ? (
            <div className="ds-panel ds-empty" style={{ minHeight: 120 }}>
              <p className="ds-empty__title">No hook matchers configured</p>
            </div>
          ) : (
            <div className="ds-grid-wrap">
              <table className="ds-grid">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Matcher</th>
                    <th scope="col">Hook scripts</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(hooksLoaded.byEvent).flatMap(([event, matchers]) =>
                    matchers.map((m, i) => (
                      <tr key={`${event}-${i}`}>
                        <td>{event}</td>
                        <td>
                          <code>{m.matcher}</code>
                        </td>
                        <td>{m.hooks.join(", ") || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <div className="ds-duo">
          <Section
            title="Env keys"
            sub="Names only. Prefixes: META_, SUPABASE_, DISCORD_, STRIPE_, ANTHROPIC_, SMOS_."
          >
            {envKeysPresent.length === 0 ? (
              <div className="ds-panel ds-empty" style={{ minHeight: 120 }}>
                <p className="ds-empty__title">No allowlisted env keys present</p>
                <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0 }}>
                  Live Meta and Supabase calls will fail closed until these are set.
                </p>
              </div>
            ) : (
              <div className="ds-panel" style={{ padding: "var(--ds-space-4)" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ds-space-2)" }}>
                  {envKeysPresent.map((k) => (
                    <code key={k} className="ds-file-chip">
                      {k}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title="MCP servers" sub="From the root .mcp.json and mcp/*/package.json.">
            {mcpServers.length === 0 ? (
              <div className="ds-panel ds-empty" style={{ minHeight: 120 }}>
                <p className="ds-empty__title">No MCP servers found on disk</p>
              </div>
            ) : (
              <div className="ds-grid-wrap">
                <table className="ds-grid">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mcpServers.map((s) => (
                      <tr key={`${s.name}-${s.source}`}>
                        <td>{s.name}</td>
                        <td>
                          <code>{s.source}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
