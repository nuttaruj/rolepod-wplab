import { LocalTarget } from './LocalTarget.js'
import type { Target } from './Target.js'

export type ConnectInput =
  | { kind: 'local'; path: string }
// { kind: 'ssh'; ... } — v0.3
// { kind: 'docker'; ... } — v0.3

export async function openTarget(input: ConnectInput): Promise<Target> {
  switch (input.kind) {
    case 'local':
      return LocalTarget.open(input.path)
    default: {
      const exhaustive: never = input.kind
      throw new Error(`Unsupported target kind: ${String(exhaustive)}`)
    }
  }
}
