import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { colors, type } from "../styles";
import { ArrowRight, UserCheck } from "lucide-react";

export const FlowNode: React.FC<{
  cmd: string;
  label: string;
  delay: number;
  gate?: boolean;
  accent?: boolean;
}> = ({ cmd, label, delay, gate, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - delay;

  const progress = spring({
    frame: local,
    fps,
    from: 0,
    to: 1,
    durationInFrames: 22,
    config: { damping: 16, stiffness: 160, mass: 0.8 },
  });

  const opacity = interpolate(local, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(progress, [0, 1], [26, 0]);
  const scale = interpolate(progress, [0, 1], [0.92, 1]);

  const borderColor = gate ? colors.orange : colors.panelBorder;

  return (
    <div
      style={{
        position: "relative",
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        background: colors.panel,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 18,
        padding: "16px 20px",
        minWidth: 220,
        maxWidth: 320,
        boxShadow: gate
          ? "0 0 0 1px rgba(255,159,10,0.2), 0 12px 30px rgba(0,0,0,0.35)"
          : "0 12px 30px rgba(0,0,0,0.35)",
      }}
    >
      {gate && (
        <div
          style={{
            position: "absolute",
            top: -16,
            left: 20,
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: colors.orange,
            color: "#241a00",
            padding: "4px 12px",
            borderRadius: 20,
            ...type.badge,
            fontSize: 12,
          }}
        >
          <UserCheck size={13} strokeWidth={2.5} />
          Human gate
        </div>
      )}
      <div
        style={{
          ...type.node,
          color: gate ? colors.orange : colors.blue,
          marginBottom: 6,
        }}
      >
        {cmd}
      </div>
      <div style={{ ...type.nodeLabel, color: colors.textSecondary, maxWidth: 260 }}>
        {label}
      </div>
    </div>
  );
};

export const FlowArrow: React.FC<{ delay: number; vertical?: boolean }> = ({
  delay,
  vertical,
}) => {
  const frame = useCurrentFrame();
  const local = frame - delay;
  const opacity = interpolate(local, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const offset = interpolate(local, [0, 12], [-10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        opacity,
        transform: vertical
          ? `translateY(${offset}px) rotate(90deg)`
          : `translateX(${offset}px)`,
        color: colors.textDim,
        display: "flex",
        alignItems: "center",
        padding: vertical ? "4px 0" : "0 6px",
      }}
    >
      <ArrowRight size={22} strokeWidth={2} />
    </div>
  );
};
