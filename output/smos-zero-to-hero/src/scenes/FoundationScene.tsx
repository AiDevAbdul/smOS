import React from "react";
import { AbsoluteFill } from "remotion";
import { PhaseHeader } from "../components/PhaseHeader";
import { FlowNode, FlowArrow } from "../components/FlowNode";

export const FoundationScene: React.FC = () => {
  return (
    <AbsoluteFill style={{ padding: "0 56px", justifyContent: "center", alignItems: "center" }}>
      <PhaseHeader eyebrow="Phase 1 · Foundation" title="Understand the landscape" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <FlowNode cmd="/audit" label="Health score + immutable baseline" delay={10} />
        <FlowArrow delay={30} vertical />
        <FlowNode cmd="/research" label="Competitor research" delay={38} />
        <FlowArrow delay={58} vertical />
        <FlowNode cmd="/audience-map" label="Targeting plan" delay={66} />
        <FlowArrow delay={86} vertical />
        <FlowNode cmd="/strategy-brief" label="Campaign strategy" delay={94} />
      </div>
    </AbsoluteFill>
  );
};
