export interface LanguageStrings {
  settings: {
    pluginName: string;
    hugoPath: string;
    hugoPathDesc: string;
    contentPath: string;
    contentPathDesc: string;
    filteredHeaders: string;
    filteredHeadersDesc: string;
  };
  notices: {
    iconNotice: string;
    commandName: string;
    syncSuccess: string;
    syncError: string;
    noFilesSelected: string;
    syncResult: string;
    syncErrors: string;
  };
}

const en: LanguageStrings = {
  settings: {
    pluginName: "Hugo Sync Settings",
    hugoPath: "Hugo Path",
    hugoPathDesc: "Path to your Hugo project",
    contentPath: "Content Path",
    contentPathDesc: "Path to Hugo content directory (relative to Hugo Path)",
    filteredHeaders: "Filtered Headers",
    filteredHeadersDesc:
      "Enter headers to be filtered from Hugo content (one per line)",
  },
  notices: {
    iconNotice: "Sync to Hugo",
    commandName: "Sync selected file(s) to Hugo ",
    syncSuccess: "Synced {0} file(s) to Hugo",
    syncError: "Error syncing to Hugo: {0}",
    noFilesSelected: "No files selected for syncing",
    syncResult: "Sync complete. Total: {0}, Success: {1}, Failed: {2}",
    syncErrors: "Errors occurred during sync",
  },
};

const zh: LanguageStrings = {
  settings: {
    pluginName: "Hugo 同步设置",
    hugoPath: "Hugo 路径",
    hugoPathDesc: "Hugo 项目的路径",
    contentPath: "内容路径",
    contentPathDesc: "Hugo 内容目录的路径（相对于 Hugo 路径）",
    filteredHeaders: "过滤的标题",
    filteredHeadersDesc: "输入要从 Hugo 内容中过滤的标题（每行一个）",
  },
  notices: {
    iconNotice: "同步到 Hugo",
    commandName: "将选中的文件同步到 Hugo",
    syncSuccess: "已同步 {0} 个文件到 Hugo",
    syncError: "同步到 Hugo 时出错：{0}",
    noFilesSelected: "没有选择要同步的文件",
    syncResult: "同步完成。总计: {0}, 成功: {1}, 失败: {2}",
    syncErrors: "同步过程中发生错误",
  },
};

export const languages: Record<string, LanguageStrings> = { en, zh };
