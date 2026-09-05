export type Role = "STUDENT" | "ADMIN";
export type ContentType = "VIDEO" | "PDF" | "POST";
export type ContentStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
// 'RECORDING' = created automatically from a live class's LiveKit Egress
// output (see meetingRecordingService.js); 'UPLOAD' = an admin added it
// directly through the Content tab.
export type ContentSource = "UPLOAD" | "RECORDING";
export type BillingPeriod = "ONE_TIME" | "MONTHLY" | "YEARLY";
export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";

export type MeetingStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";

export type MeetingRecordingStatus = "NONE" | "RECORDING" | "PROCESSING" | "READY" | "FAILED";

/** An earlier recording segment that isn't the meeting's current one
 * anymore — created when someone (an admin) rejoins a still-LIVE
 * meeting after its egress had already stopped (the room went empty)
 * and a fresh segment was started to keep recording. See
 * meetingRecordingService.js's resumeRecordingIfDropped(). */
export interface MeetingRecordingSegment {
  id: string;
  meetingId: string;
  segmentNumber: number;
  status: "PROCESSING" | "READY" | "FAILED";
  egressId?: string | null;
  contentId?: string | null;
  fileKey?: string | null;
  durationSeconds?: number | null;
  fileSizeBytes?: number | null;
  error?: string | null;
  createdAt: string;
}

export interface Meeting {
  id: string;
  courseId: string;
  title: string;
  description: string;
  roomName: string;
  status: MeetingStatus;
  scheduledAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  course?: { id: string; title: string } | null;
  // Recording lifecycle: Live Meeting -> ends -> LiveKit Egress records
  // -> saved to Storage -> admin Preview/Publish here -> shows up as a
  // normal VIDEO in Course Content. See meetingRecordingService.js.
  recordingStatus: MeetingRecordingStatus;
  recordingContentId?: string | null;
  recordingDurationSeconds?: number | null;
  recordingFileSizeBytes?: number | null;
  recordingError?: string | null;
  // Earlier segments superseded by a resumed recording (see
  // MeetingRecordingSegment above) — empty for the common case of one
  // continuous recording per meeting.
  recordingSegments?: MeetingRecordingSegment[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Course {
  id: string;
  title: string;
  slug: string;
  description: string;
  category?: string | null;
  thumbnailUrl?: string | null;
  startAt?: string | null;
  isPublished: boolean;
  contentCounts?: { VIDEO: number; PDF: number; POST: number };
}

export interface ContentProgressInfo {
  percent: number;
  viewed: boolean;
  lastPositionSeconds: number | null;
}

export interface ContentItem {
  id: string;
  title: string;
  description?: string | null;
  type: ContentType;
  status: ContentStatus;
  source?: ContentSource;
  hasFile?: boolean;
  imageUrl?: string | null;
  durationSeconds?: number | null;
  pageCount?: number | null;
  courseId: string;
  course?: { id: string; title: string };
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  progress?: ContentProgressInfo;
}

// --- Quiz system -------------------------------------------------------

export type QuizStatus = "DRAFT" | "PUBLISHED";
export type QuizOptionLetter = "A" | "B" | "C" | "D";

export interface Quiz {
  id: string;
  courseId: string;
  course?: { id: string; title: string } | null;
  title: string;
  description?: string | null;
  status: QuizStatus;
  passPercent: number;
  questionCount?: number;
  createdAt: string;
  updatedAt?: string;
  // Student-facing extras (present on GET /quizzes for a student)
  attemptsCount?: number;
  bestPercent?: number | null;
  lastAttempt?: { percent: number; passed: boolean; completedAt: string } | null;
}

// Admin/editing shape — includes the correct answer and explanation.
export interface QuizQuestion {
  id: string;
  quizId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: QuizOptionLetter;
  explanation?: string | null;
  orderIndex: number;
}

// Student quiz-taking shape — never includes correctOption/explanation
// until after the quiz has been submitted (see backend/src/routes/quizzes.routes.js).
export interface StudentQuizQuestion {
  id: string;
  quizId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  orderIndex: number;
}

// A single row from the DOCX import preview — same shape as
// QuizQuestion, plus a tempId (no real id yet, nothing is saved) and
// validity metadata the admin uses to fix "needs review" rows.
export interface ImportedQuizQuestion {
  tempId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: QuizOptionLetter | null;
  explanation?: string;
  valid: boolean;
  issues: string[];
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  userId: string;
  attemptNumber: number;
  score: number;
  totalQuestions: number;
  percent: number;
  passed: boolean;
  startedAt: string;
  completedAt?: string | null;
  student?: { id: string; name: string; email: string } | null;
}

export interface QuizAnswerReview {
  questionId: string;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctOption: QuizOptionLetter;
  explanation?: string;
  selectedOption: QuizOptionLetter | null;
  isCorrect: boolean;
}

export interface QuizAttemptResult {
  attemptId: string;
  attemptNumber: number;
  score: number;
  totalQuestions: number;
  percent: number;
  passed: boolean;
  answers: QuizAnswerReview[];
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  billingPeriod: BillingPeriod;
  description?: string | null;
  features: string[];
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
  planCourses?: { course: { id: string; title: string } }[];
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  startedAt: string;
  expiresAt?: string | null;
  plan: Plan;
}

export interface Student {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  subscriptions?: { plan: { id: string; name: string } }[];
}

// --- Landing page content, editable from the Admin Panel -------------------

export interface FeatureItem {
  glyph: string;
  title: string;
  desc: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface SiteContent {
  hero: {
    badge: string;
    titleLine1: string;
    titleLine2: string;
    subtitle: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
  };
  courseShowcase: {
    eyebrow: string;
    title: string;
  };
  features: {
    eyebrow: string;
    title: string;
    items: FeatureItem[];
  };
  plansSection: {
    eyebrow: string;
    title: string;
  };
  faq: {
    eyebrow: string;
    title: string;
    items: FaqItem[];
  };
  footer: {
    tagline: string;
  };
  legal: {
    terms: string;
    privacy: string;
  };
}
