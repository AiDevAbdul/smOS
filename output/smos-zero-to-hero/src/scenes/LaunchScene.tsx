import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { PhaseHeader } from "../components/PhaseHeader";
import { FlowNode, FlowArrow } from "../components/FlowNode";
import { colors, type } from "../styles";
import { PauseCircle, TrendingUp, ShieldAlert } from "lucide-react";

const Callout: React.FC<{
  icon: React.ReactNode;
  label: string;
  text: string;
  tint: string;
  delay: number;
}> = ({ icon, label, text, tint, delay }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(local, [0, 16], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        background: colors.panel,
        border: `1px solid ${colors.panelBorder}`,
        borderRadius: 18,
        padding: "18px 22px",
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        flex: 1,
      }}
    >
      <div style={{ color: tint, marginTop: 2 }}>{icon}</div>
      <div>
        <div style={{ ...type.badge, color: tint, marginBottom: 6, fontSize: 13 }}>{label}</div>
        <div style={{ ...type.nodeLabel, color: colors.textSecondary, fontSize: 16 }}>{text}</div>
      </div>
    </div>
  );
};

export const LaunchScene: React.FC = () => {
  return (
    <AbsoluteFill style={{ padding: "0 56px", justifyContent: "center", alignItems: "center" }}>
      <PhaseHeader eyebrow="Phase 2 · Launch & Optimize" title="Put money behind it" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginBottom: 30 }}>
        <FlowNode cmd="/creative" label="Ad copy, scored variants" delay={10} />
        <FlowArrow delay={30} vertical />
        <FlowNode cmd="/launch" label="Created PAUSED, always" delay={38} gate />
        <FlowArrow delay={58} vertical />
        <FlowNode cmd="/analyze" label="vs. KPI thresholds" delay={66} />
        <FlowArrow delay={86} vertical />
        <FlowNode cmd="/scale" label="Scale winners, kill losers" delay={94} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
        <Callout
          icon={<PauseCircle size={22} strokeWidth={2} />}
          label="Auto-pause"
          text="CPA > 3× target"
          tint={colors.orange}
          delay={150}
        />
        <Callout
          icon={<TrendingUp size={22} strokeWidth={2} />}
          label="Auto-scale"
          text="ROAS > 3.0, 3 days"
          tint={colors.green}
          delay={168}
        />
        <Callout
          icon={<ShieldAlert size={22} strokeWidth={2} />}
          label="Needs approval"
          text="Budget > $500/day"
          tint={colors.red}
          delay={186}
        />
      </div>
    </AbsoluteFill>
  );
};
