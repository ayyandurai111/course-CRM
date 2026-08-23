import React from "react";

interface Props { children: React.ReactNode }
interface State { hasError: boolean }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Unhandled UI error", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper-50 px-5">
        <section className="w-full max-w-md rounded-xl2 border border-red-200 bg-white p-8 text-center shadow-card">
          <h1 className="font-display text-xl font-semibold text-ink-950">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-500">The page hit an unexpected error. Your data is safe. Please reload and try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-full bg-ink-950 px-5 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            Reload page
          </button>
        </section>
      </main>
    );
  }
}
