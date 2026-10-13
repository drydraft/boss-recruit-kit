# Canvas and WASM extraction

## Recognition

The pane has no usable text when:

- `innerText` of the container is empty or a single word, while the element has visible size;
- the DOM holds one `<canvas>` and little else;
- selection copies nothing;
- search-in-page finds none of the words visibly present on screen.

**Rule**: never conclude "the data is missing". Conclude "the data is pixels" and switch to canvas extraction.

## The foreground rule (most common false failure)

Chromium throttles rendering for non-focused windows. A WASM canvas therefore **stops repainting** and keeps its initial placeholder size (commonly `300×150`) while the DOM still claims the modal is open.

Consequences:

- A capture taken from a background window is **invalid evidence** — it is indistinguishable from an empty result.
- The fix is not "wait longer" but **focus the window** (`windows.update{focused:true}` + `tabs.update{active:true}`) before every read and every click.

Self-check before diagnosing anything else: are the canvas dimensions plausible for the viewport? If they equal the default placeholder, the window was not focused.

## Sizing model

Canvas apps usually do **not** grow the canvas with the document. Expect:

- the canvas stays viewport-sized;
- the container holds a large scroll height (document length);
- scrolling pans content inside the canvas (often via a CSS transform on the canvas itself).

Practical read: `canvas.size` is the capture region per viewport; `container.scrollHeight` is how far you will need to step.

## Chunked capture

Single whole-canvas export is a violation of the core channel's payload gate.

Recommended loop:

1. Reset the scroller to the top; wait for repaint.
2. Read the canvas size; split into a **2×2 grid** (four tiles).
3. Export each tile at **native resolution**; each response stays well under the 64 KB ceiling.
4. Step the scroller by roughly one viewport (slightly less, to keep an overlap).
5. Repeat until the scroller stops advancing.

Name files `page-index_tile-index` so the reading order survives independent of capture order.

## Canvas-drawn affordances

Buttons and links may be **painted by the app**, not present in the DOM. Detection recipe that works in practice:

1. Read a pixel buffer of the canvas.
2. Cluster by the app's **accent colour** (sample it from a rendered screenshot first — do not guess).
3. Keep clusters whose aspect ratio is text-like (wide and short), within a size band derived from the measured sample.
4. Convert cluster centres to **frame-local coordinates** and dispatch a full pointer sequence there: `pointerover → pointerenter → pointermove → mousemove → pointerdown → pointerup → mousedown → mouseup → click`.
5. Verify the effect (an expanded text region, a new visual state) before trusting the click.

A bare synthetic `click()` on a canvas coordinate does nothing in most WASM UIs.

## Truncated content

UI text is often clamped behind a "show all" affordance. Order of operations for a faithful read:

1. Locate and activate every "show all" control (see above).
2. Re-scan until no new affordances appear.
3. Only then capture pages.

Failing to do this yields a resume/profile that silently stops mid-sentence.

## Reading canvas content with a model

Pixels are the source of truth. Practical notes:

- Prefer **native resolution** tiles; downscaled text loses small punctuation that changes meaning.
- Keep a deterministic file order and pass tiles in reading order.
- Do not OCR-and-trust: punctuation, digits, and dates are where OCR silently corrupts evidence. If a value must be exact (an ID, a date), require a second independent read.
- Treat the model's reading as **derived evidence**: record the tile file it came from so a later audit can re-open the same pixels.
