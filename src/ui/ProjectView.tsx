/**
 * The Project view (a library-rail view): the multi-project explorer. Lists saved
 * projects with the current one marked, switches on click, and creates / renames /
 * deletes via the project operations. Project-level file actions that used to live
 * in the library's hamburger menu - export / import a `.daw.zip` - live here too,
 * since this is the project's home. (Import audio lives in the Samples view.)
 */
import { useEffect, useRef, useState } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import { type ProjectMeta, listProjects, refreshProjects, subscribeProjects } from "../audio/projects/library";
import { createProject, deleteProject, renameProject, switchProject } from "../audio/projects/operations";
import { currentProjectId } from "../audio/projectRepository";
import { exportProjectFile, importProjectFile } from "./projectFile";
import { Menu } from "./Menu";

export function ProjectView({
  projectStore,
  editLog,
  versionStore,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
}) {
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects());
  const [error, setError] = useState<string | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const deps = { projectStore, editLog, versionStore };
  const currentId = currentProjectId();

  // Mirror the project library, and re-enumerate on mount: this view can mount during
  // boot (when the persisted view is "project") and would otherwise race the initial
  // refresh and miss it, showing an empty list until the next change.
  useEffect(() => {
    const sync = () => setProjects(listProjects());
    sync();
    const unsub = subscribeProjects(sync);
    void refreshProjects();
    return unsub;
  }, []);

  const onImportProject = async (file: File) => {
    setError(null);
    try {
      await importProjectFile(file, projectStore, editLog);
    } catch {
      setError("Could not open that .daw.zip file.");
    }
  };

  const actionBtn =
    "block w-full text-left px-3.5 py-1.5 text-[12.5px] text-muted hover:text-ink hover:bg-you/10 cursor-pointer";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {projects.map((meta) => (
          <div key={meta.id} className="group flex items-center pr-2 hover:bg-you/10">
            <button
              type="button"
              data-testid="project-row"
              onClick={() => {
                if (meta.id !== currentId) void switchProject(deps, meta.id);
              }}
              className="flex items-center gap-2 flex-1 min-w-0 text-left px-3.5 py-1.5 cursor-pointer"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.id === currentId ? "bg-you" : "bg-transparent"}`}
              />
              <span className={`truncate text-[12.5px] ${meta.id === currentId ? "text-bright" : "text-ink"}`}>
                {meta.name}
              </span>
            </button>
            <Menu
              label={`Project actions: ${meta.name}`}
              triggerClassName="shrink-0 px-1 text-[13px] leading-none text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
              items={[
                {
                  label: "Rename…",
                  onClick: () => {
                    const name = window.prompt("Rename project", meta.name)?.trim();
                    if (name) void renameProject(meta.id, name);
                  },
                },
                {
                  label: "Delete",
                  danger: true,
                  disabled: projects.length <= 1,
                  onClick: () => {
                    if (window.confirm(`Delete project "${meta.name}"? This cannot be undone.`))
                      void deleteProject(deps, meta.id);
                  },
                },
              ]}
            />
          </div>
        ))}
        <button type="button" onClick={() => void createProject(deps)} className={actionBtn}>
          + New project
        </button>

        <div className="my-1.5 mx-3.5 border-t border-line" />
        <button type="button" onClick={() => void exportProjectFile(projectStore, editLog)} className={actionBtn}>
          Export project…
        </button>
        <button type="button" onClick={() => projectInputRef.current?.click()} className={actionBtn}>
          Import project…
        </button>
        {error && <p className="text-claude text-[11px] px-3.5 pt-1">{error}</p>}
      </div>

      <input
        ref={projectInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportProject(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
