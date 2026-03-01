# Screenshot Helper — Saltcorn Plugin

A [Saltcorn](https://github.com/saltcorn/saltcorn) view plugin that lets you paste screenshots directly from the clipboard, stores them as public files, and displays them in a responsive gallery.

## Features

- **Paste to upload** — press Ctrl+V / ⌘V anywhere on the page to upload the clipboard image instantly
- **Responsive gallery** — uploaded screenshots displayed in a Bootstrap card grid
- **Copy link** — one-click copy of the public file URL to the clipboard
- **Delete** — remove individual screenshots from the gallery and from storage
- **Auto table setup** — the `screenshot-helper` table and its fields are created automatically on first use
- **Server-side validation** — only image files (PNG, JPEG, GIF, WebP, BMP) are accepted; maximum size is 5 MB
- No external npm dependencies

## Requirements

- Saltcorn ≥ 0.9.x
- Font Awesome (included in most Saltcorn themes)

## Installation

1. In your Saltcorn instance open **Settings → Plugins**.
2. Search for `screenshot-helper` and click **Install**.
3. Create a new view, choose the **Screenshot Helper** view type, and place it on any page.

The plugin automatically creates a table named `screenshot-helper` with the fields `filename`, `url`, and `mime_type` the first time the view is rendered.

## Usage

Open the page that contains your Screenshot Helper view, take a screenshot (e.g. with your OS snipping tool), and press **Ctrl+V** (Windows/Linux) or **⌘V** (macOS). The image is uploaded immediately and appears at the top of the gallery.

### Accepted file types & limits

| Format | MIME type |
|--------|-----------|
| PNG | `image/png` |
| JPEG | `image/jpeg` |
| GIF | `image/gif` |
| WebP | `image/webp` |
| BMP | `image/bmp` |

Maximum file size: **5 MB**

Files outside these types or above the size limit are rejected with an error message.

## File Structure

```
screenshot-helper/
├── index.js      # Plugin entry point (viewtemplate + upload/delete routes)
└── package.json
```

## License

MIT © Patrick Pasch
