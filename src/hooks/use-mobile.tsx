import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * React hook that returns `true` when the viewport width is below the mobile
 * breakpoint (768 px).  Subscribes to `window.matchMedia` change events so the
 * value stays up to date when the user resizes the window.
 *
 * @returns `true` on mobile-sized viewports, `false` otherwise.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
