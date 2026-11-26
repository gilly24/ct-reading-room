import {
  cache,
  Enums,
  eventTarget,
  imageLoader,
  RenderingEngine,
  type Types,
  utilities,
  volumeLoader,
} from "@cornerstonejs/core";
import {
  annotation,
  Enums as ToolEnums,
  LengthTool,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  type Types as ToolTypes,
  WindowLevelTool,
  ZoomTool,
} from "@cornerstonejs/tools";
import { type Ref, type RefObject, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AI_COLOUR, AI_RGB, LESION_COLOURS } from "../case/classes";
import { caseUrl, type LabelVolume } from "../case/load";
import type { CaseMeta, Lesion, PixelPoint } from "../case/types";
import type { Mark } from "../read/marks";
import { initCornerstone, type ToolChoice } from "./cornerstone";
import { Figure } from "./Figure";
import {
  add,
  cross,
  directionLetter,
  distanceToLine,
  fraction,
  meetingPoint,
  nearestSlice,
  normalize,
  offsetTo,
  type Plane,
  type Point2,
  scale,
  sub,
  type Vec3,
  type ViewName,
  VIEWS,
} from "./mpr";
import { type OutlineStyle, paintOutlines, type PixelTransform, SliceCache } from "./outlines";
import { SliceQueue } from "./slices";

/** Images fetched before the first is shown: the opening image and the ones after it, so the first scrolls are smooth. */
const FIRST_IMAGES = 5;
/** Images fetched at once. */
const PARALLEL = 6;
/** How close to a crosshair line, in CSS pixels, a press grabs it. */
const GRAB_MOUSE = 6;
const GRAB_TOUCH = 16;
/** A right-button press that moves less than this is a click (the menu), not a window drag. */
const CLICK_SLOP = 4;
/** Crosshair lines run this far either side of the crossing, in mm: past any image's edge. */
const LINE_REACH = 4000;
let mountCount = 0;

/** Each view's colour: its name tag, and the line that shows its plane in the other two views. */
export const VIEW_COLOURS: Record<ViewName, string> = {
  axial: "#f2c14e",
  coronal: "#4fa3ff",
  sagittal: "#e46ce0",
};
export const VIEW_TITLES: Record<ViewName, string> = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal" };

export type Layout = "three" | "single";

/** A measurement as the viewer knows it: geometry only. The reading room adds the kind. */
export type MarkGeometry = Omit<Mark, "kind">;

export type ViewerHandle = {
  goToSlice(slice: number): void;
  /** Moves through the images in the view last clicked. */
  step(delta: number): void;
  /** The view last clicked. */
  activeView(): ViewName;
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
  /** The AI's lesions (boxes and long axes) and outlines, after hand-in, or null. */
  ai: Lesion[] | null;
  aiLabels: LabelVolume | null;
  /** Three views side by side, or one filling the space. */
  layout: Layout;
  /** The view shown when the layout is single. */
  focus: ViewName;
  /** The crosshair lines that show, and move, the other views' planes. */
  showLines: boolean;
  onLayout(layout: Layout, focus: ViewName): void;
  /** A right click without a drag, in page coordinates. */
  onMenu(x: number, y: number): void;
  onMarks(marks: MarkGeometry[]): void;
  onReady(): void;
  ref?: Ref<ViewerHandle>;
};

type Shape =
  | { type: "box"; x: number; y: number; w: number; h: number; colour: string; label: string; labelBelow?: boolean }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number; colour: string };

/** A label volume drawn over the axial view: the reference's, or the AI's. */
type OutlineLayer = { labels: LabelVolume | null; show: boolean; cache: SliceCache | null; style: OutlineStyle };

/** One crosshair line: where another view's plane cuts this one, in canvas pixels. */
type Line = { plane: ViewName; a: Point2; b: Point2 };

type Overlay = {
  lines: Line[];
  top: string;
  bottom: string;
  left: string;
  right: string;
  /** Where the plane is, for the little figure; null until it is known. */
  at: number | null;
  index: string;
};

type ViewState = {
  slice: number;
  transform: PixelTransform | null;
  width: number;
  center: number;
  shapes: Shape[];
  overlays: Partial<Record<ViewName, Overlay>>;
};

type Viewport = Types.IStackViewport | Types.IVolumeViewport;

/** The coronal and sagittal views, once their volume exists. */
type Sides = {
  /** Where the first and last axial images lie, to turn a point into an axial image number. */
  first: Vec3;
  last: Vec3;
  /** The image's extent across the patient (x) and front to back (y), for the little figures. */
  xRange: [number, number];
  yRange: [number, number];
};

type Live = {
  engine: RenderingEngine;
  viewports: Record<ViewName, Viewport>;
  groups: { axial: string; side: string };
  imageIds: string[];
  rows: number;
  columns: number;
  queue: SliceQueue;
  sides: Sides | null;
};

const point3 = (v: Vec3): Types.Point3 => [v[0], v[1], v[2]];

export function Viewer({
  meta,
  tool,
  canMeasure,
  reference,
  labels,
  showOutlines,
  ai,
  aiLabels,
  layout,
  focus,
  showLines,
  onLayout,
  onMenu,
  onMarks,
  onReady,
  ref,
}: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const axialEl = useRef<HTMLDivElement>(null);
  const coronalEl = useRef<HTMLDivElement>(null);
  const sagittalEl = useRef<HTMLDivElement>(null);
  const elements: Record<ViewName, RefObject<HTMLDivElement | null>> = {
    axial: axialEl,
    coronal: coronalEl,
    sagittal: sagittalEl,
  };
  const live = useRef<Live | null>(null);
  const [progress, setProgress] = useState({ loaded: 0, total: meta.images.length });
  const [sideLoaded, setSideLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [active, setActive] = useState<ViewName>("axial");
  const activeRef = useRef(active);
  activeRef.current = active;
  const viewRef = useRef(view);
  viewRef.current = view;
  const showLinesRef = useRef(showLines);
  showLinesRef.current = showLines;
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  const aiRef = useRef(ai);
  aiRef.current = ai;
  const outlineCanvas = useRef<HTMLCanvasElement>(null);
  const aiCanvas = useRef<HTMLCanvasElement>(null);
  const layers = useRef<{ reference: OutlineLayer; ai: OutlineLayer }>({
    reference: { labels: null, show: false, cache: null, style: { kind: "classes" } },
    ai: { labels: null, show: false, cache: null, style: { kind: "dotted", colour: AI_RGB } },
  });
  layers.current.reference.labels = labels;
  layers.current.reference.show = showOutlines;
  layers.current.ai.labels = aiLabels;
  layers.current.ai.show = aiLabels !== null;
  const redrawRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onMarks, onReady, onMenu, onLayout });
  callbacks.current = { onMarks, onReady, onMenu, onLayout };

  // Load the case and build the three views. Everything is torn down when the case changes.
  useEffect(() => {
    const els = { axial: axialEl.current, coronal: coronalEl.current, sagittal: sagittalEl.current };
    if (!els.axial || !els.coronal || !els.sagittal) return;
    const axialElement = els.axial;
    const allElements = [els.axial, els.coronal, els.sagittal];
    let cancelled = false;
    const mount = ++mountCount;
    const engineId = `engine-${mount}`;
    const groups = { axial: `axial-tools-${mount}`, side: `side-tools-${mount}` };
    const volumeId = `cornerstoneStreamingImageVolume:case-${mount}`;
    const imageIds = meta.images.map((path) => `wadouri:${caseUrl(meta.id, path)}`);
    let engine: RenderingEngine | null = null;
    let frame = 0;

    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!live.current) return;
        const next = readView(live.current, referenceRef.current, aiRef.current);
        live.current.queue.focus = next.slice;
        setView(next);
        drawOutlines(next);
      });
    };
    const drawOutlines = (state: ViewState) => {
      const pairs: [HTMLCanvasElement | null, OutlineLayer][] = [
        [outlineCanvas.current, layers.current.reference],
        [aiCanvas.current, layers.current.ai],
      ];
      for (const [canvas, o] of pairs) {
        if (!canvas) continue;
        if (!o.labels || !o.show) {
          paintOutlines(canvas, null, null);
          continue;
        }
        if (!o.cache?.holds(o.labels.data)) {
          o.cache = new SliceCache(o.labels.data, meta.geometry.rows, meta.geometry.columns, o.style);
        }
        paintOutlines(canvas, o.cache.get(state.slice), state.transform);
      }
    };
    redrawRef.current = redraw;
    const emitMarks = () => {
      if (live.current) callbacks.current.onMarks(readMarks(live.current, axialElement));
    };
    const annotationEvents = [
      ToolEnums.Events.ANNOTATION_COMPLETED,
      ToolEnums.Events.ANNOTATION_MODIFIED,
      ToolEnums.Events.ANNOTATION_REMOVED,
    ];

    // The window is one setting for the case: change it in one view and the others follow.
    let syncing = false;
    const syncWindow = (event: Event) => {
      const current = live.current;
      const detail = (event as CustomEvent<{ viewportId: string; range?: Types.VOIRange }>).detail;
      if (!current || syncing || !detail.range) return;
      syncing = true;
      try {
        for (const name of VIEWS) {
          if (name === detail.viewportId || (name !== "axial" && !current.sides)) continue;
          const viewport = current.viewports[name];
          const own = viewport.getProperties()?.voiRange;
          if (own && Math.abs(own.lower - detail.range.lower) < 1e-3 && Math.abs(own.upper - detail.range.upper) < 1e-3) {
            continue;
          }
          viewport.setProperties({ voiRange: { lower: detail.range.lower, upper: detail.range.upper } });
          viewport.render();
        }
      } finally {
        syncing = false;
      }
      redraw();
    };
    const onVolumeProgress = (event: Event) => {
      const detail = (event as CustomEvent<{ volumeId: string; framesProcessed: number }>).detail;
      if (detail.volumeId === volumeId && !cancelled) setSideLoaded(detail.framesProcessed);
    };
    const onVolumeLoaded = (event: Event) => {
      const detail = (event as CustomEvent<{ volumeId: string }>).detail;
      if (detail.volumeId !== volumeId || cancelled) return;
      setSideLoaded(imageIds.length);
      // Cornerstone 5.17 refreshes a view's record of the images it has just before it records the
      // last one, so the views would go on reporting "Low Fidelity" with every image in. One more
      // change notice, once that last image is recorded, brings the record up to date.
      setTimeout(() => {
        if (!cancelled) {
          utilities.triggerEvent(eventTarget, Enums.Events.IMAGE_VOLUME_MODIFIED, {
            volumeId,
            framesProcessed: imageIds.length,
          });
        }
      }, 0);
    };
    const resize = new ResizeObserver(() => {
      live.current?.engine.resize(true, true);
      redraw();
    });

    let loaded = 0;
    setProgress({ loaded, total: imageIds.length });
    setSideLoaded(0);
    setSideError(null);
    const queue = new SliceQueue(imageIds.length, async (slice) => {
      await imageLoader.loadAndCacheImage(imageIds[slice]);
      if (!cancelled) setProgress({ loaded: ++loaded, total: imageIds.length });
    });

    // Coronal and sagittal are cut from a volume built from the same images. Cornerstone needs the
    // first, middle and last image to place it; the rest fill in as they arrive, whoever fetched them.
    const buildSides = async () => {
      try {
        // A copy: Cornerstone reorders the list it is given, and ours must stay head first.
        const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds: [...imageIds] });
        const current = live.current;
        if (cancelled || !current) {
          if (cache.getVolume(volumeId)) cache.removeVolumeLoadObject(volumeId);
          return;
        }
        // The views first, then the loading: a view only counts the images delivered after it is attached.
        for (const name of ["coronal", "sagittal"] as const) {
          await (current.viewports[name] as Types.IVolumeViewport).setVolumes([{ volumeId }]);
        }
        if (cancelled) return;
        volume.load();
        const first = utilities.imageToWorldCoords(imageIds[0], [0, 0]);
        const last = utilities.imageToWorldCoords(imageIds[imageIds.length - 1], [0, 0]);
        const corner = utilities.imageToWorldCoords(imageIds[0], [current.columns - 1, current.rows - 1]);
        if (!first || !last || !corner) throw new Error("the images have no position");
        current.sides = {
          first: first as Vec3,
          last: last as Vec3,
          xRange: [first[0], corner[0]],
          yRange: [first[1], corner[1]],
        };
        const voiRange = current.viewports.axial.getProperties()?.voiRange;
        for (const name of ["coronal", "sagittal"] as const) {
          const viewport = current.viewports[name];
          if (voiRange) viewport.setProperties({ voiRange });
          viewport.render();
        }
        redraw();
      } catch (e) {
        if (!cancelled) setSideError(e instanceof Error ? e.message : String(e));
      }
    };

    (async () => {
      try {
        await initCornerstone();
        // The first image waits only for itself and its neighbours...
        await queue.take(FIRST_IMAGES, PARALLEL);
        if (cancelled) return;

        engine = new RenderingEngine(engineId);
        const background: Types.Point3 = [0, 0, 0];
        engine.setViewports([
          { viewportId: "axial", type: Enums.ViewportType.STACK, element: els.axial!, defaultOptions: { background } },
          {
            viewportId: "coronal",
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: els.coronal!,
            defaultOptions: { background, orientation: Enums.OrientationAxis.CORONAL },
          },
          {
            viewportId: "sagittal",
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: els.sagittal!,
            defaultOptions: { background, orientation: Enums.OrientationAxis.SAGITTAL },
          },
        ]);
        const viewports = {
          axial: engine.getViewport("axial") as Types.IStackViewport,
          coronal: engine.getViewport("coronal") as Types.IVolumeViewport,
          sagittal: engine.getViewport("sagittal") as Types.IVolumeViewport,
        };

        // Measuring is on the axial images only: scoring and the report count by axial image number.
        const axialTools = ToolGroupManager.createToolGroup(groups.axial)!;
        const sideTools = ToolGroupManager.createToolGroup(groups.side)!;
        for (const t of [WindowLevelTool, PanTool, ZoomTool, StackScrollTool]) {
          axialTools.addTool(t.toolName);
          sideTools.addTool(t.toolName);
        }
        axialTools.addTool(LengthTool.toolName);
        axialTools.addViewport("axial", engineId);
        sideTools.addViewport("coronal", engineId);
        sideTools.addViewport("sagittal", engineId);

        await viewports.axial.setStack(imageIds, 0);
        viewports.axial.setProperties({
          voiRange: utilities.windowLevel.toLowHighRange(meta.window.width, meta.window.center),
        });
        viewports.axial.render();
        if (cancelled) return;
        live.current = {
          engine,
          viewports,
          groups,
          imageIds,
          rows: meta.geometry.rows,
          columns: meta.geometry.columns,
          queue,
          sides: null,
        };
        applyTools(groups, "scroll", true);
        for (const el of allElements) {
          el.addEventListener(Enums.Events.IMAGE_RENDERED, redraw);
          el.addEventListener(Enums.Events.VOI_MODIFIED, syncWindow);
          resize.observe(el);
        }
        for (const name of annotationEvents) eventTarget.addEventListener(name, emitMarks);
        eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onVolumeProgress);
        eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoaded);
        redraw();
        callbacks.current.onReady();
        void buildSides();
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
      resize.disconnect();
      for (const el of allElements) {
        el.removeEventListener(Enums.Events.IMAGE_RENDERED, redraw);
        el.removeEventListener(Enums.Events.VOI_MODIFIED, syncWindow);
      }
      for (const name of annotationEvents) eventTarget.removeEventListener(name, emitMarks);
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_MODIFIED, onVolumeProgress);
      eventTarget.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoaded);
      annotation.state.removeAllAnnotations();
      redrawRef.current = () => {};
      for (const id of Object.values(groups)) {
        if (ToolGroupManager.getToolGroup(id)) ToolGroupManager.destroyToolGroup(id);
      }
      const volume = cache.getVolume(volumeId) as (Types.IImageVolume & { cancelLoading?: () => void }) | undefined;
      volume?.cancelLoading?.();
      engine?.destroy();
      live.current = null;
      cache.purgeCache();
    };
  }, [meta]);

  // The left mouse button follows the toolbar.
  useEffect(() => {
    if (live.current) applyTools(live.current.groups, tool, canMeasure);
  }, [tool, canMeasure, view === null]);

  // Reference or AI shapes changed: redraw the overlay.
  useEffect(() => {
    redrawRef.current();
  }, [reference, ai]);

  // Outlines switched on or off, or just loaded.
  useEffect(() => {
    redrawRef.current();
  }, [labels, showOutlines, aiLabels]);

  // Crosshair lines: a press on a line drags it, which moves that line's view through the case.
  // A right click without a drag opens the menu. Both are caught before Cornerstone sees them.
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    let drag: { view: ViewName; planes: ViewName[]; pointerId: number } | null = null;
    let press: { x: number; y: number } | null = null;
    let hovered: HTMLElement | null = null;

    const viewUnder = (target: EventTarget | null): ViewName | null => {
      const cell = target instanceof Element ? target.closest("[data-view]") : null;
      return (cell?.getAttribute("data-view") as ViewName | null) ?? null;
    };
    const pointIn = (name: ViewName, e: PointerEvent): Point2 => {
      const rect = elements[name].current!.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };
    const linesNear = (name: ViewName, p: Point2, tolerance: number): Line[] => {
      if (!showLinesRef.current || !live.current?.sides) return [];
      const lines = viewRef.current?.overlays[name]?.lines ?? [];
      return lines
        .map((line) => ({ line, d: distanceToLine(p, line.a, line.b) }))
        .filter((near) => near.d <= tolerance)
        .sort((x, y) => x.d - y.d)
        .map((near) => near.line);
    };
    const moveTo = (plane: ViewName, target: Vec3) => {
      const current = live.current;
      if (!current?.sides) return;
      if (plane === "axial") {
        const slice = nearestSlice(target, current.sides.first, current.sides.last, current.imageIds.length);
        const axial = current.viewports.axial as Types.IStackViewport;
        if (slice !== axial.getCurrentImageIdIndex()) {
          current.queue.focus = slice;
          void axial.setImageIdIndex(slice);
        }
        return;
      }
      const viewport = current.viewports[plane];
      const camera = viewport.getCamera();
      const normal = normalize(camera.viewPlaneNormal as Vec3);
      const shift = offsetTo({ normal, point: camera.focalPoint as Vec3 }, target);
      if (Math.abs(shift) < 1e-3) return;
      viewport.setCamera({
        focalPoint: point3(add(camera.focalPoint as Vec3, scale(normal, shift))),
        position: point3(add(camera.position as Vec3, scale(normal, shift))),
      });
      viewport.render();
    };
    const setHover = (cell: HTMLElement | null, cursor: string) => {
      if (hovered && hovered !== cell) delete hovered.dataset.grab;
      hovered = cell;
      if (!cell) return;
      if (cursor) cell.dataset.grab = cursor;
      else delete cell.dataset.grab;
    };

    const onDown = (e: PointerEvent) => {
      const name = viewUnder(e.target);
      if (!name) return;
      if (name !== activeRef.current) setActive(name);
      press = e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
      if (e.button !== 0) return;
      const near = linesNear(name, pointIn(name, e), e.pointerType === "mouse" ? GRAB_MOUSE : GRAB_TOUCH);
      if (near.length === 0) return;
      // Near the crossing, both lines move together.
      drag = { view: name, planes: near.slice(0, 2).map((line) => line.plane), pointerId: e.pointerId };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) {
        const viewport = live.current?.viewports[drag.view];
        if (!viewport) return;
        const world = viewport.canvasToWorld(pointIn(drag.view, e) as Types.Point2) as Vec3;
        for (const plane of drag.planes) moveTo(plane, world);
        e.preventDefault();
        return;
      }
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      const name = viewUnder(e.target);
      const cell = name ? (el.querySelector(`[data-view="${name}"]`) as HTMLElement | null) : null;
      if (!name || !cell) return setHover(null, "");
      const near = linesNear(name, pointIn(name, e), GRAB_MOUSE);
      if (near.length >= 2) return setHover(cell, "both");
      if (near.length === 0) return setHover(cell, "");
      const { a, b } = near[0];
      setHover(cell, Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? "row" : "col");
    };
    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.pointerId) {
        drag = null;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        return;
      }
      if (e.type === "pointerup" && e.button === 2 && press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < CLICK_SLOP) {
        callbacks.current.onMenu(e.clientX, e.clientY);
      }
      press = null;
    };
    // While a line is being dragged, Cornerstone must not also see the press.
    const swallow = (e: Event) => {
      if (!drag) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const noBrowserMenu = (e: Event) => e.preventDefault();
    const onLeave = () => setHover(null, "");

    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove, true);
    el.addEventListener("pointerup", onUp, true);
    el.addEventListener("pointercancel", onUp, true);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("mousedown", swallow, true);
    el.addEventListener("touchstart", swallow, { capture: true, passive: false });
    el.addEventListener("contextmenu", noBrowserMenu);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove, true);
      el.removeEventListener("pointerup", onUp, true);
      el.removeEventListener("pointercancel", onUp, true);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("mousedown", swallow, true);
      el.removeEventListener("touchstart", swallow, { capture: true });
      el.removeEventListener("contextmenu", noBrowserMenu);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      goToSlice(slice) {
        const current = live.current;
        if (!current) return;
        const clamped = Math.max(0, Math.min(current.imageIds.length - 1, slice));
        current.queue.focus = clamped;
        void (current.viewports.axial as Types.IStackViewport).setImageIdIndex(clamped);
      },
      step(delta) {
        const current = live.current;
        if (!current) return;
        const name = current.sides ? activeRef.current : "axial";
        if (name === "axial") {
          const axial = current.viewports.axial as Types.IStackViewport;
          const next = Math.max(0, Math.min(current.imageIds.length - 1, axial.getCurrentImageIdIndex() + delta));
          current.queue.focus = next;
          void axial.setImageIdIndex(next);
        } else {
          utilities.scroll(current.viewports[name] as unknown as Types.IViewport, { delta });
        }
      },
      activeView() {
        return activeRef.current;
      },
      setWindow(width, center) {
        const current = live.current;
        if (!current) return;
        const voiRange = utilities.windowLevel.toLowHighRange(width, center);
        for (const name of VIEWS) {
          if (name !== "axial" && !current.sides) continue;
          current.viewports[name].setProperties({ voiRange });
          current.viewports[name].render();
        }
      },
      removeMark(id) {
        annotation.state.removeAnnotation(id);
        live.current?.viewports.axial.render();
        if (live.current && axialEl.current) callbacks.current.onMarks(readMarks(live.current, axialEl.current));
      },
      reset() {
        const current = live.current;
        if (!current) return;
        const voiRange = utilities.windowLevel.toLowHighRange(meta.window.width, meta.window.center);
        for (const name of VIEWS) {
          if (name !== "axial" && !current.sides) continue;
          current.viewports[name].resetCamera();
          current.viewports[name].setProperties({ voiRange });
          current.viewports[name].render();
        }
      },
    }),
    [meta],
  );

  const total = meta.images.length;
  const first = Math.min(FIRST_IMAGES, total);
  const thickness = meta.geometry.sliceThicknessMm ? `${meta.geometry.sliceThicknessMm} mm` : "";

  return (
    <div className={`viewports ${layout}`} ref={grid}>
      {VIEWS.map((name) => {
        const overlay = view?.overlays[name];
        const sideWaiting = name !== "axial" && view && !overlay;
        return (
          <div
            key={name}
            className={`vp vp-${name}${name === focus ? " focus" : ""}${name === active ? " active" : ""}`}
            data-view={name}
            onDoubleClick={() => onLayout(layout === "three" ? "single" : "three", name)}
          >
            <div className="vp-canvas" ref={elements[name]} />
            {name === "axial" && <canvas className="viewer-outlines" ref={outlineCanvas} aria-hidden="true" />}
            {name === "axial" && <canvas className="viewer-outlines" ref={aiCanvas} aria-hidden="true" />}
            {name === "axial" && view && (
              <svg className="viewer-overlay" aria-hidden="true">
                {view.shapes.map((s, i) =>
                  s.type === "box" ? (
                    <g key={i}>
                      <rect x={s.x} y={s.y} width={s.w} height={s.h} stroke={s.colour} />
                      <text x={s.x} y={s.labelBelow ? s.y + s.h + 14 : s.y - 5} fill={s.colour}>
                        {s.label}
                      </text>
                    </g>
                  ) : (
                    <g key={i}>
                      <line className="halo" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                      <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.colour} />
                    </g>
                  ),
                )}
              </svg>
            )}
            {overlay && showLines && overlay.lines.length > 0 && (
              <svg className="crosshair" aria-hidden="true">
                {overlay.lines.map((line) => (
                  <line
                    key={line.plane}
                    x1={line.a[0]}
                    y1={line.a[1]}
                    x2={line.b[0]}
                    y2={line.b[1]}
                    stroke={VIEW_COLOURS[line.plane]}
                  />
                ))}
              </svg>
            )}
            {view && (
              <div className="corner top-left">
                <span className="view-name">
                  <span className="swatch" style={{ background: VIEW_COLOURS[name] }} />
                  {VIEW_TITLES[name]}
                </span>
                {name === "axial" && (
                  <>
                    <br />
                    {meta.title}
                    <br />
                    {meta.description}
                  </>
                )}
              </div>
            )}
            {overlay && (
              <>
                <div className="corner top-right">
                  {overlay.index}
                  {name === "axial" && progress.loaded < total && (
                    <>
                      <br />
                      {progress.loaded} / {total} loaded
                    </>
                  )}
                  {name !== "axial" && sideLoaded < total && (
                    <>
                      <br />
                      {sideLoaded} / {total} loaded
                    </>
                  )}
                </div>
                <div className="corner bottom-left">
                  C {Math.round(view!.center)} W {Math.round(view!.width)}
                </div>
                <div className="corner bottom-right">{name === "axial" ? thickness : ""}</div>
                <div className="edge top">{overlay.top}</div>
                <div className="edge bottom">{overlay.bottom}</div>
                <div className="edge left">{overlay.left}</div>
                <div className="edge right">{overlay.right}</div>
                <Figure view={name} at={overlay.at} colour={VIEW_COLOURS[name]} />
              </>
            )}
            {name === "axial" && !view && !error && (
              <div className="viewer-status">
                <div>
                  Loading images {Math.min(progress.loaded, first)} / {first}
                </div>
                <progress max={first} value={Math.min(progress.loaded, first)} />
              </div>
            )}
            {name === "axial" && error && <div className="viewer-status error">This case would not load: {error}</div>}
            {sideWaiting && (
              <div className="viewer-status small">
                {sideError ? `The ${name} view would not load: ${sideError}` : `Preparing the ${name} view…`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Sets what each mouse button does. Every tool's bindings are cleared first: Cornerstone adds to them otherwise. */
function applyTools(groups: Live["groups"], tool: ToolChoice, canMeasure: boolean) {
  const { MouseBindings: M, KeyboardBindings: K } = ToolEnums;
  for (const [id, measuresHere] of [
    [groups.axial, true],
    [groups.side, false],
  ] as const) {
    const group = ToolGroupManager.getToolGroup(id);
    if (!group) continue;
    const left: ToolChoice = tool === "measure" && !(measuresHere && canMeasure) ? "scroll" : tool;
    const primary = (choice: ToolChoice): ToolTypes.IToolBinding[] =>
      left === choice ? [{ mouseButton: M.Primary }] : [];
    const bind = (name: string, bindings: ToolTypes.IToolBinding[]) => {
      group.setToolPassive(name, { removeAllBindings: true });
      if (bindings.length) group.setToolActive(name, { bindings });
    };
    // Wheel and left drag scroll; right drag is window and level; middle drag pans.
    // Ctrl with a drag or the wheel zooms, Shift with a drag pans, two fingers pinch to zoom.
    bind(StackScrollTool.toolName, [{ mouseButton: M.Wheel }, ...primary("scroll")]);
    bind(WindowLevelTool.toolName, [{ mouseButton: M.Secondary }, ...primary("window")]);
    bind(PanTool.toolName, [
      { mouseButton: M.Auxiliary },
      { mouseButton: M.Primary, modifierKey: K.Shift },
      ...primary("pan"),
    ]);
    bind(ZoomTool.toolName, [
      { mouseButton: M.Primary, modifierKey: K.Ctrl },
      { mouseButton: M.Wheel, modifierKey: K.Ctrl },
      { numTouchPoints: 2 },
      ...primary("zoom"),
    ]);
    if (!measuresHere) continue;
    if (left === "measure") bind(LengthTool.toolName, [{ mouseButton: M.Primary }]);
    else if (canMeasure) group.setToolPassive(LengthTool.toolName, { removeAllBindings: true });
    else group.setToolEnabled(LengthTool.toolName);
  }
}

function readView(current: Live, reference: Lesion[] | null, ai: Lesion[] | null): ViewState {
  const { viewports, imageIds, sides } = current;
  const axial = viewports.axial as Types.IStackViewport;
  const slice = axial.getCurrentImageIdIndex();
  const imageId = imageIds[slice];
  const voi = axial.getProperties().voiRange;
  const { windowWidth, windowCenter } = voi
    ? utilities.windowLevel.toWindowLevel(voi.lower, voi.upper)
    : { windowWidth: 0, windowCenter: 0 };

  const toCanvas = ([row, col]: PixelPoint): Types.Point2 | null => {
    const world = utilities.imageToWorldCoords(imageId, [col, row]);
    return world ? axial.worldToCanvas(world) : null;
  };

  const shapes: Shape[] = [];
  // The reference's boxes are labelled above, in the lesion's colour; the AI's below, in its own.
  const layers = [
    ...(reference ?? []).map((lesion) => ({ lesion, ai: false })),
    ...(ai ?? []).map((lesion) => ({ lesion, ai: true })),
  ];
  for (const { lesion, ai: byAi } of layers) {
    const colour = byAi ? AI_COLOUR : LESION_COLOURS[lesion.kind];
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
          label: `${byAi ? "AI " : ""}${lesion.id} · ${Math.round(lesion.longAxisMm)} mm`,
          labelBelow: byAi,
        });
      }
    }
    if (lesion.longAxis.slice === slice) {
      const a = toCanvas(lesion.longAxis.from);
      const b = toCanvas(lesion.longAxis.to);
      if (a && b) {
        shapes.push({ type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], colour: byAi ? AI_COLOUR : "#fff" });
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

  // The three planes, and the point where they cross.
  const axialPoint = utilities.imageToWorldCoords(imageId, [0, 0]);
  const planes: Record<ViewName, Plane> = {
    axial: {
      normal: axial.getCamera().viewPlaneNormal as Vec3,
      point: (axialPoint ?? axial.getCamera().focalPoint) as Vec3,
    },
    coronal: planeOf(viewports.coronal),
    sagittal: planeOf(viewports.sagittal),
  };
  const meet = sides ? meetingPoint(planes.axial, planes.coronal, planes.sagittal) : null;

  const overlays: Partial<Record<ViewName, Overlay>> = {};
  for (const name of VIEWS) {
    if (name !== "axial" && !sides) continue;
    const viewport = viewports[name];
    const lines: Line[] = [];
    if (meet) {
      for (const other of VIEWS) {
        if (other === name) continue;
        const along = normalize(cross(planes[name].normal, planes[other].normal));
        const a = viewport.worldToCanvas(point3(add(meet, scale(along, -LINE_REACH))));
        const b = viewport.worldToCanvas(point3(add(meet, scale(along, LINE_REACH))));
        lines.push({ plane: other, a, b });
      }
    }
    let at: number | null = null;
    let index = "";
    if (name === "axial") {
      at = imageIds.length > 1 ? slice / (imageIds.length - 1) : 0.5;
      index = `Im ${slice + 1} / ${imageIds.length}`;
    } else {
      if (meet && sides) at = name === "sagittal" ? fraction(meet[0], ...sides.xRange) : fraction(meet[1], ...sides.yRange);
      const data = utilities.getImageSliceDataForVolumeViewport(viewport as Types.IVolumeViewport);
      if (data) index = `Im ${data.imageIndex + 1} / ${data.numberOfSlices}`;
    }
    overlays[name] = { lines, at, index, ...edgeLetters(viewport) };
  }

  return { slice, transform, width: windowWidth, center: windowCenter, shapes, overlays };
}

function planeOf(viewport: Viewport): Plane {
  const { viewPlaneNormal, focalPoint } = viewport.getCamera();
  return { normal: viewPlaneNormal as Vec3, point: focalPoint as Vec3 };
}

/** The patient direction at each edge of a view, from the view's own camera: radiological convention falls out of it. */
function edgeLetters(viewport: Viewport): Pick<Overlay, "top" | "bottom" | "left" | "right"> {
  const width = viewport.canvas.clientWidth;
  const height = viewport.canvas.clientHeight;
  if (!width || !height) return { top: "", bottom: "", left: "", right: "" };
  const centre = viewport.canvasToWorld([width / 2, height / 2]) as Vec3;
  const right = sub(viewport.canvasToWorld([width / 2 + 10, height / 2]) as Vec3, centre);
  const down = sub(viewport.canvasToWorld([width / 2, height / 2 + 10]) as Vec3, centre);
  return {
    right: directionLetter(right),
    left: directionLetter(scale(right, -1)),
    bottom: directionLetter(down),
    top: directionLetter(scale(down, -1)),
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
