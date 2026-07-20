export type PanelStateStorage = Pick<Storage, "getItem" | "setItem">;

const panelStateKey = (courseUrl: string) => `moodle-course-review:panel:${courseUrl}`;

export function readCoursePanelState(storage: PanelStateStorage | undefined, courseUrl: string): boolean {
  try {
    return storage?.getItem(panelStateKey(courseUrl)) === "open";
  } catch {
    return false;
  }
}

export function writeCoursePanelState(storage: PanelStateStorage | undefined, courseUrl: string, open: boolean): void {
  try {
    storage?.setItem(panelStateKey(courseUrl), open ? "open" : "closed");
  } catch {
    // Browser storage can be unavailable or blocked without disabling the overlay.
  }
}
