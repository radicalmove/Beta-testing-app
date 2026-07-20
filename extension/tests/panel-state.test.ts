import assert from "node:assert/strict";
import test from "node:test";

import { readCoursePanelState, writeCoursePanelState, type PanelStateStorage } from "../src/ui/panel-state.ts";

const courseA = "https://learn.example/course/view.php?id=1";
const courseB = "https://learn.example/course/view.php?id=2";

function createStorage(): PanelStateStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("panel state is restored for the same canonical course URL", () => {
  const storage = createStorage();

  writeCoursePanelState(storage, courseA, true);

  assert.equal(readCoursePanelState(storage, courseA), true);
  assert.deepEqual([...storage.values.values()], ["open"]);
});

test("different canonical course URLs keep independent panel states", () => {
  const storage = createStorage();

  writeCoursePanelState(storage, courseA, true);
  writeCoursePanelState(storage, courseB, false);

  assert.equal(readCoursePanelState(storage, courseA), true);
  assert.equal(readCoursePanelState(storage, courseB), false);
  assert.deepEqual([...storage.values.values()].sort(), ["closed", "open"]);
});

test("missing and malformed panel states fall back to collapsed", () => {
  const storage = createStorage();

  assert.equal(readCoursePanelState(storage, courseA), false);
  for (const malformed of ["OPEN", "true", "closed", "", " open "]) {
    storage.values.set(`moodle-course-review:panel:${courseA}`, malformed);
    assert.equal(readCoursePanelState(storage, courseA), false);
  }
});

test("throwing storage reads and writes fail safely", () => {
  const readFailure: PanelStateStorage = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => undefined,
  };
  const writeFailure: PanelStateStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("quota"); },
  };

  assert.equal(readCoursePanelState(readFailure, courseA), false);
  assert.doesNotThrow(() => writeCoursePanelState(writeFailure, courseA, true));
  assert.equal(readCoursePanelState(undefined, courseA), false);
  assert.doesNotThrow(() => writeCoursePanelState(undefined, courseA, false));
});
