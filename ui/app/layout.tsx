import type { Metadata } from "next";
import "../../design-system/smos-design-system.css";
import "../../design-system/smos-app.css";

export const metadata: Metadata = {
  title: "smOS Console",
  description: "smOS operator console",
};

// Sets data-theme from localStorage (fallback: OS preference) before first
// paint, mirroring scripts/lib/design_system.js's THEME_BOOTSTRAP_SCRIPT so
// the app shell and embedded reports never flash the wrong theme.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("smos-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);var d=localStorage.getItem("smos-density");document.documentElement.setAttribute("data-density",d==="comfortable"?"comfortable":"compact");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Semi+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
