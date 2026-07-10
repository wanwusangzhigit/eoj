export interface SiteConfig {
  site: {
    name: string;
    short_name: string;
    description: string;
    icon: string;
    favicon: string;
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
}
