import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stickerfolio – Stickeralben verwalten",
    short_name: "Stickerfolio",
    description: "Stickeralben, fehlende Sticker und Doubletten verwalten.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7fb",
    theme_color: "#f6f7fb",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
