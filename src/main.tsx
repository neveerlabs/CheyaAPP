import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary, ErrorPage } from "./ErrorPage";
import "./styles.css";

function Root() {
  const pathname = window.location.pathname;
  if (
    pathname !== "/" &&
    pathname !== "/privacy" &&
    pathname !== "/terms" &&
    !/^\/settings(?:\/(?:general|personal|configure|memory|messages|changelogs|account|privacy|terms))?\/?$/.test(pathname)
  ) {
    return (
      <ErrorPage
        code="404"
        title="Page not found"
        description="The page you’re looking for doesn’t exist or may have moved."
        onHome={() => window.location.assign("/")}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Root />
    </AppErrorBoundary>
  </React.StrictMode>,
);
