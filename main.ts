import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  Notice,
  TAbstractFile,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { languages, LanguageStrings } from "./lang";

interface HugoSyncSettings {
  hugoPath: string;
  contentPath: string;
  // image to static 配置项，启用后markdown会默认将图片保存在static文件夹下
  // 关闭时，将会以markdown 文件名新建文件夹，原markdown 重命名为 index.md，
  // 图片保存在同目录 images 文件夹下
  imageToStatic: boolean;
  staticPath: string;
  filteredHeaders: string[];
  language: string;
  descriptionLines: number;
  descriptionMaxLength: number;
  useFirstImageAsCover: boolean;
  authorName: string;
}

interface CopyImageItem {
  originalPath: string;
  newPath: string;
  newName: string;
}

const DEFAULT_SETTINGS: HugoSyncSettings = {
  hugoPath: "",
  contentPath: "content/posts",
  imageToStatic: true,
  staticPath: "static",
  filteredHeaders: [],
  language: "en",
  descriptionLines: 5,
  descriptionMaxLength: 120,
  useFirstImageAsCover: false,
  authorName: "",
};

export default class HugoSyncPlugin extends Plugin {
  settings: HugoSyncSettings;
  lang: LanguageStrings;

  async onload() {
    await this.loadSettings();
    this.lang = languages[this.settings.language] || languages.en;

    try {
      // Change the icon to 'refresh-cw'
      this.addRibbonIcon(
        "refresh-cw",
        this.lang.notices.iconNotice,
        (evt: MouseEvent) => {
          this.syncSelectedToHugo();
        }
      );
    } catch (error) {
      console.error("Failed to add ribbon icon:", error);
    }

    this.addCommand({
      id: "sync-selected-to-hugo",
      name: this.lang.notices.commandName,
      callback: () => this.syncSelectedToHugo(),
    });

    this.addSettingTab(new HugoSyncSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.lang = languages[this.settings.language] || languages.en;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.lang = languages[this.settings.language] || languages.en;
  }

  async syncSelectedToHugo() {
    const selectedFiles = this.getSelectedFiles();
    if (selectedFiles.length === 0) {
      new Notice(this.lang.notices.noFilesSelected);
      return;
    }

    let successCount = 0;
    let failCount = 0;
    let errorMessages = [];

    for (const file of selectedFiles) {
      try {
        await this.syncFileToHugo(file);
        successCount++;
      } catch (error) {
        failCount++;
        errorMessages.push(`${file.name}: ${error.message}`);
        console.error(`Error syncing file ${file.name}:`, error);
      }
    }

    // 创建详细的结果消息
    let resultMessage = this.lang.notices.syncResult
      .replace("{0}", selectedFiles.length.toString())
      .replace("{1}", successCount.toString())
      .replace("{2}", failCount.toString());

    if (failCount > 0) {
      resultMessage +=
        "\n\n" +
        this.lang.notices.syncErrors +
        ":\n" +
        errorMessages.join("\n");
    }

    // 显示结果通知
    new Notice(resultMessage, 10000); // 显示10秒

    // 如果有错误，在控制台输出详细信息
    if (failCount > 0) {
      console.error("Sync errors:", errorMessages);
    }
  }

  getSelectedFiles(): TFile[] {
    const selectedFiles: TFile[] = [];

    // 获取文浏览器中选中的文件
    const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
    if (fileExplorer && fileExplorer.view) {
      // @ts-ignore
      const selectedItems = fileExplorer.view.fileItems;
      if (selectedItems) {
        for (const item of Object.values(selectedItems)) {
          // @ts-ignore
          if (
            item &&
            item.file instanceof TFile &&
            item.titleEl &&
            item.titleEl.classList &&
            item.titleEl.classList.contains("is-selected")
          ) {
            selectedFiles.push(item.file);
          }
        }
      }
    }

    // 如果文件浏览器中没有选中文件，则使用当前活动文件
    if (selectedFiles.length === 0) {
      const activeFile = this.app.workspace.getActiveFile();
      if (activeFile) {
        selectedFiles.push(activeFile);
      }
    }

    return selectedFiles;
  }

  async syncFileToHugo(file: TFile) {
    const content = await this.app.vault.read(file);

    const { hugoContent, imageList } = this.convertToHugoFormat(
      content,
      file.name
    );

    const hugoFilePath = (() => {
      if (this.settings.imageToStatic) {
        return path.join(
          this.settings.hugoPath,
          this.settings.contentPath,
          file.name.replace(".md", ""),
          "index.md"
        );
      } else {
        return path.join(
          this.settings.hugoPath,
          this.settings.contentPath,
          file.name
        );
      }
    })();

    fs.writeFileSync(hugoFilePath, hugoContent);
    this.addImagesToHugo(imageList, file.name);
  }

  async addImagesToHugo(imageList: CopyImageItem[], fileName: string) {
    // 此方法根据用户配置将图片拷贝到 hugo 的 content 文件夹中
    // path 的差距已经在 convertToHugoFormat 中处理过了
    // 此处只需要按顺序拷贝图片到对应的位置
    for (const image of imageList) {
      fs.writeFileSync(image.originalPath, image.newPath);
    }
  }

  convertToHugoFormat(
    content: string,
    fileName: string
  ): { hugoContent: string; imageList: CopyImageItem[] } {
    const title = fileName.replace(".md", "");
    const date = new Date().toISOString();

    const tags: string[] = [];

    const lines = content.split("\n");
    let tagSection = false;
    let processedContent = [];
    let currentHeaderLevel = 0;
    let skipContent = false;

    const symbolOnlyRegex = /^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]+$/;

    const imagesToCopy: CopyImageItem[] = [];

    let description = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 根据标题层级，判断是否需要跳过该标题下的内容
      if (trimmedLine.startsWith("##")) {
        const headerMatch = trimmedLine.match(/^(#+)\s*(.*)/);
        if (headerMatch) {
          const headerLevel = headerMatch[1].length;
          const headerContent = headerMatch[2];

          if (headerLevel <= currentHeaderLevel) {
            skipContent = false;
          }

          if (this.settings.filteredHeaders.includes(headerContent)) {
            skipContent = true;
            currentHeaderLevel = headerLevel;
            continue;
          }

          currentHeaderLevel = headerLevel;
        }
      }

      // 检查是否为图片引用
      if (!skipContent) {
        const imageRegex =
          /!\[.*?\]\((.*?\.(?:png|jpg|jpeg|gif|webp|svg))(?:\s+["'].*?["'])?\)/gi;
        let match;
        while ((match = imageRegex.exec(line)) !== null) {
          const imagePath = match[1];
          // 检查图片是否为本地文件（不处理网络图片）
          if (!imagePath.startsWith("http")) {
            // 构建完整的原始图片路径
            const originalImagePath = path.join(
              path.dirname(this.app.workspace.getActiveFile()?.path || ""),
              imagePath
            );

            // 检查图片文件是否存在
            if (fs.existsSync(originalImagePath)) {
              // 生成新的图片文件名（使用原文件名+时间戳避免冲突）
              const ext = path.extname(imagePath);
              const basename = path.basename(imagePath, ext);
              const newName = `${basename}_${Date.now()}${ext}`;

              // 构建目标路径
              // 增加选项：
              //     和源文件在同一目录下，新建文件夹
              //     或者统一放到 static 下

              if (this.settings.imageToStatic) {
                var newImagePath = path.join(
                  this.settings.hugoPath,
                  this.settings.staticPath,
                  "images",
                  newName
                );
              } else {
                // 和md源文件放到同一目录下(markdown
                //  原名作为文件夹名字，图片放到同目录 images 目录下
                //  原 markdown 重命名为 index.md
                var newImagePath = path.join(
                  this.settings.hugoPath,
                  this.settings.contentPath,
                  title,
                  "images"
                );
              }

              // 添加到待拷贝列表
              imagesToCopy.push({
                originalPath: originalImagePath,
                newPath: newImagePath,
                newName: newName,
              });

              // 更新行内容，替换为Hugo中的路径
              const relativeNewPath = path
                .join(
                  this.settings.imageToStatic ? "/images" : "./images",
                  newName
                )
                .replace(/\\/g, "/");
              line.replace(
                match[0],
                match[0].replace(imagePath, relativeNewPath)
              );
            }
          }
        }
      }

      // 处理tags
      if (trimmedLine === "tags:") {
        tagSection = true;
        continue;
      }

      if (tagSection) {
        if (trimmedLine.startsWith("-")) {
          const tag = trimmedLine.slice(1).trim();
          if (tag && !symbolOnlyRegex.test(tag)) {
            tags.push(tag);
          }
        } else {
          tagSection = false;
        }
      } else if (!skipContent) {
        // New logic to handle standalone tags
        const standaloneTagsMatch = trimmedLine.match(/#[^\s#]+/g);
        if (standaloneTagsMatch) {
          standaloneTagsMatch.forEach((tag) => {
            const cleanTag = tag.slice(1); // Remove the '#'
            if (!symbolOnlyRegex.test(cleanTag) && !tags.includes(cleanTag)) {
              tags.push(cleanTag);
            }
          });
          // Remove the standalone tags from the line
          const cleanedLine = line.replace(/#[^\s#]+/g, "").trim();
          if (cleanedLine) {
            processedContent.push(cleanedLine);
          }
        } else {
          processedContent.push(line); // Keep original indentation
        }
      }
    }

    // 根据配置中 descriptionLines 的字段处理描述
    if (this.settings.descriptionLines > 0) {
      const descriptionLines = lines.slice(0, this.settings.descriptionLines);
      description = descriptionLines.join("").trim();
      // description = description.split
    }

    // 创建 Hugo 格式的前置元数据
    const hugoFrontMatter = `---
title: "${title}"
date: ${date}
draft: false
tags: [${tags.map((tag) => `"${tag}"`).join(", ")}]
${this.settings.descriptionLines > 0 ? "\ndescription: " + description : ""}
${this.settings.authorName ? "\nauthor: " + this.settings.authorName : ""}
${
  this.settings.useFirstImageAsCover && imagesToCopy.length > 0
    ? "\ncover: " + imagesToCopy[0].newPath
    : ""
}
---`;

    // 组合处理后的内容
    let cleanContent = processedContent.join("\n").trim();

    return {
      hugoContent: hugoFrontMatter + cleanContent,
      imageList: imagesToCopy,
    };
  }
}

class HugoSyncSettingTab extends PluginSettingTab {
  plugin: HugoSyncPlugin;

  constructor(app: App, plugin: HugoSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: this.plugin.lang.settings.pluginName });

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.hugoPath)
      .setDesc(this.plugin.lang.settings.hugoPathDesc)
      .addText((text) =>
        text
          .setPlaceholder("Enter path")
          .setValue(this.plugin.settings.hugoPath)
          .onChange(async (value) => {
            this.plugin.settings.hugoPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.contentPath)
      .setDesc(this.plugin.lang.settings.contentPathDesc)
      .addText((text) =>
        text
          .setPlaceholder("content/posts")
          .setValue(this.plugin.settings.contentPath)
          .onChange(async (value) => {
            this.plugin.settings.contentPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.filteredHeaders)
      .setDesc(this.plugin.lang.settings.filteredHeadersDesc)
      .addTextArea((text) =>
        text
          .setPlaceholder("Enter headers here\nOne per line")
          .setValue(this.plugin.settings.filteredHeaders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.filteredHeaders = value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Language")
      .setDesc("Select plugin language")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ en: "English", zh: "中文" })
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
            this.display(); // 重新加载设置页面以应用新语言
          })
      );
  }
}
