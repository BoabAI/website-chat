variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "ap-southeast-2"
}

variable "app_name" {
  description = "Name of the Amplify application"
  type        = string
  default     = "website-chat"
}

variable "github_token" {
  description = "GitHub Personal Access Token with repo scope for Amplify to access the repository"
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Google Gemini API key. Used ONLY by the proxy Lambda — no longer injected into the client build. Rotate the old (exposed) key before setting this."
  type        = string
  sensitive   = true
}

variable "allowed_origins" {
  description = "Comma-separated CORS origins for the proxy Function URL, e.g. https://main.d1234.amplifyapp.com. CORS only limits browsers, not scripted abuse (that's the rate limiter's job); '*' is fine for testing but tighten for production."
  type        = string
  default     = "*"
}

variable "branch_name" {
  description = "Git branch to deploy"
  type        = string
  default     = "main"
}
