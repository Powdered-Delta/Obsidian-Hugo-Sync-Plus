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
  imageToStatic: false,
  staticPath: "static",
  filteredHeaders: [],
  language: "en",
  descriptionLines: 0,
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
      file.name,
      file.path
    );

    const hugoFilePath = (() => {
      if (this.settings.imageToStatic) {
        return path.join(
          this.settings.hugoPath,
          this.settings.contentPath,
          file.name
        );
      } else {
        // 为否的情况下还需要额外创建目录
        const dir = path.join(
          this.settings.hugoPath,
          this.settings.contentPath,
          file.name.replace(".md", "")
        );
        fs.mkdirSync(dir, { recursive: true });

        return path.join(dir, "index.md");
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
      // 检查目标文件是否已存在，如果存在则跳过
      if (fs.existsSync(image.newPath)) {
        console.log(`File ${image.newPath} already exists, skipping...`);
        continue;
      }
      // 确保目标目录存在
      const targetDir = path.dirname(image.newPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      // 复制文件
      fs.copyFileSync(image.originalPath, image.newPath);
    }
  }

  convertToHugoFormat(
    content: string,
    fileName: string,
    filePath: string
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
      const processImageLink = (
        imagePath: string,
        line: string,
        matchText: string,
        isObsidianImage: boolean
      ) => {
        // 检查图片是否为本地文件（不处理网络图片）
        // https://docs.obsidian.md/Reference/TypeScript+API/Vault

        // 当链接类型为 obsidian 图片时，特殊处理：
        // 参考 https://forum.obsidian.md/t/how-to-get-full-paths-from-link-text/75146/4
        //  getFirstLinkpathDest: this.app.metadataCache.getFirstLinkpathDest(
        //     imagePath,
        //     filePath
        //   )?.path,
        //
        // 可以正确获取到 图片的相对路径 Programming/attachments/test.png
        let originalImagePath: string;
        if (!imagePath.startsWith("http")) {
          // 构建完整的原始图片路径
          const activeFilePath = this.app.workspace.getActiveFile()?.path || "";
          // 处理不同类型的路径, 会有三种情况
          if (isObsidianImage) {
            // 是 Obsidian 图片链接格式，通过 getFirstLinkpathDest 获取目标路径
            // 获取图片的相对路径
            const imageRelativePath =
              this.app.metadataCache.getFirstLinkpathDest(
                imagePath,
                activeFilePath
              )?.path;
            if (imageRelativePath) {
              originalImagePath = path.join(
                this.app.vault.adapter.getBasePath(),
                imageRelativePath
              );
            }
          } else if (path.isAbsolute(imagePath)) {
            // 绝对路径（从 vault 根目录开始）
            originalImagePath = path.join(
              this.app.vault.adapter.getBasePath(),
              imagePath
            );
          } else {
            // 相对路径（相对于当前文件）
            const currentDir = path.dirname(activeFilePath);
            originalImagePath = path.join(
              this.app.vault.adapter.getBasePath(),
              currentDir,
              imagePath
            );
          }
          // 检查图片文件是否存在
          if (fs.existsSync(originalImagePath)) {
            // 生成新的图片文件名（使用原文件名+时间戳避免冲突）
            const ext = path.extname(imagePath);
            const basename = path.basename(imagePath, ext);
            // const newName = `${basename}_${Date.now()}${ext}`;
            const newName = `${basename}${ext}`;

            // 构建目标路径
            let newImagePath: string;
            if (this.settings.imageToStatic) {
              newImagePath = path.join(
                this.settings.hugoPath,
                this.settings.staticPath,
                "images",
                newName
              );
            } else {
              // 和md源文件放到同一目录下(markdown
              //  原名作为文件夹名字，图片放到同目录 images 目录下
              //  原 markdown 重命名为 index.md
              newImagePath = path.join(
                this.settings.hugoPath,
                this.settings.contentPath,
                title,
                "images",
                newName
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
              .replace(/\\/g, "/")
              .split("/")
              .map((part) => encodeURIComponent(part))
              .join("/");

            // 判断原始语法类型并转换为标准Markdown语法
            let newImageSyntax: string;
            if (matchText.includes("![[")) {
              // Obsidian语法 ![[image.png]] 转换为标准Markdown语法 ![image.png](/images/new_name.png)
              const imageName = path.basename(imagePath);
              newImageSyntax = `![${imageName}](${relativeNewPath})`;
            } else {
              // 原本就是标准Markdown语法，只需替换路径
              newImageSyntax = matchText.replace(imagePath, relativeNewPath);
            }
            // 实际替换行中的图片语法
            var newLine = line.replace(matchText, newImageSyntax);

            // 更新处理后的内容数组
            processedContent.push(newLine);
          }
        }
      };

      if (!skipContent) {
        let lineProcessed = false;

        // 处理标准 Markdown 语法: ![alt](path)
        const markdownImageRegex =
          /!\[.*?\]\((.*?\.(?:png|jpg|jpeg|gif|webp|svg))(?:\s+["'].*?["'])?\)/gi;
        let match;
        while ((match = markdownImageRegex.exec(line)) !== null) {
          const imagePath = match[1];
          processImageLink(imagePath, line, match[0]);
          lineProcessed = true;
        }

        // 处理 Obsidian 语法: ![[path]]
        const obsidianImageRegex =
          /!\[\[(.*?\.(?:png|jpg|jpeg|gif|webp|svg))\]\]/gi;
        while ((match = obsidianImageRegex.exec(line)) !== null) {
          const imagePath = match[1];
          processImageLink(imagePath, line, match[0], true);
          lineProcessed = true;
        }

        // 如果当前行已经处理过图片链接，则跳过其他处理
        if (lineProcessed) {
          continue;
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
---

`;

    // 组合处理后的内容
    let cleanContent = processedContent.join("\n");
    // 只移除最开始和最后的空白行，保留段落间的空行
    cleanContent = cleanContent.replace(/^\n+|\n+$/g, "");

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

    // 添加 imageToStatic 配置项
    new Setting(containerEl)
      .setName("Image Handling Mode")
      .setDesc(
        "Enable to store images in static folder, disable to store with markdown file"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.imageToStatic)
          .onChange(async (value) => {
            this.plugin.settings.imageToStatic = value;
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

    // 添加 descriptionLines 配置项
    new Setting(containerEl)
      .setName("Description Lines")
      .setDesc("Number of lines to use as description (0 to disable)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.descriptionLines)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.descriptionLines = value;
            await this.plugin.saveSettings();
          })
      );

    // 添加 descriptionMaxLength 配置项
    new Setting(containerEl)
      .setName("Description Max Length")
      .setDesc("Maximum length of description text")
      .addSlider((slider) =>
        slider
          .setLimits(50, 500, 10)
          .setValue(this.plugin.settings.descriptionMaxLength)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.descriptionMaxLength = value;
            await this.plugin.saveSettings();
          })
      );

    // 添加 useFirstImageAsCover 配置项
    new Setting(containerEl)
      .setName("Use First Image as Cover")
      .setDesc("Use the first image in the post as the cover image")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useFirstImageAsCover)
          .onChange(async (value) => {
            this.plugin.settings.useFirstImageAsCover = value;
            await this.plugin.saveSettings();
          })
      );

    // 添加 authorName 配置项
    new Setting(containerEl)
      .setName("Author Name")
      .setDesc("Default author name for posts")
      .addText((text) =>
        text
          .setPlaceholder("Author name")
          .setValue(this.plugin.settings.authorName)
          .onChange(async (value) => {
            this.plugin.settings.authorName = value;
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
