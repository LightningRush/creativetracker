import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";

export const OWNER_TEAM_NAME = "Rafa C.";

function metaStr(val) {
  if (typeof val === "string") return val.trim() || null;
  if (val == null) return null;
  return String(val).trim() || null;
}

function readMetaString(user, keys) {
  if (!user) return null;
  const bags = [user.publicMetadata, user.unsafeMetadata];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const key of keys) {
      const v = metaStr(bag[key]);
      if (v) return v;
    }
  }
  return null;
}

/** Top-left chip — nickname / Clerk profile (personal label) */
export function readHeaderDisplayName(user) {
  if (!user) return null;
  const nickname = readMetaString(user, [
    "nickname", "nickName", "nick_name", "displayName", "display_name",
  ]);
  if (nickname) return nickname;
  if (metaStr(user.username)) return user.username;
  if (metaStr(user.firstName)) {
    const last = metaStr(user.lastName);
    return last ? `${user.firstName} ${last[0]}.` : user.firstName;
  }
  if (metaStr(user.fullName)) return user.fullName;
  return readMetaString(user, ["teamName", "team_name"]);
}

/** Board list / activity — official teamName on the roster */
export function readBoardTeamName(user) {
  return readMetaString(user, ["teamName", "team_name"]);
}

/** Clerk publicMetadata.role: "viewer" = read-only; anything else (or unset) = can edit */
export function useAppRole() {
  const { user, isLoaded } = useUser();
  const [sessionTick, setSessionTick] = useState(0);

  useEffect(() => {
    if (!user?.reload) return;
    let active = true;
    user.reload()
      .then(() => { if (active) setSessionTick(t => t + 1); })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  const ready = isLoaded && !!user;

  let headerName = ready ? readHeaderDisplayName(user) : null;
  let boardName = ready ? readBoardTeamName(user) : null;

  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (ready && ownerEmail && email === ownerEmail) {
    const ownerBoard = import.meta.env.VITE_OWNER_TEAM_NAME || OWNER_TEAM_NAME;
    if (!boardName) boardName = ownerBoard;
    if (!headerName) headerName = ownerBoard;
  }

  const roleRaw = user?.publicMetadata?.role;
  const role = typeof roleRaw === "string" ? roleRaw.toLowerCase() : "editor";
  const isViewer = role === "viewer";
  const canEdit = !isViewer;

  return {
    canEdit,
    isViewer,
    role,
    isLoaded: ready,
    headerName,
    boardName,
    user,
    sessionTick,
  };
}
