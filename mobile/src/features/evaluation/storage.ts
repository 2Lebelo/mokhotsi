import { Directory, File, Paths } from "expo-file-system";

import { fileStem, runToCsv, runToJson } from "@/features/evaluation/export";
import { parseRun, type EvaluationRun } from "@/features/evaluation/run";

// Evaluation runs live as JSON files in the app's documents folder, outside the shop
// database: nothing here is synced, queued, or seen by the till.

function runsDirectory(): Directory {
  const directory = new Directory(Paths.document, "evaluation");
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

/** Saves (overwrites) a run. Called after every kept trial, so a crash loses nothing. */
export function saveRun(run: EvaluationRun): void {
  const file = new File(runsDirectory(), `${run.id}.json`);
  file.write(runToJson(run));
}

export function deleteRun(id: string): void {
  const file = new File(runsDirectory(), `${id}.json`);
  if (file.exists) file.delete();
}

/** Saved runs, newest first. Unreadable files are skipped, not fatal. */
export function listRuns(): EvaluationRun[] {
  const runs: EvaluationRun[] = [];
  for (const entry of runsDirectory().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith(".json")) continue;
    try {
      runs.push(parseRun(JSON.parse(entry.textSync())));
    } catch {
      /* Not a run (or from a newer app version): leave it alone. */
    }
  }
  return runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Writes the run as JSON (complete, for ml/scripts/analyse_trials.py) and CSV (one row per
 * trial) into a folder the user picks, e.g. Downloads. Returns the folder's name, or null if
 * the user cancelled the picker.
 */
export async function exportRun(run: EvaluationRun): Promise<string | null> {
  let target: Directory;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch {
    return null; // Picker dismissed.
  }
  const stem = fileStem(run);
  target.createFile(`${stem}.json`, "application/json").write(runToJson(run));
  target.createFile(`${stem}.csv`, "text/csv").write(runToCsv(run));
  return target.name || "the chosen folder";
}
