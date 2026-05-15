import React from "react";
import { createRoot } from "react-dom/client";
import StudioTracker from "../studio-tracker-v7.jsx";

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

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <StudioTracker />
  </React.StrictMode>
);
