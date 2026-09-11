import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: [
    "src/collector/index.ts",
    "src/server/index.ts",
    "src/tui/index.ts",
  ],
  outdir: "dist",
  target: "bun",
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
