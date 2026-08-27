---
name: fc-nginx-website
description: >-
  Prepare and verify static website artifacts for AutoClaw's managed
  function-compute nginx environment. Use for landing pages, documentation
  sites, or pre-built front ends that may later be delivered through AutoClaw;
  this skill does not authorize Codex to publish, call deployment APIs, or
  invent a preview URL.
---

# AutoClaw managed static hosting from Codex

Use this skill to prepare a safe, self-contained static artifact and verify it
locally against the hosting contract. It describes the AutoClaw-managed nginx
target; it does not give Codex access to AutoClaw's delivery control plane.

## Codex boundary

Codex may author, build, inspect, and locally serve static files. Unless a
separate, available integration explicitly provides the managed deployment
workflow, stop after local verification and report that AutoClaw publication and
its resulting URL are **not executed or verified**.

- Do not call any `/functionCompute` API.
- Do not read, request, store, or output a JWT.
- Do not create or update AutoClaw deployment bookkeeping.
- Do not write `nginx.conf`, build a deployment zip, or base64-encode a payload.
- Do not guess, assemble, or claim a preview or production URL.

AutoClaw Main, not Codex, owns managed packaging, uploading, preview URL
creation, and publication. The user owns any final Publish action.

## Hosting capabilities

The target `nginx` environment is a static-file host. It reads files from disk;
there is no application process, request handler, database connection, or
server-side build step.

- Supported: HTML, CSS, JavaScript, images, fonts, and pre-built output such as
  Vite/CRA/Vue `dist` or Hugo/Jekyll output.
- Unsupported: SSR, API routes, databases, WebSocket servers, cron jobs, and
  anything requiring a long-running process.
- Client-side routing is supported by the managed `index.html` fallback. Do not
  add a custom nginx configuration for it.

If the application depends on an unsupported server capability, produce a
static build when that preserves the requested behavior. Otherwise state the
hosting incompatibility plainly; never fake a working preview.

## `entryFile` defines the uploaded subtree

The site root is the directory containing `entryFile`. Only that directory and
its descendants are included in the managed upload.

- `entryFile: "index.html"` makes the project directory the site root.
- `entryFile: "dist/index.html"` makes `dist/` the site root; files outside
  `dist/` will not be uploaded.
- `entryFile` must be a relative path to an existing file inside the project.
  Reject absolute paths and any `..` segment.
- The `dist/index.html` or `build/index.html` fallback applies only when
  `entryFile` is exactly `index.html` or `index.htm`. Other names must exist at
  their declared path.
- If the entry file is not named `index.html`, the managed workflow copies it to
  `index.html` so `/` can serve it.

Keep every referenced asset under the site root and prefer paths that resolve
within that subtree. Before handoff, inspect that subtree for source files,
sourcemaps, or secrets: `.ts`, `.vue`, `.map`, and other stray files can be
uploaded. The managed exclusions are limited to `.DS_Store`, `.git`, `.svn`,
`node_modules`, the deployment bookkeeping file, `.env*`, and symlinks.

## Managed limits

The site root must stay within all three limits:

| Constraint | Limit |
|---|---:|
| Source files | 5,000 |
| Total source size | 100 MB |
| Upload body after base64 | 50 MB |

Optimize large media and remove unused build artifacts when necessary. Do not
base64-encode the upload yourself; the final limit is a compatibility check for
the managed workflow.

## Local verification and handoff

Verify the artifact without claiming managed deployment:

1. Confirm that `entryFile` exists and derive the site root from its directory.
2. Confirm that referenced assets and route entry points live under that root.
3. Check file count, total size, and the absence of secrets or unintended
   source artifacts in the subtree.
4. Serve the site root locally and test the relevant pages, assets, console,
   and responsive layout. Local serving proves the artifact, not AutoClaw
   publication.
5. Report the selected `entryFile`, site root, local evidence, and any managed
   deployment step that remains unexecuted.

For a blank page or asset 404, first check whether the entry file's directory
contains every referenced path. A managed-route 404 normally means the required
file was outside the uploaded subtree. If the managed upload rejects the
artifact, re-check all three size limits.
