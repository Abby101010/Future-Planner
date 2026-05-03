import { useEffect, useState } from "react";

const getWidth = () =>
  typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth;

export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(getWidth);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width;
}

export const SPLIT_MIN_WIDTH = 1024;
