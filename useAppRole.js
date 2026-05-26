import { useUser } from "@clerk/clerk-react";

export const OWNER_TEAM_NAME = "Rafa C.";

function readMetaString(user, keys) {
  if (!user) return null;
  const bags = [user.publicMetadata, user.unsafeMetadata];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const key of keys) {
      const raw = bag[key];
      if (typeof raw === "string" && raw.trim()) return raw.trim();
    }
  }
  return null;
}

/** Top-left chip: nickname first, then Clerk profile fields */
export function readHeaderDisplayName(user) {
  if (!user) return null;
  const nickname = readMetaString(user, [
    "nickname", "nickName", "nick_name", "displayName", "display_name",
  ]);
  if (nickname) return nickname;
  if (user.username?.trim()) return user.username.trim();
  if (user.firstName?.trim()) {
    const last = user.lastName?.trim();
    return last ? `${user.firstName} ${last[0]}.` : user.firstName.trim();
  }
  if (user.fullName?.trim()) return user.fullName.trim();
  return readMetaString(user, ["teamName", "team_name"]);
}

/** Board / activity / default assignee — teamName in metadata only */
export function readBoardTeamName(user) {
  return readMetaString(user, ["teamName", "team_name"]);
}

export function useTeamProfile() {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return { headerName: null, boardName: null, isLoaded: false };

  let headerName = readHeaderDisplayName(user);
  let boardName = readBoardTeamName(user);

  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (ownerEmail && email === ownerEmail) {
    const ownerBoard = import.meta.env.VITE_OWNER_TEAM_NAME || OWNER_TEAM_NAME;
    if (!boardName) boardName = ownerBoard;
    if (!headerName) headerName = ownerBoard;
  }

  return { headerName, boardName, isLoaded: true };
}

/** Clerk publicMetadata.role: "viewer" = read-only; anything else (or unset) = can edit */
export function useAppRole() {
  const { user, isLoaded } = useUser();
  const role = typeof user?.publicMetadata?.role === "string"
    ? user.publicMetadata.role.toLowerCase()
    : "editor";

  const isViewer = role === "viewer";
  const canEdit = !isViewer;
  const { headerName, boardName } = useTeamProfile();

  return { canEdit, isViewer, role, isLoaded, headerName, boardName };
}
