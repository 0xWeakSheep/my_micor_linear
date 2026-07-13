import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Micro Linear",
    template: "%s · Micro Linear",
  },
  description:
    "A fast, keyboard-first workspace for issues, projects, cycles, and product planning.",
  applicationName: "Micro Linear",
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
    const saved = localStorage.getItem('micro-linear-theme') ?? localStorage.getItem('orbit-theme');
    if (saved) localStorage.setItem('micro-linear-theme', saved);
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
      <body>
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
