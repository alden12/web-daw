/**
 * The address bar as a view of which project is open, so a project has a link you can send
 * (HOST-17).
 *
 * **Deliberately the smallest thing that works**, ahead of deciding what routing and sharing
 * should really look like. There is no router, no history stack and no navigation: the URL is
 * a *reflection* of the open project, written with `replaceState`, and read once at boot. If
 * this grows a second thing worth addressing (a clip, a version, a view), that is the moment
 * to design routing properly rather than to extend this.
 *
 * **The id is the identity; the name is decoration.** A link has to survive a rename, and two
 * projects may share a name, so the id is what is resolved and the slug is there to make the
 * link readable. They are separated by `~`, which a slug can never contain, so parsing stays
 * unambiguous whatever an id looks like (they are not all the same shape - the first project
 * on a fresh install is `default`).
 */

/** Everything project links live under, so a future route can own the rest of the space. */
export const PROJECT_PATH_PREFIX = "/p/";

/** Long enough to recognise the project, short enough to paste into a chat. */
const SLUG_MAX = 48;

/** Separates the readable half from the identifying half. Never produced by `projectSlug`. */
const ID_SEPARATOR = "~";

/** A name as a URL-safe slug: lowercase, punctuation collapsed to single hyphens. */
export function projectSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** The path for a project: `/p/deep-house-jam~p-1a2b3c4d`, or `/p/<id>` for an unnameable name. */
export function projectPath(id: string, name: string): string {
  const slug = projectSlug(name);
  return `${PROJECT_PATH_PREFIX}${slug ? `${slug}${ID_SEPARATOR}${id}` : id}`;
}

/** The project id a path names, or null if it names none. The slug half is ignored entirely. */
export function projectIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PROJECT_PATH_PREFIX)) return null;
  const segment = pathname.slice(PROJECT_PATH_PREFIX.length).split("/")[0];
  const id = decodeURIComponent(segment.slice(segment.lastIndexOf(ID_SEPARATOR) + 1));
  return id || null;
}

/** The project the current URL asks for, if any. Read once at boot - see the note above. */
export function projectIdFromLocation(): string | null {
  return typeof window === "undefined" ? null : projectIdFromPath(window.location.pathname);
}

/**
 * Point the address bar at the open project, keeping any query and hash.
 *
 * `replaceState`, not `pushState`: opening a project is not navigation here, and a history
 * entry you can go "back" from without the app switching projects would be a lie.
 */
export function syncProjectUrl(id: string, name: string): void {
  if (typeof window === "undefined") return;
  const path = projectPath(id, name);
  if (window.location.pathname === path) return;
  window.history.replaceState(null, "", `${path}${window.location.search}${window.location.hash}`);
}
