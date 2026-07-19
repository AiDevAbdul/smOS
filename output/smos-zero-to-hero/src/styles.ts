export const colors = {
  canvas: "#0b0c10",
  panel: "#111319",
  panelBorder: "rgba(255,255,255,0.08)",
  textPrimary: "rgba(255,255,255,0.96)",
  textSecondary: "rgba(255,255,255,0.55)",
  textDim: "rgba(255,255,255,0.32)",
  blue: "#0071e3",
  indigo: "#5e5ce6",
  violet: "#af52de",
  green: "#34c759",
  orange: "#ff9f0a",
  red: "#ff3b30",
};

export const gradientBrand = `linear-gradient(120deg, ${colors.blue} 0%, ${colors.indigo} 45%, ${colors.violet} 100%)`;

export const fonts = {
  sans:
    "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export const type = {
  hero: {
    fontSize: 76,
    fontWeight: 700,
    letterSpacing: "-0.03em",
    lineHeight: 1.02,
  },
  h1: {
    fontSize: 46,
    fontWeight: 700,
    letterSpacing: "-0.025em",
    lineHeight: 1.1,
  },
  h2: {
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: "-0.015em",
    lineHeight: 1.2,
  },
  eyebrow: {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
  },
  body: {
    fontSize: 22,
    fontWeight: 400,
    letterSpacing: "-0.005em",
    lineHeight: 1.5,
  },
  node: {
    fontSize: 19,
    fontWeight: 600,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  nodeLabel: {
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.4,
  },
  badge: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
};
