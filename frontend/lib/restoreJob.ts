/**
 * R08.04 — a restore is a JOB with an identity, so one that was cut short
 * (app killed, network gone, a chunk refused) is continued as the SAME job
 * instead of starting a second one.
 *
 * The job id is derived from the file itself (the account + every
 * collection's count and checksum in the manifest): the same file gives the
 * same id, a different file a different one. Re-running a job is safe by
 * construction -- the dry run skips every row that already exists by id --
 * so "continue" inserts only what is still missing and "the same file again"
 * inserts nothing.
 *
 * Pure.
 */
import { canonical, checksum, type Manifest } from './backupFormat';

export type RestoreJobStatus = 'running' | 'done' | 'cancelled' | 'failed';

export type RestoreJob = {
  id: string;
  /** the file's own creation time, to name it to the user */
  fileCreatedAt: string;
  startedAt: string;
  updatedAt: string;
  status: RestoreJobStatus;
  inserted: Record<string, number>;
  /** how many rows the plan meant to insert when this run started */
  planned: number;
  error?: string;
};

export function jobIdFor(m: Pick<Manifest, 'user_id' | 'collections'>): string {
  return `restore-${checksum(canonical({ u: m.user_id, c: m.collections }))}`;
}

/** A job that did not reach `done` and can be continued with the same file. */
export function isInterrupted(j: RestoreJob | null): boolean {
  return !!j && (j.status === 'running' || j.status === 'failed' || j.status === 'cancelled');
}

export function interruptedText(j: RestoreJob): string {
  const done = Object.values(j.inserted).reduce((a, b) => a + b, 0);
  const why = j.status === 'cancelled' ? 'iptal edildi' : j.status === 'failed' ? `durdu (${j.error ?? 'hata'})` : 'yarıda kaldı';
  return `Yarım kalan bir geri yükleme var: ${j.fileCreatedAt.slice(0, 10)} tarihli dosya, ${done} kayıt eklendikten sonra ${why}. `
    + 'Aynı dosyayı doğrulayıp sürdürebilirsin; zaten eklenenler tekrar eklenmez.';
}
