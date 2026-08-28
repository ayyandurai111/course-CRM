export type Role = "STUDENT" | "ADMIN";
export type ContentType = "VIDEO" | "PDF" | "POST";
export type ContentStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
export type BillingPeriod = "ONE_TIME" | "MONTHLY" | "YEARLY";
export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "CANCELLED" | "PENDING";

export type MeetingStatus = "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";

export type MeetingRecordingStatus = "NONE" | "RECORDING" | "PROCESSING" | "READY" | "FAILED";

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
