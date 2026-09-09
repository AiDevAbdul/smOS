import { AppShell } from "../../components/AppShell";
import { getHealth } from "../../lib/health";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const health = getHealth();
  const { claudeVersion, hooksLoaded, envKeysPresent, mcpServers } = health;

  return (
    <AppShell breadcrumb={[{ label: "Overview", href: "/" }, { label: "Settings" }]}>
      <div className="ds-page">
      <div className="ds-verdict" style={{ marginTop: 0 }}>
        Local environment health — read-only, best-effort. Never shows secret values, only
        whether an env key is present.
      </div>

      <div className="ds-panel" style={{ marginTop: "var(--ds-space-5)" }}>
        <div className="ds-nav-group">Claude Code</div>
        <div className="ds-kv">
          <div className="ds-kv__row">
            <span className="ds-kv__key">claude --version</span>
            <span className="ds-kv__val">
              {claudeVersion.version ?? (
                <span className="ds-badge ds-badge--bad">unavailable</span>
              )}
            </span>
          </div>
          {claudeVersion.error && (
            <div className="ds-kv__row">
              <span className="ds-kv__key">Error</span>
              <span className="ds-kv__val">{claudeVersion.error}</span>
            </div>
          )}
        </div>
      </div>

      <div className="ds-panel" style={{ marginTop: "var(--ds-space-5)" }}>
        <div className="ds-nav-group">Hooks loaded (hooks/hooks.json)</div>
        {!hooksLoaded.ok && (
          <p className="ds-field__hint">
            <span className="ds-badge ds-badge--bad">error</span>&nbsp;{hooksLoaded.error}
          </p>
        )}
        {hooksLoaded.ok && (
          <>
            <div className="ds-kv">
              <div className="ds-kv__row">
                <span className="ds-kv__key">Matchers</span>
                <span className="ds-kv__val">{hooksLoaded.totalMatchers}</span>
              </div>
              <div className="ds-kv__row">
                <span className="ds-kv__key">Hook commands</span>
                <span className="ds-kv__val">{hooksLoaded.totalHookCommands}</span>
              </div>
            </div>
            <div className="ds-grid-demo" style={{ marginTop: "var(--ds-space-3)" }}>
              <table className="ds-grid">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Matcher</th>
                    <th>Hook scripts</th>
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
                  {hooksLoaded.totalMatchers === 0 && (
                    <tr>
                      <td colSpan={3} className="ds-empty">
                        No hook matchers configured.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="ds-panel" style={{ marginTop: "var(--ds-space-5)" }}>
        <div className="ds-nav-group">Env keys present ({envKeysPresent.length})</div>
        <p className="ds-field__hint">
          Key names only — values are never read or displayed. Allowlisted prefixes: META_,
          SUPABASE_, DISCORD_, STRIPE_, ANTHROPIC_, SMOS_.
        </p>
        {envKeysPresent.length === 0 && <p className="ds-empty">No allowlisted env keys present.</p>}
        {envKeysPresent.length > 0 && (
          <div className="ds-grid-demo">
            <table className="ds-grid">
              <thead>
                <tr>
                  <th>Key</th>
                </tr>
              </thead>
              <tbody>
                {envKeysPresent.map((k) => (
                  <tr key={k}>
                    <td>
                      <code>{k}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ds-panel" style={{ marginTop: "var(--ds-space-5)" }}>
        <div className="ds-nav-group">MCP servers on disk ({mcpServers.length})</div>
        <p className="ds-field__hint">
          Discovered from a root <code>.mcp.json</code> and <code>mcp/*/package.json</code> —
          not a live connection check.
        </p>
        {mcpServers.length === 0 && <p className="ds-empty">No MCP servers found on disk.</p>}
        {mcpServers.length > 0 && (
          <div className="ds-grid-demo">
            <table className="ds-grid">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
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
      </div>
      </div>
    </AppShell>
  );
}
