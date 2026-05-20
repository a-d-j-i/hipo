/// <reference types="@testing-library/jest-dom" />
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, afterEach, vi } from "vitest";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

// Stub fetch so components that call /api/... in effects don't throw in jsdom.
vi.stubGlobal(
  "fetch",
  vi
    .fn()
    .mockRejectedValue(new Error("fetch not available in test environment")),
);
