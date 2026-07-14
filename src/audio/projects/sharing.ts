/**
 * Project sharing operations (remote-only). The owner invites/revokes collaborators by email; access is
 * granted when someone signs in with a provider account whose verified email matches (see the server's
 * `project_members`). These wrap the member endpoints on the sync client with the live session token,
 * so the Share panel stays a pure view. Local/OPFS mode has no sharing, so `sharingAvailable` is false
 * and the panel is never offered there.
 */
import { createApiClient, type ApiClient, type MemberEntry } from "../../contract/client";
import { getAccessToken } from "../../auth/session";

export type { MemberEntry };

const apiUrl = import.meta.env?.VITE_DAW_API_URL;
// One client, token read per request via the getter (a refreshed session token takes effect).
const client: ApiClient | null = apiUrl ? createApiClient({ baseUrl: apiUrl, token: getAccessToken }) : null;

/** Whether project sharing is available (a remote backend is configured). */
export const sharingAvailable = Boolean(client);

/** The project's collaborators (owner-only; rejects for a non-owner). */
export function listMembers(projectId: string): Promise<MemberEntry[]> {
  return client ? client.getMembers(projectId) : Promise.resolve([]);
}

/** Share a project with someone by email (owner-only). */
export function addMember(projectId: string, email: string): Promise<void> {
  return client ? client.addMember(projectId, email) : Promise.resolve();
}

/** Revoke a collaborator's access by email (owner-only). */
export function removeMember(projectId: string, email: string): Promise<void> {
  return client ? client.removeMember(projectId, email) : Promise.resolve();
}
