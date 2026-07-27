"use client";

import { useEffect } from "react";

/**
 * Publishes the *visible* viewport size as --app-h (and its offset as
 * --vv-top) so the app shell can be sized from it.
 *
 * Needed because 100dvh does not shrink when the on-screen keyboard opens on
 * iOS Safari: the shell stays full height, the composer ends up behind the
 * keyboard, and the space it left renders blank. visualViewport.height is the
 * only value that tracks what the user can actually see on every platform.
 */
export function ViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;

    const apply = () => {
      // Never publish a non-positive height: the shell is sized from this, so
      // a transient 0 (seen during layout/rotation, and in some embedded
      // browsers) would collapse the whole app to a blank screen. Fall back
      // through innerHeight, then leave the CSS 100dvh default in place.
      const h = Math.round(vv?.height || 0) || Math.round(window.innerHeight || 0);
      if (h > 0) root.style.setProperty("--app-h", `${h}px`);
      // When iOS scrolls the page to reveal a focused field, the visual
      // viewport gets an offset; follow it so the shell stays pinned.
      const top = Math.round(vv?.offsetTop ?? 0);
      root.style.setProperty("--vv-top", `${top > 0 ? top : 0}px`);
    };

    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  return null;
}
