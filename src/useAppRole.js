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

function userEmail(user) {
  return user?.primaryEmailAddress?.emailAddress?.toLowerCase() || "";
}

/** Full access — overrides viewer role and Licensing/Sales team limits */
export function isMasterUser(user) {
  if (!user) return false;
  const meta = user.publicMetadata || {};
  if (meta.master === true || meta.masterAccess === true || meta.isMaster === true) return true;
  const role = typeof meta.role === "string" ? meta.role.toLowerCase() : "";
  if (role === "master" || role === "admin" || role === "owner") return true;
  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  if (ownerEmail && userEmail(user) === ownerEmail) return true;
  return false;
}

/** Optional board roster name from Clerk (assignee defaults / activity) */
export function readBoardTeamName(user) {
  if (!user) return null;
  const meta = user.publicMetadata?.teamName;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  if (ownerEmail && userEmail(user) === ownerEmail) {
    return import.meta.env.VITE_OWNER_TEAM_NAME || OWNER_TEAM_NAME;
  }
  return null;
}

/** Clerk publicMetadata.role: "viewer" = read-only (master overrides) */
export function useAppRole() {
  const { user, isLoaded } = useUser();
  const isMaster = isMasterUser(user);
  const roleRaw = user?.publicMetadata?.role;
  const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "editor";
  const isViewer = !isMaster && role === "viewer";
  const canEdit = isMaster || !isViewer;
  const boardName = user ? readBoardTeamName(user) : null;
  const isLicensingTeam =
    !isMaster &&
    typeof boardName === "string" &&
    boardName.trim().toLowerCase() === "licensing";
  const licensingAccess = user?.publicMetadata?.licensingAccess;
  const hasLicensingAccess = isMaster || isLicensingTeam || licensingAccess === true;
  const isSalesTeam =
    !isMaster &&
    typeof boardName === "string" &&
    boardName.trim().toLowerCase() === "sales";
  const salesAccess = user?.publicMetadata?.salesAccess;
  const hasSalesAccess = isMaster || isSalesTeam || salesAccess === true;
  const artReviewAccess = user?.publicMetadata?.artReviewAccess === true;
  /** Sales team submits; art / creative editors review (master: both) */
  const canSubmitSalesRequests = isMaster || hasSalesAccess;
  const canReviewSalesRequests =
    isMaster || artReviewAccess || (canEdit && !isLicensingTeam && !isSalesTeam);
  const canViewSalesRequests = isMaster || canReviewSalesRequests || hasSalesAccess;

  return {
    canEdit,
    isMaster,
    isViewer,
    isLicensingTeam,
    hasLicensingAccess,
    isSalesTeam,
    hasSalesAccess,
    canSubmitSalesRequests,
    canReviewSalesRequests,
    canViewSalesRequests,
    role,
    isLoaded: isLoaded && !!user,
    boardName,
    user,
  };
}
