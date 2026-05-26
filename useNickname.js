import { useState, useEffect, useCallback } from "react";

const storageKey = (userId) => `st_nickname_${userId}`;

export function loadNickname(userId) {
  if (!userId) return "";
  try {
    return localStorage.getItem(storageKey(userId)) || "";
  } catch {
    return "";
  }
}

export function saveNickname(userId, name) {
  if (!userId) return;
  const v = name.trim();
  try {
    if (v) localStorage.setItem(storageKey(userId), v);
    else localStorage.removeItem(storageKey(userId));
  } catch {
    /* private browsing */
  }
}

/** Per-user display name in the header (local to this browser) */
export function useNickname(userId) {
  const [nickname, setNicknameState] = useState("");

  useEffect(() => {
    setNicknameState(loadNickname(userId));
  }, [userId]);

  const setNickname = useCallback((name) => {
    const v = typeof name === "string" ? name.trim() : "";
    setNicknameState(v);
    saveNickname(userId, v);
  }, [userId]);

  return { nickname, setNickname };
}
