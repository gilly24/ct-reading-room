import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The DICOM loader starts its decoders as module workers and loads WASM codecs
  // relative to itself, which pre-bundling would break.
  // Dev server only. The DICOM loader is left unbundled because it starts its
  // decoders as module workers. The metadata and utils packages hold the shared
  // DICOM metadata cache, so they are left unbundled too: otherwise core would
  // get its own copy, and images the loader parsed would have no metadata.
  // The decoders are CommonJS, so they are pre-bundled into ES modules here;
  // their .wasm files are served from public/codecs (scripts/copy-codecs.mjs).
  optimizeDeps: {
    exclude: ["@cornerstonejs/dicom-image-loader", "@cornerstonejs/metadata", "@cornerstonejs/utils"],
    include: [
      "dicom-parser",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-charls/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjpeg/decodewasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjph/wasmjs",
      "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjxl/decodewasmjs",
    ],
  },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
