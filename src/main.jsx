import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import StudioTracker from "../studio-tracker-v7.jsx";
import AuthGate, { MissingAuthConfig } from "./AuthGate.jsx";
import { initStorage } from "./storage.js";

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

initStorage();

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
