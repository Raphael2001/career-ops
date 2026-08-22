import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-sans",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fira-code",
});

export const metadata: Metadata = {
  title: "career-ops monitor",
  description: "LiteLLM model health, discovery-scan status, container status.",
};

// Runs before paint so the theme is right on first frame -- a client
// component that toggled the class after mount would flash the wrong
// theme for one frame on every load. Priority: stored choice, then system
// preference, defaulting dark (this app's original design) only when the
// system reports no preference either way.
const NO_FLASH_THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('monitor-theme');var dark=s==='light'?false:(s==='dark'?true:!window.matchMedia('(prefers-color-scheme: light)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="flex h-dvh font-sans antialiased">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
