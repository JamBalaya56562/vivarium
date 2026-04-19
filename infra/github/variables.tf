variable "github_owner" {
  description = "GitHub user or organization that owns the repository"
  type        = string
}

variable "repository_name" {
  description = "Name of the repository to manage"
  type        = string
  default     = "vivarium"
}

variable "repository_description" {
  description = "Repository description"
  type        = string
  default     = "Universal bug reproduction platform — verify claims with reproducible environments"
}

variable "repository_visibility" {
  description = "Repository visibility (public or private)"
  type        = string
  default     = "public"

  validation {
    condition     = contains(["public", "private"], var.repository_visibility)
    error_message = "visibility must be either \"public\" or \"private\"."
  }
}

variable "repository_topics" {
  description = "Topics to attach to the repository"
  type        = list(string)
  default = [
    # Problem domain (keeps the project problem-centered).
    "bug-reproduction",
    "ai-verification",
    "reproducibility",
    "sandbox",
    # Technical means (multi-layer architecture, not locked into WASM).
    "webassembly",
    "docker",
    # Categories
    "developer-tools",
    "open-source",
  ]
}
