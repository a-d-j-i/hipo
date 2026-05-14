import { Grid } from "antd";

export function useIsMobile(): boolean {
  const screens = Grid.useBreakpoint();
  return !screens.md;
}

export function useResponsiveDrawerWidth(desktopWidth: number): number | string {
  return useIsMobile() ? "100%" : desktopWidth;
}
