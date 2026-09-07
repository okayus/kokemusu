import { useCallback, useEffect, useState } from "react";

// 見かた (features.md §3, 2026-09-07): the garden has two views — 投稿一覧 and
// 年表 — and the view is the URL path, so a reload and a bookmark keep it and
// the back gesture returns to the last one. Only the view rides in the URL: the
// 選んだ石 and the period stay in memory, as they always have. Any path the SPA
// fallback serves that is not the 年表's is the 投稿一覧 — the everyday face.

export type View = "posts" | "chronicle";

/** The two views in nav order, with the path each answers to and its label. */
export const VIEWS: readonly { view: View; path: string; label: string }[] = [
  { view: "posts", path: "/", label: "投稿一覧" },
  { view: "chronicle", path: "/年表", label: "年表" },
];

const CHRONICLE_PATH = "/年表";

/**
 * The view a pathname names. The browser hands the path back percent-encoded
 * (`/%E5%B9%B4%E8%A1%A8`), so it is decoded first; a malformed escape, like any
 * unknown path, is the 投稿一覧.
 */
export function viewOf(pathname: string): View {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "posts";
  }
  const trimmed = decoded.length > 1 && decoded.endsWith("/") ? decoded.slice(0, -1) : decoded;
  return trimmed === CHRONICLE_PATH ? "chronicle" : "posts";
}

/** The path a view lives at — what the nav links point to and pushState writes. */
export function pathOf(view: View): string {
  return view === "chronicle" ? CHRONICLE_PATH : "/";
}

/**
 * The current view and the one way to change it. `show` pushes a history entry
 * when the path actually changes (a repeated tap on the current view adds
 * nothing to go back through), and popstate follows the back / forward gesture.
 */
export function useView(): { view: View; show: (view: View) => void } {
  const [view, setView] = useState<View>(() => viewOf(window.location.pathname));
  useEffect(() => {
    const onPop = () => setView(viewOf(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const show = useCallback((next: View) => {
    if (viewOf(window.location.pathname) !== next) {
      window.history.pushState(null, "", pathOf(next));
    }
    setView(next);
  }, []);
  return { view, show };
}
