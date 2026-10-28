# SpeedView for Canvas

A browser extension for quickly viewing files in Canvas SpeedGrader.

Canvas' built-in SpeedGrader can only preview a few file types. Anything else (Python, Verilog, C, notebooks, zip files…) has to be downloaded and opened by hand for every student. SpeedView adds a drawer to SpeedGrader that shows those files right next to the grading panel.

- **Zip archives:** view the contents of `.zip`, `.tar`, `.tar.gz`/`.tgz`, and `.gz` without downloading or unzipping, including nested archives.
- **Source code** with syntax highlighting and line numbers: Python, Verilog/SystemVerilog, VHDL, C/C++, Java, JavaScript/TypeScript, assembly (MIPS/ARM/x86/AVR), Tcl/XDC, MATLAB, R, Rust, Go, and many more.
- **Jupyter notebooks** with code, markdown, outputs, and plots.
- **Markdown** (rendered or source), **CSV/TSV** tables, **images**, and **PDFs**. Sideways images and scans can be rotated, a whole PDF at once or one page at a time.
- **Word documents** (`.docx`), including ones inside zip files, with formatting, tables, images, and equations.
- **Excel workbooks** (`.xlsx`) with cell formatting, number formats, merged cells, and sheet tabs. Click a cell to see its formula, or show all formulas at once.
- **PowerPoint presentations** (`.pptx`, experimental): each slide drawn with its layout, pictures, text styles, shapes, tables, equations, and SmartArt, plus speaker notes. Charts appear as their data. A text-outline mode lists each slide's content in reading order. Hidden slides are marked.
- **Waveforms** (`.vcd`): signals drawn GTKWave-style with values at a cursor, zoom, and pan. The signal list can be generated from a GTKWave save file (`.gtkw`) in the submission, or one you load from your computer. Add, remove, reorder, and group signals, change their radix, and add comments; then save it as one of your layouts for the assignment or export it as a `.gtkw`. You can keep several layouts per assignment (one per waveform); each student's VCD opens with the one that fits it best. Manage your saved layouts in settings.
- **Hex preview** for binary files
- **Download individual files directly from a zip archive!**

The drawer follows SpeedGrader as you move between students and attempts. It's resizable and can dock on either side; the default is the left, so it covers the preview pane and leaves the grade box visible. Press **Alt+Shift+V** to toggle it.

## Privacy (FERPA)

Student data never leaves your browser. Files are loaded from your own Canvas site with your existing login, shown in memory, and discarded on page refresh/exit. SpeedView has no servers, analytics, or third-party services, and loads no remote code. See [PRIVACY.md](PRIVACY.md).

## Install

- **Chrome / Edge:** Chrome Web Store (link coming soon)
- **Firefox:** Firefox Add-ons (link coming soon)
- **Safari:** build from source; see [docs/SAFARI.md](docs/SAFARI.md).

### Setup

On first install, the settings page opens. Add your school's Canvas address, for example `canvas.myschool.edu`, and approve access. Instructure-hosted sites (`*.instructure.com`) are listed by default. You can also click the SpeedView toolbar button on your Canvas site and choose **Enable**.

Open any assignment in SpeedGrader and click the **SpeedView** tab at the edge of the page.

## Development

Requires Node.js 20+.

```sh
npm install
npm run dev            # Chrome with hot reload
npm run dev:firefox    # Firefox with hot reload
```

| Command | What it does |
|---|---|
| `npm run build:chrome` / `build:firefox` / `build:safari` | Production builds in `.output/<browser>-mv3` |
| `npm run zip:all` | Store-ready zips (plus the source zip that Firefox Add-ons review requires) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests: Chromium with the extension loaded, against a local fake Canvas |
| `npm run typecheck` | TypeScript checks |
| `npm run check:external` | Fails if a build contains any unreviewed external URL |
| `npm run icons` | Regenerate the icons in `public/icon` |

To load a build manually: in Chrome, open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and pick `.output/chrome-mv3`. In Firefox, open `about:debugging`, click **This Firefox → Load Temporary Add-on**, and pick `.output/firefox-mv3/manifest.json`.

### How it works

- `entrypoints/speedgrader.content.ts` runs only on SpeedGrader pages of the sites you approved. It watches the URL for student changes, asks the Canvas API (same origin, your session) for the submission's attachments, and downloads files when the viewer asks.
- `entrypoints/viewer/` is an extension page shown in the drawer's iframe. It receives file bytes from the content script over `postMessage`, and handles archives (`src/archive`) and rendering (`src/render`, `src/viewer`). PDFs use a bundled copy of pdf.js, Word documents use docx-preview, Excel workbooks are read by `src/render/xlsx.ts`, PowerPoint presentations by `src/render/pptx.ts`, and waveforms by `src/render/vcd.ts` and `src/render/gtkw.ts` (drawn by `src/viewer/waves.ts`).
- `entrypoints/options/` is the settings page. `src/settings/registration.ts` registers the content script for each approved domain.

Testing against real Canvas involves student data. Use the local fixtures in `tests/e2e/server.ts` for automated testing instead.

## License

MIT. See [LICENSE](LICENSE). Bundled third-party libraries keep their own licenses: highlight.js (BSD-3-Clause), pdf.js (Apache-2.0), docx-preview (Apache-2.0), JSZip (MIT), fflate (MIT), marked (MIT), DOMPurify (Apache-2.0/MPL-2.0).
