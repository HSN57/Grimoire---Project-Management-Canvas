# Grimoire - Project Management Canvas

Grimoire is an interactive, visual project management tool designed as an infinite canvas. It allows users to organize tasks, information, and workflows using customizable nodes (bubbles) and dynamic connections.

## Features

- **Infinite Canvas Workspace**: Freely pan and zoom around an expansive workspace. A built-in minimap helps you navigate complex projects with ease.
- **Node Management (Bubbles)**:
  - **Task Bubbles**: Track actionable items with completion status.
  - **Info Bubbles**: Store notes, documentation, or reference material.
  - **Container Bubbles**: Group related bubbles together for better organization.
- **Dynamic Connections**: Connect nodes to establish relationships or workflows. Connections (edges) are fully customizable:
  - Choose colors, line styles (solid, dashed, dotted), and arrow directions.
  - Interactive edge routing with draggable connection points.
- **Rich Customization**:
  - Color-code nodes and connections with a built-in palette.
  - Align text, add descriptions, and nest sub-tasks/info directly inside nodes.
  - Global Light/Dark mode toggle for comfortable viewing.
  - **Global Theme Editor**: Fully customize the entire app's color palette (backgrounds, texts, and accents) for both Light and Dark modes via the Settings menu.
- **Workspace Organization**:
  - **Pages**: Manage multiple independent workspaces using the sidebar.
  - **Grid & Snapping**: Configure grid size and enable snap-to-grid for precise layouts.
  - **Export Page**: Export individual pages to `.txt` files for archiving or sharing.
  - **Database Management**: Export your entire application state to a `.json` backup file, and import it at any time to restore your workspace.
- **Advanced Interactions**:
  - Right-click context menus for quick actions (Group, Ungroup, Copy, Paste, Delete).
  - Selection box for multi-node actions.

## Technology Stack

- **HTML5**: Structured layout and SVG-based canvas rendering.
- **CSS3**: Vanilla CSS with modern features (Glassmorphism UI, CSS variables for theming).
- **JavaScript (ES6+)**: Core logic, interactive dragging, local storage persistence, and dynamic rendering.

## How to Use

1. **Run the App**: Since this is a vanilla web application, simply open `index.html` in any modern web browser to start using it.
2. **Interact**:
   - **Right-Click** anywhere on the canvas to add new bubbles or groups.
   - **Click & Drag** to pan the canvas. Use the zoom controls or mouse wheel to zoom in/out.
   - **Drag edges** from the ports of nodes to connect them together.
   - **Select** a node or edge to open the Details Sidebar and customize its properties.
3. **Data Persistence**: All changes are automatically saved to your browser's Local Storage, meaning your project is exactly where you left it the next time you open the app.
4. **Settings & Backups**: Open the left sidebar and click the **Gear Icon** to access Settings. From here, you can tweak your global color palettes or download a `.json` backup of your entire workspace from the Database tab.
