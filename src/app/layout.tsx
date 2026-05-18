import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import AppShell from "@/components/AppShell"
import { ApiKeysProvider } from "@/components/ApiKeysProvider"

const unique = localFont({
  variable: "--font-unique",
  display: "swap",
  src: [
    { path: "./fonts/Unique-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Unique-Regular.woff2", weight: "400", style: "normal" },
  ],
})

const nohemi = localFont({
  variable: "--font-nohemi",
  display: "swap",
  src: [
    { path: "./fonts/Nohemi-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Nohemi-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Nohemi-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Nohemi-Bold.woff2", weight: "700", style: "normal" },
  ],
})

export const metadata: Metadata = {
  title: "L'Enricher · enrichis ton CSV",
  description: "BYOK · sans compte · sans serveur. Enrichis tes CSV de prospects avec Claude ou GPT, en local.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${unique.variable} ${nohemi.variable}`}>
      <body>
        <ApiKeysProvider>
          <AppShell>{children}</AppShell>
        </ApiKeysProvider>
      </body>
    </html>
  )
}
