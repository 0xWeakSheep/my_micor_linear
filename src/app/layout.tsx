import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const appSans = Inter({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

const appMono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Orbit",
    template: "%s · Orbit",
  },
  description:
    "A fast, keyboard-first workspace for issues, projects, cycles, and product planning.",
  applicationName: "Orbit",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#101011" },
  ],
};

const themeScript = `
  try {
    const saved = localStorage.getItem('orbit-theme');
    const dark = saved ? saved === 'dark' : true;
    document.documentElement.classList.toggle('dark', dark);
  } catch (_) {
    document.documentElement.classList.add('dark');
  }
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${appSans.variable} ${appMono.variable}`}>
        {children}
        <Toaster
          position="bottom-center"
          theme="system"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--surface-raised)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
            },
          }}
        />
      </body>
    </html>
  );
}
