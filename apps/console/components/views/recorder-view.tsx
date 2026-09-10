"use client";

import { BrowserRecorderPanel } from "@/components/browser-recorder";

export function RecorderView() {
  return (
    <div className="recorder-page">
      <div className="run-header">
        <div className="run-header-left">
          <h2>Browser Recorder</h2>
          <div className="meta">Real-time SSE capture — locators, DOM elements, and metadata for future suites</div>
        </div>
      </div>
      <BrowserRecorderPanel layout="terminal" />
    </div>
  );
}
