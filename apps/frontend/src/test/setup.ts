/// <reference types="@testing-library/jest-dom" />

import { afterEach, expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";

// Extend Vitest's expect explicitly. The auto-extending
// `@testing-library/jest-dom/vitest` entry doesn't always reach the right
// vitest module instance under npm-workspaces with Deno's nodeModulesDir.
expect.extend(matchers);

afterEach(() => {
  cleanup();
});
