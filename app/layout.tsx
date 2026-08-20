import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { HeartbeatBeacon } from "@/components/players/HeartbeatBeacon";
import { AuthStatusBar } from "@/components/players/AuthStatusBar";
import { MainNav } from "@/components/navigation/MainNav";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { NotificationBell } from "@/components/notifications/NotificationBell";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Battle Card Game V2",
  description: "Sbírej karty středověkých vojsk a utkej se v aréně.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        <HeartbeatBeacon />
        <div className="relative pr-12">
          <AuthStatusBar />
          <div className="absolute inset-y-0 right-4 flex items-center">
            <NotificationBell />
          </div>
        </div>
        <MainNav />
        {children}
        <ChatWidget />
      </body>
    </html>
  );
}
