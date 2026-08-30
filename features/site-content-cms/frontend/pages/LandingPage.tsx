import { useEffect, useState } from "react";
import { apiRequest } from "../../../../shared/frontend-core/lib/apiClient";
import { DEFAULT_SITE_CONTENT } from "../defaultSiteContent";
import type { SiteContent } from "../../../../shared/frontend-core/types/index";
import Header from "../components/Header";
import Hero from "../components/Hero";
import CourseShowcase from "../components/CourseShowcase";
import Features from "../components/Features";
import PlansSection from "../../../plans-subscription/frontend/components/LandingPlansSection";
import Faq from "../components/Faq";
import Footer from "../components/Footer";

export default function LandingPage() {
  // Renders with sensible defaults immediately, then swaps in the admin's
  // customized copy once it loads — the page never shows a blank/loading
  // state for content that has a safe default.
  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);

  useEffect(() => {
    apiRequest<{ content: SiteContent | null }>("/site-content")
      .then((data) => {
        if (data.content) setContent(data.content);
      })
      .catch(() => {
        // Falls back to bundled defaults — not worth surfacing an error
        // for landing-page copy specifically.
      });
  }, []);

  return (
    <div className="min-h-screen bg-paper-50">
      <Header />
      <main>
        <Hero content={content.hero} />
        <CourseShowcase content={content.courseShowcase} />
        <Features content={content.features} />
        <PlansSection content={content.plansSection} />
        <Faq content={content.faq} />
      </main>
      <Footer footer={content.footer} legal={content.legal} />
    </div>
  );
}
