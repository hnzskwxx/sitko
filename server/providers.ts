import type { Config } from './config.js';
import { log } from './lib/logger.js';
import { AnthropicProvider } from './services/ai/anthropic.js';
import { DemoProvider } from './services/ai/demo.js';
import type { AiProvider } from './services/ai/provider.js';
import type { ProviderResolver } from './services/queue.js';

/** Ukázková organizace dostane vždy DemoProvider, ostatní skutečnou AI (nebo nic, když chybí klíč). */
export class Providers implements ProviderResolver {
  constructor(private ai: AiProvider | null, private demo: AiProvider | null) {}

  static fromConfig(cfg: Config, samplesDir: string): Providers {
    const ai = cfg.ai.apiKey ? new AnthropicProvider(cfg.ai) : null;
    let demo: AiProvider | null = null;
    try {
      demo = new DemoProvider(samplesDir);
    } catch (err) {
      log.warn('demo_provider_unavailable', { err: (err as Error).message });
    }
    return new Providers(ai, demo);
  }

  forOrg(isDemo: boolean): AiProvider | null {
    return isDemo ? this.demo : this.ai;
  }
}
