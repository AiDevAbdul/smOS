// scripts/lib/agency-economics.js — per-client profitability + roster capacity (D4).
//
// NOT the same thing as scripts/lib/economics.js, which computes the CLIENT's ad
// economics (MER, breakeven ROAS, CAC). This module is about the AGENCY's own
// economics: what a client pays us versus what they cost us to deliver, and
// whether the people delivering them are over capacity.
//
// Revenue was being read as profit because nothing recorded cost. A $300/mo client
// taking eight hours a month is a loss; the pipeline showed it as $300 of MRR.
//
// Three honesty rules, enforced here rather than left to the caller:
//
//   1. NO INVENTED FX. Cost rates live in one currency (config/roster.json). A
//      client billed in another currency reports `margin: null` with a reason —
//      smOS holds no exchange rates, and a converted margin would be fabricated.
//   2. ESTIMATE VS ACTUAL IS ALWAYS LABELLED. When a period has logged hours it
//      uses them; otherwise it falls back to budgeted hours and says
//      `hours_basis: "budgeted"`. A margin from a guess must not read like a
//      margin from a timesheet.
//   3. UNKNOWN COST ≠ ZERO COST. With no hours and no budget, margin is `null`,
//      not "100% margin". That default would make every unmeasured client look
//      like the most profitable one.

import { deal as dealSchema } from "../../schemas/index.js";

export const DEFAULT_HOURLY_COST = 30;

/** Normalize a roster config, tolerating a missing/partial file. */
export function normalizeRoster(raw) {
  const r = raw || {};
  const members = (Array.isArray(r.members) ? r.members : []).map((m) => ({
    id: m?.id ?? null,
    name: m?.name ?? m?.id ?? null,
    role: m?.role ?? null,
    hourly_cost: Number.isFinite(Number(m?.hourly_cost)) ? Number(m.hourly_cost) : null,
    max_clients: Number.isFinite(Number(m?.max_clients)) ? Number(m.max_clients) : null,
    max_hours_per_month: Number.isFinite(Number(m?.max_hours_per_month)) ? Number(m.max_hours_per_month) : null,
  })).filter((m) => m.id);
  return {
    currency: r.currency || "USD",
    default_hourly_cost: Number.isFinite(Number(r.default_hourly_cost)) ? Number(r.default_hourly_cost) : DEFAULT_HOURLY_COST,
    members,
  };
}

/** The hourly cost to use for a deal: per-client override > member > roster default. */
export function hourlyCostFor(deal, roster) {
  const d = dealSchema.normalize(deal);
  const R = normalizeRoster(roster);
  if (d.cost_to_serve.hourly_cost !== null) return d.cost_to_serve.hourly_cost;
  const member = R.members.find((m) => m.id === d.owner);
  if (member?.hourly_cost !== null && member?.hourly_cost !== undefined) return member.hourly_cost;
  return R.default_hourly_cost;
}

/**
 * Per-client profitability for one month.
 *
 * @returns {{
 *   slug, currency, revenue, cost, margin, margin_pct, hours, hours_basis,
 *   breakdown, unmeasured, reasons[]
 * }}
 *   `margin` is null whenever it cannot be computed honestly, and `reasons`
 *   always says why.
 */
export function clientProfitability(deal, roster, month = new Date().toISOString().slice(0, 7)) {
  const d = dealSchema.normalize(deal);
  const R = normalizeRoster(roster);
  const reasons = [];

  const revenue = d.deal.monthly_retainer;
  const currency = d.deal.currency || "USD";

  // Hours: actual if logged for this period, else the budget, else unknown.
  const logged = dealSchema.loggedHours(d, month);
  let hours = null;
  let basis = "unknown";
  if (logged > 0) { hours = logged; basis = "logged"; }
  else if (d.cost_to_serve.hours_per_month !== null) { hours = d.cost_to_serve.hours_per_month; basis = "budgeted"; }

  const rate = hourlyCostFor(d, R);
  const laborCost = hours === null ? null : Math.round(hours * rate * 100) / 100;
  const otherCost = Math.round((d.cost_to_serve.tool_cost + d.cost_to_serve.contractor_cost) * 100) / 100;

  // Blockers to an honest margin, in order of severity.
  const currencyMismatch = currency !== R.currency;
  if (currencyMismatch) {
    reasons.push(`Retainer is in ${currency} but delivery costs are in ${R.currency}. smOS holds no FX rates, so margin is not computed rather than converted with a made-up rate.`);
  }
  if (!(revenue > 0)) {
    reasons.push("No retainer recorded on the deal — revenue is unknown, so margin cannot be computed. Set it: /crm set <slug> retainer=<amount>");
  }
  if (hours === null) {
    reasons.push("No logged effort for this month and no budgeted hours_per_month — cost is unknown. Unknown cost is NOT zero cost, so margin is null rather than 100%. Set it: /crm set <slug> hours_per_month=<n>, or log work: /crm effort <slug> --hours <n>");
  } else if (basis === "budgeted") {
    reasons.push(`Cost uses BUDGETED hours (${hours}h), not logged work — this is an estimate. Log actual hours with: /crm effort <slug> --hours <n>`);
  }

  const computable = !currencyMismatch && revenue > 0 && hours !== null;
  const cost = computable ? Math.round((laborCost + otherCost) * 100) / 100 : null;
  const margin = computable ? Math.round((revenue - cost) * 100) / 100 : null;
  const marginPct = computable && revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;

  return {
    slug: d.slug,
    company: d.company_name,
    owner: d.owner,
    month,
    currency,
    revenue: revenue > 0 ? revenue : null,
    cost,
    margin,
    margin_pct: marginPct,
    hours,
    hours_basis: basis,
    hourly_cost: rate,
    breakdown: { labor: laborCost, tools: d.cost_to_serve.tool_cost, contractors: d.cost_to_serve.contractor_cost },
    // A single flag a renderer can use to grey the row out instead of showing a
    // confident number.
    unmeasured: !computable,
    // Losing money is the finding this module exists to surface.
    loss_making: margin !== null && margin < 0,
    reasons,
  };
}

/**
 * Roster load: clients and hours assigned per member vs their limits.
 *
 * Deals whose `owner` matches no roster member are reported as `unassigned`
 * rather than dropped — an unowned client is a capacity risk, not a zero.
 */
export function rosterLoad(deals, roster, month = new Date().toISOString().slice(0, 7)) {
  const R = normalizeRoster(roster);
  const won = (deals || []).map(dealSchema.normalize).filter((d) => d.stage === "won");

  const hoursFor = (d) => {
    const logged = dealSchema.loggedHours(d, month);
    if (logged > 0) return { hours: logged, basis: "logged" };
    if (d.cost_to_serve.hours_per_month !== null) return { hours: d.cost_to_serve.hours_per_month, basis: "budgeted" };
    return { hours: 0, basis: "unknown" };
  };

  const members = R.members.map((m) => {
    const mine = won.filter((d) => d.owner === m.id);
    const detail = mine.map((d) => ({ slug: d.slug, ...hoursFor(d) }));
    const hours = Math.round(detail.reduce((s, x) => s + x.hours, 0) * 100) / 100;
    const unknownHours = detail.filter((x) => x.basis === "unknown").map((x) => x.slug);
    return {
      id: m.id, name: m.name, role: m.role,
      clients: mine.length,
      max_clients: m.max_clients,
      hours, max_hours_per_month: m.max_hours_per_month,
      client_utilization_pct: m.max_clients ? Math.round((mine.length / m.max_clients) * 1000) / 10 : null,
      hours_utilization_pct: m.max_hours_per_month ? Math.round((hours / m.max_hours_per_month) * 1000) / 10 : null,
      over_client_limit: m.max_clients !== null && mine.length > m.max_clients,
      over_hours_limit: m.max_hours_per_month !== null && hours > m.max_hours_per_month,
      // Hours are understated by exactly these clients, so utilization is a floor.
      clients_with_unknown_hours: unknownHours,
      detail,
    };
  });

  const assignedIds = new Set(R.members.map((m) => m.id));
  const unassigned = won.filter((d) => !d.owner || !assignedIds.has(d.owner))
    .map((d) => ({ slug: d.slug, owner: d.owner || null }));

  return {
    month,
    currency: R.currency,
    members,
    unassigned,
    capacity: {
      total_clients: won.length,
      assigned: won.length - unassigned.length,
      // Only meaningful where limits are set.
      total_max_clients: members.reduce((s, m) => s + (m.max_clients || 0), 0) || null,
      members_over_limit: members.filter((m) => m.over_client_limit || m.over_hours_limit).map((m) => m.id),
    },
  };
}

/**
 * Portfolio margin roll-up. Per currency (never blended) and it reports how many
 * clients could not be measured, so a total is never mistaken for the whole book.
 */
export function portfolioMargin(profitabilities) {
  const by = {};
  const unmeasured = [];
  for (const p of profitabilities || []) {
    if (p.unmeasured) { unmeasured.push({ slug: p.slug, reasons: p.reasons }); continue; }
    const c = p.currency || "USD";
    by[c] = by[c] || { revenue: 0, cost: 0, margin: 0, clients: 0 };
    by[c].revenue = Math.round((by[c].revenue + p.revenue) * 100) / 100;
    by[c].cost = Math.round((by[c].cost + p.cost) * 100) / 100;
    by[c].margin = Math.round((by[c].margin + p.margin) * 100) / 100;
    by[c].clients += 1;
  }
  for (const c of Object.keys(by)) {
    by[c].margin_pct = by[c].revenue > 0 ? Math.round((by[c].margin / by[c].revenue) * 1000) / 10 : null;
  }
  return {
    by_currency: by,
    measured: (profitabilities || []).length - unmeasured.length,
    unmeasured_count: unmeasured.length,
    unmeasured,
    loss_making: (profitabilities || []).filter((p) => p.loss_making).map((p) => p.slug),
  };
}
