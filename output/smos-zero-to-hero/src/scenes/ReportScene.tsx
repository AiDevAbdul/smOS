import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { PhaseHeader } from "../components/PhaseHeader";
import { FlowNode, FlowArrow } from "../components/FlowNode";
import { colors, type, gradientBrand } from "../styles";

export const ReportScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const flowOpacity = interpolate(frame, [140, 160], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineOpacity = interpolate(frame, [150, 175], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineY = interpolate(frame, [150, 175], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const outroLocal = frame - 200;
  const outroScale = spring({
    frame: outroLocal,
    fps,
    from: 0.9,
    to: 1,
    durationInFrames: 24,
    config: { damping: 14 },
  });
  const outroOpacity = interpolate(outroLocal, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const contactLocal = frame - 215;
  const contactOpacity = interpolate(contactLocal, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const contactY = interpolate(contactLocal, [0, 20], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ padding: "0 56px", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity: flowOpacity }}>
        <PhaseHeader eyebrow="Phase 4 · Prove it" title="Report, and go again" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <FlowNode cmd="/report" label="Weekly client report" delay={10} />
          <FlowArrow delay={30} vertical />
          <FlowNode cmd="/before-after" label="vs. immutable baseline" delay={38} />
          <FlowArrow delay={58} vertical />
          <FlowNode cmd="/monthly-review" label="Structural health audit" delay={66} />
          <FlowArrow delay={86} vertical />
          <FlowNode cmd="/bundle" label="One shareable client hub" delay={94} />
        </div>
      </div>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div
          style={{
            opacity: lineOpacity,
            transform: `translateY(${lineY}px)`,
            ...type.h2,
            color: colors.textPrimary,
            maxWidth: 780,
            marginBottom: 34,
          }}
        >
          A business that started as nothing now runs itself.
        </div>
        <div
          style={{
            opacity: outroOpacity,
            transform: `scale(${outroScale})`,
            ...type.hero,
            fontSize: 68,
            backgroundImage: gradientBrand,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            marginBottom: 34,
          }}
        >
          smOS
        </div>
        <div
          style={{
            opacity: contactOpacity,
            transform: `translateY(${contactY}px)`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div style={{ ...type.nodeLabel, fontSize: 17, color: colors.textSecondary, letterSpacing: "0.01em" }}>
            aidevabdul@gmail.com
          </div>
          <div style={{ ...type.badge, fontSize: 13, color: colors.textDim }}>
            FB · IG · TikTok: @aidevabdul
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
