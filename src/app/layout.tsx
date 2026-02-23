import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Leaf & Brew — Checkout",
  description: "Order ahead checkout for Leaf & Brew Tea Shop",
};

// Derive the correct SDK URL from the environment setting at request time.
// "production" → https://web.squarecdn.com/v1/square.js
// anything else  → https://sandbox.web.squarecdn.com/v1/square.js
const SQUARE_SDK_URL =
  process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>
        <Script src={SQUARE_SDK_URL} strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}