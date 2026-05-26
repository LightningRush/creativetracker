import { useUser } from "@clerk/clerk-react";

export const OWNER_TEAM_NAME = "Rafa C.";

/** Optional board roster name from Clerk (for assignee defaults / activity) */
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
