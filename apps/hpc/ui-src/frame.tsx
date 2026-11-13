import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, useAppContext } from "@pero/app-sdk";
import { Button, Feedback, LibraryHeader } from "@pero/app-sdk/ui";
import HpcBenchmarks from "./index";

function HpcLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === "zh-CN";
  return <main className="fatal" role="alert">
    <LibraryHeader density="compact" title={zh ? "HPC 基准无法加载" : "HPC Benchmarks could not load"} />
    <Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? "重新加载" : "Reload"}</Button></Feedback>
  </main>;
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <HpcLoadError message={this.state.error} /> : this.props.children;
  }
}

createRoot(document.getElementById("app")!).render(
  <AppProvider><ErrorBoundary><HpcBenchmarks /></ErrorBoundary></AppProvider>,
);
