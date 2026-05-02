import type {
  Reporter,
  FullConfig,
  Suite,
  FullResult,
  TestCase,
  TestResult,
  TestStep,
  TestError,
} from '@playwright/test/reporter';
import { postRunToCtrfHub } from './http.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface UpstreamReporter {
  onBegin(config: FullConfig, suite: Suite): void;
  onTestBegin?(test: TestCase, result: TestResult): void;
  onTestEnd?(test: TestCase, result: TestResult): void;
  onStepBegin?(test: TestCase, result: TestResult, step: TestStep): void;
  onStepEnd?(test: TestCase, result: TestResult, step: TestStep): void;
  onEnd(result?: FullResult): void;
  onError?(error: TestError): void;
  printsToStdio(): boolean;
  reporterConfigOptions: {
    outputDir?: string;
    outputFile?: string;
    [key: string]: unknown;
  };
  defaultOutputDir: string;
  defaultOutputFile: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const UpstreamReporter: new (config?: Record<string, any>) => UpstreamReporter =
  require('playwright-ctrf-json-reporter').default;

export default class CtrfHubPlaywrightReporter implements Reporter {
  private upstream: UpstreamReporter;

  constructor(config?: Record<string, unknown>) {
    this.upstream = new UpstreamReporter(config);
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.upstream.onBegin(config, suite);
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.upstream.onTestBegin?.(test, result);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.upstream.onTestEnd?.(test, result);
  }

  onStepBegin(
    test: TestCase,
    result: TestResult,
    step: TestStep,
  ): void {
    this.upstream.onStepBegin?.(test, result, step);
  }

  onStepEnd(
    test: TestCase,
    result: TestResult,
    step: TestStep,
  ): void {
    this.upstream.onStepEnd?.(test, result, step);
  }

  async onEnd(result?: FullResult): Promise<void> {
    this.upstream.onEnd(result);

    const outputDir =
      this.upstream.reporterConfigOptions.outputDir ??
      this.upstream.defaultOutputDir;
    const outputFile =
      this.upstream.reporterConfigOptions.outputFile ??
      this.upstream.defaultOutputFile;
    const filePath = join(outputDir, outputFile);

    try {
      const ctrf = JSON.parse(readFileSync(filePath, 'utf-8'));
      await postRunToCtrfHub(ctrf);
    } catch {
      console.error(`[CTRFHub] Failed to read CTRF report from ${filePath}`);
    }
  }

  printsToStdio(): boolean {
    return this.upstream.printsToStdio();
  }

  onError(error: TestError): void {
    this.upstream.onError?.(error);
  }
}
