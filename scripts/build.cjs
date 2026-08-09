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
 * Outer call (Cloudflare):  next build → opennextjs-cloudflare build → stub @vercel/og
 * Inner call (by OpenNext): next build only (no recursion)
 *
 * Additionally: after OpenNext build, replaces @vercel/og files with empty
 * stubs to reduce Worker size below Cloudflare's free plan 3 MiB limit.
 * @vercel/og (~2.2 MiB) is Next.js's OG image generation module. This project
 * has no opengraph-image routes, so it's never used at runtime.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Replace @vercel/og files with empty stubs after OpenNext build.
 *
 * wrangler's esbuild follows module references in handler.mjs and includes
 * @vercel/og files from node_modules/. By replacing them with empty stubs,
 * the Worker bundle shrinks by ~2.2 MiB (uncompressed).
 *
 * This is safe because:
 * - The project has no opengraph-image routes
 * - No code imports ImageResponse from @vercel/og
 * - The OG code paths in Next.js runtime are never reached
 */
function stubVercelOgFiles() {
  const ogDir = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "compiled",
    "@vercel",
    "og"
  );

  if (!fs.existsSync(ogDir)) {
    console.log("[build] @vercel/og directory not found, skipping stub");
    return;
  }

  // @vercel/og has "type": "module" in package.json — use ESM stubs for JS
  const ESM_STUB = "export default {};\n";

  let stubbedCount = 0;
  let savedBytes = 0;

  function processDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        processDir(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = fs.statSync(fullPath);
      const originalSize = stat.size;

      if (entry.name.endsWith(".wasm")) {
        // Write empty file (0 bytes) — wrangler includes it as a binary asset
        fs.writeFileSync(fullPath, Buffer.alloc(0));
        console.log(
          `[build] Stubbed ${path.relative(ogDir, fullPath)} (${(originalSize / 1024).toFixed(1)} KiB → 0 bytes)`
        );
        savedBytes += originalSize;
        stubbedCount++;
      } else if (
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".mjs") ||
        entry.name.endsWith(".cjs")
      ) {
        // Write ESM empty module
        fs.writeFileSync(fullPath, ESM_STUB);
        console.log(
          `[build] Stubbed ${path.relative(ogDir, fullPath)} (${(originalSize / 1024).toFixed(1)} KiB → ESM stub)`
        );
        savedBytes += originalSize;
        stubbedCount++;
      } else if (entry.name.endsWith(".ttf")) {
        // Font files — also stub them if bundled
        fs.writeFileSync(fullPath, Buffer.alloc(0));
        console.log(
          `[build] Stubbed ${path.relative(ogDir, fullPath)} (${(originalSize / 1024).toFixed(1)} KiB → 0 bytes)`
        );
        savedBytes += originalSize;
        stubbedCount++;
      }
    }
  }

  processDir(ogDir);

  console.log(
    `[build] Stubbed ${stubbedCount} @vercel/og files, saved ~${(savedBytes / 1024).toFixed(1)} KiB`
  );
}

const isInnerBuild = process.env.OPENNEXT_INVOKED === "1";

if (isInnerBuild) {
  // Called by opennextjs-cloudflare build internally — just build Next.js
  console.log("[build] Inner call detected, running next build only");
  execSync("npx next build", { stdio: "inherit" });
} else {
  // Called by Cloudflare directly — build Next.js then OpenNext
  console.log("[build] Outer call, building Next.js + OpenNext");
  execSync("npx next build", { stdio: "inherit" });
  console.log("[build] Next.js build done, starting OpenNext build");
  execSync("npx opennextjs-cloudflare build", {
    stdio: "inherit",
    env: { ...process.env, OPENNEXT_INVOKED: "1" },
  });
  console.log("[build] OpenNext build complete, stubbing @vercel/og files");
  stubVercelOgFiles();
  console.log("[build] All done");
}
