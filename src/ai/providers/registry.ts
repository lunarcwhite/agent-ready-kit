// Provider registry (TASK-040).
//
// One lookup for "which adapter serves this operation". MVP serves the fake
// (tests/dev); live vendors register here later behind the same AIProvider
// interface — domain code keeps calling getProvider() and never branches on
// vendor names. Registry state is module-local and server-side only.
import { ProviderError } from "./errors";
import { FakeProvider } from "./fake";
import type { AIProvider, ProviderName } from "./types";

const adapters = new Map<ProviderName, () => AIProvider>();

export function registerProvider(name: ProviderName, factory: () => AIProvider): void {
  adapters.set(name, factory);
}

export function getProvider(name: ProviderName): AIProvider {
  const factory = adapters.get(name);
  if (!factory) {
    throw new ProviderError("CONFIGURATION", `No adapter registered for provider "${name}".`);
  }
  return factory();
}

export function registeredProviders(): ProviderName[] {
  return [...adapters.keys()];
}

// Default wiring: always available, no credentials, no network.
registerProvider("fake", () => new FakeProvider());
