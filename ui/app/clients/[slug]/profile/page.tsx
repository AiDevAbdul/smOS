import { readFileSync, existsSync } from "node:fs";
import { clientProfile } from "../../../../../scripts/lib/paths.js";

export const dynamic = "force-dynamic";

function loadProfile(slug: string): Record<string, unknown> | null {
  const path = clientProfile(slug);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function row(key: string, val: unknown) {
  if (val === undefined || val === null || val === "") return null;
  const display = typeof val === "object" ? JSON.stringify(val) : String(val);
  return (
    <div className="ds-kv__row" key={key}>
      <div className="ds-kv__key">{key}</div>
      <div className="ds-kv__val">{display}</div>
    </div>
  );
}

export default async function ClientProfile({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = loadProfile(slug);

  if (!profile) {
    return (
      <div className="ds-empty">
        <div className="ds-empty__title">No profile on file</div>
        <p>clients/{slug}/profile.json has not been created yet — run /intake.</p>
      </div>
    );
  }

  const accounts = (profile.accounts ?? {}) as Record<string, unknown>;
  const contact = (profile.contact ?? {}) as Record<string, unknown>;

  return (
    <div>
      <div className="ds-panel" style={{ padding: "var(--ds-space-5)", marginBottom: "var(--ds-space-4)" }}>
        <div className="ds-eyebrow" style={{ marginBottom: "var(--ds-space-3)" }}>
          Identity
        </div>
        <div className="ds-kv">
          {row("Company", profile.name)}
          {row("Slug", profile.slug)}
          {row("Status", profile.status)}
          {row("Engagement start", profile.engagement_start_date)}
          {row("Timezone", accounts.timezone)}
          {row("Currency", accounts.currency)}
        </div>
      </div>

      <div className="ds-panel" style={{ padding: "var(--ds-space-5)", marginBottom: "var(--ds-space-4)" }}>
        <div className="ds-eyebrow" style={{ marginBottom: "var(--ds-space-3)" }}>
          Accounts
        </div>
        <div className="ds-kv">
          {row("Website", accounts.website)}
          {row("Facebook Page ID", accounts.page_id ?? accounts.facebook_page_id)}
          {row("Instagram business ID", accounts.ig_account_id ?? accounts.instagram_business_id)}
          {row("Ad account", accounts.ad_account_id)}
          {row("Pixel", accounts.pixel_id)}
          {row("Business Manager", accounts.bm_id ?? accounts.business_id)}
        </div>
      </div>

      <div className="ds-panel" style={{ padding: "var(--ds-space-5)" }}>
        <div className="ds-eyebrow" style={{ marginBottom: "var(--ds-space-3)" }}>
          Contact
        </div>
        <div className="ds-kv">
          {row("Phone", contact.phone)}
          {row("Email", contact.email)}
          {row("Website", contact.website_display)}
          {row("Address", contact.address)}
        </div>
      </div>
    </div>
  );
}
