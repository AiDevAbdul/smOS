import { readFileSync, existsSync } from "node:fs";
import { clientProfile } from "../../../../../scripts/lib/paths.js";
import MetricCard from "../../../../components/MetricCard";
import Ring from "../../../../components/Ring";
import { fmtCurrency, fmtNumber, fmtPercent } from "../../../../lib/format";

export const dynamic = "force-dynamic";

type Dict = Record<string, unknown>;

function loadProfile(slug: string): Dict | null {
  const path = clientProfile(slug);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Dict;
  } catch {
    return null;
  }
}

function dict(v: unknown): Dict {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : {};
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function Row({ k, v }: { k: string; v: unknown }) {
  const display = str(v) ?? (Array.isArray(v) && v.length ? v.map(String).join(", ") : null);
  if (display === null) return null;
  return (
    <div className="ds-kv__row">
      <div className="ds-kv__key">{k}</div>
      <div className="ds-kv__val">{display}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ds-panel" style={{ padding: "var(--ds-space-5)", marginBottom: "var(--ds-space-4)" }}>
      {/* A real h2, not a styled div: these are the page's sections, and the
          client layout supplies the h1 above them. */}
      <h2 className="ds-eyebrow" style={{ margin: "0 0 var(--ds-space-3)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chips({ items, variant }: { items: unknown; variant: string }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ds-space-2)" }}>
      {items.map((t) => (
        <span key={String(t)} className={`ds-badge ${variant}`}>
          {String(t)}
        </span>
      ))}
    </div>
  );
}

/**
 * The account ids that gate the pipeline. `guards.js`'s checkZeroStartPrereqs
 * halts a skill when one of these is missing, so the screen shows the same
 * verdict rather than making the operator find out at run time.
 */
const ACCOUNT_GATES: Array<{ key: string; label: string; needed: string }> = [
  { key: "page_id", label: "Facebook Page", needed: "/publish, /inbox, /audit" },
  { key: "ig_account_id", label: "Instagram business account", needed: "/publish, /inbox" },
  { key: "ad_account_id", label: "Ad account", needed: "/launch, /analyze, /scale" },
  { key: "pixel_id", label: "Pixel / dataset", needed: "conversion campaigns, /capi-setup" },
  { key: "bm_id", label: "Business Manager", needed: "asset assignment" },
];

export default async function ClientProfile({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = loadProfile(slug);

  if (!profile) {
    return (
      <div className="ds-panel ds-empty" style={{ minHeight: 220 }}>
        <svg aria-hidden="true">
          <use href="/icons.svg#i-client" />
        </svg>
        <p className="ds-empty__title">No profile on file</p>
        <p style={{ fontSize: 12.5, color: "var(--ds-muted)", margin: 0, maxWidth: "46ch" }}>
          <code>clients/{slug}/profile.json</code> has not been created yet — run{" "}
          <code>/intake</code>.
        </p>
      </div>
    );
  }

  const accounts = dict(profile.accounts);
  // Two shapes exist in the wild: `contact` (written by /intake) and `contacts`
  // (older records). Merge rather than picking one and reporting "—".
  const contact = { ...dict(profile.contacts), ...dict(profile.contact) };
  const business = dict(profile.business);
  const location = dict(profile.location);
  const voice = dict(profile.voice);
  const kpis = dict(profile.kpis);
  const contentPrefs = dict(profile.content_preferences);

  const gatesMet = ACCOUNT_GATES.filter((g) => str(accounts[g.key]) !== null).length;
  const readiness = (gatesMet / ACCOUNT_GATES.length) * 100;

  const avgTicket = typeof business.blended_avg_ticket === "number" ? business.blended_avg_ticket : null;
  const currency = str(accounts.currency) ?? "USD";
  const contentMode = str(contentPrefs.mode) ?? "ai_assisted (default)";

  return (
    <div>
      <div className="ds-metric-grid ds-stagger" style={{ marginBottom: "var(--ds-space-6)" }}>
        <MetricCard
          index={0}
          label="Account readiness"
          value={fmtPercent(readiness, 0)}
          note={`${gatesMet} of ${ACCOUNT_GATES.length} ids on file`}
          hue={readiness === 100 ? 1 : 2}
          leading={
            <Ring
              pct={readiness}
              size={64}
              stroke={6}
              tone={readiness === 100 ? "good" : "warn"}
              title={`${Math.round(readiness)}% of gating account ids on file`}
            />
          }
        />
        <MetricCard
          index={1}
          label="Status"
          value={str(profile.status) ?? "unknown"}
          note={str(profile.engagement_start_date) ? `since ${str(profile.engagement_start_date)}` : "no start date"}
          hue={5}
        />
        <MetricCard
          index={2}
          label="Avg ticket"
          value={avgTicket === null ? "—" : fmtCurrency(avgTicket, currency)}
          note={
            typeof business.price_low === "number" && typeof business.price_high === "number"
              ? `${fmtCurrency(business.price_low, currency)}–${fmtCurrency(business.price_high, currency)} range`
              : (str(business.business_model) ?? "no pricing on file")
          }
          hue={4}
        />
        <MetricCard
          index={3}
          label="Content mode"
          value={contentMode.replace(/_/g, " ")}
          note={
            contentMode.startsWith("ai_assisted")
              ? "smOS drafts captions"
              : "smOS plans only — client writes copy"
          }
          hue={6}
        />
      </div>

      <Panel title="Account gates">
        <div className="ds-sheet">
          {ACCOUNT_GATES.map((g) => {
            const value = str(accounts[g.key]);
            return (
              <div key={g.key} className="ds-sheet__row">
                <span className="ds-sheet__metric">{g.label}</span>
                <span className="ds-sheet__read" style={{ fontFamily: "var(--ds-font-mono)" }}>
                  {value ?? `needed by ${g.needed}`}
                </span>
                <span className={`ds-badge ${value ? "ds-badge--good" : "ds-badge--warn"}`}>
                  {value ? "On file" : "Missing"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="ds-kv" style={{ marginTop: "var(--ds-space-4)" }}>
          <Row k="Timezone" v={accounts.timezone} />
          <Row k="Currency" v={accounts.currency} />
          <Row k="Pixel installed" v={accounts.pixel_installed} />
          <Row k="System user" v={accounts.system_user_id} />
          <Row k="Website" v={accounts.website ?? accounts.website_url} />
          <Row k="Facebook" v={accounts.facebook_handle} />
          <Row k="Instagram" v={accounts.instagram_handle} />
          {str(accounts.legacy_pixel_note) && <Row k="Note" v={accounts.legacy_pixel_note} />}
        </div>
      </Panel>

      {Object.keys(kpis).length > 0 && (
        <Panel title="KPI targets — these override the global thresholds">
          {Object.entries(kpis).map(([objective, metrics]) => (
            <div key={objective} style={{ marginBottom: "var(--ds-space-4)" }}>
              <div
                style={{
                  fontFamily: "var(--ds-font-mono)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: ".07em",
                  color: "var(--ds-muted)",
                  marginBottom: "var(--ds-space-2)",
                }}
              >
                {objective}
              </div>
              <div className="ds-kv">
                {Object.entries(dict(metrics)).map(([k, v]) => (
                  <Row key={k} k={k.replace(/_/g, " ")} v={typeof v === "number" ? fmtNumber(v, 2) : v} />
                ))}
              </div>
            </div>
          ))}
        </Panel>
      )}

      {(Array.isArray(voice.tone) || Array.isArray(voice.avoid)) && (
        <Panel title="Voice — enforced by the brand-compliance guard">
          {Array.isArray(voice.tone) && (
            <div style={{ marginBottom: "var(--ds-space-4)" }}>
              <div className="ds-field__label">Tone</div>
              <Chips items={voice.tone} variant="ds-badge--good" />
            </div>
          )}
          {Array.isArray(voice.avoid) && (
            <div style={{ marginBottom: "var(--ds-space-4)" }}>
              <div className="ds-field__label">
                Never use — a creative containing one of these is blocked fail-closed
              </div>
              <Chips items={voice.avoid} variant="ds-badge--bad" />
            </div>
          )}
          {Array.isArray(voice.signature_phrases) && (
            <div>
              <div className="ds-field__label">Signature phrases</div>
              <Chips items={voice.signature_phrases} variant="ds-badge--neutral" />
            </div>
          )}
        </Panel>
      )}

      <div className="ds-duo">
        <Panel title="Business">
          <div className="ds-kv">
            <Row k="Company" v={profile.name} />
            <Row k="Slug" v={profile.slug} />
            <Row k="Model" v={business.business_model} />
            <Row k="USP" v={business.usp} />
            <Row k="Conversion events" v={business.conversion_events} />
            <Row k="Primary CTA" v={business.primary_cta} />
            <Row k="Seasonality" v={business.seasonality} />
            <Row k="Description" v={business.product_description} />
          </div>
        </Panel>

        <Panel title="Location & contact">
          <div className="ds-kv">
            <Row k="Address" v={location.address ?? contact.address} />
            <Row k="City" v={location.city} />
            <Row k="State" v={location.state} />
            <Row k="Country" v={location.country} />
            <Row k="Service radius" v={location.service_radius_miles ? `${location.service_radius_miles} mi` : null} />
            <Row k="Service area" v={location.service_area} />
            <Row k="Phone" v={contact.phone} />
            <Row k="Email" v={contact.email ?? contact.primary_email} />
            <Row k="Website" v={contact.website_display} />
          </div>
        </Panel>
      </div>

      <details className="ds-panel" style={{ padding: "var(--ds-space-4)" }}>
        <summary
          style={{ cursor: "pointer", fontFamily: "var(--ds-font-mono)", fontSize: 12, color: "var(--ds-ink-2)" }}
        >
          Raw profile.json
        </summary>
        <pre className="ds-json" style={{ marginTop: "var(--ds-space-3)" }}>
          {JSON.stringify(profile, null, 2)}
        </pre>
      </details>
    </div>
  );
}
