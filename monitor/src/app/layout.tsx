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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${firaSans.variable} ${firaCode.variable}`}>
      <body className="flex h-dvh font-sans antialiased">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-6">{children}</div>
        </main>
      </body>
    </html>
  );
}
