import { setTimeout as delay } from "node:timers/promises";
import type { Worker } from "./worker.ts";

export class BackgroundRunner {
  private running: Promise<void> | null = null;
  private requested = false;
  private worker: Worker;
  private budgetMs: number;
  private retryWindowMs: number;
  constructor(worker: Worker, budgetMs = 180000, retryWindowMs = 15000) {
    this.worker = worker;
    this.budgetMs = budgetMs;
    this.retryWindowMs = retryWindowMs;
  }

  wake(): Promise<void> {
    this.requested = true;
    if (!this.running)
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async drain() {
    const deadline = Date.now() + this.budgetMs;
    do {
      this.requested = false;
      for (let rounds = 0; rounds < 100 && Date.now() < deadline; rounds++) {
        const worked = await this.worker.tick();
        if (worked) continue;
        if (this.requested) {
          this.requested = false;
          continue;
        }
        const retryAt = await this.worker.core.nextJobRetry();
        const remaining = retryAt === null ? Infinity : retryAt - Date.now();
        // Only wait for a near-term safe retry. Other queued work survives the invocation.
        if (
          remaining > 0 &&
          remaining <= this.retryWindowMs &&
          retryAt! < deadline
        ) {
          await delay(remaining);
          continue;
        }
        break;
      }
    } while (this.requested && Date.now() < deadline);
  }
}
