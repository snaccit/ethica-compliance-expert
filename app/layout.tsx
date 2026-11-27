import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import Nav from "@/components/Nav";
import TopBar from "@/components/TopBar";
import { BOOT_ID } from "@/lib/boot";
import "./globals.css";

export const metadata: Metadata = {
  title: "Compliance Expert · DPP-Fragen mit geprüfter Quelle",
  description: "Fachfragen zu digitalen Produktpässen mit geprüften Fundstellen und Stichtagen",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <meta name="ce-boot" content={BOOT_ID} />
      </head>
      <body>
        <div className="shell">
          <Nav />
          <div className="main">
            <TopBar />
            <div className="content">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
