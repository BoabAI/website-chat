output "app_id" {
  description = "Amplify App ID"
  value       = aws_amplify_app.website_chat.id
}

output "app_arn" {
  description = "Amplify App ARN"
  value       = aws_amplify_app.website_chat.arn
}

output "default_domain" {
  description = "Default Amplify domain"
  value       = aws_amplify_app.website_chat.default_domain
}

output "app_url" {
  description = "URL to access the deployed application"
  value       = "https://${var.branch_name}.${aws_amplify_app.website_chat.default_domain}"
}

output "branch_name" {
  description = "Deployed branch name"
  value       = aws_amplify_branch.main.branch_name
}

output "console_url" {
  description = "AWS Console URL for the Amplify app"
  value       = "https://${var.aws_region}.console.aws.amazon.com/amplify/home?region=${var.aws_region}#/${aws_amplify_app.website_chat.id}"
}
