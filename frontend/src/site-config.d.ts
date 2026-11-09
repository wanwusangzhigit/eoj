export interface SiteConfig {
  site: {
    name: string;
    short_name: string;
    description: string;
    icon: string;
    favicon: string;
    // 'notebook' 复用 default 的组件样式（按钮/卡片/表单），仅在调色板、字体、Hero 处理上做差异化覆盖。
    // 运行时会同时设置 data-theme-style="default" + data-theme-flavor="notebook"，
    // 让所有 [data-theme-style="default"] 选择器自动命中，再用 [data-theme-flavor="notebook"] 微调。
    theme: 'default' | 'classic' | 'flat' | 'aurora' | 'notebook';
  };
  footer: {
    enabled: boolean;
    text: string;
    links: Array<{ name: string; url: string }>;
  };
  login: {
    hero_title: string;
    hero_subtitle: string;
    show_github: boolean;
    show_cpoauth: boolean;
  };
  home: {
    title: string;
  };
  contact: {
    email: string;
  };
  editor: {
    default_language: string;
  };
}
