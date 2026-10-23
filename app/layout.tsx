import "./globals.css";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

// Same fonts as the design prototype: Figtree for text, Bricolage Grotesque for headings.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

const metadataBase = new URL("https://ovelo-five.vercel.app/");

export const metadata = {
  metadataBase,
  title: "Ovelo — Buy resale tickets safely",
  description: "Ovelo checks resale event tickets for risk before you pay. Fake demo tickets only. Runs on Base Sepolia with test money only.",
  openGraph: {
    type: "website",
    url: metadataBase,
    title: "Ovelo — Buy resale tickets safely",
    description: "Ovelo checks resale event tickets for risk before you pay. Fake demo tickets only. Runs on Base Sepolia with test money only.",
    siteName: "Ovelo",
    images: [{ url: "/logo.png", width: 1024, height: 1024, alt: "Ovelo logo" }],
  },
  twitter: {
    card: "summary",
    title: "Ovelo — Buy resale tickets safely",
    description: "Ovelo checks resale event tickets for risk before you pay. Fake demo tickets only. Runs on Base Sepolia with test money only.",
    images: ["/logo.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans antialiased", figtree.variable, bricolage.variable, jetBrainsMono.variable)}>
      <body>{children}</body>
    </html>
  );
}
