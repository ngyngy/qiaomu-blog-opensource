/**
 * Smart build script for Cloudflare Workers + OpenNext.
 *
 * Problem: `opennextjs-cloudflare build` internally calls `npm run build` to
 * build the Next.js app. If the `build` script itself runs
 * `opennextjs-cloudflare build`, it creates infinite recursion.
 *
 * Solution: Use the OPENNEXT_INVOKED env var to detect whether we're being
 * called by OpenNext (inner call) or by Cloudflare directly (outer call).
 *
 * Outer call (Cloudflare):  next build → opennextjs-cloudflare build
 * Inner call (by OpenNext): next build only (no recursion)
 *
 * Additionally: patches .nft.json files to remove @vercel/og references,
 * so OpenNext excludes the OG image generation module from the bundle.
 * This reduces the Worker size by ~2.2 MiB, keeping it under the
 * Cloudflare free plan 3 MiB limit.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Remove @vercel/og references from .nft.json trace files.
 *
 * OpenNext's patchVercelOgLibrary() scans .nft.json files to detect if
 * @vercel/og is used. If references are found, it includes the OG module
 * (~2.2 MiB) in the Worker bundle. Since this project has no
 * opengraph-image routes, we strip these references so OpenNext
 * automatically excludes @vercel/og.
 */
function stripVercelOgFromNft() {
  const serverDir = path.join(process.cwd(), ".next", "server");
  if (!fs.existsSync(serverDir)) {
    console.log("[build] No .next/server directory found, skipping OG strip");
    return;
  }

  function findNftFiles(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findNftFiles(fullPath));
      } else if (entry.name.endsWith(".nft.json")) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const nftFiles = findNftFiles(serverDir);
  let patched = 0;

  for (const nftFile of nftFiles) {
    const raw = fs.readFileSync(nftFile, "utf8");
    const content = JSON.parse(raw);
    if (!content.files) continue;

    const originalLength = content.files.length;
    content.files = content.files.filter(
      (f) => !f.includes("@vercel/og")
    );

    if (content.files.length !== originalLength) {
      fs.writeFileSync(nftFile, JSON.stringify(content));
      patched++;
    }
  }

  console.log(
    `[build] Stripped @vercel/og from ${patched}/${nftFiles.length} .nft.json files`
  );
}

const isInnerBuild = process.env.OPENNEXT_INVOKED === "1";

if (isInnerBuild) {
  // Called by opennextjs-cloudflare build internally — just build Next.js
  console.log("[build] Inner call detected, running next build only");
  execSync("npx next build", { stdio: "inherit" });
  // Strip @vercel/og from trace files BEFORE OpenNext bundles
  stripVercelOgFromNft();
} else {
  // Called by Cloudflare directly — build Next.js then OpenNext
  console.log("[build] Outer call, building Next.js + OpenNext");
  execSync("npx next build", { stdio: "inherit" });
  console.log("[build] Next.js build done, starting OpenNext build");
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
    env: { ...process.env, OPENNEXT_INVOKED: "1" },
  });
  console.log("[build] OpenNext build complete");
}
