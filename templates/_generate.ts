import fs from "node:fs/promises";
import * as path from "jsr:@std/path";

// recursively get all templates files: *.ts & !_*.ts
const __dirname = path.dirname(path.fromFileUrl(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const templates = await fs.readdir("templates", { withFileTypes: true, recursive: true, encoding: "utf-8" });

const tsFiles = templates.filter((file) => file.isFile() && file.name.endsWith(".ts"));

const tsFilesWithoutUnderscore = tsFiles.filter((file) => !file.name.startsWith("_"));

// Write the generated files
await Promise.all(
  tsFilesWithoutUnderscore.map(async (file) => {
    const templatePath = `${file.parentPath}/${file.name}`;
    const outputFilePath = `${file.parentPath.replace(/^templates/, ".")}/${file.name.replace(/.ts$/, "")}`;
    const { default: content } = await import(`${rootDir}/${templatePath}`);
		console.info("Generating", outputFilePath, "...");
    await fs.writeFile(`${rootDir}/${outputFilePath}`, content);
  })
);
