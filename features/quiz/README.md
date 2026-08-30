# Quiz

Quiz builder, DOCX import, student attempts, server-side grading, admin results view.

**Backend:** `quizzes.routes.js`, `quizValidation.lib.js`, `docxQuizParser.lib.js`, `docxZip.lib.js`
**Frontend:** `components/QuizBuilder.tsx`, `QuizFormModal.tsx`, `QuizQuestionFormModal.tsx`,
`QuizImportModal.tsx`, `QuizzesSection.tsx`, `QuizCard.tsx`, `QuizTakeModal.tsx`,
`QuizAttemptDetail.tsx`, `QuizResultsView.tsx`

## Depends on
- `shared/backend-core`: `db.js`
- `shared/frontend-core`: `types/index.ts`, `apiClient.ts`, `components/modals`, `components/forms`

## DB migrations
`20260829090000_add_quiz_system.sql`

## Mount
`app.use("/api/quizzes", require("./features/quiz/backend/quizzes.routes"))`
