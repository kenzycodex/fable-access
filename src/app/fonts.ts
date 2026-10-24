import localFont from "next/font/local";

export const inter = localFont({
  src: [
    { path: "./fonts/Inter-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Inter-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Inter-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Inter-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

export const titillium = localFont({
  src: [
    { path: "./fonts/TitilliumWeb-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/TitilliumWeb-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/TitilliumWeb-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-titillium",
  display: "swap",
});

export const permanentMarker = localFont({
  src: [{ path: "./fonts/PermanentMarker.woff2", weight: "400", style: "normal" }],
  variable: "--font-permanent-marker",
  display: "swap",
});
