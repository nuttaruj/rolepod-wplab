import { LocalTarget } from './LocalTarget.js'
import { RestTarget } from './RestTarget.js'
import type { Target } from './Target.js'
import type { Credential } from '../credentials/types.js'

export type ConnectInput =
  | { kind: 'local'; path: string }
  | { kind: 'rest'; url: string; credential: Credential }
// { kind: 'ssh'; ... } — v0.3
// { kind: 'docker'; ... } — v0.3

export async function openTarget(input: ConnectInput): Promise<Target> {
  switch (input.kind) {
    case 'local':
      return LocalTarget.open(input.path)
    case 'rest':
      return RestTarget.open({ url: input.url, credential: input.credential })
    default: {
      const exhaustive: never = input
      throw new Error(`Unsupported target kind: ${JSON.stringify(exhaustive)}`)
    }
  }
}
