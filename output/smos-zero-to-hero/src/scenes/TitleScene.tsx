import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { colors, type, gradientBrand } from "../styles";

export const TitleScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const smosScale = spring({ frame, fps, from: 0.85, to: 1, durationInFrames: 24, config: { damping: 14 } });
  const smosOpacity = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });

  const arrowOpacity = interpolate(frame, [40, 58], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zeroOpacity = interpolate(frame, [55, 75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const zeroY = interpolate(frame, [55, 75], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const heroOpacity = interpolate(frame, [70, 90], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const heroY = interpolate(frame, [70, 90], [20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const subOpacity = interpolate(frame, [95, 115], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div
        style={{
          ...type.hero,
          fontSize: 64,
          opacity: smosOpacity,
          transform: `scale(${smosScale})`,
          color: colors.textPrimary,
          marginBottom: 8,
          letterSpacing: "-0.02em",
        }}
      >
        smOS
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
        <span style={{ ...type.hero, opacity: zeroOpacity, transform: `translateY(${zeroY}px)`, color: colors.textPrimary }}>
          Zero
        </span>
        <span style={{ ...type.hero, opacity: arrowOpacity, color: colors.textDim }}>→</span>
        <span
          style={{
            ...type.hero,
            opacity: heroOpacity,
            transform: `translateY(${heroY}px)`,
            backgroundImage: gradientBrand,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          Hero
        </span>
      </div>
      <div style={{ ...type.body, opacity: subOpacity, color: colors.textSecondary, marginTop: 30, maxWidth: 620 }}>
        The autonomous social media operating system.
      </div>
    </AbsoluteFill>
  );
};
