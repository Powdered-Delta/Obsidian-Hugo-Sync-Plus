import { copyFile } from "fs/promises";
import { join } from "path";

const sourceDir = ".";
const targetDir =
  process.env.OBSIDIAN_PLUGIN_DIR ||
  "E:/Obsidian/.obsidian/plugins/hugo-sync-plus";

const filesToCopy = ["main.js", "manifest.json", "styles.css"];

async function copyBuildFiles() {
  for (const file of filesToCopy) {
    try {
      await copyFile(join(sourceDir, file), join(targetDir, file));
      console.log(`Copied ${file} to ${targetDir}`);
    } catch (error) {
      console.error(`Error copying ${file}:`, error);
    }
  }
}

copyBuildFiles();
