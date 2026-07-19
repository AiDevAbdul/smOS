import React from "react";
import { AbsoluteFill } from "remotion";
import { PhaseHeader } from "../components/PhaseHeader";
import { FlowNode, FlowArrow } from "../components/FlowNode";

export const ZeroStartScene: React.FC = () => {
  return (
    <AbsoluteFill style={{ padding: "0 56px", justifyContent: "center", alignItems: "center" }}>
      <PhaseHeader eyebrow="Phase 0 · Zero-Start" title="Build the brand from nothing" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <FlowNode cmd="/brand-strategy" label="Positioning" delay={10} gate />
        <FlowArrow delay={30} vertical />
        <FlowNode cmd="/brand-name" label="Name + verbal identity" delay={38} gate />
        <FlowArrow delay={58} vertical />
        <FlowNode cmd="/brand-visual" label="Logo, color, type" delay={66} gate />
        <FlowArrow delay={126} vertical />
        <FlowNode cmd="/brand-book" label="Guidelines, auto-assembled" delay={110} />
        <FlowArrow delay={130} vertical />
        <FlowNode cmd="/brand-social" label="Profiles, bios, templates" delay={138} />
        <FlowArrow delay={158} vertical />
        <FlowNode cmd="/setup-accounts" label="Ad account, pixel, system user" delay={166} />
      </div>
    </AbsoluteFill>
  );
};
