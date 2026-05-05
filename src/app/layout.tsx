import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Providers from "@/components/Providers";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "KMD - Korea Medicine Data",
  description: "의약품 영업사원을 위한 대체의약품 검색 및 제안서 서비스",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={geist.variable}>
      <body className="min-h-screen bg-gray-50 antialiased">
        <Providers>
          <Navbar />
          <main className="max-w-screen-2xl mx-auto px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
