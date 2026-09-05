import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "../../shared/frontend-core/components/common/ErrorBoundary";
import { AuthProvider } from "../../features/auth/frontend/context/AuthContext";
import { applyBrand } from "../../shared/frontend-core/theme/applyBrand";
import "./index.css";

applyBrand();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
