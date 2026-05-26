import { useEffect, useState, useCallback } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";

export const OWNER_TEAM_NAME = "Rafa C.";

function metaStr(val) {
  if (typeof val === "string") return val.trim() || null;
  if (val == null) return null;
  return String(val).trim() || null;
}

/** Read string keys from a metadata object */
function fromBag(bag, keys) {
  if (!bag || typeof bag !== "object") return null;
  for (const key of keys) {
    const v = metaStr(bag[key]);
    if (v) return v;
  }
  return null;
}

function bagsFromUser(user) {
  if (!user) return [];
  return [user.publicMetadata, user.unsafeMetadata].filter(Boolean);
}

function bagsFromClaims(claims) {
  if (!claims || typeof claims !== "object") return [];
  const out = [claims];
  if (claims.publicMetadata) out.push(claims.publicMetadata);
  if (claims.public_metadata) out.push(claims.public_metadata);
  if (claims.metadata) out.push(claims.metadata);
  return out;
}

function readMetaFromBags(bags, keys) {
  for (const bag of bags) {
    const v = fromBag(bag, keys);
    if (v) return v;
  }
  return null;
}

/** Top-left chip — nickname / Clerk profile */
export function readHeaderDisplayName(user, sessionClaims) {
  const bags = [...bagsFromUser(user), ...bagsFromClaims(sessionClaims)];
  const nickname = readMetaFromBags(bags, [
    "nickname", "nickName", "nick_name", "displayName", "display_name",
  ]);
  if (nickname) return nickname;
  if (user) {
    if (metaStr(user.username)) return user.username;
    if (metaStr(user.firstName)) {
      const last = metaStr(user.lastName);
      return last ? `${user.firstName} ${last[0]}.` : user.firstName;
    }
    if (metaStr(user.fullName)) return user.fullName;
  }
  return readMetaFromBags(bags, ["teamName", "team_name"]);
}

/** Board / activity — roster name */
export function readBoardTeamName(user, sessionClaims) {
  const bags = [...bagsFromUser(user), ...bagsFromClaims(sessionClaims)];
  return readMetaFromBags(bags, ["teamName", "team_name"]);
}

function resolveProfile(user, sessionClaims) {
  let headerName = readHeaderDisplayName(user, sessionClaims);
  let boardName = readBoardTeamName(user, sessionClaims);

  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (ownerEmail && email === ownerEmail) {
    const ownerBoard = import.meta.env.VITE_OWNER_TEAM_NAME || OWNER_TEAM_NAME;
    if (!boardName) boardName = ownerBoard;
    if (!headerName) headerName = ownerBoard;
  }

  return { headerName, boardName };
}

/** Clerk publicMetadata.role: "viewer" = read-only; anything else = editor */
export function useAppRole() {
  const { user, isLoaded } = useUser();
  const { sessionClaims } = useAuth();
  const [profile, setProfile] = useState({ headerName: null, boardName: null });

  const syncProfile = useCallback(async (u) => {
    if (!u) {
      setProfile({ headerName: null, boardName: null });
      return;
    }
    try {
      await u.reload?.();
    } catch {
      /* use cached user */
    }
    setProfile(resolveProfile(u, sessionClaims));
  }, [sessionClaims]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      setProfile({ headerName: null, boardName: null });
      return;
    }
    syncProfile(user);
  }, [isLoaded, user?.id, syncProfile]);

  // Re-read when JWT claims update (no reload needed after dashboard edit + re-login)
  useEffect(() => {
    if (!isLoaded || !user) return;
    setProfile(prev => {
      const next = resolveProfile(user, sessionClaims);
      if (prev.headerName === next.headerName && prev.boardName === next.boardName) return prev;
      return next;
    });
  }, [isLoaded, user, sessionClaims]);

  const roleRaw =
    user?.publicMetadata?.role ??
    sessionClaims?.role ??
    sessionClaims?.publicMetadata?.role;
  const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "editor";
  const isViewer = role === "viewer";
  const canEdit = !isViewer;

  // Live fallback every render (catches metadata before reload finishes)
  const live = isLoaded && user ? resolveProfile(user, sessionClaims) : profile;
  const headerName = live.headerName || profile.headerName;
  const boardName = live.boardName || profile.boardName;

  return {
    canEdit,
    isViewer,
    role,
    isLoaded: isLoaded && !!user,
    headerName,
    boardName,
    user,
  };
}
