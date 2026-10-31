import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "@pero/app-sdk";
import ControlLab from "./index";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <main role="alert">
        <h1>Control Lab could not load</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("app")!).render(
  <AppProvider>
    <ErrorBoundary>
      <ControlLab />
    </ErrorBoundary>
  </AppProvider>,
);
