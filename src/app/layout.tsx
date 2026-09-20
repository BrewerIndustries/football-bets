import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Bets",
  description:
    "Track football bets end to end — teams picked, wager, winnings and results — with Kalshi positions imported automatically and games graded from the live NFL schedule.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const isDev = process.env.JARVIS_ENV === "dev";
  return (
    <html lang="en">
      <body>
        {isDev && <div className="env-banner">Development · this is the dev site</div>}
        {children}
      </body>
    </html>
  );
}
