"use client";

import {
  Sandpack,
  type SandpackProps,
  type SandpackTheme,
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
} from "@codesandbox/sandpack-react";

const lawalletTheme: SandpackTheme = {
  colors: {
    surface1: "#0A0A0F",
    surface2: "#111118",
    surface3: "#1e1e2a",
    clickable: "#8a8a9a",
    base: "#e0e0e8",
    disabled: "#4a4a5a",
    hover: "#F5A623",
    accent: "#F5A623",
    error: "#E53935",
    errorSurface: "#2a1010",
  },
  syntax: {
    plain: "#e0e0e8",
    comment: { color: "#6a6a7a", fontStyle: "italic" },
    keyword: "#F5A623",
    tag: "#26A69A",
    punctuation: "#8a8a9a",
    definition: "#4DB6AC",
    property: "#FFD580",
    static: "#E53935",
    string: "#26A69A",
  },
  font: {
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"Fira Code", "JetBrains Mono", "SF Mono", monospace',
    size: "13px",
    lineHeight: "20px",
  },
};

export function SandpackExample(props: SandpackProps) {
  return (
    <Sandpack
      theme={lawalletTheme}
      options={{
        showLineNumbers: true,
        showTabs: true,
        editorHeight: 400,
        ...props.options,
      }}
      {...props}
    />
  );
}

export function SandpackLive({
  files,
  template = "react-ts",
  dependencies,
  editorHeight = 450,
}: {
  files: Record<string, string>;
  template?: SandpackProps["template"];
  dependencies?: Record<string, string>;
  editorHeight?: number;
}) {
  return (
    <SandpackProvider
      template={template}
      theme={lawalletTheme}
      files={files}
      customSetup={dependencies ? { dependencies } : undefined}
    >
      <SandpackLayout>
        <SandpackCodeEditor
          showLineNumbers
          showTabs
          style={{ height: `${editorHeight}px` }}
        />
        <SandpackPreview style={{ height: `${editorHeight}px` }} />
      </SandpackLayout>
    </SandpackProvider>
  );
}

export function SandpackCodeOnly({
  files,
  template = "vanilla-ts",
}: {
  files: Record<string, string>;
  template?: SandpackProps["template"];
}) {
  return (
    <Sandpack
      template={template}
      theme={lawalletTheme}
      files={files}
      options={{
        showLineNumbers: true,
        showTabs: true,
        editorHeight: 350,
        showConsole: true,
        showConsoleButton: true,
      }}
    />
  );
}
