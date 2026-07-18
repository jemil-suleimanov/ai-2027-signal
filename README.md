# AI 2027 Signal

An independent, evidence-led tracker comparing the **AI 2027** scenario with observed AI progress.

## Editorial model

Every weekly update is a Markdown file in `content/updates/`. Frontmatter contains the machine-readable verdict; the body contains the short editorial explanation. The website never presents the score as a scientific probability: it is an auditable editorial synthesis of cited evidence.

### Add an update

Copy `content/updates/_template.md`, name it `YYYY-MM-DD.md`, fill every field, then run:

```bash
npm run check
npm run build
```

Commit to `main`. GitHub Actions validates, builds, and deploys the site to GitHub Pages.

## Score rubric

- `0–24`: materially behind the scenario
- `25–44`: behind
- `45–59`: mixed / broadly near
- `60–74`: ahead
- `75–100`: materially ahead

Track scores use the same scale. Each claim needs a primary source where possible; secondary reporting is allowed only when the primary artifact is unavailable.

## Local development

```bash
npm run dev
```

No runtime framework or external client dependency is used. The build script turns Markdown frontmatter into static JSON; GitHub Pages serves the result.

## Independence

This project is not affiliated with the AI Futures Project or the authors of AI 2027. It summarizes and critiques a public scenario; it does not reproduce the original article.
