import { useEffect, useLayoutEffect, useRef, useState } from "react";

// A small pop-up menu: the viewer's right-click menu, and the toolbar's presets.

export type MenuEntry =
  | {
      kind: "item";
      label: string;
      shortcut?: string;
      /** Shows a tick, for a choice (radio) or a switch (checkbox). */
      checked?: boolean;
      role?: "radio" | "checkbox";
      disabled?: boolean;
      onSelect(): void;
    }
  | { kind: "heading"; label: string }
  | { kind: "divider" };

type Props = {
  x: number;
  y: number;
  label: string;
  entries: MenuEntry[];
  onClose(): void;
};

export function Menu({ x, y, label, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep it on screen, and put the keyboard in it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (ref.current?.contains(target) || target?.closest?.("[data-menu-anchor]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const close = () => onClose();
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="menu"
      role="menu"
      aria-label={label}
      ref={ref}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry.kind === "divider") return <div key={i} className="menu-divider" role="separator" />;
        if (entry.kind === "heading")
          return (
            <div key={i} className="menu-heading" role="presentation">
              {entry.label}
            </div>
          );
        const role = entry.role ? (entry.role === "radio" ? "menuitemradio" : "menuitemcheckbox") : "menuitem";
        return (
          <button
            key={i}
            role={role}
            aria-checked={entry.role ? Boolean(entry.checked) : undefined}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
          >
            <span className="menu-tick" aria-hidden="true">
              {entry.checked ? "✓" : ""}
            </span>
            <span className="menu-label">{entry.label}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
