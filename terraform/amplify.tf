# AWS Amplify App for Website Chat
resource "aws_amplify_app" "website_chat" {
  name         = var.app_name
  repository   = "https://github.com/BoabAI/website-chat"
  access_token = var.github_token
  platform     = "WEB"

  # Build specification for Vite React app
  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci --include=dev
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
  EOT

  # Environment variables injected at build time
  environment_variables = {
    GEMINI_API_KEY = var.gemini_api_key
  }

  # Branch settings
  enable_auto_branch_creation = false
  enable_branch_auto_build    = true
  enable_branch_auto_deletion = false

  # Custom rules for SPA routing (redirect 404s to index.html)
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>"
    status = "200"
    target = "/index.html"
  }
}

# Main branch configuration
resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.website_chat.id
  branch_name = var.branch_name
  stage       = "PRODUCTION"

  # Auto-build on every push
  enable_auto_build = true

  # Framework detection
  framework = "React"

  # Environment variables specific to this branch (if needed)
  environment_variables = {
    NODE_ENV = "production"
  }
}
