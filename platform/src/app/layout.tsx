import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RateTap",
  description: "Plataforma de gestión de reseñas para restaurantes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${sans.variable} antialiased`} style={{ fontFamily: 'var(--font-dm-sans, "DM Sans", sans-serif)' }}>
        {children}
      </body>
    </html>
  );
}
