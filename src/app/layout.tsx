import type { Metadata } from "next"
import Link from "next/link"
import { Geist } from "next/font/google"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "CSV Enricher",
  description: "Enrichis tes CSV de prospects avec OpenAI ou Anthropic — apporte tes propres clés, traite localement.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        <header className="border-b border-gray-200">
          <nav className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold text-lg">
              csv-enricher
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-gray-600 hover:text-black">Enrichir</Link>
              <Link href="/settings" className="text-gray-600 hover:text-black">Settings</Link>
              <a
                href="https://github.com/seeds-agency/csv-enricher"
                target="_blank"
                rel="noreferrer"
                className="text-gray-600 hover:text-black"
              >
                GitHub
              </a>
            </div>
          </nav>
        </header>

        <main className="flex-1 px-4">{children}</main>

        <footer className="border-t border-gray-200 mt-12">
          <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-gray-500 flex items-center justify-between">
            <span>
              Made by{' '}
              <a href="https://seeds-agency.com" target="_blank" rel="noreferrer" className="underline hover:text-black">
                seeds
              </a>
            </span>
            <span>MIT licensed · BYOK</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
