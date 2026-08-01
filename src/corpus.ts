// Reference corpus: per-repo densities of the three core signals, measured over
// 41 mature TypeScript OSS repos (9.4 MLOC; benchmark run of 2026-07-15 at
// commit 70e986e, shallow default-branch checkouts, SHAs in the run manifest).
//
// Used for one thing: putting a score in context — "worse than N% of reference
// repos". Only the core signals (god, duplication, complexity) are recorded:
// they are the ones measured identically on every repo. Dead code is deliberately
// absent — on 30 of these repos it hinged on Knip entry-point guesses and was
// excluded from their scores too.

export interface CorpusEntry {
  name: string;
  /** God units per KLOC. */
  god: number;
  /** Duplicated lines / total lines, 0..1. */
  duplication: number;
  /** Over-complex functions per KLOC. */
  complexity: number;
}

export const REFERENCE_CORPUS: readonly CorpusEntry[] = [
  { name: 'angular', god: 0.028, duplication: 0.064, complexity: 1.428 },
  { name: 'angular-components', god: 0.019, duplication: 0.076, complexity: 0.53 },
  { name: 'ant-design', god: 0, duplication: 0.108, complexity: 0.49 },
  { name: 'assistant-ui', god: 0.007, duplication: 0.274, complexity: 1.158 },
  { name: 'astro', god: 0.01, duplication: 0.053, complexity: 2.298 },
  { name: 'bolt-diy', god: 0, duplication: 0.117, complexity: 1.698 },
  { name: 'chakra-ui', god: 0, duplication: 0.277, complexity: 0.637 },
  { name: 'create-react-app', god: 0, duplication: 0.023, complexity: 1.114 },
  { name: 'directus', god: 0, duplication: 0.121, complexity: 2.027 },
  { name: 'drizzle-orm', god: 0.004, duplication: 0.261, complexity: 0.721 },
  { name: 'effect', god: 0.016, duplication: 0.152, complexity: 0.579 },
  { name: 'excalidraw', god: 0.047, duplication: 0.048, complexity: 1.906 },
  { name: 'fluentui', god: 0.028, duplication: 0.169, complexity: 0.98 },
  { name: 'gatsby', god: 0.004, duplication: 0.12, complexity: 1.074 },
  { name: 'ionic-framework', god: 0.014, duplication: 0.086, complexity: 1.402 },
  { name: 'lobehub', god: 0.011, duplication: 0.134, complexity: 1.051 },
  { name: 'mantine', god: 0.003, duplication: 0.311, complexity: 0.469 },
  { name: 'material-ui', god: 0, duplication: 0.421, complexity: 0.299 },
  { name: 'nest', god: 0.035, duplication: 0.151, complexity: 0.351 },
  { name: 'nextjs', god: 0.026, duplication: 0.161, complexity: 1.585 },
  { name: 'ng-bootstrap', god: 0, duplication: 0.134, complexity: 0.619 },
  { name: 'nuxt', god: 0, duplication: 0.039, complexity: 3.213 },
  { name: 'nx', god: 0.015, duplication: 0.192, complexity: 2.048 },
  { name: 'payload', god: 0, duplication: 0.192, complexity: 1.919 },
  { name: 'playwright', god: 0.071, duplication: 0.06, complexity: 2.438 },
  { name: 'primeng', god: 0.063, duplication: 0.277, complexity: 0.75 },
  { name: 'prisma', god: 0.013, duplication: 0.195, complexity: 1.109 },
  { name: 'react', god: 0.008, duplication: 0.142, complexity: 0.824 },
  { name: 'react-bootstrap', god: 0, duplication: 0.11, complexity: 0.191 },
  { name: 'remix', god: 0.024, duplication: 0.102, complexity: 1.549 },
  { name: 'shadcn-ui', god: 0, duplication: 0.693, complexity: 0.358 },
  { name: 'storybook', god: 0.003, duplication: 0.103, complexity: 1.177 },
  { name: 'svelte', god: 0, duplication: 0.025, complexity: 3.308 },
  { name: 'taiga-ui', god: 0, duplication: 0.105, complexity: 0.645 },
  { name: 'tanstack-query', god: 0, duplication: 0.232, complexity: 0.944 },
  { name: 'tanstack-table', god: 0, duplication: 0.568, complexity: 1.159 },
  { name: 'trpc', god: 0, duplication: 0.111, complexity: 1.189 },
  { name: 'vercel-ai', god: 0.003, duplication: 0.269, complexity: 1.104 },
  { name: 'vite', god: 0.062, duplication: 0.055, complexity: 2.322 },
  { name: 'vitest', god: 0.023, duplication: 0.039, complexity: 2.136 },
  { name: 'vue-core', god: 0.03, duplication: 0.027, complexity: 3.055 },
];
