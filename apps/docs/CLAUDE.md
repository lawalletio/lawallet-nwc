# apps/docs — Fumadocs documentation site

Fumadocs v16 + Next.js 16 + Tailwind CSS v4 (different Tailwind major than
apps/web — don't copy class patterns blindly between the two).

- Content: MDX files under `content/docs/<section>/` (architecture, deploy,
  guides, integrations, …)
- **Every new page must be registered in its section's `meta.json`** or it
  won't appear in the sidebar
- Source config: `source.config.ts`; MDX components: `mdx-components.tsx`
- Interactive code examples use Sandpack
- This site is public-facing: SEO and accessibility matter here (the `seo` and
  `accessibility` skills apply to this app and the landing page only)
- Long-form docs also exist at repo-root `docs/*.md`; when touching a topic
  covered in both, update both or note the drift
