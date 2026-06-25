/**
 * Export / import the whole project as a portable `.daw.zip` - a plain zip of the
 * readable bundle (pretty-printed project.json + log.json + real samples/*.wav;
 * see `projectRepository.ts`). Unzip it with any tool to inspect the project.
 * This is the same folder shape the disk-folder backend (15D) will write
 * uncompressed, so export and on-disk are one format. Import replaces the project.
 */
import { zipSync, unzipSync } from 'fflate';
import { getRepository } from '../audio/projectRepository';
import type { ProjectStore } from '../audio/project/projectStore';
import type { EditLog } from '../audio/commands/editLog';

/** Download the current project as `project.daw.zip`. */
export async function exportProjectFile(projectStore: ProjectStore, editLog: EditLog): Promise<void> {
  const files = await getRepository().exportBundle(projectStore.snapshot(), editLog.getEntries());
  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.daw.zip';
  a.click();
  URL.revokeObjectURL(url);
}

/** Load a `.daw.zip` into the live stores, replacing the current project. */
export async function importProjectFile(file: File, projectStore: ProjectStore, editLog: EditLog): Promise<void> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const saved = await getRepository().importBundle(files);
  projectStore.load(saved.project);
  editLog.restore(saved.log);
}
