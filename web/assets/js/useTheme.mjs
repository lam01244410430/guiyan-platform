/* React hook for the manual theme (see theme.mjs for the state itself).
   Kept in its own module so theme.mjs stays react-free and node-testable.
   Subscribes with useSyncExternalStore, so the header toggle and the
   settings control always show the same state. */
import { useSyncExternalStore } from "react";
import {
  getThemeChoice,
  getEffectiveTheme,
  setTheme,
  toggleTheme,
  subscribeTheme,
} from "./theme.mjs";

export function useTheme() {
  const effective = useSyncExternalStore(
    subscribeTheme,
    getEffectiveTheme,
    getEffectiveTheme,
  );
  return { choice: getThemeChoice(), effective, setTheme, toggleTheme };
}
