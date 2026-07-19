import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { colors } from "./styles";

export const Background: React.FC = () => {
  const frame = useCurrentFrame();

  const x1 = interpolate(frame, [0, 1500], [10, 60], { extrapolateRight: "clamp" });
  const y1 = interpolate(frame, [0, 1500], [20, 70], { extrapolateRight: "clamp" });
  const x2 = interpolate(frame, [0, 1500], [80, 30], { extrapolateRight: "clamp" });
  const y2 = interpolate(frame, [0, 1500], [70, 20], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.canvas }}>
      <AbsoluteFill
        style={{
          background: `
            radial-gradient(circle at ${x1}% ${y1}%, rgba(0,113,227,0.16), transparent 45%),
            radial-gradient(circle at ${x2}% ${y2}%, rgba(175,82,222,0.14), transparent 45%)
          `,
          filter: "blur(2px)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse at center, black 0%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 0%, transparent 75%)",
        }}
      />
    </AbsoluteFill>
  );
};
