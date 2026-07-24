# Obsidian Ribbon Hider

An Obsidian plugin that lets you declutter your workspace by hiding ribbon buttons (on the left sidebar) with a simple right-click.

Created by [Lucy Roh](https://github.com/lucyroh).

## Features

- **Right-Click to Hide**: Simply right-click on any ribbon button and select `Hide "[Button Name]"` to hide it immediately.
- **Settings Dashboard**: A dedicated settings tab listing all active ribbon buttons, allowing you to easily toggle them back on.
- **Unhide All**: A single button to restore all hidden ribbon items instantly.
- **Orphan Cleanups**: Automatically tracks hidden buttons from disabled or removed plugins, allowing you to clean them up from settings.
- **Lightweight**: Uses clean, non-intrusive CSS styling to toggle button visibility, leaving the underlying DOM intact and fully compatible with other plugins.

---

## Installation

### Manual Installation
1. Go to the [Releases](https://github.com/lucyroh/obsidian-ribbon-hider/releases) page and download the latest release files:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create a folder named `obsidian-ribbon-hider` inside your vault's plugins folder: `<your-vault>/.obsidian/plugins/obsidian-ribbon-hider/`.
3. Move the downloaded files into that folder.
4. Open Obsidian and navigate to **Settings > Community plugins**. Click the refresh button, then toggle the switch next to **Ribbon Hider** to enable it.

---

## Development

If you'd like to build the plugin from source or contribute to its development, follow these steps:

### Setup
1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```

### Build Scripts
- **Development Build (with watch mode)**:
  ```bash
  npm run dev
  ```
- **Production Build**:
  ```bash
  npm run build
  ```

---

## License

This project is licensed under the [MIT License](LICENSE).
