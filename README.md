# OContext

Generate LLM-ready context prompts from any file or folder in VS Code.

## Quick Start

1. **Select** files or folders in the Explorer.
2. **Run** one of the commands from the Command Palette or Explorer context menu:
   - **"OContext: Generate Context"** - Creates a timestamped file and opens it in your OS file explorer
   - **"OContext: Generate Context and Copy to Clipboard"** - Creates a file AND copies the content to clipboard
3. **Paste** into ChatGPT, Claude, Cursor, or any other LLM interface.

## Features

- **Two output modes**: timestamped files (`context_20251105T182424.txt`) with optional clipboard copy
- **Smart filtering**: respects `.gitignore` and automatically skips binary files
- **Memory efficient**: streams large repositories without performance issues
- **Safe for large projects**: warns before processing >1000 files or >10 MB of content
- **Clipboard protection**: prevents copying files >5 MB to clipboard (suggests file mode instead)
- **Multi-select support**: works with files, folders, or both
- **Clean prompts**: only project structure and file contents (no extra instructions)
- **Progress notifications**: clear success/error messages
- **Zero-config**: works out of the box in any workspace

## File Output

Both commands create a `.ocontext/` folder in your workspace root with timestamped files like `context_20251105T182424.txt`.

**"Generate Context"** mode:

- Creates the file
- Opens it in VS Code for preview
- Reveals it in your OS file explorer for easy sharing

**"Generate Context and Copy to Clipboard"** mode:

- Creates the file (same as above)
- Additionally copies the content to clipboard for immediate pasting
- Shows warning if content is too large for clipboard (>5 MB)

## Safety Features

- **Pre-flight warnings**: Alerts before processing large selections (>1000 files or >10 MB estimated)
- **Clipboard limits**: Prevents clipboard errors by checking file size before copying
- **Streaming architecture**: Handles huge repositories without running out of memory
- **Binary file detection**: Automatically skips images, executables, and other non-text files

## Development

```bash
npm install
npm run compile
# Press F5 to launch the Extension Development Host
```

## Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository** and clone your fork
2. **Install dependencies**: `npm install`
3. **Make your changes** in the `src/` directory
4. **Test your changes**:
   - Run `npm run compile` to check for TypeScript errors
   - Press `F5` to launch the Extension Development Host
   - Test with various file selections (single files, folders, large repositories)
5. **Submit a pull request** with a clear description of your changes

### Reporting issues:

If you encounter bugs or have feature requests, please open an issue with:

- Steps to reproduce the problem
- Expected vs actual behavior
- Your VS Code version and operating system
- Sample files/folders that trigger the issue (if applicable)

## Publishing

```bash
npm install -g vsce
vsce publish
```

MIT © 2025 OContext Contributors
