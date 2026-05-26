import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/clerk-react";

export const OWNER_TEAM_NAME = "Rafa C.";

const nicknameKey = (userId) => `st_nickname_${userId}`;

export function loadNickname(userId) {
  if (!userId) return "";
  try {
    return localStorage.getItem(nicknameKey(userId)) || "";
  } catch {
    return "";
  }
}

export function saveNickname(userId, name) {
  if (!userId) return;
  const v = name.trim();
  try {
    if (v) localStorage.setItem(nicknameKey(userId), v);
    else localStorage.removeItem(nicknameKey(userId));
  } catch {
    /* private browsing */
  }
}

/** Per-user nickname in header (saved on this device only) */
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

/** Optional board roster name from Clerk (assignee defaults / activity) */
export function readBoardTeamName(user) {
  if (!user) return null;
  const meta = user.publicMetadata?.teamName;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (ownerEmail && email === ownerEmail) {
    return import.meta.env.VITE_OWNER_TEAM_NAME || OWNER_TEAM_NAME;
  }
  return null;
}

/** Clerk publicMetadata.role: "viewer" = read-only */
export function useAppRole() {
  const { user, isLoaded } = useUser();
  const roleRaw = user?.publicMetadata?.role;
  const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "editor";
  const isViewer = role === "viewer";
  const canEdit = !isViewer;
  const boardName = user ? readBoardTeamName(user) : null;

  return {
    canEdit,
    isViewer,
    role,
    isLoaded: isLoaded && !!user,
    boardName,
    user,
  };
}
