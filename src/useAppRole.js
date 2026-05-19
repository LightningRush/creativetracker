import { useUser } from "@clerk/clerk-react";

export const OWNER_TEAM_NAME = "Rafa C.";

/** Clerk publicMetadata.teamName, or owner email match (VITE_OWNER_EMAIL + VITE_OWNER_TEAM_NAME) */
export function useTeamProfile() {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return null;
  const meta = user.publicMetadata?.teamName;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  const ownerEmail = import.meta.env.VITE_OWNER_EMAIL?.toLowerCase();
  const email = user.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (ownerEmail && email === ownerEmail) {
    return import.meta.env.VITE_OWNER_TEAM_NAME || OWNER_TEAM_NAME;
  }
  return null;
}

/** Clerk publicMetadata.role: "viewer" = read-only; anything else (or unset) = can edit */
export function useAppRole() {
  const { user, isLoaded } = useUser();
  const role = typeof user?.publicMetadata?.role === "string"
    ? user.publicMetadata.role.toLowerCase()
    : "editor";

  const isViewer = role === "viewer";
  const canEdit = !isViewer;
  const teamProfile = useTeamProfile();

  return { canEdit, isViewer, role, isLoaded, teamProfile };
}
