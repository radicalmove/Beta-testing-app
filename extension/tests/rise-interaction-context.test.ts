import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import {
  captureRiseInteractionContext,
  interactionContextLabel,
  isRiseInteractionContextActive,
  restoreRiseInteractionContext,
  validateRiseInteractionContext,
} from "../src/rise-interaction-context.ts";

function tabsFixture(): Document {
  const window = new Window({ url: "https://rise.example/course/index.html#/lesson" });
  const document = window.document as unknown as Document;
  document.body.innerHTML = `
    <section data-block-id="tabs-1" aria-label="Constitution types">
      <div role="tablist">
        <button role="tab" aria-controls="written" aria-selected="true">Written (codified)</button>
        <button role="tab" aria-controls="unwritten" aria-selected="false">Unwritten (uncodified)</button>
      </div>
      <div id="written" role="tabpanel"><p>Stable but inflexible</p></div>
      <div id="unwritten" role="tabpanel" hidden><p id="target">Flexible but harder to locate</p></div>
    </section>`;
  const controls = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=tab]"));
  for (const control of controls) control.addEventListener("click", () => {
    for (const candidate of controls) candidate.setAttribute("aria-selected", String(candidate === control));
    for (const panel of Array.from(document.querySelectorAll<HTMLElement>("[role=tabpanel]"))) panel.hidden = panel.id !== control.getAttribute("aria-controls");
  });
  return document;
}

function processFixture(): Document {
  const window = new Window({ url: "https://rise.example/course/index.html#/lesson" });
  const document = window.document as unknown as Document;
  document.body.innerHTML = `
    <section data-block-id="process-1">
      <h2>Participants</h2>
      <div class="carousel" role="region" aria-label="Participants">
        <div class="carousel-slide" role="group"><h3>Government and ministers</h3></div>
        <div class="carousel-slide" role="group" hidden><h3>Parliament</h3></div>
        <div class="carousel-slide" role="group" hidden><h3>Criminal justice agencies</h3><p id="target">Breaching the law</p></div>
        <button class="carousel-controls-item-btn" aria-label="Go to slide 1" aria-current="true"></button>
        <button class="carousel-controls-item-btn" aria-label="Go to slide 2" aria-current="false"></button>
        <button class="carousel-controls-item-btn" aria-label="Go to slide 3" aria-current="false"></button>
      </div>
    </section>`;
  const slides = Array.from(document.querySelectorAll<HTMLElement>(".carousel-slide"));
  const controls = Array.from(document.querySelectorAll<HTMLButtonElement>(".carousel-controls-item-btn"));
  for (const [index, control] of controls.entries()) control.addEventListener("click", () => {
    for (const [candidateIndex, candidate] of controls.entries()) candidate.setAttribute("aria-current", String(candidateIndex === index));
    for (const [slideIndex, slide] of slides.entries()) slide.hidden = slideIndex !== index;
  });
  return document;
}

test("captures and labels the owning Rise tab", () => {
  const document = tabsFixture();
  const context = captureRiseInteractionContext(document.querySelector("#target")!, document);
  assert.deepEqual(context, {
    version: 1,
    kind: "tabs",
    container: { block_id: "tabs-1", ordinal: 1, fingerprint: "Constitution types" },
    item: { ordinal: 2, count: 2, label: "Unwritten (uncodified)", control_key: "unwritten" },
  });
  assert.equal(interactionContextLabel(context!), "Tab: Unwritten (uncodified)");
});

test("captures a real Rise tab block whose data-block container has no accessible label", () => {
  const document = tabsFixture();
  const section = document.querySelector("section")!;
  section.removeAttribute("aria-label");
  section.className = "noOutline";
  section.setAttribute("data-block-id", "cmq675swk02a207op9se1ay8q");
  document.querySelector("[role=tablist]")!.className = "blocks-tabs__header";
  const panels = Array.from(document.querySelectorAll<HTMLElement>("[role=tabpanel]"));
  panels[0].className = "blocks-tabs__content-item";
  panels[1].className = "blocks-tabs__content-item blocks-tabs__content-item--active";

  const context = captureRiseInteractionContext(document.querySelector("#target")!, document);

  assert.deepEqual(context, {
    version: 1,
    kind: "tabs",
    container: {
      block_id: "cmq675swk02a207op9se1ay8q",
      ordinal: 1,
      fingerprint: "Written (codified) | Unwritten (uncodified)",
    },
    item: { ordinal: 2, count: 2, label: "Unwritten (uncodified)", control_key: "unwritten" },
  });
});

test("captures and labels the owning Rise process step", () => {
  const document = processFixture();
  const context = captureRiseInteractionContext(document.querySelector("#target")!, document);
  assert.deepEqual(context, {
    version: 1,
    kind: "process",
    container: { block_id: "process-1", ordinal: 1, fingerprint: "Participants" },
    item: { ordinal: 3, count: 3, label: "Criminal justice agencies", control_key: "Go to slide 3" },
  });
  assert.equal(interactionContextLabel(context!), "Step 3 of 3: Criminal justice agencies");
});

test("strict validation rejects extra keys and inconsistent process identity", () => {
  const document = processFixture();
  const valid = captureRiseInteractionContext(document.querySelector("#target")!, document);
  assert.equal(validateRiseInteractionContext({ ...valid, extra: true }), null);
  assert.equal(validateRiseInteractionContext({
    version: 1,
    kind: "process",
    container: { block_id: "process-1", ordinal: 1, fingerprint: "Participants" },
    item: { ordinal: 3, count: 3, label: "Criminal justice agencies", control_key: "Go to slide 2" },
  }), null);
});

test("restores only the exact saved tab and verifies its visible state", () => {
  const document = tabsFixture();
  const context = captureRiseInteractionContext(document.querySelector("#target")!, document)!;
  assert.equal(restoreRiseInteractionContext(context, document), "ready");
  assert.equal(document.querySelector('[aria-controls="unwritten"]')?.getAttribute("aria-selected"), "true");
  assert.equal((document.querySelector("#unwritten") as HTMLElement).hidden, false);
});

test("reports only the selected Rise tab context as active", () => {
  const document = tabsFixture();
  const unwritten = captureRiseInteractionContext(document.querySelector("#target")!, document)!;
  const written = {
    ...unwritten,
    item: { ordinal: 1, count: 2, label: "Written (codified)", control_key: "written" },
  };

  assert.equal(isRiseInteractionContextActive(written, document), true);
  assert.equal(isRiseInteractionContextActive(unwritten, document), false);
  (document.querySelector('[aria-controls="unwritten"]') as HTMLButtonElement).click();
  assert.equal(isRiseInteractionContextActive(written, document), false);
  assert.equal(isRiseInteractionContextActive(unwritten, document), true);
});

test("restores only the exact saved process step", () => {
  const document = processFixture();
  const context = captureRiseInteractionContext(document.querySelector("#target")!, document)!;
  assert.equal(restoreRiseInteractionContext(context, document), "ready");
  assert.equal(document.querySelector('[aria-label="Go to slide 3"]')?.getAttribute("aria-current"), "true");
  assert.equal((document.querySelectorAll<HTMLElement>(".carousel-slide")[2]).hidden, false);
});

test("reports only the selected Rise process step context as active", () => {
  const document = processFixture();
  const third = captureRiseInteractionContext(document.querySelector("#target")!, document)!;
  const first = {
    ...third,
    item: { ordinal: 1, count: 3, label: "Government and ministers", control_key: "Go to slide 1" },
  };

  assert.equal(isRiseInteractionContextActive(first, document), true);
  assert.equal(isRiseInteractionContextActive(third, document), false);
  (document.querySelector('[aria-label="Go to slide 3"]') as HTMLButtonElement).click();
  assert.equal(isRiseInteractionContextActive(first, document), false);
  assert.equal(isRiseInteractionContextActive(third, document), true);
});

test("returns not-ready before Rise renders and mismatch without clicking changed content", () => {
  const source = processFixture();
  const context = captureRiseInteractionContext(source.querySelector("#target")!, source)!;
  const blank = new Window().document as unknown as Document;
  assert.equal(restoreRiseInteractionContext(context, blank), "not-ready");

  const changed = processFixture();
  changed.querySelectorAll("h3")[2].textContent = "Courts";
  let clicks = 0;
  changed.querySelector('[aria-label="Go to slide 3"]')?.addEventListener("click", () => { clicks += 1; });
  assert.equal(restoreRiseInteractionContext(context, changed), "mismatch");
  assert.equal(clicks, 0);
});

test("omits context when neither the container nor its controls have a deterministic fingerprint", () => {
  const document = tabsFixture();
  const section = document.querySelector("section")!;
  section.removeAttribute("aria-label");
  for (const control of Array.from(document.querySelectorAll<HTMLElement>("[role=tab]"))) {
    control.textContent = "";
    control.removeAttribute("aria-label");
  }
  assert.equal(captureRiseInteractionContext(document.querySelector("#target")!, document), null);
});
