# Site Content CMS

Editable landing-page content (hero, features, FAQ, footer, legal drawer, course showcase).

**Backend:** `siteContent.routes.js`
**Frontend:** `components/SiteContentSection.tsx`, `Hero.tsx`, `Features.tsx`, `Faq.tsx`, `Footer.tsx`,
`Header.tsx`, `CourseShowcase.tsx`, `LegalDrawer.tsx`, `defaultSiteContent.ts`, `pages/LandingPage.tsx`

## Depends on
- `shared/backend-core`: `db.js`
- `shared/frontend-core`: `types/index.ts`, `apiClient.ts`

## Mount
`app.use("/api/site-content", require("./features/site-content-cms/backend/siteContent.routes"))`
