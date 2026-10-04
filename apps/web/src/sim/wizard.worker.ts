import { driverFromDto } from './model';
import { runWizard, type WizardInput, type WizardResult } from './wizard';

/** One wizard run; `job` tells a reply apart from the replies of a run that was replaced. */
export type WizardJob = Omit<WizardInput, 'driver'> & { job: number };
export type WizardReply =
  | { job: number; type: 'progress'; done: number; total: number }
  | { job: number; type: 'done'; result: WizardResult }
  | { job: number; type: 'error'; missing: string[] | null };

// Typed by hand: the app's tsconfig carries the DOM lib, whose postMessage wants a target origin.
const post = (m: WizardReply) => (self as unknown as { postMessage: (m: WizardReply) => void }).postMessage(m);

self.onmessage = (e: MessageEvent<WizardJob>) => {
  const { job, ...input } = e.data;
  const drv = driverFromDto(input.dto);
  if (!drv.ok) { post({ job, type: 'error', missing: drv.missing }); return; }
  try {
    const result = runWizard({ ...input, driver: drv.driver }, (done, total) => post({ job, type: 'progress', done, total }));
    post({ job, type: 'done', result });
  } catch {
    post({ job, type: 'error', missing: null });
  }
};
