import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Background } from "./Background";
import { SceneFade } from "./components/SceneFade";
import { TitleScene } from "./scenes/TitleScene";
import { SalesScene } from "./scenes/SalesScene";
import { ZeroStartScene } from "./scenes/ZeroStartScene";
import { FoundationScene } from "./scenes/FoundationScene";
import { LaunchScene } from "./scenes/LaunchScene";
import { OrganicScene } from "./scenes/OrganicScene";
import { ReportScene } from "./scenes/ReportScene";

export const SCENES = [
  { name: "title", start: 0, duration: 140, Comp: TitleScene },
  { name: "sales", start: 120, duration: 200, Comp: SalesScene },
  { name: "zerostart", start: 300, duration: 260, Comp: ZeroStartScene },
  { name: "foundation", start: 540, duration: 200, Comp: FoundationScene },
  { name: "launch", start: 720, duration: 260, Comp: LaunchScene },
  { name: "organic", start: 960, duration: 200, Comp: OrganicScene },
  { name: "report", start: 1140, duration: 260, Comp: ReportScene },
];

export const TOTAL_DURATION = 1400;

// SFX cue sheet — synced to real animation beats read from each scene file.
// Whoosh: plays right as each new scene's content starts revealing (scene `start`).
// Tick: plays on each scene's first FlowNode reveal (that node's `delay`, local frame).
// Chime: plays on the final "smOS" logo reveal in ReportScene (outroLocal start = 200).
const WHOOSH_FRAMES = [0, 120, 300, 540, 720, 960, 1140];
const TICK_FRAMES = [130, 310, 550, 730, 970, 1150]; // sales, zerostart, foundation, launch, organic, report
const CHIME_FRAME = 1140 + 200;

export const SmosVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      {SCENES.map(({ name, start, duration, Comp }) => (
        <Sequence key={name} from={start} durationInFrames={duration} name={name}>
          {name === "report" ? (
            <Comp />
          ) : (
            <SceneFade duration={duration}>
              <Comp />
            </SceneFade>
          )}
        </Sequence>
      ))}

      {WHOOSH_FRAMES.map((f) => (
        <Sequence key={`whoosh-${f}`} from={f} durationInFrames={30}>
          <Audio src={staticFile("whoosh.wav")} volume={0.35} />
        </Sequence>
      ))}
      {TICK_FRAMES.map((f) => (
        <Sequence key={`tick-${f}`} from={f} durationInFrames={12}>
          <Audio src={staticFile("tick.wav")} volume={0.4} />
        </Sequence>
      ))}
      <Sequence from={CHIME_FRAME} durationInFrames={40}>
        <Audio src={staticFile("chime.wav")} volume={0.45} />
      </Sequence>
    </AbsoluteFill>
  );
};
