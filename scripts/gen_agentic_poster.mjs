import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { composePoster } from "./lib/poster_compose.js";

const root = process.cwd();
const brand = JSON.parse(readFileSync(resolve(root, "clients/abdulwahabai/brand_profile.json"), "utf8"));

const logoBuf = readFileSync(resolve(root, "clients/abdulwahabai/assets/logo-white.svg"));
brand.visual.logo.primary_url = `data:image/svg+xml;base64,${logoBuf.toString("base64")}`;
brand.visual.logo.reverse_url = brand.visual.logo.primary_url;

const backgroundBuffer = readFileSync(resolve(root, "clients/abdulwahabai/assets/profile.png"));

// On-brand, educational voice — "teach, don't gatekeep", plain English, direct
// CTA. Avoids the restricted words (revolutionary / guaranteed / cheap) and hype.
const copy = {
  eyebrow: "New Post",
  headline: "Introduction to Agentic AI",
  subhead: "What it is and how it works — in plain English, with Abdul Wahab.",
  benefits: [
    "What makes AI ‘agentic’",
    "How agents plan and take action",
    "Where to start in your business",
  ],
  cta: "Read the full post",
};

const contact = {
  phone: "+92 348 9848136",
  website_display: "abdulwahabai.com",
};

// 4:5 (not 1:1) per the image-gen layout rules: this copy is text-heavy (3
// benefit bullets + CTA), and a square canvas gives too little headroom
// before the headline meets a centered portrait subject's face. The source
// photo is also centered, so shift it right ("left" keeps the left/subject-
// right side of the cover-fit crop) to clear the top-left logo too.
const png = await composePoster({ backgroundBuffer, brand, contact, copy, width: 1080, height: 1350, position: "left" });

mkdirSync(resolve(root, "clients/abdulwahabai/generated"), { recursive: true });
const outPath = resolve(root, "clients/abdulwahabai/generated/agentic_ai_poster.png");
writeFileSync(outPath, png);
console.log("Wrote", outPath);
