# Layer 2 — Docker (full-fidelity environment)

> Reproduction inside a real container: real OS, real filesystem, real
> package manager. Startup: seconds to minutes.

---

## What routes here

- **Whole-project repros** — the bug needs the project's actual
  `requirements.txt` / `package.json` / `Cargo.toml` resolved against a
  real environment.
- **System-call dependent bugs** — file locking, signals, permissions,
  `fork`/`exec`, real TCP/UDP, epoll/kqueue edge cases.
- **Toolchain-specific bugs** — a specific GCC/Clang/rustc version, a
  specific glibc, a specific kernel-userspace ABI quirk.
- **Cross-service bugs** — multi-container compose scenarios where the
  interaction *between* processes is the bug.

## What does **not** route here

- Pure algorithmic bugs that would run in-browser in a fraction of the
  time → Layer 1.
- Concurrency or memory-ordering bugs that need deterministic replay to
  be even *observable* → Layer 3.

## Candidate runtimes

| Runtime                                         | Role                          |
|-------------------------------------------------|-------------------------------|
| Devcontainer image (`mcr.microsoft.com/devcontainers/*`) | Baseline full-OS repro |
| [Firecracker](https://firecracker-microvm.github.io) microVM | Faster boot, stronger isolation (exploration) |
| [Kata Containers](https://katacontainers.io)   | OCI-compat microVM (exploration) |

Concrete choices land as ADRs in [`docs/docs/`](../../docs/docs/), not here.

## Phase 0 scope

**Not in Phase 0.** Layer 2 is expected for later phases once Layer 1
has demonstrated the reproduction primitive end-to-end in a browser.
This directory stays empty until an Issue proposes a concrete Layer 2
vertical.
