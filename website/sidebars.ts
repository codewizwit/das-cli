import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    {
      type: "category",
      label: "Concepts",
      link: { type: "generated-index" },
      items: [
        "concepts/progressive-disclosure",
        "concepts/refresh-and-freshness",
        "concepts/das-json",
        "concepts/remote-vs-local",
      ],
    },
    {
      type: "category",
      label: "Command reference",
      link: { type: "doc", id: "commands/index" },
      items: [
        "commands/add",
        "commands/refresh",
        "commands/list",
        "commands/remove",
        "commands/doctor",
        "commands/hook-install",
      ],
    },
    {
      type: "category",
      label: "Guides",
      link: { type: "generated-index" },
      items: [
        "guides/add-a-remote-library",
        "guides/add-local-docs",
        "guides/hook-workflow",
        "guides/committed-team-skills",
      ],
    },
    "security",
    "architecture",
  ],
};

export default sidebars;
