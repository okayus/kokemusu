import { describe, expect, it } from "vitest";
import { pathOf, viewOf, VIEWS } from "./view";

describe("viewOf — the view a URL path names", () => {
  it("reads the 年表's path, raw or as the browser percent-encodes it", () => {
    expect(viewOf("/年表")).toBe("chronicle");
    expect(viewOf("/%E5%B9%B4%E8%A1%A8")).toBe("chronicle");
    expect(viewOf("/年表/")).toBe("chronicle");
  });

  it("is the 投稿一覧 for the root and for any path the SPA fallback happens to serve", () => {
    expect(viewOf("/")).toBe("posts");
    expect(viewOf("/some/client/route")).toBe("posts");
    expect(viewOf("/年表子")).toBe("posts");
  });

  it("treats a malformed escape as the 投稿一覧 rather than throwing", () => {
    expect(viewOf("/%E5")).toBe("posts");
  });
});

describe("pathOf — the nav's hrefs round-trip through viewOf", () => {
  it("names each view's path and reads it back", () => {
    for (const v of VIEWS) {
      expect(pathOf(v.view)).toBe(v.path);
      expect(viewOf(pathOf(v.view))).toBe(v.view);
    }
  });
});
