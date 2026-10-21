"use client";

import { useEffect, useState } from "react";

import { type KeyboardBox, keyboardBox } from "@/lib/keyboard-box";

/**
 * The visible box while an iOS keyboard is open, else null. See
 * `keyboard-box.ts` for why; on Android the viewport setting in `layout.tsx`
 * already shrinks the layout, so this stays null there.
 */
export function useKeyboardBox(): KeyboardBox | null {
  const [box, setBox] = useState<KeyboardBox | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    function update() {
      if (!viewport) return;
      const next = keyboardBox(viewport, window.innerHeight);
      setBox((current) =>
        current?.top === next?.top && current?.height === next?.height
          ? current
          : next,
      );
    }

    update();
    viewport.addEventListener("resize", update);
    // iOS pans the visual viewport (offsetTop) as it scrolls the input into
    // view, without resizing it.
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return box;
}
