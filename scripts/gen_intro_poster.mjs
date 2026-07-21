import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { composePoster } from "./lib/poster_compose.js";

const root = process.cwd();
const brand = JSON.parse(readFileSync(resolve(root, "clients/abdulwahabai/brand_profile.json"), "utf8"));

const logoBuf = readFileSync(resolve(root, "clients/abdulwahabai/assets/logo-white.svg"));
brand.visual.logo.primary_url = `data:image/svg+xml;base64,${logoBuf.toString("base64")}`;
brand.visual.logo.reverse_url = brand.visual.logo.primary_url;

const backgroundBuffer = readFileSync(resolve(root, "clients/abdulwahabai/assets/profile.png"));

const copy = {
  eyebrow: "",
  headline: "MEET ABDUL WAHAB",
  subhead: "AI Automation Founder & Trainer",
  benefits: [],
  cta: "Message on WhatsApp",
};

const contact = {
  phone: "+92 348 9848136",
  website_display: "abdulwahabai.com",
};

// The source photo is a centered portrait; shift it right ("left" keeps the
// left/subject-right side of the cover-fit crop) so the subject clears the
// top-left logo instead of the wordmark's trailing dot landing on the cap.
const png = await composePoster({ backgroundBuffer, brand, contact, copy, width: 1080, height: 1350, position: "left" });

mkdirSync(resolve(root, "clients/abdulwahabai/generated"), { recursive: true });
const outPath = resolve(root, "clients/abdulwahabai/generated/intro_poster.png");
writeFileSync(outPath, png);
console.log("Wrote", outPath);
