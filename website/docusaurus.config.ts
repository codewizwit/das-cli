import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "das",
  tagline: "Documentation as a Skill",
  favicon: "img/favicon.ico",

  future: {
    v4: true,
  },

  url: "https://codewizwit.github.io",
  baseUrl: "/das-cli/",

  organizationName: "codewizwit",
  projectName: "das-cli",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  themes: ["@docusaurus/theme-mermaid"],

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/codewizwit/das-cli/tree/main/website/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "das",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://www.npmjs.com/package/@codewizwit/das-cli",
          label: "npm",
          position: "right",
        },
        {
          href: "https://github.com/codewizwit/das-cli",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Getting started", to: "/docs/intro" },
            { label: "Command reference", to: "/docs/commands" },
            { label: "Architecture", to: "/docs/architecture" },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/codewizwit/das-cli",
            },
            {
              label: "npm",
              href: "https://www.npmjs.com/package/@codewizwit/das-cli",
            },
            {
              label: "Issues",
              href: "https://github.com/codewizwit/das-cli/issues",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} das-cli. MIT licensed.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    mermaid: {
      theme: { light: "neutral", dark: "dark" },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
