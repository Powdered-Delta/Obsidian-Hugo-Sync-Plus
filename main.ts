import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, TAbstractFile } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import { languages, LanguageStrings } from './lang';

interface HugoSyncSettings {
  hugoPath: string;
  contentPath: string;
  filteredHeaders: string[];
  language: string;
}

const DEFAULT_SETTINGS: HugoSyncSettings = {
  hugoPath: '',
  contentPath: 'content/posts',
  filteredHeaders: [],
  language: 'en'
}

export default class HugoSyncPlugin extends Plugin {
  settings: HugoSyncSettings;
  lang: LanguageStrings;

  async onload() {
    console.log('Loading HugoSyncPlugin');
    await this.loadSettings();
    this.lang = languages[this.settings.language] || languages.en;

    try {
      // Change the icon to 'refresh-cw'
      this.addRibbonIcon('refresh-cw', 'Sync to Hugo', (evt: MouseEvent) => {
        this.syncSelectedToHugo();
      });
    } catch (error) {
      console.error('Failed to add ribbon icon:', error);
    }

    this.addCommand({
      id: 'sync-selected-to-hugo',
      name: 'Sync selected file(s) to Hugo',
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

    console.log('Syncing selected files to Hugo...');
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
      .replace('{0}', selectedFiles.length.toString())
      .replace('{1}', successCount.toString())
      .replace('{2}', failCount.toString());

    if (failCount > 0) {
      resultMessage += '\n\n' + this.lang.notices.syncErrors + ':\n' + errorMessages.join('\n');
    }

    // 显示结果通知
    new Notice(resultMessage, 10000);  // 显示10秒

    // 如果有错误，在控制台输出详细信息
    if (failCount > 0) {
      console.error('Sync errors:', errorMessages);
    }
  }

  getSelectedFiles(): TFile[] {
    const selectedFiles: TFile[] = [];
    
    // 获取文浏览器中选中的文件
    const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
    if (fileExplorer && fileExplorer.view) {
      // @ts-ignore
      const selectedItems = fileExplorer.view.fileItems;
      if (selectedItems) {
        for (const item of Object.values(selectedItems)) {
          // @ts-ignore
          if (item && item.file instanceof TFile && item.titleEl && item.titleEl.classList && item.titleEl.classList.contains('is-selected')) {
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
    console.log('Starting to sync file:', file.name);
    const content = await this.app.vault.read(file);
    console.log('Original content:', content);
    console.log('Content type:', typeof content);
    console.log('Content length:', content.length);
    
    const hugoContent = this.convertToHugoFormat(content, file.name);
    console.log('Converted content:', hugoContent);
    
    const hugoFilePath = path.join(this.settings.hugoPath, this.settings.contentPath, file.name);
    fs.writeFileSync(hugoFilePath, hugoContent);
    console.log(`Synced file: ${file.name}`);
  }

  convertToHugoFormat(content: string, fileName: string): string {
    console.log('Converting to Hugo format:', fileName);
    const title = fileName.replace('.md', '');
    const date = new Date().toISOString();
  
    // 提取标签
    const tags: string[] = [];
  
    // 处理 Obsidian 的标签格式
    const lines = content.split('\n');
    let tagSection = false;
    let processedContent = [];
    let currentHeaderLevel = 0;
    let skipContent = false;
  
    // 用于检查标签是否为纯符号的正则表达式
    const symbolOnlyRegex = /^[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]+$/;
  
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
    
      if (trimmedLine.startsWith('#')) {
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
            console.log(`Filtering header: ${headerContent}`);
            continue;
          }
          
          currentHeaderLevel = headerLevel;
        }
      }
    
      if (trimmedLine === 'tags:') {
        tagSection = true;
        continue;
      }
    
      if (tagSection) {
        if (trimmedLine.startsWith('-')) {
          const tag = trimmedLine.slice(1).trim();
          if (tag && !symbolOnlyRegex.test(tag)) {
            tags.push(tag);
          }
        } else {
          tagSection = false;
        }
      } else if (!skipContent) {
        processedContent.push(line); // 保留原始的缩进
      }
    }

    console.log('Extracted tags:', tags);

    // 创建 Hugo 格式的前置元数据
    const hugoFrontMatter = `---
title: "${title}"
date: ${date}
draft: false
tags: [${tags.map(tag => `"${tag}"`).join(', ')}]
---

`;

    // 组合处理后的内容
    let cleanContent = processedContent.join('\n').trim();

    console.log('Hugo front matter:', hugoFrontMatter);
    console.log('Clean content:', cleanContent);

    return hugoFrontMatter + cleanContent;
  }
}

class HugoSyncSettingTab extends PluginSettingTab {
  plugin: HugoSyncPlugin;

  constructor(app: App, plugin: HugoSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();
    containerEl.createEl('h2', {text: this.plugin.lang.settings.pluginName});

    new Setting(containerEl)
      .setName(this.plugin.lang.settings.hugoPath)
      .setDesc(this.plugin.lang.settings.hugoPathDesc)
      .addText(text => text
        .setPlaceholder('Enter path')
        .setValue(this.plugin.settings.hugoPath)
        .onChange(async (value) => {
          this.plugin.settings.hugoPath = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName(this.plugin.lang.settings.contentPath)
      .setDesc(this.plugin.lang.settings.contentPathDesc)
      .addText(text => text
        .setPlaceholder('content/posts')
        .setValue(this.plugin.settings.contentPath)
        .onChange(async (value) => {
          this.plugin.settings.contentPath = value;
          await this.plugin.saveSettings();
        }));
    
    new Setting(containerEl)
      .setName(this.plugin.lang.settings.filteredHeaders)
      .setDesc(this.plugin.lang.settings.filteredHeadersDesc)
      .addTextArea(text => text
        .setPlaceholder('Enter headers here\nOne per line')
        .setValue(this.plugin.settings.filteredHeaders.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.filteredHeaders = value.split('\n').map(s => s.trim()).filter(s => s);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Language')
      .setDesc('Select plugin language')
      .addDropdown(dropdown => dropdown
        .addOptions({ 'en': 'English', 'zh': '中文' })
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value;
          await this.plugin.saveSettings();
          this.display(); // 重新加载设置页面以应用新语言
        }));
  }
}