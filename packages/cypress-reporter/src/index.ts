import { GenerateCtrfReport as UpstreamCtrfReport } from 'cypress-ctrf-json-reporter';
import { postRunToCtrfHub } from './http.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default class CtrfHubCypressReporter extends UpstreamCtrfReport {
  constructor(reporterOptions: { on: (event: string, handler: (...args: unknown[]) => unknown) => void; outputFile?: string; outputDir?: string; [key: string]: unknown }) {
    super(reporterOptions);

    this.reporterConfigOptions.on('after:run', () => {
      const outputDir =
        this.reporterConfigOptions.outputDir ?? this.defaultOutputDir;
      const filePath = join(outputDir, this.filename);

      try {
        const ctrf = JSON.parse(readFileSync(filePath, 'utf-8'));
        postRunToCtrfHub(ctrf).catch((err: unknown) => {
          console.error(`[CTRFHub] ${String(err)}`);
        });
      } catch {
        console.error(
          `[CTRFHub] Failed to read CTRF report from ${filePath}`,
        );
      }
    });
  }
}
