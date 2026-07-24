import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";
import CodeBlock from "@theme/CodeBlock";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">
          Convert documentation into a token-bounded, progressive-disclosure
          Claude Code skill.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro"
          >
            Getting started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/commands"
          >
            Command reference
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="das: Documentation as a Skill"
      description="Convert a GitHub URL, Markdown file, docs folder, or project root into a token-bounded, progressive-disclosure Claude Code skill."
    >
      <HomepageHeader />
      <main className={styles.main}>
        <div className="container">
          <div className="row">
            <div className="col col--6">
              <Heading as="h2">One command</Heading>
              <CodeBlock language="bash">
                das add https://github.com/prisma/docs
              </CodeBlock>
              <p>
                Claude Code loads a short <code>SKILL.md</code> table of
                contents every session, and opens a resource file only when a
                question needs that section. See{" "}
                <Link to="/docs/concepts/progressive-disclosure">
                  progressive disclosure
                </Link>{" "}
                for a real generated example.
              </p>
            </div>
            <div className="col col--6">
              <Heading as="h2">Generated tree</Heading>
              <CodeBlock language="text">
                {`widget-sdk/
  SKILL.md          (table of contents)
  das.json          (ownership record)
  resources/
    api-reference.md
    getting-started.md
    guide-1.md`}
              </CodeBlock>
              <p>
                Every skill carries an untrusted-content frame and stays current
                through{" "}
                <Link to="/docs/concepts/refresh-and-freshness">
                  pin-and-check refresh
                </Link>
                . See the <Link to="/docs/security">security model</Link> for
                the full threat model.
              </p>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
