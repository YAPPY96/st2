/** @jsxImportSource preact */
/// <reference types="systemjs" />

import { render } from 'preact/compat';
import { App } from "./study-plugin";
import type { BasePlugin } from 'blinko';
import plugin from './plugin.json';

System.register([], (exports) => ({
  execute: () => {
    exports('default', class Plugin implements BasePlugin {
      constructor() {
        Object.assign(this, plugin);
      }

      withSettingPanel = false;

      async init() {
        this.initI18n();

        window.Blinko.addToolBarIcon({
          name: "study-tracker2",
          icon: "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-book-open'><path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z'/><path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'/></svg>",
          placement: 'top',
          tooltip: 'Study Tracker 2',
          content: () => {
            const container = document.createElement('div');
            container.setAttribute('data-plugin', 'study-tracker2');
            render(<App />, container);
            return container;
          }
        });
      }

      initI18n() {
        const en = {
          todayProgress: "Today's Progress",
          loading: "Loading...",
          error: "Error:",
          baseUrl: "Base URL",
          noSubjects: "No subjects",
          success: "Success",
          failed: "Failed"
        };
        
        const ja = {
          todayProgress: "今日の進捗",
          loading: "読み込み中...",
          error: "エラー:",
          baseUrl: "ベースURL",
          noSubjects: "題材がありません",
          success: "成功",
          failed: "失敗"
        };

        window.Blinko.i18n.addResourceBundle('en', 'translation', en);
        window.Blinko.i18n.addResourceBundle('ja', 'translation', ja);
      }

      destroy() {
        console.log('Study Tracker 2 plugin destroyed');
      }
    });
  }
}));
