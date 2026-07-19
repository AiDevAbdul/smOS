import React from "react";
import { AbsoluteFill } from "remotion";
import { PhaseHeader } from "../components/PhaseHeader";
import { FlowNode, FlowArrow } from "../components/FlowNode";

export const SalesScene: React.FC = () => {
  return (
    <AbsoluteFill style={{ padding: "0 56px", justifyContent: "center", alignItems: "center" }}>
      <PhaseHeader eyebrow="Phase 5 · Agency-OS" title="Win the client" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <FlowNode cmd="/crm" label="Lead enters the pipeline" delay={10} />
        <FlowArrow delay={30} vertical />
        <FlowNode cmd="/pre-audit" label="Public-data scorecard, no client access" delay={38} />
        <FlowArrow delay={58} vertical />
        <FlowNode cmd="/proposal" label="Branded pitch from the audit" delay={66} />
        <FlowArrow delay={86} vertical />
        <FlowNode cmd="won" label="Deal closed → onboarding begins" delay={94} accent />
      </div>
    </AbsoluteFill>
  );
};
