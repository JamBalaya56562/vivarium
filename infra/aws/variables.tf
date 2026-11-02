variable "aws_region" {
  description = "AWS Region for every resource in this module"
  type        = string
  default     = "ap-northeast-1"
}

variable "preview_github_client_id" {
  description = "Client ID of the GitHub OAuth app the previews sign in with; empty until the app exists"
  type        = string
  default     = ""
}

variable "preview_github_client_secret" {
  description = "Client secret of the GitHub OAuth app the previews sign in with"
  type        = string
  default     = ""
  sensitive   = true
}
