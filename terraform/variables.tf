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
  description = "Google Gemini API key for the application"
  type        = string
  sensitive   = true
}

variable "branch_name" {
  description = "Git branch to deploy"
  type        = string
  default     = "main"
}
