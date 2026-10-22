# SpeedView for Canvas: Privacy Policy

SpeedView was built for instructors to access student work, so it has to fit FERPA and similar student-privacy rules. In short: **SpeedView does not collect, store, or transmit any user or student data.**

## What SpeedView accesses

- **Submission files in SpeedGrader.** When you open a file in the SpeedView drawer, SpeedView accesses it using your current authorized session and then the file is displayed in your browser's temporary memory. This memory is flushed when you open another file, switch students, or close the page.
- **Submission details.** SpeedView reads the list of attached files for the submission on screen from your Canvas site's API: file names, sizes, and download links.
- **Course and assignment names.** SpeedView reads these from your Canvas site's API, so that course specific settings can be set.

## What SpeedView stores

Only your SpeedView settings: your Canvas site address, appearance preferences, and size limits. They're kept in your browser's extension storage. If you're signed in to your browser, it may sync them between your own devices. Never any student data or file contents are ever stored.

One exception you control: if you load a GTKWave save file (`.gtkw`) or save a layout in the waveform viewer, that signal list is kept in this browser's local extension storage for that assignment. Each saved layout contains only its name, signal names, and display settings (order, radix, comments, groups), plus the course and assignment names it belongs to. It contains no simulation values and no student file names, and it is never synced or sent anywhere. Delete layouts from **My layouts** in the waveform viewer, or from **Waveform layouts** on the settings page.

## What SpeedView sends

Nothing. SpeedView has:

- no analytics, telemetry, crash reporting, or advertising,
- no servers of its own and no third-party services,
- no remotely loaded code. Everything it runs ships inside the extension.

The extension's security policy enforces this: its pages may not connect to any server (`connect-src 'self'`). Rendered submissions (markdown, notebooks) can't load remote images or other resources. External URLs get stripped from all sources before rendering.

## Permissions

| Permission | Why |
|---|---|
| Access to your Canvas site(s) | Run in SpeedGrader and download submission files. Only sites you approve. |
| `storage` | Save your settings. |
| `scripting` | Activate SpeedView on the Canvas sites you approve. |
| `activeTab` | Let the toolbar button check whether the current tab is a Canvas site. |

## Contact

Questions or concerns: open an issue at https://github.com/mholgatem/SpeedViewForCanvas/issues.
