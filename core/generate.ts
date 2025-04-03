#!/usr/bin/env -S deno run -A

import "npm:dotenv/config";
import fs from "node:fs/promises";
import * as path from "jsr:@std/path";

const rootDir = path.dirname(path.fromFileUrl(import.meta.url));

const templateFiles = await fs
  .readdir(rootDir, { withFileTypes: true, recursive: true, encoding: "utf-8" })
  .then((files) =>
    files.filter((file) => file.isFile() && ["ini", "yml", "yaml", "json"].some((ext) => file.name.endsWith(`.${ext}.ts`)))
  );

await Promise.all(
  templateFiles.map(async (file) => {
    const templatePath = `${file.parentPath}/${file.name}`;
    const outputFilePath = `${file.parentPath}/${file.name.replace(/.ts$/, "")}`;
    const { default: content } = await import(templatePath);
    console.info("Generating", outputFilePath, "...");
    await fs.writeFile(outputFilePath, content);
  })
);
