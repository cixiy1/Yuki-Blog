# Repository Guidelines

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this repository. This is the only agent-instructions file; the former `CLAUDE.md` has been folded into it, so do not add a separate `CLAUDE.md`.

## Project Overview

This repository is 雪穗博客 (yiyu14.top), a personal blog running the Firefly theme — Astro 7 with Svelte 5 islands, Tailwind CSS 4, TypeScript 6, and Biome for formatting and linting. Content lives in `src/content/posts/`; all site behaviour is configured through TypeScript modules in `src/config/`. Pushing to `main` deploys the site through Cloudflare Pages.

## Project Structure & Module Organization

Main source code lives in `src/`: routes in `src/pages`, layouts in `src/layouts`, reusable UI in `src/components`, styles in `src/styles`, content in `src/content`, helpers in `src/utils`, and Markdown/HTML plugins in `src/plugins`. Site configuration is split across `src/config` with matching type definitions in `src/types`; prefer imports from `@/config` when available. Static files served directly belong in `public`, source-managed images in `src/assets`, and automation in `scripts`. The local CMS app lives in `cms/`.

## Build, Test, and Development Commands

Use `pnpm`; the `preinstall` script enforces it. Node.js >= 22 is required.

- `pnpm dev` or `pnpm start`: run the local Astro dev server at `localhost:4321`.
- `pnpm check`: run Astro diagnostics.
- `pnpm type-check`: run TypeScript with `--noEmit --isolatedDeclarations` over `src/` and `scripts/`.
- `pnpm format`: format `src` and `scripts` with Biome.
- `pnpm lint`: run Biome checks with safe fixes on `src` and `scripts`.
- `pnpm build`: generate GitHub card data, LQIPs, VNDB covers, the Astro build, pruned pio assets, font subsets, minified inline scripts, and the Pagefind index.
- `pnpm preview`: preview the production build locally.
- `pnpm new-post <filename>`: scaffold a new post.
- `pnpm new-dynamic` (alias `pnpm new-d`): scaffold a new microblog entry.
- `pnpm lqips`: regenerate LQIP data into `src/constants/lqips.json`.

## Architecture

### Astro + Svelte Hybrid

- `.astro` components for static content and layouts
- `.svelte` components for interactive UI (search, settings, pagination, archive), mounted with `client:load` or `client:visible`
- Swup.js handles SPA-like page transitions with multiple container targets

### Configuration-Driven

All features are toggled through TypeScript files in `src/config/`, exported via the barrel at `src/config/index.ts`. Key modules: `siteConfig.ts` (site settings, theme, pagination), `sidebarConfig.ts` (layout and widget order), `backgroundWallpaper.ts`, `musicConfig.ts`, `profileConfig.ts`, `navBarConfig.ts`, `friendsConfig.ts`, `commentConfig.ts`, `analyticsConfig.ts`, `fontConfig.ts`, `provenanceConfig.ts` (text provenance labels shown next to post meta).

### Layout System

- `Layout.astro` — base HTML shell (head, body, theme init, analytics, Swup hooks)
- `MainGridLayout.astro` — page grid with sidebar(s), navbar, wallpaper, footer

### Scroll Performance Constraints

Scroll-linked work in `src/utils/` is rAF-throttled and must stay cheap on mobile — do not regress these:

- `fullscreen-wallpaper-utils.ts` — fullscreen title fade and blur ramp. The blur value `--fullscreen-blur` is quantized to 2px steps and the max blur (`--overlay-blur`) is cached; avoid per-frame `getComputedStyle` or continuous full-screen `filter: blur()` writes, since each change re-rasterizes the viewport on mobile.
- `grid-layout-utils.ts` — `updateSidebarStickySpacing()` runs on every scroll and must not read layout (`offsetHeight` etc.). The sidebar top-container visibility is cached by `refreshSidebarStickyState()`, which only runs on init and navigation.
- The fullscreen blur ramp can be disabled per device via `backgroundWallpaper.fullscreen.blurRamp.enable.{desktop,mobile}`.

### Content Collections

Defined in `src/content.config.ts`:

- `posts` — blog posts (`.md`/`.mdx`) with frontmatter: title, published, tags, category, draft, pinned, password, comment, series, provenance, and so on.
- `dynamic` — microblog entries with `published`, `pinned`, `location`, `provenance`.
- `projects` — project showcase data with `title`, `published`, `order`, `description`, `image`, `tags`, `link`, `status`.
- `spec` — special pages (about, guestbook).

### Key Directories

- `src/components/` — grouped by domain: `analytics/`, `comment/`, `common/`, `controls/`, `features/`, `layout/`, `misc/`, `pages/`, `widget/`
- `src/plugins/` — custom remark/rehype plugins (Mermaid, PlantUML, KaTeX, GitHub cards, reading time, wiki links, etc.)
- `src/i18n/` — keys in `i18nKey.ts`, language files in `languages/*.ts`, lookup via `translation.ts`
- `src/utils/` — content sorting, crypto for encrypted posts, date formatting, image processing/LQIP, TOC generation
- `scripts/` — build-time utilities (`generate-lqips.ts`, `generate-vndb-covers.ts`, `subset-fonts.ts`, `new-post.js`, `new-dynamic.js`)

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`

## Build Pipeline

Multi-step: `generate-github-card-data.ts` → `generate-lqips.ts` → `generate-vndb-covers.ts` → `astro build` → `prune-pio-assets.ts` → `subset-fonts.ts` → `minify-inline-scripts.ts` → Pagefind.

LQIP data is generated into `src/constants/lqips.json` and committed — regenerate with `pnpm lqips`. `generate-vndb-covers.ts` downloads VNDB cover art into `public/vndb-covers/` (gitignored) and no-ops unless `siteConfig.vndb` has a `userId`, `downloadCovers: true`, and `mode: "static"`. `prune-pio-assets.ts` deletes unused 看板娘 assets from `dist/` after the build (Live2D, Spine, or all of `dist/pio` depending on which widgets are disabled).

## Coding Style & Naming Conventions

Biome is the formatter and linter: tabs for indentation, double quotes for JavaScript/TypeScript strings. Keep Astro and Svelte components in `PascalCase` (`PostCard.astro`, `Search.svelte`), config modules in `camelCase` ending with `Config.ts`, and utilities in descriptive kebab case such as `date-utils.ts`. Keep `src/types` aligned with `src/config`. Avoid unrelated formatting churn.

## Testing Guidelines

There is no dedicated unit-test framework configured. Before submitting changes, run `pnpm check`, `pnpm type-check`, and `pnpm build` for rendering, content, or generated asset work. For visual or interactive changes, verify with `pnpm dev` or `pnpm preview` and include screenshots in the PR.

## Commit & Pull Request Guidelines

Use Conventional Commits, matching the current history: `feat: ...`, `fix: ...`, and `chore: ...`. Keep commits and PRs focused on one concern. PRs should include a concise summary, linked issues when relevant, validation commands run, and screenshots for UI changes.

## Security & Configuration Tips

Do not commit secrets, tokens, or service keys in config files. Keep deployment-specific settings in the target platform environment, and review generated files such as `dist`, `src/constants/lqips.json`, and `src/constants/icons.ts` before committing them.

## Deployment

Pushing to `main` builds and deploys through Cloudflare Pages, roughly one minute. `vercel.json` and `wrangler.jsonc` are the theme's alternative deployment configs and are currently unused. Static output goes to `dist/`.
