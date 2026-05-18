/// <reference types="@testing-library/jest-dom" />

import { afterEach, expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";

// Extend Vitest's expect explicitly. The auto-extending
// `@testing-library/jest-dom/vitest` entry doesn't always reach the right
// vitest module instance under npm-workspaces with Deno's nodeModulesDir.
expect.extend(matchers);

// JSDOM 29's `Blob` lacks `stream()`, which @hipo/backup's compress
// path needs (CompressionStream pipes from `blob.stream()`). Polyfill
// with a tiny shim that wraps the blob's bytes in a ReadableStream.
// Real browsers + Deno already implement this natively.
if (typeof Blob !== "undefined" && !Blob.prototype.stream) {
  Blob.prototype.stream = function (this: Blob) {
    const self = this;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const buf = await self.arrayBuffer();
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    });
  };
}

afterEach(() => {
  cleanup();
});
