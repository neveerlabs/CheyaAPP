import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { LegalPage } from "./LegalPage";
import "./styles.css";

function Root() {
  if (window.location.pathname === "/privacy") return <LegalPage kind="privacy" />;
  if (window.location.pathname === "/terms") return <LegalPage kind="terms" />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
