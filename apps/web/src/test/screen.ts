import { act } from '@testing-library/react';

/** Widths of the three layouts (lib/breakpoint.ts), for tests. */
export const PHONE_WIDTH = 390;
export const TABLET_WIDTH = 820;
export const DESKTOP_WIDTH = 1280;

let width = DESKTOP_WIDTH;
export const screenListeners = new Set<() => void>();

export const screenWidth = () => width;

/** Pretends the screen has this width: the fake matchMedia of the test setup answers with it. */
export function setScreenWidth(next: number): void {
  width = next;
  act(() => screenListeners.forEach((listener) => listener()));
}
