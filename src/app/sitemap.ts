import type { MetadataRoute } from "next";

const BASE = "https://fable.ng";

// The pages built in this project.
const routes = ["", "/why-fable", "/platform", "/pricing"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return routes.map((route) => ({
    url: `${BASE}${route}`,
    lastModified,
    changeFrequency: "monthly",
    priority: route === "" ? 1 : 0.8,
  }));
}
