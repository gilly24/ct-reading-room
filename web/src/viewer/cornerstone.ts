// Cornerstone3D set-up, done once per page. Cornerstone is the image engine
// under the OHIF viewer: it parses the DICOM, applies the window and draws the
// measurement tools.

import { init as initCore } from "@cornerstonejs/core";
import { init as initDicomLoader } from "@cornerstonejs/dicom-image-loader";
import {
  addTool,
  init as initTools,
  LengthTool,
  PanTool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
} from "@cornerstonejs/tools";

let ready: Promise<void> | null = null;

export function initCornerstone(): Promise<void> {
  ready ??= (async () => {
    initCore();
    initDicomLoader({
      maxWebWorkers: Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)),
      // Compressed DICOM is decoded by WebAssembly codecs; scripts/copy-codecs.mjs puts them here.
      wasmBasePath: new URL(`${import.meta.env.BASE_URL}codecs/`, window.location.href).href,
    });
    initTools();
    for (const tool of [WindowLevelTool, PanTool, ZoomTool, StackScrollTool, LengthTool]) addTool(tool);
  })();
  return ready;
}

export const TOOLS = {
  window: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  measure: LengthTool.toolName,
} as const;

export type ToolChoice = keyof typeof TOOLS;
