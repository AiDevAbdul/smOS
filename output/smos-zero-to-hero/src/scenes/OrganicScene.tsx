import React from "react";
import { AbsoluteFill } from "remotion";
import { PhaseHeader } from "../components/PhaseHeader";
import { FlowNode, FlowArrow } from "../components/FlowNode";

export const OrganicScene: React.FC = () => {
  return (
    <AbsoluteFill style={{ padding: "0 56px", justifyContent: "center", alignItems: "center" }}>
      <PhaseHeader eyebrow="Phase 3 · Organic" title="Own the feed, not just the ad" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <FlowNode cmd="/content-plan" label="Pillars + Social-SEO calendar" delay={10} />
        <FlowArrow delay={30} vertical />
        <FlowNode cmd="/publish" label="FB + IG automated" delay={38} />
        <FlowArrow delay={58} vertical />
        <FlowNode cmd="/inbox" label="Comments, DMs, mentions" delay={66} />
        <FlowArrow delay={86} vertical />
        <FlowNode cmd="/listening" label="Competitor benchmark" delay={94} />
      </div>
    </AbsoluteFill>
  );
};
