const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { supabase, row, rows, toSnake, assertNoError } = require("../../../shared/backend-core/db");
const { authenticate, requireAdmin } = require("../../auth/backend/auth.middleware");
const { getAccessibleCourseIds, userCanAccessCourse } = require("../../plans-subscription/backend/accessService");
const { logAction } = require("../../audit/backend/auditService");
const { containsPattern } = require("../../../shared/backend-core/searchFilter");
const { validateQuestionFields, canPublishQuiz } = require("./quizValidation.lib");
const { parseQuizFromDocxBuffer } = require("./docxQuizParser.lib");

const router = express.Router();

// Columns safe to hand to a STUDENT before they've submitted an
// attempt — never includes correct_option or explanation (spec #8:
// "Do not expose the correct answers to students through the frontend
// before submission"). Admin-facing routes select "*" instead.
const STUDENT_SAFE_QUESTION_COLUMNS = "id, quiz_id, question_text, option_a, option_b, option_c, option_d, order_index";

// ---------------------------------------------------------------------
// DOCX import upload — small files, kept entirely in memory and never
// written to Storage or disk: the parsed *questions* are what matters,
// not the original file, and nothing is persisted until "Confirm &
// Import" (spec #2/#3: "Do not immediately save imported questions").
// A dedicated, tight multer instance (separate from upload.routes.js,
// which is tuned for large video/PDF/image files streamed to disk).
// ---------------------------------------------------------------------
const MAX_DOCX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB — generous for a text-only Word doc
const docxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCX_SIZE_BYTES, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.docx$/i.test(file.originalname || "");
    const okMime =
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.mimetype === "application/octet-stream"; // some browsers/OSes send a generic type for .docx
    if (!okExt || !okMime) {
      return cb(new Error("Only .docx files are supported for quiz import."));
    }
    cb(null, true);
  },
});

// =====================================================================
// Admin — quiz CRUD
// =====================================================================

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status, courseId, search } = req.query;
    let q = supabase.from("quizzes").select("*");
    if (status) q = q.eq("status", status);
    if (courseId) q = q.eq("course_id", courseId);
    if (search) q = q.ilike("title", containsPattern(search));
    q = q.order("created_at", { ascending: false });

    const { data, error } = await q;
    assertNoError(error, "Failed to load quizzes");
    const quizzes = rows(data);

    const uniqueCourseIds = [...new Set(quizzes.map((q2) => q2.courseId))];
    let coursesById = new Map();
    if (uniqueCourseIds.length > 0) {
      const { data: coursesData, error: coursesErr } = await supabase.from("courses").select("id, title").in("id", uniqueCourseIds);
      assertNoError(coursesErr, "Failed to load courses");
      coursesById = new Map(rows(coursesData).map((c) => [c.id, c]));
    }

    const quizIds = quizzes.map((q2) => q2.id);
    const countByQuiz = new Map();
    if (quizIds.length > 0) {
      const { data: questionRows, error: qErr } = await supabase.from("quiz_questions").select("quiz_id").in("quiz_id", quizIds);
      assertNoError(qErr, "Failed to count quiz questions");
      for (const r of questionRows || []) countByQuiz.set(r.quiz_id, (countByQuiz.get(r.quiz_id) || 0) + 1);
    }

    const shaped = quizzes.map((quiz) => ({
      ...quiz,
      course: coursesById.get(quiz.courseId) || null,
      questionCount: countByQuiz.get(quiz.id) || 0,
    }));

    res.json({ quizzes: shaped });
  } catch (err) {
    next(err);
  }
});

router.get("/admin/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: quizData, error: quizError } = await supabase.from("quizzes").select("*").eq("id", req.params.id).maybeSingle();
    assertNoError(quizError, "Failed to load quiz");
    if (!quizData) return res.status(404).json({ error: "Quiz not found." });
    const quiz = row(quizData);

    const { data: courseData } = await supabase.from("courses").select("id, title").eq("id", quiz.courseId).maybeSingle();
    const { data: questionsData, error: questionsError } = await supabase
      .from("quiz_questions")
      .select("*")
      .eq("quiz_id", quiz.id)
      .order("order_index", { ascending: true });
    assertNoError(questionsError, "Failed to load quiz questions");

    res.json({ quiz: { ...quiz, course: row(courseData) || null }, questions: rows(questionsData) });
  } catch (err) {
    next(err);
  }
});

const createQuizSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  passPercent: z.number().int().min(0).max(100).optional(),
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = createQuizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data: course, error: courseError } = await supabase.from("courses").select("id").eq("id", parsed.data.courseId).maybeSingle();
    assertNoError(courseError, "Failed to load course");
    if (!course) return res.status(400).json({ error: "Course not found." });

    const { data: created, error } = await supabase
      .from("quizzes")
      .insert(
        toSnake({
          courseId: parsed.data.courseId,
          title: parsed.data.title,
          description: parsed.data.description || "",
          passPercent: parsed.data.passPercent ?? 70,
          status: "DRAFT",
          createdById: req.user.id,
        })
      )
      .select("*")
      .single();
    assertNoError(error, "Failed to create quiz");

    await logAction({ actorId: req.user.id, action: "quiz.create", entityType: "Quiz", entityId: created.id });
    res.status(201).json({ quiz: row(created) });
  } catch (err) {
    next(err);
  }
});

const updateQuizSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  passPercent: z.number().int().min(0).max(100).optional(),
  courseId: z.string().min(1).optional(),
});

router.patch("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = updateQuizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data: existing } = await supabase.from("quizzes").select("id").eq("id", req.params.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: "Quiz not found." });

    if (parsed.data.courseId) {
      const { data: course } = await supabase.from("courses").select("id").eq("id", parsed.data.courseId).maybeSingle();
      if (!course) return res.status(400).json({ error: "Course not found." });
    }

    const { data: updated, error } = await supabase
      .from("quizzes")
      .update(toSnake({ ...parsed.data, updatedAt: new Date() }))
      .eq("id", req.params.id)
      .select("*")
      .single();
    assertNoError(error, "Failed to update quiz");

    await logAction({ actorId: req.user.id, action: "quiz.update", entityType: "Quiz", entityId: req.params.id, metadata: parsed.data });
    res.json({ quiz: row(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Cascades to quiz_questions/quiz_attempts/quiz_answers via FK
    // "on delete cascade" (see supabase schema) — deleting a quiz also
    // permanently deletes every student's attempt history for it,
    // mirroring how course deletion cascades to its content.
    const { error, count } = await supabase.from("quizzes").delete({ count: "exact" }).eq("id", req.params.id);
    assertNoError(error, "Failed to delete quiz");
    if (!count) return res.status(404).json({ error: "Quiz not found." });

    await logAction({ actorId: req.user.id, action: "quiz.delete", entityType: "Quiz", entityId: req.params.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/:id/publish", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: quiz } = await supabase.from("quizzes").select("*").eq("id", req.params.id).maybeSingle();
    if (!quiz) return res.status(404).json({ error: "Quiz not found." });

    const { data: questionsData, error: questionsError } = await supabase.from("quiz_questions").select("*").eq("quiz_id", req.params.id);
    assertNoError(questionsError, "Failed to load quiz questions");
    const questions = rows(questionsData).map((q) => ({
      questionText: q.questionText,
      optionA: q.optionA,
      optionB: q.optionB,
      optionC: q.optionC,
      optionD: q.optionD,
      correctOption: q.correctOption,
    }));

    const check = canPublishQuiz(questions);
    if (!check.ok) return res.status(400).json({ error: check.reason });

    const { data: updated, error } = await supabase
      .from("quizzes")
      .update(toSnake({ status: "PUBLISHED", updatedAt: new Date() }))
      .eq("id", req.params.id)
      .select("*")
      .single();
    assertNoError(error, "Failed to publish quiz");

    await logAction({ actorId: req.user.id, action: "quiz.publish", entityType: "Quiz", entityId: req.params.id });
    res.json({ quiz: row(updated) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/unpublish", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: updated, error } = await supabase
      .from("quizzes")
      .update(toSnake({ status: "DRAFT", updatedAt: new Date() }))
      .eq("id", req.params.id)
      .select("*")
      .maybeSingle();
    assertNoError(error, "Failed to unpublish quiz");
    if (!updated) return res.status(404).json({ error: "Quiz not found." });

    await logAction({ actorId: req.user.id, action: "quiz.unpublish", entityType: "Quiz", entityId: req.params.id });
    res.json({ quiz: row(updated) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Admin — question CRUD (manual creation, edit, delete, reorder)
// =====================================================================

const questionSchema = z.object({
  questionText: z.string().min(1),
  optionA: z.string().min(1),
  optionB: z.string().min(1),
  optionC: z.string().min(1),
  optionD: z.string().min(1),
  correctOption: z.enum(["A", "B", "C", "D"]),
  explanation: z.string().optional(),
});

async function loadQuizOr404(quizId, res) {
  const { data, error } = await supabase.from("quizzes").select("id").eq("id", quizId).maybeSingle();
  assertNoError(error, "Failed to load quiz");
  if (!data) {
    res.status(404).json({ error: "Quiz not found." });
    return null;
  }
  return data;
}

router.get("/:id/questions", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadQuizOr404(req.params.id, res))) return;
    const { data, error } = await supabase.from("quiz_questions").select("*").eq("quiz_id", req.params.id).order("order_index", { ascending: true });
    assertNoError(error, "Failed to load questions");
    res.json({ questions: rows(data) });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/questions", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadQuizOr404(req.params.id, res))) return;
    const parsed = questionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const check = validateQuestionFields(parsed.data);
    if (!check.ok) return res.status(400).json({ error: check.issues[0] });

    const { data: maxRow } = await supabase
      .from("quiz_questions")
      .select("order_index")
      .eq("quiz_id", req.params.id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = maxRow ? Number(maxRow.order_index) + 1 : 0;

    const { data: created, error } = await supabase
      .from("quiz_questions")
      .insert(
        toSnake({
          quizId: req.params.id,
          questionText: parsed.data.questionText,
          optionA: parsed.data.optionA,
          optionB: parsed.data.optionB,
          optionC: parsed.data.optionC,
          optionD: parsed.data.optionD,
          correctOption: check.correctOption,
          explanation: parsed.data.explanation || "",
          orderIndex: nextOrder,
        })
      )
      .select("*")
      .single();
    assertNoError(error, "Failed to create question");

    await logAction({ actorId: req.user.id, action: "quiz.question.create", entityType: "QuizQuestion", entityId: created.id, metadata: { quizId: req.params.id } });
    res.status(201).json({ question: row(created) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/questions/:questionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadQuizOr404(req.params.id, res))) return;
    const parsed = questionSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data: existingData, error: existingError } = await supabase
      .from("quiz_questions")
      .select("*")
      .eq("id", req.params.questionId)
      .eq("quiz_id", req.params.id)
      .maybeSingle();
    assertNoError(existingError, "Failed to load question");
    if (!existingData) return res.status(404).json({ error: "Question not found." });
    const existing = row(existingData);

    const merged = { ...existing, ...parsed.data };
    const check = validateQuestionFields(merged);
    if (!check.ok) return res.status(400).json({ error: check.issues[0] });

    const { data: updated, error } = await supabase
      .from("quiz_questions")
      .update(toSnake({ ...parsed.data, correctOption: check.correctOption, updatedAt: new Date() }))
      .eq("id", req.params.questionId)
      .select("*")
      .single();
    assertNoError(error, "Failed to update question");

    await logAction({ actorId: req.user.id, action: "quiz.question.update", entityType: "QuizQuestion", entityId: req.params.questionId, metadata: { quizId: req.params.id } });
    res.json({ question: row(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id/questions/:questionId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { error, count } = await supabase
      .from("quiz_questions")
      .delete({ count: "exact" })
      .eq("id", req.params.questionId)
      .eq("quiz_id", req.params.id);
    assertNoError(error, "Failed to delete question");
    if (!count) return res.status(404).json({ error: "Question not found." });

    await logAction({ actorId: req.user.id, action: "quiz.question.delete", entityType: "QuizQuestion", entityId: req.params.questionId, metadata: { quizId: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const reorderSchema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) });

router.post("/:id/questions/reorder", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadQuizOr404(req.params.id, res))) return;
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    // Every id in the reorder request must actually belong to this
    // quiz — otherwise an admin editing quiz A could reorder (or,
    // combined with the update below, silently move) a question that
    // actually belongs to quiz B.
    const { data: existingRows, error: existingError } = await supabase.from("quiz_questions").select("id").eq("quiz_id", req.params.id);
    assertNoError(existingError, "Failed to load questions");
    const existingIds = new Set((existingRows || []).map((r) => r.id));
    const requestedIds = parsed.data.orderedIds;
    if (requestedIds.length !== existingIds.size || requestedIds.some((id) => !existingIds.has(id))) {
      return res.status(400).json({ error: "orderedIds must contain exactly this quiz's question ids." });
    }

    await Promise.all(
      requestedIds.map((id, index) => supabase.from("quiz_questions").update({ order_index: index, updated_at: new Date() }).eq("id", id))
    );

    const { data, error } = await supabase.from("quiz_questions").select("*").eq("quiz_id", req.params.id).order("order_index", { ascending: true });
    assertNoError(error, "Failed to reload questions");

    await logAction({ actorId: req.user.id, action: "quiz.question.reorder", entityType: "Quiz", entityId: req.params.id });
    res.json({ questions: rows(data) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Admin — DOCX import (preview, then confirm)
// =====================================================================

router.post("/import/preview", authenticate, requireAdmin, docxUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    let parsed;
    try {
      parsed = parseQuizFromDocxBuffer(req.file.buffer);
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message || "Couldn't read this Word document." });
    }

    // Every question gets a stable tempId so the admin's preview-editor
    // can address individual rows (edit/delete) before anything is
    // saved to Supabase (spec #3: "Do not immediately save imported
    // questions").
    const questions = parsed.questions.map((q, index) => ({ tempId: `import-${index}`, ...q }));

    await logAction({
      actorId: req.user.id,
      action: "quiz.import.preview",
      entityType: "Quiz",
      entityId: null,
      metadata: { fileName: req.file.originalname, found: parsed.summary.found, valid: parsed.summary.valid, needsReview: parsed.summary.needsReview },
    });

    res.json({ title: parsed.title, description: parsed.description, questions, summary: parsed.summary });
  } catch (err) {
    next(err);
  }
});

const importConfirmSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  passPercent: z.number().int().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  questions: z
    .array(
      z.object({
        questionText: z.string(),
        optionA: z.string(),
        optionB: z.string(),
        optionC: z.string(),
        optionD: z.string(),
        correctOption: z.string(),
        explanation: z.string().optional(),
      })
    )
    .min(1),
});

router.post("/import/confirm", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = importConfirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data: course, error: courseError } = await supabase.from("courses").select("id").eq("id", parsed.data.courseId).maybeSingle();
    assertNoError(courseError, "Failed to load course");
    if (!course) return res.status(400).json({ error: "Course not found." });

    if (parsed.data.status === "PUBLISHED") {
      const check = canPublishQuiz(parsed.data.questions);
      if (!check.ok) return res.status(400).json({ error: check.reason });
    } else {
      // Even a Draft import needs at least one *usable* question — a
      // batch where every single row failed extraction has nothing
      // worth saving; the admin should fix the source doc and re-upload.
      const usable = parsed.data.questions.filter((q) => validateQuestionFields(q).ok);
      if (usable.length === 0) {
        return res.status(400).json({ error: "None of the imported questions are complete enough to save. Fix them in the preview and try again." });
      }
    }

    const { data: quizId, error } = await supabase.rpc("import_quiz_with_questions", {
      p_course_id: parsed.data.courseId,
      p_title: parsed.data.title,
      p_description: parsed.data.description || "",
      p_status: parsed.data.status,
      p_pass_percent: parsed.data.passPercent ?? 70,
      p_created_by_id: req.user.id,
      p_questions: parsed.data.questions,
    });
    if (error) {
      // P0003 = "can't publish, a question is incomplete", P0004 = "no
      // valid questions at all" — both are the admin's input being
      // wrong, not a server failure, so surface them as 400s with the
      // database's own message rather than a generic 500.
      if (error.code === "P0003" || error.code === "P0004") {
        return res.status(400).json({ error: error.message });
      }
      assertNoError(error, "Failed to import quiz");
    }

    const { data: quizData } = await supabase.from("quizzes").select("*").eq("id", quizId).maybeSingle();

    await logAction({
      actorId: req.user.id,
      action: "quiz.import.confirm",
      entityType: "Quiz",
      entityId: quizId,
      metadata: { courseId: parsed.data.courseId, questionCount: parsed.data.questions.length, status: parsed.data.status },
    });

    res.status(201).json({ quiz: row(quizData) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Admin — results
// =====================================================================

router.get("/:id/results", authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (!(await loadQuizOr404(req.params.id, res))) return;

    const { data: attemptsData, error } = await supabase
      .from("quiz_attempts")
      .select("*")
      .eq("quiz_id", req.params.id)
      .order("completed_at", { ascending: false });
    assertNoError(error, "Failed to load results");
    const attempts = rows(attemptsData);

    const userIds = [...new Set(attempts.map((a) => a.userId))];
    let usersById = new Map();
    if (userIds.length > 0) {
      const { data: usersData, error: usersErr } = await supabase.from("users").select("id, name, email").in("id", userIds);
      assertNoError(usersErr, "Failed to load students");
      usersById = new Map(rows(usersData).map((u) => [u.id, u]));
    }

    const shaped = attempts.map((a) => ({ ...a, student: usersById.get(a.userId) || null }));
    res.json({ attempts: shaped });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/results/:attemptId", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const detail = await loadAttemptDetail({ quizId: req.params.id, attemptId: req.params.attemptId });
    if (!detail) return res.status(404).json({ error: "Attempt not found." });
    const { data: userData } = await supabase.from("users").select("id, name, email").eq("id", detail.attempt.userId).maybeSingle();
    res.json({ ...detail, student: row(userData) || null });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Shared helper — question-by-question attempt detail, used by both
// the admin results drill-down and the student's own attempt review.
// Safe to show correct answers here: the attempt is already completed,
// so nothing is disclosed ahead of a still-open submission.
// =====================================================================
async function loadAttemptDetail({ quizId, attemptId }) {
  const { data: attemptData, error: attemptError } = await supabase
    .from("quiz_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("quiz_id", quizId)
    .maybeSingle();
  assertNoError(attemptError, "Failed to load attempt");
  if (!attemptData) return null;
  const attempt = row(attemptData);

  const { data: answersData, error: answersError } = await supabase.from("quiz_answers").select("*").eq("attempt_id", attemptId);
  assertNoError(answersError, "Failed to load answers");
  const answersByQuestion = new Map(rows(answersData).map((a) => [a.questionId, a]));

  const { data: questionsData, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("*")
    .eq("quiz_id", quizId)
    .order("order_index", { ascending: true });
  assertNoError(questionsError, "Failed to load questions");

  const answers = rows(questionsData).map((question) => {
    const answer = answersByQuestion.get(question.id);
    return {
      questionId: question.id,
      questionText: question.questionText,
      optionA: question.optionA,
      optionB: question.optionB,
      optionC: question.optionC,
      optionD: question.optionD,
      correctOption: question.correctOption,
      explanation: question.explanation || "",
      selectedOption: answer ? answer.selectedOption : null,
      isCorrect: answer ? answer.isCorrect : false,
    };
  });

  return { attempt, answers };
}

// =====================================================================
// Student — browse, take, submit, own results
// =====================================================================

router.get("/", authenticate, async (req, res, next) => {
  try {
    const accessibleCourseIds = Array.from(await getAccessibleCourseIds(req.user.id));
    if (accessibleCourseIds.length === 0) return res.json({ quizzes: [] });

    const { courseId } = req.query;
    if (courseId && !accessibleCourseIds.includes(courseId)) return res.json({ quizzes: [] });

    let q = supabase
      .from("quizzes")
      .select("id, course_id, title, description, pass_percent, created_at")
      .in("course_id", courseId ? [courseId] : accessibleCourseIds)
      .eq("status", "PUBLISHED");
    const { data: quizzesData, error } = await q;
    assertNoError(error, "Failed to load quizzes");
    const quizzes = rows(quizzesData);

    const uniqueCourseIds = [...new Set(quizzes.map((qz) => qz.courseId))];
    let coursesById = new Map();
    if (uniqueCourseIds.length > 0) {
      const { data: coursesData } = await supabase.from("courses").select("id, title").in("id", uniqueCourseIds);
      coursesById = new Map(rows(coursesData).map((c) => [c.id, c]));
    }

    const quizIds = quizzes.map((qz) => qz.id);
    const countByQuiz = new Map();
    if (quizIds.length > 0) {
      const { data: questionRows } = await supabase.from("quiz_questions").select("quiz_id").in("quiz_id", quizIds);
      for (const r of questionRows || []) countByQuiz.set(r.quiz_id, (countByQuiz.get(r.quiz_id) || 0) + 1);
    }

    // Best + most recent attempt per quiz for this student — powers
    // the "Quizzes: 2/3 completed" progress view and each card's
    // Completed/Not Started state.
    let attemptsByQuiz = new Map();
    if (quizIds.length > 0) {
      const { data: attemptsData, error: attemptsErr } = await supabase
        .from("quiz_attempts")
        .select("*")
        .in("quiz_id", quizIds)
        .eq("user_id", req.user.id)
        .order("completed_at", { ascending: false });
      assertNoError(attemptsErr, "Failed to load attempts");
      for (const a of rows(attemptsData)) {
        if (!attemptsByQuiz.has(a.quizId)) attemptsByQuiz.set(a.quizId, []);
        attemptsByQuiz.get(a.quizId).push(a);
      }
    }

    const shaped = quizzes
      .filter((qz) => (countByQuiz.get(qz.id) || 0) > 0) // a published quiz with zero questions can't actually be taken
      .map((qz) => {
        const attempts = attemptsByQuiz.get(qz.id) || [];
        const best = attempts.reduce((acc, a) => (acc === null || a.percent > acc.percent ? a : acc), null);
        const latest = attempts[0] || null;
        return {
          ...qz,
          course: coursesById.get(qz.courseId) || null,
          questionCount: countByQuiz.get(qz.id) || 0,
          attemptsCount: attempts.length,
          bestPercent: best ? Number(best.percent) : null,
          lastAttempt: latest ? { percent: Number(latest.percent), passed: latest.passed, completedAt: latest.completedAt } : null,
        };
      });

    shaped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ quizzes: shaped });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, async (req, res, next) => {
  try {
    const { data: quizData, error: quizError } = await supabase
      .from("quizzes")
      .select("id, course_id, title, description, pass_percent, status")
      .eq("id", req.params.id)
      .maybeSingle();
    assertNoError(quizError, "Failed to load quiz");
    if (!quizData || quizData.status !== "PUBLISHED") return res.status(404).json({ error: "Quiz not found." });
    const quiz = row(quizData);

    if (!(await userCanAccessCourse(req.user.id, quiz.courseId))) {
      return res.status(403).json({ error: "You do not have access to this quiz." });
    }

    // STUDENT_SAFE_QUESTION_COLUMNS deliberately omits correct_option
    // and explanation (spec #8).
    const { data: questionsData, error: questionsError } = await supabase
      .from("quiz_questions")
      .select(STUDENT_SAFE_QUESTION_COLUMNS)
      .eq("quiz_id", quiz.id)
      .order("order_index", { ascending: true });
    assertNoError(questionsError, "Failed to load questions");
    const questions = rows(questionsData);
    if (questions.length === 0) return res.status(404).json({ error: "This quiz has no questions yet." });

    const { data: courseData } = await supabase.from("courses").select("id, title").eq("id", quiz.courseId).maybeSingle();

    res.json({ quiz: { ...quiz, course: row(courseData) || null }, questions });
  } catch (err) {
    next(err);
  }
});

const submitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        selectedOption: z.enum(["A", "B", "C", "D"]).nullable().optional(),
      })
    )
    .default([]),
});

router.post("/:id/submit", authenticate, async (req, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data: quizData, error: quizError } = await supabase.from("quizzes").select("id, course_id, status").eq("id", req.params.id).maybeSingle();
    assertNoError(quizError, "Failed to load quiz");
    if (!quizData || quizData.status !== "PUBLISHED") return res.status(404).json({ error: "Quiz not found." });

    if (!(await userCanAccessCourse(req.user.id, quizData.course_id))) {
      return res.status(403).json({ error: "You do not have access to this quiz." });
    }

    // Scoring happens entirely inside submit_quiz_attempt() (see
    // supabase/schema.sql) — the client only ever sends its selected
    // option letters, never a score or pass/fail verdict, and the
    // function looks up the real correct_option itself (spec #8).
    const { data: resultData, error: submitError } = await supabase.rpc("submit_quiz_attempt", {
      p_quiz_id: req.params.id,
      p_user_id: req.user.id,
      p_answers: parsed.data.answers,
    });
    if (submitError) {
      if (submitError.code === "P0002" || submitError.code === "P0005") {
        return res.status(404).json({ error: submitError.message });
      }
      assertNoError(submitError, "Failed to submit quiz");
    }
    const result = row(Array.isArray(resultData) ? resultData[0] : resultData);

    const detail = await loadAttemptDetail({ quizId: req.params.id, attemptId: result.attemptId });

    await logAction({
      actorId: req.user.id,
      action: "quiz.submit",
      entityType: "Quiz",
      entityId: req.params.id,
      metadata: { attemptId: result.attemptId, score: result.score, totalQuestions: result.totalQuestions, percent: Number(result.percent), passed: result.passed },
    });

    res.status(201).json({
      attemptId: result.attemptId,
      attemptNumber: result.attemptNumber,
      score: result.score,
      totalQuestions: result.totalQuestions,
      percent: Number(result.percent),
      passed: result.passed,
      answers: detail.answers,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/attempts", authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("*")
      .eq("quiz_id", req.params.id)
      .eq("user_id", req.user.id)
      .order("attempt_number", { ascending: false });
    assertNoError(error, "Failed to load attempts");
    res.json({ attempts: rows(data) });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/attempts/:attemptId", authenticate, async (req, res, next) => {
  try {
    const detail = await loadAttemptDetail({ quizId: req.params.id, attemptId: req.params.attemptId });
    if (!detail) return res.status(404).json({ error: "Attempt not found." });
    // Students may only ever view their own attempts (spec #8).
    if (detail.attempt.userId !== req.user.id) return res.status(403).json({ error: "You do not have access to this attempt." });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ error: err.code === "LIMIT_FILE_SIZE" ? "The .docx file is too large (15MB max)." : err.message });
  }
  // The docx fileFilter rejects non-.docx uploads by calling
  // cb(new Error(...)) — multer surfaces that as a plain Error (not a
  // MulterError) with no .status, which is exactly the admin-facing,
  // 400-worthy message set in fileFilter above. Anything else (a
  // genuine server-side failure) is left for index.js's app-level
  // error handler, which correctly defaults to 500 and hides the
  // message in production — this router must not silently downgrade
  // those to 400.
  if (err && err.message === "Only .docx files are supported for quiz import.") {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
