import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { colors, type, gradientBrand } from "../styles";

export const PhaseHeader: React.FC<{
  eyebrow: string;
  title: string;
  delay?: number;
}> = ({ eyebrow, title, delay = 0 }) => {
  const frame = useCurrentFrame();
  const local = frame - delay;

  const opacity = interpolate(local, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(local, [0, 16], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        marginBottom: 36,
        textAlign: "center",
      }}
    >
      <div style={{ ...type.eyebrow, color: colors.blue, marginBottom: 10 }}>
        {eyebrow}
      </div>
      <div
        style={{
          ...type.h1,
          backgroundImage: gradientBrand,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
        }}
      >
        {title}
      </div>
    </div>
  );
};
