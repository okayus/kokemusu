import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FatalScreen } from "./FatalScreen";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

const root = createRoot(container, {
  // An error thrown while rendering, with no boundary to catch it: React has
  // already unmounted everything. Report it as the default handler would
  // (console + window "error"), then put the reload screen where the app was.
  onUncaughtError(error) {
    reportError(error);
    root.render(<FatalScreen />);
  },
});

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
