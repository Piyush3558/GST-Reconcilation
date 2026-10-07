import React from "react";
import { createRoot } from "react-dom/client";
import Portal from "./Portal";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Portal />
  </React.StrictMode>,
);
