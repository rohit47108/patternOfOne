import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pattern of One",
    short_name: "Pattern of One",
    description: "A portrait of how you move, speak, pause, and change.",
    start_url: "/",
    display: "standalone",
    background_color: "#080907",
    theme_color: "#080907",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
