import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "PortPulse | 수출 선적 의사결정 대시보드",
    template: "%s | PortPulse",
  },
  description:
    "수출 중소기업의 선적 계획, 포워더 견적, 운임지수, 환율과 물류 뉴스를 한곳에서 비교하는 의사결정 대시보드입니다.",
  applicationName: "PortPulse",
  openGraph: {
    title: "PortPulse — 선적 결정을 더 빠르고 근거 있게",
    description:
      "견적·납기·운임지수·환율을 연결해 다음 행동과 결정기한을 제안합니다.",
    type: "website",
    locale: "ko_KR",
    siteName: "PortPulse",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "PortPulse — 선적 결정을 더 빠르고 근거 있게" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PortPulse — 수출 선적 의사결정 대시보드",
    description: "견적·납기·시장 근거를 한 화면에서 확인하세요.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1f33",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
