import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import useBaseUrl from "@docusaurus/useBaseUrl";
import Layout from "@theme/Layout";
import Heading from "@theme/Heading";

import styles from "./index.module.css";

const features = [
  {
    title: "Guided wizard",
    body: "One command starts an interactive setup that walks you through scope, name, description, and freshness. Flags and --yes are there when you want to script it.",
  },
  {
    title: "Progressive disclosure",
    body: "Every generated file stays within a token budget. A large reference splits into an index plus one file per section, so Claude loads only what a question needs.",
  },
  {
    title: "Pin-and-check refresh",
    body: "Local sources re-slice automatically. Remote sources pin to a commit and are checked cheaply, so updates surface without changing content behind your back.",
  },
  {
    title: "Safe by design",
    body: "Generated files carry an untrusted-content frame, an injection scan flags suspicious text, clones are hardened, and deletion never follows a symlink or touches a file it did not write.",
  },
];

function Hero(): ReactNode {
  const demoUrl = useBaseUrl("/img/das-demo.gif");
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Documentation as Skills</p>
          <Heading as="h1" className={styles.title}>
            Give Claude a map to your context.
          </Heading>
          <p className={styles.subtitle}>
            das turns any documentation into a Claude Code skill built on
            progressive disclosure, the same design skills use. Claude loads a
            short table of contents, then opens only the section a question
            needs, so it sees your whole context at a fraction of the token
            cost.
          </p>

          <div className={styles.install}>
            <span className={styles.installPrompt}>$</span>
            <code>npx @codewizwit/das-cli add &lt;github-url&gt;</code>
          </div>

          <div className={styles.ctas}>
            <Link className={styles.primaryCta} to="/docs/intro">
              Get started
            </Link>
            <Link
              className={styles.secondaryCta}
              href="https://github.com/codewizwit/das-cli"
            >
              View on GitHub
            </Link>
          </div>
        </div>

        <div className={styles.heroDemo}>
          <div className={styles.terminal}>
            <div className={styles.terminalBar}>
              <span className={styles.dotRed} />
              <span className={styles.dotYellow} />
              <span className={styles.dotGreen} />
              <span className={styles.terminalTitle}>das</span>
            </div>
            <img
              className={styles.terminalImg}
              src={demoUrl}
              alt="Running das add and answering the interactive wizard, then the sliced skill tree"
              loading="eager"
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function Features(): ReactNode {
  return (
    <section className={styles.features}>
      <div className={styles.featureGrid}>
        {features.map((feature) => (
          <div key={feature.title} className={styles.featureCard}>
            <span className={styles.featureBar} />
            <Heading as="h3" className={styles.featureTitle}>
              {feature.title}
            </Heading>
            <p className={styles.featureBody}>{feature.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Flow(): ReactNode {
  const steps = ["resolve", "slice", "render", "write"];
  return (
    <section className={styles.flow}>
      <p className={styles.flowLabel}>How it works</p>
      <div className={styles.flowSteps}>
        {steps.map((step, index) => (
          <div key={step} className={styles.flowStep}>
            <span className={styles.flowName}>{step}</span>
            {index < steps.length - 1 ? (
              <span className={styles.flowArrow}>&rarr;</span>
            ) : null}
          </div>
        ))}
      </div>
      <p className={styles.flowNote}>
        Pure functions do the parsing, slicing, and planning. A thin shell wraps
        the filesystem, git, and the wizard. See the{" "}
        <Link to="/docs/intro">docs</Link> for the full pipeline.
      </p>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="das: Documentation as Skills"
      description="Convert a GitHub URL, Markdown file, docs folder, or project root into a token-bounded, progressive-disclosure Claude Code skill."
    >
      <Hero />
      <main>
        <Features />
        <Flow />
      </main>
    </Layout>
  );
}
