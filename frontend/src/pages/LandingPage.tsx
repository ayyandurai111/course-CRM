import { useEffect, useState } from "react";
import { apiRequest } from "../lib/apiClient";
import { DEFAULT_SITE_CONTENT } from "../lib/defaultSiteContent";
import type { SiteContent } from "../types";
import Header from "../components/landing/Header";
import Hero from "../components/landing/Hero";
import CourseShowcase from "../components/landing/CourseShowcase";
import Features from "../components/landing/Features";
import PlansSection from "../components/landing/PlansSection";
import Faq from "../components/landing/Faq";
import Footer from "../components/landing/Footer";

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
