/**
 * The library panel's header (below the search box): the active view's title on the
 * left and one "main" menu on the right. On the Project view the title is the current
 * project's name (double-click to rename); elsewhere it is the view name. The menu is
 * app-global chrome - undo/redo plus the project actions (switch / new / rename /
 * delete / export / import), which apply from any view. The MCP status lives in the
 * workbench tab bar, not here.
 */
import { useEffect, useRef, useState } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import { useEditLog } from "../audio/commands/useEditLog";
import { type ProjectMeta, listProjects, refreshProjects, subscribeProjects } from "../audio/projects/library";
import { createProject, deleteProject, renameProject, switchProject } from "../audio/projects/operations";
import { currentProjectId } from "../audio/projectRepository";
import { exportProjectFile, importProjectFile } from "./projectFile";
import type { LibraryView } from "./ActivityRail";
import { InlineRename } from "./InlineRename";
import { Menu, type MenuItem } from "./Menu";

const VIEW_TITLE: Record<Exclude<LibraryView, "project">, string> = {
  search: "Search",
  instruments: "Instruments",
  effects: "Effects",
  patches: "Patches",
  samples: "Samples",
  activity: "Activity",
};

export function LibraryHeader({
  activeView,
  projectStore,
  editLog,
  versionStore,
}: {
  activeView: LibraryView;
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
}) {
  const { canUndo, canRedo } = useEditLog(editLog);
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects());
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const deps = { projectStore, editLog, versionStore };
  const currentId = currentProjectId();
  const currentName = projects.find((meta) => meta.id === currentId)?.name ?? "Project";

  // Mirror the project library; re-enumerate on mount (the header always exists).
  useEffect(() => {
    const sync = () => setProjects(listProjects());
    sync();
    const unsub = subscribeProjects(sync);
    void refreshProjects();
    return unsub;
  }, []);

  const rename = (name: string) => {
    if (name.trim()) void renameProject(currentId, name.trim());
  };
  const deleteCurrent = () => {
    if (window.confirm(`Delete project "${currentName}"? This cannot be undone.`)) void deleteProject(deps, currentId);
  };
  const onImportProject = async (file: File) => {
    setError(null);
    try {
      await importProjectFile(file, projectStore, editLog);
    } catch {
      setError("Could not open that .daw.zip file.");
    }
  };

  const items: MenuItem[] = [
    { label: "Undo", disabled: !canUndo, onClick: () => editLog.undo() },
    { label: "Redo", disabled: !canRedo, onClick: () => editLog.redo() },
    { separator: true },
    ...projects.map((meta) => ({
      label: meta.name,
      checked: meta.id === currentId,
      onClick: () => {
        if (meta.id !== currentId) void switchProject(deps, meta.id);
      },
    })),
    { label: "New project", onClick: () => void createProject(deps) },
    {
      label: "Rename…",
      onClick: () => {
        const name = window.prompt("Rename project", currentName)?.trim();
        if (name) void renameProject(currentId, name);
      },
    },
    { label: "Delete", danger: true, disabled: projects.length <= 1, onClick: deleteCurrent },
    { separator: true },
    { label: "Export project…", onClick: () => void exportProjectFile(projectStore, editLog) },
    { label: "Import project…", onClick: () => importRef.current?.click() },
  ];

  return (
    <>
      <div className="shrink-0 flex items-center gap-2 h-9 px-2.5 border-b border-line">
        {activeView === "project" ? (
          <>
            <span className="w-2 h-2 rounded-full bg-you shrink-0" />
            <InlineRename value={currentName} onCommit={rename} className="font-semibold text-[13px] text-bright" />
          </>
        ) : (
          <span className="font-semibold text-[13px] text-bright">{VIEW_TITLE[activeView]}</span>
        )}
        <Menu
          label="Project menu"
          align="right"
          triggerClassName="ml-auto shrink-0 px-1 text-[15px] leading-none text-muted hover:text-bright cursor-pointer"
          items={items}
        />
      </div>
      {error && <p className="shrink-0 text-claude text-[11px] px-3.5 py-1">{error}</p>}
      <input
        ref={importRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportProject(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
