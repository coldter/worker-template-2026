import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// oxlint-disable-next-line vitest/require-top-level-describe -- setup file: cleanup must run after every test
afterEach(() => {
  cleanup();
});

const localStorageMock = {
  clear: vi.fn<Storage["clear"]>(),
  getItem: vi.fn<Storage["getItem"]>(),
  key: vi.fn<Storage["key"]>(),
  length: 0,
  removeItem: vi.fn<Storage["removeItem"]>(),
  setItem: vi.fn<Storage["setItem"]>(),
};

Object.defineProperty(window, "localStorage", { value: localStorageMock });

const createMediaQueryList = (query: string): MediaQueryList => ({
  addEventListener: vi.fn<() => void>(),
  addListener: vi.fn<() => void>(),
  dispatchEvent: vi.fn<() => boolean>(),
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: vi.fn<() => void>(),
  removeListener: vi.fn<() => void>(),
});

Object.defineProperty(window, "matchMedia", {
  value: vi.fn<(query: string) => MediaQueryList>(createMediaQueryList),
  writable: true,
});

class ObserverMock {
  disconnect = vi.fn<() => void>();
  observe = vi.fn<() => void>();
  unobserve = vi.fn<() => void>();
}

vi.stubGlobal("ResizeObserver", ObserverMock);

vi.stubGlobal("IntersectionObserver", ObserverMock);
