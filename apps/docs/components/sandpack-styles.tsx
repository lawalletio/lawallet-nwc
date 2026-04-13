"use client";

import { getSandpackCssText } from "@codesandbox/sandpack-react";
import { useServerInsertedHTML } from "next/navigation";

export function SandPackCSS() {
  useServerInsertedHTML(() => (
    <style
      dangerouslySetInnerHTML={{ __html: getSandpackCssText() }}
      id="sandpack"
    />
  ));
  return null;
}
