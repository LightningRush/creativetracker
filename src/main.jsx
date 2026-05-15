import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import StudioTracker from "../studio-tracker-v7.jsx";
import AuthGate, { MissingAuthConfig } from "./AuthGate.jsx";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Polyfill window.storage with localStorage so the app can persist data
window.storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value !== null ? { value } : null;
  },
  async set(key, value) {
    localStorage.setItem(key, value);
  },
};

function App() {
  if (!clerkKey) return <MissingAuthConfig />;
  return (
    <ClerkProvider publishableKey={clerkKey}>
      <AuthGate>
        <StudioTracker />
      </AuthGate>
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
