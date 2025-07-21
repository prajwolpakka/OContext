import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import ignore = require("ignore");

async function buildIgnoreFilter(root: string): Promise<(p: string) => boolean> {
	const gitignorePath = path.join(root, ".gitignore");
	try {
		const content = await fs.promises.readFile(gitignorePath, "utf8");
		const ig = ignore().add(content);
		return (p: string) => !ig.ignores(path.relative(root, p));
	} catch {
		// no .gitignore found → allow everything
		return () => true;
	}
}

// Helper to skip binary files
function looksBinary(buffer: Buffer): boolean {
	// crude heuristic: if we hit a zero byte in first 8 kB, treat as binary
	const max = Math.min(buffer.length, 8192);
	for (let i = 0; i < max; i++) {
		if (buffer[i] === 0) return true;
	}
	return false;
}

export function activate(context: vscode.ExtensionContext) {
	console.log("OContext extension activated");

	// 1) file variant
	const file = vscode.commands.registerCommand("ocontext.generatePromptToFile", handlerFactory(false));

	// 2) clipboard variant
	const clip = vscode.commands.registerCommand("ocontext.generatePromptToClipboard", handlerFactory(true));

	context.subscriptions.push(file, clip);
}

// factory returns the actual command handler
function handlerFactory(copyToClipboard: boolean) {
	return async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
		console.log("Command triggered");
		console.log("uri:", uri);
		console.log("uris:", uris);

		// If called from context menu, use the provided URIs
		let selectedUris: vscode.Uri[] = [];

		if (uris && uris.length > 0) {
			console.log("Using multiple URIs from context menu");
			selectedUris = uris;
		} else if (uri) {
			console.log("Using single URI from context menu");
			selectedUris = [uri];
		} else {
			console.log("No URIs provided, checking active editor");
			// Fallback: use currently open file
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor) {
				console.log("Using active editor file:", activeEditor.document.uri.fsPath);
				selectedUris = [activeEditor.document.uri];
			}
		}

		console.log("Selected URIs count:", selectedUris.length);

		if (selectedUris.length === 0) {
			console.log("No files found, showing warning");
			vscode.window.showWarningMessage("No files or folders selected.");
			return;
		}

		try {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: "Generating context…" },
				async () => {
					console.log("Building prompt...");

					if (copyToClipboard) {
						// ---- clipboard branch ----
						// 1) create the file exactly like the "file" branch
						const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
						const outDir = path.join(wsRoot, ".ocontext");
						await fs.promises.mkdir(outDir, { recursive: true });

						const now = new Date();
						const ts = now
							.toISOString()
							.replace(/[-:]/g, "")
							.replace(/\.\d{3}Z$/, "");
						const contextFile = path.join(outDir, `context_${ts}.txt`);

						// Stream the prompt to file
						await buildPromptToFile(
							selectedUris.map((u) => u.fsPath),
							contextFile
						);

						// 2) check file size before copying to clipboard
						const stat = await fs.promises.stat(contextFile);
						const sizeMB = stat.size / 1024 / 1024;
						if (sizeMB > 5) {
							vscode.window.showWarningMessage(
								`Context is ${sizeMB.toFixed(1)} MB – too large for clipboard. Use "Generate Context" instead.`
							);
							return;
						}

						// 3) copy the file contents to clipboard
						const buffer = await fs.promises.readFile(contextFile, "utf8");
						await vscode.env.clipboard.writeText(buffer);

						// 4) show info only
						vscode.window.showInformationMessage(
							`Context copied to clipboard & saved to ${path.basename(contextFile)} (${selectedUris.length} items).`
						);
					} else {
						// ---- file branch ----
						const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
						const outDir = path.join(wsRoot, ".ocontext");
						await fs.promises.mkdir(outDir, { recursive: true });

						const now = new Date();
						const ts = now
							.toISOString()
							.replace(/[-:]/g, "") // 20251105T182424
							.replace(/\.\d{3}Z$/, ""); // drop milliseconds & Z
						const contextFile = path.join(outDir, `context_${ts}.txt`);

						// Stream the prompt directly to file
						await buildPromptToFile(
							selectedUris.map((u) => u.fsPath),
							contextFile
						);

						const fileUri = vscode.Uri.file(contextFile);
						await vscode.window.showTextDocument(fileUri, { preview: false });

						// open the OS file explorer and highlight the file
						await vscode.commands.executeCommand("revealFileInOS", fileUri);

						vscode.window.showInformationMessage(`Generated context.txt (${selectedUris.length} items).`);
					}
					console.log("Success!");
				}
			);
		} catch (error) {
			console.error("Error building prompt:", error);
			vscode.window.showErrorMessage("Error generating context: " + error);
		}
	};
}

// Streaming version for large files - writes directly to output file
async function buildPromptToFile(fsPaths: string[], outputFile: string): Promise<void> {
	console.log("buildPromptToFile called with paths:", fsPaths);

	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
	console.log("Workspace root:", root);

	// Before the loop:
	const allow = root ? await buildIgnoreFilter(root) : () => true;

	const files: { abs: string; rel: string }[] = [];

	for (const p of fsPaths) {
		console.log("Processing path:", p);
		try {
			const stat = await fs.promises.stat(p);
			if (stat.isDirectory()) {
				console.log("Path is directory, finding files...");
				const rawFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(p, "**/*"));
				const all = rawFiles.filter((u) => allow(u.fsPath));
				console.log("Found files in directory:", all.length);
				for (const u of all) files.push({ abs: u.fsPath, rel: path.relative(root, u.fsPath) });
			} else {
				console.log("Path is file");
				files.push({ abs: p, rel: path.relative(root, p) });
			}
		} catch (error) {
			console.error("Error processing path:", p, error);
		}
	}

	console.log("Total files to include:", files.length);

	// --- NEW: Pre-flight checks ---
	const totalFiles = files.length;
	let estimatedBytes = 0;

	// Calculate estimated total size
	for (const { abs } of files) {
		try {
			const stat = fs.statSync(abs);
			estimatedBytes += stat.size;
		} catch {
			// Skip files we can't stat, they'll be handled later
		}
	}

	const estimatedMB = estimatedBytes / 1024 / 1024;

	if (totalFiles > 1000 || estimatedMB > 10) {
		const msg = `About to include ${totalFiles} files (~${estimatedMB.toFixed(1)} MB). Continue?`;
		const choice = await vscode.window.showWarningMessage(msg, { modal: true }, "Yes");
		if (choice !== "Yes") return; // user bailed
	}
	// -----------------------------

	// Create write stream
	const out = fs.createWriteStream(outputFile, { encoding: "utf8" });

	try {
		// Write header
		out.write(
			`# Context Generation Request\n\n## Project Structure:\n\`\`\`\n${files
				.map((f) => f.rel)
				.join("\n")}\n\`\`\`\n\n## File Contents:\n\n`
		);

		// Stream each file
		for (const { abs, rel } of files) {
			try {
				console.log("Reading file:", rel);
				const buffer = await fs.promises.readFile(abs); // read as Buffer
				if (looksBinary(buffer)) {
					console.log("Skipping binary file:", rel);
					continue; // skip binary
				}

				// Write file header
				out.write(`### ${rel}\n\`\`\`\n`);

				// Stream file content
				const content = buffer.toString("utf8");
				out.write(content);

				// Write file footer
				out.write(`\n\`\`\`\n\n`);
			} catch {
				console.log("Could not read file:", rel);
				out.write(`### ${rel}\n\`\`\`\n[unreadable]\n\`\`\`\n\n`);
			}
		}
	} finally {
		out.end();
		await new Promise((resolve, reject) => {
			out.on("finish", resolve);
			out.on("error", reject);
		});
	}

	console.log("Prompt streamed to file:", outputFile);
}

async function buildPrompt(fsPaths: string[]): Promise<string> {
	console.log("buildPrompt called with paths:", fsPaths);

	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
	console.log("Workspace root:", root);

	// Before the loop:
	const allow = root ? await buildIgnoreFilter(root) : () => true;

	const files: { abs: string; rel: string }[] = [];

	for (const p of fsPaths) {
		console.log("Processing path:", p);
		try {
			const stat = await fs.promises.stat(p);
			if (stat.isDirectory()) {
				console.log("Path is directory, finding files...");
				const rawFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(p, "**/*"));
				const all = rawFiles.filter((u) => allow(u.fsPath));
				console.log("Found files in directory:", all.length);
				for (const u of all) files.push({ abs: u.fsPath, rel: path.relative(root, u.fsPath) });
			} else {
				console.log("Path is file");
				files.push({ abs: p, rel: path.relative(root, p) });
			}
		} catch (error) {
			console.error("Error processing path:", p, error);
		}
	}

	console.log("Total files to include:", files.length);

	let prompt = `# Context Generation Request\n\n## Project Structure:\n\`\`\`\n${files
		.map((f) => f.rel)
		.join("\n")}\n\`\`\`\n\n## File Contents:\n\n`;

	for (const { abs, rel } of files) {
		try {
			console.log("Reading file:", rel);
			const buffer = await fs.promises.readFile(abs); // read as Buffer
			if (looksBinary(buffer)) {
				console.log("Skipping binary file:", rel);
				continue; // skip binary
			}
			const content = buffer.toString("utf8");
			prompt += `### ${rel}\n\`\`\`\n${content}\n\`\`\`\n\n`;
		} catch {
			console.log("Could not read file:", rel);
			prompt += `### ${rel}\n\`\`\`\n[unreadable]\n\`\`\`\n\n`;
		}
	}

	console.log("Prompt generated, length:", prompt.length);
	return prompt;
}

export function deactivate() {}
