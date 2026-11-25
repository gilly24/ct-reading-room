// Copies the DICOM decoders' WebAssembly files into public/codecs, where the
// loader is told to find them (wasmBasePath in src/viewer/cornerstone.ts).
// Runs before dev and build; the folder is not committed.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "codecs");
const fromLoader = createRequire(createRequire(import.meta.url).resolve("@cornerstonejs/dicom-image-loader"));

// The module the loader imports from each codec, and the .wasm it needs beside it.
const codecs = {
  "@cornerstonejs/codec-charls/decodewasmjs": ["charlswasm_decode.wasm"],
  "@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs": ["libjpegturbowasm_decode.wasm"],
  "@cornerstonejs/codec-openjpeg/decodewasmjs": ["openjpegwasm_decode.wasm"],
  "@cornerstonejs/codec-openjph/wasmjs": ["openjphjs.wasm"],
  "@cornerstonejs/codec-libjxl/decodewasmjs": ["jpegxlwasm_decode.wasm"],
};

mkdirSync(out, { recursive: true });
for (const [pkg, files] of Object.entries(codecs)) {
  const dist = dirname(fromLoader.resolve(pkg));
  const available = new Set(readdirSync(dist));
  for (const file of files) {
    if (!available.has(file)) throw new Error(`${pkg} has no ${file}`);
    copyFileSync(join(dist, file), join(out, file));
  }
}
console.log(`codecs copied to ${out}`);
