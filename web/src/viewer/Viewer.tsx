import {
  cache,
  Enums,
  eventTarget,
  imageLoader,
  RenderingEngine,
  type Types,
  utilities,
} from "@cornerstonejs/core";
import {
  annotation,
  Enums as ToolEnums,
  LengthTool,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from "@cornerstonejs/tools";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LESION_COLOURS } from "../case/classes";
import { caseUrl, type LabelVolume } from "../case/load";
import type { CaseMeta, Lesion, PixelPoint } from "../case/types";
import type { Mark } from "../read/marks";
import { initCornerstone, TOOLS, type ToolChoice } from "./cornerstone";
import { paintOutlines, type PixelTransform, SliceCache } from "./outlines";
import { SliceQueue } from "./slices";

const VIEWPORT_ID = "axial";
/** Images fetched before the first is shown: the opening image and the ones after it, so the first scrolls are smooth. */
const FIRST_IMAGES = 5;
/** Images fetched at once. */
const PARALLEL = 6;
let mountCount = 0;

/** A measurement as the viewer knows it: geometry only. The reading room adds the kind. */
export type MarkGeometry = Omit<Mark, "kind">;

export type ViewerHandle = {
  goToSlice(slice: number): void;
  step(delta: number): void;
  setWindow(width: number, center: number): void;
  removeMark(id: string): void;
  reset(): void;
};

type Props = {
  meta: CaseMeta;
  tool: ToolChoice;
  /** False once the read is handed in: marks stay, but no new ones. */
  canMeasure: boolean;
  /** Reference lesions to draw (boxes and long axes), or null. */
  reference: Lesion[] | null;
  /** The reference label volume, once loaded. */
  labels: LabelVolume | null;
  showOutlines: boolean;
  onMarks(marks: MarkGeometry[]): void;
  onReady(): void;
  onSlice(slice: number): void;
  ref?: Ref<ViewerHandle>;
};

type Shape =
  | { type: "box"; x: number; y: number; w: number; h: number; colour: string; label: string }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number };

type ViewState = {
  slice: number;
  transform: PixelTransform | null;
  width: number;
  center: number;
  shapes: Shape[];
  leftLabel: string;
  rightLabel: string;
};

type Live = {
  engine: RenderingEngine;
  viewport: Types.IStackViewport;
  toolGroupId: string;
  imageIds: string[];
  rows: number;
  columns: number;
  queue: SliceQueue;
};

export function Viewer({ meta, tool, canMeasure, reference, labels, showOutlines, onMarks, onReady, onSlice, ref }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: meta.images.length });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  const outlineCanvas = useRef<HTMLCanvasElement>(null);
  const outlineState = useRef<{ labels: LabelVolume | null; show: boolean; cache: SliceCache | null }>({
    labels: null,
    show: false,
    cache: null,
  });
  outlineState.current.labels = labels;
  outlineState.current.show = showOutlines;
  const redrawRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onMarks, onReady, onSlice });
  callbacks.current = { onMarks, onReady, onSlice };

  // Load the case and build the viewport. Everything is torn down when the case changes.
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    let cancelled = false;
    const mount = ++mountCount;
    const engineId = `engine-${mount}`;
    const toolGroupId = `tools-${mount}`;
    const imageIds = meta.images.map((path) => `wadouri:${caseUrl(meta.id, path)}`);
    let frame = 0;

    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!live.current) return;
        const next = readView(live.current, referenceRef.current);
        live.current.queue.focus = next.slice;
        setView(next);
        callbacks.current.onSlice(next.slice);
        drawOutlines(next);
      });
    };
    const drawOutlines = (state: ViewState) => {
      const canvas = outlineCanvas.current;
      if (!canvas) return;
      const o = outlineState.current;
      if (!o.labels || !o.show) {
        paintOutlines(canvas, null, null);
        return;
      }
      if (!o.cache?.holds(o.labels.data)) o.cache = new SliceCache(o.labels.data, meta.geometry.rows, meta.geometry.columns);
      paintOutlines(canvas, o.cache.get(state.slice), state.transform);
    };
    redrawRef.current = redraw;
    const emitMarks = () => {
      if (live.current) callbacks.current.onMarks(readMarks(live.current, el));
    };
    const annotationEvents = [
      ToolEnums.Events.ANNOTATION_COMPLETED,
      ToolEnums.Events.ANNOTATION_MODIFIED,
      ToolEnums.Events.ANNOTATION_REMOVED,
    ];

    let loaded = 0;
    setProgress({ loaded, total: imageIds.length });
    const queue = new SliceQueue(imageIds.length, async (slice) => {
      await imageLoader.loadAndCacheImage(imageIds[slice]);
      if (!cancelled) setProgress({ loaded: ++loaded, total: imageIds.length });
    });

    (async () => {
      try {
        await initCornerstone();
        // The first image waits only for itself and its neighbours...
        await queue.take(FIRST_IMAGES, PARALLEL);
        if (cancelled) return;

        const engine = new RenderingEngine(engineId);
        engine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.STACK,
          element: el,
          defaultOptions: { background: [0, 0, 0] },
        });
        const viewport = engine.getViewport(VIEWPORT_ID) as Types.IStackViewport;

        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId)!;
        for (const name of [WindowLevelTool, PanTool, ZoomTool, StackScrollTool, LengthTool].map((t) => t.toolName)) {
          toolGroup.addTool(name);
        }
        toolGroup.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }] });
        toolGroup.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
        toolGroup.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
        toolGroup.addViewport(VIEWPORT_ID, engineId);

        await viewport.setStack(imageIds, 0);
        viewport.setProperties({ voiRange: utilities.windowLevel.toLowHighRange(meta.window.width, meta.window.center) });
        viewport.render();
        if (cancelled) {
          engine.destroy();
          return;
        }
        live.current = {
          engine,
          viewport,
          toolGroupId,
          imageIds,
          rows: meta.geometry.rows,
          columns: meta.geometry.columns,
          queue,
        };
        setPrimaryTool(toolGroupId, "window", true);
        el.addEventListener(Enums.Events.IMAGE_RENDERED, redraw);
        for (const name of annotationEvents) eventTarget.addEventListener(name, emitMarks);
        redraw();
        callbacks.current.onReady();
        // ...and the rest arrive while the case is read, nearest the image on screen first.
        // An image the reader scrolls to before its turn is fetched by the viewport there and then.
        await queue.take(Infinity, PARALLEL);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      queue.stop();
      cancelAnimationFrame(frame);
      el.removeEventListener(Enums.Events.IMAGE_RENDERED, redraw);
      for (const name of annotationEvents) eventTarget.removeEventListener(name, emitMarks);
      annotation.state.removeAllAnnotations();
      redrawRef.current = () => {};
      if (ToolGroupManager.getToolGroup(toolGroupId)) ToolGroupManager.destroyToolGroup(toolGroupId);
      live.current?.engine.destroy();
      live.current = null;
      cache.purgeCache();
    };
  }, [meta]);

  // The left mouse button follows the toolbar.
  useEffect(() => {
    if (live.current) setPrimaryTool(live.current.toolGroupId, tool, canMeasure);
  }, [tool, canMeasure, view === null]);

  // Reference shapes changed: redraw the overlay.
  useEffect(() => {
    if (live.current) setView(readView(live.current, reference));
  }, [reference]);

  // Outlines switched on or off, or just loaded.
  useEffect(() => {
    redrawRef.current();
  }, [labels, showOutlines]);

  useImperativeHandle(
    ref,
    () => ({
      goToSlice(slice) {
        const current = live.current;
        if (!current) return;
        const clamped = Math.max(0, Math.min(current.imageIds.length - 1, slice));
        current.queue.focus = clamped;
        void current.viewport.setImageIdIndex(clamped);
      },
      step(delta) {
        const current = live.current;
        if (!current) return;
        const next = Math.max(0, Math.min(current.imageIds.length - 1, current.viewport.getCurrentImageIdIndex() + delta));
        current.queue.focus = next;
        void current.viewport.setImageIdIndex(next);
      },
      setWindow(width, center) {
        const current = live.current;
        if (!current) return;
        current.viewport.setProperties({ voiRange: utilities.windowLevel.toLowHighRange(width, center) });
        current.viewport.render();
      },
      removeMark(id) {
        annotation.state.removeAnnotation(id);
        live.current?.viewport.render();
        if (live.current && element.current) callbacks.current.onMarks(readMarks(live.current, element.current));
      },
      reset() {
        const current = live.current;
        if (!current) return;
        current.viewport.resetCamera();
        current.viewport.setProperties({
          voiRange: utilities.windowLevel.toLowHighRange(meta.window.width, meta.window.center),
        });
        current.viewport.render();
      },
    }),
    [meta],
  );

  const total = meta.images.length;
  const first = Math.min(FIRST_IMAGES, total);
  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={element} onContextMenu={(e) => e.preventDefault()} />
      <canvas className="viewer-outlines" ref={outlineCanvas} aria-hidden="true" />
      {view && (
        <svg className="viewer-overlay" aria-hidden="true">
          {view.shapes.map((s, i) =>
            s.type === "box" ? (
              <g key={i}>
                <rect x={s.x} y={s.y} width={s.w} height={s.h} stroke={s.colour} />
                <text x={s.x} y={s.y - 5} fill={s.colour}>
                  {s.label}
                </text>
              </g>
            ) : (
              <g key={i}>
                <line className="halo" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#fff" />
              </g>
            ),
          )}
        </svg>
      )}
      {view && (
        <>
          <div className="corner top-left">
            {meta.title}
            <br />
            {meta.description}
          </div>
          <div className="corner top-right">
            Im {view.slice + 1} / {total}
            {progress.loaded < total && (
              <>
                <br />
                {progress.loaded} / {total} loaded
              </>
            )}
          </div>
          <div className="corner bottom-left">
            W {Math.round(view.width)} L {Math.round(view.center)}
          </div>
          <div className="corner bottom-right">
            {meta.geometry.sliceThicknessMm ? `${meta.geometry.sliceThicknessMm} mm` : ""}
          </div>
          <div className="side-label left">{view.leftLabel}</div>
          <div className="side-label right">{view.rightLabel}</div>
        </>
      )}
      {!view && !error && (
        <div className="viewer-status">
          <div>
            Loading images {Math.min(progress.loaded, first)} / {first}
          </div>
          <progress max={first} value={Math.min(progress.loaded, first)} />
        </div>
      )}
      {error && (
        <div className="viewer-status error">
          This case would not load: {error}
        </div>
      )}
    </div>
  );
}

function setPrimaryTool(toolGroupId: string, tool: ToolChoice, canMeasure: boolean) {
  const group = ToolGroupManager.getToolGroup(toolGroupId);
  if (!group) return;
  const primary = [{ mouseButton: ToolEnums.MouseBindings.Primary }];
  for (const choice of ["window", "pan", "zoom"] as const) {
    const name = TOOLS[choice];
    // Pan and zoom keep their other buttons; only the left button moves.
    if (choice === tool) {
      group.setToolActive(name, {
        bindings: [
          ...primary,
          ...(choice === "pan" ? [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] : []),
          ...(choice === "zoom" ? [{ mouseButton: ToolEnums.MouseBindings.Secondary }] : []),
        ],
      });
    } else if (choice === "pan") {
      group.setToolActive(name, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] });
    } else if (choice === "zoom") {
      group.setToolActive(name, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] });
    } else {
      group.setToolPassive(name);
    }
  }
  if (tool === "measure" && canMeasure) {
    group.setToolActive(TOOLS.measure, { bindings: primary });
  } else if (canMeasure) {
    group.setToolPassive(TOOLS.measure);
  } else {
    group.setToolEnabled(TOOLS.measure);
  }
}

function readView(current: Live, reference: Lesion[] | null): ViewState {
  const { viewport, imageIds } = current;
  const slice = viewport.getCurrentImageIdIndex();
  const imageId = imageIds[slice];
  const voi = viewport.getProperties().voiRange;
  const { windowWidth, windowCenter } = voi
    ? utilities.windowLevel.toWindowLevel(voi.lower, voi.upper)
    : { windowWidth: 0, windowCenter: 0 };

  const toCanvas = ([row, col]: PixelPoint): Types.Point2 | null => {
    const world = utilities.imageToWorldCoords(imageId, [col, row]);
    return world ? viewport.worldToCanvas(world) : null;
  };

  const shapes: Shape[] = [];
  for (const lesion of reference ?? []) {
    const colour = LESION_COLOURS[lesion.kind];
    const box = lesion.boxes.find((b) => b[0] === slice);
    if (box) {
      const a = toCanvas([box[1] - 0.5, box[2] - 0.5]);
      const b = toCanvas([box[3] + 0.5, box[4] + 0.5]);
      if (a && b) {
        const pad = 4;
        shapes.push({
          type: "box",
          x: Math.min(a[0], b[0]) - pad,
          y: Math.min(a[1], b[1]) - pad,
          w: Math.abs(b[0] - a[0]) + 2 * pad,
          h: Math.abs(b[1] - a[1]) + 2 * pad,
          colour,
          label: `${lesion.id} · ${Math.round(lesion.longAxisMm)} mm`,
        });
      }
    }
    if (lesion.longAxis.slice === slice) {
      const a = toCanvas(lesion.longAxis.from);
      const b = toCanvas(lesion.longAxis.to);
      if (a && b) {
        shapes.push({ type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      }
    }
  }

  const origin = toCanvas([0, 0]);
  const alongRow = toCanvas([0, 1]);
  const downColumn = toCanvas([1, 0]);
  const transform: PixelTransform | null =
    origin && alongRow && downColumn
      ? [
          alongRow[0] - origin[0],
          alongRow[1] - origin[1],
          downColumn[0] - origin[0],
          downColumn[1] - origin[1],
          origin[0],
          origin[1],
        ]
      : null;

  // Radiological convention: the patient's right is on the left of the screen.
  const plane = utilities.imageToWorldCoords(imageId, [0, 0]);
  const across = utilities.imageToWorldCoords(imageId, [1, 0]);
  const xIncreasesRight = plane && across ? across[0] > plane[0] : true;
  return {
    slice,
    transform,
    width: windowWidth,
    center: windowCenter,
    shapes,
    leftLabel: xIncreasesRight ? "R" : "L",
    rightLabel: xIncreasesRight ? "L" : "R",
  };
}

function readMarks(current: Live, el: HTMLDivElement): MarkGeometry[] {
  const { imageIds } = current;
  const found = annotation.state.getAnnotations(LengthTool.toolName, el) ?? [];
  const marks: MarkGeometry[] = [];
  for (const a of found) {
    const imageId = a.metadata?.referencedImageId;
    const points = a.data.handles?.points as Types.Point3[] | undefined;
    const slice = imageId ? imageIds.indexOf(imageId) : -1;
    if (!a.annotationUID || !points || points.length < 2 || slice < 0) continue;
    const from = utilities.worldToImageCoords(imageId!, points[0]);
    const to = utilities.worldToImageCoords(imageId!, points[1]);
    if (!from || !to) continue;
    const lengthMm = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]);
    marks.push({
      id: a.annotationUID,
      slice,
      from: [from[1], from[0]],
      to: [to[1], to[0]],
      lengthMm,
      side: sideOf(imageId!, (points[0][0] + points[1][0]) / 2, current.rows, current.columns),
    });
  }
  marks.sort((a, b) => a.slice - b.slice);
  return marks;
}

/** Which side of the patient a world x is on, taking the image centre as the midline. */
function sideOf(imageId: string, worldX: number, rows: number, columns: number): "left" | "right" | null {
  const middle = utilities.imageToWorldCoords(imageId, [(columns - 1) / 2, (rows - 1) / 2]);
  if (!middle) return null;
  // DICOM patient coordinates: +x is the patient's left.
  return worldX > middle[0] ? "left" : "right";
}
