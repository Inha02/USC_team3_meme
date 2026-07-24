import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FloatingApp } from "./ui/FloatingApp.jsx";
import { ResultApp } from "./ui/ResultApp.jsx";
import "./styles.css";

const isResultPage =
  window.location.hash === "#result" || window.location.pathname.endsWith("/result");

createRoot(document.getElementById("root")).render(
  <StrictMode>{isResultPage ? <ResultApp /> : <FloatingApp />}</StrictMode>
);
