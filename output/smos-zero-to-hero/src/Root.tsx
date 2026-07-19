import React from "react";
import { Composition } from "remotion";
import { SmosVideo, TOTAL_DURATION } from "./SmosVideo";

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="SmosZeroToHero"
        component={SmosVideo}
        durationInFrames={TOTAL_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
